import mongoose, { Schema, Document } from 'mongoose';

export interface ICameraEvent extends Document {
  id: number;
  cameraId: number;
  eventType: 'OFFLINE' | 'ONLINE' | 'RECONNECT' | 'PACKET_LOSS' | 'RTSP_TIMEOUT' | 'AUTH_FAILED' | 'RESOLUTION_CHANGED' | 'FPS_DROP';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  details: string;
  createdAt: Date;
}

const CameraEventSchema = new Schema<ICameraEvent>({
  id: { type: Number, required: true, unique: true },
  cameraId: { type: Number, required: true, index: true },
  eventType: {
    type: String,
    required: true,
    enum: ['OFFLINE', 'ONLINE', 'RECONNECT', 'PACKET_LOSS', 'RTSP_TIMEOUT', 'AUTH_FAILED', 'RESOLUTION_CHANGED', 'FPS_DROP']
  },
  severity: {
    type: String,
    required: true,
    enum: ['INFO', 'WARNING', 'CRITICAL']
  },
  details: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: { expires: 180 * 24 * 60 * 60 } } // Auto-delete after 180 days (TTL)
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const CameraEventModel = mongoose.model<ICameraEvent>('CameraEvent', CameraEventSchema);
