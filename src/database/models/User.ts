import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  id: number; // Keep for compatibility with legacy database/UI
  username: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'user';
  desaId: mongoose.Types.ObjectId;
  twoFactorSecret?: string;
  is2faEnabled?: boolean;
}

const UserSchema = new Schema<IUser>({
  id: { type: Number, required: true, unique: true, index: true },
  username: { 
    type: String, 
    required: [true, 'Username wajib diisi'], 
    unique: true, 
    lowercase: true, // Case insensitive matching
    trim: true,
    minlength: [3, 'Username minimal 3 karakter'],
    maxlength: [30, 'Username maksimal 30 karakter']
  },
  passwordHash: { type: String, required: true, select: false }, // Exclude by default
  role: { type: String, enum: ['superadmin', 'admin', 'user'], required: true },
  desaId: { type: Schema.Types.ObjectId, ref: 'Desa', required: true, index: true },
  twoFactorSecret: { type: String, default: '', select: false },
  is2faEnabled: { type: Boolean, default: false }
}, {
  timestamps: true
});

export const UserModel = mongoose.model<IUser>('User', UserSchema);
