"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigration = runMigration;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = require("./models/User");
const Report_1 = require("./models/Report");
const Desa_1 = require("./models/Desa");
const DB_PATH = path_1.default.join(__dirname, 'db.json');
const BACKUP_PATH = path_1.default.join(__dirname, 'db.backup.json');
async function runMigration() {
    if (!fs_1.default.existsSync(DB_PATH)) {
        console.log('[MIGRATION INFO] db.json not found, skipping migration.');
        return;
    }
    let rawData;
    try {
        rawData = fs_1.default.readFileSync(DB_PATH, 'utf-8');
    }
    catch (err) {
        console.error('[MIGRATION ERROR] Failed to read db.json:', err);
        return;
    }
    let dbData;
    try {
        dbData = JSON.parse(rawData);
    }
    catch (err) {
        console.error('[MIGRATION ERROR] Failed to parse db.json:', err);
        return;
    }
    const usersToMigrate = dbData.users || [];
    const reportsToMigrate = dbData.reports || [];
    if (usersToMigrate.length === 0 && reportsToMigrate.length === 0) {
        console.log('[MIGRATION INFO] db.json is empty, skipping migration.');
        return;
    }
    // Backup db.json
    try {
        fs_1.default.writeFileSync(BACKUP_PATH, rawData, 'utf-8');
        console.log(`[MIGRATION INFO] Backup created successfully at ${BACKUP_PATH}`);
    }
    catch (err) {
        console.error('[MIGRATION ERROR] Failed to create backup, aborting migration for safety:', err);
        return;
    }
    try {
        const userCount = await User_1.UserModel.countDocuments();
        const reportCount = await Report_1.ReportModel.countDocuments();
        if (userCount > 0 || reportCount > 0) {
            console.log('[MIGRATION INFO] Database already has data. Skipping migration to prevent overwrite/duplicates.');
            return;
        }
    }
    catch (err) {
        console.error('[MIGRATION ERROR] Failed to query existing documents count:', err);
        return;
    }
    console.log(`[MIGRATION INFO] Found ${usersToMigrate.length} users and ${reportsToMigrate.length} reports in db.json to migrate.`);
    // Create default Desa for legacy data migration
    let defaultDesa = await Desa_1.DesaModel.findOne({ nama: 'Desa Default' });
    if (!defaultDesa) {
        defaultDesa = await Desa_1.DesaModel.create({ nama: 'Desa Default' });
        console.log('[MIGRATION INFO] Created default Desa for legacy data.');
    }
    const defaultDesaId = defaultDesa._id;
    // Prepare docs
    const userDocs = usersToMigrate.map(u => ({
        id: u.id,
        username: u.username.toLowerCase(),
        passwordHash: u.passwordHash,
        role: u.role === 'admin' ? 'admin' : 'user', // Map roles properly
        desaId: defaultDesaId
    }));
    const reportDocs = reportsToMigrate.map(r => ({
        id: r.id,
        userId: r.userId,
        desaId: defaultDesaId,
        location: r.location,
        timestamp: new Date(r.timestamp),
        aiStatus: r.aiStatus,
        aiConfidence: r.aiConfidence,
        adminStatus: r.adminStatus,
        image: r.image,
        identity: r.identity,
        sourceType: r.sourceType,
        additionalNotes: r.additionalNotes,
        adminNotes: r.adminNotes,
        boundingBoxes: r.boundingBoxes || []
    }));
    // Attempt transaction
    let session = null;
    try {
        session = await mongoose_1.default.startSession();
        session.startTransaction();
        if (userDocs.length > 0) {
            await User_1.UserModel.insertMany(userDocs, { session });
        }
        if (reportDocs.length > 0) {
            await Report_1.ReportModel.insertMany(reportDocs, { session });
        }
        await session.commitTransaction();
        console.log(`[MIGRATION SUCCESS] Transactional migration succeeded. Migrated ${userDocs.length} users and ${reportDocs.length} reports.`);
    }
    catch (err) {
        if (session) {
            try {
                await session.abortTransaction();
            }
            catch (abortErr) {
                // Ignore session abort error if transaction was never started/failed early
            }
        }
        // Check if it's transaction/session error (like standalone MongoDB deployment)
        const isSessionError = err.message && (err.message.includes('transaction') ||
            err.message.includes('session') ||
            err.codeName === 'InvalidOptions');
        if (isSessionError) {
            console.warn('[MIGRATION WARNING] Sessions/Transactions not supported by this MongoDB setup. Falling back to non-transactional migration.');
            try {
                if (userDocs.length > 0) {
                    await User_1.UserModel.insertMany(userDocs);
                }
                if (reportDocs.length > 0) {
                    await Report_1.ReportModel.insertMany(reportDocs);
                }
                console.log(`[MIGRATION SUCCESS] Fallback migration succeeded. Migrated ${userDocs.length} users and ${reportDocs.length} reports.`);
            }
            catch (fallbackErr) {
                console.error('[MIGRATION ERROR] Fallback migration failed:', fallbackErr);
            }
        }
        else {
            console.error('[MIGRATION ERROR] Transactional migration failed:', err);
        }
    }
    finally {
        if (session) {
            session.endSession();
        }
    }
}
