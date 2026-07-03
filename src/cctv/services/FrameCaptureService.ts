import { CctvModel, ICctv } from '../../database/models/Cctv';

export interface ICapturedFrame {
  cameraId: number;
  location: string;
  timestamp: Date;
  imagePath: string;
}

export class FrameCaptureService {
  /**
   * Selects active cameras that are online and have monitoring enabled.
   * Updates the camera's `lastFrameAt` timestamp to track performance.
   */
  public static async getActiveCamerasForMonitoring(): Promise<ICctv[]> {
    try {
      const cameras = await CctvModel.find({
        isActive: true,
        monitoringEnabled: true,
        status: { $in: ['ONLINE', 'MONITORING'] }
      });

      const now = new Date();
      for (const camera of cameras) {
        await CctvModel.updateOne({ id: camera.id }, { $set: { lastFrameAt: now } });
      }

      return cameras;
    } catch (err) {
      console.error('[FrameCaptureService] Failed to retrieve active cameras:', err);
      return [];
    }
  }

  /**
   * Simulates capturing a frame from a camera stream.
   * Picks a simulated file from the uploads pool to simulate video frames.
   */
  public static captureFrame(camera: ICctv): ICapturedFrame {
    const mockImageIndex = Math.floor(Math.random() * 4) + 1; // detection_1 to detection_4
    return {
      cameraId: camera.id,
      location: camera.location,
      timestamp: new Date(),
      imagePath: `/uploads/detection_${mockImageIndex}.jpg`
    };
  }
}
