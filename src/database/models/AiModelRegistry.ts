import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export type ModelRegistryStatus =
  | 'EVALUATING'
  | 'REJECTED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'SHADOW'
  | 'CANARY'
  | 'ACTIVE'
  | 'ROLLED_BACK'
  | 'ARCHIVED'
  | 'TEST_ONLY';

export interface IAiModelRegistry extends Document {
  modelId: string;
  modelType: TargetModelType;
  modelVersion: string;
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  status: ModelRegistryStatus;
  
  artifactPath?: string | null;
  artifactHash?: string | null;
  
  baseModelId: string;
  baseModelVersion: string;
  baseModelArtifactHash: string;
  
  datasetVersion: string;
  datasetManifestHash: string;
  trainingJobId?: string | null;
  trainingExecutionResultId?: mongoose.Types.ObjectId | null;
  rootModelImportRecordId?: mongoose.Types.ObjectId | null;
  eligibilityEvaluationId?: mongoose.Types.ObjectId | null;
  goldenEvaluationId?: mongoose.Types.ObjectId | null;
  artifactValidationReportId?: mongoose.Types.ObjectId | null;
  
  metrics: Record<string, number>;
  promotionEligible: boolean;
  actualTrainingPerformed: boolean;
  actualEvaluationPerformed: boolean;
  
  approvedByUserId?: mongoose.Types.ObjectId | null;
  approvedAt?: Date | null;
  rollbackModelId?: string | null;
  
  createdAt: Date;
  updatedAt: Date;
}

const AiModelRegistrySchema = new Schema<IAiModelRegistry>(
  {
    modelId: { type: String, required: true, unique: true, index: true },
    modelType: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      index: true
    },
    modelVersion: { type: String, required: true, index: true },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'TEST', index: true },
    status: {
      type: String,
      required: true,
      enum: [
        'EVALUATING',
        'REJECTED',
        'AWAITING_APPROVAL',
        'APPROVED',
        'SHADOW',
        'CANARY',
        'ACTIVE',
        'ROLLED_BACK',
        'ARCHIVED',
        'TEST_ONLY'
      ],
      default: 'TEST_ONLY',
      index: true
    },
    artifactPath: { type: String, default: null },
    artifactHash: { type: String, default: null },

    baseModelId: { type: String, required: true },
    baseModelVersion: { type: String, required: true },
    baseModelArtifactHash: { type: String, required: true },

    datasetVersion: { type: String, required: true },
    datasetManifestHash: { type: String, required: true },
    trainingJobId: { type: String, default: null },
    trainingExecutionResultId: { type: Schema.Types.ObjectId, ref: 'TrainingExecutionResult', default: null },
    rootModelImportRecordId: { type: Schema.Types.ObjectId, ref: 'RootModelImportRecord', default: null },
    eligibilityEvaluationId: { type: Schema.Types.ObjectId, ref: 'TrainingEligibilityEvaluation', default: null },
    goldenEvaluationId: { type: Schema.Types.ObjectId, ref: 'GoldenModelEvaluation', default: null },
    artifactValidationReportId: { type: Schema.Types.ObjectId, ref: 'ModelArtifactValidationReport', default: null },

    metrics: { type: Schema.Types.Mixed, default: {} },
    promotionEligible: { type: Boolean, default: false, index: true },
    actualTrainingPerformed: { type: Boolean, default: false },
    actualEvaluationPerformed: { type: Boolean, default: false },

    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rollbackModelId: { type: String, default: null }
  },
  { timestamps: true }
);

// Partial Unique Index: Exactly ONE ACTIVE model per modelType and environment!
AiModelRegistrySchema.index(
  { modelType: 1, environment: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } }
);

export const AiModelRegistryModel = mongoose.model<IAiModelRegistry>('AiModelRegistry', AiModelRegistrySchema);
