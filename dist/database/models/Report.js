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
const ReportSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true, index: true },
    userId: { type: Number, required: true, index: true },
    desaId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Desa', required: true, index: true },
    location: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true, index: true },
    aiStatus: {
        type: String,
        enum: ['TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi'],
        required: true,
        index: true
    },
    aiConfidence: { type: Number, default: null },
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
    comments: [CommentSchema]
}, {
    timestamps: true
});
ReportSchema.index({ timestamp: -1, adminStatus: 1 });
exports.ReportModel = mongoose_1.default.model('Report', ReportSchema);
