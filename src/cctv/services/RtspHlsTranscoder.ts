import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';

const ffmpegPath: string = require('@ffmpeg-installer/ffmpeg').path;

interface TranscoderSession {
  process: ChildProcess;
  outputDir: string;
  startedAt: number;
  deviceId: string;
}

const sessions = new Map<string, TranscoderSession>();
const HLS_OUTPUT_BASE = path.join(process.cwd(), 'public', 'hls');

export class RtspHlsTranscoder {
  static getOutputDir(deviceId: string): string {
    return path.join(HLS_OUTPUT_BASE, deviceId);
  }

  static getPlaylistPath(deviceId: string): string {
    return path.join(this.getOutputDir(deviceId), 'stream.m3u8');
  }

  static getPublicUrl(deviceId: string): string {
    return `/hls/${deviceId}/stream.m3u8`;
  }

  static isRunning(deviceId: string): boolean {
    const session = sessions.get(deviceId);
    if (!session) return false;
    if (session.process.exitCode !== null) {
      sessions.delete(deviceId);
      return false;
    }
    return true;
  }

  static async start(deviceId: string, rtspUrl: string): Promise<string> {
    // Stop existing session if running
    this.stop(deviceId);

    const outputDir = this.getOutputDir(deviceId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Clean stale HLS segments
    fs.readdirSync(outputDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        try { fs.unlinkSync(path.join(outputDir, f)); } catch {}
      }
    });

    const m3u8Path = path.join(outputDir, 'stream.m3u8').replace(/\\/g, '/');
    const segmentFilename = path.join(outputDir, 'seg%03d.ts').replace(/\\/g, '/');

    console.log(`[RTSP→HLS] Starting transcoder for device ${deviceId}`);
    console.log(`[RTSP→HLS] Input: ${rtspUrl.slice(0, 60)}...`);
    console.log(`[RTSP→HLS] Output: ${m3u8Path}`);

    const args = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy', // Copy video directly, extremely fast and low CPU
      '-an',           // Disable audio since CCTV doesn't need audio and it fails to transcode
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list+split_by_time',
      '-hls_allow_cache', '0',
      '-hls_segment_filename', segmentFilename,
      m3u8Path
    ];

    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('frame=') && !msg.includes('fps=')) {
        console.log(`[RTSP→HLS][${deviceId}] ${msg}`);
      }
    });

    proc.on('exit', (code, signal) => {
      console.log(`[RTSP→HLS] Transcoder for ${deviceId} exited (code=${code}, signal=${signal})`);
      sessions.delete(deviceId);
    });

    sessions.set(deviceId, {
      process: proc,
      outputDir,
      startedAt: Date.now(),
      deviceId,
    });

    // Wait up to 5 seconds for the first segment to appear
    await this.waitForPlaylist(deviceId, 5000);

    return this.getPublicUrl(deviceId);
  }

  private static waitForPlaylist(deviceId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const playlistPath = this.getPlaylistPath(deviceId);
      const start = Date.now();
      const check = () => {
        if (fs.existsSync(playlistPath)) return resolve();
        if (Date.now() - start > timeoutMs) return resolve(); // Timeout — proceed anyway
        setTimeout(check, 250);
      };
      check();
    });
  }

  static stop(deviceId: string): void {
    const session = sessions.get(deviceId);
    if (!session) return;
    console.log(`[RTSP→HLS] Stopping transcoder for ${deviceId}`);
    try {
      session.process.kill('SIGKILL');
    } catch {}
    sessions.delete(deviceId);
  }

  static stopAll(): void {
    for (const deviceId of sessions.keys()) {
      this.stop(deviceId);
    }
  }
}
