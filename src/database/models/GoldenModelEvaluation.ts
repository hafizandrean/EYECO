import mongoose, { Schema, Document } from 'mongoose';

export interface IGoldenEvaluationGateResult {
  gate: string;
  passed: boolean;
  observedValue: number;
  requiredValue: number;
  reasons: string[];
}

export interface IGoldenModelEvaluation extends Document {
  evaluationId: string;
  trainingJobId: string;
  evaluationMode: 'SIMULATION' | 'ACTUAL';
  metricsSource: 'SYNTHETIC' | 'ACTUAL';
  actualModelInferencePerformed: boolean;
  manifestSource: 'FIXTURE' | 'ACTUAL_INFERENCE';
  generatedByActualInference: boolean;
  resultInterpretation: 'PIPELINE_LOGIC_ONLY' | 'ACTUAL_MODEL_PERFORMANCE';
  evaluationPurpose: 'PIPELINE_SMOKE_TEST' | 'PROD_EVALUATION';
  statisticallyMeaningful: boolean;

  candidateArtifactHash?: string | null;
  activeModelArtifactHash?: string | null;
  baselineFixtureId?: string | null;
  goldenManifestHash: string;

  candidatePredictionManifestHash?: string | null;
  baselinePredictionManifestHash?: string | null;
  groundTruthManifestHash?: string | null;
  evaluatorScriptHash?: string | null;

  evaluationPolicyId: string;
  evaluationPolicyVersion: string;
  evaluationPolicyHash: string;

  candidateMetrics: Record<string, number>;
  activeModelMetrics: Record<string, number>;
  metricDeltas: Record<string, number>;

  gateResults: IGoldenEvaluationGateResult[];

  overallPassed: boolean;
  promotionEligible: boolean;
  reportHash: string;
  createdAt: Date;
}

const GoldenEvaluationGateResultSchema = new Schema<IGoldenEvaluationGateResult>(
  {
    gate: { type: String, required: true },
    passed: { type: Boolean, required: true },
    observedValue: { type: Number, required: true },
    requiredValue: { type: Number, required: true },
    reasons: { type: [String], default: [] }
  },
  { _id: false }
);

const GoldenModelEvaluationSchema = new Schema<IGoldenModelEvaluation>(
  {
    evaluationId: { type: String, required: true, unique: true, index: true },
    trainingJobId: { type: String, required: true, index: true },
    evaluationMode: { type: String, required: true, enum: ['SIMULATION', 'ACTUAL'], default: 'SIMULATION', index: true },
    metricsSource: { type: String, required: true, enum: ['SYNTHETIC', 'ACTUAL'], default: 'SYNTHETIC' },
    actualModelInferencePerformed: { type: Boolean, default: false },
    manifestSource: { type: String, enum: ['FIXTURE', 'ACTUAL_INFERENCE'], default: 'FIXTURE' },
    generatedByActualInference: { type: Boolean, default: false },
    resultInterpretation: { type: String, enum: ['PIPELINE_LOGIC_ONLY', 'ACTUAL_MODEL_PERFORMANCE'], default: 'PIPELINE_LOGIC_ONLY' },
    evaluationPurpose: { type: String, enum: ['PIPELINE_SMOKE_TEST', 'PROD_EVALUATION'], default: 'PIPELINE_SMOKE_TEST' },
    statisticallyMeaningful: { type: Boolean, default: false },

    candidateArtifactHash: { type: String, default: null },
    activeModelArtifactHash: { type: String, default: null },
    baselineFixtureId: { type: String, default: null },
    goldenManifestHash: { type: String, required: true },

    candidatePredictionManifestHash: { type: String, default: null },
    baselinePredictionManifestHash: { type: String, default: null },
    groundTruthManifestHash: { type: String, default: null },
    evaluatorScriptHash: { type: String, default: null },

    evaluationPolicyId: { type: String, required: true },
    evaluationPolicyVersion: { type: String, required: true },
    evaluationPolicyHash: { type: String, required: true },

    candidateMetrics: { type: Schema.Types.Mixed, required: true },
    activeModelMetrics: { type: Schema.Types.Mixed, required: true },
    metricDeltas: { type: Schema.Types.Mixed, required: true },

    gateResults: { type: [GoldenEvaluationGateResultSchema], required: true },

    overallPassed: { type: Boolean, required: true, index: true },
    promotionEligible: { type: Boolean, required: true, index: true },
    reportHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Immutability Guard Pre-Save Middleware for Golden Evaluation Reports
GoldenModelEvaluationSchema.pre('save', function (this: any) {
  if (!this.isNew) {
    throw new Error('GOLDEN_EVALUATION_IMMUTABLE: Cannot modify append-only golden model evaluation report document after creation');
  }
});

// Immutability Guard Query Middleware
const blockQueryMutation = function (this: any) {
  throw new Error('GOLDEN_EVALUATION_IMMUTABLE: Mutation operations (updateOne, updateMany, findOneAndUpdate, replaceOne) are prohibited on GoldenModelEvaluation documents');
};

GoldenModelEvaluationSchema.pre('updateOne', blockQueryMutation);
GoldenModelEvaluationSchema.pre('updateMany', blockQueryMutation);
GoldenModelEvaluationSchema.pre('findOneAndUpdate', blockQueryMutation);
GoldenModelEvaluationSchema.pre('replaceOne', blockQueryMutation);

export const GoldenModelEvaluationModel = mongoose.model<IGoldenModelEvaluation>(
  'GoldenModelEvaluation',
  GoldenModelEvaluationSchema
);
