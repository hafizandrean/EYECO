import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { connectDB } from '../../database/db';
import { FastApiAIEngine } from './FastApiAIEngine';
import { ReportModel } from '../../database/models/Report';
import { UserModel } from '../../database/models/User';
import { DatasetFeedbackModel } from '../../database/models/DatasetFeedback';
import { ModelDeploymentLogModel } from '../../database/models/ModelDeploymentLog';
import { AiTrainingRunModel } from '../../database/models/AiTrainingRun';
import { AiModelModel } from '../../database/models/AiModel';

dotenv.config();

async function runVerification() {
  console.log('=== EYECO MILESTONE 3 VERIFICATION ===');
  
  // 1. Connect to Database
  console.log('[TEST] Connecting to MongoDB...');
  await connectDB();
  console.log('[TEST] Connected successfully.');

  // Clean old test records
  await DatasetFeedbackModel.deleteMany({ reviewedBy: 'mlops-tester' });
  await ModelDeploymentLogModel.deleteMany({ deployedBy: 'mlops-tester' });
  await AiTrainingRunModel.deleteMany({ datasetVersion: 'mlops-test-ds-v1.0' });
  await AiModelModel.deleteMany({ id: 'incompatible-model' });
  await AiModelModel.deleteMany({ id: 'compatible-model' });

  // Resolve dummy source image path
  const sourceImageRel = '/uploads/detection_1.jpg';
  const sourceImagePath = path.join(process.cwd(), 'public', sourceImageRel);
  
  if (!fs.existsSync(sourceImagePath)) {
    console.error(`[TEST] Source image not found at: ${sourceImagePath}`);
    process.exit(1);
  }

  // Find or create admin user for test context
  let adminUser = await UserModel.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = await UserModel.create({
      id: 9999,
      username: 'mlops-tester',
      passwordHash: 'dummy',
      role: 'admin'
    });
  }

  // ----------------------------------------------------
  // TEST 1: Dataset Feedback Loop & Hardlink/Copy
  // ----------------------------------------------------
  console.log('\n--- TEST 1: Dataset Feedback Loop & File Linking ---');
  
  // Create a mock Report document
  const mockReport = await ReportModel.create({
    id: 8888,
    userId: adminUser._id,
    location: 'Test MLOps Area',
    timestamp: new Date(),
    aiStatus: 'TINGGI',
    aiConfidence: 92,
    adminStatus: 'MENUNGGU',
    image: sourceImageRel,
    identity: 'CCTV-CAM-01',
    sourceType: 'AI_CCTV',
    boundingBoxes: [
      { label: 'trash', confidence: 0.92, x: 48, y: 70, w: 15, h: 12 }
    ],
    status: 'NEW',
    sla: { detectedAt: new Date() },
    sourceMetadata: {
      cameraId: 1,
      modelId: 'yolov8-river-v1.0',
      modelVersion: '1.0',
      confidence: 0.92
    }
  });

  console.log(`[TEST] Created mock Report #${mockReport.id}`);

  // Calculate file hash and setup targets
  const fileBuffer = fs.readFileSync(sourceImagePath);
  const calculatedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  console.log(`[TEST] Calculated Image SHA256: ${calculatedHash}`);

  // Create datasets folder
  const datasetsDir = path.join(process.cwd(), 'public', 'datasets');
  if (!fs.existsSync(datasetsDir)) {
    fs.mkdirSync(datasetsDir, { recursive: true });
  }

  const targetFileName = `${mockReport.id}_${calculatedHash.substring(0, 16)}${path.extname(sourceImagePath)}`;
  const targetPath = path.join(datasetsDir, targetFileName);

  // Clear target if exists
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  // Test hardlink with fallback copy
  try {
    fs.linkSync(sourceImagePath, targetPath);
    console.log(`[TEST] Hardlinked source image to: ${targetPath}`);
  } catch (linkErr) {
    console.warn('[TEST] Hardlink failed, attempting fallback copyFile...');
    fs.copyFileSync(sourceImagePath, targetPath);
    console.log(`[TEST] Copied source image to: ${targetPath}`);
  }

  // Verify file actually exists at destination
  if (fs.existsSync(targetPath)) {
    console.log('✅ PASS: Image file successfully linked/copied to public/datasets!');
  } else {
    console.error('❌ FAIL: File not found at target destination.');
  }

  // Save feedback record
  const originalDetections = mockReport.boundingBoxes.map(b => ({
    class: b.label,
    confidence: b.confidence,
    bbox: [b.x, b.y, b.w, b.h]
  }));

  const feedback = await DatasetFeedbackModel.create({
    reportId: mockReport.id,
    reportObjectId: mockReport._id,
    cameraId: 1,
    imageHash: calculatedHash,
    imageWidth: 1280,
    imageHeight: 720,
    originalDetections,
    groundTruth: originalDetections.map(d => ({ class: d.class, bbox: d.bbox })),
    modelId: 'yolov8-river-v1.0',
    modelVersion: '1.0',
    operatorLabel: 'APPROVED',
    reviewStatus: 'APPROVED',
    datasetPartition: 'TRAIN',
    feedbackSource: 'OPERATOR_REVIEW',
    operatorId: adminUser._id,
    qualityScore: 100,
    reviewedAt: new Date(),
    reviewedBy: 'mlops-tester',
    processedForRetraining: false
  });

  console.log(`[TEST] Saved DatasetFeedback record ID: ${feedback._id}`);
  if (feedback.imageHash === calculatedHash) {
    console.log('✅ PASS: DatasetFeedback successfully saved with correct SHA256 imageHash!');
  } else {
    console.error('❌ FAIL: DatasetFeedback imageHash mismatch.');
  }

  // ----------------------------------------------------
  // TEST 2: Model Compatibility Validation
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Model Compatibility Validation ---');
  
  // Register an incompatible model in database
  const incompatibleModel = await AiModelModel.create({
    id: 'incompatible-model',
    name: 'Incompatible YOLOv8 Model',
    version: '2.0',
    isActive: false,
    checksum: 'sha256-dummy-hash',
    minimumPython: '99.9.9', // Forces python incompatibility check!
    minimumCuda: '',
    minimumTorch: '',
    minimumUltralytics: '',
    framework: 'YOLOv8',
    supportedTasks: ['DETECTION']
  });

  console.log('[TEST] Registered incompatible model (minimumPython: 99.9.9)');

  const engine = new FastApiAIEngine();
  
  // Attempt to load incompatible model
  try {
    console.log('[TEST] Attempting to load incompatible model...');
    await engine.initialize('/weights/incompatible-model.pt');
    console.error('❌ FAIL: Incompatible model loaded without throwing an error!');
  } catch (err: any) {
    console.log(`[TEST] Compatibility check correctly threw error: ${err.message}`);
    
    // Check if failure logged in ModelDeploymentLogModel
    const failLog = await ModelDeploymentLogModel.findOne({
      modelIdTo: 'incompatible-model',
      validationResult: 'FAILED'
    });
    
    if (failLog && failLog.rollbackReason?.includes('Incompatible Python version')) {
      console.log(`[TEST] Incompatibility logged successfully: ${failLog.rollbackReason}`);
      console.log('✅ PASS: Incompatible deployment successfully aborted and logged!');
    } else {
      console.error('❌ FAIL: FAILED deployment audit log not found or has incorrect reason.');
    }
  }

  // ----------------------------------------------------
  // TEST 3: Deployment History Logging
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Deployment History Logging ---');

  // Register a compatible model
  await AiModelModel.create({
    id: 'compatible-model',
    name: 'Compatible YOLOv8 Model',
    version: '1.2',
    isActive: false,
    checksum: '', // Skip checksum for test fallback
    minimumPython: '3.8',
    minimumCuda: '',
    minimumTorch: '',
    minimumUltralytics: '',
    framework: 'YOLOv8',
    supportedTasks: ['DETECTION']
  });

  console.log('[TEST] Registered compatible model (minimumPython: 3.8)');

  // Attempt to load compatible model (will fallback to yolov8n.pt and succeed)
  try {
    console.log('[TEST] Attempting to load compatible model...');
    await engine.initialize('/weights/compatible-model.pt');
    console.log('[TEST] Engine load completed successfully.');

    // Check if success logged in ModelDeploymentLogModel
    const successLog = await ModelDeploymentLogModel.findOne({
      modelIdTo: 'compatible-model',
      validationResult: 'SUCCESS'
    });

    if (successLog && successLog.totalDeploymentLatencyMs > 0) {
      console.log(`[TEST] Logged successful deployment with latency: ${successLog.totalDeploymentLatencyMs}ms`);
      console.log('✅ PASS: Compatible deployment successfully executed and logged!');
    } else {
      console.error('❌ FAIL: SUCCESS deployment audit log not found or missing latency stats.');
    }
  } catch (err: any) {
    console.error('❌ FAIL: Compatible model failed to initialize:', err.message);
  }

  // ----------------------------------------------------
  // TEST 4: Training Run Registry
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Training Run Registry ---');

  const trainingRun = await AiTrainingRunModel.create({
    datasetVersion: 'mlops-test-ds-v1.0',
    modelVersion: 'yolov8-river-v1.2-retrained',
    trainingStart: new Date(Date.now() - 3600000),
    trainingEnd: new Date(),
    epochs: 100,
    precision: 0.942,
    recall: 0.915,
    mAP50: 0.954,
    mAP50_95: 0.812,
    bestWeightsPath: 'weights/yolov8-river-v1.2-retrained.pt',
    artifactSize: 12500000,
    notes: 'Retrained using verified operator feedback samples.'
  });

  console.log(`[TEST] Saved TrainingRun record for model: ${trainingRun.modelVersion}`);
  const retrievedRun = await AiTrainingRunModel.findOne({ modelVersion: 'yolov8-river-v1.2-retrained' });
  
  if (retrievedRun && retrievedRun.mAP50 === 0.954) {
    console.log('✅ PASS: TrainingRun registry saved and queried successfully!');
  } else {
    console.error('❌ FAIL: TrainingRun registry test failed.');
  }

  // Cleanup timers & delete mock Report
  if ((FastApiAIEngine as any).telemetryInterval) {
    clearInterval((FastApiAIEngine as any).telemetryInterval);
  }
  await ReportModel.deleteOne({ id: 8888 });

  // Close DB connection
  await mongoose.connection.close();
  console.log('[TEST] DB connection closed. Done.');
}

runVerification().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
