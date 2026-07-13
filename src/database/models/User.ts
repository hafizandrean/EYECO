import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  id: number;
  username: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'user' | 'operator' | 'supervisor' | 'officer';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED';
  name: string;
  email: string;
  agency: string;
  workspaceId?: number;
  isDeleted?: boolean;
  closedAt?: Date;
  closedReason?: string;
  closureFeedback?: string;
  closedBy?: number;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  passwordHistory?: Array<{ hash: string; changedAt: Date }>;
  preferencesVersion?: number;
  preferences?: { theme: string; language: string; timezone: string };
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
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'user', 'operator', 'supervisor', 'officer'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CLOSED'],
    default: 'PENDING',
    required: true
  },
  name: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  agency: { type: String, trim: true, default: '' },
  workspaceId: { type: Number, index: true },
  isDeleted: { type: Boolean, default: false },
  closedAt: { type: Date, default: null },
  closedReason: { type: String, default: null },
  closureFeedback: { type: String, default: null },
  closedBy: { type: Number, default: null },
  lastLoginAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  passwordHistory: {
    type: [{ hash: String, changedAt: Date }],
    default: []
  },
  preferencesVersion: { type: Number, default: 1 },
  preferences: {
    type: { theme: String, language: String, timezone: String },
    default: { theme: 'dark', language: 'id', timezone: 'Asia/Jakarta' }
  }
}, {
  timestamps: true
});

export const UserModel = mongoose.model<IUser>('User', UserSchema);
