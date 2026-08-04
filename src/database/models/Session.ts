import mongoose, { Schema, Document } from 'mongoose';

export interface ISession extends Document {
  userId: number;
  tokenHash: string;
  deviceInfo: string;
  deviceId: string;
  ipAddress: string;
  lastActive: Date;
  createdAt: Date;
}

const SessionSchema = new Schema<ISession>({
  userId: { type: Number, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  deviceInfo: { type: String, default: 'Unknown Device' },
  deviceId: { type: String, index: true },
  ipAddress: { type: String, default: 'Unknown IP' },
  lastActive: { type: Date, default: Date.now }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const SessionModel = mongoose.model<ISession>('Session', SessionSchema);
