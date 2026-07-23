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
  inputImageHash: string;
  imagePath: string;
  pipelineVersion: string;
  featureSchemaVersion: string;
  modelRegistryInfo: ModelRegistryInfo;
  featureVector: FeatureVector;
  evidenceItems: EvidenceItem[];
  decision: DecisionResult;
  limitations: string[];
  pipelineTrace?: IPipelineTrace;
  parentSnapshotId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiSnapshotSchema = new Schema<IAiSnapshot>(
  {
    analysisId: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, index: true },
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
    evidenceItems: { type: Schema.Types.Mixed, required: true, default: [] },
    decision: { type: Schema.Types.Mixed, required: true },
    limitations: [{ type: String }],
    pipelineTrace: { type: Schema.Types.Mixed, default: null },
    parentSnapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
  },
  { timestamps: true }
);

// Idempotency compound index (Guardrail #7)
AiSnapshotSchema.index({ reportId: 1, inputImageHash: 1, pipelineVersion: 1 });

// Enforce Immutability
AiSnapshotSchema.pre('save', function (this: IAiSnapshot) {
  if (!this.isNew) {
    throw new Error('[IMMUTABLE_ERROR] AiSnapshot is immutable and cannot be modified after creation.');
  }
});

export const AiSnapshotModel = mongoose.model<IAiSnapshot>('AiSnapshot', AiSnapshotSchema);
