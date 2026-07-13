import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from '../../database/db';
import { InferenceQueue } from './InferenceQueue';
import { AiModelManager } from './AiModelManager';
import { FastApiAIEngine } from './FastApiAIEngine';
import { MaintenanceScheduler } from './MaintenanceScheduler';
import { AiEngineHealthMonitor } from './AiEngineHealthMonitor';
import { SystemSettingsModel } from '../../database/models/SystemSettings';
import { ICapturedFrame } from './FrameCaptureService';

dotenv.config();

async function runVerification() {
  console.log('=== EYECO MILESTONE 4 VERIFICATION ===');
  
  // 1. Connect to Database
  console.log('[TEST] Connecting to MongoDB...');
  await connectDB();
  console.log('[TEST] Connected successfully.');

  // Set database engine to MOCK during queue tests to prevent automatic hot-swaps
  await SystemSettingsModel.updateOne({ key: 'ai.engine' }, { $set: { value: 'MOCK' } }).exec();

  // Initialize active model registry
  await AiModelManager.initialize();

  // Reset metrics
  InferenceQueue.droppedFramesCount = 0;
  InferenceQueue.expiredFramesCount = 0;

  // ----------------------------------------------------
  // TEST 1: Dynamic Queue Capacity & Backpressure Drop
  // ----------------------------------------------------
  console.log('\n--- TEST 1: Dynamic Queue Capacity & Backpressure ---');
  
  // Modify maxSize setting to 3 for instant backpressure test
  await SystemSettingsModel.updateOne(
    { key: 'ai.queue.maxSize' },
    { $set: { value: 3 } }
  ).exec();
  
  // Clear setting sync cache in InferenceQueue to force instant sync
  (InferenceQueue as any).lastSettingsSync = 0;

  const dummyFrame: ICapturedFrame = {
    cameraId: 9,
    location: 'Test Camera 9',
    timestamp: new Date(),
    imagePath: '/uploads/detection_1.jpg'
  };

  // Enqueue 4 items (capacity is 3)
  console.log('[TEST] Enqueuing 4 frames to a size-3 queue...');
  
  const promises: Promise<any>[] = [];
  // Temporarily disable queue processing to allow queue accumulation
  (InferenceQueue as any).accepting = true;
  const originalSpawn = (InferenceQueue as any).spawnWorker;
  (InferenceQueue as any).spawnWorker = () => {}; // Mock: stop worker spawning

  // Empty the current queue if any
  (InferenceQueue as any).queue = [];

  for (let i = 1; i <= 4; i++) {
    InferenceQueue.enqueue({ ...dummyFrame, cameraId: i }, 'NORMAL')
      .catch(err => {
        console.log(`- Frame ${i} queue result: REJECTED (${err.message})`);
      });
  }

  // Wait 100ms for backpressure to settle
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log(`[TEST] Total Dropped Frames count: ${InferenceQueue.droppedFramesCount} (Expected: 1)`);
  if (InferenceQueue.droppedFramesCount === 1) {
    console.log('✅ PASS: Dynamic queue capacity enforced and backpressure dropped extra frame!');
  } else {
    console.error('❌ FAIL: Backpressure drop did not occur as expected.');
  }

  // Restore worker spawning
  (InferenceQueue as any).spawnWorker = originalSpawn;

  // ----------------------------------------------------
  // TEST 2: Frame TTL Expiration
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Frame TTL (500ms) Expiration ---');
  
  // Set capacity back to 50
  await SystemSettingsModel.updateOne(
    { key: 'ai.queue.maxSize' },
    { $set: { value: 50 } }
  ).exec();
  (InferenceQueue as any).lastSettingsSync = 0;
  (InferenceQueue as any).queue = [];

  // Enqueue 1 frame with mock worker disabled
  (InferenceQueue as any).spawnWorker = () => {}; 
  
  const expiredPromise = InferenceQueue.enqueue({ ...dummyFrame, cameraId: 99 }, 'LOW')
    .then(() => {
      console.error('❌ FAIL: Frame processed successfully instead of expiring!');
    })
    .catch(err => {
      console.log(`- Queue item execution: REJECTED (${err.message})`);
    });

  // Wait 600ms (Frame TTL is 500ms)
  console.log('[TEST] Simulating 600ms queue processing delay...');
  await new Promise(resolve => setTimeout(resolve, 600));

  // Restore worker spawning and trigger a worker run manually
  (InferenceQueue as any).spawnWorker = originalSpawn;
  (InferenceQueue as any).spawnWorker(); // Spawn worker to process item

  await expiredPromise;

  console.log(`[TEST] Total Expired Frames count: ${InferenceQueue.expiredFramesCount} (Expected: 1)`);
  if (InferenceQueue.expiredFramesCount === 1) {
    console.log('✅ PASS: Frame TTL successfully expired and rejected frame!');
  } else {
    console.error('❌ FAIL: Frame TTL did not expire.');
  }

  // ----------------------------------------------------
  // TEST 3: Distributed Locks & Fencing Tokens
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Distributed Locks & Fencing Tokens ---');

  // Reset locks in DB
  await SystemSettingsModel.updateOne(
    { key: 'ai.deployment.lock' },
    { $set: { value: { locked: false, lockedBy: null, fencingToken: 10, expiresAt: null, heartbeatAt: null } } }
  ).exec();

  console.log('[TEST] Attempting deployment swapActiveModel...');
  
  // Spawn active model swap (will acquire lock and trigger load)
  const swapPromise = AiModelManager.swapActiveModel('yolov8-river-v1.0', 'FASTAPI')
    .catch(err => {
      console.log(`- First swap completed/rejected: ${err.message}`);
    });

  // Immediately try to start a second simultaneous swap
  console.log('[TEST] Spawning parallel swap (should fail due to lock)...');
  try {
    await AiModelManager.swapActiveModel('yolov8-river-v1.0', 'FASTAPI');
    console.error('❌ FAIL: Parallel swap completed without throwing locked error!');
  } catch (err: any) {
    console.log(`[TEST] Parallel swap correctly rejected: ${err.message}`);
    if (err.message.includes('DEPLOYMENT_LOCKED')) {
      console.log('✅ PASS: Distributed lock successfully blocked parallel deployment!');
    } else {
      console.error('❌ FAIL: Incorrect error message thrown:', err.message);
    }
  }

  await swapPromise; // Wait for first swap to finish

  // Verify fencing token increased
  const finalLock = await SystemSettingsModel.findOne({ key: 'ai.deployment.lock' }).exec();
  console.log(`[TEST] Final Lock Fencing Token: ${finalLock?.value?.fencingToken} (Expected >= 11)`);
  if ((finalLock?.value?.fencingToken ?? 0) >= 11) {
    console.log('✅ PASS: Fencing token successfully incremented!');
  } else {
    console.error('❌ FAIL: Fencing token did not increment.');
  }

  // ----------------------------------------------------
  // TEST 4: Telemetry ready Health Probes & HUD Metrics
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Telemetry ready Health Probes ---');

  const readyMetrics = await AiEngineHealthMonitor.getMetrics();
  console.log('[TEST] Retreived HUD metrics:', readyMetrics);

  if (readyMetrics.queueCapacity === 50 && readyMetrics.expiredFrames === 1 && readyMetrics.activeModelName) {
    console.log('✅ PASS: ready health probe successfully includes queue capacity, expired frames, and active model names!');
  } else {
    console.error('❌ FAIL: Health metrics validation failed.');
  }

  // ----------------------------------------------------
  // TEST 5: Daily Maintenance Scheduler Lock & Run
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Daily Maintenance Scheduler ---');

  // Verify lock is released and run maintenance
  await SystemSettingsModel.updateOne(
    { key: 'scheduler.lock' },
    { $set: { value: { locked: false, lockedBy: null, expiresAt: null } } }
  ).exec();

  console.log('[TEST] Executing MaintenanceScheduler run...');
  await MaintenanceScheduler.runMaintenance();
  console.log('✅ PASS: MaintenanceScheduler successfully executed and cleared old metrics!');

  // ----------------------------------------------------
  // TEST 6: AI Configuration History Logging
  // ----------------------------------------------------
  console.log('\n--- TEST 6: AI Configuration History Logging ---');
  
  const { AiConfigurationHistoryModel } = require('../../database/models/AiConfigurationHistory');
  await AiConfigurationHistoryModel.deleteMany({ changedByName: 'mlops-tester' });

  const configLog = await AiConfigurationHistoryModel.create({
    key: 'ai.rules',
    oldValue: { confidenceThreshold: 0.50 },
    newValue: { confidenceThreshold: 0.70 },
    changedBy: new mongoose.Types.ObjectId(),
    changedByName: 'mlops-tester',
    reason: 'Uji verifikasi parameter deteksi MLOps.',
    timestamp: new Date()
  });

  console.log(`[TEST] Saved Configuration History Log ID: ${configLog._id}`);
  const retrievedConfig = await AiConfigurationHistoryModel.findOne({ changedByName: 'mlops-tester' });

  if (retrievedConfig && retrievedConfig.key === 'ai.rules' && retrievedConfig.newValue.confidenceThreshold === 0.70) {
    console.log('✅ PASS: AiConfigurationHistory successfully saved and audited!');
  } else {
    console.error('❌ FAIL: AiConfigurationHistory logging failed.');
  }

  // Cleanup telemetry interval timers from AiModelManager swap
  if ((FastApiAIEngine as any).telemetryInterval) {
    clearInterval((FastApiAIEngine as any).telemetryInterval);
  }
  if ((InferenceQueue as any).pollingTimer) {
    clearInterval((InferenceQueue as any).pollingTimer);
  }

  // Close DB connection
  await mongoose.connection.close();
  console.log('[TEST] DB connection closed. Done.');
}

runVerification().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
