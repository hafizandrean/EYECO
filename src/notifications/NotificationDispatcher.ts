import { OutboxEventModel } from '../database/models/OutboxEvent';
import { IReport } from '../database/models/Report';

export class NotificationDispatcher {
  /**
   * Queues a new report notification event into the transactional outbox database.
   * Background OutboxWorker will consume this asynchronously.
   */
  public static async dispatch(report: IReport): Promise<void> {
    // Guard: AI CCTV auto-reports MUST be READY with a valid activeSnapshotId and VALID integrity before dispatching
    if (report.sourceType === 'Otomatis' || (report.identity && report.identity.startsWith('CCTV-CAM-'))) {
      const integrityStatus = report.aiDataIntegrityStatus;
      const outcome = report.analysisOutcome;
      const isCompletedOutcome = outcome === 'COMPLETE' || outcome === 'COMPLETE_WITH_LIMITATIONS';
      const isScoreValid = Number.isFinite(report.violationScore) && report.violationScore! >= 0 && report.violationScore! <= 100;

      const eligibleForAiAlert =
        report.analysisState === 'READY' &&
        isCompletedOutcome &&
        integrityStatus === 'VALID' &&
        report.activeSnapshotId != null &&
        isScoreValid;

      if (!eligibleForAiAlert) {
        console.log(`[NotificationDispatcher] Suppressing AI outbox event for Report #${report.id}: state=${report.analysisState}, outcome=${outcome}, snapshot=${report.activeSnapshotId}, integrity=${integrityStatus}, score=${report.violationScore}`);
        return;
      }
    }

    console.log(`[NotificationDispatcher] Queuing outbox event for Report #${report.id}...`);
    try {
      await OutboxEventModel.create({
        aggregateType: 'Report',
        aggregateId: report.id.toString(),
        eventType: 'CREATED',
        payload: {
          sentChannels: []
        },
        status: 'PENDING',
        retryCount: 0,
        processedAt: null
      });
      console.log(`[NotificationDispatcher] Outbox event written successfully for Report #${report.id}.`);
    } catch (err: any) {
      console.error(`[NotificationDispatcher] Failed to write outbox event for Report #${report.id}:`, err.message);
      throw err;
    }
  }
}
