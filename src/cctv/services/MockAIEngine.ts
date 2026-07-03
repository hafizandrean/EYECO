import { IAIEngine, IDetectionResult, EngineState } from './IAIEngine';
import { ICapturedFrame } from './FrameCaptureService';

export class MockAIEngine implements IAIEngine {
  public name = 'Mock Simulation Engine';
  public maxBatchSize = 4;
  public state: EngineState = EngineState.STARTING;
  private isInitialized = false;

  public async initialize(modelPath: string): Promise<void> {
    this.state = EngineState.STARTING;
    console.log(`[MockAIEngine] Initializing mock model path: ${modelPath}`);
    console.log(`[MockAIEngine] Running mock warmup run...`);
    await new Promise(resolve => setTimeout(resolve, 50));
    this.isInitialized = true;
    this.state = EngineState.READY;
    console.log(`[MockAIEngine] Mock model is READY.`);
  }

  public async detect(frame: ICapturedFrame): Promise<IDetectionResult[]> {
    if (!this.isInitialized) {
      throw new Error('MockAIEngine is not initialized.');
    }

    const hasPerson = Math.random() > 0.4;
    const hasTrash = Math.random() > 0.7; // 30% chance of trash
    const hasBoat = Math.random() > 0.85;

    const detections: IDetectionResult[] = [];

    if (hasPerson) {
      detections.push({
        class: 'person',
        confidence: parseFloat((0.55 + Math.random() * 0.4).toFixed(2)),
        bbox: [15 + Math.random() * 20, 20 + Math.random() * 30, 12, 45]
      });
    }

    if (hasTrash) {
      detections.push({
        class: 'trash',
        confidence: parseFloat((0.5 + Math.random() * 0.48).toFixed(2)),
        bbox: [35 + Math.random() * 30, 60 + Math.random() * 15, 18, 12]
      });
    }

    if (hasBoat) {
      detections.push({
        class: 'boat',
        confidence: parseFloat((0.6 + Math.random() * 0.35).toFixed(2)),
        bbox: [10 + Math.random() * 20, 40 + Math.random() * 15, 30, 18]
      });
    }

    return detections;
  }

  public async detectBatch(frames: ICapturedFrame[]): Promise<IDetectionResult[][]> {
    return Promise.all(frames.map(f => this.detect(f)));
  }
}
