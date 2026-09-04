"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpoolRetryWorker = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const mongoose_1 = __importDefault(require("mongoose"));
const R2StorageService_1 = require("./R2StorageService");
const AiEvidence_1 = require("../database/models/AiEvidence");
const Report_1 = require("../database/models/Report");
class SpoolRetryWorker {
    static SPOOL_DIR_NAME = 'eyeco-storage-spool';
    static MAX_ATTEMPTS = 5;
    static isProcessing = false;
    static getSpoolDir() {
        const customDir = process.env.EYECO_SPOOL_DIR;
        const baseDir = customDir && customDir.trim() ? customDir : os_1.default.tmpdir();
        const spoolDir = path_1.default.join(baseDir, this.SPOOL_DIR_NAME);
        if (!fs_1.default.existsSync(spoolDir)) {
            fs_1.default.mkdirSync(spoolDir, { recursive: true });
        }
        return spoolDir;
    }
    static getSpoolSize() {
        const spoolDir = this.getSpoolDir();
        let totalSize = 0;
        try {
            const files = fs_1.default.readdirSync(spoolDir);
            for (const file of files) {
                const fullPath = path_1.default.join(spoolDir, file);
                if (fs_1.default.existsSync(fullPath)) {
                    totalSize += fs_1.default.statSync(fullPath).size;
                }
            }
        }
        catch (_) { }
        return totalSize;
    }
    static getMaxCapacityBytes() {
        const raw = process.env.EYECO_SPOOL_MAX_BYTES;
        if (raw && !isNaN(parseInt(raw))) {
            return parseInt(raw);
        }
        return 5 * 1024 * 1024 * 1024; // 5 GB Capacity Limit
    }
    /**
     * Save failed capture file + sidecar job.json manifest into persistent local spool.
     */
    static saveToSpool(sourceFilePath, reportId, evidenceId, r2Key, sha256, mimeType = 'image/jpeg') {
        try {
            if (!fs_1.default.existsSync(sourceFilePath)) {
                console.warn(`[SpoolRetryWorker] Source file missing, cannot spool: ${sourceFilePath}`);
                return null;
            }
            // Enforce capacity guardrail
            const fileSize = fs_1.default.statSync(sourceFilePath).size;
            const currentSpoolSize = this.getSpoolSize();
            const maxCapacity = this.getMaxCapacityBytes();
            if (currentSpoolSize + fileSize > maxCapacity) {
                console.error(`[SpoolRetryWorker ⚠️ CAPACITY EXCEEDED] Spool directory reached max ${maxCapacity} bytes quota. Purging oldest failed jobs...`);
                this.purgeOldestFailedJobs();
            }
            const spoolDir = this.getSpoolDir();
            const jobId = `job_${evidenceId}_${Date.now()}`;
            const ext = path_1.default.extname(sourceFilePath) || '.jpg';
            const spoolFilePath = path_1.default.join(spoolDir, `${jobId}${ext}`);
            const manifestFilePath = path_1.default.join(spoolDir, `${jobId}.json`);
            // Copy physical image file
            fs_1.default.copyFileSync(sourceFilePath, spoolFilePath);
            const manifest = {
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
            fs_1.default.writeFileSync(manifestFilePath, JSON.stringify(manifest, null, 2), 'utf8');
            console.log(`[SpoolRetryWorker] Persistent spool job created: ${jobId} -> ${spoolFilePath}`);
            return manifest;
        }
        catch (err) {
            console.error('[SpoolRetryWorker] Failed to write to spool:', err.message);
            return null;
        }
    }
    /**
     * Background process retry loop for persisted spool jobs.
     */
    static async processSpool() {
        if (this.isProcessing)
            return { processed: 0, succeeded: 0, failed: 0 };
        this.isProcessing = true;
        let processed = 0;
        let succeeded = 0;
        let failed = 0;
        try {
            const spoolDir = this.getSpoolDir();
            const files = fs_1.default.readdirSync(spoolDir);
            const manifestFiles = files.filter(f => f.endsWith('.json'));
            const now = new Date();
            for (const mFile of manifestFiles) {
                const manifestPath = path_1.default.join(spoolDir, mFile);
                if (!fs_1.default.existsSync(manifestPath))
                    continue;
                let manifest;
                try {
                    manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, 'utf8'));
                }
                catch (_) {
                    continue;
                }
                // Check backoff time & max attempts guardrail
                const nextRetryDate = new Date(manifest.nextRetryAt);
                if (manifest.status === 'FAILED' || manifest.attemptCount >= manifest.maxAttempts) {
                    manifest.status = 'FAILED';
                    fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
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
                        if (fs_1.default.existsSync(manifest.spoolFilePath))
                            fs_1.default.unlinkSync(manifest.spoolFilePath);
                        if (fs_1.default.existsSync(manifest.manifestFilePath))
                            fs_1.default.unlinkSync(manifest.manifestFilePath);
                    }
                    catch (_) { }
                }
                else {
                    failed++;
                    // Calculate exponential backoff: 10s * 2^attempt
                    const backoffDelay = Math.min(300_000, 10_000 * Math.pow(2, manifest.attemptCount));
                    manifest.nextRetryAt = new Date(Date.now() + backoffDelay).toISOString();
                    if (manifest.attemptCount >= manifest.maxAttempts) {
                        manifest.status = 'FAILED';
                        console.error(`[SpoolRetryWorker ❌ EXHAUSTED] Job ${manifest.jobId} reached max attempts (${manifest.maxAttempts}). Marked as FAILED.`);
                        // Update DB status to FAILED
                        await this.markEvidenceFailedInDb(manifest);
                    }
                    else {
                        manifest.status = 'RETRY_WAIT';
                    }
                    fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
                }
            }
        }
        catch (err) {
            console.error('[SpoolRetryWorker] Spool processing error:', err.message);
        }
        finally {
            this.isProcessing = false;
        }
        return { processed, succeeded, failed };
    }
    /**
     * Attempts to upload spool file to R2 with HEAD fast-check (skips R2 upload if object already exists and SHA matches).
     */
    static async retryJob(manifest) {
        try {
            console.log(`[SpoolRetryWorker] Retrying job ${manifest.jobId} (attempt #${manifest.attemptCount}/${manifest.maxAttempts})...`);
            // 1. Fast HEAD Check: Skip R2 upload if object already exists on R2 with matching size & SHA-256
            let r2Ready = false;
            if (R2StorageService_1.R2StorageService.isConfigured()) {
                const check = await R2StorageService_1.R2StorageService.verifyObjectIntegrity(manifest.r2Key, manifest.sizeBytes, manifest.sha256);
                if (check.valid) {
                    console.log(`[SpoolRetryWorker ⚡ FAST RETRY] Object already exists on R2 with valid SHA-256 (${manifest.r2Key}). Skipping R2 upload.`);
                    r2Ready = true;
                }
                else if (fs_1.default.existsSync(manifest.spoolFilePath)) {
                    // Upload to Cloudflare R2
                    await R2StorageService_1.R2StorageService.uploadFile(manifest.spoolFilePath, manifest.r2Key, {
                        contentType: manifest.mimeType,
                        sha256: manifest.sha256,
                        evidenceId: manifest.evidenceId,
                        reportId: manifest.reportId
                    });
                    // Post-upload HEAD Verification
                    const postCheck = await R2StorageService_1.R2StorageService.verifyObjectIntegrity(manifest.r2Key, manifest.sizeBytes, manifest.sha256);
                    if (postCheck.valid) {
                        r2Ready = true;
                    }
                    else {
                        manifest.lastErrorCode = 'R2 integrity check failed post-upload.';
                    }
                }
            }
            else {
                // Fallback for offline/local development mode
                r2Ready = true;
            }
            if (!r2Ready)
                return false;
            // 2. Persist / Update Database to AVAILABLE
            let evidenceObjectId;
            try {
                evidenceObjectId = new mongoose_1.default.Types.ObjectId(manifest.evidenceId);
            }
            catch (_) {
                evidenceObjectId = new mongoose_1.default.Types.ObjectId();
            }
            const reportIdNum = parseInt(manifest.reportId);
            let reportDoc = null;
            if (!isNaN(reportIdNum)) {
                reportDoc = await Report_1.ReportModel.findOne({ id: reportIdNum }).exec();
            }
            if (!reportDoc && mongoose_1.default.Types.ObjectId.isValid(manifest.reportId)) {
                reportDoc = await Report_1.ReportModel.findById(manifest.reportId).exec();
            }
            // Upsert AiEvidence document
            await AiEvidence_1.AiEvidenceModel.updateOne({ _id: evidenceObjectId }, {
                $set: {
                    storageKey: manifest.r2Key,
                    sha256: manifest.sha256,
                    reportId: reportDoc ? reportDoc._id : null,
                    'storage.provider': 'R2',
                    'storage.bucket': R2StorageService_1.R2StorageService.getBucket(),
                    'storage.key': manifest.r2Key,
                    'storage.size': manifest.sizeBytes,
                    'storage.contentType': manifest.mimeType,
                    'storage.sha256': manifest.sha256,
                    'storage.uploadedAt': new Date(),
                    'storage.status': 'AVAILABLE'
                }
            }, { upsert: true }).exec();
            // Update Report relationships using $addToSet (do NOT overwrite evidenceIds array or force thumbnail)
            if (reportDoc) {
                const updateOps = {
                    $addToSet: { evidenceIds: evidenceObjectId }
                };
                if (!reportDoc.primaryEvidenceId) {
                    updateOps.$set = { primaryEvidenceId: evidenceObjectId };
                }
                await Report_1.ReportModel.updateOne({ _id: reportDoc._id }, updateOps).exec();
            }
            console.log(`[SpoolRetryWorker ✅ SUCCESS] Job ${manifest.jobId} recovered successfully.`);
            return true;
        }
        catch (err) {
            manifest.lastErrorCode = err.message;
            console.warn(`[SpoolRetryWorker] Retry attempt #${manifest.attemptCount} failed for ${manifest.jobId}:`, err.message);
            return false;
        }
    }
    static async markEvidenceFailedInDb(manifest) {
        try {
            if (mongoose_1.default.Types.ObjectId.isValid(manifest.evidenceId)) {
                await AiEvidence_1.AiEvidenceModel.updateOne({ _id: manifest.evidenceId }, { $set: { 'storage.status': 'FAILED' } }).exec();
            }
        }
        catch (_) { }
    }
    static purgeOldestFailedJobs() {
        try {
            const spoolDir = this.getSpoolDir();
            const files = fs_1.default.readdirSync(spoolDir);
            const manifestFiles = files.filter(f => f.endsWith('.json'));
            const manifests = [];
            for (const mFile of manifestFiles) {
                try {
                    const m = JSON.parse(fs_1.default.readFileSync(path_1.default.join(spoolDir, mFile), 'utf8'));
                    manifests.push(m);
                }
                catch (_) { }
            }
            manifests.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            for (const m of manifests) {
                if (m.status === 'FAILED' || m.attemptCount >= m.maxAttempts) {
                    try {
                        if (fs_1.default.existsSync(m.spoolFilePath))
                            fs_1.default.unlinkSync(m.spoolFilePath);
                        if (fs_1.default.existsSync(m.manifestFilePath))
                            fs_1.default.unlinkSync(m.manifestFilePath);
                        console.log(`[SpoolRetryWorker 🧹 PURGE] Purged old failed spool job: ${m.jobId}`);
                    }
                    catch (_) { }
                    break;
                }
            }
        }
        catch (_) { }
    }
}
exports.SpoolRetryWorker = SpoolRetryWorker;
