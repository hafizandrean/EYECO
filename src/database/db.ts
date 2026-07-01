import mongoose, { Document, Schema, Model } from 'mongoose';
import crypto from 'crypto';

// --- DESA (WORKSPACE) INTERFACE & SCHEMA ---
export interface Desa {
  id: string;
  namaDesa: string;
  kodeDesa: string; // Contoh: "desa-a"
}

export interface DesaDocument extends Document {
  namaDesa: string;
  kodeDesa: string;
}

const DesaSchema = new Schema<DesaDocument>({
  namaDesa: { type: String, required: true },
  kodeDesa: { type: String, required: true, unique: true }
});

const DesaModel: Model<DesaDocument> = mongoose.models.Desa || mongoose.model<DesaDocument>('Desa', DesaSchema);

// --- USER INTERFACE & SCHEMA ---
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
}

export interface UserDocument extends Document {
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
}

// Dibikin unique majemuk (compound index) agar username yang sama bisa ada di desa yang berbeda
const UserSchema = new Schema<UserDocument>({
  username: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], required: true }
});

// Memastikan username + kodeDesa bersifat unik secara kombinasi
UserSchema.index({ username: 1, kodeDesa: 1 }, { unique: true });

const UserModel: Model<UserDocument> = mongoose.models.User || mongoose.model<UserDocument>('User', UserSchema);

// --- BOUNDING BOX INTERFACE ---
export interface BoundingBox {
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- REPORT INTERFACE & SCHEMA ---
export interface Report {
  id: string;
  userId: string;
  desaId: string; // Laporan di-scope per desa
  location: string;
  timestamp: string;
  aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  aiConfidence: number | null;
  adminStatus: 'MENUNGGU' | 'VALID' | 'DIABAIKAN';
  image: string;
  identity: string;
  sourceType: string;
  additionalNotes: string;
  adminNotes: string;
  boundingBoxes: BoundingBox[];
  kodeDesa?: string;
}

export interface ReportDocument extends Document {
  userId: string;
  desaId: mongoose.Types.ObjectId;
  location: string;
  timestamp: string;
  aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  aiConfidence: number | null;
  adminStatus: 'MENUNGGU' | 'VALID' | 'DIABAIKAN';
  image: string;
  identity: string;
  sourceType: string;
  additionalNotes: string;
  adminNotes: string;
  boundingBoxes: BoundingBox[];
  kodeDesa?: string;
}

const ReportSchema = new Schema<ReportDocument>({
  userId: { type: String, required: true },
  desaId: { type: Schema.Types.ObjectId, ref: 'Desa', required: true },
  location: { type: String, required: true },
  timestamp: { type: String, required: true },
  aiStatus: { type: String, enum: ['TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi'], required: true },
  aiConfidence: { type: Number, default: null },
  adminStatus: { type: String, enum: ['MENUNGGU', 'VALID', 'DIABAIKAN'], required: true, default: 'MENUNGGU' },
  image: { type: String, required: true },
  identity: { type: String, required: true },
  sourceType: { type: String, required: true },
  additionalNotes: { type: String, default: '' },
  adminNotes: { type: String, default: '' },
  boundingBoxes: [{
    label: String,
    confidence: Number,
    x: Number,
    y: Number,
    w: Number,
    h: Number
  }],
  kodeDesa: { type: String, default: null }
});

const ReportModel: Model<ReportDocument> = mongoose.models.Report || mongoose.model<ReportDocument>('Report', ReportSchema);

// --- DATABASE MANAGER ---
export class DatabaseManager {
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  private static mapUser(doc: UserDocument): User {
    return {
      id: doc._id.toString(),
      username: doc.username,
      passwordHash: doc.passwordHash,
      role: doc.role
    };
  }

  private static mapReport(doc: ReportDocument): Report {
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      desaId: doc.desaId.toString(),
      location: doc.location,
      timestamp: doc.timestamp,
      aiStatus: doc.aiStatus,
      aiConfidence: doc.aiConfidence,
      adminStatus: doc.adminStatus,
      image: doc.image,
      identity: doc.identity,
      sourceType: doc.sourceType,
      additionalNotes: doc.additionalNotes,
      adminNotes: doc.adminNotes,
      boundingBoxes: doc.boundingBoxes.map(b => ({
        label: b.label,
        confidence: b.confidence,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h
      })),
      kodeDesa: doc.kodeDesa
    };
  }

  // --- DESA METHODS ---
  public static async createDesa(namaDesa: string, kodeDesa: string): Promise<DesaDocument> {
    const doc = new DesaModel({ namaDesa, kodeDesa });
    return await doc.save();
  }

  public static async findDesaByKode(kodeDesa: string): Promise<DesaDocument | null> {
    return await DesaModel.findOne({ kodeDesa });
  }

  // --- USER METHODS ---
  public static async findUserByUsername(username: string): Promise<User | undefined> {
    // Regex for case-insensitive exact match
    const doc = await UserModel.findOne({ username: { $regex: new RegExp('^' + username + '$', 'i') } });
    return doc ? this.mapUser(doc) : undefined;
  }

  public static async getUserById(id: string): Promise<User | undefined> {
    try {
      const doc = await UserModel.findById(id);
      return doc ? this.mapUser(doc) : undefined;
    } catch {
      return undefined;
    }
  }

