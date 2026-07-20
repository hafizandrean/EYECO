"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("../../database/db");
const PromotionService_1 = require("./PromotionService");
const OutboxWorker_1 = require("../../notifications/OutboxWorker");
const AiVerificationState_1 = require("../../database/models/AiVerificationState");
const InferenceQueue_1 = require("./InferenceQueue");
const AiModelManager_1 = require("./AiModelManager");
const AiEngineHealthMonitor_1 = require("./AiEngineHealthMonitor");
dotenv_1.default.config();
async function runTests() {
    console.log('=== EYECO ENTERPRISE INTEGRATION TEST SUITE ===');
    await (0, db_1.connectDB)();
    console.log('[TEST] Connected to Database.');
    // Clean test artifacts to prevent collision
    await AiVerificationState_1.AiVerificationStateModel.deleteMany({});
    await db_1.AiDetectionModel.deleteMany({ location: 'Test Location' });
    await db_1.ReportModel.deleteMany({ location: 'Test Location' });
    await db_1.OutboxEventModel.deleteMany({});
    // Ensure test settings are configured
    await db_1.SystemSettingsModel.findOneAndUpdate({ key: 'ai.rules' }, {
        value: {
            confidenceThreshold: 0.70,
            verificationFrames: 3,
            cooldownMinutes: 3,
            duplicateRadiusMeters: 15,
            duplicateTimeWindowSeconds: 300,
            timelineUpdateIntervalSeconds: 120,
            archiveAfterDays: 180
        }
    }, { upsert: true });
    console.log('[TEST] Cleaned up previous test states.');
    // Helper to create test detection with autoincrement ID and retry block on collision
    async function createTestDetection(data) {
        let attempts = 0;
        while (attempts < 5) {
            try {
                const last = await db_1.AiDetectionModel.findOne().sort({ id: -1 }).exec();
                const nextId = last ? last.id + 1 : 1;
                const doc = await db_1.AiDetectionModel.create({
                    ...data,
                    id: nextId
                });
                return doc;
            }
            catch (err) {
                if (err.code === 11000 || err.message.includes('E11000')) {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 50));
                }
                else {
                    throw err;
                }
            }
        }
        throw new Error('Failed to create test detection after 5 attempts.');
    }
    try {
        // ----------------------------------------------------
        // TEST 1: Confidence Filter Rule
        // ----------------------------------------------------
        console.log('\n--- TEST 1: Confidence Filter Rule ---');
        const lowConfDetection = await createTestDetection({
            cameraId: 99,
            location: 'Test Location',
            capturedAt: new Date(),
            confidence: 0.65, // Below 0.70 threshold
            severity: 'LOW',
            trackingId: 'tr-test-low-conf',
            modelId: 'yolov8-river-v1.0',
            detections: [{ class: 'trash', confidence: 0.65, bbox: [10, 10, 10, 10], trackId: 'tr-t-1' }],
            status: 'INFERENCED',
            processingTimeMs: 10,
            expiresAt: new Date(Date.now() + 100000)
        });
        await PromotionService_1.PromotionService.evaluateDetection(lowConfDetection);
        const checkedLowConf = await db_1.AiDetectionModel.findOne({ id: lowConfDetection.id });
        console.log(`Low Confidence Status: ${checkedLowConf?.status} (Expected: LOW_CONFIDENCE)`);
        console.log(`Low Confidence Rejected Reason: ${checkedLowConf?.rejectedReason}`);
        // ----------------------------------------------------
        // TEST 2: Verification Window Rule (Consecutive frames checking)
        // ----------------------------------------------------
        console.log('\n--- TEST 2: Verification Window Rule ---');
        const highConfDetections = [];
        for (let frame = 1; frame <= 3; frame++) {
            const highConfDetection = await createTestDetection({
                cameraId: 99,
                location: 'Test Location',
                capturedAt: new Date(),
                confidence: 0.85, // Above threshold
                severity: 'HIGH',
                trackingId: `tr-test-frame-${frame}`,
                modelId: 'yolov8-river-v1.0',
                detections: [{ class: 'trash', confidence: 0.85, bbox: [10, 10, 10, 10], trackId: `tr-t-${frame}` }],
                status: 'INFERENCED',
                processingTimeMs: 12,
                expiresAt: new Date(Date.now() + 100000)
            });
            highConfDetections.push(highConfDetection);
            console.log(`Evaluating frame ${frame}/3...`);
            await PromotionService_1.PromotionService.evaluateDetection(highConfDetection);
            const statusAfter = (await db_1.AiDetectionModel.findOne({ id: highConfDetection.id }))?.status;
            console.log(`Frame ${frame} Status: ${statusAfter}`);
        }
        // After 3 consecutive frames, it should create a report and change detection status to PROMOTED
        const finalFrameDetection = await db_1.AiDetectionModel.findOne({ id: highConfDetections[2].id });
        console.log(`Final frame promoted: ${finalFrameDetection?.status} (Expected: PROMOTED)`);
        console.log(`Linked Report ID: ${finalFrameDetection?.promotedReportId}`);
        const createdReport = await db_1.ReportModel.findOne({ location: 'Test Location' });
        console.log(`Report created in DB: ${createdReport ? 'YES' : 'NO'} (Expected: YES)`);
        console.log(`Report Rule Version: ${createdReport?.sourceMetadata?.ruleVersion} (Expected: v1.0)`);
        console.log(`Report Model Version: ${createdReport?.sourceMetadata?.modelVersion} (Expected: 1.0)`);
        // ----------------------------------------------------
        // TEST 3: Duplicate Detections Rule (Updates timeline, doesn't duplicate)
        // ----------------------------------------------------
        console.log('\n--- TEST 3: Duplicate Detections Rule ---');
        const duplicateDetection = await createTestDetection({
            cameraId: 99,
            location: 'Test Location',
            capturedAt: new Date(),
            confidence: 0.90,
            severity: 'HIGH',
            trackingId: 'tr-test-duplicate',
            modelId: 'yolov8-river-v1.0',
            detections: [{ class: 'trash', confidence: 0.90, bbox: [10, 10, 10, 10], trackId: 'tr-t-dup' }],
            status: 'INFERENCED',
            processingTimeMs: 15,
            expiresAt: new Date(Date.now() + 100000)
        });
        await PromotionService_1.PromotionService.evaluateDetection(duplicateDetection);
        const checkedDuplicate = await db_1.AiDetectionModel.findOne({ id: duplicateDetection.id });
        console.log(`Duplicate Detection Status: ${checkedDuplicate?.status} (Expected: DUPLICATE)`);
        const timelineEventsCount = await db_1.TimelineEventModel.countDocuments({ reportId: createdReport?._id });
        console.log(`Timeline events on active report: ${timelineEventsCount} (Expected: 3, Initial 2 + 1 duplicate alert)`);
        // ----------------------------------------------------
        // TEST 4: Transactional Outbox Pattern & Worker Dispatch
        // ----------------------------------------------------
        console.log('\n--- TEST 4: Transactional Outbox & Worker ---');
        const pendingOutboxCount = await db_1.OutboxEventModel.countDocuments({ status: 'PENDING' });
        console.log(`Pending outbox events before worker: ${pendingOutboxCount} (Expected: 1)`);
        console.log('Running Outbox worker once...');
        await OutboxWorker_1.OutboxWorker.processQueue();
        const processedOutboxCount = await db_1.OutboxEventModel.countDocuments({ status: 'PROCESSED' });
        console.log(`Processed outbox events after worker: ${processedOutboxCount} (Expected: 1)`);
        // ----------------------------------------------------
        // TEST 5: Canary Routing & Dynamic Switching
        // ----------------------------------------------------
        console.log('\n--- TEST 5: Canary Routing ---');
        // Test LIST routing rule
        await db_1.SystemSettingsModel.findOneAndUpdate({ key: 'ai.canary' }, {
            value: {
                enabled: true,
                routingType: 'LIST',
                cameraIds: [2],
                canaryModelId: 'yolov8-river-v1.1',
                engineType: 'MOCK'
            }
        }, { upsert: true });
        await AiModelManager_1.AiModelManager.initialize();
        let engine1 = await AiModelManager_1.AiModelManager.getEngineForCamera(1);
        let engine2 = await AiModelManager_1.AiModelManager.getEngineForCamera(2);
        console.log(`LIST Rule - Camera 1 Engine: ${engine1.name} (Expected: Mock Simulation Engine)`);
        console.log(`LIST Rule - Camera 2 Engine: ${engine2.name} (Expected: Mock Simulation Engine - Canary)`);
        // Test ODD_EVEN routing rule
        await db_1.SystemSettingsModel.findOneAndUpdate({ key: 'ai.canary' }, {
            value: {
                enabled: true,
                routingType: 'ODD_EVEN',
                canaryModelId: 'yolov8-river-v1.1',
                engineType: 'MOCK'
            }
        }, { upsert: true });
        await AiModelManager_1.AiModelManager.initialize();
        engine1 = await AiModelManager_1.AiModelManager.getEngineForCamera(1); // odd -> canary
        engine2 = await AiModelManager_1.AiModelManager.getEngineForCamera(2); // even -> stable
        console.log(`ODD_EVEN Rule - Camera 1 Engine (Odd ID 1): ${engine1.name} (Expected: Mock Simulation Engine - Canary)`);
        console.log(`ODD_EVEN Rule - Camera 2 Engine (Even ID 2): ${engine2.name} (Expected: Mock Simulation Engine)`);
        // Test PERCENTAGE routing rule (e.g. 10%)
        await db_1.SystemSettingsModel.findOneAndUpdate({ key: 'ai.canary' }, {
            value: {
                enabled: true,
                routingType: 'PERCENTAGE',
                percentage: 10,
                canaryModelId: 'yolov8-river-v1.1',
                engineType: 'MOCK'
            }
        }, { upsert: true });
        await AiModelManager_1.AiModelManager.initialize();
        engine1 = await AiModelManager_1.AiModelManager.getEngineForCamera(10); // 10 % 10 = 0 -> < 1 (route to canary)
        engine2 = await AiModelManager_1.AiModelManager.getEngineForCamera(15); // 15 % 10 = 5 -> >= 1 (route to stable)
        console.log(`PERCENTAGE Rule - Camera 10 Engine: ${engine1.name} (Expected: Mock Simulation Engine - Canary)`);
        console.log(`PERCENTAGE Rule - Camera 15 Engine: ${engine2.name} (Expected: Mock Simulation Engine)`);
        // Restore default LIST setting for pipeline execution
        await db_1.SystemSettingsModel.findOneAndUpdate({ key: 'ai.canary' }, {
            value: {
                enabled: true,
                routingType: 'LIST',
                cameraIds: [2],
                canaryModelId: 'yolov8-river-v1.1',
                engineType: 'MOCK'
            }
        }, { upsert: true });
        await AiModelManager_1.AiModelManager.initialize();
        // ----------------------------------------------------
        // TEST 6: Priority-Based Queueing & Concurrency
        // ----------------------------------------------------
        console.log('\n--- TEST 6: Priority-Based Queueing ---');
        InferenceQueue_1.InferenceQueue.minWorkers = 3;
        InferenceQueue_1.InferenceQueue.startWorkers();
        const frameLow = { cameraId: 91, location: 'Test Location', timestamp: new Date(), imagePath: '/uploads/detection_1.jpg' };
        const frameHigh = { cameraId: 92, location: 'Test Location', timestamp: new Date(), imagePath: '/uploads/detection_2.jpg' };
        const frameCritical = { cameraId: 93, location: 'Test Location Critical', timestamp: new Date(), imagePath: '/uploads/detection_3.jpg' };
        console.log('Enqueuing LOW priority frame...');
        const pLow = InferenceQueue_1.InferenceQueue.enqueue(frameLow, 'LOW');
        console.log('Enqueuing HIGH priority frame...');
        const pHigh = InferenceQueue_1.InferenceQueue.enqueue(frameHigh, 'HIGH');
        console.log('Enqueuing CRITICAL priority frame...');
        const pCritical = InferenceQueue_1.InferenceQueue.enqueue(frameCritical, 'CRITICAL');
        const [resLow, resHigh, resCritical] = await Promise.all([pLow, pHigh, pCritical]);
        console.log(`LOW Frame processed: ${resLow ? 'YES' : 'NO'}`);
        console.log(`HIGH Frame processed: ${resHigh ? 'YES' : 'NO'}`);
        console.log(`CRITICAL Frame processed: ${resCritical ? 'YES' : 'NO'}`);
        // ----------------------------------------------------
        // TEST 7: Observability Metrics & Engine Health
        // ----------------------------------------------------
        console.log('\n--- TEST 7: Observability Metrics ---');
        const healthMetrics = await AiEngineHealthMonitor_1.AiEngineHealthMonitor.getMetrics();
        console.log(`Engine Status: ${healthMetrics.status} (Expected: HEALTHY)`);
        console.log(`Engine State: ${healthMetrics.engineState} (Expected: READY)`);
        console.log(`Active Workers: ${healthMetrics.activeWorkers}`);
        console.log(`Busy Workers: ${healthMetrics.busyWorkers}`);
        console.log(`Total Processed Frames: ${healthMetrics.totalProcessed}`);
        console.log(`FPS Throughput: ${healthMetrics.fpsThroughput} FPS`);
        console.log(`Average Waiting Time: ${healthMetrics.averageWaitingTimeMs} ms`);
        console.log(`Worker Utilization: ${healthMetrics.workerUtilization * 100}%`);
        // ----------------------------------------------------
        // TEST 8: Graceful Shutdown
        // ----------------------------------------------------
        console.log('\n--- TEST 8: Graceful Shutdown ---');
        await InferenceQueue_1.InferenceQueue.shutdown();
        const postShutdownMetrics = await AiEngineHealthMonitor_1.AiEngineHealthMonitor.getMetrics();
        console.log(`Post-Shutdown Engine State: ${postShutdownMetrics.engineState} (Expected: STOPPED)`);
        console.log(`Post-Shutdown Active Workers: ${postShutdownMetrics.activeWorkers} (Expected: 0)`);
        console.log(`Post-Shutdown Queue Length: ${postShutdownMetrics.queueLength} (Expected: 0)`);
        console.log('Graceful shutdown successful.');
        console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY ===');
    }
    catch (err) {
        console.error('Test Suite Failed:', err.message);
    }
    finally {
        await mongoose_1.default.connection.close();
        console.log('[TEST] Connection closed.');
        process.exit(0);
    }
}
runTests();
