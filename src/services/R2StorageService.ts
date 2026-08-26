// R2StorageService.ts — Cloudflare Private R2 Storage Service with Deep Integrity Verification & Presigned Access
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  const endpoint = process.env.R2_ENDPOINT || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('[R2StorageService] Cloudflare R2 is not fully configured (missing R2_ENDPOINT, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY).');
  }

  if (!s3Client) {
    s3Client = new S3Client({
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

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  sha256?: string;
  evidenceId?: string;
  reportId?: string;
}

export class R2StorageService {
  /**
   * Check whether Cloudflare R2 is fully configured with credentials.
   */
  static isConfigured(): boolean {
    const endpoint = process.env.R2_ENDPOINT || '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
    return Boolean(endpoint && accessKeyId && secretAccessKey);
  }

  static getBucket(): string {
    const bucket = process.env.R2_BUCKET;
    if (!bucket && process.env.STORAGE_MODE === 'R2') {
      throw new Error('[R2StorageService] R2_BUCKET environment variable is required when STORAGE_MODE=R2.');
    }
    return bucket || 'eyeco';
  }

  /**
   * Upload buffer/stream ke Private R2 Bucket with SHA-256 and custom metadata.
   */
  static async upload(
    key: string,
    body: Buffer | Uint8Array | string,
    options: UploadOptions = {}
  ): Promise<string> {
    if (!this.isConfigured()) {
      console.warn('[R2StorageService] R2 credentials not configured. Skipping upload for key:', key);
      return key;
    }
    const client = getClient();
    const metadata: Record<string, string> = { ...options.metadata };
    if (options.sha256) metadata.sha256 = options.sha256;
    if (options.evidenceId) metadata.evidenceid = String(options.evidenceId);
    if (options.reportId) metadata.reportid = String(options.reportId);

    const command = new PutObjectCommand({
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
  static async uploadFile(
    localPath: string,
    key: string,
    optionsOrContentType?: UploadOptions | string,
    makePublicLegacy?: boolean
  ): Promise<string> {
    if (!this.isConfigured()) {
      console.warn('[R2StorageService] R2 not configured, uploadFile skipped for:', key);
      return key;
    }
    if (!fs.existsSync(localPath)) {
      throw new Error(`[R2StorageService] File not found at path: ${localPath}`);
    }
    const body = fs.readFileSync(localPath);

    let opts: UploadOptions = {};
    if (typeof optionsOrContentType === 'string') {
      opts = { contentType: optionsOrContentType };
    } else if (optionsOrContentType) {
      opts = optionsOrContentType;
    }

    return this.upload(key, body, opts);
  }

  /**
   * Deep Integrity Verification via HeadObjectCommand.
   * Compares ContentLength AND Metadata.sha256.
   */
  static async verifyObjectIntegrity(
    key: string,
    expectedSize: number,
    expectedSha256?: string
  ): Promise<{ valid: boolean; exists: boolean; sizeMatches: boolean; shaMatches: boolean; etag?: string }> {
    if (!this.isConfigured()) {
      return { valid: false, exists: false, sizeMatches: false, shaMatches: false };
    }
    try {
      const client = getClient();
      const command = new HeadObjectCommand({
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
    } catch (err: any) {
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
  static async getSignedUrl(key: string, expiresIn = 300): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('[R2StorageService] Cannot generate signed URL because R2 is not configured.');
    }
    const client = getClient();
    const command = new GetObjectCommand({
      Bucket: this.getBucket(),
      Key: key,
    });
    return getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Delete object from R2.
   */
  static async delete(key: string): Promise<void> {
    if (!this.isConfigured()) return;
    const client = getClient();
    const command = new DeleteObjectCommand({
      Bucket: this.getBucket(),
      Key: key,
    });
    await client.send(command);
  }

  /**
   * List objects with a prefix.
   */
  static async list(prefix: string): Promise<string[]> {
    if (!this.isConfigured()) return [];
    const client = getClient();
    const command = new ListObjectsV2Command({
      Bucket: this.getBucket(),
      Prefix: prefix,
    });
    const result = await client.send(command);
    return (result.Contents || []).map((o) => o.Key || '').filter(Boolean);
  }

  /**
   * Deterministic Key Generators
   */
  static getAutoReportKey(reportId: number | string, evidenceId: string | number, sha256: string): string {
    const cleanSha = sha256.slice(0, 12);
    return `laporan_auto/${reportId}/${evidenceId}-${cleanSha}.jpg`;
  }

  static getManualReportKey(reportId: number | string, evidenceId: string | number, sha256: string, originalFilename: string): string {
    const ext = path.extname(originalFilename).toLowerCase() || '.jpg';
    const cleanSha = sha256.slice(0, 12);
    return `laporan_manual/${reportId}/${evidenceId}-${cleanSha}${ext}`;
  }

  static getCctvStreamKey(cameraId: number, reportId: number | string, evidenceId: string | number, sha256: string): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const cleanSha = sha256.slice(0, 12);
    return `cctv/${cameraId}/${yyyy}/${mm}/${dd}/${reportId}/${evidenceId}-${cleanSha}.jpg`;
  }
}