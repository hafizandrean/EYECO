import { YoloObject, PersonPose, HumanTrashRelation, EvidenceItem, SpatialRegionZone } from '../types/ai.types';

export interface SceneAnalysisResult {
  humanTrashRelations: HumanTrashRelation[];
  detectedZones: SpatialRegionZone[];
  evidenceItems: EvidenceItem[];
  sceneConfidence: number; // 0-100
  sceneDescription: {
    summary: string;
    relations: string[];
    riskFactors: string[];
  };
  analyzersAvailable: string[];
}

export interface ISceneAnalyzer {
  analyze(
    imagePath: string,
    objects: YoloObject[],
    poses: PersonPose[]
  ): Promise<SceneAnalysisResult>;
}
