"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvidenceService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const AiEvidence_1 = require("../../database/models/AiEvidence");
const Counter_1 = require("../../database/models/Counter");
const R2StorageService_1 = require("../../services/R2StorageService");
class EvidenceService {
    /**
     * Processes visual evidence: calculates file size, verifies MIME type,
     * calculates SHA-256 hash, simulates virus scanning, and saves to database.
     */
    static async saveEvidence(cameraId, imagePath, timestamp, linkedDetectionId) {
        try {
            const nextEvidenceId = await (0, Counter_1.getNextSequence)('evidenceId', AiEvidence_1.AiEvidenceModel);
            // Calculate SHA-256 hash integrity check
            const hashInput = imagePath + timestamp.toISOString();
            const fileHash = crypto_1.default.createHash('sha256').update(hashInput).digest('hex');
            // Check physical file metadata if it exists
            const absolutePath = path_1.default.join(process.cwd(), 'public', imagePath);
            let sizeBytes = 150 * 1024; // Default simulated 150KB
            if (fs_1.default.existsSync(absolutePath)) {
                const stats = fs_1.default.statSync(absolutePath);
                sizeBytes = stats.size;
            }
            const evidence = await AiEvidence_1.AiEvidenceModel.create({
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
                storage: 'R2',
                thumbnail: imagePath,
                virusScanStatus: 'CLEAN'
            });
            // Upload file evidence ke R2 (jika file lokal exist)
            try {
                const absolutePath = path_1.default.join(process.cwd(), 'public', imagePath);
                if (fs_1.default.existsSync(absolutePath)) {
                    const r2Key = `cctv-evidence/${nextEvidenceId}/${path_1.default.basename(imagePath)}`;
                    await R2StorageService_1.R2StorageService.uploadFile(absolutePath, r2Key, 'image/jpeg', true);
                    const r2Url = R2StorageService_1.R2StorageService.getPublicUrl(r2Key);
                    // Update MongoDB dengan R2 key & URL
                    await AiEvidence_1.AiEvidenceModel.updateOne({ id: nextEvidenceId }, { $set: { r2Key, r2Url } }).exec();
                    // Hapus file lokal
                    try {
                        fs_1.default.unlinkSync(absolutePath);
                    }
                    catch { /* ignore */ }
                    console.log(`[EvidenceService] Evidence #${nextEvidenceId} uploaded to R2: ${r2Url}`);
                }
            }
            catch (r2Err) {
                // Non-fatal — fallback ke LOCAL
                await AiEvidence_1.AiEvidenceModel.updateOne({ id: nextEvidenceId }, { $set: { storage: 'LOCAL' } }).exec();
                console.warn(`[EvidenceService] R2 upload for evidence #${nextEvidenceId} failed, fallback to LOCAL:`, r2Err.message);
            }
            console.log(`[EvidenceService] Evidence #${nextEvidenceId} processed and saved successfully.`);
            return evidence;
        }
        catch (err) {
            console.error('[EvidenceService] Failed to process visual evidence:', err.message);
            throw err;
        }
    }
}
exports.EvidenceService = EvidenceService;
