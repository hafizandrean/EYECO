import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export type TrainingJobStatus = 'QUEUED' | 'PREPARING_DATASET' | 'TRAINING' | 'EVALUATING' | 'RETRY_WAIT' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ExecutionMode = 'STUB' | 'DRY_RUN' | 'ACTUAL';
export type JobEnvironment = 'TEST' | 'STAGING' | 'PRODUCTION';

export interface IModelTrainingJob extends Document {
  jobId: string;
  jobIdentityHash: string;
  targetModel: TargetModelType;
  jobEnvironment: JobEnvironment;
  executionMode: ExecutionMode;
  completionType?: 'SIMULATION' | 'ACTUAL';
  actualTrainingPerformed: boolean;
  actualEvaluationPerformed: boolean;
  artifactFrameworkValidationPassed?: boolean;
  processPid?: number;
  processExitCode?: number;
  promotionEligible: boolean;
  metricsSource?: 'SYNTHETIC' | 'ACTUAL';
  outputArtifactPath?: string | null;
  outputArtifactHash?: string | null;
  trainingExecutionResultId?: mongoose.Types.ObjectId | null;
  finalizedByWorkerId?: string | null;

  // Frozen Full Provenance
  datasetVersion: string;
  datasetManifestHash: string;
  approvedEligibilityEvaluationId: mongoose.Types.ObjectId;
  approvedEligibilityEvaluationHash: string;
  approvedEligibilityPolicyId: string;
  approvedEligibilityPolicyVersion: string;
  approvedEligibilityPolicyHash: string;
  datasetAssetValidationReportId?: mongoose.Types.ObjectId | null;
  datasetAssetValidationReportHash?: string | null;

  goldenDatasetVersion: string;
  goldenManifestHash: string;
  goldenAssetValidationReportId?: mongoose.Types.ObjectId | null;
  goldenAssetValidationReportHash?: string | null;
  goldenCompositionEvaluationId?: mongoose.Types.ObjectId | null;
  goldenCompositionEvaluationHash?: string | null;
  goldenOverlapAuditHash?: string | null;

  baseModelId?: string;
  baseModelVersion?: string;
  baseModelArtifactHash?: string;
  trainingConfig?: Record<string, any>;
  trainingConfigHash?: string;

  // Queue & Worker Management
  status: TrainingJobStatus;
  claimToken?: string | null;
  workerId?: string | null;
  leaseExpiresAt?: Date | null;
  retryCount: number;
  maxRetries: number;
  cancellationRequestedAt?: Date | null;
  cancellationRequestedBy?: mongoose.Types.ObjectId | null;
  cancellationReason?: string;

  // Metrics
  simulatedMetrics?: {
    goldenMAP50_95?: number;
    falsePositiveRate?: number;
  };
  actualMetrics?: Record<string, number>;
  failureReason?: string;
  errorCode?: string;

  createdByUserId?: mongoose.Types.ObjectId;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ModelTrainingJobSchema = new Schema<IModelTrainingJob>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    jobIdentityHash: { type: String, required: true, unique: true, index: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      index: true
    },
    jobEnvironment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'TEST', index: true },
    executionMode: { type: String, required: true, enum: ['STUB', 'DRY_RUN', 'ACTUAL'], default: 'STUB', index: true },
    completionType: { type: String, enum: ['SIMULATION', 'ACTUAL'], default: 'SIMULATION' },
    actualTrainingPerformed: { type: Boolean, default: false, index: true },
    actualEvaluationPerformed: { type: Boolean, default: false, index: true },
    artifactFrameworkValidationPassed: { type: Boolean, default: false },
    processPid: { type: Number, default: null },
    processExitCode: { type: Number, default: null },
    promotionEligible: { type: Boolean, default: false, index: true },
    metricsSource: { type: String, enum: ['SYNTHETIC', 'ACTUAL'], default: 'SYNTHETIC' },
    outputArtifactPath: { type: String, default: null },
    outputArtifactHash: { type: String, default: null },
    trainingExecutionResultId: { type: Schema.Types.ObjectId, ref: 'TrainingExecutionResult', default: null, index: true },
    finalizedByWorkerId: { type: String, default: null },

    datasetVersion: { type: String, required: true, index: true },
    datasetManifestHash: { type: String, required: true },
    approvedEligibilityEvaluationId: { type: Schema.Types.ObjectId, ref: 'TrainingEligibilityEvaluation', required: true },
    approvedEligibilityEvaluationHash: { type: String, required: true },
    approvedEligibilityPolicyId: { type: String, required: true },
    approvedEligibilityPolicyVersion: { type: String, required: true },
    approvedEligibilityPolicyHash: { type: String, required: true },
    datasetAssetValidationReportId: { type: Schema.Types.ObjectId, ref: 'DatasetAssetValidationReport', default: null },
    datasetAssetValidationReportHash: { type: String, default: null },

    goldenDatasetVersion: { type: String, required: true, index: true },
    goldenManifestHash: { type: String, required: true },
    goldenAssetValidationReportId: { type: Schema.Types.ObjectId, ref: 'DatasetAssetValidationReport', default: null },
    goldenAssetValidationReportHash: { type: String, default: null },
    goldenCompositionEvaluationId: { type: Schema.Types.ObjectId, ref: 'GoldenDatasetCompositionEvaluation', default: null },
    goldenCompositionEvaluationHash: { type: String, default: null },
    goldenOverlapAuditHash: { type: String, default: null },

    baseModelId: { type: String, default: 'yolov8n-baseline' },
    baseModelVersion: { type: String, default: 'v3.0.0' },
    baseModelArtifactHash: { type: String, default: 'sha256-base-model-hash' },
    trainingConfig: { type: Schema.Types.Mixed, default: {} },
    trainingConfigHash: { type: String, default: 'sha256-config-hash' },

    status: {
      type: String,
      required: true,
      enum: ['QUEUED', 'PREPARING_DATASET', 'TRAINING', 'EVALUATING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'QUEUED',
      index: true
    },
    claimToken: { type: String, default: null, index: true },
    workerId: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    cancellationRequestedAt: { type: Date, default: null },
    cancellationRequestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, default: '' },

    simulatedMetrics: { type: Schema.Types.Mixed, default: {} },
    actualMetrics: { type: Schema.Types.Mixed, default: {} },
    failureReason: { type: String, default: '' },
    errorCode: { type: String, default: '' },

    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Pre-save hook blocking manual state mutation without authorized transaction finalizer
ModelTrainingJobSchema.pre('save', function (this: any, next: any) {
  const isTargetState = this.actualTrainingPerformed === true || this.status === 'COMPLETED';
  if (isTargetState) {
    const isAuthorized =
      !!this.trainingExecutionResultId &&
      !!this.outputArtifactHash &&
      !!this.outputArtifactPath &&
      this.processExitCode === 0;

    if (!isAuthorized) {
      const err: any = new Error('TRAINING_FINALIZER_REQUIRED: Cannot set status to COMPLETED or actualTrainingPerformed to true without a valid TrainingExecutionResult linked via an authorized transaction finalizer.');
      err.status = 422;
      if (typeof next === 'function') {
        return next(err);
      }
      throw err;
    }
  }
  if (typeof next === 'function') {
    return next();
  }
});

export const ModelTrainingJobModel = mongoose.model<IModelTrainingJob>('ModelTrainingJob', ModelTrainingJobSchema);
