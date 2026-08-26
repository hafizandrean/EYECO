import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { runMigration } from './migration';
import { AiModelManager } from '../cctv/services/AiModelManager';
import { UserModel, IUser } from './models/User';
import { ReportModel, IReport, IBoundingBox, IComment } from './models/Report';
import { CctvModel, ICctv } from './models/Cctv';
import { TimelineEventModel, ITimelineEvent } from './models/TimelineEvent';
import { AssignmentModel, IAssignment } from './models/Assignment';
import { ResolutionModel, IResolution } from './models/Resolution';
import { NotificationModel, INotification } from './models/Notification';
import { OutboxEventModel, IOutboxEvent } from './models/OutboxEvent';
import { SystemAuditLogModel, ISystemAuditLog } from './models/SystemAuditLog';
import { WorkspaceModel, IWorkspace } from './models/Workspace';

import { SystemSettingsModel, ISystemSettings } from './models/SystemSettings';
import { NewsModel, INews } from './models/News';
import { AiModelModel, IAiModel } from './models/AiModel';
import { AiDetectionModel, IAiDetection } from './models/AiDetection';
import { AiEvidenceModel, IAiEvidence } from './models/AiEvidence';
import { AiVerificationStateModel, IAiVerificationState } from './models/AiVerificationState';
import { CameraHealthLogModel, ICameraHealthLog } from './models/CameraHealthLog';
import { AiMetricModel, IAiMetric } from './models/AiMetric';
import { CameraEventModel, ICameraEvent } from './models/CameraEvent';

// Re-export types for legacy compatibility in server.ts
export { 
  IUser as User, 
  IReport as Report, 
  IBoundingBox as BoundingBox, 
  IComment as Comment, 
  ICctv as Cctv,
  CctvModel,
  UserModel,
  ReportModel,
  TimelineEventModel, ITimelineEvent as TimelineEvent,
  AssignmentModel, IAssignment as Assignment,
  ResolutionModel, IResolution as Resolution,
  NotificationModel, INotification as Notification,
  OutboxEventModel, IOutboxEvent as OutboxEvent,
  SystemAuditLogModel, ISystemAuditLog as SystemAuditLog,
  SystemSettingsModel, ISystemSettings as SystemSettings,
  AiModelModel, IAiModel as AiModel,
  AiDetectionModel, IAiDetection as AiDetection,
  AiEvidenceModel, IAiEvidence as AiEvidence,
  AiVerificationStateModel, IAiVerificationState as AiVerificationState,
  CameraHealthLogModel, ICameraHealthLog as CameraHealthLog,
  AiMetricModel, IAiMetric as AiMetric,
  CameraEventModel, ICameraEvent as CameraEvent,
  WorkspaceModel, IWorkspace as Workspace,
  NewsModel, INews as News
};

dotenv.config();

// Validate Environment Variables
if (!process.env.MONGODB_URI) {
  console.error('CRITICAL ERROR: MONGODB_URI is not defined in environment variables.');
  process.exit(1);
}
if (!process.env.PORT) {
  console.warn('[WARNING] PORT is not defined in environment variables. Defaulting to 8000.');
}

async function ensureWorkspaceCodes(): Promise<void> {
  const missingCodeWorkspaces = await WorkspaceModel.find({
    $or: [{ code: { $exists: false } }, { code: null }, { code: '' }]
  }).exec();

  for (const workspace of missingCodeWorkspaces) {
    workspace.code = undefined as unknown as string;
    await workspace.save();
    console.log(`[MIGRATION] Generated missing workspace code for workspace ${workspace.id}`);
  }
}

