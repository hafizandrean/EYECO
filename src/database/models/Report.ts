import mongoose, { Schema, Document } from 'mongoose';

export interface IBoundingBox {
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IComment {
  _id: mongoose.Types.ObjectId;
  userId: number;
  text: string;
  likedBy: number[];
  isDeleted: boolean;
  parentCommentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISla {
  detectedAt: Date;
  validatedAt: Date | null;
  assignedAt: Date | null;
  arrivedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  validationDurationMs: number | null;
  assignmentDurationMs: number | null;
  cleanupDurationMs: number | null;
  resolutionDurationMs: number | null;
  totalDurationMs: number | null;
}

export interface IReport extends Document {
  id: number;
  userId: mongoose.Types.ObjectId;
  tenantId: string;
  location: string;
  timestamp: Date;
  aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' | 'Indikasi Tinggi' | 'Indikasi Sedang' | 'Indikasi Rendah';
  aiConfidence: number | null; // 0 - 100
  violationScore?: number | null;
  objectConfidence?: number | null;
  sceneConfidence?: number | null;
  decisionConfidence?: number | null;
  uncertaintyScore?: number | null;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  recommendedAction?: string | null;
  activeSnapshotId?: mongoose.Types.ObjectId | null;
  snapshotHistory?: mongoose.Types.ObjectId[];
  analysisState?: 'PROCESSING' | 'READY' | 'FAILED' | 'REANALYSIS_PENDING';
  analysisOutcome?: 'COMPLETE' | 'COMPLETE_WITH_LIMITATIONS' | 'INCOMPLETE' | null;
  aiDataIntegrityStatus?: 'VALID' | 'PENDING' | 'LEGACY' | 'SNAPSHOT_MISSING' | 'INCONSISTENT' | null;
  sourceDetectionId?: mongoose.Types.ObjectId | null;
  analysisStartedAt?: Date | null;
  analysisLeaseExpiresAt?: Date | null;
  analysisAttemptCount?: number;
  analysisErrorCode?: string | null;
  analysisClaimToken?: string | null;
  analysisNextRetryAt?: Date | null;
  adminStatus: 'MENUNGGU' | 'VALID' | 'TIDAK_VALID';
  telegramStatus?: 'NOT_ELIGIBLE' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  telegramSentAt?: Date | null;
  telegramError?: string | null;
  telegramAttemptCount?: number;
  telegramLastAttemptAt?: Date | null;
  telegramMessageId?: string | null;
  image: string;
  identity: string;
  sourceType: string;
  additionalNotes: string;
  adminNotes: string;
  boundingBoxes: IBoundingBox[];
  comments: mongoose.Types.DocumentArray<IComment & mongoose.Document>;
  assignedOfficer: string;
  status: 'NEW' | 'UNDER_REVIEW' | 'VALIDATED' | 'ASSIGNED' | 'ON_SITE' | 'IN_PROGRESS' | 'RESOLVED' | 'WAITING_APPROVAL' | 'CLOSED' | 'REJECTED';
  currentAssignmentId: mongoose.Types.ObjectId | null;
  currentResolutionId: mongoose.Types.ObjectId | null;
  sla: ISla;
  deletedAt: Date | null;
  scheduledDeletionAt: Date | null;
  verifiedAt: Date | null;
  deletedById: mongoose.Types.ObjectId | null;
  deletedByName: string | null;
  deleteReason: string | null;
  restoreReason: string | null;
  archived: boolean;
  archivedAt: Date | null;
  archiveReason: string | null;
  sourceMetadata: ISourceMetadata;
  signals?: ISignals;
  incidentKey?: string;
  sourceVideoId?: mongoose.Types.ObjectId;
  validationStatus?: 'PENDING' | 'IN_REVIEW' | 'CONFIRMED' | 'REJECTED';
  needsHumanValidation?: boolean;
  createdFrom?: string;
  videoPath?: string;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
  workspaceId?: number;
}

export interface ISourceMetadata {
  cameraId?: number;
  modelId?: string;
  confidence?: number;
  detectionId?: number;
  reporterDevice?: string;
  appVersion?: string;
  clientIp?: string;
  ruleVersion?: string;
  modelVersion?: string;
}

export interface ISignals {
  active: number[];
  resolved: number[];
}

const SourceMetadataSchema = new Schema<ISourceMetadata>({
  cameraId: { type: Number },
  modelId: { type: String },
  confidence: { type: Number },
  detectionId: { type: Number },
  reporterDevice: { type: String },
  appVersion: { type: String },
  clientIp: { type: String },
  ruleVersion: { type: String },
  modelVersion: { type: String }
}, { _id: false });

const BoundingBoxSchema = new Schema<IBoundingBox>({
  label: { type: String, required: true, trim: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  x: { type: Number, required: true, min: 0, max: 100 },
  y: { type: Number, required: true, min: 0, max: 100 },
  w: { type: Number, required: true, min: 0, max: 100 },
  h: { type: Number, required: true, min: 0, max: 100 }
});

const CommentSchema = new Schema<IComment>({
  userId: { type: Number, required: true },
  text: { type: String, required: true, trim: true },
  likedBy: { type: [Number], default: [] },
  isDeleted: { type: Boolean, default: false },
  parentCommentId: { type: String, default: null }
}, {
  timestamps: true
});

const SlaSchema = new Schema<ISla>({
  detectedAt: { type: Date, required: true },
  validatedAt: { type: Date, default: null },
  assignedAt: { type: Date, default: null },
  arrivedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  validationDurationMs: { type: Number, default: null },
  assignmentDurationMs: { type: Number, default: null },
  cleanupDurationMs: { type: Number, default: null },
  resolutionDurationMs: { type: Number, default: null },
  totalDurationMs: { type: Number, default: null }
}, { _id: false });

const ReportSchema = new Schema<IReport>({
  id: { type: Number, required: true, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tenantId: { type: String, default: 'BBWS', index: true },
  location: { type: String, required: true, trim: true },
  timestamp: { type: Date, required: true, index: true },
  aiStatus: { 
    type: String, 
    enum: ['Indikasi Tinggi', 'Indikasi Sedang', 'Indikasi Rendah', 'Tidak Terindikasi', 'TINGGI', 'SEDANG', 'RENDAH'], 
    required: true, 
    index: true 
  },
  aiConfidence: { type: Number, default: null },
  violationScore: { type: Number, default: null },
  objectConfidence: { type: Number, default: null },
  sceneConfidence: { type: Number, default: null },
  decisionConfidence: { type: Number, default: null },
  uncertaintyScore: { type: Number, default: null },
  priority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], default: null },
  recommendedAction: { type: String, default: null },
  activeSnapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
  snapshotHistory: [{ type: Schema.Types.ObjectId, ref: 'AiSnapshot' }],
  analysisState: { 
    type: String, 
    enum: ['PROCESSING', 'READY', 'FAILED', 'REANALYSIS_PENDING'], 
    default: 'READY', 
    index: true 
  },
  sourceDetectionId: { type: Schema.Types.ObjectId, ref: 'AiDetection', default: null, sparse: true, index: true },
  analysisStartedAt: { type: Date, default: null },
  analysisLeaseExpiresAt: { type: Date, default: null, index: true },
  analysisAttemptCount: { type: Number, default: 0 },
  analysisErrorCode: { type: String, default: null },
  analysisClaimToken: { type: String, default: null, index: true },
  analysisNextRetryAt: { type: Date, default: null, index: true },
  adminStatus: { 
    type: String, 
    enum: ['MENUNGGU', 'VALID', 'TIDAK_VALID'], 
    required: true, 
    default: 'MENUNGGU', 
    index: true 
  },
  telegramStatus: {
    type: String,
    enum: ['NOT_ELIGIBLE', 'QUEUED', 'SENDING', 'SENT', 'FAILED'],
    default: 'NOT_ELIGIBLE',
    index: true
  },
  telegramSentAt: { type: Date, default: null },
  telegramError: { type: String, default: null },
  telegramAttemptCount: { type: Number, default: 0 },
  telegramLastAttemptAt: { type: Date, default: null },
  telegramMessageId: { type: String, default: null },
  image: { type: String, required: true },
  identity: { type: String, default: 'Belum diketahui', trim: true },
  sourceType: { type: String, required: true, trim: true },
  additionalNotes: { type: String, default: 'Tidak ada catatan tambahan.', trim: true },
  adminNotes: { type: String, default: '', trim: true },
  boundingBoxes: [BoundingBoxSchema],
  comments: [CommentSchema],
  assignedOfficer: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['NEW', 'PENDING', 'UNDER_REVIEW', 'VALIDATED', 'ASSIGNED', 'ON_SITE', 'IN_PROGRESS', 'PROSES', 'RESOLVED', 'SELESAI', 'WAITING_APPROVAL', 'CLOSED', 'REJECTED', 'DITOLAK'], 
    default: 'NEW', 
    index: true 
  },
  currentAssignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', default: null },
  currentResolutionId: { type: Schema.Types.ObjectId, ref: 'Resolution', default: null },
  sla: { type: SlaSchema, required: true },
  deletedAt: { type: Date, default: null },
  scheduledDeletionAt: { type: Date, default: null },
  deletedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  deletedByName: { type: String, default: null },
  deleteReason: { type: String, default: null },
  restoreReason: { type: String, default: null },
  archived: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, default: null },
  archiveReason: { type: String, default: null },
  workspaceId: { type: Number, index: true },
  sourceMetadata: { type: SourceMetadataSchema, default: {} },
  verifiedAt: { type: Date, default: null },
    signals: {
      type: new Schema({
        active: { type: [Number], default: [] },
        resolved: { type: [Number], default: [] }
      }, { _id: false }),
      default: { active: [], resolved: [] }
    },
    incidentKey: { type: String, sparse: true, index: true },
    sourceVideoId: { type: Schema.Types.ObjectId, ref: 'Report', sparse: true, index: true },
    validationStatus: {
      type: String,
      enum: ['PENDING', 'IN_REVIEW', 'CONFIRMED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },
    needsHumanValidation: { type: Boolean, default: false },
    createdFrom: { type: String, default: null },
    videoPath: { type: String, default: null }
  }, {
    timestamps: true,
    id: false // Prevent Mongoose virtual 'id' from overriding our numeric 'id' field
  });

ReportSchema.index({ timestamp: -1, adminStatus: 1 });
// Compound index for sorted status queries
ReportSchema.index({ status: 1, timestamp: -1 });
// TTL index: auto-delete validated reports 40 days after scheduledDeletionAt is set
ReportSchema.index({ scheduledDeletionAt: 1 }, { expireAfterSeconds: 0 });
// Compound index for video analysis incident idempotency
ReportSchema.index({ sourceVideoId: 1, incidentKey: 1 }, { unique: true, sparse: true });

export const ReportModel = mongoose.model<IReport>('Report', ReportSchema);
