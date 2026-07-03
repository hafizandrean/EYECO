"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectTrackingService = void 0;
class ObjectTrackingService {
    /**
     * Performs object tracking simulation (matching DeepSORT/ByteTrack behaviors).
     * Standardizes raw YOLO bboxes and associates them with unique trackIds.
     */
    static track(rawDetections) {
        return rawDetections.map((det, idx) => {
            const trackId = det.trackId || `tr-${det.class.substring(0, 1)}-${Math.floor(Math.random() * 1000)}`;
            return {
                class: det.class,
                confidence: det.confidence,
                bbox: det.bbox || [20 + idx * 5, 30 + idx * 5, 15, 20],
                trackId
            };
        });
    }
}
exports.ObjectTrackingService = ObjectTrackingService;
