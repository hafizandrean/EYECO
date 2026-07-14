"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedSystemSettingsAndModels = seedSystemSettingsAndModels;
exports.runMigration = runMigration;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mongoose_1 = __importDefault(require("mongoose"));
const User_1 = require("./models/User");
const Report_1 = require("./models/Report");
const SystemSettings_1 = require("./models/SystemSettings");
const AiModel_1 = require("./models/AiModel");
const DB_PATH = path_1.default.join(__dirname, 'db.json');
const BACKUP_PATH = path_1.default.join(__dirname, 'db.backup.json');
async function seedSystemSettingsAndModels() {
    try {
        const settingsCount = await SystemSettings_1.SystemSettingsModel.countDocuments();
        if (settingsCount === 0) {
            await SystemSettings_1.SystemSettingsModel.insertMany([
                { key: 'ai.cooldown.minutes', value: 3, description: 'Masa cooldown (menit) setelah insiden ditutup agar tidak memicu insiden baru di lokasi yang sama.', updatedBy: 1 },
                { key: 'ai.verification.frames', value: 3, description: 'Jumlah frame positif berturut-turut yang dibutuhkan sebelum promosi insiden.', updatedBy: 1 },
                { key: 'ai.confidence.threshold', value: 0.7, description: 'Ambang batas nilai confidence (keyakinan) AI agar dapat dipromosikan (0.0 - 1.0).', updatedBy: 1 },
                {
                    key: 'ai.rules',
                    value: {
                        confidenceThreshold: 0.70,
                        verificationFrames: 3,
                        cooldownMinutes: 3,
                        duplicateRadiusMeters: 15,
                        duplicateTimeWindowSeconds: 300,
                        timelineUpdateIntervalSeconds: 120,
                        archiveAfterDays: 180
                    },
                    description: 'Blok aturan bisnis terpusat untuk mesin promosi AI.',
                    updatedBy: 1
                },
                { key: 'telegram.enabled', value: true, description: 'Status keaktifan pengiriman notifikasi Telegram.', updatedBy: 1 },
                { key: 'telegram.chatId', value: '-1003941703215', description: 'ID Chat / Grup penerima notifikasi Telegram.', updatedBy: 1 },
                {
                    key: 'scheduler.lock',
                    value: { locked: false, lockedBy: null, expiresAt: null },
                    description: 'Distributed lock untuk mencegah eksekusi paralel scheduler.',
                    updatedBy: 1
                }
            ]);
            console.log('[MIGRATION INFO] Seeded initial SystemSettings.');
        }
        else {
            const hasAiRules = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'ai.rules' });
            if (!hasAiRules) {
                await SystemSettings_1.SystemSettingsModel.create({
                    key: 'ai.rules',
                    value: {
                        confidenceThreshold: 0.70,
                        verificationFrames: 3,
                        cooldownMinutes: 3,
                        duplicateRadiusMeters: 15,
                        duplicateTimeWindowSeconds: 300,
                        timelineUpdateIntervalSeconds: 120,
                        archiveAfterDays: 180
                    },
                    description: 'Blok aturan bisnis terpusat untuk mesin promosi AI.',
                    updatedBy: 1
                });
            }
            const hasTelegramEnabled = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.enabled' });
            if (!hasTelegramEnabled) {
                await SystemSettings_1.SystemSettingsModel.create({ key: 'telegram.enabled', value: true, description: 'Status keaktifan pengiriman notifikasi Telegram.', updatedBy: 1 });
            }
            const hasTelegramChatId = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.chatId' });
            if (!hasTelegramChatId) {
                await SystemSettings_1.SystemSettingsModel.create({ key: 'telegram.chatId', value: '-1003941703215', description: 'ID Chat / Grup penerima notifikasi Telegram.', updatedBy: 1 });
            }
            const hasLockSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'scheduler.lock' });
            if (!hasLockSetting) {
                await SystemSettings_1.SystemSettingsModel.create({
                    key: 'scheduler.lock',
                    value: { locked: false, lockedBy: null, expiresAt: null },
                    description: 'Distributed lock untuk mencegah eksekusi paralel scheduler.',
                    updatedBy: 1
                });
            }
        }
        const aiModelCount = await AiModel_1.AiModelModel.countDocuments();
        if (aiModelCount === 0) {
            await AiModel_1.AiModelModel.create([
                { id: 'yolov8-river-v1.0', name: 'YOLOv8 River Anomaly Detector', version: '1.0', isActive: true }
            ]);
            console.log('[MIGRATION INFO] Seeded initial AiModel registry.');
        }
    }
    catch (err) {
        console.error('[MIGRATION ERROR] Failed to seed system settings and models:', err.message);
    }
}
async function runMigration() {
    // Selalu seed konfigurasi default and model AI registry saat startup
    await seedSystemSettingsAndModels();
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
    // Prepare user docs
    const userDocs = usersToMigrate.map(u => ({
        id: u.id,
        username: u.username.toLowerCase(),
        passwordHash: u.passwordHash,
        role: u.username === 'admin' ? 'admin' : u.role,
        name: u.username === 'admin' ? 'Administrator Utama' : u.username === 'user' ? 'Citizen Reporter' : 'Pengguna',
        email: `${u.username}@eyeco.gov.id`,
        agency: u.username === 'admin' ? 'EYECO Command Center' : 'Masyarakat Umum'
    }));
    // Helper mapping and insertion function
    const executeMigration = async (session) => {
        // 1. Insert Users
        const options = session ? { session } : {};
        const insertedUsers = await User_1.UserModel.insertMany(userDocs, options);
        // 2. Map integer ID to ObjectId
        const idMap = new Map();
        insertedUsers.forEach(u => idMap.set(u.id, u._id));
        // Seeding SystemSettings & Models
        await seedSystemSettingsAndModels();
        // 3. Prepare Report documents with ObjectIds and SLA details
        const reportDocs = reportsToMigrate.map(r => {
            const userObjectId = idMap.get(r.userId) || idMap.get(1); // default to admin if not found
            // Map status
            let mappedStatus = 'NEW';
            if (r.adminStatus === 'VALID') {
                mappedStatus = 'VALIDATED';
                if (r.status === 'PROSES')
                    mappedStatus = 'IN_PROGRESS';
                if (r.status === 'SELESAI')
                    mappedStatus = 'RESOLVED';
                if (r.status === 'CLOSED')
                    mappedStatus = 'CLOSED';
            }
            else if (r.adminStatus === 'DIABAIKAN') {
                mappedStatus = 'REJECTED';
            }
            else {
                mappedStatus = 'UNDER_REVIEW';
            }
            // Generate SLA timeline dates
            const detectedAt = new Date(r.timestamp);
            const validatedAt = r.adminStatus === 'VALID' ? new Date(detectedAt.getTime() + 10 * 60 * 1000) : null;
            const assignedAt = (r.status === 'PROSES' || r.status === 'SELESAI' || r.status === 'CLOSED') ? new Date(detectedAt.getTime() + 15 * 60 * 1000) : null;
            const arrivedAt = (r.status === 'PROSES' || r.status === 'SELESAI' || r.status === 'CLOSED') ? new Date(detectedAt.getTime() + 25 * 60 * 1000) : null;
            const resolvedAt = (r.status === 'SELESAI' || r.status === 'CLOSED') ? new Date(detectedAt.getTime() + 60 * 60 * 1000) : null;
            const closedAt = r.status === 'CLOSED' ? new Date(detectedAt.getTime() + 90 * 60 * 1000) : null;
            // Calculate durations
            const validationDurationMs = validatedAt ? (validatedAt.getTime() - detectedAt.getTime()) : null;
            const assignmentDurationMs = (assignedAt && validatedAt) ? (assignedAt.getTime() - validatedAt.getTime()) : null;
            const cleanupDurationMs = (resolvedAt && arrivedAt) ? (resolvedAt.getTime() - arrivedAt.getTime()) : null;
            const resolutionDurationMs = (resolvedAt && assignedAt) ? (resolvedAt.getTime() - assignedAt.getTime()) : null;
            const totalDurationMs = closedAt ? (closedAt.getTime() - detectedAt.getTime()) : null;
            return {
                id: r.id,
                userId: userObjectId,
                tenantId: 'BBWS',
                location: r.location,
                timestamp: detectedAt,
                aiStatus: r.aiStatus,
                aiConfidence: r.aiConfidence,
                adminStatus: r.adminStatus,
                image: r.image,
                identity: r.identity,
                sourceType: r.sourceType,
                additionalNotes: r.additionalNotes,
                adminNotes: r.adminNotes,
                boundingBoxes: r.boundingBoxes || [],
                status: mappedStatus,
                currentAssignmentId: null,
                currentResolutionId: null,
                sla: {
                    detectedAt,
                    validatedAt,
                    assignedAt,
                    arrivedAt,
                    resolvedAt,
                    closedAt,
                    validationDurationMs,
                    assignmentDurationMs,
                    cleanupDurationMs,
                    resolutionDurationMs,
                    totalDurationMs
                }
            };
        });
        const insertedReports = await Report_1.ReportModel.insertMany(reportDocs, options);
    };
    // Attempt transaction
    let session = null;
    try {
        session = await mongoose_1.default.startSession();
        session.startTransaction();
        await executeMigration(session);
        await session.commitTransaction();
        console.log(`[MIGRATION SUCCESS] Transactional migration succeeded.`);
    }
    catch (err) {
        if (session) {
            try {
                await session.abortTransaction();
            }
            catch (abortErr) { }
        }
        // Check if it's transaction/session error (like standalone MongoDB deployment)
        const isSessionError = err.message && (err.message.includes('transaction') ||
            err.message.includes('session') ||
            err.codeName === 'InvalidOptions');
        if (isSessionError) {
            console.warn('[MIGRATION WARNING] Sessions not supported. Falling back to non-transactional migration.');
            try {
                await executeMigration();
                console.log(`[MIGRATION SUCCESS] Fallback migration succeeded.`);
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
