import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export interface IDatasetReadinessBreakdown {
  totalCandidates: number;
  positiveCount: number;
  negativeCount: number;
  dayCount: number;
  nightCount: number;
  smallObjectCount: number;
  blurCount: number;
  independentWindowCount: number;
  cameraLocationCount: number;
}

export interface IDatasetReadinessEvaluation extends Document {
  evaluationId: string;
  targetModel: TargetModelType;
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  policyId: string;
  policyVersion: string;
  policyHash: string;
  readyForTraining: boolean;
  overallReadinessPercentage: number;
  breakdown: IDatasetReadinessBreakdown;
  unsatisfiedRuleReasons: string[];
  evaluatedByUserId?: mongoose.Types.ObjectId;
  resultHash: string;
  createdAt: Date;
}

const DatasetReadinessBreakdownSchema = new Schema<IDatasetReadinessBreakdown>(
  {
    totalCandidates: { type: Number, required: true },
    positiveCount: { type: Number, required: true },
    negativeCount: { type: Number, required: true },
    dayCount: { type: Number, required: true },
    nightCount: { type: Number, required: true },
    smallObjectCount: { type: Number, required: true },
    blurCount: { type: Number, required: true },
    independentWindowCount: { type: Number, required: true },
    cameraLocationCount: { type: Number, required: true }
  },
  { _id: false }
);

const DatasetReadinessEvaluationSchema = new Schema<IDatasetReadinessEvaluation>(
  {
    evaluationId: { type: String, required: true, unique: true, index: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      default: 'OBJECT_DETECTOR',
      index: true
    },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'STAGING', index: true },
    policyId: { type: String, required: true },
    policyVersion: { type: String, required: true },
    policyHash: { type: String, required: true },
    readyForTraining: { type: Boolean, required: true, index: true },
    overallReadinessPercentage: { type: Number, required: true },
    breakdown: { type: DatasetReadinessBreakdownSchema, required: true },
    unsatisfiedRuleReasons: { type: [String], default: [] },
    evaluatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resultHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err = new Error(errorMsg);
  if (next) next(err);
  else throw err;
}

DatasetReadinessEvaluationSchema.pre('updateOne', function (this: any, next: any) {
  blockMutation('MUTATION_FORBIDDEN: DatasetReadinessEvaluation document is immutable and append-only.', next);
});

DatasetReadinessEvaluationSchema.pre('deleteOne', function (this: any, next: any) {
  blockMutation('DELETION_FORBIDDEN: DatasetReadinessEvaluation document is immutable.', next);
});

export const DatasetReadinessEvaluationModel = mongoose.model<IDatasetReadinessEvaluation>(
  'DatasetReadinessEvaluation',
  DatasetReadinessEvaluationSchema
);
