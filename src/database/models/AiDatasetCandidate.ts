import mongoose, { Schema, Document } from 'mongoose';

export type TargetModelType = 'OBJECT_DETECTOR' | 'POSE_MODEL' | 'SEMANTIC_MODEL' | 'POLICY_CALIBRATION';
export type CandidateApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'RESERVED_FOR_BUILD' | 'REJECTED' | 'ASSIGNED_TO_DATASET';
export type DatasetUsageRole = 'TRAINING_POSITIVE' | 'TRAINING_NEGATIVE' | 'CORRECTION' | 'EXCLUDED' | 'HUMAN_REVIEW' | 'GOLDEN_EVALUATION';

export interface IScoreBreakdownItem {
  reason: string;
  delta: number;
  evidenceId?: string;
}

export interface IConditionMetadata {
  lighting?: 'DAY' | 'NIGHT' | 'UNKNOWN';
  weather?: 'CLEAR' | 'RAIN' | 'UNKNOWN';
  blurLevel?: number | null;
  objectScale?: 'SMALL' | 'MEDIUM' | 'LARGE';
  activityContext?: 'DUMPING' | 'CARRYING' | 'PASSING' | 'PRE_EXISTING_TRASH' | 'OTHER';
  samplingSource?: 'OPERATIONAL_FEEDBACK' | 'INDEPENDENT_WINDOW';
  sampledAt?: Date;
  cameraId?: string;
  sourceVideoHash?: string;
  incidentId?: string;
  trackingSessionId?: string;
  verifiedByUserId?: mongoose.Types.ObjectId;
  metadataPolicyVersion?: string;
}

export interface IAiDatasetCandidate extends Document {
  idempotencyKey: string;
  reportId: number;
  reportObjectId?: mongoose.Types.ObjectId;
  snapshotId: mongoose.Types.ObjectId;
  validationLogId?: mongoose.Types.ObjectId;
  validationVersion: number;
  selectorVersion: string;
  targetModel: TargetModelType;
  candidateScore: number; // 0 - 100
  scoreBreakdown: IScoreBreakdownItem[];
  selectionReasons: string[];
  operatorDecision?: string;
  predictedStatus?: string;
  predictedScore?: number | null;
  inputImageHash: string;
  parentImageHash?: string;
  sourceVideoHash?: string;
  incidentId?: string;
  conditionMetadata?: IConditionMetadata;
  approvalStatus: CandidateApprovalStatus;
  datasetUsageRole?: DatasetUsageRole | null;
  approvedByUserId?: mongoose.Types.ObjectId;
  approvalNotes?: string;
  isCurrentEvaluation: boolean;
  supersededAt?: Date | null;
  supersededByCandidateId?: mongoose.Types.ObjectId | null;
  assignedDatasetVersion?: string | null;
  assignedAt?: Date | null;
  feedbackRevision: number;
  lastValidationEventId?: mongoose.Types.ObjectId | null;
  evaluatedAt: Date;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ScoreBreakdownItemSchema = new Schema<IScoreBreakdownItem>(
  {
    reason: { type: String, required: true },
    delta: { type: Number, required: true },
    evidenceId: { type: String, default: undefined }
  },
  { _id: false }
);

const ConditionMetadataSchema = new Schema<IConditionMetadata>(
  {
    lighting: { type: String, enum: ['DAY', 'NIGHT', 'UNKNOWN'], default: 'UNKNOWN' },
    weather: { type: String, enum: ['CLEAR', 'RAIN', 'UNKNOWN'], default: 'UNKNOWN' },
    blurLevel: { type: Number, default: null },
    objectScale: { type: String, enum: ['SMALL', 'MEDIUM', 'LARGE'], default: 'MEDIUM' },
    activityContext: { type: String, enum: ['DUMPING', 'CARRYING', 'PASSING', 'PRE_EXISTING_TRASH', 'OTHER'], default: 'OTHER' },
    samplingSource: { type: String, enum: ['OPERATIONAL_FEEDBACK', 'INDEPENDENT_WINDOW'], default: 'OPERATIONAL_FEEDBACK' },
    sampledAt: { type: Date, default: null },
    cameraId: { type: String, default: '' },
    sourceVideoHash: { type: String, default: '' },
    incidentId: { type: String, default: '' },
    trackingSessionId: { type: String, default: '' },
    verifiedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    metadataPolicyVersion: { type: String, default: 'v1.0.0' }
  },
  { _id: false }
);

const AiDatasetCandidateSchema = new Schema<IAiDatasetCandidate>(
  {
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, required: true, index: true },
    reportObjectId: { type: Schema.Types.ObjectId, ref: 'Report', default: null },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', required: true, index: true },
    validationLogId: { type: Schema.Types.ObjectId, ref: 'AiValidationLog', default: null },
    validationVersion: { type: Number, default: 1, required: true },
    selectorVersion: { type: String, default: 'v1.0.0', required: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      index: true
    },
    candidateScore: { type: Number, required: true, min: 0, max: 100 },
    scoreBreakdown: { type: [ScoreBreakdownItemSchema], default: [] },
    selectionReasons: { type: [String], default: [] },
    operatorDecision: { type: String, default: '' },
    predictedStatus: { type: String, default: '' },
    predictedScore: { type: Number, default: null },
    inputImageHash: { type: String, required: true, index: true },
    parentImageHash: { type: String, default: '' },
    sourceVideoHash: { type: String, default: '' },
    incidentId: { type: String, default: '' },
    conditionMetadata: { type: ConditionMetadataSchema, default: null },
    approvalStatus: {
      type: String,
      required: true,
      enum: ['PENDING_APPROVAL', 'APPROVED', 'RESERVED_FOR_BUILD', 'REJECTED', 'ASSIGNED_TO_DATASET'],
      default: 'PENDING_APPROVAL',
      index: true
    },
    datasetUsageRole: {
      type: String,
      enum: ['TRAINING_POSITIVE', 'TRAINING_NEGATIVE', 'CORRECTION', 'EXCLUDED', 'HUMAN_REVIEW', 'GOLDEN_EVALUATION'],
      default: null,
      index: true
    },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvalNotes: { type: String, default: '' },
    isCurrentEvaluation: { type: Boolean, default: true, index: true },
    supersededAt: { type: Date, default: null },
    supersededByCandidateId: { type: Schema.Types.ObjectId, ref: 'AiDatasetCandidate', default: null },
    assignedDatasetVersion: { type: String, default: null, index: true },
    assignedAt: { type: Date, default: null },
    feedbackRevision: { type: Number, default: 0 },
    lastValidationEventId: { type: Schema.Types.ObjectId, ref: 'AdminValidationEvent', default: null },
    evaluatedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Compound Unique Index: Includes validationVersion & selectorVersion
AiDatasetCandidateSchema.index(
  { snapshotId: 1, targetModel: 1, selectorVersion: 1, validationVersion: 1 },
  { unique: true }
);

export const AiDatasetCandidateModel = mongoose.model<IAiDatasetCandidate>('AiDatasetCandidate', AiDatasetCandidateSchema);
