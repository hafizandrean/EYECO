import { CctvModel, ICctv } from '../../database/models/Cctv';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface ICapturedFrame {
  cameraId: number;
  location: string;
  timestamp: Date;
  imagePath: string;
}

const TUYA_ALLOC_COOLDOWN_MS = 25 * 1000;
const lastAllocAt = new Map<string, number>();

/** Run FFmpeg to extract one JPEG frame from a local file or plaintext URL. */
function extractFfmpegFrame(input: string, output: string, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegPath = require('ffmpeg-static') as string;
    const args = ['-y', '-loglevel', 'error', '-i', input, '-vframes', '1', '-q:v', '3', '-f', 'image2', output];
    const child = spawn(ffmpegPath || 'ffmpeg', args, { windowsHide: true });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(false); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && fs.existsSync(output)); });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/**
 * Captures a frame from an AES-128 encrypted Tuya HLS stream.
 * - Fetches the manifest from Tuya Cloud directly
 * - Downloads the AES decryption key
 * - Downloads the first .ts video segment
 * - Decrypts the segment in-memory using Node.js crypto
 * - Saves decrypted .ts to temp file
 * - Extracts a JPEG frame with FFmpeg
 */
async function captureFrameFromTuyaEncryptedHLS(
  manifestUrl: string,
  outputPath: string,
): Promise<boolean> {
  try {
    const tmpDir = path.join(os.tmpdir(), 'eyeco-hls');
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Download the HLS manifest
    const manifestResp = await fetch(manifestUrl, { signal: AbortSignal.timeout(8000) });
    if (!manifestResp.ok) {
      console.warn(`[FrameCapture] Manifest fetch failed: ${manifestResp.status}`);
      return false;
    }
    const manifest = await manifestResp.text();

    // 2. Parse #EXT-X-KEY to find AES key URL and IV
    const keyLineMatch = manifest.match(/#EXT-X-KEY:([^\r\n]+)/);
    const keyUriMatch = keyLineMatch ? keyLineMatch[1].match(/URI="([^"]+)"/) : null;
    const ivMatch = keyLineMatch ? keyLineMatch[1].match(/IV=0x([0-9a-fA-F]+)/) : null;

    // 3. Find first .ts segment line
    const lines = manifest.split('\n').map(l => l.trim()).filter(Boolean);
    const segLine = lines.find(l => !l.startsWith('#') && (l.includes('.ts') || l.includes('hls/')));
    if (!segLine) {
      console.warn('[FrameCapture] No .ts segment found in manifest');
      return false;
    }

    // Resolve segment URL (may be relative or absolute)
    const baseUrl = manifestUrl.includes('?') ? manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1) : manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
    const segmentUrl = segLine.startsWith('http') ? segLine : `${baseUrl}${segLine}`;

    // 4. Download and decrypt .ts segment
    let segBuffer: Buffer;

    if (keyUriMatch) {
      // AES-128 encrypted segment
      const keyUrl = keyUriMatch[1].startsWith('http') ? keyUriMatch[1] : `${baseUrl}${keyUriMatch[1]}`;
      const iv = ivMatch ? Buffer.from(ivMatch[1].padStart(32, '0'), 'hex') : Buffer.alloc(16, 0);

      console.log(`[FrameCapture] Fetching AES key from ${keyUrl.slice(0, 60)}...`);
      const [keyResp, segResp] = await Promise.all([
        fetch(keyUrl, { signal: AbortSignal.timeout(6000) }),
        fetch(segmentUrl, { signal: AbortSignal.timeout(10000) }),
      ]);

      if (!keyResp.ok || !segResp.ok) {
        console.warn(`[FrameCapture] Key or segment fetch failed: key=${keyResp.status} seg=${segResp.status}`);
        return false;
      }

      const keyBytes = Buffer.from(await keyResp.arrayBuffer());
      const encryptedSeg = Buffer.from(await segResp.arrayBuffer());

      // Decrypt using AES-128-CBC
      const decipher = crypto.createDecipheriv('aes-128-cbc', keyBytes, iv);
      decipher.setAutoPadding(true);
      segBuffer = Buffer.concat([decipher.update(encryptedSeg), decipher.final()]);
      console.log(`[FrameCapture] Decrypted ${encryptedSeg.length} bytes → ${segBuffer.length} bytes`);
    } else {
      // Plain (unencrypted) segment
      const segResp = await fetch(segmentUrl, { signal: AbortSignal.timeout(10000) });
      if (!segResp.ok) return false;
      segBuffer = Buffer.from(await segResp.arrayBuffer());
    }

    // 5. Save decrypted .ts to temp file and extract JPEG frame
    const segFile = path.join(tmpDir, `seg_${Date.now()}.ts`);
    fs.writeFileSync(segFile, segBuffer);
    console.log(`[FrameCapture] Saved decrypted segment (${segBuffer.length} bytes) → ${segFile}`);

    const ok = await extractFfmpegFrame(segFile, outputPath, 8000);

    // Cleanup
    try { fs.unlinkSync(segFile); } catch { /* ignore */ }
    return ok;
  } catch (err: any) {
    console.warn(`[FrameCapture] captureFrameFromTuyaEncryptedHLS error: ${err.message}`);
    return false;
  }
}

