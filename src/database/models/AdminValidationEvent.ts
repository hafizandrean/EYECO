import mongoose, { Schema, Document } from 'mongoose';

export type AdminValidationStatus = 'PENDING' | 'VALID' | 'INVALID';

export type InvalidValidationReason =
  | 'FALSE_POSITIVE'
  | 'WRONG_OBJECT'
  | 'WRONG_ACTIVITY'
  | 'WRONG_CONTEXT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'OTHER';

export type MlFeedbackRole =
  | 'CONFIRMED_POSITIVE'
  | 'NEGATIVE_EXAMPLE'
  | 'OBJECT_CORRECTION'
  | 'ACTIVITY_CORRECTION'
  | 'CONTEXT_CORRECTION'
  | 'EXCLUDED_FROM_TRAINING'
  | 'HUMAN_REVIEW_REQUIRED';

export interface IAdminValidationEvent extends Document {
  eventId: string;
  reportId: number;
  snapshotId?: mongoose.Types.ObjectId | null;
  previousValidationStatus: string;
  validationStatus: 'VALID' | 'INVALID';
  invalidReason?: InvalidValidationReason | null;
  correctionPayload?: Record<string, any> | null;
  validatedByUserId: mongoose.Types.ObjectId;
  validatedAt: Date;
  idempotencyKey: string;
  payloadHash: string;
  mlFeedbackRole: MlFeedbackRole;
  createdAt: Date;
}

const AdminValidationEventSchema = new Schema<IAdminValidationEvent>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, required: true, index: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'AiSnapshot', default: null, index: true },
    previousValidationStatus: { type: String, required: true },
    validationStatus: { type: String, enum: ['VALID', 'INVALID'], required: true, index: true },
    invalidReason: {
      type: String,
      enum: ['FALSE_POSITIVE', 'WRONG_OBJECT', 'WRONG_ACTIVITY', 'WRONG_CONTEXT', 'INSUFFICIENT_EVIDENCE', 'OTHER', null],
      default: null,
      index: true
    },
    correctionPayload: { type: Schema.Types.Mixed, default: null },
    validatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    validatedAt: { type: Date, default: Date.now },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    payloadHash: { type: String, required: true },
    mlFeedbackRole: {
      type: String,
      enum: [
        'CONFIRMED_POSITIVE',
        'NEGATIVE_EXAMPLE',
        'OBJECT_CORRECTION',
        'ACTIVITY_CORRECTION',
        'CONTEXT_CORRECTION',
        'EXCLUDED_FROM_TRAINING',
        'HUMAN_REVIEW_REQUIRED'
      ],
      required: true,
      index: true
    },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err: any = new Error(errorMsg);
  err.status = 422;
  if (typeof next === 'function') return next(err);
  throw err;
}

AdminValidationEventSchema.pre('save', function (this: any, next: any) {
  if (!this.isNew) {
    return blockMutation(
      'ADMIN_VALIDATION_EVENT_IMMUTABLE: AdminValidationEvent documents are strictly append-only. Modification and deletion are REJECTED.',
      next
    );
  }
  if (typeof next === 'function') next();
});

const queryBlocker = function (this: any, next: any) {
  blockMutation(
    'ADMIN_VALIDATION_EVENT_IMMUTABLE: AdminValidationEvent documents are strictly append-only. Modification and deletion are REJECTED.',
    next
  );
};

AdminValidationEventSchema.pre('updateOne', queryBlocker);
AdminValidationEventSchema.pre('updateMany', queryBlocker);
AdminValidationEventSchema.pre('findOneAndUpdate', queryBlocker);
AdminValidationEventSchema.pre('replaceOne', queryBlocker);
AdminValidationEventSchema.pre('deleteOne', queryBlocker);
AdminValidationEventSchema.pre('deleteMany', queryBlocker);
AdminValidationEventSchema.pre('findOneAndDelete', queryBlocker);
AdminValidationEventSchema.pre('bulkWrite', queryBlocker);

export const AdminValidationEventModel = mongoose.model<IAdminValidationEvent>(
  'AdminValidationEvent',
  AdminValidationEventSchema
);
