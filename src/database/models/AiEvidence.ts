import mongoose, { Schema, Document } from 'mongoose';

export type StorageStatus = 'PENDING' | 'UPLOADING' | 'AVAILABLE' | 'RETRY_WAIT' | 'FAILED' | 'MISSING';

export interface IEvidenceStorage {
  provider: 'R2' | 'LOCAL';
  bucket: string;
  key: string;
  contentType: string;
  size: number;
  sha256?: string;
  etag?: string;
  uploadedAt: Date;
  status: StorageStatus;
}

export interface IAiEvidence extends Document {
  id: number;
  cameraId: number;
  capturedAt: Date;
  storageKey: string;
  sha256: string;
  linkedDetectionId: mongoose.Types.ObjectId;
  reportId?: mongoose.Types.ObjectId | null;
  expiresAt?: Date | null; // TTL Index for 30-day auto-cleanup of unpromoted evidence
  mimeType: string;
  width: number;
  height: number;
  size: number; // bytes
  storage: IEvidenceStorage;
  thumbnail: string;
  virusScanStatus: 'CLEAN' | 'INFECTED' | 'UNSCANNED';
  createdAt: Date;
  updatedAt: Date;
}

const EvidenceStorageSchema = new Schema<IEvidenceStorage>({
  provider: { type: String, enum: ['R2', 'LOCAL'], default: 'LOCAL' },
  bucket: { type: String, default: 'eyeco' },
  key: { type: String, required: true, index: true },
  contentType: { type: String, default: 'image/jpeg' },
  size: { type: Number, default: 0 },
  sha256: { type: String, default: '' },
  etag: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['PENDING', 'UPLOADING', 'AVAILABLE', 'RETRY_WAIT', 'FAILED', 'MISSING'], 
    default: 'PENDING',
    index: true 
  }
}, { _id: false });

const AiEvidenceSchema = new Schema<IAiEvidence>({
  id: { type: Number, required: true, unique: true },
  cameraId: { type: Number, required: true, index: true },
  capturedAt: { type: Date, required: true },
  storageKey: { type: String, required: true },
  sha256: { type: String, required: true },
  linkedDetectionId: { type: Schema.Types.ObjectId, ref: 'AiDetection', required: true },
  reportId: { type: Schema.Types.ObjectId, ref: 'Report', default: null, index: true },
  expiresAt: { type: Date, default: null, index: { expires: 0 } },
  mimeType: { type: String, default: 'image/jpeg' },
  width: { type: Number, default: 1920 },
  height: { type: Number, default: 1080 },
  size: { type: Number, default: 0 },
  storage: { type: EvidenceStorageSchema, required: true },
  thumbnail: { type: String, default: '' },
  virusScanStatus: { type: String, enum: ['CLEAN', 'INFECTED', 'UNSCANNED'], default: 'CLEAN' }
}, {
  timestamps: true
});

export const AiEvidenceModel = mongoose.model<IAiEvidence>('AiEvidence', AiEvidenceSchema);