export class FrameCaptureService {
  public static async getActiveCamerasForMonitoring(workspaceId?: number): Promise<ICctv[]> {
    try {
      const query: any = {
        isActive: true,
        monitoringEnabled: true,
        status: { $in: ['ONLINE', 'MONITORING'] }
      };
      if (workspaceId !== undefined) query.workspaceId = workspaceId;

      const cameras = await CctvModel.find(query);
      const now = new Date();
      for (const camera of cameras) {
        await CctvModel.updateOne({ id: camera.id }, { $set: { lastFrameAt: now } });
      }
      return cameras;
    } catch (err) {
      console.error('[FrameCaptureService] Failed to retrieve active cameras:', err);
      return [];
    }
  }

  /**
   * Captures a JPEG frame from a camera.
   *
   * Krisbow/Tuya Cloud cameras:
   *   - Obtains the Tuya HLS stream URL via TuyaClient (from cache when cooldown active)
   *   - Downloads the manifest, AES key, and first .ts segment via fetch()
   *   - Decrypts in-memory with Node.js crypto (no FFmpeg AES handling needed)
   *   - Extracts frame from decrypted .ts with FFmpeg
   *
   * Generic cameras:
   *   - Uses FFmpeg directly on RTSP/HLS URL
   */
  public static async captureFrame(camera: ICctv): Promise<ICapturedFrame> {
    const tempDir = path.join(os.tmpdir(), 'eyeco');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, `cctv_capture_${camera.id}.jpg`);

    // Detect Tuya/Krisbow device ID
    let deviceId = '';
    if (camera.playUrl?.includes('/hls-proxy/')) {
      const m = camera.playUrl.match(/\/hls-proxy\/([a-zA-Z0-9]+)\//);
      if (m) deviceId = m[1];
    }
    if (!deviceId && camera.description) {
      const m = camera.description.match(/Virtual ID[:\s]+([a-zA-Z0-9]+)/);
      if (m) deviceId = m[1];
      else if (camera.description.includes('Tuya Device ID:'))
        deviceId = camera.description.split('Tuya Device ID:')[1].trim().split(/\s/)[0];
    }

    if (deviceId) {
      // 1. Try local RTSP-transcoded HLS (legacy/fast path)
      const hlsPlaylist = path.join(process.cwd(), 'public/hls', deviceId, 'stream.m3u8');
      if (fs.existsSync(hlsPlaylist) && fs.readFileSync(hlsPlaylist, 'utf8').includes('.ts')) {
        const ok = await extractFfmpegFrame(hlsPlaylist, outputPath);
        if (ok) return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputPath };
      }

      // 2. Get Tuya Cloud HLS URL and capture frame via native decryption
      const last = lastAllocAt.get(deviceId) || 0;
      const cooldownActive = Date.now() - last < TUYA_ALLOC_COOLDOWN_MS;
      if (!cooldownActive) lastAllocAt.set(deviceId, Date.now());

      try {
        const { TuyaClient } = require('./TuyaClient');
        const client = new TuyaClient(
          process.env.TUYA_CLIENT_ID || 'vhxcdfe5q7d5vr4wsgs3',
          process.env.TUYA_CLIENT_SECRET || '0757b40d43884b83952b3b306814fba9',
          process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com',
        );

        // Always reuse active cached stream URL to prevent triggering new Tuya P2P allocations
        const tuyaHlsUrl = await client.getStreamUrl(deviceId, 'HLS', false);
        if (tuyaHlsUrl?.startsWith('http')) {
          console.log(`[FrameCapture] Capturing frame from Tuya Cloud HLS for ${deviceId}...`);
          const ok = await captureFrameFromTuyaEncryptedHLS(tuyaHlsUrl, outputPath);
          if (ok) return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputPath };
          console.warn(`[FrameCapture] Native HLS frame grab failed for ${deviceId}.`);
        }
      } catch (e: any) {
        console.warn(`[FrameCapture] TuyaClient error for ${deviceId}: ${e.message}`);
      }

      throw new Error(`Kamera #${camera.id} gagal menangkap frame dari Tuya Cloud stream.`);
    }

    // 3. Generic RTSP/HLS fallback
    const streamUrl = camera.playUrl || camera.streamUrl;
    if (streamUrl && (streamUrl.startsWith('rtsp') || streamUrl.includes('m3u8') || streamUrl.startsWith('http'))) {
      const ok = await extractFfmpegFrame(streamUrl, outputPath);
      if (ok) return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputPath };
    }

    throw new Error(`Kamera #${camera.id} offline atau gagal menangkap frame.`);
  }
}
