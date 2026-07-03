"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIEngineFactory = void 0;
const MockAIEngine_1 = require("./MockAIEngine");
const OnnxAIEngine_1 = require("./OnnxAIEngine");
const FastApiAIEngine_1 = require("./FastApiAIEngine");
class AIEngineFactory {
    static createEngine(type) {
        const normalized = (type || 'MOCK').toUpperCase();
        switch (normalized) {
            case 'ONNX':
                return new OnnxAIEngine_1.OnnxAIEngine();
            case 'FASTAPI':
                return new FastApiAIEngine_1.FastApiAIEngine();
            default:
                return new MockAIEngine_1.MockAIEngine();
        }
    }
}
exports.AIEngineFactory = AIEngineFactory;
