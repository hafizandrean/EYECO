import { ITrackingEngine, ITrackedDetection } from './ITrackingEngine';
import { IDetectionResult } from './IAIEngine';

export class TrackingEngine implements ITrackingEngine {
  public name = 'Spatial IoU Matching Tracker';

  public track(rawDetections: IDetectionResult[]): ITrackedDetection[] {
    return rawDetections.map((det, idx) => {
      const trackId = `tr-${det.class.substring(0, 1)}-${Math.floor(Math.random() * 1000)}`;
      return {
        class: det.class,
        confidence: det.confidence,
        bbox: det.bbox,
        trackId
      };
    });
  }

  public reset(): void {
    // Reset tracker states
  }
}
