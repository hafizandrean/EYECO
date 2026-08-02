import { ContinualLearningOutboxModel, IContinualLearningOutbox } from '../../../database/models/ContinualLearningOutbox';
import { AiValidationLogModel } from '../../../database/models/AiValidationLog';
import { candidateSelector } from './candidateSelector';
import crypto from 'crypto';

export class OutboxProcessor {
  private static instance: OutboxProcessor;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  public static getInstance(): OutboxProcessor {
    if (!OutboxProcessor.instance) {
      OutboxProcessor.instance = new OutboxProcessor();
    }
    return OutboxProcessor.instance;
  }

  public async recordOutboxEvent(params: {
    validationLogId: string;
    snapshotId: string;
    reportId: number;
  }): Promise<IContinualLearningOutbox> {
    const eventId = `outbox-log-${params.validationLogId}`;
    const outboxEvent = await ContinualLearningOutboxModel.findOneAndUpdate(
      { eventId },
      {
        $setOnInsert: {
          eventId,
          eventType: 'AI_FEEDBACK_RECORDED',
          validationLogId: params.validationLogId,
          snapshotId: params.snapshotId,
          reportId: params.reportId,
          status: 'PENDING',
          attemptCount: 0,
          maxAttempts: 5
        }
      },
      { upsert: true, new: true }
    ).exec();

    console.log(`[OUTBOX] Transactional Event Recorded: ${eventId} (Status: PENDING)`);
    return outboxEvent;
  }

  public async processPendingOutboxEvents(): Promise<number> {
    const claimToken = crypto.randomBytes(12).toString('hex');
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 60 * 1000); // 60 seconds lease

    // 1. Atomic Claim Pending/Stale Events
    const pendingEvents = await ContinualLearningOutboxModel.find({
      $or: [
        { status: 'PENDING' },
        { status: 'FAILED', attemptCount: { $lt: 5 }, nextRetryAt: { $lte: now } },
        { status: 'PROCESSING', leaseExpiresAt: { $lt: now } } // Stale worker recovery
      ]
    }).limit(20).exec();

    let processedCount = 0;

    for (const event of pendingEvents) {
      // Claim event atomically
      const claimedEvent = await ContinualLearningOutboxModel.findOneAndUpdate(
        { _id: event._id, status: event.status },
        {
          $set: {
            status: 'PROCESSING',
            claimToken,
            leaseExpiresAt,
          },
          $inc: { attemptCount: 1 }
        },
        { new: true }
      ).exec();

      if (!claimedEvent) continue;

      try {
        const validationLog = await AiValidationLogModel.findById(claimedEvent.validationLogId).exec();
        if (validationLog) {
          await candidateSelector.evaluateAndPersistCandidate(validationLog);
        }

        // Stale Worker Guard: Only finalize if claimToken still matches
        const finalized = await ContinualLearningOutboxModel.findOneAndUpdate(
          { _id: claimedEvent._id, claimToken },
          {
            $set: {
              status: 'COMPLETED',
              claimToken: null,
              leaseExpiresAt: null,
              errorCode: null
            }
          },
          { new: true }
        ).exec();

        if (finalized) {
          processedCount++;
          console.log(`[OUTBOX] Successfully processed event ${claimedEvent.eventId}`);
        } else {
          console.warn(`[OUTBOX_WARN] Stale worker write blocked for event ${claimedEvent.eventId} (claim lost)`);
        }
      } catch (err: any) {
        console.error(`[OUTBOX_ERROR] Processing failed for event ${claimedEvent.eventId}:`, err);
        const isMax = claimedEvent.attemptCount >= claimedEvent.maxAttempts;
        await ContinualLearningOutboxModel.findOneAndUpdate(
          { _id: claimedEvent._id, claimToken },
          {
            $set: {
              status: isMax ? 'FAILED' : 'FAILED',
              claimToken: null,
              leaseExpiresAt: null,
              nextRetryAt: new Date(Date.now() + 15 * 1000), // Retry in 15s
              errorCode: err.message || 'Processing Error'
            }
          }
        ).exec();
      }
    }

    return processedCount;
  }

  public startWorker(intervalMs: number = 10000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[OUTBOX_WORKER] Started Outbox Worker (Polling interval: ${intervalMs}ms)`);
    this.timer = setInterval(async () => {
      try {
        await this.processPendingOutboxEvents();
      } catch (err) {
        console.error('[OUTBOX_WORKER_ERROR]', err);
      }
    }, intervalMs);
  }

  public stopWorker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[OUTBOX_WORKER] Stopped Outbox Worker');
  }
}

export const outboxProcessor = OutboxProcessor.getInstance();
