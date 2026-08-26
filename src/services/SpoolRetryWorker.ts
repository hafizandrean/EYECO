import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { R2StorageService } from './R2StorageService';
import { AiEvidenceModel } from '../database/models/AiEvidence';
import { ReportModel } from '../database/models/Report';

export interface SpoolJobManifest {
  jobId: string;
  evidenceId: string;
  reportId: string;
  r2Key: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  status: 'PENDING' | 'RETRY_WAIT' | 'FAILED' | 'AVAILABLE';
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string;
  lastErrorCode?: string;
  spoolFilePath: string;
  manifestFilePath: string;
}

export class SpoolRetryWorker {
  private static readonly SPOOL_DIR_NAME = 'eyeco-storage-spool';
  private static readonly MAX_ATTEMPTS = 5;
  private static isProcessing = false;

  public static getSpoolDir(): string {
    const customDir = process.env.EYECO_SPOOL_DIR;
    const baseDir = customDir && customDir.trim() ? customDir : os.tmpdir();
    const spoolDir = path.join(baseDir, this.SPOOL_DIR_NAME);
    if (!fs.existsSync(spoolDir)) {
      fs.mkdirSync(spoolDir, { recursive: true });
    }
    return spoolDir;
  }

  public static getSpoolSize(): number {
    const spoolDir = this.getSpoolDir();
    let totalSize = 0;
    try {
      const files = fs.readdirSync(spoolDir);
      for (const file of files) {
        const fullPath = path.join(spoolDir, file);
        if (fs.existsSync(fullPath)) {
          totalSize += fs.statSync(fullPath).size;
        }
      }
    } catch (_) {}
    return totalSize;
  }

  public static getMaxCapacityBytes(): number {
    const raw = process.env.EYECO_SPOOL_MAX_BYTES;
    if (raw && !isNaN(parseInt(raw))) {
      return parseInt(raw);
    }
    return 5 * 1024 * 1024 * 1024; // 5 GB Capacity Limit
  }

