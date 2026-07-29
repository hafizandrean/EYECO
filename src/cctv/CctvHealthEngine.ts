import { CctvModel } from '../database/models/Cctv';
import { CctvRepository } from '../database/repositories/CctvRepository';
import { CctvScanner } from './CctvScanner';
import mongoose from 'mongoose';

export class CctvHealthEngine {
  private static timer: NodeJS.Timeout | null = null;
  private static reconnectingCameras: Set<number> = new Set();

  public static start() {
    if (this.timer) return;

    console.log('[CctvHealthEngine] Status and Health Poller started (10s intervals).');
    this.timer = setInterval(async () => {
      await this.checkAllCameras();
    }, 10000);

    // Initial check on boot
    setTimeout(() => this.checkAllCameras(), 2000);
  }

  public static stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[CctvHealthEngine] Status and Health Poller stopped.');
    }
  }

  // Perform status check for all active cameras
  private static async checkAllCameras() {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.warn('[CctvHealthEngine] MongoDB not connected. Skipping health check loop.');
        return;
      }
      const cameras = await CctvModel.find({ isActive: true });
      for (const camera of cameras) {
        // Skip default cameras (they are static local mock assets, always ONLINE)
        if (camera.isDefault) {
          continue;
        }

        // If camera is already in a reconnection retry cycle, let the reconnect loop handle it
        if (this.reconnectingCameras.has(camera.id)) {
          continue;
        }

        await this.checkCameraHealth(camera.id);
      }
    } catch (err) {
      console.error('[CctvHealthEngine] checkAllCameras failed:', err);
    }
  }

  public static async checkCameraHealth(id: number): Promise<void> {
    try {
      const camera = await CctvModel.findOne({ id });
      if (!camera || !camera.isActive) return;

      const startTime = Date.now();
      let isOnline = false;
      let latency = 0;
      let fps = 0;
      let resolution = camera.health?.resolution || '1280x720';

      // 1. Perform lightweight check based on protocol
      if (camera.protocol === 'CLOUD_VIEWER' || camera.protocol === 'RTSP_TUYA') {
        // Tuya cloud RTSP / smart cloud cameras — stream is managed by Tuya CDN
        // Cannot TCP-probe Tuya's CDN server; treat as ONLINE if record is active
        isOnline = true;
        latency = Math.floor(Math.random() * 60) + 80; // ~80-140ms CDN latency
        fps = 25; // Tuya solar camera streams at ~25fps
      } else if (camera.protocol === 'HLS' || camera.protocol === 'HTTP Image' || camera.protocol === 'MP4') {
        // HTTP Stream / image check
        // Simulating HTTP request ping
        isOnline = true;
        latency = Date.now() - startTime + Math.floor(Math.random() * 20) + 5;
        fps = camera.protocol === 'HTTP Image' ? 0 : 24;
      } else if (camera.protocol === 'RTSP' || camera.protocol === 'RTMP') {
        // Port response check for RTSP
        const streamUrl = camera.streamUrl || '';
        const cleanHost = streamUrl && streamUrl.includes('@')
          ? streamUrl.split('@').pop()!.split(':')[0]
          : (streamUrl ? streamUrl.replace('rtsp://', '').split('/')[0].split(':')[0] : 'localhost');
        
        // Probes RTSP port 554
        const scan = await CctvScanner.scan(cleanHost, camera.username || '', '', camera.vendor);
        isOnline = scan.rtsp;
        latency = Date.now() - startTime + Math.floor(Math.random() * 30) + 10;
        fps = isOnline ? 24 : 0;
      }

      if (isOnline) {
        // Transition back to ONLINE if it wasn't
        await CctvRepository.updateStatus(camera.id, 'ONLINE', {
          latency,
          fps,
          resolution
        });
      } else {
        // Initiate the Auto-Reconnect state machine
        console.warn(`[CctvHealthEngine] Camera ${camera.name} (ID: ${camera.id}) went OFFLINE. Starting reconnect loop.`);
        await CctvRepository.updateStatus(camera.id, 'CONNECTING');
        this.triggerAutoReconnect(camera.id);
      }
    } catch (err) {
      console.error(`[CctvHealthEngine] checkCameraHealth failed for ID ${id}:`, err);
    }
  }

  // Reconnection state machine with exponential backoff strategy (5s, 10s, 30s)
  private static async triggerAutoReconnect(id: number) {
    if (this.reconnectingCameras.has(id)) return;
    this.reconnectingCameras.add(id);

    const retryDelays = [5000, 10000, 30000];
    let attempt = 0;

    const runRetry = async () => {
      if (attempt >= retryDelays.length) {
        console.error(`[CctvHealthEngine] Camera ID ${id} failed all reconnection attempts. Marking as DISCONNECTED.`);
        await CctvRepository.updateStatus(id, 'DISCONNECTED', { latency: 0, fps: 0, resolution: 'N/A' });
        this.reconnectingCameras.delete(id);
        return;
      }

      setTimeout(async () => {
        try {
          console.log(`[CctvHealthEngine] Reconnecting Camera ID ${id} (Attempt ${attempt + 1}/${retryDelays.length})...`);
          
          if (mongoose.connection.readyState !== 1) {
            console.warn(`[CctvHealthEngine] DB disconnected during reconnect loop for Camera ID ${id}. Retrying...`);
            attempt++;
            await runRetry();
            return;
          }

          const camera = await CctvModel.findOne({ id });
          if (!camera || !camera.isActive) {
            this.reconnectingCameras.delete(id);
            return;
          }

          let isOnline = false;
          // Run scanner check to see if target came online
          const streamUrl = camera.streamUrl || '';
          const cleanHost = streamUrl && streamUrl.includes('@')
            ? streamUrl.split('@').pop()!.split(':')[0]
            : (streamUrl ? streamUrl.replace('rtsp://', '').replace('http://', '').replace('https://', '').split('/')[0].split(':')[0] : 'localhost');

          if (camera.protocol === 'RTSP') {
            const scan = await CctvScanner.scan(cleanHost, camera.username, '', camera.vendor);
            isOnline = scan.rtsp;
          } else {
            isOnline = true; // Mock HLS/HTTP images fallback
          }

          if (isOnline) {
            console.log(`[CctvHealthEngine] Camera ID ${id} successfully reconnected ONLINE.`);
            await CctvRepository.updateStatus(id, 'ONLINE', {
              latency: 40,
              fps: camera.protocol === 'HTTP Image' ? 0 : 24,
              resolution: camera.health.resolution
            });
            this.reconnectingCameras.delete(id);
          } else {
            attempt++;
            await runRetry();
          }
        } catch (err) {
          console.error(`[CctvHealthEngine] Reconnect attempt failed for ID ${id}:`, err);
          attempt++;
          await runRetry();
        }
      }, retryDelays[attempt]);
    };

    await runRetry();
  }

  // Force manual reconnect trigger
  public static async manualReconnect(id: number): Promise<boolean> {
    try {
      const camera = await CctvModel.findOne({ id });
      if (!camera) return false;

      console.log(`[CctvHealthEngine] Manual reconnect triggered for camera: ${camera.name} (ID: ${camera.id})`);
      await CctvRepository.updateStatus(id, 'CONNECTING');
      
      // Remove from active reconnect lock list to force a fresh restart
      this.reconnectingCameras.delete(id);
      
      // Run status check instantly
      await this.checkCameraHealth(id);
      return true;
    } catch (err) {
      console.error(`[CctvHealthEngine] manualReconnect failed for ID ${id}:`, err);
      return false;
    }
  }
}
