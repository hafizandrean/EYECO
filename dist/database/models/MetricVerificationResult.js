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
exports.MetricVerificationResultModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const MetricVerificationResultSchema = new mongoose_1.Schema({
    verificationId: { type: String, required: true, unique: true, index: true },
    evaluatorExecutionResultId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'EvaluatorExecutionResult', required: true, index: true },
    predictionManifestHash: { type: String, required: true },
    groundTruthManifestHash: { type: String, required: true },
    evaluationPolicyHash: { type: String, required: true },
    independentVerifierScriptHash: { type: String, required: true },
    runtimeEnvironmentHash: { type: String, required: true },
    processPid: { type: Number, required: true },
    exitCode: { type: Number, required: true },
    independentMetrics: {
        precision: { type: Number, required: true },
        recall: { type: Number, required: true },
        ap50: { type: Number, required: true },
        map50_95: { type: Number, required: true },
        perClassAp: { type: mongoose_1.Schema.Types.Mixed, required: true, default: {} },
        smallObjectRecall: { type: Number, required: true }
    },
    primaryMetricsHash: { type: String, required: true },
    metricDelta: { type: mongoose_1.Schema.Types.Mixed, required: true, default: {} },
    parityPassed: { type: Boolean, required: true },
    tolerancePolicyId: { type: String, required: true, default: 'policy-parity-v1' },
    resultHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    err.status = 422;
    if (typeof next === 'function') {
        return next(err);
    }
    throw err;
}
MetricVerificationResultSchema.pre('save', function (next) {
    if (!this.isNew) {
        return blockMutation('METRIC_VERIFICATION_RESULT_IMMUTABLE: MetricVerificationResult documents are strictly append-only. Modification and deletion are REJECTED.', next);
    }
    if (typeof next === 'function')
        next();
});
const queryBlocker = function (next) {
    blockMutation('METRIC_VERIFICATION_RESULT_IMMUTABLE: MetricVerificationResult documents are strictly append-only. Modification and deletion are REJECTED.', next);
};
MetricVerificationResultSchema.pre('updateOne', queryBlocker);
MetricVerificationResultSchema.pre('updateMany', queryBlocker);
MetricVerificationResultSchema.pre('findOneAndUpdate', queryBlocker);
MetricVerificationResultSchema.pre('replaceOne', queryBlocker);
MetricVerificationResultSchema.pre('deleteOne', queryBlocker);
MetricVerificationResultSchema.pre('deleteMany', queryBlocker);
MetricVerificationResultSchema.pre('findOneAndDelete', queryBlocker);
MetricVerificationResultSchema.pre('bulkWrite', queryBlocker);
exports.MetricVerificationResultModel = mongoose_1.default.model('MetricVerificationResult', MetricVerificationResultSchema);
