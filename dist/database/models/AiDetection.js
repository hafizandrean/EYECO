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
exports.AiDetectionModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiDetectionSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true },
    cameraId: { type: Number, required: true, index: true },
    location: { type: String, required: true },
    capturedAt: { type: Date, required: true },
    confidence: { type: Number, required: true },
    severity: { type: String, required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
    trackingId: { type: String, required: true, index: true },
    modelId: { type: String, required: true, index: true },
    detections: [{
            class: { type: String, required: true },
            confidence: { type: Number, required: true },
            bbox: { type: [Number], required: true },
            trackId: { type: String, required: true }
        }],
    status: {
        type: String,
        required: true,
        enum: ['CAPTURED', 'INFERENCED', 'LOW_CONFIDENCE', 'DUPLICATE', 'WAITING_VERIFICATION', 'PROMOTED', 'FAILED_CAPTURE', 'FAILED_INFERENCE', 'FAILED_PROMOTION', 'FAILED_DATABASE'],
        default: 'CAPTURED',
        index: true
    },
    promotedReportId: { type: Number, index: true },
    processingTimeMs: { type: Number, default: 0 },
    promotionReason: { type: String, default: null },
    rejectedReason: { type: String, default: null }
}, {
    timestamps: true
});
// TTL index to automatically delete unpromoted detections after 30 days
// We will manage conditional deletion programmatically or let old unpromoted ones expire.
// Mongoose TTL index is set on the 'createdAt' field. To prevent deletion of PROMOTED detections,
// we can set a dedicated 'expiresAt' field, but a simpler enterprise practice is to use TTL 30 days
// and keep PROMOTED detections persisted by omitting/removing the expiresAt or setting it far in the future.
// Here we'll define a TTL on `createdAt` and programmatically handle cleanup, or define an optional `expiresAt` field.
// Let's add `expiresAt` field to make it fully flexible and compliant with MongoDB TTL:
// If expiresAt is undefined, MongoDB TTL will NOT delete it!
// So only unpromoted records will have expiresAt set to 30 days from creation. Promoted ones will have expiresAt = null (never expires).
// Let's add `expiresAt` to the schema and interface!
AiDetectionSchema.add({
    expiresAt: { type: Date, index: { expires: 0 } }
});
exports.AiDetectionModel = mongoose_1.default.model('AiDetection', AiDetectionSchema);
