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

// ponytail: cooldown allocate Tuya per device — pipeline tiap 20s bakar kuota stream
// (error 28841002 "IoT Core expired" padahal subscription aktif). Naikkan/turunkan di sini.
const TUYA_ALLOC_COOLDOWN_MS = 120 * 1000;
const lastAllocAt = new Map<string, number>();

function extractFfmpegFrame(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegPath = require('ffmpeg-static') as string;
    const args = [
      '-y',
      '-loglevel', 'error',
      '-ss', '00:00:00',
      '-i', input,
      '-vframes', '1',
      '-f', 'image2',
      output
    ];
    const child = spawn(ffmpegPath || 'ffmpeg', args, { windowsHide: true });
    
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, 8000); // 8s timeout limit

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
   * Updates the camera's `lastFrameAt` timestamp to track performance.
   * If workspaceId is provided, only returns cameras in that workspace.
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
   * Uses the camera's playUrl or streamUrl for real streams,
   * falls back to a static image if no stream URL is available.
   */
  public static async captureFrame(camera: ICctv): Promise<ICapturedFrame> {
    const tempDir = path.join(os.tmpdir(), 'eyeco');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const outputAbsolutePath = path.join(tempDir, `cctv_capture_${camera.id}.jpg`);
    const outputRelativePath = outputAbsolutePath;

    let deviceId = '';
    if (camera.playUrl && camera.playUrl.includes('/hls-proxy/')) {
      const match = camera.playUrl.match(/\/hls-proxy\/([a-zA-Z0-9_]+)\//);
      if (match) deviceId = match[1];
    } else if (camera.description && camera.description.includes('Tuya Device ID:')) {
      deviceId = camera.description.split('Tuya Device ID:')[1].trim();
    }

    if (deviceId) {
      // --- Cloud HLS Proxy (Krisbow/Tuya) ---
      // First check if local RTSP-transcoded HLS file exists (legacy path)
      const hlsPlaylist = path.join(process.cwd(), 'public/hls', deviceId, 'stream.m3u8');
      if (fs.existsSync(hlsPlaylist)) {
        const content = fs.readFileSync(hlsPlaylist, 'utf8');
        if (content.includes('.ts')) {
          console.log(`[FrameCapture] Extracting frame from local HLS playlist: ${hlsPlaylist}`);
          const success = await extractFfmpegFrame(hlsPlaylist, outputAbsolutePath);
          if (success) {
            lastAllocAt.set(deviceId, Date.now());
            return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputRelativePath };
          }
        }
      }

      // No local file → use the backend proxy URL directly (Cloud HLS)
      // The server itself calls localhost to get the proxied HLS manifest
      const proxyUrl = `http://127.0.0.1:${process.env.PORT || 8000}/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;
      const last = lastAllocAt.get(deviceId) || 0;
      if (Date.now() - last < TUYA_ALLOC_COOLDOWN_MS) {
        // During cooldown, still try to capture from the already-allocated stream URL
        const streamUrl = camera.playUrl || camera.streamUrl;
        if (streamUrl && streamUrl.includes('/hls-proxy/')) {
          console.log(`[FrameCapture] Cooldown active — trying frame grab from proxy URL: ${proxyUrl}`);
          const success = await extractFfmpegFrame(proxyUrl, outputAbsolutePath);
          if (success) {
            return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputRelativePath };
          }
        }
        throw new Error(`Kamera #${camera.id} stream allocate dalam cooldown (${Math.ceil((TUYA_ALLOC_COOLDOWN_MS - (Date.now() - last)) / 1000)}s) — skip`);
      }
      lastAllocAt.set(deviceId, Date.now());

      console.log(`[FrameCapture] Extracting frame from Cloud HLS proxy: ${proxyUrl}`);
      const success = await extractFfmpegFrame(proxyUrl, outputAbsolutePath);
      if (success) {
        return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputRelativePath };
      }
    }

    // Generic RTSP/HLS stream URL capture fallback
    const streamUrl = camera.playUrl || camera.streamUrl;
    if (streamUrl && (streamUrl.startsWith('rtsp') || streamUrl.includes('m3u8') || streamUrl.startsWith('http'))) {
      console.log(`[FrameCapture] Extracting frame from camera stream URL: ${streamUrl}`);
      const success = await extractFfmpegFrame(streamUrl, outputAbsolutePath);
      if (success) {
        return {
          cameraId: camera.id,
          location: camera.location,
          timestamp: new Date(),
          imagePath: outputRelativePath,
        };
      }
    }

    // Throw error if FFmpeg fails to capture frame to prevent running YOLO on old or dummy files
    throw new Error(`Kamera #${camera.id} offline atau gagal menangkap frame.`);
  }
}
