import mongoose, { Schema, Document } from 'mongoose';

export interface IAssignment extends Document {
  reportId: mongoose.Types.ObjectId;
  officerId: mongoose.Types.ObjectId;
  officerName: string;
  agency: string;
  assignedById: mongoose.Types.ObjectId;
  assignedByName: string;
  assignedAt: Date;
  endedAt: Date | null;
  status: 'ASSIGNED' | 'ON_SITE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REASSIGNED';
}

const AssignmentSchema = new Schema<IAssignment>({
  reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
  officerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  officerName: { type: String, required: true },
  agency: { type: String, required: true },
  assignedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assignedByName: { type: String, required: true },
  assignedAt: { type: Date, default: Date.now, required: true },
  endedAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['ASSIGNED', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REASSIGNED'],
    required: true
  }
}, {
  timestamps: true
});

// Index to find active assignment and officer assignments quickly
AssignmentSchema.index({ reportId: 1, endedAt: 1 });
AssignmentSchema.index({ officerId: 1, status: 1 });

export const AssignmentModel = mongoose.model<IAssignment>('Assignment', AssignmentSchema);
