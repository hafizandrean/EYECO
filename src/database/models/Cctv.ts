import mongoose, { Schema, Document } from 'mongoose';

export interface ICctv extends Document {
  id: number;
  name: string;
  location: string;
  description?: string;
  vendor: 'KRISBOW' | 'HIKVISION' | 'DAHUA' | 'EZVIZ' | 'GENERIC' | 'CUSTOM';
  model?: string;
  protocol: 'RTSP' | 'RTMP' | 'HLS' | 'MJPEG' | 'HTTP Image' | 'MP4' | 'CLOUD_VIEWER';
  mediaType: 'Video' | 'Image' | 'Cloud';
  streamUrl: string;
  playUrl?: string; // Generated proxy stream url (e.g. MediaMTX path)
  username?: string;
  password?: string; // Encrypted in database
  capabilities: {
    rtsp: boolean;
    hls: boolean;
    snapshot: boolean;
    mjpeg: boolean;
    onvif: boolean;
    cloud: boolean;
  };
  status: 'NEW' | 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'BUFFERING' | 'ERROR' | 'DISCONNECTED';
  health: {
    latency: number; // ms
    fps: number;
    resolution: string; // e.g. '1280x720'
  };
  isDefault: boolean; // Protects camera ID 1-8 from deletion
  isActive: boolean;
  lastHeartbeat?: Date;
  lastConnected?: Date;
  createdBy: number;
}

const CctvSchema: Schema = new Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String },
  vendor: { type: String, required: true, enum: ['KRISBOW', 'HIKVISION', 'DAHUA', 'EZVIZ', 'GENERIC', 'CUSTOM'], default: 'GENERIC' },
  model: { type: String },
  protocol: { type: String, required: true, enum: ['RTSP', 'RTMP', 'HLS', 'MJPEG', 'HTTP Image', 'MP4', 'CLOUD_VIEWER'] },
  mediaType: { type: String, required: true, enum: ['Video', 'Image', 'Cloud'] },
  streamUrl: { type: String, required: true },
  playUrl: { type: String },
  username: { type: String },
  password: { type: String }, // Stored encrypted
  capabilities: {
    rtsp: { type: Boolean, default: false },
    hls: { type: Boolean, default: false },
    snapshot: { type: Boolean, default: false },
    mjpeg: { type: Boolean, default: false },
    onvif: { type: Boolean, default: false },
    cloud: { type: Boolean, default: false }
  },
  status: { type: String, required: true, enum: ['NEW', 'CONNECTING', 'ONLINE', 'OFFLINE', 'BUFFERING', 'ERROR', 'DISCONNECTED'], default: 'NEW' },
  health: {
    latency: { type: Number, default: 0 },
    fps: { type: Number, default: 0 },
    resolution: { type: String, default: '1280x720' }
  },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastHeartbeat: { type: Date },
  lastConnected: { type: Date },
  createdBy: { type: Number, required: true }
}, {
  timestamps: true
});

export const CctvModel = mongoose.model<ICctv>('Cctv', CctvSchema);
