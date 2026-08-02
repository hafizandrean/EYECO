import mongoose, { Schema, Document } from 'mongoose';

export interface ITrainingExecutionResult extends Document {
  executionId: string;
  trainingJobId: string;
  workerId: string;
  claimTokenHash: string;
  attemptNumber: number;
  executionStatus: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  terminationReason?: string;
  trainerScriptPath: string;
  trainerScriptHash: string;
  commandArgumentsHash: string;
  processPid: number;
  exitCode: number;
  stdoutHash: string;
  stderrHash: string;
  runtimeEnvironmentHash: string;
  pythonVersion: string;
  ultralyticsVersion: string;
  torchVersion: string;
  deviceType: string;
  seed: number;
  datasetExportHash: string;
  dataYamlHash: string;
  trainingConfigHash: string;
  baseModelArtifactHash: string;
  epochsRequested: number;
  epochsCompleted: number;
  bestEpoch: number;
  resultsCsvHash: string;
  bestCheckpointHash: string;
  acceptedForFinalization: boolean;
  resultHash: string;
  createdAt: Date;
}

const TrainingExecutionResultSchema = new Schema<ITrainingExecutionResult>({
  executionId: { type: String, required: true, unique: true, index: true },
  trainingJobId: { type: String, required: true, index: true },
  workerId: { type: String, required: true },
  claimTokenHash: { type: String, required: true },
  attemptNumber: { type: Number, required: true, default: 1 },
  executionStatus: {
    type: String,
    enum: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
    required: true
  },
  terminationReason: { type: String },
  trainerScriptPath: { type: String, required: true },
  trainerScriptHash: { type: String, required: true },
  commandArgumentsHash: { type: String, required: true },
  processPid: { type: Number, required: true },
  exitCode: { type: Number, required: true },
  stdoutHash: { type: String, required: true },
  stderrHash: { type: String, required: true },
  runtimeEnvironmentHash: { type: String, required: true },
  pythonVersion: { type: String, required: true },
  ultralyticsVersion: { type: String, required: true },
  torchVersion: { type: String, required: true },
  deviceType: { type: String, required: true, default: 'cpu' },
  seed: { type: Number, required: true, default: 42 },
  datasetExportHash: { type: String, required: true },
  dataYamlHash: { type: String, required: true },
  trainingConfigHash: { type: String, required: true },
  baseModelArtifactHash: { type: String, required: true },
  epochsRequested: { type: Number, required: true },
  epochsCompleted: { type: Number, required: true },
  bestEpoch: { type: Number, required: true },
  resultsCsvHash: { type: String, required: true },
  bestCheckpointHash: { type: String, required: true },
  acceptedForFinalization: { type: Boolean, required: true, default: false },
  resultHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

TrainingExecutionResultSchema.index(
  { trainingJobId: 1, attemptNumber: 1, executionId: 1 },
  { unique: true }
);

TrainingExecutionResultSchema.index(
  { trainingJobId: 1, attemptNumber: 1, acceptedForFinalization: 1 },
  { unique: true, partialFilterExpression: { acceptedForFinalization: true } }
);

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err: any = new Error(errorMsg);
  err.status = 422;
  if (typeof next === 'function') {
    return next(err);
  }
  throw err;
}

TrainingExecutionResultSchema.pre('save', function (this: any, next: any) {
  if (!this.isNew) {
    return blockMutation(
      'TRAINING_RESULT_IMMUTABLE: TrainingExecutionResult documents are strictly append-only. Modification and deletion are REJECTED.',
      next
    );
  }
  if (typeof next === 'function') next();
});

const queryBlocker = function (this: any, next: any) {
  blockMutation(
    'TRAINING_RESULT_IMMUTABLE: TrainingExecutionResult documents are strictly append-only. Modification and deletion are REJECTED.',
    next
  );
};

TrainingExecutionResultSchema.pre('updateOne', queryBlocker);
TrainingExecutionResultSchema.pre('updateMany', queryBlocker);
TrainingExecutionResultSchema.pre('findOneAndUpdate', queryBlocker);
TrainingExecutionResultSchema.pre('replaceOne', queryBlocker);
TrainingExecutionResultSchema.pre('deleteOne', queryBlocker);
TrainingExecutionResultSchema.pre('deleteMany', queryBlocker);
TrainingExecutionResultSchema.pre('findOneAndDelete', queryBlocker);

export const TrainingExecutionResultModel = mongoose.model<ITrainingExecutionResult>(
  'TrainingExecutionResult',
  TrainingExecutionResultSchema
);
