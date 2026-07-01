import mongoose, { Schema, Document } from 'mongoose';

export interface IOutboxEvent extends Document {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, any>;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  createdAt: Date;
  processedAt: Date | null;
}

const OutboxEventSchema = new Schema<IOutboxEvent>({
  aggregateType: { type: String, required: true },
  aggregateId: { type: String, required: true },
  eventType: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'PROCESSED', 'FAILED'], default: 'PENDING', required: true, index: true },
  processedAt: { type: Date, default: null }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const OutboxEventModel = mongoose.model<IOutboxEvent>('OutboxEvent', OutboxEventSchema);
