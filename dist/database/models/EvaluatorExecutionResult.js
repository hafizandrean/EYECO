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
exports.EvaluatorExecutionResultModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const EvaluatorExecutionResultSchema = new mongoose_1.Schema({
    executionId: { type: String, required: true, unique: true, index: true },
    testRunId: { type: String, default: null, index: true },
    trainingJobId: { type: String, required: true, index: true },
    trainingExecutionResultId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'TrainingExecutionResult', default: null },
    metricVerificationResultId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'MetricVerificationResult', default: null },
    candidateArtifactHash: { type: String, required: true },
    candidateArtifactPath: { type: String, required: true },
    baselineModelRegistryId: { type: String, required: true },
    baselineArtifactHash: { type: String, required: true },
    baselineArtifactPath: { type: String, required: true },
    evaluationManifestHash: { type: String, required: true },
    evaluationManifestPath: { type: String, required: true },
    groundTruthManifestHash: { type: String, required: true },
    groundTruthManifestPath: { type: String, required: true },
    trainerScriptHash: { type: String, default: null },
    validatorScriptHash: { type: String, default: null },
    evaluatorScriptHash: { type: String, required: true },
    commandArgumentsHash: { type: String, default: null },
    processPid: { type: Number, required: true },
    exitCode: { type: Number, required: true },
    candidatePredictionManifestHash: { type: String, required: true },
    candidatePredictionManifestPath: { type: String, required: true },
    baselinePredictionManifestHash: { type: String, required: true },
    baselinePredictionManifestPath: { type: String, required: true },
    evaluationMetricsFileHash: { type: String, required: true },
    evaluationMetricsFilePath: { type: String, required: true },
    trustedFinalizerId: { type: String, default: 'SERVICE_EVALUATOR_FINALIZER_V1' },
    resultHash: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
function blockMutation(next) {
    const err = new Error('EVALUATOR_RESULT_IMMUTABLE: EvaluatorExecutionResult documents are strictly append-only. Modification and deletion are REJECTED.');
    err.status = 422;
    if (next)
        next(err);
    else
        throw err;
}
// Immutability Guard Pre-Save Middleware
EvaluatorExecutionResultSchema.pre('save', function (next) {
    if (!this.isNew) {
        return blockMutation(next);
    }
    if (typeof next === 'function')
        next();
});
// Immutability Guard Query Middlewares
const queryMutationHandler = function (next) {
    blockMutation(next);
};
EvaluatorExecutionResultSchema.pre('updateOne', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('updateMany', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('findOneAndUpdate', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('replaceOne', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('deleteOne', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('deleteMany', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('findOneAndDelete', queryMutationHandler);
exports.EvaluatorExecutionResultModel = mongoose_1.default.model('EvaluatorExecutionResult', EvaluatorExecutionResultSchema);
