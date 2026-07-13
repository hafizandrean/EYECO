import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, SystemSettingsModel } from '../../database/db';
import { FastApiAIEngine } from './FastApiAIEngine';
import { ICapturedFrame } from './FrameCaptureService';

dotenv.config();

async function runVerification() {
  console.log('=== EYECO MILESTONE 1 VERIFICATION ===');
  
  // 1. Connect to Database
  console.log('[TEST] Connecting to MongoDB...');
  await connectDB();
  console.log('[TEST] Connected successfully.');

  // 2. Ensure ai.engine setting is set to FASTAPI in database
  console.log('[TEST] Setting ai.engine to FASTAPI in MongoDB...');
  await SystemSettingsModel.findOneAndUpdate(
    { key: 'ai.engine' },
    { value: 'FASTAPI', description: 'Mesin inferensi AI aktif.', updatedBy: 1 },
    { upsert: true }
  );

  // 3. Instantiate FastApiAIEngine
  console.log('[TEST] Instantiating FastApiAIEngine...');
  const engine = new FastApiAIEngine();
  
  // 4. Trigger Model Reload initialization
  console.log('[TEST] Initializing engine (triggers FastAPI /reload_model)...');
  try {
    // Pass default model weights path
    await engine.initialize('/weights/yolov8-river-v1.0.pt');
    console.log('[TEST] Engine initialization SUCCESS! Active model loaded.');
  } catch (err: any) {
    console.error('[TEST] Engine initialization FAILED:', err.message);
    process.exit(1);
  }

  // 5. Test prediction (Inference)
  console.log('[TEST] Running test detection (triggers FastAPI /api/v1/predict)...');
  const dummyFrame: ICapturedFrame = {
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
      } else {
        console.error('❌ VERIFICATION FAILED: Missing contract properties (class, confidence, bbox, geometry).');
      }
    } else {
      console.warn('⚠️ WARNING: No detections returned. This could occur if the model had no matching classes.');
    }
  } catch (err: any) {
    console.error('❌ VERIFICATION FAILED: Predict error:', err.message);
  }

  // Close DB connection
  await mongoose.connection.close();
  console.log('[TEST] DB connection closed. Done.');
}

runVerification().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
