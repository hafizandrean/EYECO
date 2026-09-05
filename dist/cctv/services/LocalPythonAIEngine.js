"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalPythonAIEngine = void 0;
const IAIEngine_1 = require("./IAIEngine");
const aiDetection_service_1 = require("../../services/aiDetection.service");
const path_1 = __importDefault(require("path"));
class LocalPythonAIEngine {
    name = 'Local Python YOLOv8 Engine';
    maxBatchSize = 1;
    state = IAIEngine_1.EngineState.READY;
    async initialize(modelPath) {
        this.state = IAIEngine_1.EngineState.READY;
    }
    async detect(frame) {
        try {
            // frame.imagePath bisa berupa path absolut (OS temp) atau relatif ke public/
            let absoluteImagePath;
            if (path_1.default.isAbsolute(frame.imagePath)) {
                absoluteImagePath = frame.imagePath;
            }
            else {
                absoluteImagePath = path_1.default.join(process.cwd(), 'public', frame.imagePath);
            }
            const result = await (0, aiDetection_service_1.detectFile)(absoluteImagePath);
            console.log(`[LocalPythonAIEngine] Camera #${frame.cameraId} | Path: ${absoluteImagePath} | Boxes: ${JSON.stringify(result.boxes?.length ?? 0)}`);
            // Map AiStatusResult boxes: { label: string, confidence: number, x: number, y: number, w: number, h: number }
            // to IDetectionResult: { class: string, confidence: number, bbox: [number, number, number, number] }
            return (result.boxes || []).map(b => ({
                class: b.label,
                confidence: b.confidence,
                bbox: [b.x, b.y, b.w, b.h] // [x, y, w, h] format expected by system
            }));
        }
        catch (err) {
            console.error('[LocalPythonAIEngine] Detection failed:', err.message);
            return [];
        }
    }
    async detectBatch(frames) {
        return Promise.all(frames.map(f => this.detect(f)));
    }
}
exports.LocalPythonAIEngine = LocalPythonAIEngine;
