import mongoose, { Schema, Document } from 'mongoose';

export interface IOutboxEvent extends Document {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey?: string;
  payload: Record<string, any>;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  retryCount: number;
  createdAt: Date;
  processedAt: Date | null;
}

const OutboxEventSchema = new Schema<IOutboxEvent>({
  aggregateType: { type: String, required: true },
  aggregateId: { type: String, required: true },
  eventType: { type: String, required: true },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'PROCESSED', 'FAILED'], default: 'PENDING', required: true, index: true },
  retryCount: { type: Number, default: 0, required: true },
  processedAt: { type: Date, default: null }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

export const OutboxEventModel = mongoose.model<IOutboxEvent>('OutboxEvent', OutboxEventSchema);
