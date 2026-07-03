import mongoose, { Schema, Document } from 'mongoose';

export interface IAiMetric extends Document {
  timestamp: Date;
  cameraId: number;
  framesProcessed: number;
  averageInferenceTimeMs: number;
  promotionCount: number;
  duplicateCount: number;
  falsePositiveCount: number;
}

const AiMetricSchema = new Schema<IAiMetric>({
  timestamp: { type: Date, default: Date.now, index: true },
  cameraId: { type: Number, required: true, index: true },
  framesProcessed: { type: Number, default: 0 },
  averageInferenceTimeMs: { type: Number, default: 0 },
  promotionCount: { type: Number, default: 0 },
  duplicateCount: { type: Number, default: 0 },
  falsePositiveCount: { type: Number, default: 0 }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const AiMetricModel = mongoose.model<IAiMetric>('AiMetric', AiMetricSchema);
