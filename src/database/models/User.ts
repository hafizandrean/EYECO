import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  id: number;
  username: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'user' | 'operator' | 'supervisor' | 'officer';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  workspaceId?: number;
  workspaceIds: number[];
  resetToken?: string;
  resetTokenExpires?: Date;
}

const UserSchema = new Schema<IUser>({
  id: { type: Number, required: true, unique: true, index: true },
  username: {
    type: String,
    required: [true, 'Username wajib diisi'],
    unique: true,
    lowercase: true,
    trim: true,
    minlength: [3, 'Username minimal 3 karakter'],
    maxlength: [50, 'Username maksimal 50 karakter']
  },
  passwordHash: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'user', 'operator', 'supervisor', 'officer'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
    required: true
  },
  name: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  avatar: { type: String, default: '' },
  workspaceId: { type: Number, index: true, sparse: true },
  workspaceIds: { type: [Number], default: [] },
  resetToken: { type: String, default: null, index: true },
  resetTokenExpires: { type: Date, default: null }
}, {
  timestamps: true
});

export const UserModel = mongoose.models.User
  ? mongoose.model<IUser>('User')
  : mongoose.model<IUser>('User', UserSchema);
