import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { runMigration } from './migration';
import { UserModel, IUser } from './models/User';
import { ReportModel, IReport, IBoundingBox, IComment } from './models/Report';
import { CctvModel, ICctv } from './models/Cctv';

// Re-export types for legacy compatibility in server.ts
export { IUser as User, IReport as Report, IBoundingBox as BoundingBox, IComment as Comment, ICctv as Cctv };

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

  // --- CCTV METHODS ---

  public static async getAllCctv(): Promise<ICctv[]> {
    try {
      let count = await CctvModel.countDocuments();
      if (count === 0) {
        console.log('[DATABASE INFO] CCTV collection is empty. Seeding default 8 cameras...');
        const defaultCameras = [
          {
            id: 1,
            name: 'Jembatan Merah',
            location: 'Jembatan Merah',
            description: 'Pemantauan hulu sungai Jembatan Merah',
            vendor: 'GENERIC',
            model: 'CCTV-G1',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_1.jpg',
            playUrl: '/uploads/detection_1.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 45, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 2,
            name: 'Sektor 7 Hulu',
            location: 'Sektor 7 Hulu',
            description: 'Pemantauan tanggul Sektor 7 Hulu',
            vendor: 'GENERIC',
            model: 'CCTV-G2',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_2.jpg',
            playUrl: '/uploads/detection_2.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 50, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 3,
            name: 'Pintu Air Manggarai',
            location: 'Pintu Air Manggarai',
            description: 'Pemantauan debit air Pintu Air Manggarai',
            vendor: 'GENERIC',
            model: 'CCTV-G3',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_3.jpg',
            playUrl: '/uploads/detection_3.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 60, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 4,
            name: 'Aliran Kampung Melayu',
            location: 'Aliran Kampung Melayu',
            description: 'Aliran padat penduduk Kampung Melayu',
            vendor: 'GENERIC',
            model: 'CCTV-G4',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_4.jpg',
            playUrl: '/uploads/detection_4.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 55, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 5,
            name: 'Bendungan Katulampa',
            location: 'Bendungan Katulampa',
            description: 'Pemantauan volume air Bendungan Katulampa',
            vendor: 'GENERIC',
            model: 'CCTV-G5',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_5.jpg',
            playUrl: '/uploads/detection_5.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 80, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 6,
            name: 'Kali Ciliwung Depok',
            location: 'Kali Ciliwung Depok',
            description: 'Aliran tengah Kali Ciliwung Depok',
            vendor: 'GENERIC',
            model: 'CCTV-G6',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_6.jpg',
            playUrl: '/uploads/detection_6.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 65, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 7,
            name: 'Pintu Air Karet',
            location: 'Pintu Air Karet',
            description: 'Pemantauan aliran Pintu Air Karet',
            vendor: 'GENERIC',
            model: 'CCTV-G7',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_7.jpg',
            playUrl: '/uploads/detection_7.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 70, fps: 0, resolution: '1280x720' },
            createdBy: 1
          },
          {
            id: 8,
            name: 'Sektor 12 Hilir',
            location: 'Sektor 12 Hilir',
            description: 'Sektor 12 Hilir penyaringan sampah',
            vendor: 'GENERIC',
            model: 'CCTV-G8',
            protocol: 'HTTP Image',
            mediaType: 'Image',
            streamUrl: '/uploads/detection_8.jpg',
            playUrl: '/uploads/detection_8.jpg',
            capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
            isDefault: true,
            status: 'ONLINE',
            health: { latency: 90, fps: 0, resolution: '1280x720' },
            createdBy: 1
          }
        ];
        await CctvModel.insertMany(defaultCameras);
      }
      return await CctvModel.find({}).sort({ id: 1 }).lean();
    } catch (err) {
      console.error('[DATABASE ERROR] getAllCctv failed:', err);
      throw err;
    }
  }

  public static async getCctvById(id: number): Promise<ICctv | null> {
    try {
      return await CctvModel.findOne({ id }).lean();
    } catch (err) {
      console.error('[DATABASE ERROR] getCctvById failed:', err);
      throw err;
    }
  }

  public static async addCctv(payload: Partial<ICctv>, userId: number): Promise<ICctv> {
    try {
      if (!payload.name || !payload.location || !payload.protocol || !payload.streamUrl) {
        throw new Error('Semua field wajib diisi.');
      }

      // Generate Auto-increment ID
      const maxCctv = await CctvModel.findOne({}).sort({ id: -1 });
      const nextId = maxCctv ? maxCctv.id + 1 : 1;

      // Encrypt password if provided
      let encryptedPassword = '';
      if (payload.password) {
        encryptedPassword = DatabaseManager.encryptCctvPassword(payload.password);
      }

      const newCctv = new CctvModel({
        id: nextId,
        name: payload.name,
        location: payload.location,
        description: payload.description || '',
        vendor: payload.vendor || 'GENERIC',
        model: payload.model || '',
        protocol: payload.protocol,
        mediaType: payload.mediaType || 'Video',
        streamUrl: payload.streamUrl,
        playUrl: payload.playUrl || payload.streamUrl,
        username: payload.username || '',
        password: encryptedPassword,
        capabilities: payload.capabilities || {
          rtsp: payload.protocol === 'RTSP',
          hls: payload.protocol === 'HLS',
          snapshot: payload.protocol === 'HTTP Image',
          mjpeg: payload.protocol === 'MJPEG',
          onvif: false,
          cloud: payload.protocol === 'CLOUD_VIEWER'
        },
        status: 'CONNECTING',
        health: {
          latency: 0,
          fps: 0,
          resolution: '1280x720'
        },
        isDefault: false,
        isActive: true,
        createdBy: userId
      });

      await newCctv.save();
      return newCctv;
    } catch (err) {
      console.error('[DATABASE ERROR] addCctv failed:', err);
      throw err;
    }
  }

  public static async updateCctv(id: number, payload: Partial<ICctv>): Promise<ICctv> {
    try {
      const cctv = await CctvModel.findOne({ id });
      if (!cctv) {
        throw new Error('CCTV tidak ditemukan.');
      }

      if (payload.name) cctv.name = payload.name;
      if (payload.location) cctv.location = payload.location;
      if (payload.description !== undefined) cctv.description = payload.description;
      if (payload.vendor) cctv.vendor = payload.vendor;
      if (payload.model !== undefined) cctv.model = payload.model;
      if (payload.protocol) cctv.protocol = payload.protocol;
      if (payload.mediaType) cctv.mediaType = payload.mediaType;
      if (payload.streamUrl) {
        cctv.streamUrl = payload.streamUrl;
        cctv.playUrl = payload.playUrl || payload.streamUrl;
      }
      if (payload.username !== undefined) cctv.username = payload.username;
      
      if (payload.password) {
        cctv.password = DatabaseManager.encryptCctvPassword(payload.password);
      }
      
      if (payload.capabilities) cctv.capabilities = payload.capabilities;
      if (payload.isActive !== undefined) cctv.isActive = payload.isActive;

      await cctv.save();
      return cctv;
    } catch (err) {
      console.error('[DATABASE ERROR] updateCctv failed:', err);
      throw err;
    }
  }

  public static async deleteCctv(id: number): Promise<boolean> {
    try {
      const cctv = await CctvModel.findOne({ id });
      if (!cctv) {
        throw new Error('CCTV tidak ditemukan.');
      }

      if (cctv.isDefault) {
        throw new Error('Kamera bawaan sistem tidak boleh dihapus.');
      }

      await CctvModel.deleteOne({ id });
      return true;
    } catch (err) {
      console.error('[DATABASE ERROR] deleteCctv failed:', err);
      throw err;
    }
  }

  public static async updateCctvStatus(
    id: number,
    status: 'NEW' | 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'BUFFERING' | 'ERROR' | 'DISCONNECTED',
    health?: { latency: number; fps: number; resolution: string }
  ): Promise<void> {
    try {
      const updatePayload: any = {
        status,
        lastHeartbeat: new Date()
      };
      if (status === 'ONLINE') {
        updatePayload.lastConnected = new Date();
      }
      if (health) {
        updatePayload.health = health;
      }
      await CctvModel.updateOne({ id }, { $set: updatePayload });
    } catch (err) {
      console.error('[DATABASE ERROR] updateCctvStatus failed:', err);
    }
  }

  // --- ENCRYPTION HELPERS ---

  private static encryptCctvPassword(text: string): string {
    try {
      const encryptionKey = crypto.scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (err) {
      console.error('[DATABASE ERROR] Encryption failed:', err);
      return '';
    }
  }

  public static decryptCctvPassword(text: string): string {
    try {
      if (!text) return '';
      const encryptionKey = crypto.scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
      const parts = text.split(':');
      const iv = Buffer.from(parts.shift()!, 'hex');
      const encryptedText = Buffer.from(parts.join(':'), 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[DATABASE ERROR] Decryption failed:', err);
      return '';
    }
  }
}
