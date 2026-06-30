import mongoose, { Document, Schema, Model } from 'mongoose';
import crypto from 'crypto';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'user';
  kodeDesa?: string;
  namaDesa?: string;
}

export interface UserDocument extends Document {
  username: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'user';
  kodeDesa?: string;
  namaDesa?: string;
}

// Dibikin unique majemuk (compound index) agar username yang sama bisa ada di desa yang berbeda
const UserSchema = new Schema<UserDocument>({
  username: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['superadmin', 'admin', 'user'], required: true },
  kodeDesa: { type: String, default: null },
  namaDesa: { type: String, default: null }
});

// Memastikan username + kodeDesa bersifat unik secara kombinasi
UserSchema.index({ username: 1, kodeDesa: 1 }, { unique: true });

const UserModel: Model<UserDocument> = mongoose.models.User || mongoose.model<UserDocument>('User', UserSchema);

export interface BoundingBox {
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Report {
  id: string;
  userId: string;
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

export class DatabaseManager {
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  private static mapUser(doc: UserDocument): User {
    return {
      id: doc._id.toString(),
      username: doc.username,
      passwordHash: doc.passwordHash,
      role: doc.role,
      kodeDesa: doc.kodeDesa,
      namaDesa: doc.namaDesa
    };
  }

  private static mapReport(doc: ReportDocument): Report {
    return {
      id: doc._id.toString(),
      userId: doc.userId,
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

  // Cari user berdasarkan username di lingkungan desa yang spesifik
  public static async findUserInDesa(username: string, kodeDesa: string | undefined): Promise<User | undefined> {
    const doc = await UserModel.findOne({ 
      username: { $regex: new RegExp('^' + username + '$', 'i') },
      kodeDesa: kodeDesa || null
    });
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

  public static async createUser(
    username: string, 
    passwordPlain: string, 
    role: 'superadmin' | 'admin' | 'user', 
    kodeDesa?: string, 
    namaDesa?: string
  ): Promise<User | null> {
    const existing = await this.findUserInDesa(username, kodeDesa);
    if (existing) return null;

    const doc = new UserModel({
      username,
      passwordHash: this.hashPassword(passwordPlain),
      role,
      kodeDesa: kodeDesa || null,
      namaDesa: namaDesa || null
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

  // Cek apakah admin di desa ini sudah terdaftar atau belum
  public static async checkAdminExistsInDesa(kodeDesa: string): Promise<User | null> {
    const doc = await UserModel.findOne({ role: 'admin', kodeDesa });
    return doc ? this.mapUser(doc) : null;
  }

  public static async updateProfile(id: string, newUsername: string, newPasswordPlain?: string): Promise<User | null> {
    try {
      const doc = await UserModel.findById(id);
      if (!doc) return null;
      
      doc.username = newUsername;
      if (newPasswordPlain) {
        doc.passwordHash = this.hashPassword(newPasswordPlain);
      }
      await doc.save();
      return this.mapUser(doc);
    } catch {
      return null;
    }
  }

  public static async getAll(kodeDesa?: string): Promise<Report[]> {
    const query = kodeDesa ? { kodeDesa } : {};
    const docs = await ReportModel.find(query).sort({ timestamp: -1 });
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
    creatorId: string,
    kodeDesa?: string
  ): Promise<Report> {
    const doc = new ReportModel({
      ...report,
      userId: creatorId,
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
      timeRange?: string; 
      date?: string; 
      aiStatus?: string; 
      adminStatus?: string; 
      location?: string;
    },
    userContext: { id: string; role: string; kodeDesa?: string }
  ): Promise<Report[]> {
    let query: any = {};

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

  public static async getStats(userContext?: { id: string; role: string; kodeDesa?: string }) {
    let query: any = {};
    if (userContext && userContext.kodeDesa) {
      query.kodeDesa = userContext.kodeDesa;
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