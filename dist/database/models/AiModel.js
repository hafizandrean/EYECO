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
exports.AiModelModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiModelSchema = new mongoose_1.Schema({
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    version: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    checksum: { type: String, default: '' },
    artifactSize: { type: Number, default: 0 },
    minimumPython: { type: String, default: '3.8' },
    minimumCuda: { type: String, default: '' },
    minimumTorch: { type: String, default: '' },
    minimumUltralytics: { type: String, default: '' },
    framework: { type: String, default: 'YOLOv8' },
    supportedTasks: { type: [String], default: ['DETECTION'] },
    modelLoadLatencyMs: { type: Number, default: 0 },
    warmupLatencyMs: { type: Number, default: 0 },
    isRollbackCandidate: { type: Boolean, default: false },
    workerId: { type: String, default: 'gpu-worker-01' }
}, {
    timestamps: true
});
exports.AiModelModel = mongoose_1.default.model('AiModel', AiModelSchema);
