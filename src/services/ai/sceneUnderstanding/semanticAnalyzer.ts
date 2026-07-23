/**
 * EYECO AI Engine v3.0 — Layer 2: Semantic & Environmental Analyzer
 */

import { YoloObject, EvidenceItem } from '../types/ai.types';
import { isTrashClass } from '../taxonomy/trashTaxonomy';

export class SemanticAnalyzer {
  public analyzeSemantic(objects: YoloObject[]): {
    evidence: EvidenceItem[];
    riverDetected: boolean;
    roadDetected: boolean;
    trashBinDetected: boolean;
    trashInsideBin: boolean;
  } {
    const riverDetected = objects.some(o => ['river', 'sungai', 'water', 'air'].some(k => o.class.includes(k)));
    const roadDetected = objects.some(o => ['road', 'jalan', 'sidewalk'].some(k => o.class.includes(k)));
    const trashBinObjects = objects.filter(o => ['trash_bin', 'tps', 'tempat_sampah', 'bin'].some(k => o.class.includes(k)));
    const trashObjects = objects.filter(o => isTrashClass(o.class));

    const trashBinDetected = trashBinObjects.length > 0;
    let trashInsideBin = false;

    if (trashBinDetected && trashObjects.length > 0) {
      for (const t of trashObjects) {
        for (const b of trashBinObjects) {
          // Check overlap
          const overlap = (t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h);
          if (overlap) {
            trashInsideBin = true;
            break;
          }
        }
      }
    }

    const evidence: EvidenceItem[] = [
      {
        code: 'TRASH_INSIDE_BIN',
        label: 'Objek sampah berada di dalam/area tempat sampah',
        value: trashInsideBin,
        source: 'SEMANTIC_ANALYZER',
        confidence: trashInsideBin ? 0.92 : 0.85,
        available: true,
        scoreDelta: trashInsideBin ? -35 : 0,
        limitations: ['Dihitung berdasarkan overlap geografis bounding box sampah dan tempat sampah.'],
      },
      {
        code: 'ENVIRONMENTAL_CONTEXT',
        label: 'Deteksi konteks area lingkungan (sungai/jalan/tps)',
        value: riverDetected ? 'Zona Sungai' : (roadDetected ? 'Zona Jalan' : 'Umum'),
        source: 'SEMANTIC_ANALYZER',
        confidence: 0.88,
        available: true,
        scoreDelta: riverDetected ? 15 : (roadDetected ? 10 : 0),
      }
    ];

    return {
      evidence,
      riverDetected,
      roadDetected,
      trashBinDetected,
      trashInsideBin,
    };
  }
}

export const semanticAnalyzer = new SemanticAnalyzer();
