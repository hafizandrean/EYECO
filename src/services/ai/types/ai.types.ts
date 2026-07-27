/**
 * EYECO AI Engine v3.0 - Unified DTO Types
 */

export interface YoloObject {
  class: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  w: number; // percentage 0-100
  h: number; // percentage 0-100
}

export interface PoseKeypoint {
  part: string; // 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder'
  x: number;
  y: number;
  confidence: number;
}

export interface PersonPose {
  personId: string;
  bbox: [number, number, number, number];
  boxDiagonal: number;
  keypoints: PoseKeypoint[];
  leftWristNormalized: { x: number; y: number; confidence: number } | null;
  rightWristNormalized: { x: number; y: number; confidence: number } | null;
}

export interface HumanTrashRelation {
  personId: string;
  trashId: string;
  distanceToLeftWristNormalized: number | null;
  distanceToRightWristNormalized: number | null;
  nearestWristDistanceNormalized: number | null;
  overlapsPersonBox: boolean;
  possibleHeldObject: boolean;
  relationConfidence: number;
}

export interface SpatialRegionZone {
  name: 'water_zone' | 'road_zone' | 'trash_bin_zone' | 'restricted_zone' | 'unknown';
  confidence: number;
}

export interface EvidenceItem {
  code: string;
  label: string;
  value: boolean | number | string | null;
  source: 'YOLO_OBJECT' | 'POSE_ESTIMATION' | 'SPATIAL_ANALYZER' | 'SEMANTIC_ANALYZER' | 'REGION_ANALYZER' | 'VLM';
  confidence: number;
  available: boolean;
  scoreDelta: number;
  limitations?: string[];
}

export type QualityLevel = 'GOOD' | 'ACCEPTABLE' | 'POOR' | 'LOW' | 'BLURRY';

export interface ImageQualityMetrics {
  blurScore: number; // 0-100
  brightnessScore: number; // 0-100
  resolutionAdequate: boolean;
  qualityStatus: QualityLevel;
}

export interface FeatureVector {
  featureSchemaVersion: 'feature-v1';
  personCount: number;
  trashCount: number;
  highestTrashConfidence: number;
  highestPersonConfidence: number;
  nearestWristDistanceNormalized: number | null; // normalized by person box diagonal
  trashNearWrist: boolean;
  possibleReleasePose: boolean;
  trashOnWaterZone: boolean;
  trashOnRoadZone: boolean;
  trashInsideBinZone: boolean;
  trashLargePile: boolean;
  imageQuality: ImageQualityMetrics;
  evidenceCoverage: number; // 0-1
  analyzersAvailable: string[];
  vehicleCount?: number; // Jumlah kendaraan terdeteksi (mobil, motor, dll)
  groundObjectCount?: number; // Jumlah objek di permukaan tanah (potensi sampah)
}

export type AiIndicationStatus = 'Indikasi Tinggi' | 'Indikasi Sedang' | 'Indikasi Rendah' | 'Tidak Terindikasi';
export type OperationalPriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface DecisionResult {
  status: AiIndicationStatus;
  violationScore: number; // 0-100
  objectConfidence: number; // 0-100
  sceneConfidence: number; // 0-100
  decisionConfidence: number; // 0-100 (heuristic reliability)
  uncertaintyScore: number; // 100 - decisionConfidence
  confidenceType: 'MODEL_PROBABILITY' | 'HEURISTIC_RELIABILITY' | 'RULE_CERTAINTY';
  priority: OperationalPriority;
  recommendedAction: string;
  needsHumanValidation: boolean;
  policyVersion: string;
}

export interface ModelRegistryInfo {
  yoloVersion: string;
  poseVersion: string;
  sceneVersion: string;
  decisionVersion: string;
  datasetVersion: string;
  featureSchemaVersion: string;
  policyVersion: string;
}

export type OperatorGroundTruthLabel =
  | 'CONFIRMED_LITTERING'
  | 'PROBABLE_LITTERING'
  | 'CARRYING_OBJECT'
  | 'DISPOSING_IN_BIN'
  | 'PICKING_UP_TRASH'
  | 'CLEANING_ACTIVITY'
  | 'PERSON_ONLY'
  | 'TRASH_ONLY'
  | 'NOT_ENOUGH_EVIDENCE'
  | 'FALSE_OBJECT_DETECTION'
  | 'IMAGE_QUALITY_TOO_LOW'
  | 'OTHER';
