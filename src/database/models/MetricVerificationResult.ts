import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMetricVerificationResult extends Document {
  verificationId: string;
  evaluatorExecutionResultId: Types.ObjectId;
  predictionManifestHash: string;
  groundTruthManifestHash: string;
  evaluationPolicyHash: string;
  independentVerifierScriptHash: string;
  runtimeEnvironmentHash: string;
  processPid: number;
  exitCode: number;
  independentMetrics: {
    precision: number;
    recall: number;
    ap50: number;
    map50_95: number;
    perClassAp: Record<string, number>;
    smallObjectRecall: number;
  };
  primaryMetricsHash: string;
  metricDelta: Record<string, number>;
  parityPassed: boolean;
  tolerancePolicyId: string;
  resultHash: string;
  createdAt: Date;
}

const MetricVerificationResultSchema = new Schema<IMetricVerificationResult>({
  verificationId: { type: String, required: true, unique: true, index: true },
  evaluatorExecutionResultId: { type: Schema.Types.ObjectId, ref: 'EvaluatorExecutionResult', required: true, index: true },
  predictionManifestHash: { type: String, required: true },
  groundTruthManifestHash: { type: String, required: true },
  evaluationPolicyHash: { type: String, required: true },
  independentVerifierScriptHash: { type: String, required: true },
  runtimeEnvironmentHash: { type: String, required: true },
  processPid: { type: Number, required: true },
  exitCode: { type: Number, required: true },
  independentMetrics: {
    precision: { type: Number, required: true },
    recall: { type: Number, required: true },
    ap50: { type: Number, required: true },
    map50_95: { type: Number, required: true },
    perClassAp: { type: Schema.Types.Mixed, required: true, default: {} },
    smallObjectRecall: { type: Number, required: true }
  },
  primaryMetricsHash: { type: String, required: true },
  metricDelta: { type: Schema.Types.Mixed, required: true, default: {} },
  parityPassed: { type: Boolean, required: true },
  tolerancePolicyId: { type: String, required: true, default: 'policy-parity-v1' },
  resultHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err: any = new Error(errorMsg);
  err.status = 422;
  if (typeof next === 'function') {
    return next(err);
  }
  throw err;
}

MetricVerificationResultSchema.pre('save', function (this: any, next: any) {
  if (!this.isNew) {
    return blockMutation(
      'METRIC_VERIFICATION_RESULT_IMMUTABLE: MetricVerificationResult documents are strictly append-only. Modification and deletion are REJECTED.',
      next
    );
  }
  if (typeof next === 'function') next();
});

const queryBlocker = function (this: any, next: any) {
  blockMutation(
    'METRIC_VERIFICATION_RESULT_IMMUTABLE: MetricVerificationResult documents are strictly append-only. Modification and deletion are REJECTED.',
    next
  );
};

MetricVerificationResultSchema.pre('updateOne', queryBlocker);
MetricVerificationResultSchema.pre('updateMany', queryBlocker);
MetricVerificationResultSchema.pre('findOneAndUpdate', queryBlocker);
MetricVerificationResultSchema.pre('replaceOne', queryBlocker);
MetricVerificationResultSchema.pre('deleteOne', queryBlocker);
MetricVerificationResultSchema.pre('deleteMany', queryBlocker);
MetricVerificationResultSchema.pre('findOneAndDelete', queryBlocker);

export const MetricVerificationResultModel = mongoose.model<IMetricVerificationResult>(
  'MetricVerificationResult',
  MetricVerificationResultSchema
);
