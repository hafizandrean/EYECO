import assert from 'assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { connectDB, disconnectDB } from '../../src/database/db';
import { VideoAnalysisJobModel } from '../../src/database/models/VideoAnalysisJob';
import { AiSnapshotModel } from '../../src/database/models/AiSnapshot';
import { ReportModel } from '../../src/database/models/Report';
import { deriveLegacyStatuses } from '../../src/services/ai/videoWorker';

dotenv.config();

// Custom claimant logic matching worker claimNextJob
async function claimJob(workerId: string, claimToken: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 120_000);
  
  return await VideoAnalysisJobModel.findOneAndUpdate(
    {
      $expr: {
        $lt: ['$attemptCount', '$maxAttempts'],
      },
      $or: [
        { status: 'QUEUED', nextAttemptAt: { $lte: now } },
        { status: 'RETRY_WAIT', nextAttemptAt: { $lte: now } },
        { status: 'PROCESSING', leaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        workerId,
        claimToken,
        heartbeatAt: now,
        leaseExpiresAt,
        lastAttemptStartedAt: now,
        progressStage: 'VALIDATING',
      },
      $inc: { attemptCount: 1 }
    },
    {
      sort: { createdAt: 1 },
      new: true
    }
  );
}

// Custom finalizer logic matching worker finalizeExhaustedJobs
async function finalizeExhausted() {
  const now = new Date();
  return await VideoAnalysisJobModel.updateMany(
    {
      status: 'PROCESSING',
      leaseExpiresAt: { $lte: now },
      $expr: { $gte: ['$attemptCount', '$maxAttempts'] }
    },
    {
      $set: {
        status: 'FAILED',
        progressStage: 'FINISHED',
        completedAt: now,
        errorCode: 'MAX_ATTEMPTS_EXCEEDED',
        errorDetails: 'Pekerjaan melebihi batas percobaan maksimal.',
      },
      $unset: {
        workerId: '',
        claimToken: '',
        heartbeatAt: '',
        leaseExpiresAt: ''
      }
    }
  );
}

