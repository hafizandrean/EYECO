import mongoose, { Schema, Document } from 'mongoose';

export interface IDesa extends Document {
  nama: string;
  createdAt: Date;
  updatedAt: Date;
}

const DesaSchema = new Schema<IDesa>({
  nama: { 
    type: String, 
    required: [true, 'Nama desa wajib diisi'], 
    unique: true, 
    trim: true,
    minlength: [3, 'Nama desa minimal 3 karakter'],
    maxlength: [50, 'Nama desa maksimal 50 karakter']
  }
}, {
  timestamps: true
});

export const DesaModel = mongoose.model<IDesa>('Desa', DesaSchema);
