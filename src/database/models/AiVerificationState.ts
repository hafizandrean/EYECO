import mongoose, { Schema, Document } from 'mongoose';

export interface IAiVerificationState extends Document {
  cameraId: number;
  trackingId: string;
  consecutiveFrames: number;
  lastDetectedClass: string;
  updatedAt: Date;
}

const AiVerificationStateSchema = new Schema<IAiVerificationState>({
  cameraId: { type: Number, required: true, index: true },
  trackingId: { type: String, required: true, index: true },
  consecutiveFrames: { type: Number, required: true, default: 1 },
  lastDetectedClass: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now, index: { expires: 300 } } // Expires 5 minutes after last update
}, {
  timestamps: { createdAt: false, updatedAt: true } // Mongoose updates 'updatedAt' automatically on save/update
});

// Compound unique index to prevent duplicate records
AiVerificationStateSchema.index({ cameraId: 1, trackingId: 1 }, { unique: true });

export const AiVerificationStateModel = mongoose.model<IAiVerificationState>('AiVerificationState', AiVerificationStateSchema);
