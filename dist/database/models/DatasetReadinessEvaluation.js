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
exports.DatasetReadinessEvaluationModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const DatasetReadinessBreakdownSchema = new mongoose_1.Schema({
    totalCandidates: { type: Number, required: true },
    positiveCount: { type: Number, required: true },
    negativeCount: { type: Number, required: true },
    dayCount: { type: Number, required: true },
    nightCount: { type: Number, required: true },
    smallObjectCount: { type: Number, required: true },
    blurCount: { type: Number, required: true },
    independentWindowCount: { type: Number, required: true },
    cameraLocationCount: { type: Number, required: true }
}, { _id: false });
const DatasetReadinessEvaluationSchema = new mongoose_1.Schema({
    evaluationId: { type: String, required: true, unique: true, index: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        default: 'OBJECT_DETECTOR',
        index: true
    },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'STAGING', index: true },
    policyId: { type: String, required: true },
    policyVersion: { type: String, required: true },
    policyHash: { type: String, required: true },
    readyForTraining: { type: Boolean, required: true, index: true },
    overallReadinessPercentage: { type: Number, required: true },
    breakdown: { type: DatasetReadinessBreakdownSchema, required: true },
    unsatisfiedRuleReasons: { type: [String], default: [] },
    evaluatedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    resultHash: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    if (next)
        next(err);
    else
        throw err;
}
DatasetReadinessEvaluationSchema.pre('updateOne', function (next) {
    blockMutation('MUTATION_FORBIDDEN: DatasetReadinessEvaluation document is immutable and append-only.', next);
});
DatasetReadinessEvaluationSchema.pre('deleteOne', function (next) {
    blockMutation('DELETION_FORBIDDEN: DatasetReadinessEvaluation document is immutable.', next);
});
exports.DatasetReadinessEvaluationModel = mongoose_1.default.model('DatasetReadinessEvaluation', DatasetReadinessEvaluationSchema);
