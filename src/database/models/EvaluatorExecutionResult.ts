import mongoose, { Schema, Document } from 'mongoose';

export interface IEvaluatorExecutionResult extends Document {
  executionId: string;
  testRunId?: string;
  trainingJobId: string;
  trainingExecutionResultId?: mongoose.Types.ObjectId | null;
  metricVerificationResultId?: mongoose.Types.ObjectId | null;
  candidateArtifactHash: string;
  candidateArtifactPath: string;
  baselineModelRegistryId: string;
  baselineArtifactHash: string;
  baselineArtifactPath: string;
  evaluationManifestHash: string;
  evaluationManifestPath: string;
  groundTruthManifestHash: string;
  groundTruthManifestPath: string;
  trainerScriptHash?: string;
  validatorScriptHash?: string;
  evaluatorScriptHash: string;
  commandArgumentsHash?: string;
  processPid: number;
  exitCode: number;
  candidatePredictionManifestHash: string;
  candidatePredictionManifestPath: string;
  baselinePredictionManifestHash: string;
  baselinePredictionManifestPath: string;
  evaluationMetricsFileHash: string;
  evaluationMetricsFilePath: string;
  resultHash: string;
  createdAt: Date;
}

const EvaluatorExecutionResultSchema = new Schema<IEvaluatorExecutionResult>(
  {
    executionId: { type: String, required: true, unique: true, index: true },
    testRunId: { type: String, default: null, index: true },
    trainingJobId: { type: String, required: true, index: true },
    trainingExecutionResultId: { type: Schema.Types.ObjectId, ref: 'TrainingExecutionResult', default: null },
    metricVerificationResultId: { type: Schema.Types.ObjectId, ref: 'MetricVerificationResult', default: null },
    candidateArtifactHash: { type: String, required: true },
    candidateArtifactPath: { type: String, required: true },
    baselineModelRegistryId: { type: String, required: true },
    baselineArtifactHash: { type: String, required: true },
    baselineArtifactPath: { type: String, required: true },
    evaluationManifestHash: { type: String, required: true },
    evaluationManifestPath: { type: String, required: true },
    groundTruthManifestHash: { type: String, required: true },
    groundTruthManifestPath: { type: String, required: true },
    trainerScriptHash: { type: String, default: null },
    validatorScriptHash: { type: String, default: null },
    evaluatorScriptHash: { type: String, required: true },
    commandArgumentsHash: { type: String, default: null },
    processPid: { type: Number, required: true },
    exitCode: { type: Number, required: true },
    candidatePredictionManifestHash: { type: String, required: true },
    candidatePredictionManifestPath: { type: String, required: true },
    baselinePredictionManifestHash: { type: String, required: true },
    baselinePredictionManifestPath: { type: String, required: true },
    evaluationMetricsFileHash: { type: String, required: true },
    evaluationMetricsFilePath: { type: String, required: true },
    resultHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function blockMutation(next: (err?: Error) => void) {
  const err: any = new Error('EVALUATOR_RESULT_IMMUTABLE: EvaluatorExecutionResult documents are strictly append-only. Modification and deletion are REJECTED.');
  err.status = 422;
  if (next) next(err);
  else throw err;
}

// Immutability Guard Pre-Save Middleware
EvaluatorExecutionResultSchema.pre('save', function (this: any, next: any) {
  if (!this.isNew) {
    return blockMutation(next);
  }
  next();
});

// Immutability Guard Query Middlewares
const queryMutationHandler = function (this: any, next: any) {
  blockMutation(next);
};

EvaluatorExecutionResultSchema.pre('updateOne', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('updateMany', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('findOneAndUpdate', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('replaceOne', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('deleteOne', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('deleteMany', queryMutationHandler);
EvaluatorExecutionResultSchema.pre('findOneAndDelete', queryMutationHandler);

export const EvaluatorExecutionResultModel = mongoose.model<IEvaluatorExecutionResult>(
  'EvaluatorExecutionResult',
  EvaluatorExecutionResultSchema
);
