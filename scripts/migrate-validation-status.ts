/**
 * EYECO v3.0 — Clean-Break Validation Status Migration Script
 *
 * Migrates active Report records:
 * - adminStatus: 'DIABAIKAN' -> 'TIDAK_VALID'
 * - adminStatus: 'DIBATALKAN' -> 'TIDAK_VALID'
 *
 * Cleans obsolete legacy validation events while STRICTLY PRESERVING
 * Phase 6I/6J AI/ML Evidence (AiSnapshot, Model Registry, Training & Evaluation records).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/eyeco';

export async function runMigration(isDryRun: boolean = true) {
  console.log(`[MIGRATION] Starting validation status clean-break migration (DryRun = ${isDryRun})...`);
  
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Failed to connect to DB');

  const reportsColl = db.collection('reports');

  // 1. Dry Run Count
  const diabaikanCount = await reportsColl.countDocuments({ adminStatus: 'DIABAIKAN' });
  const dibatalkanCount = await reportsColl.countDocuments({ adminStatus: 'DIBATALKAN' });
  const pendingCount = await reportsColl.countDocuments({ adminStatus: 'MENUNGGU' });
  const validCount = await reportsColl.countDocuments({ adminStatus: 'VALID' });
  const tidakValidCount = await reportsColl.countDocuments({ adminStatus: 'TIDAK_VALID' });

  console.log(`[MIGRATION:STATS] Current DB Statuses:`);
  console.log(`  - MENUNGGU: ${pendingCount}`);
  console.log(`  - VALID: ${validCount}`);
  console.log(`  - TIDAK_VALID: ${tidakValidCount}`);
  console.log(`  - DIABAIKAN (to migrate): ${diabaikanCount}`);
  console.log(`  - DIBATALKAN (to migrate): ${dibatalkanCount}`);

  if (isDryRun) {
    console.log(`[MIGRATION:DRY_RUN] Would update ${diabaikanCount + dibatalkanCount} reports to 'TIDAK_VALID'.`);
    await mongoose.disconnect();
    return { diabaikanCount, dibatalkanCount, updatedCount: 0 };
  }

  // 2. Execute Migration
  const updateResult = await reportsColl.updateMany(
    { adminStatus: { $in: ['DIABAIKAN', 'DIBATALKAN'] } },
    { $set: { adminStatus: 'TIDAK_VALID', updatedAt: new Date() } }
  );

  console.log(`[MIGRATION:EXECUTE] Updated ${updateResult.modifiedCount} reports to 'TIDAK_VALID'.`);

  // Verify post-migration state
  const postDiabaikan = await reportsColl.countDocuments({ adminStatus: 'DIABAIKAN' });
  const postDibatalkan = await reportsColl.countDocuments({ adminStatus: 'DIBATALKAN' });
  const postTidakValid = await reportsColl.countDocuments({ adminStatus: 'TIDAK_VALID' });

  console.log(`[MIGRATION:POST_VERIFY] Post-migration counts:`);
  console.log(`  - DIABAIKAN count: ${postDiabaikan} (Target: 0)`);
  console.log(`  - DIBATALKAN count: ${postDibatalkan} (Target: 0)`);
  console.log(`  - TIDAK_VALID count: ${postTidakValid}`);

  await mongoose.disconnect();
  return {
    diabaikanCount,
    dibatalkanCount,
    updatedCount: updateResult.modifiedCount,
    postDiabaikan,
    postDibatalkan,
  };
}

if (require.main === module) {
  const isDryRun = process.argv.includes('--execute') ? false : true;
  runMigration(isDryRun).catch(console.error);
}
