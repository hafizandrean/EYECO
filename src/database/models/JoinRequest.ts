import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IJoinRequest extends Document {
  userId: number;
  workspaceId: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const JoinRequestSchema = new Schema<IJoinRequest>({
  userId: { type: Number, required: true, index: true },
  workspaceId: { type: Number, required: true, index: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' }
}, {
  timestamps: true
});

// Ensure a user can only have one pending request per workspace
JoinRequestSchema.index({ userId: 1, workspaceId: 1, status: 1 });

export const JoinRequestModel: Model<IJoinRequest> = mongoose.models.JoinRequest
  || mongoose.model<IJoinRequest>('JoinRequest', JoinRequestSchema);
