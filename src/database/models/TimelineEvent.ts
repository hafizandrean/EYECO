import mongoose, { Schema, Document } from 'mongoose';

export interface ITimelineMetadata {
  confidence?: number;
  camera?: string;
  officerId?: mongoose.Types.ObjectId;
  assignmentId?: mongoose.Types.ObjectId;
  resolutionId?: mongoose.Types.ObjectId;
  attachmentId?: mongoose.Types.ObjectId;
  agency?: string;
  officerName?: string;
  notes?: string;
}

export interface ITimelineEvent extends Document {
  reportId: mongoose.Types.ObjectId;
  eventVersion: number;
  type: 'DETECTION' | 'REVIEW' | 'VALIDATED' | 'ASSIGNED' | 'ARRIVED' | 'RESOLVED' | 'CLOSED' | 'REJECTED' | 'APPROVAL_REQUESTED' | 'COMMENT_ADDED' | 'FILE_UPLOADED' | 'ASSIGNMENT_CHANGED' | 'RESOLUTION_REJECTED' | 'NOTIFICATION_SENT';
  actorId: mongoose.Types.ObjectId;
  actorName: string;
  actorRole: string;
  title: string;
  description: string;
  metadata: ITimelineMetadata;
  requestId: string;
  traceId: string;
  correlationId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
}

const TimelineEventSchema = new Schema<ITimelineEvent>({
  reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
  eventVersion: { type: Number, default: 1, required: true },
  type: {
    type: String,
    enum: [
      'DETECTION', 'REVIEW', 'VALIDATED', 'ASSIGNED', 'ARRIVED', 'RESOLVED', 'CLOSED', 'REJECTED',
      'APPROVAL_REQUESTED', 'COMMENT_ADDED', 'FILE_UPLOADED', 'ASSIGNMENT_CHANGED',
      'RESOLUTION_REJECTED', 'NOTIFICATION_SENT'
    ],
    required: true
  },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true },
  actorRole: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  requestId: { type: String, default: '' },
  traceId: { type: String, default: '' },
  correlationId: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, {
  timestamps: { createdAt: true, updatedAt: false } // Immutable
});

// Compound index for sorted timeline query
TimelineEventSchema.index({ reportId: 1, createdAt: -1 });

export const TimelineEventModel = mongoose.model<ITimelineEvent>('TimelineEvent', TimelineEventSchema);
