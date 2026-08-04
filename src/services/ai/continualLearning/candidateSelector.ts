import { IAiValidationLog } from '../../../database/models/AiValidationLog';
import { AiSnapshotModel } from '../../../database/models/AiSnapshot';
import { AiDatasetCandidateModel, IAiDatasetCandidate, IScoreBreakdownItem, TargetModelType } from '../../../database/models/AiDatasetCandidate';
import mongoose from 'mongoose';

export class CandidateSelector {
  public static readonly SELECTOR_VERSION = 'v1.0.0';

  public calculateCandidateScore(params: {
    uncertaintyScore: number; // 0-100
    isOperatorCorrected: boolean;
    violationScore: number; // 0-100
    analyzerDisagreement: boolean;
    hasBoundingBoxEdits: boolean;
  }): { totalScore: number; breakdown: IScoreBreakdownItem[]; reasons: string[] } {
    const breakdown: IScoreBreakdownItem[] = [];
    const reasons: string[] = [];

    // 1. Uncertainty Weight (30% of uncertaintyScore)
    const uncertaintyDelta = Math.round(params.uncertaintyScore * 0.30);
    if (uncertaintyDelta > 0) {
      breakdown.push({ reason: 'HIGH_UNCERTAINTY', delta: uncertaintyDelta });
      reasons.push('HIGH_UNCERTAINTY');
    }

    // 2. Operator Correction Weight (+30)
    if (params.isOperatorCorrected) {
      breakdown.push({ reason: 'OPERATOR_CORRECTION', delta: 30 });
      reasons.push('OPERATOR_CORRECTION');
    }

    // 3. Decision Threshold Proximity (+15)
    const isNearThreshold = (params.violationScore >= 45 && params.violationScore <= 55) || (params.violationScore >= 70 && params.violationScore <= 80);
    if (isNearThreshold) {
      breakdown.push({ reason: 'DECISION_THRESHOLD_PROXIMITY', delta: 15 });
      reasons.push('DECISION_THRESHOLD_PROXIMITY');
    }

    // 4. Analyzer Disagreement (+15)
    if (params.analyzerDisagreement) {
      breakdown.push({ reason: 'OPERATOR_AI_DISAGREEMENT', delta: 15 });
      reasons.push('OPERATOR_AI_DISAGREEMENT');
    }

    // 5. Bounding Box Correction (+10)
    if (params.hasBoundingBoxEdits) {
      breakdown.push({ reason: 'OBJECT_BOUNDING_BOX_CORRECTION', delta: 10 });
      reasons.push('OBJECT_BOUNDING_BOX_CORRECTION');
    }

    const rawTotal = breakdown.reduce((sum, item) => sum + item.delta, 0);
    const totalScore = Math.min(100, rawTotal);

    return { totalScore, breakdown, reasons };
  }

