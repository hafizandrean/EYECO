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
exports.GoldenModelEvaluationModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const GoldenEvaluationGateResultSchema = new mongoose_1.Schema({
    gate: { type: String, required: true },
    passed: { type: Boolean, required: true },
    observedValue: { type: Number, required: true },
    requiredValue: { type: Number, required: true },
    reasons: { type: [String], default: [] }
}, { _id: false });
const GoldenModelEvaluationSchema = new mongoose_1.Schema({
    evaluationId: { type: String, required: true, unique: true, index: true },
    trainingJobId: { type: String, required: true, index: true },
    evaluationMode: { type: String, required: true, enum: ['SIMULATION', 'ACTUAL'], default: 'SIMULATION', index: true },
    metricsSource: { type: String, required: true, enum: ['SYNTHETIC', 'ACTUAL'], default: 'SYNTHETIC' },
    actualModelInferencePerformed: { type: Boolean, default: false },
    manifestSource: { type: String, enum: ['FIXTURE', 'ACTUAL_INFERENCE'], default: 'FIXTURE' },
    generatedByActualInference: { type: Boolean, default: false },
    resultInterpretation: { type: String, enum: ['PIPELINE_LOGIC_ONLY', 'ACTUAL_MODEL_PERFORMANCE'], default: 'PIPELINE_LOGIC_ONLY' },
    evaluationPurpose: { type: String, enum: ['PIPELINE_SMOKE_TEST', 'PROD_EVALUATION'], default: 'PIPELINE_SMOKE_TEST' },
    statisticallyMeaningful: { type: Boolean, default: false },
    candidateArtifactHash: { type: String, default: null },
    activeModelArtifactHash: { type: String, default: null },
    baselineFixtureId: { type: String, default: null },
    goldenManifestHash: { type: String, required: true },
    candidatePredictionManifestHash: { type: String, default: null },
    baselinePredictionManifestHash: { type: String, default: null },
    groundTruthManifestHash: { type: String, default: null },
    evaluatorScriptHash: { type: String, default: null },
    evaluationPolicyId: { type: String, required: true },
    evaluationPolicyVersion: { type: String, required: true },
    evaluationPolicyHash: { type: String, required: true },
    candidateMetrics: { type: mongoose_1.Schema.Types.Mixed, required: true },
    activeModelMetrics: { type: mongoose_1.Schema.Types.Mixed, required: true },
    metricDeltas: { type: mongoose_1.Schema.Types.Mixed, required: true },
    gateResults: { type: [GoldenEvaluationGateResultSchema], required: true },
    overallPassed: { type: Boolean, required: true, index: true },
    promotionEligible: { type: Boolean, required: true, index: true },
    reportHash: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
// Immutability Guard Pre-Save Middleware for Golden Evaluation Reports
GoldenModelEvaluationSchema.pre('save', function () {
    if (!this.isNew) {
        throw new Error('GOLDEN_EVALUATION_IMMUTABLE: Cannot modify append-only golden model evaluation report document after creation');
    }
});
// Immutability Guard Query Middleware
const blockQueryMutation = function () {
    throw new Error('GOLDEN_EVALUATION_IMMUTABLE: Mutation operations (updateOne, updateMany, findOneAndUpdate, replaceOne) are prohibited on GoldenModelEvaluation documents');
};
GoldenModelEvaluationSchema.pre('updateOne', blockQueryMutation);
GoldenModelEvaluationSchema.pre('updateMany', blockQueryMutation);
GoldenModelEvaluationSchema.pre('findOneAndUpdate', blockQueryMutation);
GoldenModelEvaluationSchema.pre('replaceOne', blockQueryMutation);
exports.GoldenModelEvaluationModel = mongoose_1.default.model('GoldenModelEvaluation', GoldenModelEvaluationSchema);
