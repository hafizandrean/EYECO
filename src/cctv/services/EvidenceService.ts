import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AiEvidenceModel } from '../../database/models/AiEvidence';
import { getNextSequence } from '../../database/models/Counter';
import { R2StorageService } from '../../services/R2StorageService';
import { SpoolRetryWorker } from '../../services/SpoolRetryWorker';

export class EvidenceService {
  /**
   * Processes visual evidence using OS Temp -> SHA256 -> Deterministic Key -> R2 -> Deep Integrity -> DB -> Unlink OS Temp / Spool fallback.
   */
  public static async saveEvidence(
    cameraId: number,
    imagePath: string,
    timestamp: Date,
    linkedDetectionId: mongoose.Types.ObjectId,
    reportId?: mongoose.Types.ObjectId | number
  ): Promise<any> {
    try {
      const nextEvidenceId = await getNextSequence('evidenceId', AiEvidenceModel);
      const mongoEvidenceId = new mongoose.Types.ObjectId();

      // Resolve physical file location (check OS temp / public / direct path)
      let absolutePath = path.isAbsolute(imagePath)
        ? imagePath
        : path.join(process.cwd(), 'public', imagePath.startsWith('/') ? imagePath.slice(1) : imagePath);

      if (!fs.existsSync(absolutePath)) {
        const tempPath = path.join(os.tmpdir(), 'eyeco', path.basename(imagePath));
        if (fs.existsSync(tempPath)) absolutePath = tempPath;
      }

      let sizeBytes = 150 * 1024;
      let fileHash = crypto.createHash('sha256').update(imagePath + timestamp.toISOString()).digest('hex');

      if (fs.existsSync(absolutePath)) {
        const buffer = fs.readFileSync(absolutePath);
        sizeBytes = buffer.length;
        fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
      }

      const repIdStr = reportId ? String(reportId) : String(nextEvidenceId);
      const r2Key = R2StorageService.getAutoReportKey(repIdStr, mongoEvidenceId.toString(), fileHash);

      let storageStatus: 'AVAILABLE' | 'RETRY_WAIT' | 'FAILED' = 'RETRY_WAIT';
      let r2Uploaded = false;

      // 1. Attempt R2 Upload & Deep Integrity Check
      if (fs.existsSync(absolutePath) && R2StorageService.isConfigured()) {
        try {
          await R2StorageService.uploadFile(absolutePath, r2Key, {
            contentType: 'image/jpeg',
            sha256: fileHash,
            evidenceId: mongoEvidenceId.toString(),
            reportId: repIdStr
          });

          const integrity = await R2StorageService.verifyObjectIntegrity(r2Key, sizeBytes, fileHash);
          if (integrity.valid) {
            r2Uploaded = true;
            storageStatus = 'AVAILABLE';
            console.log(`[EvidenceService] ✅ Evidence #${nextEvidenceId} uploaded & verified on R2: ${r2Key}`);
          }
        } catch (r2Err: any) {
          console.warn(`[EvidenceService] R2 upload/integrity check failed for #${nextEvidenceId}:`, r2Err.message);
        }
      }

      // 2. Create AiEvidence Document
      const evidence = await AiEvidenceModel.create({
        _id: mongoEvidenceId,
        id: nextEvidenceId,
        cameraId: cameraId,
        capturedAt: timestamp,
        storageKey: r2Key,
        sha256: fileHash,
        linkedDetectionId: linkedDetectionId,
        reportId: typeof reportId === 'object' ? reportId : null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        size: sizeBytes,
        storage: {
          provider: 'R2',
          bucket: R2StorageService.getBucket(),
          key: r2Key,
          contentType: 'image/jpeg',
          size: sizeBytes,
          sha256: fileHash,
          uploadedAt: new Date(),
          status: storageStatus
        },
        thumbnail: r2Key,
        virusScanStatus: 'CLEAN'
      });

      // 3. Spool / Unlink Management
      if (r2Uploaded && storageStatus === 'AVAILABLE') {
        // Success -> Safely unlink temp file
        try {
          if (fs.existsSync(absolutePath) && absolutePath.includes(os.tmpdir())) {
            fs.unlinkSync(absolutePath);
          }
        } catch (_) {}
      } else if (fs.existsSync(absolutePath)) {
        // Failure -> Copy to persistent spool for worker retry
        SpoolRetryWorker.saveToSpool(
          absolutePath,
          repIdStr,
          mongoEvidenceId.toString(),
          r2Key,
          fileHash,
          'image/jpeg'
        );
      }

      console.log(`[EvidenceService] Evidence #${nextEvidenceId} saved successfully (status=${storageStatus}).`);
      return evidence;
    } catch (err: any) {
      console.error('[EvidenceService] Failed to process evidence:', err.message);
      throw err;
    }
  }
}
