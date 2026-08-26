import { CctvModel, ICctv } from '../../database/models/Cctv';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface ICapturedFrame {
  cameraId: number;
  location: string;
  timestamp: Date;
  imagePath: string;
}

const TUYA_ALLOC_COOLDOWN_MS = 25 * 1000; // same as TuyaClient stream cache TTL
const lastAllocAt = new Map<string, number>();

/**
 * Extract a single JPEG frame from any stream/file using FFmpeg.
 * Supports AES-128 encrypted HLS (with -protocol_whitelist and -allowed_extensions).
 */
function extractFfmpegFrame(input: string, output: string, timeoutMs = 12000): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegPath = require('ffmpeg-static') as string;

    const isHttp = input.startsWith('http://') || input.startsWith('https://');
    const args = [
      '-y',
      '-loglevel', 'error',
      // Allow all protocols needed for AES-encrypted HLS key fetching
      ...(isHttp ? [
        '-allowed_extensions', 'ALL',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      ] : []),
      '-ss', '00:00:01',        // skip 1s to allow HLS buffer to fill
      '-i', input,
      '-vframes', '1',
      '-q:v', '3',
      '-f', 'image2',
      output,
    ];

    const child = spawn(ffmpegPath || 'ffmpeg', args, { windowsHide: true });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && fs.existsSync(output));
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export class FrameCaptureService {
  /**
   * Selects active cameras that are online and have monitoring enabled.
   */
  public static async getActiveCamerasForMonitoring(workspaceId?: number): Promise<ICctv[]> {
    try {
      const query: any = {
        isActive: true,
        monitoringEnabled: true,
        status: { $in: ['ONLINE', 'MONITORING'] }
      };
      if (workspaceId !== undefined) {
        query.workspaceId = workspaceId;
      }

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
   * Captures a frame from a camera stream.
   *
   * For Krisbow/Tuya Cloud cameras:
   *   - Uses the local HLS proxy endpoint (http://127.0.0.1:{PORT}/api/cctv/hls-proxy/{deviceId}/stream.m3u8)
   *   - The proxy handles AES key decryption transparently for FFmpeg
   *   - Respects a 25-second cooldown so Tuya stream allocation isn't hammered
   *
   * For generic cameras:
   *   - Falls back to direct RTSP/HLS URL
   */
  public static async captureFrame(camera: ICctv): Promise<ICapturedFrame> {
    const tempDir = path.join(os.tmpdir(), 'eyeco');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const outputAbsolutePath = path.join(tempDir, `cctv_capture_${camera.id}.jpg`);

    // Extract Tuya device ID from camera config
    let deviceId = '';
    if (camera.playUrl && camera.playUrl.includes('/hls-proxy/')) {
      const match = camera.playUrl.match(/\/hls-proxy\/([a-zA-Z0-9]+)\//);
      if (match) deviceId = match[1];
    }
    if (!deviceId && camera.description) {
      const vidMatch = camera.description.match(/Virtual ID[:\s]+([a-zA-Z0-9]+)/);
      if (vidMatch) deviceId = vidMatch[1];
      else if (camera.description.includes('Tuya Device ID:')) {
        deviceId = camera.description.split('Tuya Device ID:')[1].trim().split(/\s/)[0];
      }
    }

    if (deviceId) {
      // 1. Try local RTSP-transcoded HLS file first (legacy path, fast)
      const hlsPlaylist = path.join(process.cwd(), 'public/hls', deviceId, 'stream.m3u8');
      if (fs.existsSync(hlsPlaylist)) {
        const content = fs.readFileSync(hlsPlaylist, 'utf8');
        if (content.includes('.ts')) {
          console.log(`[FrameCapture] Extracting frame from local HLS: ${hlsPlaylist}`);
          const ok = await extractFfmpegFrame(hlsPlaylist, outputAbsolutePath);
          if (ok) return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputAbsolutePath };
        }
      }

      // 2. Use our own HLS proxy endpoint — it handles AES key decryption transparently.
      //    FFmpeg follows the rewritten key/segment URLs through our subresource proxy on localhost.
      const port = process.env.PORT || 8000;
      const proxyUrl = `http://127.0.0.1:${port}/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;

      const last = lastAllocAt.get(deviceId) || 0;
      const isInCooldown = Date.now() - last < TUYA_ALLOC_COOLDOWN_MS;

      if (!isInCooldown) lastAllocAt.set(deviceId, Date.now());

      console.log(`[FrameCapture] Extracting frame via HLS proxy (cooldown=${isInCooldown}): ${proxyUrl}`);
      const ok = await extractFfmpegFrame(proxyUrl, outputAbsolutePath, 20000); // 20s for HLS buffer
      if (ok) return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputAbsolutePath };

      console.warn(`[FrameCapture] Proxy HLS frame grab failed for ${deviceId}. Skipping AI cycle.`);
      throw new Error(`Kamera #${camera.id} gagal menangkap frame (encrypted HLS timeout).`);
    }

    // 3. Generic fallback for non-Tuya cameras (RTSP or plain HLS)
    const streamUrl = camera.playUrl || camera.streamUrl;
    if (streamUrl && (streamUrl.startsWith('rtsp') || streamUrl.includes('m3u8') || streamUrl.startsWith('http'))) {
      console.log(`[FrameCapture] Extracting frame from stream URL: ${streamUrl}`);
      const ok = await extractFfmpegFrame(streamUrl, outputAbsolutePath);
      if (ok) return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputAbsolutePath };
    }

    throw new Error(`Kamera #${camera.id} offline atau gagal menangkap frame.`);
  }
}
