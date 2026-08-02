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
exports.ContinualLearningOutboxModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ContinualLearningOutboxSchema = new mongoose_1.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, enum: ['AI_FEEDBACK_RECORDED'], index: true },
    validationLogId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiValidationLog', required: true, index: true },
    snapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', required: true, index: true },
    reportId: { type: Number, required: true, index: true },
    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        default: 'PENDING',
        index: true
    },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    claimToken: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    nextRetryAt: { type: Date, default: null },
    errorCode: { type: String, default: null }
}, { timestamps: true });
// Compound Index for Worker Polling
ContinualLearningOutboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });
exports.ContinualLearningOutboxModel = mongoose_1.default.model('ContinualLearningOutbox', ContinualLearningOutboxSchema);