  /**
   * Save failed capture file + sidecar job.json manifest into persistent local spool.
   */
  public static saveToSpool(
    sourceFilePath: string,
    reportId: string,
    evidenceId: string,
    r2Key: string,
    sha256: string,
    mimeType = 'image/jpeg'
  ): SpoolJobManifest | null {
    try {
      if (!fs.existsSync(sourceFilePath)) {
        console.warn(`[SpoolRetryWorker] Source file missing, cannot spool: ${sourceFilePath}`);
        return null;
      }

      // Enforce capacity guardrail
      const fileSize = fs.statSync(sourceFilePath).size;
      const currentSpoolSize = this.getSpoolSize();
      const maxCapacity = this.getMaxCapacityBytes();
      if (currentSpoolSize + fileSize > maxCapacity) {
        console.error(`[SpoolRetryWorker ⚠️ CAPACITY EXCEEDED] Spool directory reached max ${maxCapacity} bytes quota. Purging oldest failed jobs...`);
        this.purgeOldestFailedJobs();
      }

      const spoolDir = this.getSpoolDir();
      const jobId = `job_${evidenceId}_${Date.now()}`;
      const ext = path.extname(sourceFilePath) || '.jpg';
      const spoolFilePath = path.join(spoolDir, `${jobId}${ext}`);
      const manifestFilePath = path.join(spoolDir, `${jobId}.json`);

      // Copy physical image file
      fs.copyFileSync(sourceFilePath, spoolFilePath);

      const manifest: SpoolJobManifest = {
        jobId,
        evidenceId,
        reportId,
        r2Key,
        sha256,
        mimeType,
        sizeBytes: fileSize,
        createdAt: new Date().toISOString(),
        status: 'RETRY_WAIT',
        attemptCount: 0,
        maxAttempts: this.MAX_ATTEMPTS,
        nextRetryAt: new Date(Date.now() + 10_000).toISOString(),
        spoolFilePath,
        manifestFilePath
      };

      fs.writeFileSync(manifestFilePath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(`[SpoolRetryWorker] Persistent spool job created: ${jobId} -> ${spoolFilePath}`);
      return manifest;
    } catch (err: any) {
      console.error('[SpoolRetryWorker] Failed to write to spool:', err.message);
      return null;
    }
  }

  /**
   * Background process retry loop for persisted spool jobs.
   */
  public static async processSpool(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, succeeded: 0, failed: 0 };
    this.isProcessing = true;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const spoolDir = this.getSpoolDir();
      const files = fs.readdirSync(spoolDir);
      const manifestFiles = files.filter(f => f.endsWith('.json'));

      const now = new Date();

      for (const mFile of manifestFiles) {
        const manifestPath = path.join(spoolDir, mFile);
        if (!fs.existsSync(manifestPath)) continue;

        let manifest: SpoolJobManifest;
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (_) {
          continue;
        }

        // Check backoff time & max attempts guardrail
        const nextRetryDate = new Date(manifest.nextRetryAt);
        if (manifest.status === 'FAILED' || manifest.attemptCount >= manifest.maxAttempts) {
          manifest.status = 'FAILED';
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          continue;
        }

        if (nextRetryDate > now) {
          continue; // Waiting for backoff timer
        }

        processed++;
        manifest.attemptCount += 1;

        const success = await this.retryJob(manifest);
        if (success) {
          succeeded++;
          // Clean up spool file and manifest sidecar upon success
          try {
            if (fs.existsSync(manifest.spoolFilePath)) fs.unlinkSync(manifest.spoolFilePath);
            if (fs.existsSync(manifest.manifestFilePath)) fs.unlinkSync(manifest.manifestFilePath);
          } catch (_) {}
        } else {
          failed++;
          // Calculate exponential backoff: 10s * 2^attempt
          const backoffDelay = Math.min(300_000, 10_000 * Math.pow(2, manifest.attemptCount));
          manifest.nextRetryAt = new Date(Date.now() + backoffDelay).toISOString();

          if (manifest.attemptCount >= manifest.maxAttempts) {
            manifest.status = 'FAILED';
            console.error(`[SpoolRetryWorker ❌ EXHAUSTED] Job ${manifest.jobId} reached max attempts (${manifest.maxAttempts}). Marked as FAILED.`);
            // Update DB status to FAILED
            await this.markEvidenceFailedInDb(manifest);
          } else {
            manifest.status = 'RETRY_WAIT';
          }

          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        }
      }
    } catch (err: any) {
      console.error('[SpoolRetryWorker] Spool processing error:', err.message);
    } finally {
      this.isProcessing = false;
    }

