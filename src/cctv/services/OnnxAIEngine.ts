import { IAIEngine, IDetectionResult, EngineState } from './IAIEngine';
import { ICapturedFrame } from './FrameCaptureService';

export class OnnxAIEngine implements IAIEngine {
  public name = 'ONNX Runtime Engine';
  public maxBatchSize = 8;
  public state: EngineState = EngineState.STARTING;
  private isInitialized = false;

  public async initialize(modelPath: string): Promise<void> {
    this.state = EngineState.STARTING;
    console.log(`[OnnxAIEngine] Loading ONNX model from: ${modelPath}`);
    // Simulated load latency
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Model Warm-up (dummy run)
    console.log(`[OnnxAIEngine] Running model warm-up cycle with zero-array tensor...`);
    const zeroTensor = new Float32Array(1 * 3 * 640 * 640); // 3x640x640 input
    console.log(`[OnnxAIEngine] Warmup zero-tensor initialized. Length: ${zeroTensor.length} elements.`);
    await new Promise(resolve => setTimeout(resolve, 50));
    
    this.isInitialized = true;
    this.state = EngineState.READY;
    console.log(`[OnnxAIEngine] Model is READY.`);
  }

  public async detect(frame: ICapturedFrame): Promise<IDetectionResult[]> {
    if (!this.isInitialized) {
      throw new Error('OnnxAIEngine is not initialized.');
    }
    // Simulated ONNX inference result
    return [
      { class: 'trash', confidence: 0.82, bbox: [20, 30, 10, 10] }
    ];
  }

  public async detectBatch(frames: ICapturedFrame[]): Promise<IDetectionResult[][]> {
    return Promise.all(frames.map(f => this.detect(f)));
  }
}
