"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = exports.disconnectDB = exports.AiConfigurationHistoryModel = exports.ModelDeploymentLogModel = exports.AiTrainingRunModel = exports.DatasetFeedbackModel = exports.AiSystemMetricsModel = exports.AiInferenceMetricsModel = exports.CameraEventModel = exports.AiMetricModel = exports.CameraHealthLogModel = exports.AiVerificationStateModel = exports.AiEvidenceModel = exports.AiDetectionModel = exports.AiModelModel = exports.SystemSettingsModel = exports.SystemAuditLogModel = exports.OutboxEventModel = exports.NotificationModel = exports.ResolutionModel = exports.AssignmentModel = exports.TimelineEventModel = exports.ReportModel = exports.UserModel = exports.CctvModel = void 0;
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
const SystemSettings_1 = require("./models/SystemSettings");
Object.defineProperty(exports, "SystemSettingsModel", { enumerable: true, get: function () { return SystemSettings_1.SystemSettingsModel; } });
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
const AiInferenceMetrics_1 = require("./models/AiInferenceMetrics");
Object.defineProperty(exports, "AiInferenceMetricsModel", { enumerable: true, get: function () { return AiInferenceMetrics_1.AiInferenceMetricsModel; } });
const AiSystemMetrics_1 = require("./models/AiSystemMetrics");
Object.defineProperty(exports, "AiSystemMetricsModel", { enumerable: true, get: function () { return AiSystemMetrics_1.AiSystemMetricsModel; } });
const DatasetFeedback_1 = require("./models/DatasetFeedback");
Object.defineProperty(exports, "DatasetFeedbackModel", { enumerable: true, get: function () { return DatasetFeedback_1.DatasetFeedbackModel; } });
const AiTrainingRun_1 = require("./models/AiTrainingRun");
Object.defineProperty(exports, "AiTrainingRunModel", { enumerable: true, get: function () { return AiTrainingRun_1.AiTrainingRunModel; } });
const ModelDeploymentLog_1 = require("./models/ModelDeploymentLog");
Object.defineProperty(exports, "ModelDeploymentLogModel", { enumerable: true, get: function () { return ModelDeploymentLog_1.ModelDeploymentLogModel; } });
const AiConfigurationHistory_1 = require("./models/AiConfigurationHistory");
Object.defineProperty(exports, "AiConfigurationHistoryModel", { enumerable: true, get: function () { return AiConfigurationHistory_1.AiConfigurationHistoryModel; } });
dotenv_1.default.config();
// Validate Environment Variables
if (!process.env.MONGODB_URI) {
    console.error('CRITICAL ERROR: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
}
if (!process.env.PORT) {
    console.warn('[WARNING] PORT is not defined in environment variables. Defaulting to 8000.');
}
async function connectDB() {
    const uri = process.env.MONGODB_URI;
    const maxRetries = 3;
    let attempt = 1;
    while (attempt <= maxRetries) {
        try {
            console.log(`[DATABASE INFO] Connecting to MongoDB (Attempt ${attempt}/${maxRetries})...`);
            await mongoose_1.default.connect(uri, {
                serverSelectionTimeoutMS: 5000,
            });
            console.log('[DATABASE SUCCESS] MongoDB connected successfully.');
            // Run automatic migration from db.json
            await (0, migration_1.runMigration)();
            // Seed default cameras if collection is completely empty
            await DatabaseManager.seedDefaultCamerasIfEmpty();
            // Initialize AI Model Manager & Engines
            await AiModelManager_1.AiModelManager.initialize();
            return;
        }
        catch (err) {
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
        try {
            const updateFields = { adminStatus: status, adminNotes: notes };
            if (assignedOfficer !== undefined) {
                updateFields.assignedOfficer = assignedOfficer;
            }
            if (progressStatus !== undefined) {
                updateFields.status = progressStatus;
            }
            else {
                if (status === 'VALID') {
                    updateFields.status = 'PROSES';
                }
                else if (status === 'DIABAIKAN') {
                    updateFields.status = 'DITOLAK';
                }
            }
            const updated = await Report_1.ReportModel.findOneAndUpdate({ id }, updateFields, { new: true }).lean();
            return updated;
        }
        catch (err) {
            console.error('[DATABASE ERROR] updateVerification failed:', err);
            throw err;
        }
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
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
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
    static async seedDefaultCamerasIfEmpty() {
        try {
            let count = await Cctv_1.CctvModel.countDocuments();
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
                        mediaType: 'Video',
                        streamUrl: '/uploads/orang buang sampah.mp4',
                        playUrl: '/uploads/orang buang sampah.mp4',
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
                        mediaType: 'Video',
                        streamUrl: '/uploads/orang buang sampah.mp4',
                        playUrl: '/uploads/orang buang sampah.mp4',
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
                        mediaType: 'Video',
                        streamUrl: '/uploads/orang buang sampah.mp4',
                        playUrl: '/uploads/orang buang sampah.mp4',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 90, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    }
                ];
                await Cctv_1.CctvModel.insertMany(defaultCameras);
                console.log('[DATABASE INFO] Default CCTV channels seeded successfully.');
            }
            else {
                // Force update channels 2, 3, 8 to use video format in existing installations for dynamic AI tracking demo!
                await Cctv_1.CctvModel.updateMany({ id: { $in: [2, 3, 8] } }, {
                    $set: {
                        mediaType: 'Video',
                        streamUrl: '/uploads/orang buang sampah.mp4',
                        playUrl: '/uploads/orang buang sampah.mp4'
                    }
                }).exec();
                console.log('[DATABASE INFO] Force-updated Channels 2, 3, 8 to Video format for AI tracking demo.');
            }
        }
        catch (err) {
            console.error('[DATABASE ERROR] seedDefaultCamerasIfEmpty failed:', err);
        }
    }
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
            // Allow deletion of default cameras for user workspace flexibility
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
