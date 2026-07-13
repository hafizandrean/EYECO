import mongoose, { Schema, Document } from 'mongoose';

export interface IDatasetFeedback extends Document {
  reportId: number;
  reportObjectId: mongoose.Types.ObjectId;
  cameraId: number;
  imageHash: string;
  imageWidth: number;
  imageHeight: number;
  originalDetections: Array<{
    class: string;
    confidence: number;
    bbox: number[];
  }>;
  groundTruth: Array<{
    class: string;
    bbox: number[];
  }>;
  modelId: string;
  modelVersion: string;
  operatorLabel: 'APPROVED' | 'REJECTED' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE' | 'UNCERTAIN';
  reviewStatus: 'PENDING' | 'PROCESSED' | 'REJECTED' | 'APPROVED';
  datasetPartition: 'TRAIN' | 'VALIDATION' | 'TEST' | 'HOLD';
  feedbackSource: 'OPERATOR_REVIEW' | 'AUTO_PROMOTION';
  operatorId: mongoose.Types.ObjectId;
  qualityScore: number; // 0-100
  reviewedAt: Date;
  reviewedBy: string;
  processedForRetraining: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetFeedbackSchema = new Schema<IDatasetFeedback>({
  reportId: { type: Number, required: true, index: true },
  reportObjectId: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
  cameraId: { type: Number, required: true, index: true },
  imageHash: { type: String, required: true, index: true },
  imageWidth: { type: Number, required: true },
  imageHeight: { type: Number, required: true },
  originalDetections: [{
    class: { type: String, required: true },
    confidence: { type: Number, required: true },
    bbox: { type: [Number], required: true }
  }],
  groundTruth: [{
    class: { type: String, required: true },
    bbox: { type: [Number], required: true }
  }],
  modelId: { type: String, required: true, index: true },
  modelVersion: { type: String, required: true },
  operatorLabel: { type: String, required: true, enum: ['APPROVED', 'REJECTED', 'FALSE_POSITIVE', 'FALSE_NEGATIVE', 'UNCERTAIN'] },
  reviewStatus: { type: String, required: true, enum: ['PENDING', 'PROCESSED', 'REJECTED', 'APPROVED'], default: 'PENDING' },
  datasetPartition: { type: String, required: true, enum: ['TRAIN', 'VALIDATION', 'TEST', 'HOLD'], default: 'TRAIN' },
  feedbackSource: { type: String, required: true, enum: ['OPERATOR_REVIEW', 'AUTO_PROMOTION'], default: 'OPERATOR_REVIEW' },
  operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  qualityScore: { type: Number, required: true, min: 0, max: 100, default: 100 },
  reviewedAt: { type: Date, required: true, default: Date.now },
  reviewedBy: { type: String, required: true },
  processedForRetraining: { type: Boolean, required: true, default: false, index: true }
}, {
  timestamps: true
});

export const DatasetFeedbackModel = mongoose.model<IDatasetFeedback>('DatasetFeedback', DatasetFeedbackSchema);
