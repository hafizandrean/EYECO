import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { UserModel } from './models/User';
import { ReportModel } from './models/Report';

const DB_PATH = path.join(__dirname, 'db.json');
const BACKUP_PATH = path.join(__dirname, 'db.backup.json');

export async function runMigration() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[MIGRATION INFO] db.json not found, skipping migration.');
    return;
  }

  let rawData: string;
  try {
    rawData = fs.readFileSync(DB_PATH, 'utf-8');
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to read db.json:', err);
    return;
  }

  let dbData: { users?: any[]; reports?: any[] };
  try {
    dbData = JSON.parse(rawData);
  } catch (err) {
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
    fs.writeFileSync(BACKUP_PATH, rawData, 'utf-8');
    console.log(`[MIGRATION INFO] Backup created successfully at ${BACKUP_PATH}`);
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to create backup, aborting migration for safety:', err);
    return;
  }

  try {
    const userCount = await UserModel.countDocuments();
    const reportCount = await ReportModel.countDocuments();

    if (userCount > 0 || reportCount > 0) {
      console.log('[MIGRATION INFO] Database already has data. Skipping migration to prevent overwrite/duplicates.');
      return;
    }
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to query existing documents count:', err);
    return;
  }

  console.log(`[MIGRATION INFO] Found ${usersToMigrate.length} users and ${reportsToMigrate.length} reports in db.json to migrate.`);

  // Prepare docs
  const userDocs = usersToMigrate.map(u => ({
    id: u.id,
    username: u.username.toLowerCase(),
    passwordHash: u.passwordHash,
    role: u.role
  }));

  const reportDocs = reportsToMigrate.map(r => ({
    id: r.id,
    userId: r.userId,
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
  let session: mongoose.mongo.ClientSession | null = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    if (userDocs.length > 0) {
      await UserModel.insertMany(userDocs, { session });
    }
    if (reportDocs.length > 0) {
      await ReportModel.insertMany(reportDocs, { session });
    }

    await session.commitTransaction();
    console.log(`[MIGRATION SUCCESS] Transactional migration succeeded. Migrated ${userDocs.length} users and ${reportDocs.length} reports.`);
  } catch (err: any) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignore session abort error if transaction was never started/failed early
      }
    }
    
    // Check if it's transaction/session error (like standalone MongoDB deployment)
    const isSessionError = err.message && (
      err.message.includes('transaction') || 
      err.message.includes('session') ||
      err.codeName === 'InvalidOptions'
    );

    if (isSessionError) {
      console.warn('[MIGRATION WARNING] Sessions/Transactions not supported by this MongoDB setup. Falling back to non-transactional migration.');
      try {
        if (userDocs.length > 0) {
          await UserModel.insertMany(userDocs);
        }
        if (reportDocs.length > 0) {
          await ReportModel.insertMany(reportDocs);
        }
        console.log(`[MIGRATION SUCCESS] Fallback migration succeeded. Migrated ${userDocs.length} users and ${reportDocs.length} reports.`);
      } catch (fallbackErr) {
        console.error('[MIGRATION ERROR] Fallback migration failed:', fallbackErr);
      }
    } else {
      console.error('[MIGRATION ERROR] Transactional migration failed:', err);
    }
  } finally {
    if (session) {
      session.endSession();
    }
  }
}
