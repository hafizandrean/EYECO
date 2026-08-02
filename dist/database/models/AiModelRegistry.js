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
exports.AiModelRegistryModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiModelRegistrySchema = new mongoose_1.Schema({
    modelId: { type: String, required: true, unique: true, index: true },
    modelType: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        index: true
    },
    modelVersion: { type: String, required: true, index: true },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'TEST', index: true },
    status: {
        type: String,
        required: true,
        enum: [
            'EVALUATING',
            'REJECTED',
            'AWAITING_APPROVAL',
            'APPROVED',
            'SHADOW',
            'CANARY',
            'ACTIVE',
            'ROLLED_BACK',
            'ARCHIVED',
            'TEST_ONLY'
        ],
        default: 'TEST_ONLY',
        index: true
    },
    artifactPath: { type: String, default: null },
    artifactHash: { type: String, default: null },
    baseModelId: { type: String, required: true },
    baseModelVersion: { type: String, required: true },
    baseModelArtifactHash: { type: String, required: true },
    datasetVersion: { type: String, required: true },
    datasetManifestHash: { type: String, required: true },
    trainingJobId: { type: String, default: null },
    trainingExecutionResultId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'TrainingExecutionResult', default: null },
    rootModelImportRecordId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'RootModelImportRecord', default: null },
    eligibilityEvaluationId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'TrainingEligibilityEvaluation', default: null },
    goldenEvaluationId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'GoldenModelEvaluation', default: null },
    artifactValidationReportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'ModelArtifactValidationReport', default: null },
    metrics: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    promotionEligible: { type: Boolean, default: false, index: true },
    actualTrainingPerformed: { type: Boolean, default: false },
    actualEvaluationPerformed: { type: Boolean, default: false },
    approvedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rollbackModelId: { type: String, default: null }
}, { timestamps: true });
// Partial Unique Index: Exactly ONE ACTIVE model per modelType and environment!
AiModelRegistrySchema.index({ modelType: 1, environment: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });
exports.AiModelRegistryModel = mongoose_1.default.model('AiModelRegistry', AiModelRegistrySchema);
