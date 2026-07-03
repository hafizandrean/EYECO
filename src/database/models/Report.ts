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
  aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  aiConfidence: number | null;
  adminStatus: 'MENUNGGU' | 'VALID' | 'DIABAIKAN';
  image: string;
  identity: string;
  sourceType: string;
  additionalNotes: string;
  adminNotes: string;
  boundingBoxes: IBoundingBox[];
  comments: IComment[];
  assignedOfficer: string;
  status: 'NEW' | 'UNDER_REVIEW' | 'VALIDATED' | 'ASSIGNED' | 'ON_SITE' | 'IN_PROGRESS' | 'RESOLVED' | 'WAITING_APPROVAL' | 'CLOSED' | 'REJECTED';
  currentAssignmentId: mongoose.Types.ObjectId | null;
  currentResolutionId: mongoose.Types.ObjectId | null;
  sla: ISla;
  deletedAt: Date | null;
  deletedById: mongoose.Types.ObjectId | null;
  deletedByName: string | null;
  deleteReason: string | null;
  restoreReason: string | null;
  archived: boolean;
  archivedAt: Date | null;
  archiveReason: string | null;
  sourceMetadata: ISourceMetadata;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
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
    enum: ['TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi'], 
    required: true, 
    index: true 
  },
  aiConfidence: { type: Number, default: null },
  adminStatus: { 
    type: String, 
    enum: ['MENUNGGU', 'VALID', 'DIABAIKAN'], 
    required: true, 
    default: 'MENUNGGU', 
    index: true 
  },
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
    enum: ['NEW', 'UNDER_REVIEW', 'VALIDATED', 'ASSIGNED', 'ON_SITE', 'IN_PROGRESS', 'RESOLVED', 'WAITING_APPROVAL', 'CLOSED', 'REJECTED'], 
    default: 'NEW', 
    index: true 
  },
  currentAssignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', default: null },
  currentResolutionId: { type: Schema.Types.ObjectId, ref: 'Resolution', default: null },
  sla: { type: SlaSchema, required: true },
  deletedAt: { type: Date, default: null },
  deletedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  deletedByName: { type: String, default: null },
  deleteReason: { type: String, default: null },
  restoreReason: { type: String, default: null },
  archived: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, default: null },
  archiveReason: { type: String, default: null },
  sourceMetadata: { type: SourceMetadataSchema, default: {} }
}, {
  timestamps: true
});

ReportSchema.index({ timestamp: -1, adminStatus: 1 });
// Compound index for sorted status queries
ReportSchema.index({ status: 1, timestamp: -1 });

export const ReportModel = mongoose.model<IReport>('Report', ReportSchema);
