"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2StorageService = void 0;
// R2StorageService.ts — Cloudflare Private R2 Storage Service with Deep Integrity Verification & Presigned Access
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
let s3Client = null;
function getClient() {
    const endpoint = process.env.R2_ENDPOINT || '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('[R2StorageService] Cloudflare R2 is not fully configured (missing R2_ENDPOINT, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY).');
    }
    if (!s3Client) {
        s3Client = new client_s3_1.S3Client({
            region: 'auto',
            endpoint,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
            forcePathStyle: true,
        });
    }
    return s3Client;
}
class R2StorageService {
    /**
     * Check whether Cloudflare R2 is fully configured with credentials.
     */
    static isConfigured() {
        const endpoint = process.env.R2_ENDPOINT || '';
        const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
        const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
        return Boolean(endpoint && accessKeyId && secretAccessKey);
    }
    static getBucket() {
        const bucket = process.env.R2_BUCKET;
        if (!bucket && process.env.STORAGE_MODE === 'R2') {
            throw new Error('[R2StorageService] R2_BUCKET environment variable is required when STORAGE_MODE=R2.');
        }
        return bucket || 'eyeco';
    }
    /**
     * Upload buffer/stream ke Private R2 Bucket with SHA-256 and custom metadata.
     */
    static async upload(key, body, options = {}) {
        if (!this.isConfigured()) {
            console.warn('[R2StorageService] R2 credentials not configured. Skipping upload for key:', key);
            return key;
        }
        const client = getClient();
        const metadata = { ...options.metadata };
        if (options.sha256)
            metadata.sha256 = options.sha256;
        if (options.evidenceId)
            metadata.evidenceid = String(options.evidenceId);
        if (options.reportId)
            metadata.reportid = String(options.reportId);
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.getBucket(),
            Key: key,
            Body: body,
            ContentType: options.contentType || 'application/octet-stream',
            Metadata: metadata,
        });
        await client.send(command);
        return key;
    }
    /**
     * Upload from local file path with metadata (supports options object or legacy 3/4 arguments).
     */
    static async uploadFile(localPath, key, optionsOrContentType, makePublicLegacy) {
        if (!this.isConfigured()) {
            console.warn('[R2StorageService] R2 not configured, uploadFile skipped for:', key);
            return key;
        }
        if (!fs_1.default.existsSync(localPath)) {
            throw new Error(`[R2StorageService] File not found at path: ${localPath}`);
        }
        const body = fs_1.default.readFileSync(localPath);
        let opts = {};
        if (typeof optionsOrContentType === 'string') {
            opts = { contentType: optionsOrContentType };
        }
        else if (optionsOrContentType) {
            opts = optionsOrContentType;
        }
        return this.upload(key, body, opts);
    }
    /**
     * Deep Integrity Verification via HeadObjectCommand.
     * Compares ContentLength AND Metadata.sha256.
     */
    static async verifyObjectIntegrity(key, expectedSize, expectedSha256) {
        if (!this.isConfigured()) {
            return { valid: false, exists: false, sizeMatches: false, shaMatches: false };
        }
        try {
            const client = getClient();
            const command = new client_s3_1.HeadObjectCommand({
                Bucket: this.getBucket(),
                Key: key,
            });
            const res = await client.send(command);
            const exists = true;
            const sizeMatches = res.ContentLength === expectedSize;
            const metaSha = res.Metadata?.sha256 || res.Metadata?.SHA256 || '';
            const shaMatches = expectedSha256 ? (metaSha === expectedSha256) : true;
            const valid = exists && sizeMatches && shaMatches;
            return {
                valid,
                exists,
                sizeMatches,
                shaMatches,
                etag: res.ETag,
            };
        }
        catch (err) {
            if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
                return { valid: false, exists: false, sizeMatches: false, shaMatches: false };
            }
            console.warn(`[R2StorageService] HeadObject check failed for key ${key}:`, err.message);
            return { valid: false, exists: false, sizeMatches: false, shaMatches: false };
        }
    }
    /**
     * Generate short-lived presigned GET URL (default 5 min for dashboard, 15 min for download).
     */
    static async getSignedUrl(key, expiresIn = 300) {
        if (!this.isConfigured()) {
            throw new Error('[R2StorageService] Cannot generate signed URL because R2 is not configured.');
        }
        const client = getClient();
        const command = new client_s3_1.GetObjectCommand({
            Bucket: this.getBucket(),
            Key: key,
        });
        return (0, s3_request_presigner_1.getSignedUrl)(client, command, { expiresIn });
    }
    /**
     * Delete object from R2.
     */
    static async delete(key) {
        if (!this.isConfigured())
            return;
        const client = getClient();
        const command = new client_s3_1.DeleteObjectCommand({
            Bucket: this.getBucket(),
            Key: key,
        });
        await client.send(command);
    }
    /**
     * List objects with a prefix.
     */
    static async list(prefix) {
        if (!this.isConfigured())
            return [];
        const client = getClient();
        const command = new client_s3_1.ListObjectsV2Command({
            Bucket: this.getBucket(),
            Prefix: prefix,
        });
        const result = await client.send(command);
        return (result.Contents || []).map((o) => o.Key || '').filter(Boolean);
    }
    /**
     * Deterministic Key Generators
     */
    static getAutoReportKey(reportId, evidenceId, sha256) {
        const cleanSha = sha256.slice(0, 12);
        return `laporan_auto/${reportId}/${evidenceId}-${cleanSha}.jpg`;
    }
    static getManualReportKey(reportId, evidenceId, sha256, originalFilename) {
        const ext = path_1.default.extname(originalFilename).toLowerCase() || '.jpg';
        const cleanSha = sha256.slice(0, 12);
        return `laporan_manual/${reportId}/${evidenceId}-${cleanSha}${ext}`;
    }
    static getCctvStreamKey(cameraId, reportId, evidenceId, sha256) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const cleanSha = sha256.slice(0, 12);
        return `cctv/${cameraId}/${yyyy}/${mm}/${dd}/${reportId}/${evidenceId}-${cleanSha}.jpg`;
    }
}
exports.R2StorageService = R2StorageService;
