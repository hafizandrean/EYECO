import mongoose, { Schema, Document } from 'mongoose';

export interface INews extends Document {
  title: string;
  slug: string;
  summary: string;
  content: string;
  category: string;
  thumbnail?: string;
  images: string[];
  author: string;
  authorId?: number;
  status: 'draft' | 'published';
  publishedAt?: Date;
  workspaceId: number;
  createdAt: Date;
  updatedAt: Date;
}

const NewsSchema = new Schema<INews>({
  title:          { type: String, required: true },
  slug:           { type: String, required: true, unique: true },
  summary:        { type: String, required: true },
  content:        { type: String, required: true },
  category:       { type: String, default: 'Informasi' },
  thumbnail:      { type: String, default: '' },
  images:         { type: [String], default: [] },
  author:         { type: String, required: true },
  authorId:       { type: Number, default: null },
  status:         { type: String, enum: ['draft', 'published'], default: 'published' },
  publishedAt:    { type: Date, default: null },
  workspaceId:    { type: Number, required: true },
}, { timestamps: true });

NewsSchema.index({ workspaceId: 1, status: 1, publishedAt: -1 });
NewsSchema.index({ slug: 1 }, { unique: true });

export const NewsModel = mongoose.model<INews>('News', NewsSchema);
