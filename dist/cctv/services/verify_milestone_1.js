"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("../../database/db");
const FastApiAIEngine_1 = require("./FastApiAIEngine");
dotenv_1.default.config();
async function runVerification() {
    console.log('=== EYECO MILESTONE 1 VERIFICATION ===');
    // 1. Connect to Database
    console.log('[TEST] Connecting to MongoDB...');
    await (0, db_1.connectDB)();
    console.log('[TEST] Connected successfully.');
    // 2. Ensure ai.engine setting is set to FASTAPI in database
    console.log('[TEST] Setting ai.engine to FASTAPI in MongoDB...');
    await db_1.SystemSettingsModel.findOneAndUpdate({ key: 'ai.engine' }, { value: 'FASTAPI', description: 'Mesin inferensi AI aktif.', updatedBy: 1 }, { upsert: true });
    // 3. Instantiate FastApiAIEngine
    console.log('[TEST] Instantiating FastApiAIEngine...');
    const engine = new FastApiAIEngine_1.FastApiAIEngine();
    // 4. Trigger Model Reload initialization
    console.log('[TEST] Initializing engine (triggers FastAPI /reload_model)...');
    try {
        // Pass default model weights path
        await engine.initialize('/weights/yolov8-river-v1.0.pt');
        console.log('[TEST] Engine initialization SUCCESS! Active model loaded.');
    }
    catch (err) {
        console.error('[TEST] Engine initialization FAILED:', err.message);
        process.exit(1);
    }
    // 5. Test prediction (Inference)
    console.log('[TEST] Running test detection (triggers FastAPI /api/v1/predict)...');
    const dummyFrame = {
        cameraId: 8,
        location: 'Sungai Ciliwung Jembatan Merah',
        timestamp: new Date(),
        imagePath: '/uploads/detection_1.jpg'
    };
    try {
        const results = await engine.detect(dummyFrame);
        console.log('[TEST] Detection response received!');
        console.log(JSON.stringify(results, null, 2));
        // Assert results format
        if (results.length > 0) {
            const first = results[0];
            if (first.class && first.confidence && first.bbox && first.geometry) {
                console.log('\n✅ VERIFICATION SUCCESS: All contract checks passed!');
                console.log(`- Detected Class: ${first.class}`);
                console.log(`- Confidence Score: ${first.confidence}`);
                console.log(`- Geometry Type: ${first.geometry.type}`);
                console.log(`- Geometry Coordinates: [${first.geometry.value.join(', ')}]`);
            }
            else {
                console.error('❌ VERIFICATION FAILED: Missing contract properties (class, confidence, bbox, geometry).');
            }
        }
        else {
            console.warn('⚠️ WARNING: No detections returned. This could occur if the model had no matching classes.');
        }
    }
    catch (err) {
        console.error('❌ VERIFICATION FAILED: Predict error:', err.message);
    }
    // Close DB connection
    await mongoose_1.default.connection.close();
    console.log('[TEST] DB connection closed. Done.');
}
runVerification().catch(err => {
    console.error('Fatal Verification Error:', err);
    process.exit(1);
});
