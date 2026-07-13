"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("../../database/db");
const FastApiAIEngine_1 = require("./FastApiAIEngine");
const AiInferenceMetrics_1 = require("../../database/models/AiInferenceMetrics");
const AiSystemMetrics_1 = require("../../database/models/AiSystemMetrics");
const AiModel_1 = require("../../database/models/AiModel");
dotenv_1.default.config();
async function runVerification() {
    console.log('=== EYECO MILESTONE 2 VERIFICATION ===');
    // 1. Connect to Database
    console.log('[TEST] Connecting to MongoDB...');
    await (0, db_1.connectDB)();
    console.log('[TEST] Connected successfully.');
    // Clean old metrics
    await AiInferenceMetrics_1.AiInferenceMetricsModel.deleteMany({});
    await AiSystemMetrics_1.AiSystemMetricsModel.deleteMany({});
    // 2. Instantiate and Initialize FastApiAIEngine
    console.log('[TEST] Instantiating and initializing FastApiAIEngine...');
    const engine = new FastApiAIEngine_1.FastApiAIEngine();
    try {
        await engine.initialize('/weights/yolov8-river-v1.0.pt');
        console.log('[TEST] Engine initialization SUCCESS! Active model loaded.');
    }
    catch (err) {
        console.error('[TEST] Engine initialization FAILED:', err.message);
        process.exit(1);
    }
    // Verify reload latency statistics saved in AiModelModel
    const modelRecord = await AiModel_1.AiModelModel.findOne({ id: 'yolov8-river-v1.0' });
    console.log(`[TEST] Model Registry reload latency: ${modelRecord?.modelLoadLatencyMs}ms, warmup: ${modelRecord?.warmupLatencyMs}ms`);
    if ((modelRecord?.modelLoadLatencyMs ?? 0) > 0) {
        console.log('✅ PASS: Reload deployment latency stats saved to database registry!');
    }
    else {
        console.error('❌ FAIL: Reload latency stats not saved.');
    }
    // 3. Trigger 5 successful detection runs to populate telemetry buffer
    console.log('\n--- TEST 1: Telemetry Performance Buffering (1 FPS) ---');
    const dummyFrame = {
        cameraId: 8,
        location: 'Sungai Ciliwung Jembatan Merah',
        timestamp: new Date(),
        imagePath: '/uploads/detection_1.jpg'
    };
    console.log('[TEST] Running 5 consecutive detections...');
    for (let i = 1; i <= 5; i++) {
        const results = await engine.detect(dummyFrame);
        console.log(`- Detection run ${i}/5 completed. Returned ${results.length} objects.`);
    }
    // 4. Manually trigger flushTelemetry to write buffer to MongoDB immediately (without waiting 10s)
    console.log('[TEST] Manually triggering telemetry flush...');
    await engine.flushTelemetry();
    // 5. Verify records in MongoDB
    const inferenceMetricsCount = await AiInferenceMetrics_1.AiInferenceMetricsModel.countDocuments({});
    const systemMetricsCount = await AiSystemMetrics_1.AiSystemMetricsModel.countDocuments({});
    console.log(`[TEST] Total Inference Metrics stored: ${inferenceMetricsCount} (Expected: 5)`);
    console.log(`[TEST] Total System Hardware Metrics stored: ${systemMetricsCount} (Expected: 1)`);
    if (inferenceMetricsCount === 5 && systemMetricsCount === 1) {
        console.log('✅ PASS: Buffered performance latency and GPU/CPU hardware metrics successfully flushed to MongoDB!');
    }
    else {
        console.error('❌ FAIL: Telemetry metrics flush verification failed.');
    }
    // 6. Test Circuit Breaker: Failure Injection
    console.log('\n--- TEST 2: Circuit Breaker Failure Injection ---');
    console.log('[TEST] Current Circuit State: CLOSED (normal)');
    // Inject invalid URL to simulate connection refusal/network error
    engine.predictUrl = 'http://localhost:9999/api/v1/predict';
    console.log('[TEST] Simulating network failures to trip circuit breaker (requires 5 failures)...');
    for (let i = 1; i <= 5; i++) {
        await engine.detect(dummyFrame);
        console.log(`- Detection attempt ${i}/5 triggered. Circuit state consecutive failures: ${engine.consecutiveFailures}`);
    }
    console.log(`[TEST] Final Circuit State: ${engine.circuitState} (Expected: OPEN)`);
    if (engine.circuitState === 'OPEN') {
        console.log('✅ PASS: Circuit Breaker successfully tripped to OPEN state after 5 consecutive network errors!');
    }
    else {
        console.error('❌ FAIL: Circuit Breaker failed to trip.');
    }
    // Clean up telemetry timer interval
    if (FastApiAIEngine_1.FastApiAIEngine.telemetryInterval) {
        clearInterval(FastApiAIEngine_1.FastApiAIEngine.telemetryInterval);
    }
    // Close DB connection
    await mongoose_1.default.connection.close();
    console.log('[TEST] DB connection closed. Done.');
}
runVerification().catch(err => {
    console.error('Fatal Verification Error:', err);
    process.exit(1);
});
