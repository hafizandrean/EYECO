import mongoose, { Schema, Document } from 'mongoose';

export interface IModelDeploymentLog extends Document {
  modelIdFrom: string;
  modelIdTo: string;
  deployedBy: string;
  deploymentType: 'HOT_SWAP' | 'ROLLBACK' | 'CANARY';
  validationResult: 'SUCCESS' | 'FAILED';
  rollbackReason?: string;
  rollbackTriggeredBy?: string;
  pythonVersion?: string;
  cudaVersion?: string;
  ultralyticsVersion?: string;
  
  // Latency breakdown metrics
  downloadLatencyMs: number;
  checksumLatencyMs: number;
  loadLatencyMs: number;
  warmupLatencyMs: number;
  smokeValidationLatencyMs: number;
  totalDeploymentLatencyMs: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const ModelDeploymentLogSchema = new Schema<IModelDeploymentLog>({
  modelIdFrom: { type: String, required: true, index: true },
  modelIdTo: { type: String, required: true, index: true },
  deployedBy: { type: String, required: true },
  deploymentType: { type: String, required: true, enum: ['HOT_SWAP', 'ROLLBACK', 'CANARY'] },
  validationResult: { type: String, required: true, enum: ['SUCCESS', 'FAILED'] },
  rollbackReason: { type: String, default: '' },
  rollbackTriggeredBy: { type: String, default: '' },
  pythonVersion: { type: String, default: '' },
  cudaVersion: { type: String, default: '' },
  ultralyticsVersion: { type: String, default: '' },
  
  downloadLatencyMs: { type: Number, required: true, default: 0 },
  checksumLatencyMs: { type: Number, required: true, default: 0 },
  loadLatencyMs: { type: Number, required: true, default: 0 },
  warmupLatencyMs: { type: Number, required: true, default: 0 },
  smokeValidationLatencyMs: { type: Number, required: true, default: 0 },
  totalDeploymentLatencyMs: { type: Number, required: true, default: 0 }
}, {
  timestamps: true
});

export const ModelDeploymentLogModel = mongoose.model<IModelDeploymentLog>('ModelDeploymentLog', ModelDeploymentLogSchema);