  public static async createUser(username: string, passwordPlain: string, role: 'admin' | 'user'): Promise<User | null> {
    const existing = await this.findUserByUsername(username);
    if (existing) return null;

    const doc = new UserModel({
      username,
      passwordHash: this.hashPassword(passwordPlain),
      role: role
    });
    await doc.save();
    return this.mapUser(doc);
  }

  public static async authenticateUser(username: string, passwordPlain: string, kodeDesa?: string): Promise<User | null> {
    const user = await this.findUserInDesa(username, kodeDesa);
    if (!user) return null;

    const inputHash = this.hashPassword(passwordPlain);
    if (user.passwordHash === inputHash) {
      return user;
    }
    return null;
  }

  // --- REPORT METHODS ---
  public static async getAll(): Promise<Report[]> {
    const docs = await ReportModel.find().sort({ timestamp: -1 });
    return docs.map(d => this.mapReport(d));
  }

  public static async getById(id: string): Promise<Report | undefined> {
    try {
      const doc = await ReportModel.findById(id);
      return doc ? this.mapReport(doc) : undefined;
    } catch {
      return undefined;
    }
  }

  public static async create(
    report: Omit<Report, 'id' | 'timestamp' | 'adminStatus' | 'adminNotes' | 'userId'>, 
    creatorId: string
  ): Promise<Report> {
    const doc = new ReportModel({
      ...report,
      userId: creatorId,
      desaId: new mongoose.Types.ObjectId(desaId),
      timestamp: new Date().toISOString(),
      adminStatus: 'MENUNGGU',
      adminNotes: '',
      kodeDesa: kodeDesa || null
    });
    await doc.save();
    return this.mapReport(doc);
  }

  public static async updateVerification(id: string, status: 'VALID' | 'DIABAIKAN' | 'MENUNGGU', notes: string): Promise<Report | undefined> {
    try {
      const doc = await ReportModel.findById(id);
      if (!doc) return undefined;
      
      doc.adminStatus = status;
      doc.adminNotes = notes;
      await doc.save();
      return this.mapReport(doc);
    } catch {
      return undefined;
    }
  }

  public static async getFiltered(
    filters: {
      timeRange?: string; // 'hari_ini', 'minggu_ini', 'semua'
      date?: string; // YYYY-MM-DD
      aiStatus?: string; // 'TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi', 'semua'
      adminStatus?: string; // 'MENUNGGU', 'VALID', 'DIABAIKAN', 'semua'
      location?: string;
    },
    userContext: { id: string; role: 'admin' | 'user' }
  ): Promise<Report[]> {
    let query: any = {};

    // Kunci utama Multi-Tenancy: Semua user/admin hanya bisa melihat data desanya sendiri
    query.desaId = new mongoose.Types.ObjectId(userContext.desaId);

    if (userContext.kodeDesa) {
      query.kodeDesa = userContext.kodeDesa;
    }

    if (filters.aiStatus && filters.aiStatus !== 'semua') {
      query.aiStatus = filters.aiStatus;
    }

    if (filters.adminStatus && filters.adminStatus !== 'semua') {
      query.adminStatus = filters.adminStatus;
    }

    if (filters.location && filters.location.trim() !== '') {
      const searchRegex = new RegExp(filters.location, 'i');
      query.$or = [
        { location: { $regex: searchRegex } },
        { identity: { $regex: searchRegex } }
      ];
    }

    if (filters.date) {
      const targetDate = new Date(filters.date);
      const nextDate = new Date(targetDate);
      nextDate.setDate(targetDate.getDate() + 1);
      
      query.timestamp = {
        $gte: targetDate.toISOString(),
        $lt: nextDate.toISOString()
      };
    } else if (filters.timeRange && filters.timeRange !== 'semua') {
      const now = new Date();
      if (filters.timeRange === 'hari_ini') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        query.timestamp = { $gte: today.toISOString() };
      } else if (filters.timeRange === 'minggu_ini') {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);
        query.timestamp = { $gte: oneWeekAgo.toISOString() };
      }
    }

    const docs = await ReportModel.find(query).sort({ timestamp: -1 });
    return docs.map(d => this.mapReport(d));
  }

  public static async getStats(userContext?: { id: string; role: 'admin' | 'user' }) {
    let query: any = {};
    if (userContext && userContext.role === 'user') {
      query.userId = userContext.id;
    }

    const docs = await ReportModel.find(query);
    
    const totalReports = docs.length;
    const validCount = docs.filter((r) => r.adminStatus === 'VALID').length;
    const cancelledCount = docs.filter((r) => r.adminStatus === 'DIABAIKAN').length;
    const pendingCount = docs.filter((r) => r.adminStatus === 'MENUNGGU').length;

    const locationCounts: Record<string, number> = {};
    docs.forEach((r) => {
      if (r.aiStatus === 'TINGGI' || r.aiStatus === 'SEDANG') {
        locationCounts[r.location] = (locationCounts[r.location] || 0) + 1;
      }
    });

    let mostVulnerableLocation = '-';
    let maxCount = 0;
    Object.entries(locationCounts).forEach(([loc, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostVulnerableLocation = loc;
      }
    });

    return {
      total: totalReports,
      mostVulnerable: mostVulnerableLocation,
      valid: validCount,
      cancelled: cancelledCount,
      pending: pendingCount,
    };
  }
}