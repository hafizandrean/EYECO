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
exports.TimelineEventModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const TimelineEventSchema = new mongoose_1.Schema({
    reportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    eventVersion: { type: Number, default: 1, required: true },
    type: {
        type: String,
        enum: [
            'DETECTION', 'REVIEW', 'VALIDATED', 'ASSIGNED', 'ARRIVED', 'RESOLVED', 'CLOSED', 'REJECTED',
            'APPROVAL_REQUESTED', 'COMMENT_ADDED', 'FILE_UPLOADED', 'ASSIGNMENT_CHANGED',
            'RESOLUTION_REJECTED', 'NOTIFICATION_SENT'
        ],
        required: true
    },
    actorId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    metadata: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    requestId: { type: String, default: '' },
    traceId: { type: String, default: '' },
    correlationId: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' }
}, {
    timestamps: { createdAt: true, updatedAt: false } // Immutable
});
// Compound index for sorted timeline query
TimelineEventSchema.index({ reportId: 1, createdAt: -1 });
exports.TimelineEventModel = mongoose_1.default.model('TimelineEvent', TimelineEventSchema);
