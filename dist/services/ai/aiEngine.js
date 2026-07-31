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
const CrossLayerEvidenceFusionService_1 = require("./sceneUnderstanding/CrossLayerEvidenceFusionService");
const decisionEngine_1 = require("./decisionEngine/decisionEngine");
const explainable_service_1 = require("./explainable/explainable.service");
const AiSnapshot_1 = require("../../database/models/AiSnapshot");
async function safeRunLayer(layerId, operation, options = {}) {
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
        const timeoutPromise = new Promise((_, reject) => {
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
    }
    catch (error) {
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
class AiEngine {
    static PIPELINE_VERSION = 'v3.0.0';
    /**
     * Primary entry point for AI analysis on an image
     */
    async analyze(imagePath, options = {}) {
        return this.analyzeInternal(imagePath, options);
    }
    async analyzeImage(imagePath, options = {}) {
        return this.analyzeInternal(imagePath, options);
    }
    async analyzeInternal(imagePath, options = {}) {
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
        // 2. Layer 1A — YOLO Object Detection (safeRunLayer)
        const objectLayerRes = await safeRunLayer('LAYER_1A_OBJECT_DETECTION', () => yolo_service_1.yoloObjectDetector.detect(imagePath), { modelVersion: 'v8.2.0-yolov8n', timeoutMs: 30_000 });
        const objects = objectLayerRes.value ? objectLayerRes.value.objects : [];
        // 3. Layer 1B — Human Pose Estimation (safeRunLayer - Depends on Object Detection)
        const personBoxes = objects.filter(o => o.class === 'person' || o.class === 'orang');
        const poseLayerRes = await safeRunLayer('LAYER_1B_POSE_ESTIMATION', () => yoloPose_service_1.yoloPoseService.estimate(imagePath, personBoxes), {
            modelVersion: 'yolov8n-pose-v1.0',
            timeoutMs: 15_000,
            isDependencyAvailable: objectLayerRes.available
        });
        const poses = poseLayerRes.value ? poseLayerRes.value.poses : [];
        // 4. Layer 2 — Scene Understanding Analyzers (safeRunLayer)
        const analyzersAvailable = ['YOLO_OBJECT'];
        if (poseLayerRes.available)
            analyzersAvailable.push('POSE_ESTIMATION');
        const spatialLayerRes = await safeRunLayer('LAYER_2_SPATIAL_ANALYZER', () => spatialAnalyzer_1.spatialAnalyzer.analyzeSpatial(objects, poses), {
            modelVersion: 'SpatialAnalyzer-v1.0',
            timeoutMs: 10_000,
            isDependencyAvailable: objectLayerRes.available
        });
        const spatialData = spatialLayerRes.value || { relations: [], evidence: [], nearestWristDistanceNormalized: null, trashNearWrist: false, possibleReleasePose: false };
        if (spatialLayerRes.available)
            analyzersAvailable.push('SPATIAL_ANALYZER');
        const semanticLayerRes = await safeRunLayer('LAYER_2_SEMANTIC_ANALYZER', () => semanticAnalyzer_1.semanticAnalyzer.analyzeSemantic(objects), {
            modelVersion: 'SemanticAnalyzer-v1.0',
            timeoutMs: 10_000,
            isDependencyAvailable: objectLayerRes.available
        });
        const semanticData = semanticLayerRes.value || { riverDetected: false, roadDetected: false, trashInsideBin: false, evidence: [] };
        if (semanticLayerRes.available)
            analyzersAvailable.push('SEMANTIC_ANALYZER');
        const regionLayerRes = await safeRunLayer('LAYER_2_REGION_ANALYZER', () => regionAnalyzer_1.regionAnalyzer.analyzeRegion(objects), {
            modelVersion: 'RegionAnalyzer-v1.0',
            timeoutMs: 10_000,
            isDependencyAvailable: objectLayerRes.available
        });
        const regionData = regionLayerRes.value || { evidence: [], restrictedZoneOverlap: false };
        if (regionLayerRes.available)
            analyzersAvailable.push('REGION_ANALYZER');
        // Evaluate CrossLayerEvidenceFusionService for each object
        const sceneType = semanticData.riverDetected ? 'RIVERBANK' : (semanticData.roadDetected ? 'ROAD' : 'PUBLIC_AREA');
        const fusionDecisions = objects.map(o => CrossLayerEvidenceFusionService_1.CrossLayerEvidenceFusionService.evaluateCandidateSupport(o, poses, spatialData.relations, sceneType, semanticData.trashInsideBin));
        // Consolidate all evidence items
        const allEvidence = [
            ...spatialData.evidence,
            ...semanticData.evidence,
            ...regionData.evidence,
        ];
        // 5. Layer 2.5 — Feature Extraction (Schema: feature-v1)
        const featureLayerRes = await safeRunLayer('LAYER_2.5_FEATURE_EXTRACTION', () => featureExtractor_service_1.featureExtractorService.extractFeatures(objects, poses, spatialData.relations, semanticData, analyzersAvailable, fusionDecisions), { modelVersion: 'feature-v1', timeoutMs: 5_000, isDependencyAvailable: objectLayerRes.available });
        const featureVector = featureLayerRes.value || featureExtractor_service_1.featureExtractorService.extractFeatures(objects, [], [], { riverDetected: false, roadDetected: false, trashInsideBin: false }, []);
        // 6. Layer 3 — Decision Engine (Strategy Pattern + Policy Validation)
        const decision = decisionEngine_1.decisionEngine.evaluate(featureVector);
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
        }
        else if (!poseLayerRes.available || !spatialLayerRes.available || !semanticLayerRes.available) {
            decision.analysisOutcome = 'COMPLETE_WITH_LIMITATIONS';
            decision.uncertaintyScore = Math.min(100, decision.uncertaintyScore + 25);
            decision.decisionConfidence = Math.max(0, 100 - decision.uncertaintyScore);
            decision.needsHumanValidation = true;
        }
        else {
            decision.analysisOutcome = 'COMPLETE';
        }
        // 7. Layer Explainable — Explainable AI Checklist & Limitations
        const explainableReport = explainable_service_1.explainableService.generateExplainableReport(allEvidence, decision, featureVector);
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
        const snapshot = await AiSnapshot_1.AiSnapshotModel.create({
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
            extractedFramePath: objectLayerRes.value ? objectLayerRes.value.extractedFramePath : undefined,
        };
    }
}
exports.AiEngine = AiEngine;
exports.aiEngine = new AiEngine();
