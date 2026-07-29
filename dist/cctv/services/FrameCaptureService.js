"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameCaptureService = void 0;
const Cctv_1 = require("../../database/models/Cctv");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function extractFfmpegFrame(input, output) {
    return new Promise((resolve) => {
        const ffmpegPath = require('ffmpeg-static');
        const args = [
            '-y',
            '-loglevel', 'error',
            '-ss', '00:00:00',
            '-i', input,
            '-vframes', '1',
            '-f', 'image2',
            output
        ];
        const child = (0, child_process_1.spawn)(ffmpegPath || 'ffmpeg', args, { windowsHide: true });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            resolve(false);
        }, 8000); // 8s timeout limit
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve(code === 0 && fs_1.default.existsSync(output));
        });
        child.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}
class FrameCaptureService {
    /**
     * Selects active cameras that are online and have monitoring enabled.
     * Updates the camera's `lastFrameAt` timestamp to track performance.
     * If workspaceId is provided, only returns cameras in that workspace.
     */
    static async getActiveCamerasForMonitoring(workspaceId) {
        try {
            const query = {
                isActive: true,
                monitoringEnabled: true,
                status: { $in: ['ONLINE', 'MONITORING'] }
            };
            if (workspaceId !== undefined) {
                query.workspaceId = workspaceId;
            }
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
     * Captures a frame from a camera stream.
     * Uses the camera's playUrl or streamUrl for real streams,
     * falls back to a static image if no stream URL is available.
     */
    static async captureFrame(camera) {
        const outputRelativePath = `/uploads/cctv_capture_${camera.id}.jpg`;
        const outputAbsolutePath = path_1.default.join(process.cwd(), 'public', outputRelativePath);
        // Ensure uploads directory exists
        const uploadsDir = path_1.default.dirname(outputAbsolutePath);
        if (!fs_1.default.existsSync(uploadsDir)) {
            fs_1.default.mkdirSync(uploadsDir, { recursive: true });
        }
        let deviceId = '';
        if (camera.playUrl && camera.playUrl.includes('/hls-proxy/')) {
            const match = camera.playUrl.match(/\/hls-proxy\/([a-zA-Z0-9_]+)\//);
            if (match)
                deviceId = match[1];
        }
        else if (camera.description && camera.description.includes('Tuya Device ID:')) {
            deviceId = camera.description.split('Tuya Device ID:')[1].trim();
        }
        if (deviceId) {
            // Tuya Camera - local HLS segment capture
            const hlsPlaylist = path_1.default.join(process.cwd(), 'public/hls', deviceId, 'stream.m3u8');
            if (fs_1.default.existsSync(hlsPlaylist)) {
                console.log(`[FrameCapture] Extracting frame from local Tuya HLS playlist: ${hlsPlaylist}`);
                const success = await extractFfmpegFrame(hlsPlaylist, outputAbsolutePath);
                if (success) {
                    return {
                        cameraId: camera.id,
                        location: camera.location,
                        timestamp: new Date(),
                        imagePath: outputRelativePath,
                    };
                }
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
exports.FrameCaptureService = FrameCaptureService;
