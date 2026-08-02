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
exports.TrainingEligibilityPolicyModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const TrainingEligibilityPolicyConfigSchema = new mongoose_1.Schema({
    minimumTotalSamples: { type: Number, required: true },
    minimumTrainSamples: { type: Number, required: true },
    minimumValidationSamples: { type: Number, required: true },
    minimumTestSamples: { type: Number, required: true },
    minimumIndependentGroups: { type: Number, required: true },
    minimumSamplesPerClass: { type: Number, required: true },
    minimumCameraCount: { type: Number, required: true },
    minimumLocationCount: { type: Number, required: true }
}, { _id: false });
const TrainingEligibilityPolicySchema = new mongoose_1.Schema({
    policyId: { type: String, required: true, unique: true, index: true },
    policyVersion: { type: String, required: true, index: true },
    policyHash: { type: String, required: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        index: true
    },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'TEST', index: true },
    status: { type: String, required: true, enum: ['DRAFT', 'APPROVED', 'RETIRED'], default: 'DRAFT', index: true },
    configuration: { type: TrainingEligibilityPolicyConfigSchema, required: true },
    approvedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
}, { timestamps: true });
exports.TrainingEligibilityPolicyModel = mongoose_1.default.model('TrainingEligibilityPolicy', TrainingEligibilityPolicySchema);
