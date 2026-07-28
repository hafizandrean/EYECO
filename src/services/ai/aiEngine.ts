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
import { decisionEngine } from './decisionEngine/decisionEngine';
import { explainableService } from './explainable/explainable.service';
import { AiSnapshotModel, IAiSnapshot } from '../../database/models/AiSnapshot';
import { YoloObject, EvidenceItem, DecisionResult, FeatureVector } from './types/ai.types';

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

    // 2. Layer 1A — YOLO Object Detection
    const yoloResult = await yoloObjectDetector.detect(imagePath);
    const objects = yoloResult.objects;

    // 3. Layer 1B — Human Pose Estimation (Graceful Degradation Guardrail #1)
    const personBoxes = objects.filter(o => o.class === 'person' || o.class === 'orang');
    const poseResult = await yoloPoseService.estimate(imagePath, personBoxes);

    // 4. Layer 2 — Scene Understanding Analyzers
    const analyzersAvailable = ['YOLO_OBJECT'];
    if (poseResult.available) analyzersAvailable.push('POSE_ESTIMATION');

    const spatialData = spatialAnalyzer.analyzeSpatial(objects, poseResult.poses);
    analyzersAvailable.push('SPATIAL_ANALYZER');

    const semanticData = semanticAnalyzer.analyzeSemantic(objects);
    analyzersAvailable.push('SEMANTIC_ANALYZER');

    const regionData = regionAnalyzer.analyzeRegion(objects);
    analyzersAvailable.push('REGION_ANALYZER');

    // Consolidate all evidence items
    const allEvidence: EvidenceItem[] = [
      ...spatialData.evidence,
      ...semanticData.evidence,
      ...regionData.evidence,
    ];

    // 5. Layer 2.5 — Feature Extraction (Schema: feature-v1)
    const featureVector = featureExtractorService.extractFeatures(
      objects,
      poseResult.poses,
      spatialData.relations,
      semanticData,
      analyzersAvailable,
      yoloResult.qualityStatus ? {
        blurScore: yoloResult.blurScore ?? 0,
        brightnessScore: 80,
        resolutionAdequate: true,
        qualityStatus: yoloResult.qualityStatus === 'BLURRY' ? 'POOR'
          : yoloResult.qualityStatus === 'LOW' ? 'ACCEPTABLE'
          : 'GOOD',
      } : undefined
    );

    // 6. Layer 3 — Decision Engine (Strategy Pattern + Policy Validation)
    const decision = decisionEngine.evaluate(featureVector);

    // 7. Layer Explainable — Explainable AI Checklist & Limitations
    const explainableReport = explainableService.generateExplainableReport(allEvidence, decision, featureVector);

    // 8. Generate Analysis ID & Model Registry Metadata
    const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const modelRegistryInfo = {
      yoloVersion: 'v8.2.0-yolov8n',
      poseVersion: poseResult.available ? 'yolov8n-pose-v1.0' : 'disabled-fallback',
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
      extractedFramePath: yoloResult.extractedFramePath,
    };
  }
}

export const aiEngine = new AiEngine();
