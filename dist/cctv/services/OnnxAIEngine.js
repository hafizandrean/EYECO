"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnnxAIEngine = void 0;
const IAIEngine_1 = require("./IAIEngine");
class OnnxAIEngine {
    name = 'ONNX Runtime Engine';
    maxBatchSize = 8;
    state = IAIEngine_1.EngineState.STARTING;
    isInitialized = false;
    async initialize(modelPath) {
        this.state = IAIEngine_1.EngineState.STARTING;
        console.log(`[OnnxAIEngine] Loading ONNX model from: ${modelPath}`);
        // Simulated load latency
        await new Promise(resolve => setTimeout(resolve, 500));
        // Model Warm-up (dummy run)
        console.log(`[OnnxAIEngine] Running model warm-up cycle with zero-array tensor...`);
        const zeroTensor = new Float32Array(1 * 3 * 640 * 640); // 3x640x640 input
        console.log(`[OnnxAIEngine] Warmup zero-tensor initialized. Length: ${zeroTensor.length} elements.`);
        await new Promise(resolve => setTimeout(resolve, 50));
        this.isInitialized = true;
        this.state = IAIEngine_1.EngineState.READY;
        console.log(`[OnnxAIEngine] Model is READY.`);
    }
    async detect(frame) {
        if (!this.isInitialized) {
            throw new Error('OnnxAIEngine is not initialized.');
        }
        // Simulated ONNX inference result
        return [
            { class: 'trash', confidence: 0.82, bbox: [20, 30, 10, 10] }
        ];
    }
    async detectBatch(frames) {
        return Promise.all(frames.map(f => this.detect(f)));
    }
}
exports.OnnxAIEngine = OnnxAIEngine;
