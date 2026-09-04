"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvidenceService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const AiEvidence_1 = require("../../database/models/AiEvidence");
const Counter_1 = require("../../database/models/Counter");
const R2StorageService_1 = require("../../services/R2StorageService");
const SpoolRetryWorker_1 = require("../../services/SpoolRetryWorker");
class EvidenceService {
    /**
     * Processes visual evidence using OS Temp -> SHA256 -> Deterministic Key -> R2 -> Deep Integrity -> DB -> Unlink OS Temp / Spool fallback.
     */
    static async saveEvidence(cameraId, imagePath, timestamp, linkedDetectionId, reportId) {
        try {
            const nextEvidenceId = await (0, Counter_1.getNextSequence)('evidenceId', AiEvidence_1.AiEvidenceModel);
            const mongoEvidenceId = new mongoose_1.default.Types.ObjectId();
            // Resolve physical file location (check OS temp / public / direct path)
            let absolutePath = path_1.default.isAbsolute(imagePath)
                ? imagePath
                : path_1.default.join(process.cwd(), 'public', imagePath.startsWith('/') ? imagePath.slice(1) : imagePath);
            if (!fs_1.default.existsSync(absolutePath)) {
                const tempPath = path_1.default.join(os_1.default.tmpdir(), 'eyeco', path_1.default.basename(imagePath));
                if (fs_1.default.existsSync(tempPath))
                    absolutePath = tempPath;
            }
            let sizeBytes = 150 * 1024;
            let fileHash = crypto_1.default.createHash('sha256').update(imagePath + timestamp.toISOString()).digest('hex');
            if (fs_1.default.existsSync(absolutePath)) {
                const buffer = fs_1.default.readFileSync(absolutePath);
                sizeBytes = buffer.length;
                fileHash = crypto_1.default.createHash('sha256').update(buffer).digest('hex');
            }
            const repIdStr = reportId ? String(reportId) : String(nextEvidenceId);
            const r2Key = R2StorageService_1.R2StorageService.getAutoReportKey(repIdStr, mongoEvidenceId.toString(), fileHash);
            let storageStatus = 'RETRY_WAIT';
            let r2Uploaded = false;
            // 1. Attempt R2 Upload & Deep Integrity Check
            if (fs_1.default.existsSync(absolutePath) && R2StorageService_1.R2StorageService.isConfigured()) {
                try {
                    await R2StorageService_1.R2StorageService.uploadFile(absolutePath, r2Key, {
                        contentType: 'image/jpeg',
                        sha256: fileHash,
                        evidenceId: mongoEvidenceId.toString(),
                        reportId: repIdStr
                    });
                    const integrity = await R2StorageService_1.R2StorageService.verifyObjectIntegrity(r2Key, sizeBytes, fileHash);
                    if (integrity.valid) {
                        r2Uploaded = true;
                        storageStatus = 'AVAILABLE';
                        console.log(`[EvidenceService] ✅ Evidence #${nextEvidenceId} uploaded & verified on R2: ${r2Key}`);
                    }
                }
                catch (r2Err) {
                    console.warn(`[EvidenceService] R2 upload/integrity check failed for #${nextEvidenceId}:`, r2Err.message);
                }
            }
            // 2. Create AiEvidence Document
            const evidence = await AiEvidence_1.AiEvidenceModel.create({
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
                    bucket: R2StorageService_1.R2StorageService.getBucket(),
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
                    if (fs_1.default.existsSync(absolutePath) && absolutePath.includes(os_1.default.tmpdir())) {
                        fs_1.default.unlinkSync(absolutePath);
                    }
                }
                catch (_) { }
            }
            else if (fs_1.default.existsSync(absolutePath)) {
                // Failure -> Copy to persistent spool for worker retry
                SpoolRetryWorker_1.SpoolRetryWorker.saveToSpool(absolutePath, repIdStr, mongoEvidenceId.toString(), r2Key, fileHash, 'image/jpeg');
            }
            console.log(`[EvidenceService] Evidence #${nextEvidenceId} saved successfully (status=${storageStatus}).`);
            return evidence;
        }
        catch (err) {
            console.error('[EvidenceService] Failed to process evidence:', err.message);
            throw err;
        }
    }
}
exports.EvidenceService = EvidenceService;
