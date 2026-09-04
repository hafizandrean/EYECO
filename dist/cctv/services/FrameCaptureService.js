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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameCaptureService = void 0;
const Cctv_1 = require("../../database/models/Cctv");
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const TUYA_ALLOC_COOLDOWN_MS = 25 * 1000;
const lastAllocAt = new Map();
/** Run FFmpeg to extract one JPEG frame from a local file or plaintext URL. */
function extractFfmpegFrame(input, output, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const ffmpegPath = require('ffmpeg-static');
        const args = ['-y', '-loglevel', 'error', '-i', input, '-vframes', '1', '-q:v', '3', '-f', 'image2', output];
        const child = (0, child_process_1.spawn)(ffmpegPath || 'ffmpeg', args, { windowsHide: true });
        const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(false); }, timeoutMs);
        child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && fs_1.default.existsSync(output)); });
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
async function captureFrameFromTuyaEncryptedHLS(manifestUrl, outputPath) {
    try {
        const tmpDir = path_1.default.join(os_1.default.tmpdir(), 'eyeco-hls');
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
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
        let segBuffer;
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
        }
        else {
            // Plain (unencrypted) segment
            const segResp = await fetch(segmentUrl, { signal: AbortSignal.timeout(10000) });
            if (!segResp.ok)
                return false;
            segBuffer = Buffer.from(await segResp.arrayBuffer());
        }
        // 5. Save decrypted .ts to temp file and extract JPEG frame
        const segFile = path_1.default.join(tmpDir, `seg_${Date.now()}.ts`);
        fs_1.default.writeFileSync(segFile, segBuffer);
        console.log(`[FrameCapture] Saved decrypted segment (${segBuffer.length} bytes) → ${segFile}`);
        const ok = await extractFfmpegFrame(segFile, outputPath, 8000);
        // Cleanup
        try {
            fs_1.default.unlinkSync(segFile);
        }
        catch { /* ignore */ }
        return ok;
    }
    catch (err) {
        console.warn(`[FrameCapture] captureFrameFromTuyaEncryptedHLS error: ${err.message}`);
        return false;
    }
}
class FrameCaptureService {
    static async getActiveCamerasForMonitoring(workspaceId) {
        try {
            const query = {
                isActive: true,
                monitoringEnabled: true,
                status: { $in: ['ONLINE', 'MONITORING'] }
            };
            if (workspaceId !== undefined)
                query.workspaceId = workspaceId;
            const cameras = await Cctv_1.CctvModel.find(query);
            const now = new Date();
            for (const camera of cameras) {
                await Cctv_1.CctvModel.updateOne({ id: camera.id }, { $set: { lastFrameAt: now } });
            }
            return cameras;
        }
        catch (err) {
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
    static async captureFrame(camera) {
        const tempDir = path_1.default.join(os_1.default.tmpdir(), 'eyeco');
        if (!fs_1.default.existsSync(tempDir))
            fs_1.default.mkdirSync(tempDir, { recursive: true });
        const outputPath = path_1.default.join(tempDir, `cctv_capture_${camera.id}.jpg`);
        // Detect Tuya/Krisbow device ID
        let deviceId = '';
        if (camera.playUrl?.includes('/hls-proxy/')) {
            const m = camera.playUrl.match(/\/hls-proxy\/([a-zA-Z0-9]+)\//);
            if (m)
                deviceId = m[1];
        }
        if (!deviceId && camera.description) {
            const m = camera.description.match(/Virtual ID[:\s]+([a-zA-Z0-9]+)/);
            if (m)
                deviceId = m[1];
            else if (camera.description.includes('Tuya Device ID:'))
                deviceId = camera.description.split('Tuya Device ID:')[1].trim().split(/\s/)[0];
        }
        if (deviceId) {
            // 1. Try local RTSP-transcoded HLS (legacy/fast path)
            const hlsPlaylist = path_1.default.join(process.cwd(), 'public/hls', deviceId, 'stream.m3u8');
            if (fs_1.default.existsSync(hlsPlaylist) && fs_1.default.readFileSync(hlsPlaylist, 'utf8').includes('.ts')) {
                const ok = await extractFfmpegFrame(hlsPlaylist, outputPath);
                if (ok)
                    return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputPath };
            }
            // 2. Get Tuya Cloud HLS URL and capture frame via native decryption
            const last = lastAllocAt.get(deviceId) || 0;
            const cooldownActive = Date.now() - last < TUYA_ALLOC_COOLDOWN_MS;
            if (!cooldownActive)
                lastAllocAt.set(deviceId, Date.now());
            try {
                const { TuyaClient } = require('./TuyaClient');
                const client = new TuyaClient(process.env.TUYA_CLIENT_ID || 'vhxcdfe5q7d5vr4wsgs3', process.env.TUYA_CLIENT_SECRET || '0757b40d43884b83952b3b306814fba9', process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com');
                // Always reuse active cached stream URL to prevent triggering new Tuya P2P allocations
                const tuyaHlsUrl = await client.getStreamUrl(deviceId, 'HLS', false);
                if (tuyaHlsUrl?.startsWith('http')) {
                    console.log(`[FrameCapture] Capturing frame from Tuya Cloud HLS for ${deviceId}...`);
                    const ok = await captureFrameFromTuyaEncryptedHLS(tuyaHlsUrl, outputPath);
                    if (ok)
                        return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputPath };
                    console.warn(`[FrameCapture] Native HLS frame grab failed for ${deviceId}.`);
                }
            }
            catch (e) {
                console.warn(`[FrameCapture] TuyaClient error for ${deviceId}: ${e.message}`);
            }
            throw new Error(`Kamera #${camera.id} gagal menangkap frame dari Tuya Cloud stream.`);
        }
        // 3. Generic RTSP/HLS fallback
        const streamUrl = camera.playUrl || camera.streamUrl;
        if (streamUrl && (streamUrl.startsWith('rtsp') || streamUrl.includes('m3u8') || streamUrl.startsWith('http'))) {
            const ok = await extractFfmpegFrame(streamUrl, outputPath);
            if (ok)
                return { cameraId: camera.id, location: camera.location, timestamp: new Date(), imagePath: outputPath };
        }
        throw new Error(`Kamera #${camera.id} offline atau gagal menangkap frame.`);
    }
}
exports.FrameCaptureService = FrameCaptureService;
