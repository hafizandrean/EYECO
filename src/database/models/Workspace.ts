import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IWorkspace extends Document {
  id: number;
  code: string;
  name: string;
  company: string;
  address: string;
  description: string;
  adminIds: number[];
  superadminId?: number;
}

const WorkspaceSchema = new Schema<IWorkspace>({
  id: { type: Number, required: true, unique: true, index: true },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    match: [/^[A-Z0-9-]+$/, 'Kode workspace hanya boleh berisi huruf, angka, dan tanda hubung']
  },
  name: { type: String, required: true, trim: true, unique: true },
  company: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  adminIds: [{ type: Number, index: true }],
  superadminId: { type: Number, index: true }
}, {
  timestamps: true
});

async function generateWorkspaceCode(): Promise<string> {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 25; attempt++) {
    let result = 'WS-';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const existing = await WorkspaceModel.findOne({ code: result }).select('_id').lean().exec();
    if (!existing) return result;
  }
  throw new Error('Gagal membuat kode workspace unik');
}

WorkspaceSchema.pre('validate', async function () {
  if (!this.code) {
    this.code = await generateWorkspaceCode();
  } else {
    this.code = this.code.trim().toUpperCase();
  }
});

export const WorkspaceModel: Model<IWorkspace> = mongoose.models.Workspace
  || mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
