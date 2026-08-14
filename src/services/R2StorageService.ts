// R2StorageService.ts — Cloudflare R2 (S3-compatible) upload wrapper
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

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
    return process.env.R2_BUCKET || 'eyeco';
  }

  /**
   * Upload buffer/stream ke R2.
   * Returns public URL or presigned URL.
   */
  static async upload(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    makePublic = false,
  ): Promise<string> {
    if (!this.isConfigured()) {
      console.warn('[R2StorageService] R2 credentials not configured. Skipping upload for key:', key);
      return key;
    }
    const client = getClient();
    const command = new PutObjectCommand({
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
  static async uploadFile(
    localPath: string,
    key: string,
    contentType?: string,
    makePublic = false,
  ): Promise<string> {
    if (!this.isConfigured()) {
      console.warn('[R2StorageService] R2 not configured, uploadFile skipped for:', key);
      return key;
    }
    const fs = await import('fs');
    if (!fs.existsSync(localPath)) {
      throw new Error(`[R2StorageService] File not found at path: ${localPath}`);
    }
    const body = fs.readFileSync(localPath);
    return this.upload(key, body, contentType, makePublic);
  }

  /**
   * Generate presigned URL for temporary access (default 1 hour).
   */
  static async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
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
   * Generate multiple presigned URLs at once.
   */
  static async getSignedUrls(keys: string[], expiresIn = 3600): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    for (const key of keys) {
      results.set(key, await this.getSignedUrl(key, expiresIn));
    }
    return results;
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
   * List objects with a prefix (like ls).
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
   * Get public URL for a key.
   * Falls back to signed URL if public access not enabled.
   */
  static async getPublicUrl(key: string): Promise<string> {
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
  static getR2Url(key: string): string {
    const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '');
    return `${endpoint}/${this.getBucket()}/${key.replace(/^\//, '')}`;
  }
}