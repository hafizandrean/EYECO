import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  recipientId: mongoose.Types.ObjectId;
  reportId: mongoose.Types.ObjectId;
  type: string;
  title: string;
  message: string;
  actionUrl: string;
  icon: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  read: boolean;
  readAt: Date | null;
  expiresAt: Date;
  deletedAt: Date | null;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  actionUrl: { type: String, default: '' },
  icon: { type: String, default: '' },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW', required: true },
  read: { type: Boolean, default: false, required: true },
  readAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  deletedAt: { type: Date, default: null }
}, {
  timestamps: true
});

// Compound index for sorted notifications query
NotificationSchema.index({ recipientId: 1, read: 1, createdAt: -1 });

// TTL index to automatically delete expired notifications (expiresAt contains the exact deletion Date)
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const NotificationModel = mongoose.model<INotification>('Notification', NotificationSchema);
