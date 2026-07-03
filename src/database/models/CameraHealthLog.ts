import mongoose, { Schema, Document } from 'mongoose';

export interface ICameraHealthLog extends Document {
  cameraId: number;
  latency: number;
  fps: number;
  bandwidth: number; // bps
  packetLoss: number; // percentage
  createdAt: Date;
}

const CameraHealthLogSchema = new Schema<ICameraHealthLog>({
  cameraId: { type: Number, required: true, index: true },
  latency: { type: Number, required: true },
  fps: { type: Number, required: true },
  bandwidth: { type: Number, required: true },
  packetLoss: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, index: { expires: 604800 } } // Auto delete after 7 days
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const CameraHealthLogModel = mongoose.model<ICameraHealthLog>('CameraHealthLog', CameraHealthLogSchema);
