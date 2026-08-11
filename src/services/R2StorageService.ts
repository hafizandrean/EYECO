// R2StorageService.ts — Cloudflare R2 (S3-compatible) upload wrapper
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || 'eyeco';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/^"|"$/g, '');

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
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

export class R2StorageService {
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
    const client = getClient();
    const command = new PutObjectCommand({
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
  static async uploadFile(
    localPath: string,
    key: string,
    contentType?: string,
    makePublic = false,
  ): Promise<string> {
    const fs = await import('fs');
    const body = fs.readFileSync(localPath);
    return this.upload(key, body, contentType, makePublic);
  }

  /**
   * Generate presigned URL for temporary access (default 1 hour).
   */
  static async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const client = getClient();
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
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
    const client = getClient();
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });
    await client.send(command);
  }

  /**
   * List objects with a prefix (like ls).
   */
  static async list(prefix: string): Promise<string[]> {
    const client = getClient();
    const command = new ListObjectsV2Command({
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
  static async getPublicUrl(key: string): Promise<string> {
    if (R2_PUBLIC_URL) {
      return `${R2_PUBLIC_URL}/${key}`;
    }
    // Signed URL 7 hari — cukup untuk akses file
    return this.getSignedUrl(key, 604800);
  }

  /**
   * Get the full R2 URL via endpoint.
   */
  static getR2Url(key: string): string {
    return `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;
  }
}