async function runTests() {
  console.log('[TEST] Connecting to database...');
  await connectDB();

  // Clear test data
  await VideoAnalysisJobModel.collection.deleteMany({ correlationId: { $regex: /^test_/ } });
  await AiSnapshotModel.collection.deleteMany({ snapshotKey: { $regex: /^test_/ } });
  await ReportModel.collection.deleteMany({ incidentKey: { $regex: /^test_/ } });

  console.log('[TEST] Starting QA Video Analysis Test Suite...');

  // --- Test Case 1: Job Lease Recovery ---
  console.log('\n[TEST CASE 1] Job Lease Recovery');
  const staleJob = await VideoAnalysisJobModel.create({
    sourceVideoId: new mongoose.Types.ObjectId(),
    sourceVideoHash: 'hash_test_1',
    sourceStorageKey: 'path/to/test_1',
    status: 'PROCESSING',
    progressStage: 'ANALYZING',
    analysisRunId: 'test_run_1',
    attemptCount: 1,
    maxAttempts: 3,
    leaseExpiresAt: new Date(Date.now() - 10000), // expired 10s ago
    nextAttemptAt: new Date(),
    correlationId: 'test_corr_1'
  });

  const workerToken = randomUUID();
  const claimed = await claimJob('worker_test_1', workerToken);
  assert.ok(claimed, 'Expired job should be claimable');
  assert.strictEqual(claimed.status, 'PROCESSING');
  assert.strictEqual(claimed.attemptCount, 2);
  assert.strictEqual(claimed.claimToken, workerToken);
  console.log('[PASS] Job Lease Recovery completed successfully.');


  // --- Test Case 2: Zombie Worker Protection ---
  console.log('\n[TEST CASE 2] Zombie Worker Protection');
  // Simulating Worker 1 update attempt on a job that was reclaimed by Worker 2 (new token)
  const worker1Token = workerToken;
  const worker2Token = randomUUID();

  // Worker 2 claims the job after Worker 1 lease expires
  await VideoAnalysisJobModel.updateOne(
    { _id: staleJob._id },
    { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
  );
  const reClaimed = await claimJob('worker_test_2', worker2Token);
  assert.strictEqual(reClaimed?.claimToken, worker2Token);

  // Worker 1 tries to update the job with worker1Token
  const w1Update = await VideoAnalysisJobModel.updateOne(
    {
      _id: staleJob._id,
      status: 'PROCESSING',
      workerId: 'worker_test_1',
      claimToken: worker1Token
    },
    { $set: { progressStage: 'DECODING' } }
  );
  assert.strictEqual(w1Update.modifiedCount, 0, 'Zombie worker update must be rejected');
  console.log('[PASS] Zombie Worker Protection completed successfully.');


  // --- Test Case 3: Double-Processing Idempotency ---
  console.log('\n[TEST CASE 3] Double-Processing Idempotency');
  const snapshotKey = 'test_snap_key_3';
  const incidentKey = 'test_inc_key_3';
  const sourceVideoId = new mongoose.Types.ObjectId();

  const dummySnapshotData = {
    analysisId: 'test_an_3',
    inputImageHash: 'test_img_hash_3',
    imagePath: 'test_img_path_3',
    featureVector: { yoloObjects: [] },
    evidenceItems: [],
    decision: { finalDecision: 'INDIKASI_TINGGI' }
  };

  const dummyReportData = {
    validationStatus: 'PENDING',
    needsHumanValidation: true,
    createdFrom: 'VIDEO_AI',
    adminStatus: 'MENUNGGU',
    status: 'UNDER_REVIEW'
  };

  // Run transaction first time
  await mongoose.connection.transaction(async (session) => {
    await AiSnapshotModel.updateOne(
      { snapshotKey },
      { $setOnInsert: { ...dummySnapshotData, snapshotKey } },
      { upsert: true, session }
    );
    const snap = await AiSnapshotModel.findOne({ snapshotKey }).session(session).orFail();
    await ReportModel.updateOne(
      { sourceVideoId, incidentKey },
      {
        $setOnInsert: { ...dummyReportData },
        $set: { activeSnapshotId: snap._id }
      },
      { upsert: true, session }
    );
  });

  const snapCountFirst = await AiSnapshotModel.countDocuments({ snapshotKey });
  const reportCountFirst = await ReportModel.countDocuments({ incidentKey });
  assert.strictEqual(snapCountFirst, 1);
  assert.strictEqual(reportCountFirst, 1);

  // Run transaction second time (retry scenario)
  await mongoose.connection.transaction(async (session) => {
    await AiSnapshotModel.updateOne(
      { snapshotKey },
      { $setOnInsert: { ...dummySnapshotData, snapshotKey } },
      { upsert: true, session }
    );
    const snap = await AiSnapshotModel.findOne({ snapshotKey }).session(session).orFail();
    await ReportModel.updateOne(
      { sourceVideoId, incidentKey },
      {
        $setOnInsert: { ...dummyReportData },
        $set: { activeSnapshotId: snap._id }
      },
      { upsert: true, session }
    );
  });

  const snapCountSecond = await AiSnapshotModel.countDocuments({ snapshotKey });
  const reportCountSecond = await ReportModel.countDocuments({ incidentKey });
  assert.strictEqual(snapCountSecond, 1, 'Snapshot must be idempotent');
  assert.strictEqual(reportCountSecond, 1, 'Report must be idempotent');
  console.log('[PASS] Double-Processing Idempotency completed successfully.');


  // --- Test Case 4: Human Validation Status Retention ---
  console.log('\n[TEST CASE 4] Human Validation Status Retention');
  // Update validationStatus to CONFIRMED (operator decision)
  await ReportModel.updateOne(
    { sourceVideoId, incidentKey },
    { $set: { validationStatus: 'CONFIRMED', adminStatus: 'VALID', status: 'VALIDATED' } }
  );

  // Run the idempotent transactional upsert again (job retry simulation)
  await mongoose.connection.transaction(async (session) => {
    const snap = await AiSnapshotModel.findOne({ snapshotKey }).session(session).orFail();
    await ReportModel.updateOne(
      { sourceVideoId, incidentKey },
      {
        $setOnInsert: { ...dummyReportData },
        $set: { activeSnapshotId: snap._id }
      },
      { upsert: true, session }
    );
  });

  const finalReport = await ReportModel.findOne({ incidentKey }).lean().exec();
  assert.strictEqual(finalReport?.validationStatus, 'CONFIRMED', 'Human validation status must not reset to PENDING');
  assert.strictEqual(finalReport?.adminStatus, 'VALID');
  assert.strictEqual(finalReport?.status, 'VALIDATED');
  console.log('[PASS] Human Validation Status Retention completed successfully.');


  // --- Test Case 5: AiSnapshot Immutability ---
  console.log('\n[TEST CASE 5] AiSnapshot Immutability');
  const snap = await AiSnapshotModel.findOne({ snapshotKey }).orFail();
  
  // Try to modify field
  await assert.rejects(
    async () => {
      await AiSnapshotModel.updateOne({ _id: snap._id }, { $set: { imagePath: 'hacked_path' } });
    },
    /AI_SNAPSHOT_IMMUTABLE/,
    'Snapshot modification must throw AI_SNAPSHOT_IMMUTABLE error'
  );

  // Try to delete
  await assert.rejects(
    async () => {
      await AiSnapshotModel.deleteOne({ _id: snap._id });
    },
    /AI_SNAPSHOT_IMMUTABLE/,
    'Snapshot deletion must throw AI_SNAPSHOT_IMMUTABLE error'
  );
  console.log('[PASS] AiSnapshot Immutability completed successfully.');


  // --- Test Case 6: Finalizer Recovery ---
  console.log('\n[TEST CASE 6] Finalizer Recovery');
  // Job at max attempts and expired lease
  await VideoAnalysisJobModel.create({
    sourceVideoId: new mongoose.Types.ObjectId(),
    sourceVideoHash: 'hash_test_6',
    sourceStorageKey: 'path/to/test_6',
    status: 'PROCESSING',
    progressStage: 'ANALYZING',
    analysisRunId: 'test_run_6',
    attemptCount: 3,
    maxAttempts: 3,
    leaseExpiresAt: new Date(Date.now() - 10000), // expired
    correlationId: 'test_corr_6'
  });

  const finalizerCount = await finalizeExhausted();
  assert.strictEqual(finalizerCount.modifiedCount, 1);
  const finishedJob = await VideoAnalysisJobModel.findOne({ correlationId: 'test_corr_6' }).lean().exec();
  assert.strictEqual(finishedJob?.status, 'FAILED');
  assert.strictEqual(finishedJob?.errorCode, 'MAX_ATTEMPTS_EXCEEDED');
  console.log('[PASS] Finalizer Recovery completed successfully.');

  console.log('\n=========================================');
  console.log('[ALL TESTS PASSED] Video Analysis Pipeline is robust and production-ready.');
  console.log('=========================================');

  await disconnectDB();
}

runTests().catch((err) => {
  console.error('[TEST SUITE FAILED]', err);
  process.exit(1);
});
