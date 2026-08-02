import mongoose, { Schema, Document } from 'mongoose';

export interface IModelArtifactValidationReport extends Document {
  validationReportId: string;
  modelType: string;
  environment: 'STAGING' | 'PRODUCTION';
  artifactPath: string;
  requestedArtifactHash: string;
  loadedArtifactHash: string;
  artifactSize: number;
  framework: 'ULTRALYTICS';
  frameworkVersion: string;
  torchVersion: string;
  pythonVersion: string;
  loadPassed: boolean;
  warmupPassed: boolean;
  task: string;
  classNames: string[];
  classMappingHash: string;
  parameterCount: number;
  stateDictKeysHash: string;
  outputSchemaPassed: boolean;
  validatorScriptHash: string;
  validatorRuntimeHash: string;
  processPid: number;
  exitCode: number;
  stdoutHash: string;
  stderrHash: string;
  resultHash: string;
  createdAt: Date;
}

const ModelArtifactValidationReportSchema = new Schema<IModelArtifactValidationReport>({
  validationReportId: { type: String, required: true, unique: true, index: true },
  modelType: { type: String, required: true },
  environment: { type: String, enum: ['STAGING', 'PRODUCTION'], required: true },
  artifactPath: { type: String, required: true, index: true },
  requestedArtifactHash: { type: String, required: true },
  loadedArtifactHash: { type: String, required: true, index: true },
  artifactSize: { type: Number, required: true },
  framework: { type: String, enum: ['ULTRALYTICS'], required: true, default: 'ULTRALYTICS' },
  frameworkVersion: { type: String, required: true, default: '8.0.0' },
  torchVersion: { type: String, required: true, default: '2.0.0' },
  pythonVersion: { type: String, required: true, default: '3.10.0' },
  loadPassed: { type: Boolean, required: true },
  warmupPassed: { type: Boolean, required: true },
  task: { type: String, required: true, default: 'detect' },
  classNames: { type: [String], required: true },
  classMappingHash: { type: String, required: true },
  parameterCount: { type: Number, required: true },
  stateDictKeysHash: { type: String, required: true },
  outputSchemaPassed: { type: Boolean, required: true },
  validatorScriptHash: { type: String, required: true },
  validatorRuntimeHash: { type: String, required: true },
  processPid: { type: Number, required: true },
  exitCode: { type: Number, required: true },
  stdoutHash: { type: String, required: true },
  stderrHash: { type: String, required: true },
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

ModelArtifactValidationReportSchema.pre('save', function (this: any, next: any) {
  if (!this.isNew) {
    return blockMutation(
      'MODEL_ARTIFACT_VALIDATION_REPORT_IMMUTABLE: ModelArtifactValidationReport documents are strictly append-only. Modification and deletion are REJECTED.',
      next
    );
  }
  if (typeof next === 'function') next();
});

const queryBlocker = function (this: any, next: any) {
  blockMutation(
    'MODEL_ARTIFACT_VALIDATION_REPORT_IMMUTABLE: ModelArtifactValidationReport documents are strictly append-only. Modification and deletion are REJECTED.',
    next
  );
};

ModelArtifactValidationReportSchema.pre('updateOne', queryBlocker);
ModelArtifactValidationReportSchema.pre('updateMany', queryBlocker);
ModelArtifactValidationReportSchema.pre('findOneAndUpdate', queryBlocker);
ModelArtifactValidationReportSchema.pre('replaceOne', queryBlocker);
ModelArtifactValidationReportSchema.pre('deleteOne', queryBlocker);
ModelArtifactValidationReportSchema.pre('deleteMany', queryBlocker);
ModelArtifactValidationReportSchema.pre('findOneAndDelete', queryBlocker);

export const ModelArtifactValidationReportModel = mongoose.model<IModelArtifactValidationReport>(
  'ModelArtifactValidationReport',
  ModelArtifactValidationReportSchema
);
