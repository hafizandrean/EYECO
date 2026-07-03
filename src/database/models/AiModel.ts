import mongoose, { Schema, Document } from 'mongoose';

export interface IAiModel extends Document {
  id: string; // unique, e.g. 'yolov8-river-v1.0'
  name: string;
  version: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AiModelSchema = new Schema<IAiModel>({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  version: { type: String, required: true },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

export const AiModelModel = mongoose.model<IAiModel>('AiModel', AiModelSchema);
