/**
 * EYECO AI Engine v3.0 — Layer 4: Operator Feedback Collector
 */

import { AiValidationLogModel } from '../../../database/models/AiValidationLog';
import { OperatorGroundTruthLabel, OperationalPriority } from '../types/ai.types';
import mongoose from 'mongoose';

export class FeedbackCollector {
  public async logOperatorFeedback(params: {
    reportId: number;
    snapshotId?: string;
    userId: string;
    operatorUsername: string;
    operatorDecision: OperatorGroundTruthLabel;
    isLitteringConfirmed: boolean | null;
    correctedPriority: OperationalPriority;
    notes?: string;
    predictedStatus?: string;
    predictedScore?: number;
    inputImageHash?: string;
  }) {
    const log = await AiValidationLogModel.create({
      reportId: params.reportId,
      snapshotId: params.snapshotId ? new mongoose.Types.ObjectId(params.snapshotId) : undefined,
      userId: new mongoose.Types.ObjectId(params.userId),
      operatorUsername: params.operatorUsername,
      operatorDecision: params.operatorDecision,
      isLitteringConfirmed: params.isLitteringConfirmed,
      correctedPriority: params.correctedPriority,
      notes: params.notes || '',
      predictedStatus: params.predictedStatus || '',
      predictedScore: params.predictedScore || 0,
      inputImageHash: params.inputImageHash || '',
    });

    console.log(`[FEEDBACK] Logged operator feedback for Report #${params.reportId}: ${params.operatorDecision}`);
    return log;
  }
}

export const feedbackCollector = new FeedbackCollector();
