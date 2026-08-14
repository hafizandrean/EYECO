import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IJoinRequest extends Document {
  userId: number;
  workspaceId: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy?: number | null;
  decidedAt?: Date | null;
  rejectionReasonCode?: 'Tidak dikenal' | 'Luar wilayah' | 'Data tidak sesuai' | 'Duplikat' | 'Lainnya' | string | null;
  rejectionNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const JoinRequestSchema = new Schema<IJoinRequest>({
  userId: { type: Number, required: true, index: true },
  workspaceId: { type: Number, required: true, index: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
  decidedBy: { type: Number, default: null },
  decidedAt: { type: Date, default: null },
  rejectionReasonCode: { type: String, default: null },
  rejectionNote: { type: String, default: null }
}, {
  timestamps: true
});

// Ensure a user can only have one pending request per workspace
JoinRequestSchema.index({ userId: 1, workspaceId: 1, status: 1 });

export const JoinRequestModel: Model<IJoinRequest> = mongoose.models.JoinRequest
  || mongoose.model<IJoinRequest>('JoinRequest', JoinRequestSchema);
