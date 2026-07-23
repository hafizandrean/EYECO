/**
 * EYECO AI Engine v3.0 — Layer 2: Region Analyzer (Camera Zone Manager)
 */

import { YoloObject, SpatialRegionZone, EvidenceItem } from '../types/ai.types';
import { isTrashClass } from '../taxonomy/trashTaxonomy';

export class RegionAnalyzer {
  public analyzeRegion(objects: YoloObject[]): {
    zones: SpatialRegionZone[];
    evidence: EvidenceItem[];
    trashInRestrictedZone: boolean;
  } {
    const trashObjects = objects.filter(o => isTrashClass(o.class));
    const riverDetected = objects.some(o => ['river', 'sungai', 'water'].some(k => o.class.includes(k)));

    const trashInRestrictedZone = trashObjects.length > 0 && riverDetected;

    const zones: SpatialRegionZone[] = [
      { name: riverDetected ? 'water_zone' : 'road_zone', confidence: 0.85 },
      { name: 'restricted_zone', confidence: trashInRestrictedZone ? 0.90 : 0.40 }
    ];

    const evidence: EvidenceItem[] = [
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

export const regionAnalyzer = new RegionAnalyzer();
