export interface ITrackedObject {
  class: string;
  confidence: number;
  bbox: number[];
  trackId: string;
}

export class ObjectTrackingService {
  /**
   * Performs object tracking simulation (matching DeepSORT/ByteTrack behaviors).
   * Standardizes raw YOLO bboxes and associates them with unique trackIds.
   */
  public static track(rawDetections: any[]): ITrackedObject[] {
    return rawDetections.map((det, idx) => {
      const trackId = det.trackId || `tr-${det.class.substring(0, 1)}-${Math.floor(Math.random() * 1000)}`;
      return {
        class: det.class,
        confidence: det.confidence,
        bbox: det.bbox || [20 + idx * 5, 30 + idx * 5, 15, 20],
        trackId
      };
    });
  }
}
