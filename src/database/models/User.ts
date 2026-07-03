import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  id: number; // Keep for compatibility with legacy database/UI
  username: string;
  passwordHash: string;
  role: 'admin' | 'user' | 'operator' | 'supervisor' | 'officer';
  name: string;
  email: string;
  agency: string;
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
    enum: ['admin', 'user', 'operator', 'supervisor', 'officer'], 
    required: true 
  },
  name: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  agency: { type: String, trim: true, default: '' }
}, {
  timestamps: true
});

export const UserModel = mongoose.model<IUser>('User', UserSchema);
