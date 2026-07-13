import mongoose, { Schema, Document } from 'mongoose';

export interface IAiConfigurationHistory extends Document {
  key: string;
  oldValue: any;
  newValue: any;
  changedBy: mongoose.Types.ObjectId;
  changedByName: string;
  reason?: string;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiConfigurationHistorySchema = new Schema<IAiConfigurationHistory>({
  key: { type: String, required: true, index: true },
  oldValue: { type: Schema.Types.Mixed, required: true },
  newValue: { type: Schema.Types.Mixed, required: true },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  changedByName: { type: String, required: true },
  reason: { type: String, default: '' },
  timestamp: { type: Date, required: true, default: Date.now }
}, {
  timestamps: true
});

export const AiConfigurationHistoryModel = mongoose.model<IAiConfigurationHistory>('AiConfigurationHistory', AiConfigurationHistorySchema);
