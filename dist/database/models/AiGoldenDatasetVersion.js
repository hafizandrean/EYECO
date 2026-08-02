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
exports.AiGoldenDatasetVersionModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiGoldenDatasetVersionSchema = new mongoose_1.Schema({
    goldenDatasetVersion: { type: String, required: true, unique: true, index: true },
    targetModel: {
        type: String,
        required: true,
        enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
        index: true
    },
    status: {
        type: String,
        required: true,
        enum: ['BUILDING', 'INSUFFICIENT_DATA', 'READY_FOR_REVIEW', 'APPROVED', 'INVALID', 'ARCHIVED'],
        default: 'BUILDING',
        index: true
    },
    structurallyValid: { type: Boolean, default: true, index: true },
    compositionEligible: { type: Boolean, default: false, index: true },
    approvalEligible: { type: Boolean, default: false, index: true },
    manifestHash: { type: String, required: true },
    assetValidationReportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'DatasetAssetValidationReport', default: null },
    compositionEvaluationId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'GoldenDatasetCompositionEvaluation', default: null },
    itemCount: { type: Number, required: true, default: 0 },
    positiveCount: { type: Number, required: true, default: 0 },
    negativeCount: { type: Number, required: true, default: 0 },
    classDistribution: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    cameraDistribution: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    locationDistribution: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    environmentDistribution: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    manifestItems: { type: [mongoose_1.Schema.Types.Mixed], default: [] },
    approvedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
}, { timestamps: true });
// Immutability Guard Pre-Save Middleware for Golden Dataset
AiGoldenDatasetVersionSchema.pre('save', function () {
    if (!this.isNew && ['APPROVED', 'ARCHIVED'].includes(this.status)) {
        if (this.isModified('manifestItems') || this.isModified('manifestHash') || this.isModified('itemCount')) {
            throw new Error('GOLDEN_DATASET_VERSION_IMMUTABLE: Cannot modify manifest items or hash on approved golden dataset version');
        }
    }
});
exports.AiGoldenDatasetVersionModel = mongoose_1.default.model('AiGoldenDatasetVersion', AiGoldenDatasetVersionSchema);
