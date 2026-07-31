import mongoose, { Schema, Document } from 'mongoose';
import { EvidenceItem, FeatureVector, DecisionResult, ModelRegistryInfo } from '../../services/ai/types/ai.types';

export interface IPipelineTraceLayer {
  name: string;
  status: 'SUCCESS' | 'DEGRADED' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  errorCode?: string;
}

export interface IPipelineTrace {
  analysisId: string;
  correlationId: string;
  startedAt: Date;
  completedAt: Date;
  totalDurationMs: number;
  layers: IPipelineTraceLayer[];
}

export interface IAiSnapshot extends Document {
  analysisId: string;
  reportId?: number;
  snapshotKey?: string;
  inputImageHash: string;
  imagePath: string;
  pipelineVersion: string;
  featureSchemaVersion: string;
  modelRegistryInfo: ModelRegistryInfo;
  featureVector: FeatureVector;
  fusionDecisions?: any[];
  evidenceItems: EvidenceItem[];
  decision: DecisionResult;
  limitations: string[];
  pipelineTrace?: IPipelineTrace;
  parentSnapshotId?: mongoose.Types.ObjectId;
  reportObjectId?: mongoose.Types.ObjectId;
  analysisClaimToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FusionSignalSchema = new Schema(
  {
    evidenceId: { type: String, required: true },
    category: {
      type: String,
      enum: ['OBJECT_EXISTENCE', 'HUMAN_INTERACTION', 'TEMPORAL_SUPPORT', 'ENVIRONMENT_CONTEXT', 'CONFLICT', 'QUALITY_WARNING'],
      required: true
    },
    code: { type: String, required: true },
    sourceLayer: { type: String, required: true },
    confidence: { type: Number, default: null }
  },
  { _id: false }
);

const FusionDecisionSchema = new Schema(
  {
    detectionId: { type: String, required: true },
    originalConfidence: { type: Number, required: true },
    candidateClass: { type: String, required: true },
    objectExistenceStatus: {
      type: String,
      enum: ['CONFIRMED', 'CANDIDATE', 'REJECTED'],
      required: true
    },
    policyEvidenceRole: {
      type: String,
      enum: ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'UNAVAILABLE'],
      required: true
    },
    acceptanceReason: { type: String, required: true },
    supportSignals: [FusionSignalSchema],
    conflictSignals: [FusionSignalSchema],
    fusionConfidence: { type: Number, required: true },
    fusionRuleVersion: { type: String, default: 'fusion-v1' }
  },
  { _id: false }
);

const AiSnapshotSchema = new Schema<IAiSnapshot>(
  {
    analysisId: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, index: true },
    reportObjectId: { type: Schema.Types.ObjectId, ref: 'Report', index: true },
    analysisClaimToken: { type: String, index: true },
    inputImageHash: { type: String, required: true, index: true },
    imagePath: { type: String, required: true },
    pipelineVersion: { type: String, required: true, default: 'v3.0.0' },
    featureSchemaVersion: { type: String, required: true, default: 'feature-v1' },
    modelRegistryInfo: {
      yoloVersion: { type: String, default: 'v8.2.0-yolov8n' },
      poseVersion: { type: String, default: 'yolov8n-pose-v1.0' },
      sceneVersion: { type: String, default: 'SpatialAnalyzer-v1.0' },
      decisionVersion: { type: String, default: 'RuleEngine-v1.0' },
      datasetVersion: { type: String, default: 'dataset-v1.0' },
      featureSchemaVersion: { type: String, default: 'feature-v1' },
      policyVersion: { type: String, default: 'policy-v1.0' },
    },
    featureVector: { type: Schema.Types.Mixed, required: true },
    fusionDecisions: [FusionDecisionSchema],
    evidenceItems: { type: Schema.Types.Mixed, required: true, default: [] },
    decision: { type: Schema.Types.Mixed, required: true },
    limitations: [{ type: String }],
    pipelineTrace: { type: Schema.Types.Mixed, default: null },
    parentSnapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
    snapshotKey: { type: String, unique: true, sparse: true, index: true },
  },
  { timestamps: true }
);

// Idempotency compound index (Guardrail #7)
AiSnapshotSchema.index({ reportId: 1, inputImageHash: 1, pipelineVersion: 1 });

// Enforce Immutability at database level
function rejectSnapshotMutation(): never {
  throw new Error('AI_SNAPSHOT_IMMUTABLE');
}

const FORBIDDEN_QUERY_OPERATIONS = [
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'replaceOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
] as const;

for (const operation of FORBIDDEN_QUERY_OPERATIONS) {
  AiSnapshotSchema.pre(operation as any, function () {
    rejectSnapshotMutation();
  });
}

AiSnapshotSchema.pre('save', function (this: IAiSnapshot) {
  if (!this.isNew) {
    rejectSnapshotMutation();
  }
});

AiSnapshotSchema.pre('bulkWrite', function () {
  rejectSnapshotMutation();
});

AiSnapshotSchema.pre('deleteOne', { document: true, query: false }, function () {
  rejectSnapshotMutation();
});

AiSnapshotSchema.pre('updateOne', function (this: any) {
  const options = this.getOptions();
  const update = this.getUpdate() as Record<string, any>;

  const onlySetOnInsert =
    options &&
    options.upsert === true &&
    update &&
    '$setOnInsert' in update &&
    Object.keys(update).every(key => {
      if (key === '$setOnInsert') return true;
      if (key === '$set') {
        const setVal = update['$set'] as Record<string, any>;
        const keys = Object.keys(setVal);
        return keys.length === 1 && keys[0] === 'updatedAt';
      }
      return false;
    });

  if (!onlySetOnInsert) {
    rejectSnapshotMutation();
  }
});

export const AiSnapshotModel = mongoose.model<IAiSnapshot>('AiSnapshot', AiSnapshotSchema);
