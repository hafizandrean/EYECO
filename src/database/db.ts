import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { runMigration } from './migration';
import { UserModel, IUser } from './models/User';
import { ReportModel, IReport, IBoundingBox, IComment } from './models/Report';

// Re-export types for legacy compatibility in server.ts
export { IUser as User, IReport as Report, IBoundingBox as BoundingBox, IComment as Comment };

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
}

// Graceful Shutdown Handler
const gracefulExit = async (signal: string) => {
  try {
    console.log(`[DATABASE INFO] Closing database connection due to ${signal}...`);
    await mongoose.connection.close();
    console.log('[DATABASE SUCCESS] Mongoose connection closed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[DATABASE ERROR] Error during database disconnect:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulExit('SIGINT'));
process.on('SIGTERM', () => gracefulExit('SIGTERM'));

export class DatabaseManager {
  // Hashing utility remains SHA-256 for backward compatibility with existing hashed passwords
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // --- USER METHODS ---
  
  public static async findUserByUsername(username: string): Promise<IUser | null> {
    try {
      return await UserModel.findOne({ username: username.toLowerCase() }).lean();
    } catch (err) {
      console.error('[DATABASE ERROR] findUserByUsername failed:', err);
      throw err;
    }
  }

  public static async getUserById(id: number): Promise<IUser | null> {
    try {
      return await UserModel.findOne({ id }).lean();
    } catch (err) {
      console.error('[DATABASE ERROR] getUserById failed:', err);
      throw err;
    }
  }

  public static async createUser(
    username: string, 
    passwordPlain: string, 
    role: 'admin' | 'user'
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
        role: role
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
        return user.toJSON(); // toJSON strips passwordHash
      }
      return null;
    } catch (err) {
      console.error('[DATABASE ERROR] authenticateUser failed:', err);
      throw err;
    }
  }

  // --- REPORT METHODS ---

  public static async getAll(): Promise<IReport[]> {
    try {
      return await ReportModel.find().sort({ timestamp: -1 }).lean();
    } catch (err) {
      console.error('[DATABASE ERROR] getAll reports failed:', err);
      throw err;
    }
  }

  public static async getById(id: number): Promise<IReport | null> {
    try {
      return await ReportModel.findOne({ id }).lean();
    } catch (err) {
      console.error('[DATABASE ERROR] getById report failed:', err);
      throw err;
    }
  }

  public static async create(
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
    creatorId: number
  ): Promise<IReport> {
    try {
      // Find max integer id for legacy auto-increment compatibility
      const lastReport = await ReportModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastReport ? lastReport.id + 1 : 1;

      const newReport = await ReportModel.create({
        ...report,
        id: nextId,
        userId: creatorId,
        timestamp: new Date(),
        adminStatus: 'MENUNGGU',
        adminNotes: '',
      });

      return newReport.toJSON();
    } catch (err) {
      console.error('[DATABASE ERROR] create report failed:', err);
      throw err;
    }
  }

  public static async updateVerification(
    id: number, 
    status: 'VALID' | 'DIABAIKAN' | 'MENUNGGU', 
    notes: string
  ): Promise<IReport | null> {
    try {
      const updated = await ReportModel.findOneAndUpdate(
        { id }, 
        { adminStatus: status, adminNotes: notes }, 
        { new: true }
      ).lean();
      return updated;
    } catch (err) {
      console.error('[DATABASE ERROR] updateVerification failed:', err);
      throw err;
    }
  }

  // Flexible database-level pagination, sorting, and filtering
  public static async getFiltered(
    filters: {
      timeRange?: string; // 'hari_ini', 'minggu_ini', 'semua'
      date?: string; // YYYY-MM-DD
      aiStatus?: string; // 'TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi', 'semua'
      adminStatus?: string; // 'MENUNGGU', 'VALID', 'DIABAIKAN', 'semua'
      location?: string;
    },
    userContext: { id: number; role: 'admin' | 'user' },
    page?: number,
    limit?: number
  ): Promise<{ reports: IReport[]; total: number } | IReport[]> {
    try {
      const query: any = {};

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

      // Filter by aiStatus
      if (filters.aiStatus && filters.aiStatus !== 'semua') {
        query.aiStatus = filters.aiStatus;
      }

      // Filter by adminStatus
      if (filters.adminStatus && filters.adminStatus !== 'semua') {
        query.adminStatus = filters.adminStatus;
      }

      // Filter by location (search)
      if (filters.location && filters.location.trim() !== '') {
        const regex = new RegExp(filters.location, 'i');
        query.$or = [
          { location: regex },
          { identity: regex }
        ];
      }

      const q = ReportModel.find(query).sort({ timestamp: -1 });

      if (page !== undefined && limit !== undefined) {
        const skip = (page - 1) * limit;
        const [reports, total] = await Promise.all([
          q.skip(skip).limit(limit).lean().exec() as Promise<IReport[]>,
          ReportModel.countDocuments(query).exec()
        ]);
        return { reports, total };
      } else {
        return await q.lean().exec() as IReport[];
      }
    } catch (err) {
      console.error('[DATABASE ERROR] getFiltered failed:', err);
      throw err;
    }
  }

  // Optimize statistics queries using MongoDB aggregation pipeline
  public static async getStats(userContext?: { id: number; role: 'admin' | 'user' }) {
    try {
      const matchQuery: any = {};

      // Execute counts concurrently
      const [total, valid, cancelled, pending] = await Promise.all([
        ReportModel.countDocuments(matchQuery),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' })
      ]);

      // Determine most vulnerable location using aggregation (with threat aiStatus TINGGI or SEDANG)
      const vulnGroup = await ReportModel.aggregate([
        { $match: { ...matchQuery, aiStatus: { $in: ['TINGGI', 'SEDANG'] } } },
        { $group: { _id: '$location', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ]);

      let mostVulnerable = vulnGroup.length > 0 ? vulnGroup[0]._id : '-';

      // Fallback if no high/medium threat reports are found, grab the most frequent overall location
      if (total > 0 && mostVulnerable === '-') {
        const overallGroup = await ReportModel.aggregate([
          { $match: matchQuery },
          { $group: { _id: '$location', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 }
        ]);
        if (overallGroup.length > 0) {
          mostVulnerable = overallGroup[0]._id;
        }
      }

      return {
        total,
        mostVulnerable,
        valid,
        cancelled,
        pending
      };
    } catch (err) {
      console.error('[DATABASE ERROR] getStats failed:', err);
      throw err;
    }
  }

  // --- COMMENT METHODS ---

  public static async addComment(
    reportId: number,
    userId: number,
    text: string
  ): Promise<IComment> {
    try {
      // 1. Sanitize HTML
      const sanitized = text.replace(/<[^>]*>/g, '').trim();

      // 2. Validate length
      if (sanitized.length < 2 || sanitized.length > 500) {
        throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
      }

      const report = await ReportModel.findOne({ id: reportId });
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      // Create comment document object
      const commentData = {
        userId,
        text: sanitized,
        likedBy: [],
        isDeleted: false,
        parentCommentId: null
      };

      report.comments.push(commentData as any);
      await report.save();

      // Return the newly created comment (the last one in the array)
      return report.comments[report.comments.length - 1];
    } catch (err) {
      console.error('[DATABASE ERROR] addComment failed:', err);
      throw err;
    }
  }

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

      const comment = report.comments.id(commentId);
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

      const comment = report.comments.id(commentId);
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
