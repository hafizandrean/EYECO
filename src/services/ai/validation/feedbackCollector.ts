import { AiValidationLogModel, IAiValidationLog, ICorrectedObject } from '../../../database/models/AiValidationLog';
import { ContinualLearningOutboxModel } from '../../../database/models/ContinualLearningOutbox';
import { OperatorGroundTruthLabel, OperationalPriority } from '../types/ai.types';
import { outboxProcessor } from '../continualLearning/outboxProcessor';
import mongoose from 'mongoose';
import crypto from 'crypto';

export class FeedbackCollector {
  private canonicalStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalStringify(item)).join(',') + ']';
    }
    const sortedKeys = Object.keys(obj).sort();
    const parts = sortedKeys.map(key => `${JSON.stringify(key)}:${this.canonicalStringify(obj[key])}`);
    return '{' + parts.join(',') + '}';
  }

  private computePayloadHash(params: {
    operatorDecision: string;
    isLitteringConfirmed?: boolean | null;
    correctedPriority?: string;
    correctedObjects?: ICorrectedObject[];
    notes?: string;
  }): string {
    const canonicalObj = {
      confirmed: params.isLitteringConfirmed ?? null,
      decision: params.operatorDecision,
      notes: (params.notes || '').trim(),
      objects: params.correctedObjects || [],
      priority: params.correctedPriority || 'NONE'
    };
    const canonicalJson = this.canonicalStringify(canonicalObj);
    return crypto.createHash('sha256').update(canonicalJson).digest('hex');
  }

  public async logOperatorFeedback(params: {
    idempotencyKey: string;
    reportId: number;
    reportObjectId?: string;
    snapshotId: string;
    userId: string;
    operatorUsername: string;
    operatorDecision: OperatorGroundTruthLabel;
    isLitteringConfirmed?: boolean | null;
    correctedPriority?: OperationalPriority;
    correctedObjects?: ICorrectedObject[];
    notes?: string;
    predictedStatus?: string;
    predictedScore?: number | null;
    inputImageHash?: string;
    yoloVersion?: string;
    sceneVersion?: string;
    decisionVersion?: string;
  }): Promise<IAiValidationLog> {
    const payloadHash = this.computePayloadHash(params);
    const scopedKey = `op-${params.userId}:${params.snapshotId}:${params.idempotencyKey}`;

    // 1. Idempotency Guard: Check if scoped key already exists
    const existingLog = await AiValidationLogModel.findOne({ idempotencyKey: scopedKey }).exec();
    if (existingLog) {
      if (existingLog.requestPayloadHash && existingLog.requestPayloadHash !== payloadHash) {
        const err: any = new Error('Conflict: Idempotency key already exists with a different payload.');
        err.code = 'IDEMPOTENCY_KEY_CONFLICT';
        err.status = 409;
        throw err;
      }
      console.log(`[FEEDBACK] Idempotent hit: returning existing log ${existingLog._id} for scoped key ${scopedKey}`);
      return existingLog;
    }

    const snapshotObjectId = new mongoose.Types.ObjectId(params.snapshotId);
    const userObjectId = new mongoose.Types.ObjectId(params.userId);

    // Attempt MongoDB Transaction if replica set supported, else atomic sequence
    let session: mongoose.ClientSession | null = null;
    try {
      session = await mongoose.startSession();
    } catch (_) {
      session = null;
    }

    const executeInTransaction = async (sess: mongoose.ClientSession | null) => {
      // 2. Fetch latest current log for this snapshot & user to compute version & previous reference
      const latestCurrentLog = await AiValidationLogModel.findOne(
        { snapshotId: snapshotObjectId, userId: userObjectId, isCurrent: true },
        null,
        sess ? { session: sess } : {}
      ).sort({ validationVersion: -1 }).exec();

      const nextVersion = latestCurrentLog ? latestCurrentLog.validationVersion + 1 : 1;
      const prevLogId = latestCurrentLog ? (latestCurrentLog._id as mongoose.Types.ObjectId) : null;

      // 3. Mark previous logs as not current atomically for this snapshot & user
      if (latestCurrentLog) {
        await AiValidationLogModel.updateMany(
          { snapshotId: snapshotObjectId, userId: userObjectId, isCurrent: true },
          { $set: { isCurrent: false } },
          sess ? { session: sess } : {}
        ).exec();
      }

      // 4. Create new versioned feedback log
      const docs = await AiValidationLogModel.create(
        [
          {
            idempotencyKey: scopedKey,
            reportId: params.reportId,
            reportObjectId: params.reportObjectId ? new mongoose.Types.ObjectId(params.reportObjectId) : undefined,
            snapshotId: snapshotObjectId,
            userId: userObjectId,
            operatorUsername: params.operatorUsername,
            operatorDecision: params.operatorDecision,
            isLitteringConfirmed: params.isLitteringConfirmed ?? null,
            correctedPriority: params.correctedPriority || 'NONE',
            correctedObjects: params.correctedObjects || [],
            notes: params.notes || '',
            validationVersion: nextVersion,
            previousValidationLogId: prevLogId,
            isCurrent: true,
            yoloVersion: params.yoloVersion || 'v8.2.0-yolov8n',
            sceneVersion: params.sceneVersion || 'v1.0.0',
            decisionVersion: params.decisionVersion || 'v3.0.0',
            snapshotVersion: 1,
            predictedStatus: params.predictedStatus || '',
            predictedScore: typeof params.predictedScore === 'number' ? params.predictedScore : null,
            inputImageHash: params.inputImageHash || '',
            requestPayloadHash: payloadHash,
          }
        ],
        sess ? { session: sess } : {}
      );

      const savedLogDoc = docs[0];

      // 5. Create Outbox Event in the SAME transaction for absolute atomicity
      const eventId = `outbox-log-${savedLogDoc._id}`;
      await ContinualLearningOutboxModel.create(
        [
          {
            eventId,
            eventType: 'AI_FEEDBACK_RECORDED',
            validationLogId: savedLogDoc._id,
            snapshotId: snapshotObjectId,
            reportId: params.reportId,
            status: 'PENDING',
            attemptCount: 0,
            maxAttempts: 5
          }
        ],
        sess ? { session: sess } : {}
      );

      console.log(`[FEEDBACK] Recorded feedback v${nextVersion} + Outbox Event ${eventId} for Report #${params.reportId} (Snapshot ${params.snapshotId})`);
      return savedLogDoc;
    };

    let savedLog: IAiValidationLog | null = null;
    try {
      if (session) {
        await session.withTransaction(async () => {
          savedLog = await executeInTransaction(session);
        });
        session.endSession();
      } else {
        savedLog = await executeInTransaction(null);
      }
    } catch (err: any) {
      if (session) session.endSession();
      if (err.code === 11000 || (err.message && err.message.includes('E11000'))) {
        const retryLog = await AiValidationLogModel.findOne({ idempotencyKey: scopedKey }).exec();
        if (retryLog) return retryLog;
      }
      throw err;
    }

    return savedLog!;
  }
}

export const feedbackCollector = new FeedbackCollector();
