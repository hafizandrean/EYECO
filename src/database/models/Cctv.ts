import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICctvCapabilities {
  rtsp: boolean;
  hls: boolean;
  snapshot: boolean;
  mjpeg: boolean;
  onvif: boolean;
  cloud: boolean;
}

export interface ICctvHealth {
  latency: number;
  fps: number;
  resolution: string;
}

export interface ICctv {
  id: number;
  name: string;
  location: string;
  description: string;
  vendor: string;
  model: string;
  protocol: string;
  mediaType: string;
  streamUrl: string;
  playUrl: string;
  username?: string;
  password?: string; // Encrypted in database
  capabilities: ICctvCapabilities;
  status: 'NEW' | 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'BUFFERING' | 'ERROR' | 'DISCONNECTED' | 'MONITORING' | 'PAUSED' | 'MAINTENANCE';
  health: ICctvHealth;
  isDefault: boolean; // Protects camera ID 1-8 from deletion
  isActive: boolean;
  monitoringEnabled: boolean; // AI Monitoring active control
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  priorityWeight: number;
  lastFrameAt?: Date;
  reconnectCount?: number;
  packetLoss?: number;
  lastHeartbeat?: Date;
  lastConnected?: Date;
  workspaceId?: number;
}

const CctvCapabilitiesSchema = new Schema<ICctvCapabilities>({
  rtsp: { type: Boolean, default: false },
  hls: { type: Boolean, default: false },
  snapshot: { type: Boolean, default: false },
  mjpeg: { type: Boolean, default: false },
  onvif: { type: Boolean, default: false },
  cloud: { type: Boolean, default: false }
}, { _id: false });

const CctvHealthSchema = new Schema<ICctvHealth>({
  latency: { type: Number, default: 0 },
  fps: { type: Number, default: 0 },
  resolution: { type: String, default: '1280x720' }
}, { _id: false });

const CctvSchema = new Schema<ICctv>({
  id: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String, default: '' },
  vendor: { type: String, default: 'GENERIC' },
  model: { type: String, default: '' },
  protocol: { type: String, required: true },
  mediaType: { type: String, required: true },
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
  status: { 
    type: String, 
    required: true, 
    enum: ['NEW', 'CONNECTING', 'ONLINE', 'OFFLINE', 'BUFFERING', 'ERROR', 'DISCONNECTED', 'MONITORING', 'PAUSED', 'MAINTENANCE'], 
    default: 'NEW' 
  },
  health: {
    latency: { type: Number, default: 0 },
    fps: { type: Number, default: 0 },
    resolution: { type: String, default: '1280x720' }
  },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  monitoringEnabled: { type: Boolean, default: true },
  priority: { type: String, enum: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'], default: 'NORMAL' },
  priorityWeight: { type: Number, default: 50 },
  lastFrameAt: { type: Date },
  reconnectCount: { type: Number, default: 0 },
  packetLoss: { type: Number, default: 0 },
  lastHeartbeat: { type: Date },
  lastConnected: { type: Date },
  workspaceId: { type: Number, index: true }
}, { timestamps: true });

export const CctvModel: Model<ICctv> = mongoose.models.Cctv || mongoose.model<ICctv>('Cctv', CctvSchema);