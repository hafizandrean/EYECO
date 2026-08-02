import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export type PolicyEnvironment = 'TEST' | 'STAGING' | 'PRODUCTION';
export type PolicyStatus = 'DRAFT' | 'APPROVED' | 'RETIRED';

export interface ITrainingEligibilityPolicyConfig {
  minimumTotalSamples: number;
  minimumTrainSamples: number;
  minimumValidationSamples: number;
  minimumTestSamples: number;
  minimumIndependentGroups: number;
  minimumSamplesPerClass: number;
  minimumCameraCount: number;
  minimumLocationCount: number;
}

export interface ITrainingEligibilityPolicy extends Document {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  targetModel: TargetModelType;
  environment: PolicyEnvironment;
  status: PolicyStatus;
  configuration: ITrainingEligibilityPolicyConfig;
  approvedByUserId?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TrainingEligibilityPolicyConfigSchema = new Schema<ITrainingEligibilityPolicyConfig>(
  {
    minimumTotalSamples: { type: Number, required: true },
    minimumTrainSamples: { type: Number, required: true },
    minimumValidationSamples: { type: Number, required: true },
    minimumTestSamples: { type: Number, required: true },
    minimumIndependentGroups: { type: Number, required: true },
    minimumSamplesPerClass: { type: Number, required: true },
    minimumCameraCount: { type: Number, required: true },
    minimumLocationCount: { type: Number, required: true }
  },
  { _id: false }
);

const TrainingEligibilityPolicySchema = new Schema<ITrainingEligibilityPolicy>(
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
    configuration: { type: TrainingEligibilityPolicyConfigSchema, required: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const TrainingEligibilityPolicyModel = mongoose.model<ITrainingEligibilityPolicy>(
  'TrainingEligibilityPolicy',
  TrainingEligibilityPolicySchema
);
