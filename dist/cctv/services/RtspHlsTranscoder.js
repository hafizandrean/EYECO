"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RtspHlsTranscoder = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const sessions = new Map();
const HLS_OUTPUT_BASE = path.join(process.cwd(), 'public', 'hls');
class RtspHlsTranscoder {
    static getOutputDir(deviceId) {
        return path.join(HLS_OUTPUT_BASE, deviceId);
    }
    static getPlaylistPath(deviceId) {
        return path.join(this.getOutputDir(deviceId), 'stream.m3u8');
    }
    static getPublicUrl(deviceId) {
        return `/hls/${deviceId}/stream.m3u8`;
    }
    static isRunning(deviceId) {
        const session = sessions.get(deviceId);
        if (!session)
            return false;
        if (session.process.exitCode !== null) {
            sessions.delete(deviceId);
            return false;
        }
        return true;
    }
    static async start(deviceId, rtspUrl) {
        // Stop existing session if running
        this.stop(deviceId);
        const outputDir = this.getOutputDir(deviceId);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        // Clean stale HLS segments
        fs.readdirSync(outputDir).forEach(f => {
            if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
                try {
                    fs.unlinkSync(path.join(outputDir, f));
                }
                catch { }
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
            '-an', // Disable audio since CCTV doesn't need audio and it fails to transcode
            '-f', 'hls',
            '-hls_time', '2',
            '-hls_list_size', '10',
            '-hls_flags', 'delete_segments+append_list+split_by_time',
            '-hls_allow_cache', '0',
            '-hls_segment_filename', segmentFilename,
            m3u8Path
        ];
        const proc = (0, child_process_1.spawn)(ffmpegPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        proc.stderr?.on('data', (data) => {
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
    static waitForPlaylist(deviceId, timeoutMs) {
        return new Promise((resolve) => {
            const playlistPath = this.getPlaylistPath(deviceId);
            const start = Date.now();
            const check = () => {
                if (fs.existsSync(playlistPath))
                    return resolve();
                if (Date.now() - start > timeoutMs)
                    return resolve(); // Timeout — proceed anyway
                setTimeout(check, 250);
            };
            check();
        });
    }
    static stop(deviceId) {
        const session = sessions.get(deviceId);
        if (!session)
            return;
        console.log(`[RTSP→HLS] Stopping transcoder for ${deviceId}`);
        try {
            session.process.kill('SIGKILL');
        }
        catch { }
        sessions.delete(deviceId);
    }
    static stopAll() {
        for (const deviceId of sessions.keys()) {
            this.stop(deviceId);
        }
    }
}
exports.RtspHlsTranscoder = RtspHlsTranscoder;
