import mongoose, { Schema, Document } from 'mongoose';

export interface IAiSystemMetrics extends Document {
  timestamp: Date;
  cpuUsage: number;
  ramUsage: number;
  gpuUsage: number;
  vramUsed: number;
  vramFree: number;
  diskUsage: number;
}

const AiSystemMetricsSchema = new Schema<IAiSystemMetrics>({
  timestamp: { type: Date, default: Date.now, index: true },
  cpuUsage: { type: Number, required: true },
  ramUsage: { type: Number, required: true },
  gpuUsage: { type: Number, required: true },
  vramUsed: { type: Number, required: true },
  vramFree: { type: Number, required: true },
  diskUsage: { type: Number, required: true }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const AiSystemMetricsModel = mongoose.model<IAiSystemMetrics>('AiSystemMetrics', AiSystemMetricsSchema);
