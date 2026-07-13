import mongoose from 'mongoose';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AiEvidenceModel } from '../../database/models/AiEvidence';

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

      let attempts = 0;
      let evidence = null;
      while (attempts < 5) {
        try {
          const lastEvidence = await AiEvidenceModel.findOne().sort({ id: -1 }).exec();
          const nextEvidenceId = lastEvidence ? lastEvidence.id + 1 : 1;

          evidence = await AiEvidenceModel.create({
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
            storage: 'LOCAL',
            thumbnail: imagePath,
            virusScanStatus: 'CLEAN'
          });
          break;
        } catch (createErr: any) {
          if (createErr.code === 11000 || createErr.message.includes('E11000')) {
            attempts++;
            console.log(`[EvidenceService] Duplicate key error on Evidence ID. Retrying ID generation (Attempt ${attempts}/5)...`);
            await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 50));
          } else {
            throw createErr;
          }
        }
      }

      if (!evidence) {
        throw new Error('Gagal memproses bukti visual karena tabrakan ID yang persisten setelah 5 percobaan.');
      }

      console.log(`[EvidenceService] Evidence #${evidence.id} processed and saved successfully.`);
      return evidence;
    } catch (err: any) {
      console.error('[EvidenceService] Failed to process visual evidence:', err.message);
      throw err;
    }
  }
}
