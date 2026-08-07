import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export interface ISubgroupRegressionRule {
  subgroup: string;
  minimumItemsRequired: number;
  maximumAllowedRegression: number; // e.g. 0.00 (no regression allowed)
}

export interface IStatisticalEvaluationPolicyConfig {
  confidenceLevel: number; // e.g. 0.95
  bootstrapIterations: number; // e.g. 1000
  minimumMapImprovement: number; // e.g. 0.03 (practical effect size)
  maximumAllowedFprRegression: number; // e.g. 0.00
  minimumEvaluationGroups: number;
  minimumItemsPerSubgroup: number;
  minimumPositiveItemsPerClass: number;
  minimumNegativeWindows: number;
  minimumCameraCount: number;
  subgroupRegressionRules: ISubgroupRegressionRule[];
}

export interface IStatisticalEvaluationPolicy extends Document {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  targetModel: TargetModelType;
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  configuration: IStatisticalEvaluationPolicyConfig;
  approvedByUserId?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubgroupRegressionRuleSchema = new Schema<ISubgroupRegressionRule>(
  {
    subgroup: { type: String, required: true },
    minimumItemsRequired: { type: Number, required: true, default: 5 },
    maximumAllowedRegression: { type: Number, required: true, default: 0.00 }
  },
  { _id: false }
);

const StatisticalEvaluationPolicyConfigSchema = new Schema<IStatisticalEvaluationPolicyConfig>(
  {
    confidenceLevel: { type: Number, required: true, default: 0.95 },
    bootstrapIterations: { type: Number, required: true, default: 1000 },
    minimumMapImprovement: { type: Number, required: true, default: 0.03 },
    maximumAllowedFprRegression: { type: Number, required: true, default: 0.00 },
    minimumEvaluationGroups: { type: Number, required: true, default: 3 },
    minimumItemsPerSubgroup: { type: Number, required: true, default: 2 },
    minimumPositiveItemsPerClass: { type: Number, required: true, default: 2 },
    minimumNegativeWindows: { type: Number, required: true, default: 2 },
    minimumCameraCount: { type: Number, required: true, default: 2 },
    subgroupRegressionRules: { type: [SubgroupRegressionRuleSchema], default: [] }
  },
  { _id: false }
);

const StatisticalEvaluationPolicySchema = new Schema<IStatisticalEvaluationPolicy>(
  {
    policyId: { type: String, required: true, unique: true, index: true },
    policyVersion: { type: String, required: true, index: true },
    policyHash: { type: String, required: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      default: 'OBJECT_DETECTOR',
      index: true
    },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'STAGING', index: true },
    status: { type: String, required: true, enum: ['DRAFT', 'APPROVED', 'RETIRED'], default: 'APPROVED', index: true },
    configuration: { type: StatisticalEvaluationPolicyConfigSchema, required: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err = new Error(errorMsg);
  if (next) next(err);
  else throw err;
}

StatisticalEvaluationPolicySchema.pre('updateOne', function (this: any, next: any) {
  blockMutation('MUTATION_FORBIDDEN: StatisticalEvaluationPolicy document is immutable and append-only once created.', next);
});

StatisticalEvaluationPolicySchema.pre('deleteOne', function (this: any, next: any) {
  blockMutation('DELETION_FORBIDDEN: StatisticalEvaluationPolicy document is immutable and cannot be deleted.', next);
});

export const StatisticalEvaluationPolicyModel = mongoose.model<IStatisticalEvaluationPolicy>(
  'StatisticalEvaluationPolicy',
  StatisticalEvaluationPolicySchema
);
