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
exports.ResolutionModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AttachmentSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    checksumAlgorithm: { type: String, enum: ['SHA256', 'SHA512', 'MD5'], default: 'SHA256', required: true },
    storage: { type: String, enum: ['LOCAL', 'S3', 'MINIO'], default: 'LOCAL', required: true },
    imageWidth: { type: Number, default: null },
    imageHeight: { type: Number, default: null },
    thumbnailUrl: { type: String, default: null },
    virusScanStatus: { type: String, enum: ['CLEAN', 'INFECTED', 'UNSCANNED'], default: 'UNSCANNED', required: true },
    uploadedById: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now, required: true }
});
const ResolutionSchema = new mongoose_1.Schema({
    reportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    isCleaned: { type: Boolean, default: false, required: true },
    afterImages: [AttachmentSchema],
    fieldNotes: { type: String, default: '' },
    completedAt: { type: Date, default: Date.now, required: true },
    officerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    officerName: { type: String, required: true },
    resolvedById: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    resolvedByName: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', required: true },
    approvedAt: { type: Date, default: null },
    approvedById: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedByRole: { type: String, default: null }
}, {
    timestamps: true
});
ResolutionSchema.index({ reportId: 1, status: 1 });
exports.ResolutionModel = mongoose_1.default.model('Resolution', ResolutionSchema);
