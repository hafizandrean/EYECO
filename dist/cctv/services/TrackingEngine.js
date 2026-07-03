"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackingEngine = void 0;
class TrackingEngine {
    name = 'Spatial IoU Matching Tracker';
    track(rawDetections) {
        return rawDetections.map((det, idx) => {
            const trackId = `tr-${det.class.substring(0, 1)}-${Math.floor(Math.random() * 1000)}`;
            return {
                class: det.class,
                confidence: det.confidence,
                bbox: det.bbox,
                trackId
            };
        });
    }
    reset() {
        // Reset tracker states
    }
}
exports.TrackingEngine = TrackingEngine;
