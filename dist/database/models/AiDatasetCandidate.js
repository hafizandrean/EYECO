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
exports.AiDatasetCandidateModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ScoreBreakdownItemSchema = new mongoose_1.Schema({
    reason: { type: String, required: true },
    delta: { type: Number, required: true },
    evidenceId: { type: String, default: undefined }
}, { _id: false });
const ConditionMetadataSchema = new mongoose_1.Schema({
    lighting: { type: String, enum: ['DAY', 'NIGHT', 'UNKNOWN'], default: 'UNKNOWN' },
    weather: { type: String, enum: ['CLEAR', 'RAIN', 'UNKNOWN'], default: 'UNKNOWN' },
    blurLevel: { type: Number, default: null },
    objectScale: { type: String, enum: ['SMALL', 'MEDIUM', 'LARGE'], default: 'MEDIUM' },
    activityContext: { type: String, enum: ['DUMPING', 'CARRYING', 'PASSING', 'PRE_EXISTING_TRASH', 'OTHER'], default: 'OTHER' },
    samplingSource: { type: String, enum: ['OPERATIONAL_FEEDBACK', 'INDEPENDENT_WINDOW'], default: 'OPERATIONAL_FEEDBACK' },
    sampledAt: { type: Date, default: null },
    cameraId: { type: String, default: '' },
    sourceVideoHash: { type: String, default: '' },
    incidentId: { type: String, default: '' },
    trackingSessionId: { type: String, default: '' },
    verifiedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    metadataPolicyVersion: { type: String, default: 'v1.0.0' }
}, { _id: false });
const AiDatasetCandidateSchema = new mongoose_1.Schema({
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, required: true, index: true },
    reportObjectId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Report', default: null },
    snapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', required: true, index: true },
    validationLogId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiValidationLog', default: null },
    validationVersion: { type: Number, default: 1, required: true },
    selectorVersion: { type: String, default: 'v1.0.0', required: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        index: true
    },
    candidateScore: { type: Number, required: true, min: 0, max: 100 },
    scoreBreakdown: { type: [ScoreBreakdownItemSchema], default: [] },
    selectionReasons: { type: [String], default: [] },
    operatorDecision: { type: String, default: '' },
    predictedStatus: { type: String, default: '' },
    predictedScore: { type: Number, default: null },
    inputImageHash: { type: String, required: true, index: true },
    parentImageHash: { type: String, default: '' },
    sourceVideoHash: { type: String, default: '' },
    incidentId: { type: String, default: '' },
    conditionMetadata: { type: ConditionMetadataSchema, default: null },
    approvalStatus: {
        type: String,
        required: true,
        enum: ['PENDING_APPROVAL', 'APPROVED', 'RESERVED_FOR_BUILD', 'REJECTED', 'ASSIGNED_TO_DATASET'],
        default: 'PENDING_APPROVAL',
        index: true
    },
    datasetUsageRole: {
        type: String,
        enum: ['TRAINING_POSITIVE', 'TRAINING_NEGATIVE', 'CORRECTION', 'EXCLUDED', 'HUMAN_REVIEW', 'GOLDEN_EVALUATION'],
        default: null,
        index: true
    },
    approvedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    approvalNotes: { type: String, default: '' },
    isCurrentEvaluation: { type: Boolean, default: true, index: true },
    supersededAt: { type: Date, default: null },
    supersededByCandidateId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiDatasetCandidate', default: null },
    assignedDatasetVersion: { type: String, default: null, index: true },
    assignedAt: { type: Date, default: null },
    feedbackRevision: { type: Number, default: 0 },
    lastValidationEventId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AdminValidationEvent', default: null },
    evaluatedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null }
}, { timestamps: true });
// Compound Unique Index: Includes validationVersion & selectorVersion
AiDatasetCandidateSchema.index({ snapshotId: 1, targetModel: 1, selectorVersion: 1, validationVersion: 1 }, { unique: true });
exports.AiDatasetCandidateModel = mongoose_1.default.model('AiDatasetCandidate', AiDatasetCandidateSchema);
