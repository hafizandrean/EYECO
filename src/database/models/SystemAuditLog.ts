import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemAuditLog extends Document {
  tenantId: string;
  actorId: mongoose.Types.ObjectId | null;
  actorName: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, any>;
  createdAt: Date;
}

const SystemAuditLogSchema = new Schema<ISystemAuditLog>({
  tenantId: { type: String, required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, required: true },
  action: { type: String, required: true },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  details: { type: Schema.Types.Mixed, default: {} }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const SystemAuditLogModel = mongoose.model<ISystemAuditLog>('SystemAuditLog', SystemAuditLogSchema);
