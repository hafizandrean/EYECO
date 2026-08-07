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
exports.StatisticalModelEvaluationModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const BootstrapConfidenceIntervalSchema = new mongoose_1.Schema({
    lower: { type: Number, required: true },
    upper: { type: Number, required: true },
    confidenceLevel: { type: Number, required: true, default: 0.95 }
}, { _id: false });
const CctvOperationalMetricsSchema = new mongoose_1.Schema({
    fpPer1000Frames: { type: Number, required: true },
    fpPerHour: { type: Number, required: true },
    fpPerCameraDay: { type: Number, required: true },
    missedViolationCount: { type: Number, required: true },
    missedViolationsPerCameraHour: { type: Number, required: true },
    eventRecall: { type: Number, required: true }
}, { _id: false });
const SubgroupEvaluationResultSchema = new mongoose_1.Schema({
    subgroup: { type: String, required: true },
    itemCount: { type: Number, required: true },
    candidateValue: { type: Number, required: true },
    baselineValue: { type: Number, required: true },
    deltaValue: { type: Number, required: true },
    status: { type: String, required: true, enum: ['PASS', 'REGRESSION', 'INSUFFICIENT_DATA'] },
    reason: { type: String }
}, { _id: false });
const StatisticalModelEvaluationSchema = new mongoose_1.Schema({
    evaluationId: { type: String, required: true, unique: true, index: true },
    jobId: { type: String, required: true, index: true },
    candidateModelId: { type: String, required: true, index: true },
    candidateArtifactHash: { type: String, required: true },
    baselineModelId: { type: String, required: true, index: true },
    baselineArtifactHash: { type: String, required: true },
    goldenDatasetVersion: { type: String, required: true },
    goldenManifestHash: { type: String, required: true },
    candidatePredictionManifestHash: { type: String, required: true },
    baselinePredictionManifestHash: { type: String, required: true },
    groundTruthManifestHash: { type: String, required: true },
    statisticalPolicyId: { type: String, required: true },
    statisticalPolicyVersion: { type: String, required: true },
    statisticalPolicyHash: { type: String, required: true },
    bootstrapSeed: { type: Number, required: true },
    bootstrapIterations: { type: Number, required: true },
    bootstrapScriptHash: { type: String, required: true },
    statisticalDecision: {
        type: String,
        required: true,
        enum: ['SUPERIOR', 'INCONCLUSIVE', 'INFERIOR'],
        index: true
    },
    statisticallyMeaningful: { type: Boolean, required: true, index: true },
    shadowEligible: { type: Boolean, required: true, index: true },
    productionEligible: { type: Boolean, required: true, default: false, index: true },
    deploymentEligibility: {
        type: String,
        required: true,
        enum: ['NONE', 'SHADOW', 'CANARY', 'PRODUCTION'],
        default: 'NONE',
        index: true
    },
    candidateMetrics: { type: mongoose_1.Schema.Types.Mixed, required: true },
    baselineMetrics: { type: mongoose_1.Schema.Types.Mixed, required: true },
    metricDeltas: { type: mongoose_1.Schema.Types.Mixed, required: true },
    bootstrapConfidenceInterval: { type: BootstrapConfidenceIntervalSchema, required: true },
    probabilityCandidateSuperior: { type: Number, required: true },
    cctvOperationalMetrics: { type: CctvOperationalMetricsSchema, required: true },
    subgroupResults: { type: [SubgroupEvaluationResultSchema], default: [] },
    rawMetricEvidenceHash: { type: String, required: true },
    subgroupResultHash: { type: String, required: true },
    resultHash: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    if (next)
        next(err);
    else
        throw err;
}
StatisticalModelEvaluationSchema.pre('updateOne', function (next) {
    blockMutation('MUTATION_FORBIDDEN: StatisticalModelEvaluation document is immutable and append-only evidence.', next);
});
StatisticalModelEvaluationSchema.pre('deleteOne', function (next) {
    blockMutation('DELETION_FORBIDDEN: StatisticalModelEvaluation document is immutable.', next);
});
exports.StatisticalModelEvaluationModel = mongoose_1.default.model('StatisticalModelEvaluation', StatisticalModelEvaluationSchema);