    return { processed, succeeded, failed };
  }

  /**
   * Attempts to upload spool file to R2 with HEAD fast-check (skips R2 upload if object already exists and SHA matches).
   */
  private static async retryJob(manifest: SpoolJobManifest): Promise<boolean> {
    try {
      console.log(`[SpoolRetryWorker] Retrying job ${manifest.jobId} (attempt #${manifest.attemptCount}/${manifest.maxAttempts})...`);

      // 1. Fast HEAD Check: Skip R2 upload if object already exists on R2 with matching size & SHA-256
      let r2Ready = false;
      if (R2StorageService.isConfigured()) {
        const check = await R2StorageService.verifyObjectIntegrity(manifest.r2Key, manifest.sizeBytes, manifest.sha256);
        if (check.valid) {
          console.log(`[SpoolRetryWorker ⚡ FAST RETRY] Object already exists on R2 with valid SHA-256 (${manifest.r2Key}). Skipping R2 upload.`);
          r2Ready = true;
        } else if (fs.existsSync(manifest.spoolFilePath)) {
          // Upload to Cloudflare R2
          await R2StorageService.uploadFile(manifest.spoolFilePath, manifest.r2Key, {
            contentType: manifest.mimeType,
            sha256: manifest.sha256,
            evidenceId: manifest.evidenceId,
            reportId: manifest.reportId
          });

          // Post-upload HEAD Verification
          const postCheck = await R2StorageService.verifyObjectIntegrity(manifest.r2Key, manifest.sizeBytes, manifest.sha256);
          if (postCheck.valid) {
            r2Ready = true;
          } else {
            manifest.lastErrorCode = 'R2 integrity check failed post-upload.';
          }
        }
      } else {
        // Fallback for offline/local development mode
        r2Ready = true;
      }

      if (!r2Ready) return false;

      // 2. Persist / Update Database to AVAILABLE
      let evidenceObjectId: mongoose.Types.ObjectId;
      try {
        evidenceObjectId = new mongoose.Types.ObjectId(manifest.evidenceId);
      } catch (_) {
        evidenceObjectId = new mongoose.Types.ObjectId();
      }

      const reportIdNum = parseInt(manifest.reportId);
      let reportDoc: any = null;
      if (!isNaN(reportIdNum)) {
        reportDoc = await ReportModel.findOne({ id: reportIdNum }).exec();
      }
      if (!reportDoc && mongoose.Types.ObjectId.isValid(manifest.reportId)) {
        reportDoc = await ReportModel.findById(manifest.reportId).exec();
      }

      // Upsert AiEvidence document
      await AiEvidenceModel.updateOne(
        { _id: evidenceObjectId },
        {
          $set: {
            storageKey: manifest.r2Key,
            sha256: manifest.sha256,
            reportId: reportDoc ? reportDoc._id : null,
            'storage.provider': 'R2',
            'storage.bucket': R2StorageService.getBucket(),
            'storage.key': manifest.r2Key,
            'storage.size': manifest.sizeBytes,
            'storage.contentType': manifest.mimeType,
            'storage.sha256': manifest.sha256,
            'storage.uploadedAt': new Date(),
            'storage.status': 'AVAILABLE'
          }
        },
        { upsert: true }
      ).exec();

      // Update Report relationships using $addToSet (do NOT overwrite evidenceIds array or force thumbnail)
      if (reportDoc) {
        const updateOps: any = {
          $addToSet: { evidenceIds: evidenceObjectId }
        };
        if (!reportDoc.primaryEvidenceId) {
          updateOps.$set = { primaryEvidenceId: evidenceObjectId };
        }
        await ReportModel.updateOne({ _id: reportDoc._id }, updateOps).exec();
      }

      console.log(`[SpoolRetryWorker ✅ SUCCESS] Job ${manifest.jobId} recovered successfully.`);
      return true;
    } catch (err: any) {
      manifest.lastErrorCode = err.message;
      console.warn(`[SpoolRetryWorker] Retry attempt #${manifest.attemptCount} failed for ${manifest.jobId}:`, err.message);
      return false;
    }
  }

  private static async markEvidenceFailedInDb(manifest: SpoolJobManifest): Promise<void> {
    try {
      if (mongoose.Types.ObjectId.isValid(manifest.evidenceId)) {
        await AiEvidenceModel.updateOne(
          { _id: manifest.evidenceId },
          { $set: { 'storage.status': 'FAILED' } }
        ).exec();
      }
    } catch (_) {}
  }

  private static purgeOldestFailedJobs(): void {
    try {
      const spoolDir = this.getSpoolDir();
      const files = fs.readdirSync(spoolDir);
      const manifestFiles = files.filter(f => f.endsWith('.json'));

      const manifests: SpoolJobManifest[] = [];
      for (const mFile of manifestFiles) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(spoolDir, mFile), 'utf8'));
          manifests.push(m);
        } catch (_) {}
      }

      manifests.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      for (const m of manifests) {
        if (m.status === 'FAILED' || m.attemptCount >= m.maxAttempts) {
          try {
            if (fs.existsSync(m.spoolFilePath)) fs.unlinkSync(m.spoolFilePath);
            if (fs.existsSync(m.manifestFilePath)) fs.unlinkSync(m.manifestFilePath);
            console.log(`[SpoolRetryWorker 🧹 PURGE] Purged old failed spool job: ${m.jobId}`);
          } catch (_) {}
          break;
        }
      }
    } catch (_) {}
  }
}
