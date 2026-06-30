import mongoose, { Schema, Document } from 'mongoose';

export interface IBoundingBox {
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IComment {
  _id: mongoose.Types.ObjectId;
  userId: number;
  text: string;
  likedBy: number[];
  isDeleted: boolean;
  parentCommentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReport extends Document {
  id: number;
  userId: number;
  location: string;
  timestamp: Date;
  aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  aiConfidence: number | null;
  adminStatus: 'MENUNGGU' | 'VALID' | 'DIABAIKAN';
  image: string;
  identity: string;
  sourceType: string;
  additionalNotes: string;
  adminNotes: string;
  boundingBoxes: IBoundingBox[];
  comments: IComment[];
}

const BoundingBoxSchema = new Schema<IBoundingBox>({
  label: { type: String, required: true, trim: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  x: { type: Number, required: true, min: 0, max: 100 },
  y: { type: Number, required: true, min: 0, max: 100 },
  w: { type: Number, required: true, min: 0, max: 100 },
  h: { type: Number, required: true, min: 0, max: 100 }
});

const CommentSchema = new Schema<IComment>({
  userId: { type: Number, required: true },
  text: { type: String, required: true, trim: true },
  likedBy: { type: [Number], default: [] },
  isDeleted: { type: Boolean, default: false },
  parentCommentId: { type: String, default: null }
}, {
  timestamps: true
});

const ReportSchema = new Schema<IReport>({
  id: { type: Number, required: true, unique: true, index: true },
  userId: { type: Number, required: true, index: true },
  location: { type: String, required: true, trim: true },
  timestamp: { type: Date, required: true, index: true },
  aiStatus: { 
    type: String, 
    enum: ['TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi'], 
    required: true, 
    index: true 
  },
  aiConfidence: { type: Number, default: null },
  adminStatus: { 
    type: String, 
    enum: ['MENUNGGU', 'VALID', 'DIABAIKAN'], 
    required: true, 
    default: 'MENUNGGU', 
    index: true 
  },
  image: { type: String, required: true },
  identity: { type: String, default: 'Belum diketahui', trim: true },
  sourceType: { type: String, required: true, trim: true },
  additionalNotes: { type: String, default: 'Tidak ada catatan tambahan.', trim: true },
  adminNotes: { type: String, default: '', trim: true },
  boundingBoxes: [BoundingBoxSchema],
  comments: [CommentSchema]
}, {
  timestamps: true
});

ReportSchema.index({ timestamp: -1, adminStatus: 1 });

export const ReportModel = mongoose.model<IReport>('Report', ReportSchema);
