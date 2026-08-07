import mongoose, { Schema, Document } from 'mongoose';

export type StatisticalJobStatus = 'QUEUED' | 'CLAIMED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface IStatisticalEvaluationJob extends Document {
  jobId: string;
  candidateModelId: string;
  baselineModelId: string;
  goldenDatasetVersion: string;
  statisticalPolicyId: string;
  status: StatisticalJobStatus;
  workerId?: string;
  claimToken?: string;
  leaseExpiresAt?: Date;
  attemptCount: number;
  maxAttempts: number;
  resultEvaluationId?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const StatisticalEvaluationJobSchema = new Schema<IStatisticalEvaluationJob>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    candidateModelId: { type: String, required: true, index: true },
    baselineModelId: { type: String, required: true, index: true },
    goldenDatasetVersion: { type: String, required: true },
    statisticalPolicyId: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['QUEUED', 'CLAIMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'QUEUED',
      index: true
    },
    workerId: { type: String, default: null },
    claimToken: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    resultEvaluationId: { type: String, default: null },
    errorMessage: { type: String, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const StatisticalEvaluationJobModel = mongoose.model<IStatisticalEvaluationJob>(
  'StatisticalEvaluationJob',
  StatisticalEvaluationJobSchema
);
