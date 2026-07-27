"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameCaptureService = void 0;
const Cctv_1 = require("../../database/models/Cctv");
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
    static captureFrame(camera) {
        // Try to use the camera's actual stream URL
        const streamUrl = camera.playUrl || camera.streamUrl;
        // If the camera has a valid HTTP stream/image URL, use it
        // Otherwise use a static file as fallback
        const imagePath = streamUrl && (streamUrl.startsWith('http://') || streamUrl.startsWith('https://'))
            ? streamUrl
            : `/uploads/last_capture.jpg`;
        return {
            cameraId: camera.id,
            location: camera.location,
            timestamp: new Date(),
            imagePath,
        };
    }
}
exports.FrameCaptureService = FrameCaptureService;
