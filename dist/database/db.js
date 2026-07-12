"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = exports.WorkspaceModel = exports.SystemAuditLogModel = exports.OutboxEventModel = exports.NotificationModel = exports.ResolutionModel = exports.AssignmentModel = exports.TimelineEventModel = void 0;
exports.connectDB = connectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const migration_1 = require("./migration");
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
class DatabaseManager {
    // Hashing utility remains SHA-256 for backward compatibility with existing hashed passwords
    static hashPassword(password) {
        return crypto_1.default.createHash('sha256').update(password).digest('hex');
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
            const encryptedText = Buffer.from(parts.join(':'), 'hex');
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', encryptionKey, iv);
            let decrypted = decipher.update(encryptedText).toString('utf8');
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
