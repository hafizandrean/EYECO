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
exports.AiEvidenceModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiEvidenceSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true },
    cameraId: { type: Number, required: true, index: true },
    capturedAt: { type: Date, required: true },
    storageKey: { type: String, required: true },
    sha256: { type: String, required: true },
    linkedDetectionId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiDetection', required: true },
    expiresAt: { type: Date, default: null, index: { expires: 0 } },
    mimeType: { type: String, default: 'image/jpeg' },
    width: { type: Number, default: 1920 },
    height: { type: Number, default: 1080 },
    size: { type: Number, default: 0 },
    storage: { type: String, enum: ['LOCAL', 'S3', 'GCS', 'AZURE'], default: 'LOCAL' },
    thumbnail: { type: String, default: '' },
    virusScanStatus: { type: String, enum: ['CLEAN', 'INFECTED', 'UNSCANNED'], default: 'CLEAN' }
}, {
    timestamps: true
});
exports.AiEvidenceModel = mongoose_1.default.model('AiEvidence', AiEvidenceSchema);
