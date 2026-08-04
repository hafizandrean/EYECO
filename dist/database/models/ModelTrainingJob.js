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
exports.ModelTrainingJobModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ModelTrainingJobSchema = new mongoose_1.Schema({
    jobId: { type: String, required: true, unique: true, index: true },
    jobIdentityHash: { type: String, required: true, unique: true, index: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        index: true
    },
    jobEnvironment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'TEST', index: true },
    executionMode: { type: String, required: true, enum: ['STUB', 'DRY_RUN', 'ACTUAL'], default: 'STUB', index: true },
    completionType: { type: String, enum: ['SIMULATION', 'ACTUAL'], default: 'SIMULATION' },
    actualTrainingPerformed: { type: Boolean, default: false, index: true },
    actualEvaluationPerformed: { type: Boolean, default: false, index: true },
    artifactFrameworkValidationPassed: { type: Boolean, default: false },
    processPid: { type: Number, default: null },
    processExitCode: { type: Number, default: null },
    promotionEligible: { type: Boolean, default: false, index: true },
    metricsSource: { type: String, enum: ['SYNTHETIC', 'ACTUAL'], default: 'SYNTHETIC' },
    outputArtifactPath: { type: String, default: null },
    outputArtifactHash: { type: String, default: null },
    trainingExecutionResultId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'TrainingExecutionResult', default: null, index: true },
    finalizedByWorkerId: { type: String, default: null },
    datasetVersion: { type: String, required: true, index: true },
    datasetManifestHash: { type: String, required: true },
    approvedEligibilityEvaluationId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'TrainingEligibilityEvaluation', required: true },
    approvedEligibilityEvaluationHash: { type: String, required: true },
    approvedEligibilityPolicyId: { type: String, required: true },
    approvedEligibilityPolicyVersion: { type: String, required: true },
    approvedEligibilityPolicyHash: { type: String, required: true },
    datasetAssetValidationReportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'DatasetAssetValidationReport', default: null },
    datasetAssetValidationReportHash: { type: String, default: null },
    goldenDatasetVersion: { type: String, required: true, index: true },
    goldenManifestHash: { type: String, required: true },
    goldenAssetValidationReportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'DatasetAssetValidationReport', default: null },
    goldenAssetValidationReportHash: { type: String, default: null },
    goldenCompositionEvaluationId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'GoldenDatasetCompositionEvaluation', default: null },
    goldenCompositionEvaluationHash: { type: String, default: null },
    goldenOverlapAuditHash: { type: String, default: null },
    baseModelId: { type: String, default: 'yolov8n-baseline' },
    baseModelVersion: { type: String, default: 'v3.0.0' },
    baseModelArtifactHash: { type: String, default: 'sha256-base-model-hash' },
    trainingConfig: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    trainingConfigHash: { type: String, default: 'sha256-config-hash' },
    status: {
        type: String,
        required: true,
        enum: ['QUEUED', 'PREPARING_DATASET', 'TRAINING', 'EVALUATING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'CANCELLED'],
        default: 'QUEUED',
        index: true
    },
    claimToken: { type: String, default: null, index: true },
    workerId: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    cancellationRequestedAt: { type: Date, default: null },
    cancellationRequestedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, default: '' },
    simulatedMetrics: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    actualMetrics: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    failureReason: { type: String, default: '' },
    errorCode: { type: String, default: '' },
    createdByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
}, { timestamps: true });
// Pre-save hook blocking manual state mutation without authorized transaction finalizer
ModelTrainingJobSchema.pre('save', function (next) {
    if (this.isNew || this.isModified('actualTrainingPerformed') || this.isModified('status')) {
        if (this.actualTrainingPerformed || this.status === 'COMPLETED') {
            if (!this.trainingExecutionResultId || !this.outputArtifactHash || !this.outputArtifactPath || this.processExitCode !== 0) {
                const err = new Error('TRAINING_FINALIZER_REQUIRED: Cannot set status to COMPLETED or actualTrainingPerformed to true without a valid TrainingExecutionResult linked via an authorized transaction finalizer.');
                err.status = 422;
                if (typeof next === 'function')
                    return next(err);
                throw err;
            }
        }
    }
    if (typeof next === 'function')
        next();
});
exports.ModelTrainingJobModel = mongoose_1.default.model('ModelTrainingJob', ModelTrainingJobSchema);
