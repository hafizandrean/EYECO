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

// Cooldown to prevent hammering Tuya stream allocation API every 20s pipeline cycle
const TUYA_ALLOC_COOLDOWN_MS = 25 * 1000; // 25 seconds — same as TuyaClient cache TTL
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
   * For Krisbow/Tuya cloud cameras, uses the TuyaClient stream cache directly.
   * Falls back to generic RTSP/HLS for other cameras.
   */
  public static async captureFrame(camera: ICctv): Promise<ICapturedFrame> {
    const tempDir = path.join(os.tmpdir(), 'eyeco');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const outputAbsolutePath = path.join(tempDir, `cctv_capture_${camera.id}.jpg`);
    const outputRelativePath = outputAbsolutePath;

    // Extract Tuya device ID from camera config
    let deviceId = '';
    if (camera.playUrl && camera.playUrl.includes('/hls-proxy/')) {
      const match = camera.playUrl.match(/\/hls-proxy\/([a-zA-Z0-9_]+)\//);
      if (match) deviceId = match[1];
    } else if (camera.description && camera.description.includes('Tuya Device ID:')) {
      deviceId = camera.description.split('Tuya Device ID:')[1].trim();
    } else if (camera.description && camera.description.includes('Virtual ID')) {
      const vidMatch = camera.description.match(/Virtual ID[:\s]+([a-zA-Z0-9]+)/);
      if (vidMatch) deviceId = vidMatch[1];
    }

    if (deviceId) {
      // 1. Check for local RTSP-transcoded HLS file (legacy path, if transcoder was used)
      const hlsPlaylist = path.join(process.cwd(), 'public/hls', deviceId, 'stream.m3u8');
      if (fs.existsSync(hlsPlaylist)) {
        const content = fs.readFileSync(hlsPlaylist, 'utf8');
        if (content.includes('.ts')) {
          console.log(`[FrameCapture] Extracting frame from local HLS: ${hlsPlaylist}`);
          const success = await extractFfmpegFrame(hlsPlaylist, outputAbsolutePath);
          if (success) {
            return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputRelativePath };
          }
        }
      }

      // 2. Use Tuya Cloud stream URL directly (bypasses proxy loop and cooldown conflict)
      const last = lastAllocAt.get(deviceId) || 0;
      const cooldownActive = Date.now() - last < TUYA_ALLOC_COOLDOWN_MS;

      try {
        const { TuyaClient } = require('./TuyaClient');
        const accessId = process.env.TUYA_CLIENT_ID || 'vhxcdfe5q7d5vr4wsgs3';
        const accessSecret = process.env.TUYA_CLIENT_SECRET || '0757b40d43884b83952b3b306814fba9';
        const endpoint = process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com';
        const client = new TuyaClient(accessId, accessSecret, endpoint);

        // Always use cached URL if cooldown active, allocate fresh only when cooldown expired
        const tuyaStreamUrl = await client.getStreamUrl(deviceId, 'HLS', !cooldownActive);
        if (!cooldownActive) lastAllocAt.set(deviceId, Date.now());

        if (tuyaStreamUrl && tuyaStreamUrl.startsWith('http')) {
          console.log(`[FrameCapture] Extracting frame from Tuya Cloud HLS stream for ${deviceId}...`);
          const success = await extractFfmpegFrame(tuyaStreamUrl, outputAbsolutePath);
          if (success) {
            return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputRelativePath };
          }
          console.warn(`[FrameCapture] FFmpeg failed on Tuya Cloud HLS. Stream may be encrypted or expired.`);
        }
      } catch (e: any) {
        console.warn(`[FrameCapture] Tuya stream fetch failed for ${deviceId}: ${e.message}`);
      }

      // If all Tuya attempts fail, skip rather than fall through to playUrl
      throw new Error(`Kamera #${camera.id} gagal menangkap frame dari Tuya Cloud stream.`);
    }

    // 3. Generic RTSP/HLS fallback for non-Tuya cameras
    const streamUrl = camera.playUrl || camera.streamUrl;
    if (streamUrl && (streamUrl.startsWith('rtsp') || streamUrl.includes('m3u8') || streamUrl.startsWith('http'))) {
      console.log(`[FrameCapture] Extracting frame from stream URL: ${streamUrl}`);
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

    throw new Error(`Kamera #${camera.id} offline atau gagal menangkap frame.`);
  }
}
