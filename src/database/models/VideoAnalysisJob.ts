import mongoose, { Schema, Document, Types } from 'mongoose';

export type VideoAnalysisJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRY_WAIT'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export type VideoAnalysisJobProgressStage =
  | 'VALIDATING'
  | 'DECODING'
  | 'ANALYZING'
  | 'GROUPING'
  | 'GENERATING_EVIDENCE'
  | 'PERSISTING_RESULTS'
  | 'FINISHED';

export interface IVideoAnalysisJob extends Document {
  sourceVideoId: Types.ObjectId;
  sourceVideoHash: string;
  sourceStorageKey: string;

  status: VideoAnalysisJobStatus;
  progressStage: VideoAnalysisJobProgressStage;

  totalFrames?: number;
  decodedFrames: number;
  analyzedFrames: number;
  processedIncidents: number;
  incidentCount: number;
  progressPercent: number;

  analysisRunId: string;
  schemaVersion: string;
  modelRegistry: Record<string, any>;
  configurationHash: string;

  attemptCount: number;
  maxAttempts: number;
  workerId?: string;
  claimToken?: string;
  heartbeatAt?: Date;
  leaseExpiresAt?: Date;
  nextAttemptAt?: Date;

  resultManifestPath?: string;
  resultManifestHash?: string;

  errorCode?: string;
  errorDetails?: string;
  warnings: string[];

  startedAt?: Date;
  completedAt?: Date;
  correlationId: string;
  createdAt: Date;
  updatedAt: Date;
}

const VideoAnalysisJobSchema = new Schema<IVideoAnalysisJob>(
  {
    sourceVideoId: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    sourceVideoHash: { type: String, required: true },
    sourceStorageKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'],
      required: true,
      default: 'QUEUED',
      index: true
    },
    progressStage: {
      type: String,
      enum: ['VALIDATING', 'DECODING', 'ANALYZING', 'GROUPING', 'GENERATING_EVIDENCE', 'PERSISTING_RESULTS', 'FINISHED'],
      required: true,
      default: 'VALIDATING'
    },
    totalFrames: { type: Number, default: 0 },
    decodedFrames: { type: Number, required: true, default: 0 },
    analyzedFrames: { type: Number, required: true, default: 0 },
    processedIncidents: { type: Number, required: true, default: 0 },
    incidentCount: { type: Number, required: true, default: 0 },
    progressPercent: { type: Number, required: true, default: 0 },
    analysisRunId: { type: String, required: true, index: true },
    schemaVersion: { type: String, required: true, default: '3.0' },
    modelRegistry: { type: Schema.Types.Mixed, default: {} },
    configurationHash: { type: String, default: '' },
    attemptCount: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    workerId: { type: String, default: null },
    claimToken: { type: String, default: null },
    heartbeatAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, required: true, default: Date.now },
    resultManifestPath: { type: String, default: null },
    resultManifestHash: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorDetails: { type: String, default: null },
    warnings: { type: [String], default: [] },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    correlationId: { type: String, required: true }
  },
  { timestamps: true }
);

// Compound index for optimal querying & claiming (Rule index queue)
VideoAnalysisJobSchema.index({ status: 1, nextAttemptAt: 1, leaseExpiresAt: 1, createdAt: 1 });

export const VideoAnalysisJobModel = mongoose.model<IVideoAnalysisJob>('VideoAnalysisJob', VideoAnalysisJobSchema);
