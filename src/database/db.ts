import mongoose, { Document, Schema, Model } from 'mongoose';
import crypto from 'crypto';
<<<<<<< Updated upstream

// --- DESA (WORKSPACE) INTERFACE & SCHEMA ---
export interface Desa {
  id: string;
  namaDesa: string;
  kodeDesa: string; // Contoh: "desa-a"
}

export interface DesaDocument extends Document {
  namaDesa: string;
  kodeDesa: string;
=======
import { verify } from 'otplib';
import { runMigration } from './migration';
import { UserModel, IUser } from './models/User';
import { ReportModel, IReport, IBoundingBox, IComment } from './models/Report';
import { DesaModel, IDesa } from './models/Desa';

// Re-export types for legacy compatibility in server.ts
export { IUser as User, IReport as Report, IBoundingBox as BoundingBox, IComment as Comment, IDesa as Desa };

export const DEFAULT_DESA_NAME = 'Desa EYECO';
export const DEFAULT_ADMIN_USERNAME = 'admin_eyeco';
export const DEFAULT_ADMIN_PASSWORD = 'admin123';


dotenv.config();

// Validate Environment Variables
if (!process.env.MONGODB_URI) {
  console.error('CRITICAL ERROR: MONGODB_URI is not defined in environment variables.');
  process.exit(1);
}
if (!process.env.PORT) {
  console.warn('[WARNING] PORT is not defined in environment variables. Defaulting to 8000.');
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI!;
  const maxRetries = 3;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      console.log(`[DATABASE INFO] Connecting to MongoDB (Attempt ${attempt}/${maxRetries})...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log('[DATABASE SUCCESS] MongoDB connected successfully.');
      
      // Run automatic migration from db.json
      await runMigration();

      // Seed default desa & admin account for development/testing
      await seedDefaultAdmin();

      return;
    } catch (err) {
      console.error(`[DATABASE ERROR] MongoDB connection attempt ${attempt} failed:`, err);
      if (attempt === maxRetries) {
        console.error('[DATABASE CRITICAL] Could not connect to MongoDB after maximum retries. Exiting.');
        process.exit(1);
      }
      attempt++;
      // Wait 2 seconds before retrying
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
>>>>>>> Stashed changes
}

const DesaSchema = new Schema<DesaDocument>({
  namaDesa: { type: String, required: true },
  kodeDesa: { type: String, required: true, unique: true }
});

const DesaModel: Model<DesaDocument> = mongoose.models.Desa || mongoose.model<DesaDocument>('Desa', DesaSchema);

<<<<<<< Updated upstream
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
=======
export async function seedDefaultAdmin(): Promise<void> {
  try {
    let desa = await DesaModel.findOne({ nama: DEFAULT_DESA_NAME }).exec();
    if (!desa) {
      desa = await DesaModel.create({ nama: DEFAULT_DESA_NAME });
      console.log(`[DATABASE INFO] Default desa "${DEFAULT_DESA_NAME}" created.`);
    }

    const existingAdmin = await UserModel.findOne({ username: DEFAULT_ADMIN_USERNAME }).lean();
    if (existingAdmin) {
      console.log(`[DATABASE INFO] Default admin "${DEFAULT_ADMIN_USERNAME}" already exists, skipping seed.`);
      return;
    }

    const lastUser = await UserModel.findOne().sort({ id: -1 }).exec();
    const nextId = lastUser ? lastUser.id + 1 : 1;

    await UserModel.create({
      id: nextId,
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash: DatabaseManager.hashPassword(DEFAULT_ADMIN_PASSWORD),
      role: 'admin',
      desaId: desa._id,
      twoFactorSecret: '',
      is2faEnabled: false,
    });

    console.log(`[DATABASE INFO] Default admin seeded → username: "${DEFAULT_ADMIN_USERNAME}", password: "${DEFAULT_ADMIN_PASSWORD}", role: admin`);
  } catch (err) {
    console.error('[DATABASE ERROR] seedDefaultAdmin failed:', err);
  }
}

>>>>>>> Stashed changes
export class DatabaseManager {
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

<<<<<<< Updated upstream
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
=======
  // --- DESA METHODS ---
  public static async createDesa(nama: string): Promise<IDesa> {
    try {
      return await DesaModel.create({ nama });
    } catch (err) {
      console.error('[DATABASE ERROR] createDesa failed:', err);
      throw err;
    }
  }

  public static async findDesaByName(nama: string): Promise<IDesa | null> {
    try {
      return await DesaModel.findOne({ nama: new RegExp(`^${nama}$`, 'i') }).exec();
    } catch (err) {
      console.error('[DATABASE ERROR] findDesaByName failed:', err);
      throw err;
    }
  }

  public static async getAllDesa(): Promise<IDesa[]> {
    try {
      return await DesaModel.find().lean().exec() as IDesa[];
    } catch (err) {
      console.error('[DATABASE ERROR] getAllDesa failed:', err);
      throw err;
    }
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
  public static async authenticateUser(username: string, passwordPlain: string, kodeDesa?: string): Promise<User | null> {
    const user = await this.findUserInDesa(username, kodeDesa);
    if (!user) return null;

    const inputHash = this.hashPassword(passwordPlain);
    if (user.passwordHash === inputHash) {
      return user;
=======
  public static async createUser(
    username: string, 
    passwordPlain: string, 
    role: 'superadmin' | 'admin' | 'user',
    desaId: string | mongoose.Types.ObjectId
  ): Promise<IUser | null> {
    try {
      // Case-insensitive duplicate check (username is stored in lowercase)
      const lowercaseUsername = username.toLowerCase();
      const exists = await UserModel.findOne({ username: lowercaseUsername }).lean();
      if (exists) return null;

      // Find max integer id for legacy auto-increment compatibility
      const lastUser = await UserModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastUser ? lastUser.id + 1 : 1;

      const newUser = await UserModel.create({
        id: nextId,
        username: lowercaseUsername,
        passwordHash: this.hashPassword(passwordPlain),
        role: role,
        desaId: new mongoose.Types.ObjectId(desaId)
      });

      return newUser.toJSON(); // Automatically strips passwordHash via schema toJSON transform
    } catch (err) {
      console.error('[DATABASE ERROR] createUser failed:', err);
      throw err;
    }
  }


  public static async authenticateUser(username: string, passwordPlain: string): Promise<IUser | null> {
    try {
      // Query user and explicitly select passwordHash since it is select: false
      const user = await UserModel.findOne({ username: username.toLowerCase() }).select('+passwordHash').exec();
      if (!user) return null;

      const inputHash = this.hashPassword(passwordPlain);
      if (user.passwordHash === inputHash) {
        const safeUser = user.toObject();
        delete (safeUser as { passwordHash?: string }).passwordHash;
        delete (safeUser as { twoFactorSecret?: string }).twoFactorSecret;
        return safeUser as IUser;
      }
      return null;
    } catch (err) {
      console.error('[DATABASE ERROR] authenticateUser failed:', err);
      throw err;
>>>>>>> Stashed changes
    }
    return null;
  }

  public static async getUserWith2FASecret(userId: number): Promise<IUser | null> {
    try {
      return await UserModel.findOne({ id: userId })
        .select('+twoFactorSecret')
        .lean()
        .exec() as IUser | null;
    } catch (err) {
      console.error('[DATABASE ERROR] getUserWith2FASecret failed:', err);
      throw err;
    }
  }

  public static async verify2FAToken(userId: number, token: string): Promise<boolean> {
    try {
      const user = await this.getUserWith2FASecret(userId);
      if (!user || !user.is2faEnabled || !user.twoFactorSecret) {
        return false;
      }

      const result = await verify({ secret: user.twoFactorSecret, token });
      return result.valid;
    } catch (err) {
      console.error('[DATABASE ERROR] verify2FAToken failed:', err);
      throw err;
    }
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
<<<<<<< Updated upstream
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
=======
    report: {
      location: string;
      aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
      aiConfidence: number | null;
      image: string;
      identity?: string;
      sourceType: string;
      additionalNotes?: string;
      boundingBoxes?: IBoundingBox[];
    }, 
    creatorId: number,
    desaId: string | mongoose.Types.ObjectId
  ): Promise<IReport> {
    try {
      // Find max integer id for legacy auto-increment compatibility
      const lastReport = await ReportModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastReport ? lastReport.id + 1 : 1;

      const newReport = await ReportModel.create({
        ...report,
        id: nextId,
        userId: creatorId,
        desaId: new mongoose.Types.ObjectId(desaId),
        timestamp: new Date(),
        adminStatus: 'MENUNGGU',
        adminNotes: '',
      });

      return newReport.toJSON();
    } catch (err) {
      console.error('[DATABASE ERROR] create report failed:', err);
      throw err;
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
    userContext: { id: string; role: 'admin' | 'user' }
  ): Promise<Report[]> {
    let query: any = {};

    // Kunci utama Multi-Tenancy: Semua user/admin hanya bisa melihat data desanya sendiri
    query.desaId = new mongoose.Types.ObjectId(userContext.desaId);
=======
    userContext: { id: number; role: 'superadmin' | 'admin' | 'user'; desaId: string | mongoose.Types.ObjectId },
    page?: number,
    limit?: number
  ): Promise<{ reports: IReport[]; total: number } | IReport[]> {
    try {
      const query: any = {};

      // Filter by desaId for multi-tenancy
      query.desaId = new mongoose.Types.ObjectId(userContext.desaId);

      // Filter by date
      if (filters.date) {
        const start = new Date(filters.date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(filters.date);
        end.setHours(23, 59, 59, 999);
        query.timestamp = { $gte: start, $lte: end };
      } else if (filters.timeRange && filters.timeRange !== 'semua') {
        const now = new Date();
        if (filters.timeRange === 'hari_ini') {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          query.timestamp = { $gte: start };
        } else if (filters.timeRange === 'minggu_ini') {
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(now.getDate() - 7);
          query.timestamp = { $gte: oneWeekAgo };
        }
      }
>>>>>>> Stashed changes

    if (userContext.kodeDesa) {
      query.kodeDesa = userContext.kodeDesa;
    }

<<<<<<< Updated upstream
    if (filters.aiStatus && filters.aiStatus !== 'semua') {
      query.aiStatus = filters.aiStatus;
    }
=======

  // Optimize statistics queries using MongoDB aggregation pipeline
  public static async getStats(userContext?: { id: number; role: 'superadmin' | 'admin' | 'user'; desaId: string | mongoose.Types.ObjectId }) {
    try {
      const matchQuery: any = {};
      if (userContext && userContext.desaId) {
        matchQuery.desaId = new mongoose.Types.ObjectId(userContext.desaId);
      }

>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
}
=======

  public static async deleteComment(
    reportId: number,
    commentId: string,
    userId: number,
    isAdmin: boolean
  ): Promise<IComment> {
    try {
      const report = await ReportModel.findOne({ id: reportId });
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const comment = (report.comments as any).id(commentId);
      if (!comment) {
        throw new Error('Komentar tidak ditemukan.');
      }

      // Authorization check: owner or admin
      if (comment.userId !== userId && !isAdmin) {
        throw new Error('Anda tidak memiliki akses untuk menghapus komentar ini.');
      }

      // Soft delete
      comment.isDeleted = true;
      await report.save();

      return comment;
    } catch (err) {
      console.error('[DATABASE ERROR] deleteComment failed:', err);
      throw err;
    }
  }

  public static async toggleLikeComment(
    reportId: number,
    commentId: string,
    userId: number
  ): Promise<IComment> {
    try {
      const report = await ReportModel.findOne({ id: reportId });
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const comment = (report.comments as any).id(commentId);
      if (!comment) {
        throw new Error('Komentar tidak ditemukan.');
      }


      if (comment.isDeleted) {
        throw new Error('Komentar telah dihapus.');
      }

      const index = comment.likedBy.indexOf(userId);
      if (index > -1) {
        // Unlike: remove userId
        comment.likedBy.splice(index, 1);
      } else {
        // Like: add userId
        comment.likedBy.push(userId);
      }

      await report.save();
      return comment;
    } catch (err) {
      console.error('[DATABASE ERROR] toggleLikeComment failed:', err);
      throw err;
    }
  }
}
>>>>>>> Stashed changes
