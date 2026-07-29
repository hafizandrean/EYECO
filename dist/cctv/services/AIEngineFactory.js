"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIEngineFactory = void 0;
const MockAIEngine_1 = require("./MockAIEngine");
const OnnxAIEngine_1 = require("./OnnxAIEngine");
const FastApiAIEngine_1 = require("./FastApiAIEngine");
const LocalPythonAIEngine_1 = require("./LocalPythonAIEngine");
class AIEngineFactory {
    static createEngine(type) {
        const normalized = (type || 'LOCAL_PYTHON').toUpperCase();
        switch (normalized) {
            case 'ONNX':
                return new OnnxAIEngine_1.OnnxAIEngine();
            case 'FASTAPI':
                return new FastApiAIEngine_1.FastApiAIEngine();
            case 'LOCAL_PYTHON':
                return new LocalPythonAIEngine_1.LocalPythonAIEngine();
            case 'MOCK':
                return new MockAIEngine_1.MockAIEngine();
            default:
                return new LocalPythonAIEngine_1.LocalPythonAIEngine();
        }
    }
}
exports.AIEngineFactory = AIEngineFactory;
