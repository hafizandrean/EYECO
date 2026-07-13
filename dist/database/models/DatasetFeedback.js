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
exports.DatasetFeedbackModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const DatasetFeedbackSchema = new mongoose_1.Schema({
    reportId: { type: Number, required: true, index: true },
    reportObjectId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Report', required: true },
    cameraId: { type: Number, required: true, index: true },
    imageHash: { type: String, required: true, index: true },
    imageWidth: { type: Number, required: true },
    imageHeight: { type: Number, required: true },
    originalDetections: [{
            class: { type: String, required: true },
            confidence: { type: Number, required: true },
            bbox: { type: [Number], required: true }
        }],
    groundTruth: [{
            class: { type: String, required: true },
            bbox: { type: [Number], required: true }
        }],
    modelId: { type: String, required: true, index: true },
    modelVersion: { type: String, required: true },
    operatorLabel: { type: String, required: true, enum: ['APPROVED', 'REJECTED', 'FALSE_POSITIVE', 'FALSE_NEGATIVE', 'UNCERTAIN'] },
    reviewStatus: { type: String, required: true, enum: ['PENDING', 'PROCESSED', 'REJECTED', 'APPROVED'], default: 'PENDING' },
    datasetPartition: { type: String, required: true, enum: ['TRAIN', 'VALIDATION', 'TEST', 'HOLD'], default: 'TRAIN' },
    feedbackSource: { type: String, required: true, enum: ['OPERATOR_REVIEW', 'AUTO_PROMOTION'], default: 'OPERATOR_REVIEW' },
    operatorId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    qualityScore: { type: Number, required: true, min: 0, max: 100, default: 100 },
    reviewedAt: { type: Date, required: true, default: Date.now },
    reviewedBy: { type: String, required: true },
    processedForRetraining: { type: Boolean, required: true, default: false, index: true }
}, {
    timestamps: true
});
exports.DatasetFeedbackModel = mongoose_1.default.model('DatasetFeedback', DatasetFeedbackSchema);
