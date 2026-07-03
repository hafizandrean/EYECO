"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastApiAIEngine = void 0;
const IAIEngine_1 = require("./IAIEngine");
class FastApiAIEngine {
    name = 'FastAPI Microservice Engine';
    maxBatchSize = 16;
    state = IAIEngine_1.EngineState.STARTING;
    isInitialized = false;
    serverUrl = 'http://localhost:8000/predict';
    // Circuit Breaker State
    circuitState = 'CLOSED';
    consecutiveFailures = 0;
    lastStateChange = Date.now();
    recoveryTimeoutMs = 30000; // 30s recovery window
    async initialize(modelPath) {
        this.state = IAIEngine_1.EngineState.STARTING;
        console.log(`[FastApiAIEngine] Binding API endpoint to model: ${modelPath}`);
        this.isInitialized = true;
        this.state = IAIEngine_1.EngineState.READY;
    }
    async detect(frame) {
        if (!this.isInitialized) {
            throw new Error('FastApiAIEngine is not initialized.');
        }
        // Check Circuit Breaker
        const now = Date.now();
        if (this.circuitState === 'OPEN') {
            if (now - this.lastStateChange > this.recoveryTimeoutMs) {
                console.log('[FastApiAIEngine CB] Attempting recovery (HALF_OPEN)...');
                this.circuitState = 'HALF_OPEN';
            }
            else {
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
            const data = await response.json();
            // Success resets the circuit breaker
            this.consecutiveFailures = 0;
            this.circuitState = 'CLOSED';
            this.state = IAIEngine_1.EngineState.READY;
            return data.detections || [];
        }
        catch (err) {
            console.warn(`[FastApiAIEngine CB Error] Inference failed: ${err.message}`);
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= 5) {
                console.error('[FastApiAIEngine CB] 5 consecutive failures reached. Opening circuit breaker.');
                this.circuitState = 'OPEN';
                this.state = IAIEngine_1.EngineState.DEGRADED;
                this.lastStateChange = Date.now();
            }
            // Fallback empty results to prevent blocking main backend threads
            return [];
        }
    }
    async detectBatch(frames) {
        return Promise.all(frames.map(f => this.detect(f)));
    }
}
exports.FastApiAIEngine = FastApiAIEngine;
