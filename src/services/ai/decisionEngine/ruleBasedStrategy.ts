/**
 * EYECO AI Engine v3.0 — Layer 3: Rule-Based Decision Strategy
 * Policy-Driven Heuristic Decision Engine with deterministic score thresholds.
 */

import { IDecisionStrategy } from './decisionStrategy.interface';
import { FeatureVector, DecisionResult, AiIndicationStatus, OperationalPriority } from '../types/ai.types';
import { loadDecisionPolicy } from './policyLoader';

export class RuleBasedStrategy implements IDecisionStrategy {
  public evaluate(fv: FeatureVector): DecisionResult {
    const policy = loadDecisionPolicy();
    const w = policy.weights;

    let score = 0;

    if (fv.personCount > 0) score += (w.personDetected || 10);
    else score += (w.noPersonDetected || -15);

    if (fv.trashCount > 0) {
      score += (w.trashDetected || 25);
      if (fv.highestTrashConfidence >= 75) score += (w.trashHighConfidence || 10);
    } else {
      score += (w.noTrashDetected || -30);
    }

    if (fv.trashNearWrist) score += (w.trashNearWrist || 20);
    if (fv.possibleReleasePose) score += (w.trashAppearsAirborne || 15);
    if (fv.trashOnWaterZone) score += (w.trashOnWaterZone || 15);
    if (fv.trashOnRoadZone) score += (w.trashOnRoadZone || 10);
    if (fv.trashInsideBinZone) score += (w.trashInsideBinZone || -35);
    if (fv.trashLargePile) score += (w.trashLargePile || 30);

    // Clamp score to 0 - 100
    const violationScore = Math.max(0, Math.min(100, Math.round(score)));

    // Calculate Heuristic Decision Confidence
    const evidenceCoverageFactor = fv.evidenceCoverage * 25;
    const objectReliabilityFactor = (fv.highestTrashConfidence > 0 ? fv.highestTrashConfidence / 100 : (fv.personCount > 0 ? 0.7 : 0.4)) * 25;
    const sceneReliabilityFactor = (fv.analyzersAvailable.length >= 3 ? 0.9 : 0.6) * 20;
    const analyzerAgreementFactor = (fv.trashInsideBinZone || (fv.trashCount === 0 && fv.personCount > 0) ? 0.95 : 0.8) * 20;
    
    // Image quality impact on decision confidence
    let imageQualityFactor = 0.9 * 10;
    if (fv.imageQuality && fv.imageQuality.qualityStatus === 'POOR') {
      imageQualityFactor = 0.2 * 10;
    }

    const calculatedConfidence = Math.round(
      evidenceCoverageFactor + objectReliabilityFactor + sceneReliabilityFactor + analyzerAgreementFactor + imageQualityFactor
    );
    let decisionConfidence = Math.max(10, Math.min(100, calculatedConfidence));
    if (fv.imageQuality && fv.imageQuality.qualityStatus === 'POOR') {
      decisionConfidence = Math.max(10, decisionConfidence - 25);
    }
    const uncertaintyScore = 100 - decisionConfidence;

    // Object confidence & scene confidence
    const objectConfidence = fv.highestTrashConfidence > 0 ? fv.highestTrashConfidence : fv.highestPersonConfidence;
    const sceneConfidence = Math.round(fv.evidenceCoverage * 100);

    // Deterministic Threshold Mapping (Guardrail Review #2)
    // 0–24   = Tidak Terindikasi
    // 25–49  = Indikasi Rendah
    // 50–74  = Indikasi Sedang
    // 75–100 = Indikasi Tinggi
    let status: AiIndicationStatus = 'Tidak Terindikasi';

    if (violationScore >= policy.thresholds.highMinScore && fv.trashCount > 0 && !fv.trashInsideBinZone) {
      status = 'Indikasi Tinggi';
    } else if (violationScore >= policy.thresholds.mediumMinScore && fv.trashCount > 0 && !fv.trashInsideBinZone) {
      status = 'Indikasi Sedang';
    } else if (violationScore >= policy.thresholds.lowMinScore && fv.trashCount > 0 && !fv.trashInsideBinZone) {
      status = 'Indikasi Rendah';
    } else {
      status = 'Tidak Terindikasi';
    }

    // Determine Operational Priority Strictly: NONE | LOW | MEDIUM | HIGH
    let priority: OperationalPriority = 'NONE';
    let recommendedAction = 'Tidak diperlukan tindakan otomatis';

    if (status === 'Tidak Terindikasi') {
      priority = 'NONE';
      recommendedAction = 'Tidak diperlukan tindakan otomatis';
    } else if (status === 'Indikasi Rendah') {
      priority = 'LOW';
      recommendedAction = 'Pantau berkala oleh sistem';
    } else if (status === 'Indikasi Sedang') {
      priority = 'MEDIUM';
      recommendedAction = 'Verifikasi operator diperlukan';
    } else if (status === 'Indikasi Tinggi') {
      priority = 'HIGH';
      recommendedAction = 'Verifikasi operator segera & siarkan alert Telegram';
    }

    const needsHumanValidation = uncertaintyScore >= 30 || status === 'Indikasi Sedang' || status === 'Indikasi Tinggi' || (fv.imageQuality && fv.imageQuality.qualityStatus === 'POOR');

    return {
      status,
      violationScore,
      objectConfidence,
      sceneConfidence,
      decisionConfidence,
      uncertaintyScore,
      confidenceType: 'HEURISTIC_RELIABILITY',
      priority,
      recommendedAction,
      needsHumanValidation,
      policyVersion: policy.policyVersion,
    };
  }
}

export const ruleBasedStrategy = new RuleBasedStrategy();
