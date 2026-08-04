import mongoose, { Schema, Document } from 'mongoose';

export interface IDatasetAssetValidationReport extends Document {
  datasetVersion: string;
  checkedItemCount: number;
  validItemCount: number;
  invalidItemCount: number;
  missingAssetCount: number;
  hashMismatchCount: number;
  decodeFailureCount: number;
  invalidAnnotationCount: number;
  passed: boolean;
  failureReasons: string[];
  validatorVersion: string;
  reportHash: string;
  createdAt: Date;
}

const DatasetAssetValidationReportSchema = new Schema<IDatasetAssetValidationReport>(
  {
    datasetVersion: { type: String, required: true, index: true },
    checkedItemCount: { type: Number, required: true },
    validItemCount: { type: Number, required: true },
    invalidItemCount: { type: Number, required: true },
    missingAssetCount: { type: Number, default: 0 },
    hashMismatchCount: { type: Number, default: 0 },
    decodeFailureCount: { type: Number, default: 0 },
    invalidAnnotationCount: { type: Number, default: 0 },
    passed: { type: Boolean, required: true, index: true },
    failureReasons: { type: [String], default: [] },
    validatorVersion: { type: String, default: 'v1.0.0', required: true },
    reportHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const DatasetAssetValidationReportModel = mongoose.model<IDatasetAssetValidationReport>(
  'DatasetAssetValidationReport',
  DatasetAssetValidationReportSchema
);
