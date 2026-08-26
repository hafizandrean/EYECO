import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import express from 'express';

import { connectDB } from '../src/database/db';
import { R2StorageService } from '../src/services/R2StorageService';
import { SpoolRetryWorker, SpoolJobManifest } from '../src/services/SpoolRetryWorker';
import { AiEvidenceModel } from '../src/database/models/AiEvidence';
import { ReportModel } from '../src/database/models/Report';
import mediaRouter from '../src/routes/mediaRoutes';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function runFullAcceptanceTestSuite() {
  console.log(`\n======================================================`);
  console.log(`  EYECO INFRASTRUCTURE COMPLETE INTEGRATION TEST SUITE`);
  console.log(`======================================================\n`);

  await connectDB();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // TEST GROUP 1: Fail-Fast Configuration Validation
  // ----------------------------------------------------
  assert(Boolean(process.env.MONGODB_URI?.includes('/eyeco')), 'MONGODB_URI points explicitly to target database /eyeco');

  // Test fail-fast R2_BUCKET check when STORAGE_MODE=R2
  const originalBucket = process.env.R2_BUCKET;
  const originalMode = process.env.STORAGE_MODE;
  try {
    process.env.STORAGE_MODE = 'R2';
    delete process.env.R2_BUCKET;
    let threw = false;
    try {
      R2StorageService.getBucket();
    } catch (err: any) {
      threw = err.message.includes('R2_BUCKET environment variable is required');
    }
    assert(threw, 'Fail-fast configuration rejects STORAGE_MODE=R2 when R2_BUCKET is missing');
  } finally {
    if (originalBucket) process.env.R2_BUCKET = originalBucket;
    else process.env.R2_BUCKET = 'eyeco';
    if (originalMode) process.env.STORAGE_MODE = originalMode;
  }

  // ----------------------------------------------------
  // TEST GROUP 2: Deterministic Key Formatting
  // ----------------------------------------------------
  const testSha = 'a81c962a7c0000000000000000000000';
  const autoKey = R2StorageService.getAutoReportKey(120, 'evt_123', testSha);
  assert(autoKey === 'laporan_auto/120/evt_123-a81c962a7c00.jpg', 'Deterministic auto report key format matches');

  const manualKey = R2StorageService.getManualReportKey(120, 'evt_123', testSha, 'my_photo.png');
  assert(manualKey === 'laporan_manual/120/evt_123-a81c962a7c00.png', 'Deterministic manual report key format matches');

  // ----------------------------------------------------
  // TEST GROUP 3: Object-Level ACL & Authorized Presigned URL Endpoints
  // ----------------------------------------------------
  const app = express();
  app.use(express.json());
  app.use('/api', mediaRouter);

  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 3A: Unauthenticated request -> 401 Unauthorized
    const resUnauth = await fetch(`${baseUrl}/api/reports/120/evidence`);
    assert(resUnauth.status === 401, 'Unauthorized media request returns 401 Unauthorized');

    const resUnauthMedia = await fetch(`${baseUrl}/api/media/evt_999`);
    assert(resUnauthMedia.status === 401, 'Unauthorized media ID request returns 401 Unauthorized');
  } finally {
    server.close();
  }

  // ----------------------------------------------------
  // TEST GROUP 4: Spool Manifest Sidecar & Capacity Guardrails
  // ----------------------------------------------------
  const tempTestDir = path.join(os.tmpdir(), 'eyeco-integration-test-temp');
  if (!fs.existsSync(tempTestDir)) fs.mkdirSync(tempTestDir, { recursive: true });

  const dummyFilePath = path.join(tempTestDir, 'dummy_evidence.jpg');
  fs.writeFileSync(dummyFilePath, 'DUMMY_EYECO_EVIDENCE_BYTES_1234567890_INTEGRATION_TEST');

  const testReportId = '99999';
  const testEvidenceId = 'evt_integration_99999';
  const spoolJob = SpoolRetryWorker.saveToSpool(
    dummyFilePath,
    testReportId,
    testEvidenceId,
    `laporan_auto/${testReportId}/${testEvidenceId}-a81c962a7c00.jpg`,
    testSha,
    'image/jpeg'
  );

  assert(Boolean(spoolJob), 'SpoolRetryWorker created persistent spool job');
  let manifestPath = '';
  if (spoolJob) {
    const spoolDir = SpoolRetryWorker.getSpoolDir();
    manifestPath = path.join(spoolDir, `${spoolJob.jobId}.json`);
    assert(fs.existsSync(manifestPath), 'Sidecar job.json manifest created on disk');

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SpoolJobManifest;
    assert(manifestContent.reportId === testReportId, 'Job manifest contains correct reportId');
    assert(manifestContent.sha256 === testSha, 'Job manifest contains correct sha256');
    assert(manifestContent.maxAttempts === 5, 'Job manifest enforces maxAttempts = 5 capacity guardrail');
    assert(manifestContent.status === 'RETRY_WAIT', 'Job manifest initial status is RETRY_WAIT');
  }

  // Test Configurable Spool Capacity Limit (EYECO_SPOOL_MAX_BYTES)
  const origMaxBytes = process.env.EYECO_SPOOL_MAX_BYTES;
  try {
    process.env.EYECO_SPOOL_MAX_BYTES = '100'; // 100 bytes limit
    assert(SpoolRetryWorker.getMaxCapacityBytes() === 100, 'SpoolRetryWorker respects EYECO_SPOOL_MAX_BYTES override');
  } finally {
    if (origMaxBytes) process.env.EYECO_SPOOL_MAX_BYTES = origMaxBytes;
    else delete process.env.EYECO_SPOOL_MAX_BYTES;
  }

  // ----------------------------------------------------
  // TEST GROUP 5: Process Restart Recovery Test
  // ----------------------------------------------------
  // Simulate worker restart by processing persisted disk manifests
  const processResult = await SpoolRetryWorker.processSpool();
  assert(typeof processResult.processed === 'number', 'SpoolRetryWorker processSpool executed restart recovery cycle');

  // Clean test temp files
  try {
    if (fs.existsSync(dummyFilePath)) fs.unlinkSync(dummyFilePath);
    if (fs.existsSync(tempTestDir)) fs.rmdirSync(tempTestDir);
  } catch (_) {}

  // ----------------------------------------------------
  // TEST GROUP 6: Repository Gitignore Protection
  // ----------------------------------------------------
  const gitignorePath = path.join(__dirname, '../.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const giContent = fs.readFileSync(gitignorePath, 'utf8');
    assert(giContent.includes('public/uploads/*'), '.gitignore contains public/uploads/* protection');
    assert(giContent.includes('!public/uploads/logo-eyeco.png'), '.gitignore preserves public/uploads/logo-eyeco.png');
    assert(giContent.includes('eyeco-spool/'), '.gitignore contains eyeco-spool/ protection');
  }

  console.log(`\n======================================================`);
  console.log(`  INTEGRATION TEST RESULTS SUMMARY`);
  console.log(`======================================================`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`======================================================\n`);

  await mongoose.disconnect();
}

runFullAcceptanceTestSuite().catch(err => {
  console.error('Integration Test Execution Failed:', err);
  process.exit(1);
});
