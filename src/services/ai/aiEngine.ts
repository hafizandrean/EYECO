/**
 * EYECO AI Engine v3.0 — AI Pipeline Orchestrator (Single Entry Point)
 * Encapsulates Layer 1A -> 1B -> 2 -> 2.5 -> 3 -> Explainable -> Atomic Immutable AiSnapshot Storage.
 */

import crypto from 'crypto';
import fs from 'fs';
import { yoloObjectDetector } from './objectDetection/yolo.service';
import { yoloPoseService } from './poseEstimation/yoloPose.service';
import { spatialAnalyzer } from './sceneUnderstanding/spatialAnalyzer';
import { semanticAnalyzer } from './sceneUnderstanding/semanticAnalyzer';
import { regionAnalyzer } from './sceneUnderstanding/regionAnalyzer';
import { featureExtractorService } from './featureExtraction/featureExtractor.service';
import { CrossLayerEvidenceFusionService, FusionDecision } from './sceneUnderstanding/CrossLayerEvidenceFusionService';
import { decisionEngine } from './decisionEngine/decisionEngine';
import { explainableService } from './explainable/explainable.service';
import { AiSnapshotModel, IAiSnapshot } from '../../database/models/AiSnapshot';
import { YoloObject, EvidenceItem, DecisionResult, FeatureVector, LayerResult } from './types/ai.types';

async function safeRunLayer<T>(
  layerId: string,
  operation: () => Promise<T> | T,
  options: { modelVersion?: string; timeoutMs?: number; isDependencyAvailable?: boolean } = {}
): Promise<LayerResult<T>> {
  const { modelVersion, timeoutMs = 15_000, isDependencyAvailable = true } = options;
  const startedAt = Date.now();

  if (!isDependencyAvailable) {
    return {
      layerId,
      available: false,
      value: null,
      confidence: null,
      qualityScore: 0,
      warnings: [`${layerId}_DEPENDENCY_UNAVAILABLE`],
      failureCode: 'DEPENDENCY_UNAVAILABLE',
      processingTimeMs: 0,
      modelVersion
    };
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`LAYER_TIMEOUT (${timeoutMs}ms)`)), timeoutMs);
    });

    const value = await Promise.race([Promise.resolve(operation()), timeoutPromise]);

    return {
      layerId,
      available: true,
      value,
      confidence: null,
      qualityScore: 1,
      warnings: [],
      processingTimeMs: Date.now() - startedAt,
      modelVersion
    };
  } catch (error: any) {
    return {
      layerId,
      available: false,
      value: null,
      confidence: null,
      qualityScore: 0,
      warnings: [`${layerId}_UNAVAILABLE`],
      failureCode: error.message?.includes('TIMEOUT') ? 'LAYER_TIMEOUT' : (error.message || 'RUNTIME_ERROR'),
      processingTimeMs: Date.now() - startedAt,
      modelVersion
    };
  }
}

export class AiEngine {
  public static readonly PIPELINE_VERSION = 'v3.0.0';

  /**
   * Primary entry point for AI analysis on an image
   */
  public async analyze(
    imagePath: string,
    options: {
      reportId?: number;
      parentSnapshotId?: string;
      forceReanalysis?: boolean;
    } = {}
  ): Promise<{
    snapshot: IAiSnapshot;
    objects: YoloObject[];
    decision: DecisionResult;
    featureVector: FeatureVector;
    evidenceItems: EvidenceItem[];
    limitations: string[];
    extractedFramePath?: string;
  }> {
    return this.analyzeInternal(imagePath, options);
  }

  public async analyzeImage(
    imagePath: string,
    options: {
      reportId?: number;
      parentSnapshotId?: string;
      forceReanalysis?: boolean;
    } = {}
  ) {
    return this.analyzeInternal(imagePath, options);
  }

