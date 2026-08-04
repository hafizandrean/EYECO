import mongoose, { Schema, Document } from 'mongoose';
import { TargetModelType } from './AiDatasetCandidate';
import { IDatasetManifestItem } from './AiDatasetVersion';

export type GoldenDatasetStatus = 'BUILDING' | 'INSUFFICIENT_DATA' | 'READY_FOR_REVIEW' | 'APPROVED' | 'INVALID' | 'ARCHIVED';

export interface IAiGoldenDatasetVersion extends Document {
  goldenDatasetVersion: string;
  targetModel: TargetModelType;
  status: GoldenDatasetStatus;
  structurallyValid: boolean;
  compositionEligible: boolean;
  approvalEligible: boolean;
  manifestHash: string;
  assetValidationReportId?: mongoose.Types.ObjectId;
  compositionEvaluationId?: mongoose.Types.ObjectId;
  itemCount: number;
  positiveCount: number;
  negativeCount: number;
  classDistribution: Record<string, number>;
  cameraDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
  environmentDistribution: Record<string, number>;
  manifestItems: IDatasetManifestItem[];
  approvedByUserId?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiGoldenDatasetVersionSchema = new Schema<IAiGoldenDatasetVersion>(
  {
    goldenDatasetVersion: { type: String, required: true, unique: true, index: true },
    targetModel: {
      type: String,
      required: true,
      enum: ['OBJECT_DETECTOR', 'POSE_MODEL', 'SEMANTIC_MODEL', 'POLICY_CALIBRATION'],
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: ['BUILDING', 'INSUFFICIENT_DATA', 'READY_FOR_REVIEW', 'APPROVED', 'INVALID', 'ARCHIVED'],
      default: 'BUILDING',
      index: true
    },
    structurallyValid: { type: Boolean, default: true, index: true },
    compositionEligible: { type: Boolean, default: false, index: true },
    approvalEligible: { type: Boolean, default: false, index: true },
    manifestHash: { type: String, required: true },
    assetValidationReportId: { type: Schema.Types.ObjectId, ref: 'DatasetAssetValidationReport', default: null },
    compositionEvaluationId: { type: Schema.Types.ObjectId, ref: 'GoldenDatasetCompositionEvaluation', default: null },
    itemCount: { type: Number, required: true, default: 0 },
    positiveCount: { type: Number, required: true, default: 0 },
    negativeCount: { type: Number, required: true, default: 0 },
    classDistribution: { type: Schema.Types.Mixed, default: {} },
    cameraDistribution: { type: Schema.Types.Mixed, default: {} },
    locationDistribution: { type: Schema.Types.Mixed, default: {} },
    environmentDistribution: { type: Schema.Types.Mixed, default: {} },
    manifestItems: { type: [Schema.Types.Mixed] as any, default: [] },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Immutability Guard Pre-Save Middleware for Golden Dataset
AiGoldenDatasetVersionSchema.pre('save', function (this: any) {
  if (!this.isNew && ['APPROVED', 'ARCHIVED'].includes(this.status)) {
    if (this.isModified('manifestItems') || this.isModified('manifestHash') || this.isModified('itemCount')) {
      throw new Error('GOLDEN_DATASET_VERSION_IMMUTABLE: Cannot modify manifest items or hash on approved golden dataset version');
    }
  }
});

export const AiGoldenDatasetVersionModel = mongoose.model<IAiGoldenDatasetVersion>(
  'AiGoldenDatasetVersion',
  AiGoldenDatasetVersionSchema
);
