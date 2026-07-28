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
exports.VideoAnalysisJobModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const VideoAnalysisJobSchema = new mongoose_1.Schema({
    sourceVideoId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    sourceVideoHash: { type: String, required: true },
    sourceStorageKey: { type: String, required: true },
    status: {
        type: String,
        enum: ['QUEUED', 'PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'],
        required: true,
        default: 'QUEUED',
        index: true
    },
    progressStage: {
        type: String,
        enum: ['VALIDATING', 'DECODING', 'ANALYZING', 'GROUPING', 'GENERATING_EVIDENCE', 'PERSISTING_RESULTS', 'FINISHED'],
        required: true,
        default: 'VALIDATING'
    },
    totalFrames: { type: Number, default: 0 },
    decodedFrames: { type: Number, required: true, default: 0 },
    analyzedFrames: { type: Number, required: true, default: 0 },
    processedIncidents: { type: Number, required: true, default: 0 },
    incidentCount: { type: Number, required: true, default: 0 },
    progressPercent: { type: Number, required: true, default: 0 },
    analysisRunId: { type: String, required: true, index: true },
    schemaVersion: { type: String, required: true, default: '3.0' },
    modelRegistry: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    configurationHash: { type: String, default: '' },
    attemptCount: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    workerId: { type: String, default: null },
    claimToken: { type: String, default: null },
    heartbeatAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, required: true, default: Date.now },
    resultManifestPath: { type: String, default: null },
    resultManifestHash: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorDetails: { type: String, default: null },
    warnings: { type: [String], default: [] },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    correlationId: { type: String, required: true }
}, { timestamps: true });
// Compound index for optimal querying & claiming (Rule index queue)
VideoAnalysisJobSchema.index({ status: 1, nextAttemptAt: 1, leaseExpiresAt: 1, createdAt: 1 });
exports.VideoAnalysisJobModel = mongoose_1.default.model('VideoAnalysisJob', VideoAnalysisJobSchema);
