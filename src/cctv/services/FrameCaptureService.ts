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
   * If workspaceId is provided, only returns cameras in that workspace.
   */
  public static async getActiveCamerasForMonitoring(workspaceId?: number): Promise<ICctv[]> {
    try {
      const query: any = {
        isActive: true,
        monitoringEnabled: true,
        status: { $in: ['ONLINE', 'MONITORING'] }
      };
      if (workspaceId !== undefined) {
        query.workspaceId = workspaceId;
      }

      const cameras = await CctvModel.find(query);

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
   * Captures a frame from a camera stream.
   * Uses the camera's playUrl or streamUrl for real streams,
   * falls back to a static image if no stream URL is available.
   */
  public static captureFrame(camera: ICctv): ICapturedFrame {
    // Try to use the camera's actual stream URL
    const streamUrl = camera.playUrl || camera.streamUrl;

    // If the camera has a valid HTTP stream/image URL, use it
    // Otherwise use a static file as fallback
    const imagePath = streamUrl && (streamUrl.startsWith('http://') || streamUrl.startsWith('https://'))
      ? streamUrl
      : `/uploads/last_capture.jpg`;

    return {
      cameraId: camera.id,
      location: camera.location,
      timestamp: new Date(),
      imagePath,
    };
  }
}
