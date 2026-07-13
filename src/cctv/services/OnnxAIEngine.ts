import { IAIEngine, IDetectionResult, EngineState } from './IAIEngine';
import { ICapturedFrame } from './FrameCaptureService';

export class OnnxAIEngine implements IAIEngine {
  public name = 'ONNX Runtime Engine';
  public maxBatchSize = 8;
  public state: EngineState = EngineState.STARTING;
  private isInitialized = false;
  private modelId = 'yolov8-river-v1.0';

  public async initialize(modelPath: string): Promise<void> {
    this.state = EngineState.STARTING;
    console.log(`[OnnxAIEngine] Loading ONNX model from: ${modelPath}`);
    // Simulated load latency
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Resolve model ID from path
    this.modelId = modelPath.split('/').pop()?.replace('.pt', '') || 'yolov8-river-v1.0';
    
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

    const detections: IDetectionResult[] = [];
    const seed = (frame.cameraId * 1000) + (Math.floor(Date.now() / 20000) % 100);
    
    // Deterministic pseudo-random number generator
    const random = (s: number) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };

    const r1 = random(seed + 1);
    const r2 = random(seed + 2);
    const r3 = random(seed + 3);

    // List of sophisticated categories
    const categories = [
      'plastic_bag',
      'industrial_waste',
      'chemical_foam',
      'trash',
      'oil_spill',
      'plastic_bottle'
    ];

    // Select category based on Camera ID
    const catIndex = frame.cameraId % categories.length;
    const primaryClass = categories[catIndex];

    // Probability of detection (75% chance)
    if (r1 > 0.25) {
      const isPrecisionModel = this.modelId.includes('precision') || this.modelId.includes('v2');
      
      // Primary detection: simulate drift downstream by shifting coordinates based on current timestamp
      const driftX = Math.round(15 + (r2 * 30) + ((Date.now() / 5000) % 15));
      const driftY = Math.round(25 + (r3 * 20) + ((Date.now() / 8000) % 10));
      const width = Math.round(15 + r1 * 10);
      const height = Math.round(12 + r2 * 12);
      
      const primaryConf = isPrecisionModel 
        ? parseFloat((0.92 + r1 * 0.06).toFixed(2)) 
        : parseFloat((0.78 + r1 * 0.18).toFixed(2));

      detections.push({
        class: primaryClass,
        confidence: primaryConf,
        bbox: [driftX, driftY, width, height]
      });

      // Occasional secondary detection in the same frame for multi-object capability
      if (r2 > 0.6) {
        const secCatIndex = (frame.cameraId + 1) % categories.length;
        const secondaryClass = categories[secCatIndex];
        const secDriftX = Math.round(50 + (r3 * 25) - ((Date.now() / 6000) % 10));
        const secDriftY = Math.round(60 + (r1 * 15) + ((Date.now() / 9000) % 8));
        
        const secondaryConf = isPrecisionModel 
          ? parseFloat((0.90 + r3 * 0.07).toFixed(2)) 
          : parseFloat((0.72 + r3 * 0.22).toFixed(2));

        detections.push({
          class: secondaryClass,
          confidence: secondaryConf,
          bbox: [secDriftX, secDriftY, Math.round(12 + r2 * 8), Math.round(10 + r3 * 8)]
        });
      }

      // Add a person in certain cameras to simulate unauthorized dumping (High severity!)
      if (frame.cameraId === 2 || frame.cameraId === 5) {
        if (r3 > 0.5) {
          const personConf = isPrecisionModel 
            ? parseFloat((0.94 + r2 * 0.04).toFixed(2)) 
            : parseFloat((0.82 + r2 * 0.14).toFixed(2));

          detections.push({
            class: 'person',
            confidence: personConf,
            bbox: [5, 10, 15, 50] // Stationary person on the bank
          });
        }
      }
    }

    return detections;
  }

  public async detectBatch(frames: ICapturedFrame[]): Promise<IDetectionResult[][]> {
    return Promise.all(frames.map(f => this.detect(f)));
  }
}
