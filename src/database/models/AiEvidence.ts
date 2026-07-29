import mongoose, { Schema, Document } from 'mongoose';

export interface IAiEvidence extends Document {
  id: number;
  cameraId: number;
  capturedAt: Date;
  storageKey: string;
  sha256: string;
  linkedDetectionId: mongoose.Types.ObjectId;
  expiresAt?: Date | null; // TTL Index for 30-day auto-cleanup of unpromoted evidence
  mimeType: string;
  width: number;
  height: number;
  size: number; // bytes
  storage: 'LOCAL' | 'S3' | 'GCS' | 'AZURE' | 'R2';
  thumbnail: string;
  virusScanStatus: 'CLEAN' | 'INFECTED' | 'UNSCANNED';
  createdAt: Date;
  updatedAt: Date;
}

const AiEvidenceSchema = new Schema<IAiEvidence>({
  id: { type: Number, required: true, unique: true },
  cameraId: { type: Number, required: true, index: true },
  capturedAt: { type: Date, required: true },
  storageKey: { type: String, required: true },
  sha256: { type: String, required: true },
  linkedDetectionId: { type: Schema.Types.ObjectId, ref: 'AiDetection', required: true },
  expiresAt: { type: Date, default: null, index: { expires: 0 } },
  mimeType: { type: String, default: 'image/jpeg' },
  width: { type: Number, default: 1920 },
  height: { type: Number, default: 1080 },
  size: { type: Number, default: 0 },
  storage: { type: String, enum: ['LOCAL', 'S3', 'GCS', 'AZURE', 'R2'], default: 'LOCAL' },
  thumbnail: { type: String, default: '' },
  virusScanStatus: { type: String, enum: ['CLEAN', 'INFECTED', 'UNSCANNED'], default: 'CLEAN' }
}, {
  timestamps: true
});

export const AiEvidenceModel = mongoose.model<IAiEvidence>('AiEvidence', AiEvidenceSchema);
