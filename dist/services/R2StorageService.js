"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2StorageService = void 0;
// R2StorageService.ts — Cloudflare R2 (S3-compatible) upload wrapper
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const dotenv_1 = __importDefault(require("dotenv"));
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
        return process.env.R2_BUCKET || 'eyeco';
    }
    /**
     * Upload buffer/stream ke R2.
     * Returns public URL or presigned URL.
     */
    static async upload(key, body, contentType, makePublic = false) {
        if (!this.isConfigured()) {
            console.warn('[R2StorageService] R2 credentials not configured. Skipping upload for key:', key);
            return key;
        }
        const client = getClient();
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.getBucket(),
            Key: key,
            Body: body,
            ContentType: contentType || 'application/octet-stream',
        });
        await client.send(command);
        const publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/^"|"$/g, '');
        if (makePublic && publicUrl) {
            return `${publicUrl.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
        }
        return key;
    }
    /**
     * Upload from local file path.
     */
    static async uploadFile(localPath, key, contentType, makePublic = false) {
        if (!this.isConfigured()) {
            console.warn('[R2StorageService] R2 not configured, uploadFile skipped for:', key);
            return key;
        }
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (!fs.existsSync(localPath)) {
            throw new Error(`[R2StorageService] File not found at path: ${localPath}`);
        }
        const body = fs.readFileSync(localPath);
        return this.upload(key, body, contentType, makePublic);
    }
    /**
     * Generate presigned URL for temporary access (default 1 hour).
     */
    static async getSignedUrl(key, expiresIn = 3600) {
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
     * Generate multiple presigned URLs at once.
     */
    static async getSignedUrls(keys, expiresIn = 3600) {
        const results = new Map();
        for (const key of keys) {
            results.set(key, await this.getSignedUrl(key, expiresIn));
        }
        return results;
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
     * List objects with a prefix (like ls).
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
     * Get public URL for a key.
     * Falls back to signed URL if public access not enabled.
     */
    static async getPublicUrl(key) {
        const publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/^"|"$/g, '');
        if (publicUrl) {
            return `${publicUrl.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
        }
        if (this.isConfigured()) {
            return this.getSignedUrl(key, 604800);
        }
        return `/uploads/${key}`;
    }
    /**
     * Get the full R2 URL via endpoint.
     */
    static getR2Url(key) {
        const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '');
        return `${endpoint}/${this.getBucket()}/${key.replace(/^\//, '')}`;
    }
}
exports.R2StorageService = R2StorageService;
