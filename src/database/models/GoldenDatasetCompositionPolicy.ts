import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export interface IGoldenDatasetCompositionPolicyConfig {
  minimumTotalItems: number;
  minimumPositiveItems: number;
  minimumNegativeItems: number;
  minimumItemsPerClass: number;
  minimumCameraCount: number;
  minimumLocationCount: number;
  requireDayExamples: boolean;
  requireNightExamples: boolean;
  minimumSmallObjectItems: number;
  minimumBlurOrOcclusionItems: number;
}

export interface IGoldenDatasetCompositionPolicy extends Document {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  targetModel: TargetModelType;
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  configuration: IGoldenDatasetCompositionPolicyConfig;
  approvedByUserId?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GoldenDatasetCompositionPolicyConfigSchema = new Schema<IGoldenDatasetCompositionPolicyConfig>(
  {
    minimumTotalItems: { type: Number, required: true, default: 5 },
    minimumPositiveItems: { type: Number, required: true, default: 3 },
    minimumNegativeItems: { type: Number, required: true, default: 1 },
    minimumItemsPerClass: { type: Number, required: true, default: 1 },
    minimumCameraCount: { type: Number, required: true, default: 1 },
    minimumLocationCount: { type: Number, required: true, default: 1 },
    requireDayExamples: { type: Boolean, default: false },
    requireNightExamples: { type: Boolean, default: false },
    minimumSmallObjectItems: { type: Number, default: 0 },
    minimumBlurOrOcclusionItems: { type: Number, default: 0 }
  },
  { _id: false }
);

const GoldenDatasetCompositionPolicySchema = new Schema<IGoldenDatasetCompositionPolicy>(
  {
    policyId: { type: String, required: true, unique: true, index: true },
    policyVersion: { type: String, required: true, index: true },
    policyHash: { type: String, required: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      index: true
    },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'TEST', index: true },
    status: { type: String, required: true, enum: ['DRAFT', 'APPROVED', 'RETIRED'], default: 'DRAFT', index: true },
    configuration: { type: GoldenDatasetCompositionPolicyConfigSchema, required: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const GoldenDatasetCompositionPolicyModel = mongoose.model<IGoldenDatasetCompositionPolicy>(
  'GoldenDatasetCompositionPolicy',
  GoldenDatasetCompositionPolicySchema
);
