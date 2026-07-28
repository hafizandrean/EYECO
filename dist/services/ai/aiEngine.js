"use strict";
/**
 * EYECO AI Engine v3.0 — AI Pipeline Orchestrator (Single Entry Point)
 * Encapsulates Layer 1A -> 1B -> 2 -> 2.5 -> 3 -> Explainable -> Atomic Immutable AiSnapshot Storage.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiEngine = exports.AiEngine = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const yolo_service_1 = require("./objectDetection/yolo.service");
const yoloPose_service_1 = require("./poseEstimation/yoloPose.service");
const spatialAnalyzer_1 = require("./sceneUnderstanding/spatialAnalyzer");
const semanticAnalyzer_1 = require("./sceneUnderstanding/semanticAnalyzer");
const regionAnalyzer_1 = require("./sceneUnderstanding/regionAnalyzer");
const featureExtractor_service_1 = require("./featureExtraction/featureExtractor.service");
const decisionEngine_1 = require("./decisionEngine/decisionEngine");
const explainable_service_1 = require("./explainable/explainable.service");
const AiSnapshot_1 = require("../../database/models/AiSnapshot");
class AiEngine {
    static PIPELINE_VERSION = 'v3.0.0';
    /**
     * Primary entry point for AI analysis on an image
     */
    async analyze(imagePath, options = {}) {
        // 1. Calculate image MD5 hash for Idempotency Check (Guardrail #6)
        let inputImageHash = 'hash-fallback';
        try {
            if (fs_1.default.existsSync(imagePath)) {
                const fileBuffer = fs_1.default.readFileSync(imagePath);
                inputImageHash = crypto_1.default.createHash('md5').update(fileBuffer).digest('hex');
            }
        }
        catch (err) {
            console.warn('[AI_ENGINE] Could not compute image hash:', err.message);
        }
        // Check existing snapshot for idempotency unless forceReanalysis is true
        if (!options.forceReanalysis) {
            const existing = await AiSnapshot_1.AiSnapshotModel.findOne({
                inputImageHash,
                pipelineVersion: AiEngine.PIPELINE_VERSION,
                ...(options.reportId ? { reportId: options.reportId } : {})
            })
                .sort({ createdAt: -1 })
                .exec();
            if (existing) {
                console.log(`[AI_ENGINE] Idempotent hit: returning existing snapshot ${existing.analysisId}`);
                const objs = (existing.evidenceItems || []).map(e => e.value).filter(Boolean);
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
        const yoloResult = await yolo_service_1.yoloObjectDetector.detect(imagePath);
        const objects = yoloResult.objects;
        // 3. Layer 1B — Human Pose Estimation (Graceful Degradation Guardrail #1)
        const personBoxes = objects.filter(o => o.class === 'person' || o.class === 'orang');
        const poseResult = await yoloPose_service_1.yoloPoseService.estimate(imagePath, personBoxes);
        // 4. Layer 2 — Scene Understanding Analyzers
        const analyzersAvailable = ['YOLO_OBJECT'];
        if (poseResult.available)
            analyzersAvailable.push('POSE_ESTIMATION');
        const spatialData = spatialAnalyzer_1.spatialAnalyzer.analyzeSpatial(objects, poseResult.poses);
        analyzersAvailable.push('SPATIAL_ANALYZER');
        const semanticData = semanticAnalyzer_1.semanticAnalyzer.analyzeSemantic(objects);
        analyzersAvailable.push('SEMANTIC_ANALYZER');
        const regionData = regionAnalyzer_1.regionAnalyzer.analyzeRegion(objects);
        analyzersAvailable.push('REGION_ANALYZER');
        // Consolidate all evidence items
        const allEvidence = [
            ...spatialData.evidence,
            ...semanticData.evidence,
            ...regionData.evidence,
        ];
        // 5. Layer 2.5 — Feature Extraction (Schema: feature-v1)
        const featureVector = featureExtractor_service_1.featureExtractorService.extractFeatures(objects, poseResult.poses, spatialData.relations, semanticData, analyzersAvailable, yoloResult.qualityStatus ? {
            blurScore: yoloResult.blurScore ?? 0,
            brightnessScore: 80,
            resolutionAdequate: true,
            qualityStatus: yoloResult.qualityStatus === 'BLURRY' ? 'POOR'
                : yoloResult.qualityStatus === 'LOW' ? 'ACCEPTABLE'
                    : 'GOOD',
        } : undefined);
        // 6. Layer 3 — Decision Engine (Strategy Pattern + Policy Validation)
        const decision = decisionEngine_1.decisionEngine.evaluate(featureVector);
        // 7. Layer Explainable — Explainable AI Checklist & Limitations
        const explainableReport = explainable_service_1.explainableService.generateExplainableReport(allEvidence, decision, featureVector);
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
        const snapshot = await AiSnapshot_1.AiSnapshotModel.create({
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
            parentSnapshotId: options.parentSnapshotId ? options.parentSnapshotId : null,
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
exports.AiEngine = AiEngine;
exports.aiEngine = new AiEngine();
