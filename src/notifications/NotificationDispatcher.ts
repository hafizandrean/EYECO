import { OutboxEventModel } from '../database/models/OutboxEvent';
import { IReport } from '../database/models/Report';

export class NotificationDispatcher {
  /**
   * Queues a new report notification event into the transactional outbox database.
   * Background OutboxWorker will consume this asynchronously.
   */
  public static async dispatch(report: IReport): Promise<void> {
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
