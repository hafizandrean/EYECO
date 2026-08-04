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
exports.AiDatasetVersionModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const DatasetAnnotationSchema = new mongoose_1.Schema({
    className: { type: String, required: true },
    bbox: { type: [Number], required: true },
    confidence: { type: Number, default: 1.0 },
    annotationSource: { type: String, required: true, enum: ['OPERATOR_GROUND_TRUTH', 'AI_PREDICTION'], default: 'OPERATOR_GROUND_TRUTH' }
}, { _id: false });
const DatasetManifestItemSchema = new mongoose_1.Schema({
    candidateId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiDatasetCandidate', required: true },
    snapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', required: true },
    validationLogId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiValidationLog', default: null },
    reportId: { type: Number, required: true },
    split: { type: String, required: true, enum: ['TRAIN', 'VAL', 'TEST'] },
    groupKey: { type: String, required: true },
    inputImageHash: { type: String, required: true },
    parentImageHash: { type: String, default: '' },
    sourceVideoHash: { type: String, default: '' },
    incidentId: { type: String, default: '' },
    cameraId: { type: String, default: '' },
    imagePath: { type: String, required: true },
    operatorDecision: { type: String, required: true },
    annotations: { type: [DatasetAnnotationSchema], default: [] }
}, { _id: false });
const AiDatasetVersionSchema = new mongoose_1.Schema({
    datasetVersion: { type: String, required: true, unique: true, index: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        index: true
    },
    builderVersion: { type: String, default: 'v3.0.0', required: true },
    splitStrategyVersion: { type: String, default: 'v1.0-deterministic-group', required: true },
    splitSeed: { type: String, default: 'eyeco-seed-2026', required: true },
    manifestHash: { type: String, required: true },
    status: {
        type: String,
        required: true,
        enum: ['BUILDING', 'DRAFT', 'INSUFFICIENT_DATA', 'READY', 'INVALID', 'ARCHIVED'],
        default: 'BUILDING',
        index: true
    },
    structurallyValid: { type: Boolean, default: false, index: true },
    trainingEligibilityStatus: {
        type: String,
        required: true,
        enum: ['PENDING_GATE', 'ELIGIBLE', 'NOT_ELIGIBLE'],
        default: 'NOT_ELIGIBLE',
        index: true
    },
    trainingEligible: { type: Boolean, default: false, index: true },
    approvedEligibilityEvaluationId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'TrainingEligibilityEvaluation', default: null },
    approvedEligibilityPolicyVersion: { type: String, default: null },
    approvedEligibilityEvaluationHash: { type: String, default: null },
    isTestData: { type: Boolean, default: false, index: true },
    splitCounts: {
        train: { type: Number, default: 0 },
        val: { type: Number, default: 0 },
        test: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
    },
    leakageCheckStatus: { type: String, required: true, enum: ['PASSED', 'FAILED'], default: 'PASSED' },
    leakageCheckDetails: {
        crossSplitGroupLeaks: { type: Number, default: 0 },
        crossSplitHashLeaks: { type: Number, default: 0 },
        crossSplitParentLeaks: { type: Number, default: 0 },
        crossSplitIncidentLeaks: { type: Number, default: 0 }
    },
    includedCandidateIds: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'AiDatasetCandidate' }],
    manifestItems: [DatasetManifestItemSchema],
    createdByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
// Document Save Immutability Guard
AiDatasetVersionSchema.pre('save', function () {
    if (!this.isNew && ['READY', 'INSUFFICIENT_DATA', 'INVALID', 'ARCHIVED'].includes(this.status)) {
        if (this.isModified('manifestItems') || this.isModified('manifestHash') || this.isModified('splitCounts')) {
            throw new Error('AI_DATASET_VERSION_IMMUTABLE: Cannot modify manifest items or hash on completed dataset version');
        }
    }
});
// Query Mutation Immutability Guard: Block updateOne, updateMany, findOneAndUpdate, findByIdAndUpdate, replaceOne
const blockMutationQueries = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findByIdAndUpdate', 'replaceOne'];
blockMutationQueries.forEach(queryName => {
    AiDatasetVersionSchema.pre(queryName, function () {
        const update = this.getUpdate();
        if (update && (update.manifestItems || update.$set?.manifestItems || update.manifestHash || update.$set?.manifestHash)) {
            throw new Error(`AI_DATASET_VERSION_IMMUTABLE: Operation ${queryName} blocked on dataset version manifest`);
        }
    });
});
exports.AiDatasetVersionModel = mongoose_1.default.model('AiDatasetVersion', AiDatasetVersionSchema);
