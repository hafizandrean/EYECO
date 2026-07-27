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
exports.ReportModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const SourceMetadataSchema = new mongoose_1.Schema({
    cameraId: { type: Number },
    modelId: { type: String },
    confidence: { type: Number },
    detectionId: { type: Number },
    reporterDevice: { type: String },
    appVersion: { type: String },
    clientIp: { type: String },
    ruleVersion: { type: String },
    modelVersion: { type: String }
}, { _id: false });
const BoundingBoxSchema = new mongoose_1.Schema({
    label: { type: String, required: true, trim: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    x: { type: Number, required: true, min: 0, max: 100 },
    y: { type: Number, required: true, min: 0, max: 100 },
    w: { type: Number, required: true, min: 0, max: 100 },
    h: { type: Number, required: true, min: 0, max: 100 }
});
const CommentSchema = new mongoose_1.Schema({
    userId: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
    likedBy: { type: [Number], default: [] },
    isDeleted: { type: Boolean, default: false },
    parentCommentId: { type: String, default: null }
}, {
    timestamps: true
});
const SlaSchema = new mongoose_1.Schema({
    detectedAt: { type: Date, required: true },
    validatedAt: { type: Date, default: null },
    assignedAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    validationDurationMs: { type: Number, default: null },
    assignmentDurationMs: { type: Number, default: null },
    cleanupDurationMs: { type: Number, default: null },
    resolutionDurationMs: { type: Number, default: null },
    totalDurationMs: { type: Number, default: null }
}, { _id: false });
const ReportSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true, index: true },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: String, default: 'BBWS', index: true },
    location: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true, index: true },
    aiStatus: {
        type: String,
        enum: ['Indikasi Tinggi', 'Indikasi Sedang', 'Indikasi Rendah', 'Tidak Terindikasi', 'TINGGI', 'SEDANG', 'RENDAH'],
        required: true,
        index: true
    },
    aiConfidence: { type: Number, default: null },
    violationScore: { type: Number, default: 0 },
    objectConfidence: { type: Number, default: 0 },
    sceneConfidence: { type: Number, default: 0 },
    decisionConfidence: { type: Number, default: 0 },
    uncertaintyScore: { type: Number, default: 0 },
    priority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    recommendedAction: { type: String, default: '' },
    activeSnapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
    snapshotHistory: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot' }],
    adminStatus: {
        type: String,
        enum: ['MENUNGGU', 'VALID', 'DIABAIKAN'],
        required: true,
        default: 'MENUNGGU',
        index: true
    },
    image: { type: String, required: true },
    identity: { type: String, default: 'Belum diketahui', trim: true },
    sourceType: { type: String, required: true, trim: true },
    additionalNotes: { type: String, default: 'Tidak ada catatan tambahan.', trim: true },
    adminNotes: { type: String, default: '', trim: true },
    boundingBoxes: [BoundingBoxSchema],
    comments: [CommentSchema],
    assignedOfficer: { type: String, default: '' },
    status: {
        type: String,
        enum: ['NEW', 'UNDER_REVIEW', 'VALIDATED', 'ASSIGNED', 'ON_SITE', 'IN_PROGRESS', 'RESOLVED', 'WAITING_APPROVAL', 'CLOSED', 'REJECTED'],
        default: 'NEW',
        index: true
    },
    currentAssignmentId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Assignment', default: null },
    currentResolutionId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Resolution', default: null },
    sla: { type: SlaSchema, required: true },
    deletedAt: { type: Date, default: null },
    scheduledDeletionAt: { type: Date, default: null },
    deletedById: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedByName: { type: String, default: null },
    deleteReason: { type: String, default: null },
    restoreReason: { type: String, default: null },
    archived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archiveReason: { type: String, default: null },
    workspaceId: { type: Number, index: true },
    sourceMetadata: { type: SourceMetadataSchema, default: {} },
    verifiedAt: { type: Date, default: null },
    signals: {
        type: new mongoose_1.Schema({
            active: { type: [Number], default: [] },
            resolved: { type: [Number], default: [] }
        }, { _id: false }),
        default: { active: [], resolved: [] }
    }
}, {
    timestamps: true,
    id: false // Prevent Mongoose virtual 'id' from overriding our numeric 'id' field
});
ReportSchema.index({ timestamp: -1, adminStatus: 1 });
// Compound index for sorted status queries
ReportSchema.index({ status: 1, timestamp: -1 });
// TTL index: auto-delete validated reports 40 days after scheduledDeletionAt is set
ReportSchema.index({ scheduledDeletionAt: 1 }, { expireAfterSeconds: 0 });
exports.ReportModel = mongoose_1.default.model('Report', ReportSchema);
