import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { ReportModel, IReport } from '../src/database/models/Report';
import { AiSnapshotModel, IAiSnapshot } from '../src/database/models/AiSnapshot';
import { ReportAiProjectionService, AiDataIntegrityStatus } from '../src/services/ai/ReportAiProjectionService';
import { connectDB } from '../src/database/db';

interface AuditItem {
  reportId: number;
  action: 'SYNCED' | 'SET_ACTIVE_SNAPSHOT' | 'SKIPPED_LEGACY' | 'MANUAL_REVIEW' | 'NO_CHANGE' | 'ERROR';
  integrityBefore: AiDataIntegrityStatus;
  integrityAfter: AiDataIntegrityStatus;
  activeSnapshotIdBefore: string | null;
  activeSnapshotIdAfter: string | null;
  changedFields: Record<string, { before: any; after: any }>;
  reason: string;
}

async function runRepair() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply || args.includes('--dry-run');

  console.log(`\n======================================================`);
  console.log(`  EYECO REPORT SNAPSHOT REPAIR SCRIPT`);
  console.log(`  MODE: ${isApply ? 'APPLY (Writing to DB)' : 'DRY-RUN (Read-only simulation)'}`);
  console.log(`======================================================\n`);

  await connectDB();

  const reports = await ReportModel.find({ deletedAt: null }).lean().exec();
  console.log(`Scanned ${reports.length} report documents in database...\n`);

  const stats = {
    totalScanned: reports.length,
    valid: 0,
    legacy: 0,
    repaired: 0,
    unchanged: 0,
    snapshotMissing: 0,
    inconsistent: 0,
    manualReview: 0,
    failed: 0,
  };

  const auditLogs: AuditItem[] = [];

  for (const rep of reports) {
    const reportId = rep.id;
    let activeSnap: any = null;

    if (rep.activeSnapshotId) {
      activeSnap = await AiSnapshotModel.findById(rep.activeSnapshotId).lean().exec();
    }

    const integrityBefore = ReportAiProjectionService.classifyIntegrity(rep as any, activeSnap);

    // Condition A: activeSnapshotId valid & snapshot exists
    if (rep.activeSnapshotId && activeSnap) {
      const decision = activeSnap.decision || {};
      const snapshotScore = typeof decision.violationScore === 'number' ? decision.violationScore : 0;
      const derivedStatus = ReportAiProjectionService.deriveAiStatusFromScore(snapshotScore);
      const snapshotStatusLabel = derivedStatus === 'HIGH' ? 'Indikasi Tinggi' : (derivedStatus === 'MEDIUM' ? 'Indikasi Sedang' : (derivedStatus === 'LOW' ? 'Indikasi Rendah' : 'Tidak Terindikasi'));

      const changedFields: Record<string, { before: any; after: any }> = {};

      if (rep.aiStatus !== snapshotStatusLabel) changedFields.aiStatus = { before: rep.aiStatus, after: snapshotStatusLabel };
      if (rep.violationScore !== snapshotScore) changedFields.violationScore = { before: rep.violationScore, after: snapshotScore };
      if (rep.decisionConfidence !== decision.decisionConfidence) changedFields.decisionConfidence = { before: rep.decisionConfidence, after: decision.decisionConfidence };
      if (rep.objectConfidence !== decision.objectConfidence) changedFields.objectConfidence = { before: rep.objectConfidence, after: decision.objectConfidence };
      if (rep.sceneConfidence !== decision.sceneConfidence) changedFields.sceneConfidence = { before: rep.sceneConfidence, after: decision.sceneConfidence };
      if (rep.priority !== (decision.priority || 'NONE')) changedFields.priority = { before: rep.priority, after: decision.priority || 'NONE' };

      if (Object.keys(changedFields).length > 0) {
        stats.inconsistent++;
        if (isApply) {
          await ReportModel.updateOne(
            { _id: rep._id },
            {
              $set: {
                aiStatus: snapshotStatusLabel as any,
                violationScore: snapshotScore,
                decisionConfidence: decision.decisionConfidence ?? null,
                objectConfidence: decision.objectConfidence ?? null,
                sceneConfidence: decision.sceneConfidence ?? null,
                priority: decision.priority || 'NONE',
              }
            }
          );
          stats.repaired++;
          auditLogs.push({
            reportId,
            action: 'SYNCED',
            integrityBefore,
            integrityAfter: 'VALID',
            activeSnapshotIdBefore: String(rep.activeSnapshotId),
            activeSnapshotIdAfter: String(rep.activeSnapshotId),
            changedFields,
            reason: 'Synced report summary fields from active AiSnapshot decision',
          });
        } else {
          auditLogs.push({
            reportId,
            action: 'SYNCED',
            integrityBefore,
            integrityAfter: 'VALID',
            activeSnapshotIdBefore: String(rep.activeSnapshotId),
            activeSnapshotIdAfter: String(rep.activeSnapshotId),
            changedFields,
            reason: '[DRY-RUN] Would sync report summary fields from active AiSnapshot decision',
          });
        }
      } else {
        stats.valid++;
        stats.unchanged++;
      }
      continue;
    }

    // Condition B, C, D: activeSnapshotId is null / undefined
    const candidateSnapshots = await AiSnapshotModel.find({ reportId }).lean().exec();

    if (candidateSnapshots.length === 1) {
      // Condition B: Exactly one candidate snapshot available -> assign as active
      const cand = candidateSnapshots[0];
      const decision = cand.decision || {};
      const snapshotScore = typeof decision.violationScore === 'number' ? decision.violationScore : 0;
      const derivedStatus = ReportAiProjectionService.deriveAiStatusFromScore(snapshotScore);
      const snapshotStatusLabel = derivedStatus === 'HIGH' ? 'Indikasi Tinggi' : (derivedStatus === 'MEDIUM' ? 'Indikasi Sedang' : (derivedStatus === 'LOW' ? 'Indikasi Rendah' : 'Tidak Terindikasi'));

      if (isApply) {
        await ReportModel.updateOne(
          { _id: rep._id },
          {
            $set: {
              activeSnapshotId: cand._id,
              aiStatus: snapshotStatusLabel as any,
              violationScore: snapshotScore,
              decisionConfidence: decision.decisionConfidence ?? null,
              objectConfidence: decision.objectConfidence ?? null,
              sceneConfidence: decision.sceneConfidence ?? null,
              priority: decision.priority || 'NONE',
            }
          }
        );
        stats.repaired++;
        auditLogs.push({
          reportId,
          action: 'SET_ACTIVE_SNAPSHOT',
          integrityBefore,
          integrityAfter: 'VALID',
          activeSnapshotIdBefore: null,
          activeSnapshotIdAfter: String(cand._id),
          changedFields: { activeSnapshotId: { before: null, after: String(cand._id) } },
          reason: 'Assigned single candidate snapshot as active and synced summary fields',
        });
      } else {
        auditLogs.push({
          reportId,
          action: 'SET_ACTIVE_SNAPSHOT',
          integrityBefore,
          integrityAfter: 'VALID',
          activeSnapshotIdBefore: null,
          activeSnapshotIdAfter: String(cand._id),
          changedFields: { activeSnapshotId: { before: null, after: String(cand._id) } },
          reason: '[DRY-RUN] Would assign single candidate snapshot as active and sync summary fields',
        });
      }
    } else if (candidateSnapshots.length > 1) {
      // Condition C: Multiple candidate snapshots available -> require manual review
      stats.manualReview++;
      auditLogs.push({
        reportId,
        action: 'MANUAL_REVIEW',
        integrityBefore,
        integrityAfter: integrityBefore,
        activeSnapshotIdBefore: null,
        activeSnapshotIdAfter: null,
        changedFields: {},
        reason: `Multiple (${candidateSnapshots.length}) candidate snapshots found without an explicit activeSnapshotId. Manual review required.`,
      });
    } else {
      // Condition D: 0 snapshots available -> LEGACY report
      stats.legacy++;
      auditLogs.push({
        reportId,
        action: 'SKIPPED_LEGACY',
        integrityBefore: 'LEGACY',
        integrityAfter: 'LEGACY',
        activeSnapshotIdBefore: null,
        activeSnapshotIdAfter: null,
        changedFields: {},
        reason: 'Report has no associated AiSnapshots. Confirmed as legacy report.',
      });
    }
  }

  console.log(`\n======================================================`);
  console.log(`  REPAIR SUMMARY STATS`);
  console.log(`======================================================`);
  console.log(`  Total Reports Scanned : ${stats.totalScanned}`);
  console.log(`  Valid (Matching)      : ${stats.valid}`);
  console.log(`  Legacy (No Snapshot)  : ${stats.legacy}`);
  console.log(`  Repaired / Updated    : ${stats.repaired}`);
  console.log(`  Unchanged             : ${stats.unchanged}`);
  console.log(`  Inconsistent Found    : ${stats.inconsistent}`);
  console.log(`  Manual Review Flagged : ${stats.manualReview}`);
  console.log(`======================================================\n`);

  // Write audit JSON log file
  const artifactDir = path.join(process.cwd(), 'artifacts');
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  const auditPath = path.join(artifactDir, 'report-snapshot-repair-audit.json');
  fs.writeFileSync(auditPath, JSON.stringify({ mode: isApply ? 'APPLY' : 'DRY-RUN', executedAt: new Date().toISOString(), stats, auditLogs }, null, 2));
  console.log(`Audit report written to: ${auditPath}\n`);

  process.exit(0);
}

runRepair().catch(err => {
  console.error('Repair script failed:', err);
  process.exit(1);
});
