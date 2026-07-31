/**
 * EYECO AI Engine v3.0 — Layer 2 Fusion: Cross-Layer Evidence Fusion Service
 * Evaluates candidate objects (confidence 0.20 - 0.34) against categorized signals.
 * Separates objectExistenceStatus ('CONFIRMED' | 'CANDIDATE' | 'REJECTED') from policyEvidenceRole ('POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNAVAILABLE').
 * Requires independent non-circular observation for OBJECT_EXISTENCE confirmation.
 */

import { YoloObject, PersonPose, HumanTrashRelation } from '../types/ai.types';

export type FusionEvidenceCategory =
  | 'OBJECT_EXISTENCE'
  | 'HUMAN_INTERACTION'
  | 'TEMPORAL_SUPPORT'
  | 'ENVIRONMENT_CONTEXT'
  | 'CONFLICT'
  | 'QUALITY_WARNING';

export interface FusionSignal {
  evidenceId: string;
  category: FusionEvidenceCategory;
  code: string;
  confidence: number | null;
  sourceLayer: string;
}

export interface FusionDecision {
  detectionId: string;
  originalConfidence: number;
  candidateClass: string;
  objectExistenceStatus: 'CONFIRMED' | 'CANDIDATE' | 'REJECTED';
  policyEvidenceRole: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNAVAILABLE';
  acceptanceReason: string;
  supportSignals: FusionSignal[];
  conflictSignals: FusionSignal[];
  fusionConfidence: number;
  fusionRuleVersion: 'fusion-v1';
}

export class CrossLayerEvidenceFusionService {
  public static readonly FUSION_RULE_VERSION = 'fusion-v1';
  public static readonly CANDIDATE_THRESHOLD = 0.20;
  public static readonly DECISION_THRESHOLD = 0.35;

