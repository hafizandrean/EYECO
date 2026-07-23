/**
 * EYECO AI Engine v3.0 — Layer 2: Spatial Analyzer
 * Evaluates spatial relationships between trash objects and human wrists using normalized distances.
 */

import { YoloObject, PersonPose, HumanTrashRelation, EvidenceItem } from '../types/ai.types';
import { isTrashClass } from '../taxonomy/trashTaxonomy';

export class SpatialAnalyzer {
  public analyzeSpatial(
    objects: YoloObject[],
    poses: PersonPose[]
  ): {
    relations: HumanTrashRelation[];
    evidence: EvidenceItem[];
    nearestWristDistanceNormalized: number | null;
    trashNearWrist: boolean;
    possibleReleasePose: boolean;
  } {
    const trashObjects = objects.filter(o => isTrashClass(o.class));
    const personObjects = objects.filter(o => o.class === 'person' || o.class === 'orang');

    const relations: HumanTrashRelation[] = [];
    const evidence: EvidenceItem[] = [];
    let minNormalizedDist: number | null = null;
    let trashNearWrist = false;
    let possibleReleasePose = false;

    if (personObjects.length > 0 && trashObjects.length > 0) {
      for (const trash of trashObjects) {
        const trashCenterX = trash.x + trash.w / 2;
        const trashCenterY = trash.y + trash.h / 2;

        for (const pose of poses) {
          const diag = pose.boxDiagonal || 50;
          let leftDistNorm: number | null = null;
          let rightDistNorm: number | null = null;

          if (pose.leftWristNormalized) {
            const dx = trashCenterX - pose.leftWristNormalized.x;
            const dy = trashCenterY - pose.leftWristNormalized.y;
            leftDistNorm = Math.sqrt(dx * dx + dy * dy) / diag;
          }

          if (pose.rightWristNormalized) {
            const dx = trashCenterX - pose.rightWristNormalized.x;
            const dy = trashCenterY - pose.rightWristNormalized.y;
            rightDistNorm = Math.sqrt(dx * dx + dy * dy) / diag;
          }

          const validDists = [leftDistNorm, rightDistNorm].filter((d): d is number => d !== null);
          const nearestDist = validDists.length > 0 ? Math.min(...validDists) : null;

          if (nearestDist !== null) {
            if (minNormalizedDist === null || nearestDist < minNormalizedDist) {
              minNormalizedDist = nearestDist;
            }

            if (nearestDist <= 0.45) {
              trashNearWrist = true;
            }
            if (nearestDist > 0.45 && nearestDist <= 0.90 && trash.y < pose.bbox[3]) {
              possibleReleasePose = true;
            }

            relations.push({
              personId: pose.personId,
              trashId: `trash-${trash.class}`,
              distanceToLeftWristNormalized: leftDistNorm ? Math.round(leftDistNorm * 100) / 100 : null,
              distanceToRightWristNormalized: rightDistNorm ? Math.round(rightDistNorm * 100) / 100 : null,
              nearestWristDistanceNormalized: Math.round(nearestDist * 100) / 100,
              overlapsPersonBox: true,
              possibleHeldObject: nearestDist <= 0.35,
              relationConfidence: 0.86,
            });
          }
        }
      }

      evidence.push({
        code: 'TRASH_NEAR_WRIST',
        label: 'Objek sampah terindikasi dekat pergelangan tangan',
        value: trashNearWrist,
        source: 'POSE_ESTIMATION',
        confidence: trashNearWrist ? 0.88 : 0.20,
        available: poses.length > 0,
        scoreDelta: trashNearWrist ? 20 : 0,
        limitations: ['Satu foto belum cukup untuk memastikan gerakan atau aktivitas membuang sampah.'],
      });

      evidence.push({
        code: 'POSSIBLE_RELEASE_POSE',
        label: 'Indikasi gestur posisi lepas objek di sekitar manusia',
        value: possibleReleasePose,
        source: 'SPATIAL_ANALYZER',
        confidence: possibleReleasePose ? 0.75 : 0.15,
        available: poses.length > 0,
        scoreDelta: possibleReleasePose ? 15 : 0,
        limitations: ['Diperlukan analisis sekuens video untuk verifikasi gerakan melempar secara pasti.'],
      });
    } else {
      evidence.push({
        code: 'TRASH_NEAR_WRIST',
        label: 'Objek sampah terindikasi dekat pergelangan tangan',
        value: null,
        source: 'POSE_ESTIMATION',
        confidence: 0,
        available: false,
        scoreDelta: 0,
        limitations: ['Objek manusia atau sampah tidak terdeteksi lengkap pada foto ini.'],
      });
    }

    return {
      relations,
      evidence,
      nearestWristDistanceNormalized: minNormalizedDist !== null ? Math.round(minNormalizedDist * 100) / 100 : null,
      trashNearWrist,
      possibleReleasePose,
    };
  }
}

export const spatialAnalyzer = new SpatialAnalyzer();
