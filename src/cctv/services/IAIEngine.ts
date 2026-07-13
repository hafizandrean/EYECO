import { ICapturedFrame } from './FrameCaptureService';

export enum EngineState {
  STARTING = 'STARTING',
  READY = 'READY',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED'
}

export interface IGeometry {
  type: 'bbox' | 'polygon' | 'keypoints';
  value: number[];
}

export interface IDetectionResult {
  class: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h]
  geometry?: IGeometry;
}

export interface IAIEngine {
  name: string;
  maxBatchSize: number;
  state: EngineState;
  initialize(modelPath: string): Promise<void>;
  detect(frame: ICapturedFrame): Promise<IDetectionResult[]>;
  detectBatch(frames: ICapturedFrame[]): Promise<IDetectionResult[][]>;
}
