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
        const personObjects = objects.filter(o => {
            const pc = o.class.toLowerCase();
            return ['person', 'orang'].includes(pc);
        });
        const trashObjects = objects.filter(o => (0, trashTaxonomy_1.isTrashClass)(o.class));
        // Vehicle detection — kendaraan sebagai context clues, bukan sampah
        const VEHICLE_CLASSES = new Set(['car', 'motorcycle', 'motorbike', 'bus', 'truck', 'bicycle', 'bike', 'train']);
        const vehicleObjects = objects.filter(o => VEHICLE_CLASSES.has(o.class.toLowerCase()));
        const vehicleCount = vehicleObjects.length;
        // Ground-level objects — non-person, non-vehicle, non-trash objects on ground as potential trash
        const groundObjectCount = objects.filter(o => {
            const cls = o.class.toLowerCase();
            // Not person, not vehicle, not already counted as trash
            if (['person', 'orang'].includes(cls))
                return false;
            if (VEHICLE_CLASSES.has(cls))
                return false;
            if ((0, trashTaxonomy_1.isTrashClass)(o.class))
                return false;
            // Ground-level heuristic: bottom of bbox near bottom of image (>70% y + h)
            const bottomY = (o.y || 0) + (o.h || 0);
            return bottomY > 70;
        }).length;
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
        // A trash object is a large pile if its bounding box area is >= 80 (in percentage space, e.g. w=10, h=8 -> area=80)
        const trashLargePile = trashObjects.some(o => (o.w * o.h) >= 80);
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
            trashLargePile,
            imageQuality,
            evidenceCoverage,
            analyzersAvailable,
            vehicleCount,
            groundObjectCount,
        };
    }
}
exports.FeatureExtractorService = FeatureExtractorService;
exports.featureExtractorService = new FeatureExtractorService();
