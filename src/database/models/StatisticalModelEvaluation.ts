import mongoose, { Schema, Document } from 'mongoose';

export type StatisticalDecision = 'SUPERIOR' | 'INCONCLUSIVE' | 'INFERIOR';
export type DeploymentEligibility = 'NONE' | 'SHADOW' | 'CANARY' | 'PRODUCTION';

export interface IBootstrapConfidenceInterval {
  lower: number;
  upper: number;
  confidenceLevel: number;
}

export interface ICctvOperationalMetrics {
  fpPer1000Frames: number;
  fpPerHour: number;
  fpPerCameraDay: number;
  missedViolationCount: number;
  missedViolationsPerCameraHour: number;
  eventRecall: number;
}

export interface ISubgroupEvaluationResult {
  subgroup: string;
  itemCount: number;
  candidateValue: number;
  baselineValue: number;
  deltaValue: number;
  status: 'PASS' | 'REGRESSION' | 'INSUFFICIENT_DATA';
  reason?: string;
}

export interface IStatisticalModelEvaluation extends Document {
  evaluationId: string;
  jobId: string;
  candidateModelId: string;
  candidateArtifactHash: string;
  baselineModelId: string;
  baselineArtifactHash: string;
  goldenDatasetVersion: string;
  goldenManifestHash: string;
  candidatePredictionManifestHash: string;
  baselinePredictionManifestHash: string;
  groundTruthManifestHash: string;

  statisticalPolicyId: string;
  statisticalPolicyVersion: string;
  statisticalPolicyHash: string;

  bootstrapSeed: number;
  bootstrapIterations: number;
  bootstrapScriptHash: string;

  statisticalDecision: StatisticalDecision;
  statisticallyMeaningful: boolean;
  shadowEligible: boolean;
  productionEligible: boolean; // Always false in Phase 6J
  deploymentEligibility: DeploymentEligibility;

  candidateMetrics: Record<string, number>;
  baselineMetrics: Record<string, number>;
  metricDeltas: Record<string, number>;

  bootstrapConfidenceInterval: IBootstrapConfidenceInterval;
  probabilityCandidateSuperior: number;
  cctvOperationalMetrics: ICctvOperationalMetrics;
  subgroupResults: ISubgroupEvaluationResult[];

  rawMetricEvidenceHash: string;
  subgroupResultHash: string;
  resultHash: string;
  createdAt: Date;
}

const BootstrapConfidenceIntervalSchema = new Schema<IBootstrapConfidenceInterval>(
  {
    lower: { type: Number, required: true },
    upper: { type: Number, required: true },
    confidenceLevel: { type: Number, required: true, default: 0.95 }
  },
  { _id: false }
);

const CctvOperationalMetricsSchema = new Schema<ICctvOperationalMetrics>(
  {
    fpPer1000Frames: { type: Number, required: true },
    fpPerHour: { type: Number, required: true },
    fpPerCameraDay: { type: Number, required: true },
    missedViolationCount: { type: Number, required: true },
    missedViolationsPerCameraHour: { type: Number, required: true },
    eventRecall: { type: Number, required: true }
  },
  { _id: false }
);

const SubgroupEvaluationResultSchema = new Schema<ISubgroupEvaluationResult>(
  {
    subgroup: { type: String, required: true },
    itemCount: { type: Number, required: true },
    candidateValue: { type: Number, required: true },
    baselineValue: { type: Number, required: true },
    deltaValue: { type: Number, required: true },
    status: { type: String, required: true, enum: ['PASS', 'REGRESSION', 'INSUFFICIENT_DATA'] },
    reason: { type: String }
  },
  { _id: false }
);

const StatisticalModelEvaluationSchema = new Schema<IStatisticalModelEvaluation>(
  {
    evaluationId: { type: String, required: true, unique: true, index: true },
    jobId: { type: String, required: true, index: true },
    candidateModelId: { type: String, required: true, index: true },
    candidateArtifactHash: { type: String, required: true },
    baselineModelId: { type: String, required: true, index: true },
    baselineArtifactHash: { type: String, required: true },
    goldenDatasetVersion: { type: String, required: true },
    goldenManifestHash: { type: String, required: true },
    candidatePredictionManifestHash: { type: String, required: true },
    baselinePredictionManifestHash: { type: String, required: true },
    groundTruthManifestHash: { type: String, required: true },

    statisticalPolicyId: { type: String, required: true },
    statisticalPolicyVersion: { type: String, required: true },
    statisticalPolicyHash: { type: String, required: true },

    bootstrapSeed: { type: Number, required: true },
    bootstrapIterations: { type: Number, required: true },
    bootstrapScriptHash: { type: String, required: true },

    statisticalDecision: {
      type: String,
      required: true,
      enum: ['SUPERIOR', 'INCONCLUSIVE', 'INFERIOR'],
      index: true
    },
    statisticallyMeaningful: { type: Boolean, required: true, index: true },
    shadowEligible: { type: Boolean, required: true, index: true },
    productionEligible: { type: Boolean, required: true, default: false, index: true },
    deploymentEligibility: {
      type: String,
      required: true,
      enum: ['NONE', 'SHADOW', 'CANARY', 'PRODUCTION'],
      default: 'NONE',
      index: true
    },

    candidateMetrics: { type: Schema.Types.Mixed, required: true },
    baselineMetrics: { type: Schema.Types.Mixed, required: true },
    metricDeltas: { type: Schema.Types.Mixed, required: true },

    bootstrapConfidenceInterval: { type: BootstrapConfidenceIntervalSchema, required: true },
    probabilityCandidateSuperior: { type: Number, required: true },
    cctvOperationalMetrics: { type: CctvOperationalMetricsSchema, required: true },
    subgroupResults: { type: [SubgroupEvaluationResultSchema], default: [] },

    rawMetricEvidenceHash: { type: String, required: true },
    subgroupResultHash: { type: String, required: true },
    resultHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err = new Error(errorMsg);
  if (next) next(err);
  else throw err;
}

StatisticalModelEvaluationSchema.pre('updateOne', function (this: any, next: any) {
  blockMutation('MUTATION_FORBIDDEN: StatisticalModelEvaluation document is immutable and append-only evidence.', next);
});

StatisticalModelEvaluationSchema.pre('deleteOne', function (this: any, next: any) {
  blockMutation('DELETION_FORBIDDEN: StatisticalModelEvaluation document is immutable.', next);
});

export const StatisticalModelEvaluationModel = mongoose.model<IStatisticalModelEvaluation>(
  'StatisticalModelEvaluation',
  StatisticalModelEvaluationSchema
);
