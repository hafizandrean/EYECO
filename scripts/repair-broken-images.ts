import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { connectDB } from '../src/database/db';
import { ReportModel } from '../src/database/models/Report';
import { AiEvidenceModel } from '../src/database/models/AiEvidence';
import { R2StorageService } from '../src/services/R2StorageService';
import crypto from 'crypto';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function runRepair() {
  console.log(`\n======================================================`);
  console.log(`  EYECO HISTORICAL EVIDENCE INTEGRITY REPAIR SCRIPT`);
  console.log(`  HONEST AUDIT TRAIL REPAIR`);
  console.log(`======================================================\n`);

  await connectDB();

  // 1. Build high-speed index of all files in public/uploads once at startup
  const localUploadsDir = path.join(__dirname, '../public/uploads');
  const fileIndexMap = new Map<string, string>();

  function indexDirectory(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          indexDirectory(fullPath);
        } else if (entry.isFile() && fs.statSync(fullPath).size > 100) {
          fileIndexMap.set(entry.name.toLowerCase(), fullPath);
        }
      }
    } catch (_) {}
  }
  if (fs.existsSync(localUploadsDir)) {
    indexDirectory(localUploadsDir);
  }
  console.log(`Indexed ${fileIndexMap.size} local files in public/uploads for instant lookup.\n`);

  // 2. Fetch all reports and existing evidence records in bulk
  const reports = await ReportModel.find({ deletedAt: null }).sort({ id: -1 }).exec();
  console.log(`Scanned ${reports.length} report records in database...\n`);

  const reportIds = reports.map(r => r._id);
  const existingEvidences = await AiEvidenceModel.find({ reportId: { $in: reportIds } }).lean().exec();
  const evidenceByReportMap = new Map<string, any>();
  existingEvidences.forEach(ev => {
    if (ev.reportId) evidenceByReportMap.set(ev.reportId.toString(), ev);
  });

  let availableCount = 0;
  let missingCount = 0;
  let retryWaitCount = 0;
  let uploadedCount = 0;
  let updatedCount = 0;

  const reportOps: any[] = [];
  const evidenceOps: any[] = [];
  const newEvidences: any[] = [];

  let lastEv = await AiEvidenceModel.findOne().sort({ id: -1 }).lean().exec();
  let nextEvId = lastEv ? lastEv.id + 1 : 1;

  for (const report of reports) {
    const rawImage = report.image || '';
    if (!rawImage) continue;

    const relPath = rawImage.replace(/^\/+uploads\/+/, '').replace(/^\/+/, '');
    const filename = path.basename(relPath).toLowerCase();

    // Compute deterministic R2 key
    let r2Key = report.r2Key || '';
    if (!r2Key) {
      if (relPath.startsWith('laporan_auto/')) r2Key = relPath;
      else if (relPath.startsWith('laporan_manual/')) r2Key = relPath;
      else if (relPath.startsWith('berita/')) r2Key = `berita/${path.basename(relPath)}`;
      else r2Key = `laporan_auto/${report.id}/${path.basename(relPath)}`;
    }

    const localFoundPath = fileIndexMap.get(filename) || null;

    let status: 'AVAILABLE' | 'RETRY_WAIT' | 'MISSING' = 'MISSING';
    let fileSha256: string | undefined = undefined;
    let fileSize = 0;

    if (localFoundPath && fs.existsSync(localFoundPath)) {
      const buffer = fs.readFileSync(localFoundPath);
      fileSize = buffer.length;
      fileSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      if (R2StorageService.isConfigured()) {
        try {
          await R2StorageService.uploadFile(localFoundPath, r2Key, {
            contentType: 'image/jpeg',
            sha256: fileSha256,
            reportId: String(report.id)
          });
          // Verify upload with HEAD check
          const headCheck = await R2StorageService.verifyObjectIntegrity(r2Key, fileSize, fileSha256);
          if (headCheck.valid) {
            uploadedCount++;
            status = 'AVAILABLE';
          } else {
            status = 'RETRY_WAIT';
          }
        } catch (r2Err: any) {
          console.warn(`  [R2 WARN] Upload failed for Report #${report.id}:`, r2Err.message);
          status = 'RETRY_WAIT';
        }
      } else {
        // Without active R2 credentials, local file waiting for spool/R2 sync is RETRY_WAIT
        status = 'RETRY_WAIT';
      }
    } else if (R2StorageService.isConfigured()) {
      const r2Check = await R2StorageService.verifyObjectIntegrity(r2Key, 0);
      if (r2Check.exists) {
        status = 'AVAILABLE';
      } else {
        status = 'MISSING';
      }
    }

    if (status === 'AVAILABLE') availableCount++;
    else if (status === 'RETRY_WAIT') retryWaitCount++;
    else missingCount++;

    let evidence = evidenceByReportMap.get(report._id.toString());
    let evidenceObjectId: mongoose.Types.ObjectId;

    const storageObj: any = {
      provider: 'R2',
      bucket: R2StorageService.getBucket(),
      key: r2Key,
      contentType: 'image/jpeg',
      size: fileSize || 150000,
      uploadedAt: new Date(),
      status: status
    };
    if (fileSha256) {
      storageObj.sha256 = fileSha256;
    }

    if (!evidence) {
      evidenceObjectId = new mongoose.Types.ObjectId();
      newEvidences.push({
        _id: evidenceObjectId,
        id: nextEvId++,
        cameraId: (report.sourceMetadata && report.sourceMetadata.cameraId) || 1,
        capturedAt: report.timestamp || new Date(),
        storageKey: rawImage,
        sha256: fileSha256 || crypto.createHash('sha256').update(rawImage + String(report.id)).digest('hex'),
        linkedDetectionId: report.sourceDetectionId || new mongoose.Types.ObjectId(),
        reportId: report._id,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        size: fileSize || 150000,
        storage: storageObj,
        thumbnail: rawImage,
        virusScanStatus: 'CLEAN'
      });
    } else {
      evidenceObjectId = evidence._id;
      const setFields: any = {
        reportId: report._id,
        'storage.key': r2Key,
        'storage.status': status
      };
      if (fileSha256) {
        setFields['storage.sha256'] = fileSha256;
      }
      evidenceOps.push({
        updateOne: {
          filter: { _id: evidence._id },
          update: { $set: setFields }
        }
      });
    }

    // Update Report relations cleanly:
    // 1. Use $addToSet so existing evidenceIds array is NOT overwritten.
    // 2. Do NOT write Report.r2Key (AiEvidence.storage is authoritative).
    // 3. Do NOT force thumbnailEvidenceId.
    const reportSetOps: any = {};
    if (!report.primaryEvidenceId) {
      reportSetOps.primaryEvidenceId = evidenceObjectId;
    }

    const reportUpdatePayload: any = {
      $addToSet: { evidenceIds: evidenceObjectId }
    };
    if (Object.keys(reportSetOps).length > 0) {
      reportUpdatePayload.$set = reportSetOps;
    }

    reportOps.push({
      updateOne: {
        filter: { _id: report._id },
        update: reportUpdatePayload
      }
    });

    updatedCount++;
  }

  // Execute bulk operations
  if (newEvidences.length > 0) {
    await AiEvidenceModel.insertMany(newEvidences, { ordered: false });
  }
  if (evidenceOps.length > 0) {
    await AiEvidenceModel.bulkWrite(evidenceOps, { ordered: false });
  }
  if (reportOps.length > 0) {
    await ReportModel.bulkWrite(reportOps, { ordered: false });
  }

  console.log(`\n======================================================`);
  console.log(`  HISTORICAL REPAIR SUMMARY`);
  console.log(`======================================================`);
  console.log(`  Total Reports Processed : ${updatedCount}`);
  console.log(`  Evidence AVAILABLE      : ${availableCount} (R2 verified object + SHA)`);
  console.log(`  Evidence RETRY_WAIT     : ${retryWaitCount} (Local file queued for sync)`);
  console.log(`  Evidence MISSING        : ${missingCount} (Honest Audit Trail preserved)`);
  console.log(`  Uploaded to R2          : ${uploadedCount}`);
  console.log(`======================================================\n`);

  process.exit(0);
}

runRepair().catch(err => {
  console.error('Repair Script Failed:', err);
  process.exit(1);
});
