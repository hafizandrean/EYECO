import { IAIEngine, IDetectionResult, EngineState } from './IAIEngine';
import { ICapturedFrame } from './FrameCaptureService';

export class FastApiAIEngine implements IAIEngine {
  public name = 'FastAPI Microservice Engine';
  public maxBatchSize = 16;
  public state: EngineState = EngineState.STARTING;
  private isInitialized = false;
  private serverUrl = 'http://localhost:8000/predict';
  
  // Circuit Breaker State
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures = 0;
  private lastStateChange = Date.now();
  private recoveryTimeoutMs = 30000; // 30s recovery window

  public async initialize(modelPath: string): Promise<void> {
    this.state = EngineState.STARTING;
    console.log(`[FastApiAIEngine] Binding API endpoint to model: ${modelPath}`);
    this.isInitialized = true;
    this.state = EngineState.READY;
  }

  public async detect(frame: ICapturedFrame): Promise<IDetectionResult[]> {
    if (!this.isInitialized) {
      throw new Error('FastApiAIEngine is not initialized.');
    }

    // Check Circuit Breaker
    const now = Date.now();
    if (this.circuitState === 'OPEN') {
      if (now - this.lastStateChange > this.recoveryTimeoutMs) {
        console.log('[FastApiAIEngine CB] Attempting recovery (HALF_OPEN)...');
        this.circuitState = 'HALF_OPEN';
      } else {
        console.log('[FastApiAIEngine CB] Circuit is OPEN. Fallback to empty detections.');
        return [];
      }
    }

    try {
      // Fetch request to Python service
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: frame.imagePath }),
        signal: AbortSignal.timeout(2000) // 2s timeout
      });

      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      const data: any = await response.json();
      
      // Success resets the circuit breaker
      this.consecutiveFailures = 0;
      this.circuitState = 'CLOSED';
      this.state = EngineState.READY;

      return data.detections || [];
    } catch (err: any) {
      console.warn(`[FastApiAIEngine CB Error] Inference failed: ${err.message}`);
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= 5) {
        console.error('[FastApiAIEngine CB] 5 consecutive failures reached. Opening circuit breaker.');
        this.circuitState = 'OPEN';
        this.state = EngineState.DEGRADED;
        this.lastStateChange = Date.now();
      }

      // Fallback empty results to prevent blocking main backend threads
      return [];
    }
  }

  public async detectBatch(frames: ICapturedFrame[]): Promise<IDetectionResult[][]> {
    return Promise.all(frames.map(f => this.detect(f)));
  }
}
