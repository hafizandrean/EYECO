import mongoose, { Schema, Document } from 'mongoose';
import { OperatorGroundTruthLabel, OperationalPriority } from '../../services/ai/types/ai.types';

export interface IAiValidationLog extends Document {
  reportId: number;
  snapshotId?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  operatorUsername: string;
  operatorDecision: OperatorGroundTruthLabel;
  isLitteringConfirmed: boolean | null;
  correctedPriority: OperationalPriority;
  notes: string;
  yoloVersion: string;
  sceneVersion: string;
  decisionVersion: string;
  predictedStatus: string;
  predictedScore: number;
  inputImageHash: string;
  createdAt: Date;
}

const AiValidationLogSchema = new Schema<IAiValidationLog>(
  {
    reportId: { type: Number, required: true, index: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    operatorUsername: { type: String, required: true },
    operatorDecision: {
      type: String,
      required: true,
      enum: [
        'CONFIRMED_LITTERING',
        'PROBABLE_LITTERING',
        'CARRYING_OBJECT',
        'DISPOSING_IN_BIN',
        'PICKING_UP_TRASH',
        'CLEANING_ACTIVITY',
        'PERSON_ONLY',
        'TRASH_ONLY',
        'NOT_ENOUGH_EVIDENCE',
        'FALSE_OBJECT_DETECTION',
        'IMAGE_QUALITY_TOO_LOW',
        'OTHER'
      ],
      index: true
    },
    isLitteringConfirmed: { type: Boolean, default: null },
    correctedPriority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    notes: { type: String, default: '' },
    yoloVersion: { type: String, default: '' },
    sceneVersion: { type: String, default: '' },
    decisionVersion: { type: String, default: '' },
    predictedStatus: { type: String, default: '' },
    predictedScore: { type: Number, default: 0 },
    inputImageHash: { type: String, default: '' },
  },
  { timestamps: true }
);

export const AiValidationLogModel = mongoose.model<IAiValidationLog>('AiValidationLog', AiValidationLogSchema);
