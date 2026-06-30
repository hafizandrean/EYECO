import mongoose, { Document, Schema, Model } from 'mongoose';
import crypto from 'crypto';

export interface User {
  id: string; // Used to return string instead of ObjectId for frontend
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
}

export interface UserDocument extends Document {
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
}

const UserSchema = new Schema<UserDocument>({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], required: true }
});

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
  }]
});

const ReportModel: Model<ReportDocument> = mongoose.models.Report || mongoose.model<ReportDocument>('Report', ReportSchema);

export class DatabaseManager {
  // --- HASHING UTILITY ---
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // --- MAPPER HELPERS ---
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
      }))
    };
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
      username: username,
      passwordHash: this.hashPassword(passwordPlain),
      role: role
    });
    await doc.save();
    return this.mapUser(doc);
  }

  public static async authenticateUser(username: string, passwordPlain: string): Promise<User | null> {
    const user = await this.findUserByUsername(username);
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
      timestamp: new Date().toISOString(),
      adminStatus: 'MENUNGGU',
      adminNotes: '',
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

    if (userContext.role === 'user') {
      query.userId = userContext.id;
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

    // Since timestamp is ISO string, we can do range queries, but filtering in memory might be easier for 'hari_ini', etc.
    // For performance, let's do it via DB query
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

    if (totalReports > 0 && mostVulnerableLocation === '-') {
      const allLocationCounts: Record<string, number> = {};
      docs.forEach((r) => {
        allLocationCounts[r.location] = (allLocationCounts[r.location] || 0) + 1;
      });
      let maxAllCount = 0;
      Object.entries(allLocationCounts).forEach(([loc, count]) => {
        if (count > maxAllCount) {
          maxAllCount = count;
          mostVulnerableLocation = loc;
        }
      });
    }

    return {
      total: totalReports,
      mostVulnerable: mostVulnerableLocation,
      valid: validCount,
      cancelled: cancelledCount,
      pending: pendingCount,
    };
  }
}