// Drop stale/conflicting indexes left over from old schema versions
async function dropStaleIndexes(): Promise<void> {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    // Drop stale indexes on 'workspaces' collection
    try {
      await db.collection('workspaces').dropIndex('gateUsername_1');
      console.log('[MIGRATION] Dropped stale index: workspaces.gateUsername_1');
    } catch (_) {
      // Index doesn't exist, that's fine
    }

  } catch (err) {
    console.warn('[MIGRATION] dropStaleIndexes encountered an error:', err);
  }
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI!;
  const maxRetries = 5;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      console.log(`[DATABASE INFO] Connecting to MongoDB (Attempt ${attempt}/${maxRetries})...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log('[DATABASE SUCCESS] MongoDB connected successfully.');
      
      // Drop stale/conflicting indexes from old schema
      await dropStaleIndexes();
      await ensureWorkspaceCodes();
      await WorkspaceModel.syncIndexes();
      
      // Run automatic migration from db.json
      await runMigration();

      // Initialize AI Model Manager & Engines
      await AiModelManager.initialize();
      return;
    } catch (err) {
      console.error(`[DATABASE ERROR] MongoDB connection attempt ${attempt} failed:`, err);
      if (attempt === maxRetries) {
        throw err;
      }
      attempt++;
      const delayMs = Math.min(30000, 1000 * Math.pow(2, attempt - 2));
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

// Graceful Shutdown Handler
export const disconnectDB = async () => {
  try {
    console.log(`[DATABASE INFO] Closing database connection...`);
    await mongoose.connection.close();
    console.log('[DATABASE SUCCESS] Mongoose connection closed successfully.');
  } catch (err) {
    console.error('[DATABASE ERROR] Error during database disconnect:', err);
    throw err;
  }
};

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
    role: 'admin' | 'user' | 'operator' | 'supervisor' | 'officer'
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
      // Find user to get the mongoose ObjectId
      const user = await UserModel.findOne({ id: creatorId });
      if (!user) {
        throw new Error(`User dengan ID ${creatorId} tidak ditemukan.`);
      }

      // Find max integer id for legacy auto-increment compatibility
      const lastReport = await ReportModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastReport ? lastReport.id + 1 : 1;

      const newReport = await ReportModel.create({
        ...report,
        id: nextId,
        userId: user._id,
        timestamp: new Date(),
        adminStatus: 'MENUNGGU',
        adminNotes: '',
        sla: {
          detectedAt: new Date(),
        }
      });

      return (newReport as any).toJSON();
    } catch (err) {
      console.error('[DATABASE ERROR] create report failed:', err);
      throw err;
    }
  }

  public static async updateVerification(
    id: number, 
    status: 'VALID' | 'TIDAK_VALID' | 'MENUNGGU', 
    notes: string,
    assignedOfficer?: string,
    progressStatus?: 'PENDING' | 'PROSES' | 'SELESAI' | 'CLOSED' | 'DITOLAK'
  ): Promise<IReport | null> {
    const existingReport = await ReportModel.findOne({ id }).exec();
    if (!existingReport) return null;

    // GUARD 4: State Transition Lock — Decisions once finalized (VALID / TIDAK_VALID) cannot be altered
    if (existingReport.adminStatus !== 'MENUNGGU') {
      const err: any = new Error(`VALIDATION_DECISION_LOCKED: Status validasi (${existingReport.adminStatus}) sudah final (${existingReport.adminStatus}) dan tidak dapat diubah.`);
      err.code = 'VALIDATION_DECISION_LOCKED';
      throw err;
    }

    const verifiedAt = new Date();
    const updateFields: any = { adminStatus: status, adminNotes: notes, verifiedAt };
    if (assignedOfficer !== undefined) {
      updateFields.assignedOfficer = assignedOfficer;
    }
    if (progressStatus !== undefined) {
      updateFields.status = progressStatus;
    } else if (existingReport.status === 'NEW') {
      updateFields.status = 'PENDING';
    }

    const idempotencyKey = `REPORT_VALIDATED_TELEGRAM:${id}:v1`;

    if (status === 'VALID') {
      updateFields.telegramStatus = 'QUEUED';
    } else if (status === 'TIDAK_VALID') {
      updateFields.telegramStatus = 'NOT_ELIGIBLE';
    }

    const { OutboxEventModel } = require('./models/OutboxEvent');
    let session: mongoose.ClientSession | null = null;
    let updatedReport: IReport | null = null;

    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        updatedReport = await ReportModel.findOneAndUpdate(
          { id },
          updateFields,
          { new: true, session }
        ).lean();
        if (status === 'VALID') {

          // Idempotency check inside transaction
          const existingOutbox = await OutboxEventModel.findOne({ idempotencyKey }).session(session).exec();
          if (!existingOutbox) {
            await OutboxEventModel.create([{
              aggregateType: 'Report',
              aggregateId: String(id),
              eventType: 'REPORT_VALIDATED_TELEGRAM',
              idempotencyKey,
              payload: { reportId: id, location: existingReport.location },
              status: 'PENDING',
              retryCount: 0
            }], { session });
          }
        }
      });
    } catch (sessionErr: any) {
      console.error('[DATABASE TRANSACTION ERROR] updateVerification transaction failed:', sessionErr.message);
      const err: any = new Error(`TRANSACTION_REQUIRED_FOR_VALIDATION: Transaction failed or MongoDB Replica Set is required for validation outbox. (${sessionErr.message})`);
      err.code = 'TRANSACTION_REQUIRED_FOR_VALIDATION';
      throw err;
    } finally {
      if (session) {
        try { await session.endSession(); } catch (_) {}
      }
    }

    // Trigger OutboxWorker processing immediately (durable worker processes queue)
    if (status === 'VALID') {
      const { OutboxWorker } = require('../notifications/OutboxWorker');
      setImmediate(() => OutboxWorker.processQueue().catch(() => {}));
    }

    return updatedReport;
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
    userContext: { id: number; role: 'admin' | 'user' | 'operator' | 'supervisor' | 'officer' },
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
          { identity: regex },
          { additionalNotes: regex },
          { 'uploaderInfo.username': regex },
          { 'uploaderInfo.name': regex }
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
  public static async getStats(userContext?: { id: number; role: 'admin' | 'user' | 'operator' | 'supervisor' | 'officer' }) {
    try {
      const matchQuery: any = {};

      // Execute counts concurrently
      const [total, valid, cancelled, pending] = await Promise.all([
        ReportModel.countDocuments(matchQuery),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'TIDAK_VALID' }),
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

      const comment = report.comments.find(c => c._id.toString() === commentId);
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

      const comment = report.comments.find(c => c._id.toString() === commentId);
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
      if (payload.model !== undefined) (cctv as any).model = payload.model;
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

  public static encryptCctvPassword(text: string): string {
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
      const encryptedText = parts.join(':');
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
