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
exports.AiSnapshotModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiSnapshotSchema = new mongoose_1.Schema({
    analysisId: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, index: true },
    inputImageHash: { type: String, required: true, index: true },
    imagePath: { type: String, required: true },
    pipelineVersion: { type: String, required: true, default: 'v3.0.0' },
    featureSchemaVersion: { type: String, required: true, default: 'feature-v1' },
    modelRegistryInfo: {
        yoloVersion: { type: String, default: 'v8.2.0-yolov8n' },
        poseVersion: { type: String, default: 'yolov8n-pose-v1.0' },
        sceneVersion: { type: String, default: 'SpatialAnalyzer-v1.0' },
        decisionVersion: { type: String, default: 'RuleEngine-v1.0' },
        datasetVersion: { type: String, default: 'dataset-v1.0' },
        featureSchemaVersion: { type: String, default: 'feature-v1' },
        policyVersion: { type: String, default: 'policy-v1.0' },
    },
    featureVector: { type: mongoose_1.Schema.Types.Mixed, required: true },
    evidenceItems: { type: mongoose_1.Schema.Types.Mixed, required: true, default: [] },
    decision: { type: mongoose_1.Schema.Types.Mixed, required: true },
    limitations: [{ type: String }],
    pipelineTrace: { type: mongoose_1.Schema.Types.Mixed, default: null },
    parentSnapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
}, { timestamps: true });
// Idempotency compound index (Guardrail #7)
AiSnapshotSchema.index({ reportId: 1, inputImageHash: 1, pipelineVersion: 1 });
// Enforce Immutability
AiSnapshotSchema.pre('save', function () {
    if (!this.isNew) {
        throw new Error('[IMMUTABLE_ERROR] AiSnapshot is immutable and cannot be modified after creation.');
    }
});
exports.AiSnapshotModel = mongoose_1.default.model('AiSnapshot', AiSnapshotSchema);
