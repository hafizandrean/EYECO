import { OutboxEventModel, IOutboxEvent } from '../database/models/OutboxEvent';
import { ReportModel } from '../database/models/Report';
import { WebNotificationChannel } from './WebNotificationChannel';
import { TelegramNotificationChannel } from './TelegramNotificationChannel';
import { INotificationChannel } from './NotificationChannel';

export class OutboxWorker {
  private static channels: INotificationChannel[] = [
    new WebNotificationChannel(),
    new TelegramNotificationChannel()
  ];
  
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Starts the Outbox background worker.
   */
  public static start(intervalMs: number = 5000): void {
    if (this.intervalId) return;
    
    console.log(`[OutboxWorker] Starting background worker with interval ${intervalMs}ms...`);
    this.intervalId = setInterval(() => this.processQueue(), intervalMs);
  }

  /**
   * Stops the Outbox background worker.
   */
  public static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[OutboxWorker] Background worker stopped.');
    }
  }

  /**
   * Processes all pending outbox events and auto-queues unsent VALID reports.
   */
  public static async processQueue(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Auto-queue any report that is VALID but not yet SENT/QUEUED
      const unsentValidReports = await ReportModel.find({
        adminStatus: 'VALID',
        telegramStatus: { $nin: ['SENT', 'QUEUED', 'SENDING'] },
        deletedAt: null
      }).exec();

      for (const report of unsentValidReports) {
        const idempotencyKey = `REPORT_VALIDATED_TELEGRAM:${report.id}:v1`;
        const existingOutbox = await OutboxEventModel.findOne({ idempotencyKey }).exec();
        
        if (existingOutbox && existingOutbox.status === 'PROCESSED') {
          report.telegramStatus = 'SENT';
          await report.save();
          continue;
        }

        if (!existingOutbox) {
          await OutboxEventModel.create({
            aggregateType: 'Report',
            aggregateId: String(report.id),
            eventType: 'REPORT_VALIDATED_TELEGRAM',
            idempotencyKey,
            payload: { reportId: report.id, location: report.location },
            status: 'PENDING',
            retryCount: 0
          });
        } else if (existingOutbox.status === 'FAILED') {
          existingOutbox.status = 'PENDING';
          existingOutbox.retryCount = 0;
          await existingOutbox.save();
        }

        report.telegramStatus = 'QUEUED';
        report.telegramError = null;
        await report.save();
        console.log(`[OutboxWorker] Auto-queued valid Report #${report.id} for Telegram broadcast.`);
      }

      // 2. Ambil seluruh event yang statusnya PENDING
      const pendingEvents = await OutboxEventModel.find({ status: 'PENDING' }).exec();
      
      for (const event of pendingEvents) {
        await this.processEvent(event);
      }
    } catch (err: any) {
      console.error('[OutboxWorker] Error processing queue:', err.message);
    } finally {
      this.isRunning = false;
    }
  }


  /**
   * Process a single outbox event with channel status tracking.
   */
  private static async processEvent(event: IOutboxEvent): Promise<void> {
    try {
      if (event.aggregateType !== 'Report' || (event.eventType !== 'CREATED' && event.eventType !== 'REPORT_VALIDATED_TELEGRAM')) {
        // Unknown event type, mark as processed to clear it
        event.status = 'PROCESSED';
        event.processedAt = new Date();
        await event.save();
        return;
      }

      // Temukan data Laporan terkait
      const report = await ReportModel.findOne({ id: Number(event.aggregateId) }).exec();
      if (!report) {
        console.error(`[OutboxWorker] Report #${event.aggregateId} not found. Skipping event.`);
        event.status = 'FAILED';
        await event.save();
        return;
      }

      // Update report telegramStatus to SENDING
      if (event.eventType === 'REPORT_VALIDATED_TELEGRAM' && report.adminStatus === 'VALID') {
        report.telegramStatus = 'SENDING';
        report.telegramAttemptCount = (report.telegramAttemptCount || 0) + 1;
        report.telegramLastAttemptAt = new Date();
        await report.save();
      }

      // Pastikan payload terinisialisasi
      if (!event.payload) {
        event.payload = { sentChannels: [] };
      }
      if (!event.payload.sentChannels) {
        event.payload.sentChannels = [];
      }

      const sentChannels = event.payload.sentChannels as string[];
      let allSucceeded = true;

      // For REPORT_VALIDATED_TELEGRAM, run Telegram channel only
      const targetChannels = event.eventType === 'REPORT_VALIDATED_TELEGRAM'
        ? this.channels.filter(c => c.name === 'Telegram')
        : this.channels;

      for (const channel of targetChannels) {
        if (sentChannels.includes(channel.name)) {
          continue;
        }

        try {
          console.log(`[OutboxWorker] Sending Report #${report.id} notification via ${channel.name}...`);
          const success = await channel.send(report);
          if (success) {
            sentChannels.push(channel.name);
            event.markModified('payload');
            await event.save();

            if (channel.name === 'Telegram' && report.adminStatus === 'VALID') {
              report.telegramStatus = 'SENT';
              report.telegramSentAt = new Date();
              report.telegramError = null;
              await report.save();
            }
          } else {
            allSucceeded = false;
            if (channel.name === 'Telegram' && report.adminStatus === 'VALID') {
              report.telegramStatus = 'FAILED';
              report.telegramError = 'Gagal menyiarkan pesan ke Telegram channel';
              await report.save();
            }
          }
        } catch (err: any) {
          console.error(`[OutboxWorker] Channel ${channel.name} threw an error:`, err.message);
          allSucceeded = false;
          if (channel.name === 'Telegram' && report.adminStatus === 'VALID') {
            report.telegramStatus = 'FAILED';
            report.telegramError = err.message || 'Error pengiriman Telegram';
            await report.save();
          }
        }
      }

      if (allSucceeded && sentChannels.length === targetChannels.length) {
        event.status = 'PROCESSED';
        event.processedAt = new Date();
        await event.save();
        console.log(`[OutboxWorker] Event #${event._id} successfully processed for Report #${report.id}.`);
      } else {
        event.retryCount += 1;
        if (event.retryCount >= 5) {
          event.status = 'FAILED';
          console.error(`[OutboxWorker] Event #${event._id} failed permanently after 5 attempts. Moved to DLQ.`);
        }
        await event.save();
      }

    } catch (err: any) {
      console.error(`[OutboxWorker] Failed to process event #${event._id}:`, err.message);
      event.retryCount += 1;
      if (event.retryCount >= 10) {
        event.status = 'FAILED';
      }
      await event.save();
    }
  }

  /**
   * Reconciliation Service: Heals any UI projection drift between OutboxEvent (Authoritative Source of Truth)
   * and Report.telegramStatus (Denormalized UI Projection) caused by worker crashes.
   */
  public static async reconcileProjections(): Promise<number> {
    let reconciledCount = 0;
    try {
      // Find all PROCESSED events where Report.telegramStatus is not SENT
      const processedEvents = await OutboxEventModel.find({
        aggregateType: 'Report',
        eventType: 'REPORT_VALIDATED_TELEGRAM',
        status: 'PROCESSED'
      }).exec();

      for (const event of processedEvents) {
        const reportId = Number(event.aggregateId);
        const report = await ReportModel.findOne({ id: reportId }).exec();
        if (report && report.adminStatus === 'VALID' && report.telegramStatus !== 'SENT') {
          report.telegramStatus = 'SENT';
          report.telegramSentAt = event.processedAt || new Date();
          report.telegramError = null;
          await report.save();
          reconciledCount++;
          console.log(`[OutboxReconciler] Healed projection drift for Report #${reportId} -> SENT`);
        }
      }

      // Find all FAILED events where Report.telegramStatus is not FAILED
      const failedEvents = await OutboxEventModel.find({
        aggregateType: 'Report',
        eventType: 'REPORT_VALIDATED_TELEGRAM',
        status: 'FAILED'
      }).exec();

      for (const event of failedEvents) {
        const reportId = Number(event.aggregateId);
        const report = await ReportModel.findOne({ id: reportId }).exec();
        if (report && report.adminStatus === 'VALID' && report.telegramStatus !== 'FAILED') {
          report.telegramStatus = 'FAILED';
          report.telegramError = 'Outbox event failed permanently (reconciled)';
          await report.save();
          reconciledCount++;
          console.log(`[OutboxReconciler] Healed projection drift for Report #${reportId} -> FAILED`);
        }
      }
    } catch (err: any) {
      console.error('[OutboxReconciler] Error during projection reconciliation:', err.message);
    }
    return reconciledCount;
  }
}
