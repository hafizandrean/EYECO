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

    // Create placeholder m3u8 file immediately so GET /hls/:id/stream.m3u8 never returns 404
    const initPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n';
    try { fs.writeFileSync(m3u8Path, initPlaylist); } catch {}

    console.log(`[RTSP→HLS] Starting transcoder for device ${deviceId}`);
    console.log(`[RTSP→HLS] Input: ${rtspUrl.slice(0, 60)}...`);
    console.log(`[RTSP→HLS] Output: ${m3u8Path}`);

    const args = [
      '-loglevel', 'warning'
    ];

    if (rtspUrl.startsWith('rtsp://') || rtspUrl.startsWith('rtsps://')) {
      args.push('-rtsp_transport', 'tcp');
    }
    if (rtspUrl.startsWith('rtsps://')) {
      args.push('-tls_verify', '0');
    }

    args.push(
      '-i', rtspUrl,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list+omit_endlist+temp_file',
      '-hls_segment_filename', segmentFilename,
      m3u8Path
    );

    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('frame=') && !msg.includes('fps=')) {
        console.log(`[RTSP→HLS][${deviceId}] ${msg}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[RTSP→HLS] Spawn error for ${deviceId}: ${err.message}`);
      sessions.delete(deviceId);
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

    // Wait for initial segment generation (up to 45s)
    await this.waitForFirstSegment(deviceId, 45000);

    if (this.isRunning(deviceId)) {
      return this.getPublicUrl(deviceId);
    }

    throw new Error('Transcoder FFmpeg exited prematurely (device offline or stream error)');
  }

  // Waits until stream.m3u8 exists AND contains at least one .ts segment.
  // ffmpeg writes the playlist header before the first segment is ready,
  // so "file exists" alone is not enough — the browser would 404 on .ts chunks.
  private static waitForFirstSegment(deviceId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const playlistPath = this.getPlaylistPath(deviceId);
      const outputDir = this.getOutputDir(deviceId);
      const start = Date.now();

      const check = () => {
        try {
          if (fs.existsSync(playlistPath)) {
            const content = fs.readFileSync(playlistPath, 'utf8');
            if (/\.ts/.test(content)) return resolve(true);
          }
          if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir);
            if (files.some(f => f.endsWith('.ts'))) return resolve(true);
          }
        } catch { /* checking */ }

        const session = sessions.get(deviceId);
        if (!session || session.process.exitCode !== null) {
          return resolve(false);
        }

        if (Date.now() - start > timeoutMs) {
          return resolve(this.isRunning(deviceId));
        }
        setTimeout(check, 400);
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