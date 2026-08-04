import mongoose, { Schema, Document } from 'mongoose';

export type OutboxEventStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IContinualLearningOutbox extends Document {
  eventId: string;
  eventType: 'AI_FEEDBACK_RECORDED';
  validationLogId: mongoose.Types.ObjectId;
  snapshotId: mongoose.Types.ObjectId;
  reportId: number;
  status: OutboxEventStatus;
  attemptCount: number;
  maxAttempts: number;
  claimToken?: string | null;
  leaseExpiresAt?: Date | null;
  nextRetryAt?: Date | null;
  errorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ContinualLearningOutboxSchema = new Schema<IContinualLearningOutbox>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, enum: ['AI_FEEDBACK_RECORDED'], index: true },
    validationLogId: { type: Schema.Types.ObjectId, ref: 'AiValidationLog', required: true, index: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', required: true, index: true },
    reportId: { type: Number, required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true
    },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    claimToken: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    nextRetryAt: { type: Date, default: null },
    errorCode: { type: String, default: null }
  },
  { timestamps: true }
);

// Compound Index for Worker Polling
ContinualLearningOutboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });

export const ContinualLearningOutboxModel = mongoose.model<IContinualLearningOutbox>(
  'ContinualLearningOutbox',
  ContinualLearningOutboxSchema
);