  private async analyzeInternal(
    imagePath: string,
    options: {
      reportId?: number;
      parentSnapshotId?: string;
      forceReanalysis?: boolean;
    } = {}
  ): Promise<{
    snapshot: IAiSnapshot;
    objects: YoloObject[];
    decision: DecisionResult;
    featureVector: FeatureVector;
    evidenceItems: EvidenceItem[];
    limitations: string[];
    extractedFramePath?: string;
  }> {
    // 1. Calculate image MD5 hash for Idempotency Check (Guardrail #6)
    let inputImageHash = 'hash-fallback';
    try {
      if (fs.existsSync(imagePath)) {
        const fileBuffer = fs.readFileSync(imagePath);
        inputImageHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
      }
    } catch (err: any) {
      console.warn('[AI_ENGINE] Could not compute image hash:', err.message);
    }

    // Check existing snapshot for idempotency unless forceReanalysis is true
    if (!options.forceReanalysis) {
      const existing = await AiSnapshotModel.findOne({
        inputImageHash,
        pipelineVersion: AiEngine.PIPELINE_VERSION,
        ...(options.reportId ? { reportId: options.reportId } : {})
      })
        .sort({ createdAt: -1 })
        .exec();

      if (existing) {
        console.log(`[AI_ENGINE] Idempotent hit: returning existing snapshot ${existing.analysisId}`);
        const objs = ((existing.evidenceItems || []) as any[]).map(e => e.value).filter(Boolean);
        return {
          snapshot: existing,
          objects: [],
          decision: existing.decision,
          featureVector: existing.featureVector,
          evidenceItems: existing.evidenceItems,
          limitations: existing.limitations || [],
        };
      }
    }

    // 2. Layer 1A — YOLO Object Detection (safeRunLayer)
    const objectLayerRes = await safeRunLayer('LAYER_1A_OBJECT_DETECTION', () => yoloObjectDetector.detect(imagePath), { modelVersion: 'v8.2.0-yolov8n', timeoutMs: 30_000 });
    const objects = objectLayerRes.value ? objectLayerRes.value.objects : [];

    // 3. Layer 1B — Human Pose Estimation (safeRunLayer - Depends on Object Detection)
    const personBoxes = objects.filter(o => o.class === 'person' || o.class === 'orang');
    const poseLayerRes = await safeRunLayer('LAYER_1B_POSE_ESTIMATION', () => yoloPoseService.estimate(imagePath, personBoxes), {
      modelVersion: 'yolov8n-pose-v1.0',
      timeoutMs: 15_000,
      isDependencyAvailable: objectLayerRes.available
    });
    const poses = poseLayerRes.value ? poseLayerRes.value.poses : [];

    // 4. Layer 2 — Scene Understanding Analyzers (safeRunLayer)
    const analyzersAvailable = ['YOLO_OBJECT'];
    if (poseLayerRes.available) analyzersAvailable.push('POSE_ESTIMATION');

    const spatialLayerRes = await safeRunLayer('LAYER_2_SPATIAL_ANALYZER', () => spatialAnalyzer.analyzeSpatial(objects, poses), {
      modelVersion: 'SpatialAnalyzer-v1.0',
      timeoutMs: 10_000,
      isDependencyAvailable: objectLayerRes.available
    });
    const spatialData = spatialLayerRes.value || { relations: [], evidence: [], nearestWristDistanceNormalized: null, trashNearWrist: false, possibleReleasePose: false };
    if (spatialLayerRes.available) analyzersAvailable.push('SPATIAL_ANALYZER');

    const semanticLayerRes = await safeRunLayer('LAYER_2_SEMANTIC_ANALYZER', () => semanticAnalyzer.analyzeSemantic(objects), {
      modelVersion: 'SemanticAnalyzer-v1.0',
      timeoutMs: 10_000,
      isDependencyAvailable: objectLayerRes.available
    });
    const semanticData = semanticLayerRes.value || { riverDetected: false, roadDetected: false, trashInsideBin: false, evidence: [] };
    if (semanticLayerRes.available) analyzersAvailable.push('SEMANTIC_ANALYZER');

    const regionLayerRes = await safeRunLayer('LAYER_2_REGION_ANALYZER', () => regionAnalyzer.analyzeRegion(objects), {
      modelVersion: 'RegionAnalyzer-v1.0',
      timeoutMs: 10_000,
      isDependencyAvailable: objectLayerRes.available
    });
    const regionData = regionLayerRes.value || { evidence: [], restrictedZoneOverlap: false };
    if (regionLayerRes.available) analyzersAvailable.push('REGION_ANALYZER');

    // Evaluate CrossLayerEvidenceFusionService for each object
    const sceneType = semanticData.riverDetected ? 'RIVERBANK' : (semanticData.roadDetected ? 'ROAD' : 'PUBLIC_AREA');
    const fusionDecisions: FusionDecision[] = objects.map(o =>
      CrossLayerEvidenceFusionService.evaluateCandidateSupport(
        o,
        poses,
        spatialData.relations,
        sceneType,
        semanticData.trashInsideBin
      )
    );

    // Consolidate all evidence items
    const allEvidence: EvidenceItem[] = [
      ...spatialData.evidence,
      ...semanticData.evidence,
      ...regionData.evidence,
    ];

    // 5. Layer 2.5 — Feature Extraction (Schema: feature-v1)
    const featureLayerRes = await safeRunLayer('LAYER_2.5_FEATURE_EXTRACTION', () => featureExtractorService.extractFeatures(
      objects,
      poses,
      spatialData.relations,
      semanticData,
      analyzersAvailable,
      fusionDecisions
    ), { modelVersion: 'feature-v1', timeoutMs: 5_000, isDependencyAvailable: objectLayerRes.available });
    const featureVector = featureLayerRes.value || featureExtractorService.extractFeatures(objects, [], [], { riverDetected: false, roadDetected: false, trashInsideBin: false }, []);

    // 6. Layer 3 — Decision Engine (Strategy Pattern + Policy Validation)
    const decision = decisionEngine.evaluate(featureVector);

    // Critical vs Optional Layer Failure Handling
    if (!objectLayerRes.available || !featureLayerRes.available) {
      decision.status = null;
      decision.violationScore = null;
      decision.priority = null;
      decision.decisionConfidence = null;
      decision.uncertaintyScore = 100;
      decision.needsHumanValidation = true;
      decision.recommendedAction = 'Analisis AI tidak lengkap. Lakukan pemeriksaan operator atau analisis ulang.';
      decision.analysisOutcome = 'INCOMPLETE';
    } else if (!poseLayerRes.available || !spatialLayerRes.available || !semanticLayerRes.available) {
      decision.analysisOutcome = 'COMPLETE_WITH_LIMITATIONS';
      decision.uncertaintyScore = Math.min(100, decision.uncertaintyScore + 25);
      decision.decisionConfidence = Math.max(0, 100 - decision.uncertaintyScore);
      decision.needsHumanValidation = true;
    } else {
      decision.analysisOutcome = 'COMPLETE';
    }

    // 7. Layer Explainable — Explainable AI Checklist & Limitations
    const explainableReport = explainableService.generateExplainableReport(allEvidence, decision, featureVector);

    // 8. Generate Analysis ID & Model Registry Metadata
    const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const modelRegistryInfo = {
      yoloVersion: 'v8.2.0-yolov8n',
      poseVersion: poseLayerRes.available ? 'yolov8n-pose-v1.0' : 'disabled-fallback',
      sceneVersion: 'SpatialAnalyzer-v1.0',
      decisionVersion: 'RuleEngine-v1.0',
      datasetVersion: 'dataset-v1.0',
      featureSchemaVersion: 'feature-v1',
      policyVersion: decision.policyVersion,
    };

    // 9. Atomic Immutable Storage of AiSnapshot (Guardrail #4 & #5)
    const snapshot = await AiSnapshotModel.create({
      analysisId,
      reportId: options.reportId,
      inputImageHash,
      imagePath,
      pipelineVersion: AiEngine.PIPELINE_VERSION,
      featureSchemaVersion: 'feature-v1',
      modelRegistryInfo,
      featureVector,
      fusionDecisions,
      evidenceItems: explainableReport.evidenceChecklist,
      decision,
      limitations: explainableReport.limitations,
      parentSnapshotId: options.parentSnapshotId ? (options.parentSnapshotId as any) : null,
    });

    console.log(`[AI_ENGINE] Analysis completed: ${analysisId} | Status: ${decision.status} | Violation Score: ${decision.violationScore}`);

    return {
      snapshot,
      objects,
      decision,
      featureVector,
      evidenceItems: explainableReport.evidenceChecklist,
      limitations: explainableReport.limitations,
      extractedFramePath: objectLayerRes.value ? objectLayerRes.value.extractedFramePath : undefined,
    };
  }
}

export const aiEngine = new AiEngine();
