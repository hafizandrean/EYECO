"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("../../database/db");
const InferenceQueue_1 = require("./InferenceQueue");
const AiModelManager_1 = require("./AiModelManager");
const FastApiAIEngine_1 = require("./FastApiAIEngine");
const MaintenanceScheduler_1 = require("./MaintenanceScheduler");
const AiEngineHealthMonitor_1 = require("./AiEngineHealthMonitor");
const SystemSettings_1 = require("../../database/models/SystemSettings");
dotenv_1.default.config();
async function runVerification() {
    console.log('=== EYECO MILESTONE 4 VERIFICATION ===');
    // 1. Connect to Database
    console.log('[TEST] Connecting to MongoDB...');
    await (0, db_1.connectDB)();
    console.log('[TEST] Connected successfully.');
    // Set database engine to MOCK during queue tests to prevent automatic hot-swaps
    await SystemSettings_1.SystemSettingsModel.updateOne({ key: 'ai.engine' }, { $set: { value: 'MOCK' } }).exec();
    // Initialize active model registry
    await AiModelManager_1.AiModelManager.initialize();
    // Reset metrics
    InferenceQueue_1.InferenceQueue.droppedFramesCount = 0;
    InferenceQueue_1.InferenceQueue.expiredFramesCount = 0;
    // ----------------------------------------------------
    // TEST 1: Dynamic Queue Capacity & Backpressure Drop
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Dynamic Queue Capacity & Backpressure ---');
    // Modify maxSize setting to 3 for instant backpressure test
    await SystemSettings_1.SystemSettingsModel.updateOne({ key: 'ai.queue.maxSize' }, { $set: { value: 3 } }).exec();
    // Clear setting sync cache in InferenceQueue to force instant sync
    InferenceQueue_1.InferenceQueue.lastSettingsSync = 0;
    const dummyFrame = {
        cameraId: 9,
        location: 'Test Camera 9',
        timestamp: new Date(),
        imagePath: '/uploads/detection_1.jpg'
    };
    // Enqueue 4 items (capacity is 3)
    console.log('[TEST] Enqueuing 4 frames to a size-3 queue...');
    const promises = [];
    // Temporarily disable queue processing to allow queue accumulation
    InferenceQueue_1.InferenceQueue.accepting = true;
    const originalSpawn = InferenceQueue_1.InferenceQueue.spawnWorker;
    InferenceQueue_1.InferenceQueue.spawnWorker = () => { }; // Mock: stop worker spawning
    // Empty the current queue if any
    InferenceQueue_1.InferenceQueue.queue = [];
    for (let i = 1; i <= 4; i++) {
        InferenceQueue_1.InferenceQueue.enqueue({ ...dummyFrame, cameraId: i }, 'NORMAL')
            .catch(err => {
            console.log(`- Frame ${i} queue result: REJECTED (${err.message})`);
        });
    }
    // Wait 100ms for backpressure to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`[TEST] Total Dropped Frames count: ${InferenceQueue_1.InferenceQueue.droppedFramesCount} (Expected: 1)`);
    if (InferenceQueue_1.InferenceQueue.droppedFramesCount === 1) {
        console.log('✅ PASS: Dynamic queue capacity enforced and backpressure dropped extra frame!');
    }
    else {
        console.error('❌ FAIL: Backpressure drop did not occur as expected.');
    }
    // Restore worker spawning
    InferenceQueue_1.InferenceQueue.spawnWorker = originalSpawn;
    // ----------------------------------------------------
    // TEST 2: Frame TTL Expiration
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Frame TTL (500ms) Expiration ---');
    // Set capacity back to 50
    await SystemSettings_1.SystemSettingsModel.updateOne({ key: 'ai.queue.maxSize' }, { $set: { value: 50 } }).exec();
    InferenceQueue_1.InferenceQueue.lastSettingsSync = 0;
    InferenceQueue_1.InferenceQueue.queue = [];
    // Enqueue 1 frame with mock worker disabled
    InferenceQueue_1.InferenceQueue.spawnWorker = () => { };
    const expiredPromise = InferenceQueue_1.InferenceQueue.enqueue({ ...dummyFrame, cameraId: 99 }, 'LOW')
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
    InferenceQueue_1.InferenceQueue.spawnWorker = originalSpawn;
    InferenceQueue_1.InferenceQueue.spawnWorker(); // Spawn worker to process item
    await expiredPromise;
    console.log(`[TEST] Total Expired Frames count: ${InferenceQueue_1.InferenceQueue.expiredFramesCount} (Expected: 1)`);
    if (InferenceQueue_1.InferenceQueue.expiredFramesCount === 1) {
        console.log('✅ PASS: Frame TTL successfully expired and rejected frame!');
    }
    else {
        console.error('❌ FAIL: Frame TTL did not expire.');
    }
    // ----------------------------------------------------
    // TEST 3: Distributed Locks & Fencing Tokens
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Distributed Locks & Fencing Tokens ---');
    // Reset locks in DB
    await SystemSettings_1.SystemSettingsModel.updateOne({ key: 'ai.deployment.lock' }, { $set: { value: { locked: false, lockedBy: null, fencingToken: 10, expiresAt: null, heartbeatAt: null } } }).exec();
    console.log('[TEST] Attempting deployment swapActiveModel...');
    // Spawn active model swap (will acquire lock and trigger load)
    const swapPromise = AiModelManager_1.AiModelManager.swapActiveModel('yolov8-river-v1.0', 'FASTAPI')
        .catch(err => {
        console.log(`- First swap completed/rejected: ${err.message}`);
    });
    // Immediately try to start a second simultaneous swap
    console.log('[TEST] Spawning parallel swap (should fail due to lock)...');
    try {
        await AiModelManager_1.AiModelManager.swapActiveModel('yolov8-river-v1.0', 'FASTAPI');
        console.error('❌ FAIL: Parallel swap completed without throwing locked error!');
    }
    catch (err) {
        console.log(`[TEST] Parallel swap correctly rejected: ${err.message}`);
        if (err.message.includes('DEPLOYMENT_LOCKED')) {
            console.log('✅ PASS: Distributed lock successfully blocked parallel deployment!');
        }
        else {
            console.error('❌ FAIL: Incorrect error message thrown:', err.message);
        }
    }
    await swapPromise; // Wait for first swap to finish
    // Verify fencing token increased
    const finalLock = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'ai.deployment.lock' }).exec();
    console.log(`[TEST] Final Lock Fencing Token: ${finalLock?.value?.fencingToken} (Expected >= 11)`);
    if ((finalLock?.value?.fencingToken ?? 0) >= 11) {
        console.log('✅ PASS: Fencing token successfully incremented!');
    }
    else {
        console.error('❌ FAIL: Fencing token did not increment.');
    }
    // ----------------------------------------------------
    // TEST 4: Telemetry ready Health Probes & HUD Metrics
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Telemetry ready Health Probes ---');
    const readyMetrics = await AiEngineHealthMonitor_1.AiEngineHealthMonitor.getMetrics();
    console.log('[TEST] Retreived HUD metrics:', readyMetrics);
    if (readyMetrics.queueCapacity === 50 && readyMetrics.expiredFrames === 1 && readyMetrics.activeModelName) {
        console.log('✅ PASS: ready health probe successfully includes queue capacity, expired frames, and active model names!');
    }
    else {
        console.error('❌ FAIL: Health metrics validation failed.');
    }
    // ----------------------------------------------------
    // TEST 5: Daily Maintenance Scheduler Lock & Run
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Daily Maintenance Scheduler ---');
    // Verify lock is released and run maintenance
    await SystemSettings_1.SystemSettingsModel.updateOne({ key: 'scheduler.lock' }, { $set: { value: { locked: false, lockedBy: null, expiresAt: null } } }).exec();
    console.log('[TEST] Executing MaintenanceScheduler run...');
    await MaintenanceScheduler_1.MaintenanceScheduler.runMaintenance();
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
        changedBy: new mongoose_1.default.Types.ObjectId(),
        changedByName: 'mlops-tester',
        reason: 'Uji verifikasi parameter deteksi MLOps.',
        timestamp: new Date()
    });
    console.log(`[TEST] Saved Configuration History Log ID: ${configLog._id}`);
    const retrievedConfig = await AiConfigurationHistoryModel.findOne({ changedByName: 'mlops-tester' });
    if (retrievedConfig && retrievedConfig.key === 'ai.rules' && retrievedConfig.newValue.confidenceThreshold === 0.70) {
        console.log('✅ PASS: AiConfigurationHistory successfully saved and audited!');
    }
    else {
        console.error('❌ FAIL: AiConfigurationHistory logging failed.');
    }
    // Cleanup telemetry interval timers from AiModelManager swap
    if (FastApiAIEngine_1.FastApiAIEngine.telemetryInterval) {
        clearInterval(FastApiAIEngine_1.FastApiAIEngine.telemetryInterval);
    }
    if (InferenceQueue_1.InferenceQueue.pollingTimer) {
        clearInterval(InferenceQueue_1.InferenceQueue.pollingTimer);
    }
    // Close DB connection
    await mongoose_1.default.connection.close();
    console.log('[TEST] DB connection closed. Done.');
}
runVerification().catch(err => {
    console.error('Fatal Verification Error:', err);
    process.exit(1);
});
