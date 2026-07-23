"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 2.5: Feature Extractor
 * Transmutes Layer 1 and Layer 2 outputs into a standardized numerical FeatureVector (Schema: feature-v1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.featureExtractorService = exports.FeatureExtractorService = void 0;
const trashTaxonomy_1 = require("../taxonomy/trashTaxonomy");
class FeatureExtractorService {
    extractFeatures(objects, poses, relations, semanticData, analyzersAvailable, qualityOverride) {
        const personObjects = objects.filter(o => o.class === 'person' || o.class === 'orang');
        const trashObjects = objects.filter(o => (0, trashTaxonomy_1.isTrashClass)(o.class));
        const personCount = personObjects.length;
        const trashCount = trashObjects.length;
        const trashConfs = trashObjects.map(o => o.confidence);
        const personConfs = personObjects.map(o => o.confidence);
        const highestTrashConfidence = trashConfs.length > 0 ? Math.round(Math.max(...trashConfs) * 100) : 0;
        const highestPersonConfidence = personConfs.length > 0 ? Math.round(Math.max(...personConfs) * 100) : 0;
        // Nearest wrist distance calculation
        const wristDists = relations.map(r => r.nearestWristDistanceNormalized).filter((d) => d !== null);
        const nearestWristDistanceNormalized = wristDists.length > 0 ? Math.min(...wristDists) : null;
        const trashNearWrist = nearestWristDistanceNormalized !== null && nearestWristDistanceNormalized <= 0.45;
        const possibleReleasePose = nearestWristDistanceNormalized !== null && nearestWristDistanceNormalized > 0.45 && nearestWristDistanceNormalized <= 0.90;
        const trashOnWaterZone = trashCount > 0 && semanticData.riverDetected;
        const trashOnRoadZone = trashCount > 0 && semanticData.roadDetected;
        const trashInsideBinZone = semanticData.trashInsideBin;
        // Lightweight image quality estimation
        const imageQuality = qualityOverride || {
            blurScore: highestTrashConfidence > 0 || highestPersonConfidence > 0 ? 85 : 40,
            brightnessScore: 80,
            resolutionAdequate: true,
            qualityStatus: (highestTrashConfidence > 0 || highestPersonConfidence > 0) ? 'GOOD' : 'ACCEPTABLE'
        };
        // Evidence coverage ratio
        const expectedAnalyzers = ['YOLO_OBJECT', 'POSE_ESTIMATION', 'SPATIAL_ANALYZER', 'SEMANTIC_ANALYZER', 'REGION_ANALYZER'];
        const activeCount = analyzersAvailable.filter(a => expectedAnalyzers.includes(a)).length;
        const evidenceCoverage = Math.round((activeCount / expectedAnalyzers.length) * 100) / 100;
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
            imageQuality,
            evidenceCoverage,
            analyzersAvailable,
        };
    }
}
exports.FeatureExtractorService = FeatureExtractorService;
exports.featureExtractorService = new FeatureExtractorService();
