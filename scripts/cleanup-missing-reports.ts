import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { connectDB } from '../src/database/db';
import { ReportModel } from '../src/database/models/Report';
import { AiEvidenceModel } from '../src/database/models/AiEvidence';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function cleanupMissingReports() {
  console.log(`\n======================================================`);
  console.log(`  EYECO MISSING EVIDENCE REPORT CLEANUP SCRIPT`);
  console.log(`======================================================\n`);

  await connectDB();

  const reports = await ReportModel.find({ deletedAt: null }).sort({ id: -1 }).exec();
  console.log(`Total active report records in database: ${reports.length}\n`);

  const reportIds = reports.map(r => r._id);
  const evidences = await AiEvidenceModel.find({ reportId: { $in: reportIds } }).lean().exec();
  const evMap = new Map<string, any>();
  evidences.forEach(ev => {
    if (ev.reportId) evMap.set(ev.reportId.toString(), ev);
  });

  const reportsToDelete: any[] = [];
  const evidencesToDelete: any[] = [];

  for (const report of reports) {
    const ev = evMap.get(report._id.toString());
    const isMissing = !ev || ev.storage?.status === 'MISSING';
    const isLegacyPath = report.image && (report.image.startsWith('/uploads/evidence_') || report.image.startsWith('evidence_'));

    if (isMissing || isLegacyPath) {
      reportsToDelete.push(report);
      if (ev) evidencesToDelete.push(ev._id);
    }
  }

  console.log(`Found ${reportsToDelete.length} reports with MISSING evidence.`);
  console.log(`Found ${reports.length - reportsToDelete.length} reports with AVAILABLE evidence.`);

  if (reportsToDelete.length === 0) {
    console.log(`No reports with missing evidence found. Database is completely clean!`);
    process.exit(0);
  }

  console.log(`\nCleaning up ${reportsToDelete.length} reports with missing evidence...`);
  const now = new Date();
  const reportDeleteIds = reportsToDelete.map(r => r._id);

  // Soft-delete missing reports so DB references remain safe
  const result = await ReportModel.updateMany(
    { _id: { $in: reportDeleteIds } },
    { $set: { deletedAt: now, deleteReason: 'CLEANUP_MISSING_HISTORICAL_EVIDENCE' } }
  ).exec();

  if (evidencesToDelete.length > 0) {
    await AiEvidenceModel.updateMany(
      { _id: { $in: evidencesToDelete } },
      { $set: { 'storage.status': 'DELETED' } }
    ).exec();
  }

  console.log(`\n======================================================`);
  console.log(`  CLEANUP COMPLETED SUCCESSFULLY`);
  console.log(`======================================================`);
  console.log(`  Soft-deleted Report Records : ${result.modifiedCount}`);
  console.log(`======================================================\n`);

  process.exit(0);
}

cleanupMissingReports().catch(err => {
  console.error('Cleanup missing reports error:', err);
  process.exit(1);
});