  public static evaluateCandidateSupport(
    object: YoloObject,
    poses: PersonPose[],
    relations: HumanTrashRelation[],
    sceneType?: string,
    isInsideBin?: boolean,
    secondaryCropConfirmed?: boolean
  ): FusionDecision {
    const rawConf = object.confidence;
    const detectionId = (object as any).detectionId || `det-${object.class}-${Math.round(object.x)}_${Math.round(object.y)}`;

    // Direct conflict check (e.g. object inside trash bin)
    const conflictSignals: FusionSignal[] = [];
    if (isInsideBin) {
      conflictSignals.push({
        evidenceId: `conflict:inside_bin:${detectionId}`,
        category: 'CONFLICT',
        code: 'TRASH_INSIDE_BIN',
        confidence: 0.90,
        sourceLayer: 'SEMANTIC_ANALYZER'
      });

      return {
        detectionId,
        originalConfidence: rawConf,
        candidateClass: object.class,
        objectExistenceStatus: rawConf >= this.CANDIDATE_THRESHOLD ? 'CONFIRMED' : 'REJECTED',
        policyEvidenceRole: 'NEGATIVE', // Safe disposal, reduces violation score
        acceptanceReason: 'REJECTED_BY_CONFLICT_INSIDE_BIN',
        supportSignals: [],
        conflictSignals,
        fusionConfidence: rawConf,
        fusionRuleVersion: this.FUSION_RULE_VERSION
      };
    }

    // Direct acceptance for high-confidence detections (>= 0.35)
    if (rawConf >= this.DECISION_THRESHOLD) {
      return {
        detectionId,
        originalConfidence: rawConf,
        candidateClass: object.class,
        objectExistenceStatus: 'CONFIRMED',
        policyEvidenceRole: 'POSITIVE',
        acceptanceReason: 'ABOVE_DECISION_THRESHOLD',
        supportSignals: [{
          evidenceId: `yolo:${object.class}:${Math.round(rawConf * 100)}%`,
          category: 'OBJECT_EXISTENCE',
          code: 'YOLO_HIGH_CONFIDENCE',
          confidence: rawConf,
          sourceLayer: 'LAYER_1A_OBJECT_DETECTION'
        }],
        conflictSignals: [],
        fusionConfidence: rawConf,
        fusionRuleVersion: this.FUSION_RULE_VERSION
      };
    }

    // Direct rejection if below candidate threshold (< 0.20)
    if (rawConf < this.CANDIDATE_THRESHOLD) {
      return {
        detectionId,
        originalConfidence: rawConf,
        candidateClass: object.class,
        objectExistenceStatus: 'REJECTED',
        policyEvidenceRole: 'UNAVAILABLE',
        acceptanceReason: 'BELOW_CANDIDATE_THRESHOLD',
        supportSignals: [],
        conflictSignals: [{
          evidenceId: `conflict:below_candidate:${detectionId}`,
          category: 'QUALITY_WARNING',
          code: 'BELOW_CANDIDATE_THRESHOLD',
          confidence: rawConf,
          sourceLayer: 'LAYER_1A_OBJECT_DETECTION'
        }],
        fusionConfidence: rawConf,
        fusionRuleVersion: this.FUSION_RULE_VERSION
      };
    }

    // Candidate range (0.20 <= conf < 0.35): Strict Non-Circular Multi-Signal Policy
    const supportSignals: FusionSignal[] = [];

    // 1. Independent OBJECT_EXISTENCE (Only if secondary crop / multi-scale confirms object!)
    if (secondaryCropConfirmed) {
      supportSignals.push({
        evidenceId: `secondary_crop:${detectionId}`,
        category: 'OBJECT_EXISTENCE',
        code: 'SECONDARY_CROP_CONFIRMATION',
        confidence: 0.80,
        sourceLayer: 'LAYER_1A_SECONDARY_DETECTOR'
      });
    }

    // 2. HUMAN_INTERACTION: Wrist proximity
    const hasWristProximity = relations.some(r => r.nearestWristDistanceNormalized !== null && r.nearestWristDistanceNormalized <= 0.70);
    if (hasWristProximity) {
      supportSignals.push({
        evidenceId: `pose:wrist_proximity:${detectionId}`,
        category: 'HUMAN_INTERACTION',
        code: 'WRIST_PROXIMITY_SUPPORT',
        confidence: 0.85,
        sourceLayer: 'LAYER_2_SPATIAL_ANALYZER'
      });
    }

    // 3. HUMAN_INTERACTION: Keypoint / holding pose context
    const hasPoseSupport = poses.some(p => p.keypoints && p.keypoints.length > 0);
    if (hasPoseSupport) {
      supportSignals.push({
        evidenceId: `pose:holding_context:${detectionId}`,
        category: 'HUMAN_INTERACTION',
        code: 'POSE_CONTEXT_SUPPORT',
        confidence: 0.80,
        sourceLayer: 'LAYER_1B_POSE_ESTIMATION'
      });
    }

    // 4. ENVIRONMENT_CONTEXT (Informational only — cannot confirm candidate alone!)
    if (sceneType && ['RIVER', 'RIVERBANK', 'ROAD', 'PUBLIC_AREA'].includes(sceneType)) {
      supportSignals.push({
        evidenceId: `scene:${sceneType}:${detectionId}`,
        category: 'ENVIRONMENT_CONTEXT',
        code: `ENVIRONMENT_${sceneType}`,
        confidence: 0.75,
        sourceLayer: 'LAYER_2_SEMANTIC_ANALYZER'
      });
    }

    // Strict Non-Circular Corroboration Rule:
    // Candidate requires INDEPENDENT OBJECT_EXISTENCE (secondary crop) AND HUMAN_INTERACTION or TEMPORAL_SUPPORT
    const hasIndependentExistence = supportSignals.some(s => s.category === 'OBJECT_EXISTENCE');
    const hasHumanOrTemporal = supportSignals.some(s => s.category === 'HUMAN_INTERACTION' || s.category === 'TEMPORAL_SUPPORT');
    const isCorroborated = hasIndependentExistence && hasHumanOrTemporal;

    return {
      detectionId,
      originalConfidence: rawConf,
      candidateClass: object.class,
      objectExistenceStatus: isCorroborated ? 'CONFIRMED' : 'CANDIDATE',
      policyEvidenceRole: isCorroborated ? 'POSITIVE' : 'UNAVAILABLE',
      acceptanceReason: isCorroborated
        ? 'CROSS_LAYER_CORROBORATED (INDEPENDENT_EXISTENCE + HUMAN_INTERACTION)'
        : 'CANDIDATE_ONLY (requires independent secondary crop confirmation for score inclusion)',
      supportSignals,
      conflictSignals: [],
      fusionConfidence: isCorroborated ? Math.min(0.85, rawConf + 0.20) : rawConf,
      fusionRuleVersion: this.FUSION_RULE_VERSION
    };
  }
}
