import mongoose, { Schema, Document } from 'mongoose';

export interface IAiInferenceMetrics extends Document {
  timestamp: Date;
  cameraId: number;
  modelId: string;
  inferenceLatencyMs: number;
  preprocessMs: number;
  inferenceMs: number;
  postprocessMs: number;
}

const AiInferenceMetricsSchema = new Schema<IAiInferenceMetrics>({
  timestamp: { type: Date, default: Date.now, index: true },
  cameraId: { type: Number, required: true, index: true },
  modelId: { type: String, required: true, index: true },
  inferenceLatencyMs: { type: Number, required: true },
  preprocessMs: { type: Number, required: true },
  inferenceMs: { type: Number, required: true },
  postprocessMs: { type: Number, required: true }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const AiInferenceMetricsModel = mongoose.model<IAiInferenceMetrics>('AiInferenceMetrics', AiInferenceMetricsSchema);
