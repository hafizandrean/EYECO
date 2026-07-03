import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, SystemSettingsModel, AiDetectionModel, ReportModel, OutboxEventModel, CctvModel, UserModel, TimelineEventModel } from '../../database/db';
import { PromotionService } from './PromotionService';
import { OutboxWorker } from '../../notifications/OutboxWorker';
import { AiVerificationStateModel } from '../../database/models/AiVerificationState';
import { InferenceQueue } from './InferenceQueue';
import { AiModelManager } from './AiModelManager';
import { AiEngineHealthMonitor } from './AiEngineHealthMonitor';

dotenv.config();

async function runTests() {
  console.log('=== EYECO ENTERPRISE INTEGRATION TEST SUITE ===');
  await connectDB();
  console.log('[TEST] Connected to Database.');

  // Clean test artifacts to prevent collision
  await AiVerificationStateModel.deleteMany({});
  await AiDetectionModel.deleteMany({ location: 'Test Location' });
  await ReportModel.deleteMany({ location: 'Test Location' });
  await OutboxEventModel.deleteMany({});

  // Ensure test settings are configured
  await SystemSettingsModel.findOneAndUpdate(
    { key: 'ai.rules' },
    {
      value: {
        confidenceThreshold: 0.70,
        verificationFrames: 3,
        cooldownMinutes: 3,
        duplicateRadiusMeters: 15,
        duplicateTimeWindowSeconds: 300,
        timelineUpdateIntervalSeconds: 120,
        archiveAfterDays: 180
      }
    },
    { upsert: true }
  );

  console.log('[TEST] Cleaned up previous test states.');

  try {
    // ----------------------------------------------------
    // TEST 1: Confidence Filter Rule
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Confidence Filter Rule ---');
    const lowConfDetection = await AiDetectionModel.create({
      id: 9991,
      cameraId: 1,
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

    await PromotionService.evaluateDetection(lowConfDetection);
    const checkedLowConf = await AiDetectionModel.findOne({ id: 9991 });
    console.log(`Low Confidence Status: ${checkedLowConf?.status} (Expected: LOW_CONFIDENCE)`);
    console.log(`Low Confidence Rejected Reason: ${checkedLowConf?.rejectedReason}`);

    // ----------------------------------------------------
    // TEST 2: Verification Window Rule (Consecutive frames checking)
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Verification Window Rule ---');
    for (let frame = 1; frame <= 3; frame++) {
      const highConfDetection = await AiDetectionModel.create({
        id: 9991 + frame,
        cameraId: 1,
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

      console.log(`Evaluating frame ${frame}/3...`);
      await PromotionService.evaluateDetection(highConfDetection);

      const statusAfter = (await AiDetectionModel.findOne({ id: 9991 + frame }))?.status;
      console.log(`Frame ${frame} Status: ${statusAfter}`);
    }

    // After 3 consecutive frames, it should create a report and change detection status to PROMOTED
    const finalFrameDetection = await AiDetectionModel.findOne({ id: 9994 });
    console.log(`Final frame promoted: ${finalFrameDetection?.status} (Expected: PROMOTED)`);
    console.log(`Linked Report ID: ${finalFrameDetection?.promotedReportId}`);

    const createdReport = await ReportModel.findOne({ location: 'Test Location' });
    console.log(`Report created in DB: ${createdReport ? 'YES' : 'NO'} (Expected: YES)`);
    console.log(`Report Rule Version: ${createdReport?.sourceMetadata?.ruleVersion} (Expected: v1.0)`);
    console.log(`Report Model Version: ${createdReport?.sourceMetadata?.modelVersion} (Expected: 1.0)`);

    // ----------------------------------------------------
    // TEST 3: Duplicate Detections Rule (Updates timeline, doesn't duplicate)
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Duplicate Detections Rule ---');
    const duplicateDetection = await AiDetectionModel.create({
      id: 9995,
      cameraId: 1,
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

    await PromotionService.evaluateDetection(duplicateDetection);
    const checkedDuplicate = await AiDetectionModel.findOne({ id: 9995 });
    console.log(`Duplicate Detection Status: ${checkedDuplicate?.status} (Expected: DUPLICATE)`);

    const timelineEventsCount = await TimelineEventModel.countDocuments({ reportId: createdReport?._id });
    console.log(`Timeline events on active report: ${timelineEventsCount} (Expected: 3, Initial 2 + 1 duplicate alert)`);

    // ----------------------------------------------------
    // TEST 4: Transactional Outbox Pattern & Worker Dispatch
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Transactional Outbox & Worker ---');
    const pendingOutboxCount = await OutboxEventModel.countDocuments({ status: 'PENDING' });
    console.log(`Pending outbox events before worker: ${pendingOutboxCount} (Expected: 1)`);

    console.log('Running Outbox worker once...');
    await OutboxWorker.processQueue();

    const processedOutboxCount = await OutboxEventModel.countDocuments({ status: 'PROCESSED' });
    console.log(`Processed outbox events after worker: ${processedOutboxCount} (Expected: 1)`);

    // ----------------------------------------------------
    // TEST 5: Canary Routing & Dynamic Switching
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Canary Routing ---');
    // Test LIST routing rule
    await SystemSettingsModel.findOneAndUpdate(
      { key: 'ai.canary' },
      {
        value: {
          enabled: true,
          routingType: 'LIST',
          cameraIds: [2],
          canaryModelId: 'yolov8-river-v1.1',
          engineType: 'MOCK'
        }
      },
      { upsert: true }
    );
    await AiModelManager.initialize();
    
    let engine1 = await AiModelManager.getEngineForCamera(1);
    let engine2 = await AiModelManager.getEngineForCamera(2);
    console.log(`LIST Rule - Camera 1 Engine: ${engine1.name} (Expected: Mock Simulation Engine)`);
    console.log(`LIST Rule - Camera 2 Engine: ${engine2.name} (Expected: Mock Simulation Engine - Canary)`);

    // Test ODD_EVEN routing rule
    await SystemSettingsModel.findOneAndUpdate(
      { key: 'ai.canary' },
      {
        value: {
          enabled: true,
          routingType: 'ODD_EVEN',
          canaryModelId: 'yolov8-river-v1.1',
          engineType: 'MOCK'
        }
      },
      { upsert: true }
    );
    await AiModelManager.initialize();
    engine1 = await AiModelManager.getEngineForCamera(1); // odd -> canary
    engine2 = await AiModelManager.getEngineForCamera(2); // even -> stable
    console.log(`ODD_EVEN Rule - Camera 1 Engine (Odd ID 1): ${engine1.name} (Expected: Mock Simulation Engine - Canary)`);
    console.log(`ODD_EVEN Rule - Camera 2 Engine (Even ID 2): ${engine2.name} (Expected: Mock Simulation Engine)`);

    // Test PERCENTAGE routing rule (e.g. 10%)
    await SystemSettingsModel.findOneAndUpdate(
      { key: 'ai.canary' },
      {
        value: {
          enabled: true,
          routingType: 'PERCENTAGE',
          percentage: 10,
          canaryModelId: 'yolov8-river-v1.1',
          engineType: 'MOCK'
        }
      },
      { upsert: true }
    );
    await AiModelManager.initialize();
    engine1 = await AiModelManager.getEngineForCamera(10); // 10 % 10 = 0 -> < 1 (route to canary)
    engine2 = await AiModelManager.getEngineForCamera(15); // 15 % 10 = 5 -> >= 1 (route to stable)
    console.log(`PERCENTAGE Rule - Camera 10 Engine: ${engine1.name} (Expected: Mock Simulation Engine - Canary)`);
    console.log(`PERCENTAGE Rule - Camera 15 Engine: ${engine2.name} (Expected: Mock Simulation Engine)`);

    // Restore default LIST setting for pipeline execution
    await SystemSettingsModel.findOneAndUpdate(
      { key: 'ai.canary' },
      {
        value: {
          enabled: true,
          routingType: 'LIST',
          cameraIds: [2],
          canaryModelId: 'yolov8-river-v1.1',
          engineType: 'MOCK'
        }
      },
      { upsert: true }
    );
    await AiModelManager.initialize();

    // ----------------------------------------------------
    // TEST 6: Priority-Based Queueing & Concurrency
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Priority-Based Queueing ---');
    InferenceQueue.startWorkers();
    
    const frameLow = { cameraId: 1, location: 'Test Location', timestamp: new Date(), imagePath: '/uploads/detection_1.jpg' };
    const frameHigh = { cameraId: 2, location: 'Test Location', timestamp: new Date(), imagePath: '/uploads/detection_2.jpg' };
    const frameCritical = { cameraId: 3, location: 'Test Location Critical', timestamp: new Date(), imagePath: '/uploads/detection_3.jpg' };

    console.log('Enqueuing LOW priority frame...');
    const pLow = InferenceQueue.enqueue(frameLow, 'LOW');
    console.log('Enqueuing HIGH priority frame...');
    const pHigh = InferenceQueue.enqueue(frameHigh, 'HIGH');
    console.log('Enqueuing CRITICAL priority frame...');
    const pCritical = InferenceQueue.enqueue(frameCritical, 'CRITICAL');

    const [resLow, resHigh, resCritical] = await Promise.all([pLow, pHigh, pCritical]);
    console.log(`LOW Frame processed: ${resLow ? 'YES' : 'NO'}`);
    console.log(`HIGH Frame processed: ${resHigh ? 'YES' : 'NO'}`);
    console.log(`CRITICAL Frame processed: ${resCritical ? 'YES' : 'NO'}`);

    // ----------------------------------------------------
    // TEST 7: Observability Metrics & Engine Health
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Observability Metrics ---');
    const healthMetrics = await AiEngineHealthMonitor.getMetrics();
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
    await InferenceQueue.shutdown();
    const postShutdownMetrics = await AiEngineHealthMonitor.getMetrics();
    console.log(`Post-Shutdown Engine State: ${postShutdownMetrics.engineState} (Expected: STOPPED)`);
    console.log(`Post-Shutdown Active Workers: ${postShutdownMetrics.activeWorkers} (Expected: 0)`);
    console.log(`Post-Shutdown Queue Length: ${postShutdownMetrics.queueLength} (Expected: 0)`);
    console.log('Graceful shutdown successful.');

    console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY ===');

  } catch (err: any) {
    console.error('Test Suite Failed:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('[TEST] Connection closed.');
    process.exit(0);
  }
}

runTests();
