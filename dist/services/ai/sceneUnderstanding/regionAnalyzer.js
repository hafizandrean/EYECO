"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 2: Region Analyzer (Camera Zone Manager)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.regionAnalyzer = exports.RegionAnalyzer = void 0;
const trashTaxonomy_1 = require("../taxonomy/trashTaxonomy");
class RegionAnalyzer {
    analyzeRegion(objects) {
        const trashObjects = objects.filter(o => (0, trashTaxonomy_1.isTrashClass)(o.class));
        const riverDetected = objects.some(o => ['river', 'sungai', 'water'].some(k => o.class.includes(k)));
        const trashInRestrictedZone = trashObjects.length > 0 && riverDetected;
        const zones = [
            { name: riverDetected ? 'water_zone' : 'road_zone', confidence: 0.85 },
            { name: 'restricted_zone', confidence: trashInRestrictedZone ? 0.90 : 0.40 }
        ];
        const evidence = [
            {
                code: 'RESTRICTED_ZONE_VIOLATION',
                label: 'Objek sampah berada di area zona terlarang (aliran air/sungai)',
                value: trashInRestrictedZone,
                source: 'REGION_ANALYZER',
                confidence: trashInRestrictedZone ? 0.90 : 0.30,
                available: true,
                scoreDelta: trashInRestrictedZone ? 20 : 0,
                limitations: ['Zona terlarang disesuaikan dengan konfigurasi wilayah kamera.'],
            }
        ];
        return {
            zones,
            evidence,
            trashInRestrictedZone,
        };
    }
}
exports.RegionAnalyzer = RegionAnalyzer;
exports.regionAnalyzer = new RegionAnalyzer();
