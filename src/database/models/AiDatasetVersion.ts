import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';

export type DatasetSplitType = 'TRAIN' | 'VAL' | 'TEST';
export type DatasetVersionStatus = 'BUILDING' | 'DRAFT' | 'INSUFFICIENT_DATA' | 'READY' | 'INVALID' | 'ARCHIVED';
export type TrainingEligibilityStatus = 'PENDING_GATE' | 'ELIGIBLE' | 'NOT_ELIGIBLE';

export interface IDatasetAnnotation {
  className: string;
  bbox: number[]; // [x1, y1, x2, y2]
  confidence?: number;
  annotationSource: 'OPERATOR_GROUND_TRUTH' | 'AI_PREDICTION';
}

export interface IDatasetManifestItem {
  candidateId: mongoose.Types.ObjectId;
  snapshotId: mongoose.Types.ObjectId;
  validationLogId?: mongoose.Types.ObjectId;
  reportId: number;
  split: DatasetSplitType;
  groupKey: string;
  inputImageHash: string;
  parentImageHash?: string;
  sourceVideoHash?: string;
  incidentId?: string;
  cameraId?: string;
  imagePath: string;
  operatorDecision: string;
  annotations: IDatasetAnnotation[];
}

export interface IAiDatasetVersion extends Document {
  datasetVersion: string;
  targetModel: TargetModelType;
  builderVersion: string;
  splitStrategyVersion: string;
  splitSeed: string;
  manifestHash: string;
  status: DatasetVersionStatus;
  structurallyValid: boolean;
  trainingEligibilityStatus: TrainingEligibilityStatus;
  trainingEligible: boolean;
  approvedEligibilityEvaluationId?: mongoose.Types.ObjectId | null;
  approvedEligibilityPolicyVersion?: string | null;
  approvedEligibilityEvaluationHash?: string | null;
  isTestData?: boolean;
  splitCounts: {
    train: number;
    val: number;
    test: number;
    total: number;
  };
  leakageCheckStatus: 'PASSED' | 'FAILED';
  leakageCheckDetails: {
    crossSplitGroupLeaks: number;
    crossSplitHashLeaks: number;
    crossSplitParentLeaks: number;
    crossSplitIncidentLeaks: number;
  };
  includedCandidateIds: mongoose.Types.ObjectId[];
  manifestItems: IDatasetManifestItem[];
  createdByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DatasetAnnotationSchema = new Schema<IDatasetAnnotation>(
  {
    className: { type: String, required: true },
    bbox: { type: [Number], required: true },
    confidence: { type: Number, default: 1.0 },
    annotationSource: { type: String, required: true, enum: ['OPERATOR_GROUND_TRUTH', 'AI_PREDICTION'], default: 'OPERATOR_GROUND_TRUTH' }
  },
  { _id: false }
);

const DatasetManifestItemSchema = new Schema<IDatasetManifestItem>(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'AiDatasetCandidate', required: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', required: true },
    validationLogId: { type: Schema.Types.ObjectId, ref: 'AiValidationLog', default: null },
    reportId: { type: Number, required: true },
    split: { type: String, required: true, enum: ['TRAIN', 'VAL', 'TEST'] },
    groupKey: { type: String, required: true },
    inputImageHash: { type: String, required: true },
    parentImageHash: { type: String, default: '' },
    sourceVideoHash: { type: String, default: '' },
    incidentId: { type: String, default: '' },
    cameraId: { type: String, default: '' },
    imagePath: { type: String, required: true },
    operatorDecision: { type: String, required: true },
    annotations: { type: [DatasetAnnotationSchema], default: [] }
  },
  { _id: false }
);

const AiDatasetVersionSchema = new Schema<IAiDatasetVersion>(
  {
    datasetVersion: { type: String, required: true, unique: true, index: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      index: true
    },
    builderVersion: { type: String, default: 'v3.0.0', required: true },
    splitStrategyVersion: { type: String, default: 'v1.0-deterministic-group', required: true },
    splitSeed: { type: String, default: 'eyeco-seed-2026', required: true },
    manifestHash: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['BUILDING', 'DRAFT', 'INSUFFICIENT_DATA', 'READY', 'INVALID', 'ARCHIVED'],
      default: 'BUILDING',
      index: true
    },
    structurallyValid: { type: Boolean, default: false, index: true },
    trainingEligibilityStatus: {
      type: String,
      required: true,
      enum: ['PENDING_GATE', 'ELIGIBLE', 'NOT_ELIGIBLE'],
      default: 'NOT_ELIGIBLE',
      index: true
    },
    trainingEligible: { type: Boolean, default: false, index: true },
    approvedEligibilityEvaluationId: { type: Schema.Types.ObjectId, ref: 'TrainingEligibilityEvaluation', default: null },
    approvedEligibilityPolicyVersion: { type: String, default: null },
    approvedEligibilityEvaluationHash: { type: String, default: null },
    isTestData: { type: Boolean, default: false, index: true },
    splitCounts: {
      train: { type: Number, default: 0 },
      val: { type: Number, default: 0 },
      test: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    leakageCheckStatus: { type: String, required: true, enum: ['PASSED', 'FAILED'], default: 'PASSED' },
    leakageCheckDetails: {
      crossSplitGroupLeaks: { type: Number, default: 0 },
      crossSplitHashLeaks: { type: Number, default: 0 },
      crossSplitParentLeaks: { type: Number, default: 0 },
      crossSplitIncidentLeaks: { type: Number, default: 0 }
    },
    includedCandidateIds: [{ type: Schema.Types.ObjectId, ref: 'AiDatasetCandidate' }],
    manifestItems: [DatasetManifestItemSchema],
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

// Document Save Immutability Guard
AiDatasetVersionSchema.pre('save', function (this: any) {
  if (!this.isNew && ['READY', 'INSUFFICIENT_DATA', 'INVALID', 'ARCHIVED'].includes(this.status)) {
    if (this.isModified('manifestItems') || this.isModified('manifestHash') || this.isModified('splitCounts')) {
      throw new Error('AI_DATASET_VERSION_IMMUTABLE: Cannot modify manifest items or hash on completed dataset version');
    }
  }
});

// Query Mutation Immutability Guard: Block updateOne, updateMany, findOneAndUpdate, findByIdAndUpdate, replaceOne
const blockMutationQueries = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findByIdAndUpdate', 'replaceOne'];
blockMutationQueries.forEach(queryName => {
  AiDatasetVersionSchema.pre(queryName as any, function (this: any) {
    const update = this.getUpdate();
    if (update && (update.manifestItems || update.$set?.manifestItems || update.manifestHash || update.$set?.manifestHash)) {
      throw new Error(`AI_DATASET_VERSION_IMMUTABLE: Operation ${queryName} blocked on dataset version manifest`);
    }
  });
});

export const AiDatasetVersionModel = mongoose.model<IAiDatasetVersion>('AiDatasetVersion', AiDatasetVersionSchema);
