import mongoose, { Schema, Document } from 'mongoose';
import { OperatorGroundTruthLabel, OperationalPriority } from '../../services/ai/types/ai.types';

export interface ICorrectedObject {
  detectionId?: string;
  action: 'CONFIRM' | 'REMOVE' | 'RELABEL' | 'ADD';
  originalClass?: string;
  correctedClass?: string;
  originalBbox?: [number, number, number, number];
  correctedBbox?: [number, number, number, number];
}

export interface IAiValidationLog extends Document {
  idempotencyKey: string;
  reportId: number;
  reportObjectId?: mongoose.Types.ObjectId;
  snapshotId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  operatorUsername: string;
  operatorDecision: OperatorGroundTruthLabel;
  isLitteringConfirmed: boolean | null;
  correctedPriority: OperationalPriority;
  correctedObjects: ICorrectedObject[];
  notes: string;
  validationVersion: number;
  previousValidationLogId?: mongoose.Types.ObjectId | null;
  isCurrent: boolean;
  yoloVersion: string;
  sceneVersion: string;
  decisionVersion: string;
  snapshotVersion: number;
  predictedStatus: string;
  predictedScore: number | null;
  inputImageHash: string;
  requestPayloadHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const CorrectedObjectSchema = new Schema<ICorrectedObject>(
  {
    detectionId: { type: String, default: '' },
    action: { type: String, enum: ['CONFIRM', 'REMOVE', 'RELABEL', 'ADD'], required: true },
    originalClass: { type: String, default: '' },
    correctedClass: { type: String, default: '' },
    originalBbox: { type: [Number], default: [] },
    correctedBbox: { type: [Number], default: [] },
  },
  { _id: false }
);

const AiValidationLogSchema = new Schema<IAiValidationLog>(
  {
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, required: true, index: true },
    reportObjectId: { type: Schema.Types.ObjectId, ref: 'Report', default: null },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', required: true, index: true },
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
        'UNCERTAIN',
        'NEEDS_REVIEW',
        'OTHER'
      ],
      index: true
    },
    isLitteringConfirmed: { type: Boolean, default: null },
    correctedPriority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    correctedObjects: { type: [CorrectedObjectSchema], default: [] },
    notes: { type: String, default: '' },
    validationVersion: { type: Number, default: 1, required: true },
    previousValidationLogId: { type: Schema.Types.ObjectId, ref: 'AiValidationLog', default: null },
    isCurrent: { type: Boolean, default: true, index: true },
    yoloVersion: { type: String, default: 'v8.2.0-yolov8n' },
    sceneVersion: { type: String, default: 'v1.0.0' },
    decisionVersion: { type: String, default: 'v3.0.0' },
    snapshotVersion: { type: Number, default: 1 },
    predictedStatus: { type: String, default: '' },
    predictedScore: { type: Number, default: null },
    inputImageHash: { type: String, default: '' },
    requestPayloadHash: { type: String, default: '' },
  },
  { timestamps: true }
);

// Partial unique index: Guarantees exactly ONE current revision per snapshot and user
AiValidationLogSchema.index(
  { snapshotId: 1, userId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } }
);

export const AiValidationLogModel = mongoose.model<IAiValidationLog>('AiValidationLog', AiValidationLogSchema);
