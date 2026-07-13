import mongoose, { Schema, Document } from 'mongoose';

export interface IAiModel extends Document {
  id: string; // unique, e.g. 'yolov8-river-v1.0'
  name: string;
  version: string;
  isActive: boolean;
  checksum?: string;
  artifactSize?: number;
  minimumPython?: string;
  minimumCuda?: string;
  minimumTorch?: string;
  minimumUltralytics?: string;
  framework?: string;
  supportedTasks?: string[];
  modelLoadLatencyMs?: number;
  warmupLatencyMs?: number;
  isRollbackCandidate?: boolean;
  workerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiModelSchema = new Schema<IAiModel>({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  version: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  checksum: { type: String, default: '' },
  artifactSize: { type: Number, default: 0 },
  minimumPython: { type: String, default: '3.8' },
  minimumCuda: { type: String, default: '' },
  minimumTorch: { type: String, default: '' },
  minimumUltralytics: { type: String, default: '' },
  framework: { type: String, default: 'YOLOv8' },
  supportedTasks: { type: [String], default: ['DETECTION'] },
  modelLoadLatencyMs: { type: Number, default: 0 },
  warmupLatencyMs: { type: Number, default: 0 },
  isRollbackCandidate: { type: Boolean, default: false },
  workerId: { type: String, default: 'gpu-worker-01' }
}, {
  timestamps: true
});

export const AiModelModel = mongoose.model<IAiModel>('AiModel', AiModelSchema);
