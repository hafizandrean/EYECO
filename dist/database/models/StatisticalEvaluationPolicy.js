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
exports.StatisticalEvaluationPolicyModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const SubgroupRegressionRuleSchema = new mongoose_1.Schema({
    subgroup: { type: String, required: true },
    minimumItemsRequired: { type: Number, required: true, default: 5 },
    maximumAllowedRegression: { type: Number, required: true, default: 0.00 }
}, { _id: false });
const StatisticalEvaluationPolicyConfigSchema = new mongoose_1.Schema({
    confidenceLevel: { type: Number, required: true, default: 0.95 },
    bootstrapIterations: { type: Number, required: true, default: 1000 },
    minimumMapImprovement: { type: Number, required: true, default: 0.03 },
    maximumAllowedFprRegression: { type: Number, required: true, default: 0.00 },
    minimumEvaluationGroups: { type: Number, required: true, default: 3 },
    minimumItemsPerSubgroup: { type: Number, required: true, default: 2 },
    minimumPositiveItemsPerClass: { type: Number, required: true, default: 2 },
    minimumNegativeWindows: { type: Number, required: true, default: 2 },
    minimumCameraCount: { type: Number, required: true, default: 2 },
    subgroupRegressionRules: { type: [SubgroupRegressionRuleSchema], default: [] }
}, { _id: false });
const StatisticalEvaluationPolicySchema = new mongoose_1.Schema({
    policyId: { type: String, required: true, unique: true, index: true },
    policyVersion: { type: String, required: true, index: true },
    policyHash: { type: String, required: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        default: 'OBJECT_DETECTOR',
        index: true
    },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'STAGING', index: true },
    status: { type: String, required: true, enum: ['DRAFT', 'APPROVED', 'RETIRED'], default: 'APPROVED', index: true },
    configuration: { type: StatisticalEvaluationPolicyConfigSchema, required: true },
    approvedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
}, { timestamps: true });
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    if (next)
        next(err);
    else
        throw err;
}
StatisticalEvaluationPolicySchema.pre('updateOne', function (next) {
    blockMutation('MUTATION_FORBIDDEN: StatisticalEvaluationPolicy document is immutable and append-only once created.', next);
});
StatisticalEvaluationPolicySchema.pre('deleteOne', function (next) {
    blockMutation('DELETION_FORBIDDEN: StatisticalEvaluationPolicy document is immutable and cannot be deleted.', next);
});
exports.StatisticalEvaluationPolicyModel = mongoose_1.default.model('StatisticalEvaluationPolicy', StatisticalEvaluationPolicySchema);
