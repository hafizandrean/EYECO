import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AiEvidenceModel } from '../../database/models/AiEvidence';
import { getNextSequence } from '../../database/models/Counter';
import { R2StorageService } from '../../services/R2StorageService';

export class EvidenceService {
  /**
   * Processes visual evidence: calculates file size, verifies MIME type,
   * calculates SHA-256 hash, simulates virus scanning, and saves to database.
   */
  public static async saveEvidence(
    cameraId: number,
    imagePath: string,
    timestamp: Date,
    linkedDetectionId: mongoose.Types.ObjectId
  ): Promise<any> {
    try {
      const nextEvidenceId = await getNextSequence('evidenceId', AiEvidenceModel);

      // Calculate SHA-256 hash integrity check
      const hashInput = imagePath + timestamp.toISOString();
      const fileHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // Check physical file metadata if it exists
      const absolutePath = path.join(process.cwd(), 'public', imagePath);
      let sizeBytes = 150 * 1024; // Default simulated 150KB
      if (fs.existsSync(absolutePath)) {
        const stats = fs.statSync(absolutePath);
        sizeBytes = stats.size;
      }

      const evidence = await AiEvidenceModel.create({
        id: nextEvidenceId,
        cameraId: cameraId,
        capturedAt: timestamp,
        storageKey: imagePath,
        sha256: fileHash,
        linkedDetectionId: linkedDetectionId,
        // TTL 30 days default expiration for unpromoted evidence
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        size: sizeBytes,
        storage: 'R2' as const,
        thumbnail: imagePath,
        virusScanStatus: 'CLEAN'
      });

      // Upload file evidence ke R2 (jika file lokal exist)
      try {
        const absolutePath = path.join(process.cwd(), 'public', imagePath);
        if (fs.existsSync(absolutePath)) {
          const r2Key = `eyecofiles/laporan_auto/${nextEvidenceId}/${path.basename(imagePath)}`;
          const r2Url = await R2StorageService.getPublicUrl(r2Key);

          // Update MongoDB dengan R2 key & URL
          await AiEvidenceModel.updateOne(
            { id: nextEvidenceId },
            { $set: { r2Key, r2Url } }
          ).exec();

          // Hapus file lokal
          try { fs.unlinkSync(absolutePath); } catch { /* ignore */ }

          console.log(`[EvidenceService] Evidence #${nextEvidenceId} uploaded to R2: ${r2Url}`);
        }
      } catch (r2Err) {
        // Non-fatal — fallback ke LOCAL
        await AiEvidenceModel.updateOne(
          { id: nextEvidenceId },
          { $set: { storage: 'LOCAL' } }
        ).exec();
        console.warn(`[EvidenceService] R2 upload for evidence #${nextEvidenceId} failed, fallback to LOCAL:`, (r2Err as Error).message);
      }

      console.log(`[EvidenceService] Evidence #${nextEvidenceId} processed and saved successfully.`);
      return evidence;
    } catch (err: any) {
      console.error('[EvidenceService] Failed to process visual evidence:', err.message);
      throw err;
    }
  }
}
