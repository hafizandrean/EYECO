import mongoose, { Schema, Document } from 'mongoose';
import { IBoundingBox } from './Report';

export interface IAiDetection extends Document {
  id: number;
  cameraId: number;
  location: string;
  capturedAt: Date;
  confidence: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  trackingId: string;
  modelId: string;
  detections: Array<{
    class: string;
    confidence: number;
    bbox: number[]; // [x, y, w, h]
    trackId: string;
  }>;
  status: 'CAPTURED' | 'INFERENCED' | 'LOW_CONFIDENCE' | 'DUPLICATE' | 'WAITING_VERIFICATION' | 'PROMOTED' | 'FAILED_CAPTURE' | 'FAILED_INFERENCE' | 'FAILED_PROMOTION' | 'FAILED_DATABASE';
  promotedReportId?: number;
  processingTimeMs: number;
  promotionReason?: string | null;
  rejectedReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AiDetectionSchema = new Schema<IAiDetection>({
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

// Let's extend interface for expiresAt
export interface IAiDetection {
  expiresAt?: Date | null;
}

export const AiDetectionModel = mongoose.model<IAiDetection>('AiDetection', AiDetectionSchema);
