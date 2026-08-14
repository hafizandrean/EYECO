"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = exports.disconnectDB = exports.NewsModel = exports.WorkspaceModel = exports.CameraEventModel = exports.AiMetricModel = exports.CameraHealthLogModel = exports.AiVerificationStateModel = exports.AiEvidenceModel = exports.AiDetectionModel = exports.AiModelModel = exports.SystemSettingsModel = exports.SystemAuditLogModel = exports.OutboxEventModel = exports.NotificationModel = exports.ResolutionModel = exports.AssignmentModel = exports.TimelineEventModel = exports.ReportModel = exports.UserModel = exports.CctvModel = void 0;
exports.connectDB = connectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const migration_1 = require("./migration");
const AiModelManager_1 = require("../cctv/services/AiModelManager");
const User_1 = require("./models/User");
Object.defineProperty(exports, "UserModel", { enumerable: true, get: function () { return User_1.UserModel; } });
const Report_1 = require("./models/Report");
Object.defineProperty(exports, "ReportModel", { enumerable: true, get: function () { return Report_1.ReportModel; } });
const Cctv_1 = require("./models/Cctv");
Object.defineProperty(exports, "CctvModel", { enumerable: true, get: function () { return Cctv_1.CctvModel; } });
const TimelineEvent_1 = require("./models/TimelineEvent");
Object.defineProperty(exports, "TimelineEventModel", { enumerable: true, get: function () { return TimelineEvent_1.TimelineEventModel; } });
const Assignment_1 = require("./models/Assignment");
Object.defineProperty(exports, "AssignmentModel", { enumerable: true, get: function () { return Assignment_1.AssignmentModel; } });
const Resolution_1 = require("./models/Resolution");
Object.defineProperty(exports, "ResolutionModel", { enumerable: true, get: function () { return Resolution_1.ResolutionModel; } });
const Notification_1 = require("./models/Notification");
Object.defineProperty(exports, "NotificationModel", { enumerable: true, get: function () { return Notification_1.NotificationModel; } });
const OutboxEvent_1 = require("./models/OutboxEvent");
Object.defineProperty(exports, "OutboxEventModel", { enumerable: true, get: function () { return OutboxEvent_1.OutboxEventModel; } });
const SystemAuditLog_1 = require("./models/SystemAuditLog");
Object.defineProperty(exports, "SystemAuditLogModel", { enumerable: true, get: function () { return SystemAuditLog_1.SystemAuditLogModel; } });
const Workspace_1 = require("./models/Workspace");
Object.defineProperty(exports, "WorkspaceModel", { enumerable: true, get: function () { return Workspace_1.WorkspaceModel; } });
const SystemSettings_1 = require("./models/SystemSettings");
Object.defineProperty(exports, "SystemSettingsModel", { enumerable: true, get: function () { return SystemSettings_1.SystemSettingsModel; } });
const News_1 = require("./models/News");
Object.defineProperty(exports, "NewsModel", { enumerable: true, get: function () { return News_1.NewsModel; } });
const AiModel_1 = require("./models/AiModel");
Object.defineProperty(exports, "AiModelModel", { enumerable: true, get: function () { return AiModel_1.AiModelModel; } });
const AiDetection_1 = require("./models/AiDetection");
Object.defineProperty(exports, "AiDetectionModel", { enumerable: true, get: function () { return AiDetection_1.AiDetectionModel; } });
const AiEvidence_1 = require("./models/AiEvidence");
Object.defineProperty(exports, "AiEvidenceModel", { enumerable: true, get: function () { return AiEvidence_1.AiEvidenceModel; } });
const AiVerificationState_1 = require("./models/AiVerificationState");
Object.defineProperty(exports, "AiVerificationStateModel", { enumerable: true, get: function () { return AiVerificationState_1.AiVerificationStateModel; } });
const CameraHealthLog_1 = require("./models/CameraHealthLog");
Object.defineProperty(exports, "CameraHealthLogModel", { enumerable: true, get: function () { return CameraHealthLog_1.CameraHealthLogModel; } });
const AiMetric_1 = require("./models/AiMetric");
Object.defineProperty(exports, "AiMetricModel", { enumerable: true, get: function () { return AiMetric_1.AiMetricModel; } });
const CameraEvent_1 = require("./models/CameraEvent");
Object.defineProperty(exports, "CameraEventModel", { enumerable: true, get: function () { return CameraEvent_1.CameraEventModel; } });
dotenv_1.default.config();
// Validate Environment Variables
if (!process.env.MONGODB_URI) {
    console.error('CRITICAL ERROR: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
}
if (!process.env.PORT) {
    console.warn('[WARNING] PORT is not defined in environment variables. Defaulting to 8000.');
}
async function ensureWorkspaceCodes() {
    const missingCodeWorkspaces = await Workspace_1.WorkspaceModel.find({
        $or: [{ code: { $exists: false } }, { code: null }, { code: '' }]
    }).exec();
    for (const workspace of missingCodeWorkspaces) {
        workspace.code = undefined;
        await workspace.save();
        console.log(`[MIGRATION] Generated missing workspace code for workspace ${workspace.id}`);
    }
}
// Drop stale/conflicting indexes left over from old schema versions
async function dropStaleIndexes() {
    try {
        const db = mongoose_1.default.connection.db;
        if (!db)
            return;
        // Drop stale indexes on 'workspaces' collection
        try {
            await db.collection('workspaces').dropIndex('gateUsername_1');
            console.log('[MIGRATION] Dropped stale index: workspaces.gateUsername_1');
        }
        catch (_) {
            // Index doesn't exist, that's fine
        }
    }
    catch (err) {
        console.warn('[MIGRATION] dropStaleIndexes encountered an error:', err);
    }
}
async function connectDB() {
    const uri = process.env.MONGODB_URI;
    const maxRetries = 5;
    let attempt = 1;
    while (attempt <= maxRetries) {
        try {
            console.log(`[DATABASE INFO] Connecting to MongoDB (Attempt ${attempt}/${maxRetries})...`);
            await mongoose_1.default.connect(uri, {
                serverSelectionTimeoutMS: 5000,
            });
            console.log('[DATABASE SUCCESS] MongoDB connected successfully.');
            // Drop stale/conflicting indexes from old schema
            await dropStaleIndexes();
            await ensureWorkspaceCodes();
            await Workspace_1.WorkspaceModel.syncIndexes();
            // Run automatic migration from db.json
            await (0, migration_1.runMigration)();
            // Initialize AI Model Manager & Engines
            await AiModelManager_1.AiModelManager.initialize();
            return;
        }
        catch (err) {
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
const disconnectDB = async () => {
    try {
        console.log(`[DATABASE INFO] Closing database connection...`);
        await mongoose_1.default.connection.close();
        console.log('[DATABASE SUCCESS] Mongoose connection closed successfully.');
    }
    catch (err) {
        console.error('[DATABASE ERROR] Error during database disconnect:', err);
        throw err;
    }
};
exports.disconnectDB = disconnectDB;
class DatabaseManager {
    // Hashing utility remains SHA-256 for backward compatibility with existing hashed passwords
    static hashPassword(password) {
        return crypto_1.default.createHash('sha256').update(password).digest('hex');
    }
    // --- USER METHODS ---
    static async findUserByUsername(username) {
        try {
            return await User_1.UserModel.findOne({ username: username.toLowerCase() }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] findUserByUsername failed:', err);
            throw err;
        }
    }
    static async getUserById(id) {
        try {
            return await User_1.UserModel.findOne({ id }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getUserById failed:', err);
            throw err;
        }
    }
    static async createUser(username, passwordPlain, role) {
        try {
            // Case-insensitive duplicate check (username is stored in lowercase)
            const lowercaseUsername = username.toLowerCase();
            const exists = await User_1.UserModel.findOne({ username: lowercaseUsername }).lean();
            if (exists)
                return null;
            // Find max integer id for legacy auto-increment compatibility
            const lastUser = await User_1.UserModel.findOne().sort({ id: -1 }).exec();
            const nextId = lastUser ? lastUser.id + 1 : 1;
            const newUser = await User_1.UserModel.create({
                id: nextId,
                username: lowercaseUsername,
                passwordHash: this.hashPassword(passwordPlain),
                role: role
            });
            return newUser.toJSON(); // Automatically strips passwordHash via schema toJSON transform
        }
        catch (err) {
            console.error('[DATABASE ERROR] createUser failed:', err);
            throw err;
        }
    }
    static async authenticateUser(username, passwordPlain) {
        try {
            // Query user and explicitly select passwordHash since it is select: false
            const user = await User_1.UserModel.findOne({ username: username.toLowerCase() }).select('+passwordHash').exec();
            if (!user)
                return null;
            const inputHash = this.hashPassword(passwordPlain);
            if (user.passwordHash === inputHash) {
                return user.toJSON(); // toJSON strips passwordHash
            }
            return null;
        }
        catch (err) {
            console.error('[DATABASE ERROR] authenticateUser failed:', err);
            throw err;
        }
    }
    // --- REPORT METHODS ---
    static async getAll() {
        try {
            return await Report_1.ReportModel.find().sort({ timestamp: -1 }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getAll reports failed:', err);
            throw err;
        }
    }
    static async getById(id) {
        try {
            return await Report_1.ReportModel.findOne({ id }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getById report failed:', err);
            throw err;
        }
    }
    static async create(report, creatorId) {
        try {
            // Find user to get the mongoose ObjectId
            const user = await User_1.UserModel.findOne({ id: creatorId });
            if (!user) {
                throw new Error(`User dengan ID ${creatorId} tidak ditemukan.`);
            }
            // Find max integer id for legacy auto-increment compatibility
            const lastReport = await Report_1.ReportModel.findOne().sort({ id: -1 }).exec();
            const nextId = lastReport ? lastReport.id + 1 : 1;
            const newReport = await Report_1.ReportModel.create({
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
            return newReport.toJSON();
        }
        catch (err) {
            console.error('[DATABASE ERROR] create report failed:', err);
            throw err;
        }
    }
    static async updateVerification(id, status, notes, assignedOfficer, progressStatus) {
        const existingReport = await Report_1.ReportModel.findOne({ id }).exec();
        if (!existingReport)
            return null;
        // GUARD 4: State Transition Lock — Decisions once finalized (VALID / TIDAK_VALID) cannot be altered
        if (existingReport.adminStatus !== 'MENUNGGU') {
            const err = new Error(`VALIDATION_DECISION_LOCKED: Status validasi (${existingReport.adminStatus}) sudah final (${existingReport.adminStatus}) dan tidak dapat diubah.`);
            err.code = 'VALIDATION_DECISION_LOCKED';
            throw err;
        }
        const verifiedAt = new Date();
        const updateFields = { adminStatus: status, adminNotes: notes, verifiedAt };
        if (assignedOfficer !== undefined) {
            updateFields.assignedOfficer = assignedOfficer;
        }
        if (progressStatus !== undefined) {
            updateFields.status = progressStatus;
        }
        else if (existingReport.status === 'NEW') {
            updateFields.status = 'PENDING';
        }
        const idempotencyKey = `REPORT_VALIDATED_TELEGRAM:${id}:v1`;
        if (status === 'VALID') {
            updateFields.telegramStatus = 'QUEUED';
        }
        else if (status === 'TIDAK_VALID') {
            updateFields.telegramStatus = 'NOT_ELIGIBLE';
        }
        const { OutboxEventModel } = require('./models/OutboxEvent');
        let session = null;
        let updatedReport = null;
        try {
            session = await mongoose_1.default.startSession();
            await session.withTransaction(async () => {
                updatedReport = await Report_1.ReportModel.findOneAndUpdate({ id }, updateFields, { new: true, session }).lean();
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
        }
        catch (sessionErr) {
            console.error('[DATABASE TRANSACTION ERROR] updateVerification transaction failed:', sessionErr.message);
            const err = new Error(`TRANSACTION_REQUIRED_FOR_VALIDATION: Transaction failed or MongoDB Replica Set is required for validation outbox. (${sessionErr.message})`);
            err.code = 'TRANSACTION_REQUIRED_FOR_VALIDATION';
            throw err;
        }
        finally {
            if (session) {
                try {
                    await session.endSession();
                }
                catch (_) { }
            }
        }
        // Trigger OutboxWorker processing immediately (durable worker processes queue)
        if (status === 'VALID') {
            const { OutboxWorker } = require('../notifications/OutboxWorker');
            setImmediate(() => OutboxWorker.processQueue().catch(() => { }));
        }
        return updatedReport;
    }
    // Flexible database-level pagination, sorting, and filtering
    static async getFiltered(filters, userContext, page, limit) {
        try {
            const query = {};
            // Filter by date
            if (filters.date) {
                const start = new Date(filters.date);
                start.setHours(0, 0, 0, 0);
                const end = new Date(filters.date);
                end.setHours(23, 59, 59, 999);
                query.timestamp = { $gte: start, $lte: end };
            }
            else if (filters.timeRange && filters.timeRange !== 'semua') {
                const now = new Date();
                if (filters.timeRange === 'hari_ini') {
                    const start = new Date(now);
                    start.setHours(0, 0, 0, 0);
                    query.timestamp = { $gte: start };
                }
                else if (filters.timeRange === 'minggu_ini') {
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
            const q = Report_1.ReportModel.find(query).sort({ timestamp: -1 });
            if (page !== undefined && limit !== undefined) {
                const skip = (page - 1) * limit;
                const [reports, total] = await Promise.all([
                    q.skip(skip).limit(limit).lean().exec(),
                    Report_1.ReportModel.countDocuments(query).exec()
                ]);
                return { reports, total };
            }
            else {
                return await q.lean().exec();
            }
        }
        catch (err) {
            console.error('[DATABASE ERROR] getFiltered failed:', err);
            throw err;
        }
    }
    // Optimize statistics queries using MongoDB aggregation pipeline
    static async getStats(userContext) {
        try {
            const matchQuery = {};
            // Execute counts concurrently
            const [total, valid, cancelled, pending] = await Promise.all([
                Report_1.ReportModel.countDocuments(matchQuery),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'TIDAK_VALID' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' })
            ]);
            // Determine most vulnerable location using aggregation (with threat aiStatus TINGGI or SEDANG)
            const vulnGroup = await Report_1.ReportModel.aggregate([
                { $match: { ...matchQuery, aiStatus: { $in: ['TINGGI', 'SEDANG'] } } },
                { $group: { _id: '$location', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]);
            let mostVulnerable = vulnGroup.length > 0 ? vulnGroup[0]._id : '-';
            // Fallback if no high/medium threat reports are found, grab the most frequent overall location
            if (total > 0 && mostVulnerable === '-') {
                const overallGroup = await Report_1.ReportModel.aggregate([
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
        }
        catch (err) {
            console.error('[DATABASE ERROR] getStats failed:', err);
            throw err;
        }
    }
    // --- COMMENT METHODS ---
    static async addComment(reportId, userId, text) {
        try {
            // 1. Sanitize HTML
            const sanitized = text.replace(/<[^>]*>/g, '').trim();
            // 2. Validate length
            if (sanitized.length < 2 || sanitized.length > 500) {
                throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
            }
            const report = await Report_1.ReportModel.findOne({ id: reportId });
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
            report.comments.push(commentData);
            await report.save();
            // Return the newly created comment (the last one in the array)
            return report.comments[report.comments.length - 1];
        }
        catch (err) {
            console.error('[DATABASE ERROR] addComment failed:', err);
            throw err;
        }
    }
    static async deleteComment(reportId, commentId, userId, isAdmin) {
        try {
            const report = await Report_1.ReportModel.findOne({ id: reportId });
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
        }
        catch (err) {
            console.error('[DATABASE ERROR] deleteComment failed:', err);
            throw err;
        }
    }
    static async toggleLikeComment(reportId, commentId, userId) {
        try {
            const report = await Report_1.ReportModel.findOne({ id: reportId });
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
            }
            else {
                // Like: add userId
                comment.likedBy.push(userId);
            }
            await report.save();
            return comment;
        }
        catch (err) {
            console.error('[DATABASE ERROR] toggleLikeComment failed:', err);
            throw err;
        }
    }
    // --- CCTV METHODS ---
    static async getAllCctv() {
        try {
            return await Cctv_1.CctvModel.find({}).sort({ id: 1 }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getAllCctv failed:', err);
            throw err;
        }
    }
    static async getCctvById(id) {
        try {
            return await Cctv_1.CctvModel.findOne({ id }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getCctvById failed:', err);
            throw err;
        }
    }
    static async addCctv(payload, userId) {
        try {
            if (!payload.name || !payload.location || !payload.protocol || !payload.streamUrl) {
                throw new Error('Semua field wajib diisi.');
            }
            // Generate Auto-increment ID
            const maxCctv = await Cctv_1.CctvModel.findOne({}).sort({ id: -1 });
            const nextId = maxCctv ? maxCctv.id + 1 : 1;
            // Encrypt password if provided
            let encryptedPassword = '';
            if (payload.password) {
                encryptedPassword = DatabaseManager.encryptCctvPassword(payload.password);
            }
            const newCctv = new Cctv_1.CctvModel({
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
        }
        catch (err) {
            console.error('[DATABASE ERROR] addCctv failed:', err);
            throw err;
        }
    }
    static async updateCctv(id, payload) {
        try {
            const cctv = await Cctv_1.CctvModel.findOne({ id });
            if (!cctv) {
                throw new Error('CCTV tidak ditemukan.');
            }
            if (payload.name)
                cctv.name = payload.name;
            if (payload.location)
                cctv.location = payload.location;
            if (payload.description !== undefined)
                cctv.description = payload.description;
            if (payload.vendor)
                cctv.vendor = payload.vendor;
            if (payload.model !== undefined)
                cctv.model = payload.model;
            if (payload.protocol)
                cctv.protocol = payload.protocol;
            if (payload.mediaType)
                cctv.mediaType = payload.mediaType;
            if (payload.streamUrl) {
                cctv.streamUrl = payload.streamUrl;
                cctv.playUrl = payload.playUrl || payload.streamUrl;
            }
            if (payload.username !== undefined)
                cctv.username = payload.username;
            if (payload.password) {
                cctv.password = DatabaseManager.encryptCctvPassword(payload.password);
            }
            if (payload.capabilities)
                cctv.capabilities = payload.capabilities;
            if (payload.isActive !== undefined)
                cctv.isActive = payload.isActive;
            await cctv.save();
            return cctv;
        }
        catch (err) {
            console.error('[DATABASE ERROR] updateCctv failed:', err);
            throw err;
        }
    }
    static async deleteCctv(id) {
        try {
            const cctv = await Cctv_1.CctvModel.findOne({ id });
            if (!cctv) {
                throw new Error('CCTV tidak ditemukan.');
            }
            if (cctv.isDefault) {
                throw new Error('Kamera bawaan sistem tidak boleh dihapus.');
            }
            await Cctv_1.CctvModel.deleteOne({ id });
            return true;
        }
        catch (err) {
            console.error('[DATABASE ERROR] deleteCctv failed:', err);
            throw err;
        }
    }
    static async updateCctvStatus(id, status, health) {
        try {
            const updatePayload = {
                status,
                lastHeartbeat: new Date()
            };
            if (status === 'ONLINE') {
                updatePayload.lastConnected = new Date();
            }
            if (health) {
                updatePayload.health = health;
            }
            await Cctv_1.CctvModel.updateOne({ id }, { $set: updatePayload });
        }
        catch (err) {
            console.error('[DATABASE ERROR] updateCctvStatus failed:', err);
        }
    }
    // --- ENCRYPTION HELPERS ---
    static encryptCctvPassword(text) {
        try {
            const encryptionKey = crypto_1.default.scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
            const iv = crypto_1.default.randomBytes(16);
            const cipher = crypto_1.default.createCipheriv('aes-256-cbc', encryptionKey, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return iv.toString('hex') + ':' + encrypted;
        }
        catch (err) {
            console.error('[DATABASE ERROR] Encryption failed:', err);
            return '';
        }
    }
    static decryptCctvPassword(text) {
        try {
            if (!text)
                return '';
            const encryptionKey = crypto_1.default.scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
            const parts = text.split(':');
            const iv = Buffer.from(parts.shift(), 'hex');
            const encryptedText = parts.join(':');
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', encryptionKey, iv);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        catch (err) {
            console.error('[DATABASE ERROR] Decryption failed:', err);
            return '';
        }
    }
}
exports.DatabaseManager = DatabaseManager;
