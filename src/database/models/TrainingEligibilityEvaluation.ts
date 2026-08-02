import mongoose, { Schema, Document } from 'mongoose';

export interface IGateResult {
  gate: string;
  passed: boolean;
  observedValue?: number | string | boolean;
  requiredValue?: number | string | boolean;
  reasons: string[];
}

export interface ITrainingEligibilityEvaluation extends Document {
  datasetVersion: string;
  policyVersion: string;
  policyHash: string;
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  structurallyValid: boolean;
  eligible: boolean;
  gateResults: IGateResult[];
  evaluatedAt: Date;
  evaluatedBy: 'SYSTEM' | mongoose.Types.ObjectId;
  evaluationHash: string;
  createdAt: Date;
}

const GateResultSchema = new Schema<IGateResult>(
  {
    gate: { type: String, required: true },
    passed: { type: Boolean, required: true },
    observedValue: { type: Schema.Types.Mixed, default: null },
    requiredValue: { type: Schema.Types.Mixed, default: null },
    reasons: { type: [String], default: [] }
  },
  { _id: false }
);

const TrainingEligibilityEvaluationSchema = new Schema<ITrainingEligibilityEvaluation>(
  {
    datasetVersion: { type: String, required: true, index: true },
    policyVersion: { type: String, default: 'v1.0.0-strict-policy', required: true },
    policyHash: { type: String, required: true },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'PRODUCTION', index: true },
    structurallyValid: { type: Boolean, required: true },
    eligible: { type: Boolean, required: true, index: true },
    gateResults: { type: [GateResultSchema], default: [] },
    evaluatedAt: { type: Date, default: Date.now },
    evaluatedBy: { type: Schema.Types.Mixed, default: 'SYSTEM' },
    evaluationHash: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const TrainingEligibilityEvaluationModel = mongoose.model<ITrainingEligibilityEvaluation>(
  'TrainingEligibilityEvaluation',
  TrainingEligibilityEvaluationSchema
);
