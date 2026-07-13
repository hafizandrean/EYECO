import mongoose, { Schema, Document } from 'mongoose';

export interface IAiTrainingRun extends Document {
  datasetVersion: string;
  modelVersion: string;
  trainingStart: Date;
  trainingEnd: Date;
  epochs: number;
  precision: number;
  recall: number;
  mAP50: number;
  mAP50_95: number;
  bestWeightsPath: string;
  artifactSize: number; // in bytes
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiTrainingRunSchema = new Schema<IAiTrainingRun>({
  datasetVersion: { type: String, required: true },
  modelVersion: { type: String, required: true, unique: true, index: true },
  trainingStart: { type: Date, required: true },
  trainingEnd: { type: Date, required: true },
  epochs: { type: Number, required: true },
  precision: { type: Number, required: true },
  recall: { type: Number, required: true },
  mAP50: { type: Number, required: true },
  mAP50_95: { type: Number, required: true },
  bestWeightsPath: { type: String, required: true },
  artifactSize: { type: Number, required: true },
  notes: { type: String, default: '' }
}, {
  timestamps: true
});

export const AiTrainingRunModel = mongoose.model<IAiTrainingRun>('AiTrainingRun', AiTrainingRunSchema);
