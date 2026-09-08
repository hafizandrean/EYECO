import { IAIEngine, IDetectionResult, EngineState } from './IAIEngine';
import { ICapturedFrame } from './FrameCaptureService';
import { detectFile } from '../../services/aiDetection.service';
import path from 'path';

export class LocalPythonAIEngine implements IAIEngine {
  public name = 'Local Python YOLOv8 Engine';
  public maxBatchSize = 1;
  public state: EngineState = EngineState.READY;

  public async initialize(modelPath: string): Promise<void> {
    this.state = EngineState.READY;
  }

  public async detect(frame: ICapturedFrame): Promise<IDetectionResult[]> {
    try {
      // frame.imagePath bisa berupa path absolut (OS temp) atau relatif ke public/
      let absoluteImagePath: string;
      if (path.isAbsolute(frame.imagePath)) {
        absoluteImagePath = frame.imagePath;
      } else {
        absoluteImagePath = path.join(process.cwd(), 'public', frame.imagePath);
      }
      const result = await detectFile(absoluteImagePath);
      
      console.log(`[LocalPythonAIEngine] Camera #${frame.cameraId} | Path: ${absoluteImagePath} | Boxes: ${JSON.stringify(result.boxes?.length ?? 0)}`);
      
      // Map AiStatusResult boxes: { label: string, confidence: number, x: number, y: number, w: number, h: number }
      // to IDetectionResult: { class: string, confidence: number, bbox: [number, number, number, number] }
      return (result.boxes || []).map(b => ({
        class: b.label,
        confidence: b.confidence,
        bbox: [b.x, b.y, b.w, b.h] // [x, y, w, h] format expected by system
      }));
    } catch (err: any) {
      console.error('[LocalPythonAIEngine] Detection failed:', err.message);
      return [];
    }
  }

  public async detectBatch(frames: ICapturedFrame[]): Promise<IDetectionResult[][]> {
    return Promise.all(frames.map(f => this.detect(f)));
  }
}