  public async evaluateAndPersistCandidate(log: IAiValidationLog): Promise<IAiDatasetCandidate | null> {
    try {
      const snapshot = await AiSnapshotModel.findById(log.snapshotId).exec();
      if (!snapshot) {
        console.warn(`[CANDIDATE_SELECTOR] Snapshot ${log.snapshotId} not found.`);
        return null;
      }

      const uncertaintyScore = snapshot.decision ? (snapshot.decision.uncertaintyScore || 0) : 0;
      const violationScore = snapshot.decision ? (snapshot.decision.violationScore || 0) : 0;

      const isDisagreement = [
        'FALSE_OBJECT_DETECTION',
        'DISPOSING_IN_BIN',
        'CLEANING_ACTIVITY',
        'PERSON_ONLY',
        'TRASH_ONLY'
      ].includes(log.operatorDecision);

      const hasBoundingBoxEdits = Array.isArray(log.correctedObjects) && log.correctedObjects.length > 0;
      const isOperatorCorrected = isDisagreement || hasBoundingBoxEdits;

      const { totalScore, breakdown, reasons } = this.calculateCandidateScore({
        uncertaintyScore,
        isOperatorCorrected,
        violationScore,
        analyzerDisagreement: isDisagreement,
        hasBoundingBoxEdits
      });

      // Target Model Categorization
      let targetModel: TargetModelType = 'OBJECT_DETECTOR';
      if (hasBoundingBoxEdits || log.operatorDecision === 'FALSE_OBJECT_DETECTION') {
        targetModel = 'OBJECT_DETECTOR';
      } else if (log.operatorDecision === 'DISPOSING_IN_BIN' || log.operatorDecision === 'CLEANING_ACTIVITY') {
        targetModel = 'POLICY_CALIBRATION';
      } else {
        targetModel = 'OBJECT_DETECTOR';
      }

      // Candidate Threshold Gate: Score >= 35 or operator corrected
      if (totalScore < 35 && !isOperatorCorrected) {
        console.log(`[CANDIDATE_SELECTOR] Snapshot ${snapshot._id} skipped: score ${totalScore} below threshold 35.`);
        return null;
      }

      // Check existing current candidate for this snapshot & targetModel
      const existingCandidate = await AiDatasetCandidateModel.findOne({
        snapshotId: snapshot._id,
        targetModel,
        isCurrentEvaluation: true
      }).exec();

      if (existingCandidate) {
        // If APPROVED or ASSIGNED_TO_DATASET, mark old candidate as SUPERSEDED (do NOT mutate APPROVED candidate!)
        if (existingCandidate.approvalStatus === 'APPROVED' || existingCandidate.approvalStatus === 'ASSIGNED_TO_DATASET') {
          existingCandidate.isCurrentEvaluation = false;
          existingCandidate.supersededAt = new Date();
          await existingCandidate.save();
          console.log(`[CANDIDATE_SELECTOR] Marked Candidate ${existingCandidate._id} as SUPERSEDED for Snapshot ${snapshot._id}`);
        }
      }

      const idempotencyKey = `candidate-${snapshot._id}-${targetModel}-${CandidateSelector.SELECTOR_VERSION}-v${log.validationVersion}`;

      const candidate = await AiDatasetCandidateModel.findOneAndUpdate(
        { idempotencyKey },
        {
          $set: {
            idempotencyKey,
            reportId: log.reportId,
            reportObjectId: log.reportObjectId,
            snapshotId: log.snapshotId,
            validationLogId: log._id,
            validationVersion: log.validationVersion,
            selectorVersion: CandidateSelector.SELECTOR_VERSION,
            targetModel,
            candidateScore: totalScore,
            scoreBreakdown: breakdown,
            selectionReasons: reasons,
            operatorDecision: log.operatorDecision,
            predictedStatus: snapshot.decision ? snapshot.decision.status : '',
            predictedScore: snapshot.decision ? snapshot.decision.violationScore : null,
            inputImageHash: snapshot.inputImageHash || log.inputImageHash || '',
            approvalStatus: 'PENDING_APPROVAL',
            isCurrentEvaluation: true,
            evaluatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      ).exec();

      console.log(`[CANDIDATE_SELECTOR] Persisted Candidate ${candidate._id} for Snapshot ${snapshot._id} (Score: ${totalScore}, Model: ${targetModel}, Rev: v${log.validationVersion})`);
      return candidate;
    } catch (err: any) {
      if (err.code === 11000 || (err.message && err.message.includes('E11000'))) {
        return await AiDatasetCandidateModel.findOne({
          snapshotId: log.snapshotId,
          targetModel: 'OBJECT_DETECTOR',
          selectorVersion: CandidateSelector.SELECTOR_VERSION
        }).exec();
      }
      console.error('[CANDIDATE_SELECTOR_ERROR] Failed to evaluate candidate:', err);
      return null;
    }
  }
}

export const candidateSelector = new CandidateSelector();
