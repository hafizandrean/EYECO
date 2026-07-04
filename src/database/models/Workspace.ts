import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IWorkspace extends Document {
  id: number;
  name: string;
  company: string;
  location: string;
  address: string;
  description: string;
  adminId?: number;
}

const WorkspaceSchema = new Schema<IWorkspace>({
  id: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  company: { type: String, default: '', trim: true },
  location: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  adminId: { type: Number, index: true }
}, {
  timestamps: true
});

export const WorkspaceModel: Model<IWorkspace> = mongoose.models.Workspace
  || mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
