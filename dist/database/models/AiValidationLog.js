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
exports.AiValidationLogModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const CorrectedObjectSchema = new mongoose_1.Schema({
    detectionId: { type: String, default: '' },
    action: { type: String, enum: ['CONFIRM', 'REMOVE', 'RELABEL', 'ADD'], required: true },
    originalClass: { type: String, default: '' },
    correctedClass: { type: String, default: '' },
    originalBbox: { type: [Number], default: [] },
    correctedBbox: { type: [Number], default: [] },
}, { _id: false });
const AiValidationLogSchema = new mongoose_1.Schema({
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, required: true, index: true },
    reportObjectId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Report', default: null },
    snapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', required: true, index: true },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    operatorUsername: { type: String, required: true },
    operatorDecision: {
        type: String,
        required: true,
        enum: [
            'CONFIRMED_LITTERING',
            'PROBABLE_LITTERING',
            'CARRYING_OBJECT',
            'DISPOSING_IN_BIN',
            'PICKING_UP_TRASH',
            'CLEANING_ACTIVITY',
            'PERSON_ONLY',
            'TRASH_ONLY',
            'NOT_ENOUGH_EVIDENCE',
            'FALSE_OBJECT_DETECTION',
            'IMAGE_QUALITY_TOO_LOW',
            'UNCERTAIN',
            'NEEDS_REVIEW',
            'OTHER'
        ],
        index: true
    },
    isLitteringConfirmed: { type: Boolean, default: null },
    correctedPriority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    correctedObjects: { type: [CorrectedObjectSchema], default: [] },
    notes: { type: String, default: '' },
    validationVersion: { type: Number, default: 1, required: true },
    previousValidationLogId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiValidationLog', default: null },
    isCurrent: { type: Boolean, default: true, index: true },
    yoloVersion: { type: String, default: 'v8.2.0-yolov8n' },
    sceneVersion: { type: String, default: 'v1.0.0' },
    decisionVersion: { type: String, default: 'v3.0.0' },
    snapshotVersion: { type: Number, default: 1 },
    predictedStatus: { type: String, default: '' },
    predictedScore: { type: Number, default: null },
    inputImageHash: { type: String, default: '' },
    requestPayloadHash: { type: String, default: '' },
}, { timestamps: true });
// Partial unique index: Guarantees exactly ONE current revision per snapshot and user
AiValidationLogSchema.index({ snapshotId: 1, userId: 1, isCurrent: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
exports.AiValidationLogModel = mongoose_1.default.model('AiValidationLog', AiValidationLogSchema);
