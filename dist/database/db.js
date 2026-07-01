"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = exports.DEFAULT_ADMIN_PASSWORD = exports.DEFAULT_ADMIN_USERNAME = exports.DEFAULT_DESA_NAME = void 0;
exports.connectDB = connectDB;
exports.seedDefaultAdmin = seedDefaultAdmin;
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const otplib_1 = require("otplib");
const migration_1 = require("./migration");
const User_1 = require("./models/User");
const Report_1 = require("./models/Report");
const Desa_1 = require("./models/Desa");
exports.DEFAULT_DESA_NAME = 'Desa EYECO';
exports.DEFAULT_ADMIN_USERNAME = 'admin_eyeco';
exports.DEFAULT_ADMIN_PASSWORD = 'admin123';
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
            // Seed default desa & admin account for development/testing
            await seedDefaultAdmin();
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
const gracefulExit = async (signal) => {
    try {
        console.log(`[DATABASE INFO] Closing database connection due to ${signal}...`);
        await mongoose_1.default.connection.close();
        console.log('[DATABASE SUCCESS] Mongoose connection closed successfully.');
        process.exit(0);
    }
    catch (err) {
        console.error('[DATABASE ERROR] Error during database disconnect:', err);
        process.exit(1);
    }
};
process.on('SIGINT', () => gracefulExit('SIGINT'));
process.on('SIGTERM', () => gracefulExit('SIGTERM'));
async function seedDefaultAdmin() {
    try {
        let desa = await Desa_1.DesaModel.findOne({ nama: exports.DEFAULT_DESA_NAME }).exec();
        if (!desa) {
            desa = await Desa_1.DesaModel.create({ nama: exports.DEFAULT_DESA_NAME });
            console.log(`[DATABASE INFO] Default desa "${exports.DEFAULT_DESA_NAME}" created.`);
        }
        const existingAdmin = await User_1.UserModel.findOne({ username: exports.DEFAULT_ADMIN_USERNAME }).lean();
        if (existingAdmin) {
            console.log(`[DATABASE INFO] Default admin "${exports.DEFAULT_ADMIN_USERNAME}" already exists, skipping seed.`);
            return;
        }
        const lastUser = await User_1.UserModel.findOne().sort({ id: -1 }).exec();
        const nextId = lastUser ? lastUser.id + 1 : 1;
        await User_1.UserModel.create({
            id: nextId,
            username: exports.DEFAULT_ADMIN_USERNAME,
            passwordHash: DatabaseManager.hashPassword(exports.DEFAULT_ADMIN_PASSWORD),
            role: 'admin',
            desaId: desa._id,
            twoFactorSecret: '',
            is2faEnabled: false,
        });
        console.log(`[DATABASE INFO] Default admin seeded → username: "${exports.DEFAULT_ADMIN_USERNAME}", password: "${exports.DEFAULT_ADMIN_PASSWORD}", role: admin`);
    }
    catch (err) {
        console.error('[DATABASE ERROR] seedDefaultAdmin failed:', err);
    }
}
class DatabaseManager {
    // Hashing utility remains SHA-256 for backward compatibility with existing hashed passwords
    static hashPassword(password) {
        return crypto_1.default.createHash('sha256').update(password).digest('hex');
    }
    // --- DESA METHODS ---
    static async createDesa(nama) {
        try {
            return await Desa_1.DesaModel.create({ nama });
        }
        catch (err) {
            console.error('[DATABASE ERROR] createDesa failed:', err);
            throw err;
        }
    }
    static async findDesaByName(nama) {
        try {
            return await Desa_1.DesaModel.findOne({ nama: new RegExp(`^${nama}$`, 'i') }).exec();
        }
        catch (err) {
            console.error('[DATABASE ERROR] findDesaByName failed:', err);
            throw err;
        }
    }
    static async getAllDesa() {
        try {
            return await Desa_1.DesaModel.find().lean().exec();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getAllDesa failed:', err);
            throw err;
        }
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
    static async createUser(username, passwordPlain, role, desaId) {
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
                role: role,
                desaId: new mongoose_1.default.Types.ObjectId(desaId)
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
                const safeUser = user.toObject();
                delete safeUser.passwordHash;
                delete safeUser.twoFactorSecret;
                return safeUser;
            }
            return null;
        }
        catch (err) {
            console.error('[DATABASE ERROR] authenticateUser failed:', err);
            throw err;
        }
    }
    static async getUserWith2FASecret(userId) {
        try {
            return await User_1.UserModel.findOne({ id: userId })
                .select('+twoFactorSecret')
                .lean()
                .exec();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getUserWith2FASecret failed:', err);
            throw err;
        }
    }
    static async verify2FAToken(userId, token) {
        try {
            const user = await this.getUserWith2FASecret(userId);
            if (!user || !user.is2faEnabled || !user.twoFactorSecret) {
                return false;
            }
            const result = await (0, otplib_1.verify)({ secret: user.twoFactorSecret, token });
            return result.valid;
        }
        catch (err) {
            console.error('[DATABASE ERROR] verify2FAToken failed:', err);
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
    static async create(report, creatorId, desaId) {
        try {
            // Find max integer id for legacy auto-increment compatibility
            const lastReport = await Report_1.ReportModel.findOne().sort({ id: -1 }).exec();
            const nextId = lastReport ? lastReport.id + 1 : 1;
            const newReport = await Report_1.ReportModel.create({
                ...report,
                id: nextId,
                userId: creatorId,
                desaId: new mongoose_1.default.Types.ObjectId(desaId),
                timestamp: new Date(),
                adminStatus: 'MENUNGGU',
                adminNotes: '',
            });
            return newReport.toJSON();
        }
        catch (err) {
            console.error('[DATABASE ERROR] create report failed:', err);
            throw err;
        }
    }
    static async updateVerification(id, status, notes) {
        try {
            const updated = await Report_1.ReportModel.findOneAndUpdate({ id }, { adminStatus: status, adminNotes: notes }, { new: true }).lean();
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
            // Filter by desaId for multi-tenancy
            query.desaId = new mongoose_1.default.Types.ObjectId(userContext.desaId);
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
            if (userContext && userContext.desaId) {
                matchQuery.desaId = new mongoose_1.default.Types.ObjectId(userContext.desaId);
            }
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
}
exports.DatabaseManager = DatabaseManager;
