import mongoose, { Schema, Document } from 'mongoose';

export interface IAttachment {
  name: string;
  url: string;
  storageKey: string;
  mimeType: string;
  size: number;
  sha256: string;
  checksumAlgorithm: 'SHA256' | 'SHA512' | 'MD5';
  storage: 'LOCAL' | 'S3' | 'MINIO';
  imageWidth: number | null;
  imageHeight: number | null;
  thumbnailUrl: string | null;
  virusScanStatus: 'CLEAN' | 'INFECTED' | 'UNSCANNED';
  uploadedById: mongoose.Types.ObjectId;
  uploadedByName: string;
  uploadedAt: Date;
}

export interface IResolution extends Document {
  workspaceId: number;
  reportId: mongoose.Types.ObjectId;
  isCleaned: boolean;
  afterImages: IAttachment[];
  fieldNotes: string;
  completedAt: Date;
  officerId: mongoose.Types.ObjectId;
  officerName: string;
  resolvedById: mongoose.Types.ObjectId;
  resolvedByName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedAt: Date | null;
  approvedById: mongoose.Types.ObjectId | null;
  approvedByName: string | null;
  approvedByRole: string | null;
}

const AttachmentSchema = new Schema<IAttachment>({
  name: { type: String, required: true },
  url: { type: String, required: true },
  storageKey: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  checksumAlgorithm: { type: String, enum: ['SHA256', 'SHA512', 'MD5'], default: 'SHA256', required: true },
  storage: { type: String, enum: ['LOCAL', 'S3', 'MINIO'], default: 'LOCAL', required: true },
  imageWidth: { type: Number, default: null },
  imageHeight: { type: Number, default: null },
  thumbnailUrl: { type: String, default: null },
  virusScanStatus: { type: String, enum: ['CLEAN', 'INFECTED', 'UNSCANNED'], default: 'UNSCANNED', required: true },
  uploadedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedByName: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now, required: true }
});

const ResolutionSchema = new Schema<IResolution>({
  workspaceId: { type: Number, index: true },
  reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
  isCleaned: { type: Boolean, default: false, required: true },
  afterImages: [AttachmentSchema],
  fieldNotes: { type: String, default: '' },
  completedAt: { type: Date, default: Date.now, required: true },
  officerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  officerName: { type: String, required: true },
  resolvedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  resolvedByName: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', required: true },
  approvedAt: { type: Date, default: null },
  approvedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedByName: { type: String, default: null },
  approvedByRole: { type: String, default: null }
}, {
  timestamps: true
});

ResolutionSchema.index({ workspaceId: 1, reportId: 1, status: 1 });

export const ResolutionModel = mongoose.model<IResolution>('Resolution', ResolutionSchema);
