"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 2.5: Feature Extractor
 * Transmutes Layer 1, Layer 2, and FusionDecisions into a standardized numerical FeatureVector (Schema: feature-v1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.featureExtractorService = exports.FeatureExtractorService = void 0;
const ai_types_1 = require("../types/ai.types");
const trashTaxonomy_1 = require("../taxonomy/trashTaxonomy");
class FeatureExtractorService {
    extractFeatures(objects, poses, relations, semanticData, analyzersAvailable, fusionDecisions = [], qualityOverride) {
        const personObjects = objects.filter(o => {
            const pc = o.class.toLowerCase();
            return ['person', 'orang'].includes(pc);
        });
        // Filter trash objects based on fusion Decisions (CONFIRMED existence status)
        const confirmedTrashIds = new Set(fusionDecisions.filter(fd => fd.objectExistenceStatus === 'CONFIRMED').map(fd => fd.detectionId));
        const trashObjects = objects.filter(o => {
            if (!(0, trashTaxonomy_1.isTrashClass)(o.class))
                return false;
            const detId = o.detectionId || `det-${o.class}-${Math.round(o.x)}_${Math.round(o.y)}`;
            return fusionDecisions.length === 0 || confirmedTrashIds.has(detId) || o.confidence >= 0.35;
        });
        const VEHICLE_CLASSES = new Set(['car', 'motorcycle', 'motorbike', 'bus', 'truck', 'bicycle', 'bike', 'train']);
        const vehicleObjects = objects.filter(o => VEHICLE_CLASSES.has(o.class.toLowerCase()));
        const vehicleCount = vehicleObjects.length;
        const groundObjectCount = objects.filter(o => {
            const cls = o.class.toLowerCase();
            if (['person', 'orang'].includes(cls))
                return false;
            if (VEHICLE_CLASSES.has(cls))
                return false;
            if ((0, trashTaxonomy_1.isTrashClass)(o.class))
                return false;
            const bottomY = (o.y || 0) + (o.h || 0);
            return bottomY > 70;
        }).length;
        const personCount = personObjects.length;
        const trashCount = trashObjects.length;
        const trashConfs = trashObjects.map(o => o.confidence);
        const personConfs = personObjects.map(o => o.confidence);
        const highestTrashConfidence = trashConfs.length > 0 ? Math.round(Math.max(...trashConfs) * 100) : 0;
        const highestPersonConfidence = personConfs.length > 0 ? Math.round(Math.max(...personConfs) * 100) : 0;
        const wristDists = relations.map(r => r.nearestWristDistanceNormalized).filter((d) => d !== null);
        const nearestWristDistanceNormalized = wristDists.length > 0 ? Math.min(...wristDists) : null;
        const trashNearWrist = nearestWristDistanceNormalized !== null && nearestWristDistanceNormalized <= 0.70;
        const possibleReleasePose = nearestWristDistanceNormalized !== null && nearestWristDistanceNormalized > 0.35 && nearestWristDistanceNormalized <= 1.10;
        const trashOnWaterZone = trashCount > 0 && semanticData.riverDetected;
        const trashOnRoadZone = trashCount > 0 && semanticData.roadDetected;
        const trashInsideBinZone = semanticData.trashInsideBin;
        const trashLargePile = trashObjects.some(o => (o.w * o.h) >= 80);
        const imageQuality = qualityOverride || {
            blurScore: highestTrashConfidence > 0 || highestPersonConfidence > 0 ? 85 : 40,
            brightnessScore: 80,
            resolutionAdequate: true,
            qualityStatus: (highestTrashConfidence > 0 || highestPersonConfidence > 0) ? 'GOOD' : 'ACCEPTABLE'
        };
        const expectedAnalyzers = ['YOLO_OBJECT', 'POSE_ESTIMATION', 'SPATIAL_ANALYZER', 'SEMANTIC_ANALYZER', 'REGION_ANALYZER'];
        const activeCount = analyzersAvailable.filter(a => expectedAnalyzers.includes(a)).length;
        const evidenceCoverage = Math.round((activeCount / expectedAnalyzers.length) * 100) / 100;
        // Map 24 features strictly using FEATURE_V1_ORDER registry
        const featureMap = {
            personCount: { value: personCount, available: true, sources: ['YOLO_OBJECT'] },
            trashCount: { value: trashCount, available: true, sources: ['YOLO_OBJECT', 'FUSION_SERVICE'] },
            vehicleCount: { value: vehicleCount, available: true, sources: ['YOLO_OBJECT'] },
            binCount: { value: semanticData.trashInsideBin ? 1 : 0, available: true, sources: ['SEMANTIC_ANALYZER'] },
            highestTrashConfidence: { value: highestTrashConfidence, available: trashCount > 0, sources: ['YOLO_OBJECT'] },
            highestPersonConfidence: { value: highestPersonConfidence, available: personCount > 0, sources: ['YOLO_OBJECT'] },
            highestVehicleConfidence: { value: vehicleCount > 0 ? 80 : 0, available: vehicleCount > 0, sources: ['YOLO_OBJECT'] },
            nearestWristDistanceNormalized: { value: nearestWristDistanceNormalized ?? -1, available: nearestWristDistanceNormalized !== null, sources: ['SPATIAL_ANALYZER'] },
            trashNearWrist: { value: trashNearWrist ? 1 : 0, available: nearestWristDistanceNormalized !== null, sources: ['SPATIAL_ANALYZER'] },
            possibleHoldingPose: { value: poses.length > 0 ? 1 : 0, available: analyzersAvailable.includes('POSE_ESTIMATION'), sources: ['POSE_ESTIMATION'] },
            possibleReleasePose: { value: possibleReleasePose ? 1 : 0, available: analyzersAvailable.includes('POSE_ESTIMATION'), sources: ['POSE_ESTIMATION'] },
            possibleThrowingPose: { value: 0, available: false, sources: ['POSE_ESTIMATION'] },
            trashInsideBinZone: { value: trashInsideBinZone ? 1 : 0, available: analyzersAvailable.includes('SEMANTIC_ANALYZER'), sources: ['SEMANTIC_ANALYZER'] },
            trashNearBinZone: { value: 0, available: false, sources: ['SEMANTIC_ANALYZER'] },
            trashOnWaterZone: { value: trashOnWaterZone ? 1 : 0, available: analyzersAvailable.includes('SEMANTIC_ANALYZER'), sources: ['SEMANTIC_ANALYZER'] },
            trashOnRoadZone: { value: trashOnRoadZone ? 1 : 0, available: analyzersAvailable.includes('SEMANTIC_ANALYZER'), sources: ['SEMANTIC_ANALYZER'] },
            prohibitedRegionOverlap: { value: trashOnWaterZone ? 1 : 0, available: analyzersAvailable.includes('REGION_ANALYZER'), sources: ['REGION_ANALYZER'] },
            allowedDisposalOverlap: { value: trashInsideBinZone ? 1 : 0, available: analyzersAvailable.includes('REGION_ANALYZER'), sources: ['REGION_ANALYZER'] },
            airborneCandidate: { value: 0, available: false, sources: ['SPATIAL_ANALYZER'] },
            temporalReleaseEvidence: { value: 0, available: false, sources: ['TEMPORAL_ANALYZER'] },
            sceneRisk: { value: trashOnWaterZone ? 100 : (trashOnRoadZone ? 75 : 25), available: true, sources: ['SEMANTIC_ANALYZER'] },
            nightFlag: { value: 0, available: true, sources: ['IMAGE_QUALITY'] },
            motionFlag: { value: 0, available: false, sources: ['VIDEO_TRACKER'] },
            inputQualityScore: { value: imageQuality.blurScore, available: true, sources: ['IMAGE_QUALITY'] }
        };
        const values = ai_types_1.FEATURE_V1_ORDER.map(name => featureMap[name].value);
        const availabilityMask = ai_types_1.FEATURE_V1_ORDER.map(name => featureMap[name].available);
        const sourceMap = {};
        ai_types_1.FEATURE_V1_ORDER.forEach(name => {
            sourceMap[name] = featureMap[name].sources;
        });
        if (ai_types_1.FEATURE_V1_ORDER.length !== 24 || values.length !== 24 || availabilityMask.length !== 24) {
            throw new Error('[FeatureExtractor] Dimension mismatch: feature-v1 must contain exactly 24 dimensions');
        }
        if (values.some(Number.isNaN)) {
            throw new Error('[FeatureExtractor] feature-v1 values contain NaN');
        }
        const standardized = {
            schemaVersion: 'feature-v1',
            featureNames: ai_types_1.FEATURE_V1_ORDER,
            values,
            availabilityMask,
            sourceMap,
            qualityScore: imageQuality.blurScore
        };
        return {
            featureSchemaVersion: 'feature-v1',
            personCount,
            trashCount,
            highestTrashConfidence,
            highestPersonConfidence,
            nearestWristDistanceNormalized,
            trashNearWrist,
            possibleReleasePose,
            trashOnWaterZone,
            trashOnRoadZone,
            trashInsideBinZone,
            trashLargePile,
            imageQuality,
            evidenceCoverage,
            analyzersAvailable,
            vehicleCount,
            groundObjectCount,
            standardized
        };
    }
}
exports.FeatureExtractorService = FeatureExtractorService;
exports.featureExtractorService = new FeatureExtractorService();
