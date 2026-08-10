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
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || 'eyeco';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
let s3Client = null;
function getClient() {
    if (!s3Client) {
        s3Client = new client_s3_1.S3Client({
            region: 'auto',
            endpoint: R2_ENDPOINT,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
            forcePathStyle: true,
        });
    }
    return s3Client;
}
class R2StorageService {
    /**
     * Upload buffer/stream ke R2.
     * Returns public URL or presigned URL.
     */
    static async upload(key, body, contentType, makePublic = false) {
        const client = getClient();
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType || 'application/octet-stream',
        });
        await client.send(command);
        if (makePublic && R2_PUBLIC_URL) {
            return `${R2_PUBLIC_URL}/${key}`;
        }
        return key; // Return key — caller builds URL
    }
    /**
     * Upload from local file path.
     */
    static async uploadFile(localPath, key, contentType, makePublic = false) {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const body = fs.readFileSync(localPath);
        return this.upload(key, body, contentType, makePublic);
    }
    /**
     * Generate presigned URL for temporary access (default 1 hour).
     */
    static async getSignedUrl(key, expiresIn = 3600) {
        const client = getClient();
        const command = new client_s3_1.GetObjectCommand({
            Bucket: R2_BUCKET,
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
        const client = getClient();
        const command = new client_s3_1.DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
        });
        await client.send(command);
    }
    /**
     * List objects with a prefix (like ls).
     */
    static async list(prefix) {
        const client = getClient();
        const command = new client_s3_1.ListObjectsV2Command({
            Bucket: R2_BUCKET,
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
        if (R2_PUBLIC_URL) {
            return `${R2_PUBLIC_URL}/${key}`;
        }
        // Signed URL 7 hari — cukup untuk akses file
        return this.getSignedUrl(key, 604800);
    }
    /**
     * Get the full R2 URL via endpoint.
     */
    static getR2Url(key) {
        return `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;
    }
}
exports.R2StorageService = R2StorageService;
