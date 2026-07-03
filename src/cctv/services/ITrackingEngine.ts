import { IDetectionResult } from './IAIEngine';

export interface ITrackedDetection extends IDetectionResult {
  trackId: string;
}

export interface ITrackingEngine {
  name: string;
  track(detections: IDetectionResult[]): ITrackedDetection[];
  reset(): void;
}
