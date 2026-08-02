import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRootModelImportRecord extends Document {
  importRecordId: string;
  modelType: string;
  environment: 'STAGING' | 'PRODUCTION';
  artifactPath: string;
  artifactHash: string;
  artifactValidationReportId: Types.ObjectId;
  sourceType: 'LOCAL_APPROVED_IMPORT' | 'VENDOR_BASE_MODEL';
  sourceReference?: string;
  sourceArtifactHash: string;
  classMappingHash: string;
  frameworkVersion: string;
  modelTask: string;
  importedByUserId: Types.ObjectId;
  approvedByUserId: Types.ObjectId;
  approvalReason: string;
  approvalPolicyVersion: string;
  importScriptHash: string;
  runtimeEnvironmentHash: string;
  resultHash: string;
  createdAt: Date;
}

const RootModelImportRecordSchema = new Schema<IRootModelImportRecord>({
  importRecordId: { type: String, required: true, unique: true, index: true },
  modelType: { type: String, required: true },
  environment: { type: String, enum: ['STAGING', 'PRODUCTION'], required: true },
  artifactPath: { type: String, required: true },
  artifactHash: { type: String, required: true },
  artifactValidationReportId: { type: Schema.Types.ObjectId, ref: 'ModelArtifactValidationReport', required: true },
  sourceType: { type: String, enum: ['LOCAL_APPROVED_IMPORT', 'VENDOR_BASE_MODEL'], required: true },
  sourceReference: { type: String },
  sourceArtifactHash: { type: String, required: true },
  classMappingHash: { type: String, required: true },
  frameworkVersion: { type: String, required: true, default: 'ultralytics-v8.0.0' },
  modelTask: { type: String, required: true, default: 'detect' },
  importedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  approvalReason: { type: String, required: true },
  approvalPolicyVersion: { type: String, required: true, default: 'v1.0.0' },
  importScriptHash: { type: String, required: true },
  runtimeEnvironmentHash: { type: String, required: true },
  resultHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

function blockMutation(errorMsg: string, next?: (err?: Error) => void) {
  const err: any = new Error(errorMsg);
  err.status = 422;
  if (typeof next === 'function') {
    return next(err);
  }
  throw err;
}

RootModelImportRecordSchema.pre('save', function (this: any, next: any) {
  if (!this.isNew) {
    return blockMutation(
      'ROOT_IMPORT_RECORD_IMMUTABLE: RootModelImportRecord documents are strictly append-only. Modification and deletion are REJECTED.',
      next
    );
  }
  if (typeof next === 'function') next();
});

const queryBlocker = function (this: any, next: any) {
  blockMutation(
    'ROOT_IMPORT_RECORD_IMMUTABLE: RootModelImportRecord documents are strictly append-only. Modification and deletion are REJECTED.',
    next
  );
};

RootModelImportRecordSchema.pre('updateOne', queryBlocker);
RootModelImportRecordSchema.pre('updateMany', queryBlocker);
RootModelImportRecordSchema.pre('findOneAndUpdate', queryBlocker);
RootModelImportRecordSchema.pre('replaceOne', queryBlocker);
RootModelImportRecordSchema.pre('deleteOne', queryBlocker);
RootModelImportRecordSchema.pre('deleteMany', queryBlocker);
RootModelImportRecordSchema.pre('findOneAndDelete', queryBlocker);

export const RootModelImportRecordModel = mongoose.model<IRootModelImportRecord>(
  'RootModelImportRecord',
  RootModelImportRecordSchema
);
