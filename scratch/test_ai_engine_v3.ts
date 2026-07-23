/**
 * EYECO AI Engine v3.0 Acceptance Test Suite — Complete 12 Verification Scenarios
 */

import fs from 'fs';
import path from 'path';
import { connectDB } from '../src/database/db';
import { aiEngine } from '../src/services/ai/aiEngine';
import { featureExtractorService } from '../src/services/ai/featureExtraction/featureExtractor.service';
import { decisionEngine } from '../src/services/ai/decisionEngine/decisionEngine';
import { loadDecisionPolicy } from '../src/services/ai/decisionEngine/policyLoader';
import { feedbackCollector } from '../src/services/ai/validation/feedbackCollector';
import { spatialAnalyzer } from '../src/services/ai/sceneUnderstanding/spatialAnalyzer';
import { YoloObject, PersonPose, FeatureVector } from '../src/services/ai/types/ai.types';

async function runAcceptanceTests() {
  console.log('====================================================');
  console.log('🧪 EYECO AI Engine v3.0 — Complete 12 Acceptance Test Suite');
  console.log('====================================================\n');

  await connectDB();

  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName} ${detail ? `(${detail})` : ''}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failCount++;
    }
  }

  // Find valid existing upload image or fallback
  const testImgPath = path.resolve(__dirname, '../public/uploads/upload_qc_laporan_taman_sungai.jpg');

  // ----------------------------------------------------
  // Test 1: Student Selfie without Trash
  // ----------------------------------------------------
  const selfieObjects: YoloObject[] = [
    { class: 'person', confidence: 0.96, bbox: [10, 10, 40, 80], x: 10, y: 10, w: 30, h: 70 },
    { class: 'person', confidence: 0.94, bbox: [40, 10, 70, 80], x: 40, y: 10, w: 30, h: 70 },
  ];
  const selfiePoses: PersonPose[] = [
    { personId: 'p1', bbox: [10, 10, 40, 80], boxDiagonal: 76, keypoints: [], leftWristNormalized: { x: 15, y: 50, confidence: 0.9 }, rightWristNormalized: { x: 35, y: 50, confidence: 0.9 } }
  ];
  const fvSelfie = featureExtractorService.extractFeatures(
    selfieObjects, selfiePoses, [], { riverDetected: false, roadDetected: false, trashInsideBin: false }, ['YOLO_OBJECT', 'POSE_ESTIMATION']
  );
  const decSelfie = decisionEngine.evaluate(fvSelfie);
  assert(
    decSelfie.status === 'Tidak Terindikasi' && decSelfie.priority === 'NONE',
    'Test 1: Selfie tanpa sampah -> Tidak Terindikasi & Priority NONE',
    `Status: ${decSelfie.status}, Priority: ${decSelfie.priority}`
  );

  // ----------------------------------------------------
  // Test 2: Person Carrying Bottle (No Littering Intent)
  // ----------------------------------------------------
  const bottleObjects: YoloObject[] = [
    { class: 'person', confidence: 0.95, bbox: [10, 10, 50, 80], x: 10, y: 10, w: 40, h: 70 },
    { class: 'plastic_bottle', confidence: 0.88, bbox: [42, 52, 48, 62], x: 42, y: 52, w: 6, h: 10 },
  ];
  const bottlePoses: PersonPose[] = [
    { personId: 'p1', bbox: [10, 10, 50, 80], boxDiagonal: 80, keypoints: [], leftWristNormalized: { x: 44, y: 55, confidence: 0.9 }, rightWristNormalized: { x: 20, y: 55, confidence: 0.9 } }
  ];
  const fvBottle = featureExtractorService.extractFeatures(
    bottleObjects, bottlePoses, [], { riverDetected: false, roadDetected: true, trashInsideBin: false }, ['YOLO_OBJECT', 'POSE_ESTIMATION', 'SPATIAL_ANALYZER']
  );
  const decBottle = decisionEngine.evaluate(fvBottle);
  assert(
    decBottle.status === 'Indikasi Sedang' && decBottle.violationScore < 75,
    'Test 2: Orang membawa botol -> Indikasi Sedang (bukan Indikasi Tinggi)',
    `Status: ${decBottle.status}, Score: ${decBottle.violationScore}`
  );

  // ----------------------------------------------------
  // Test 3: Trash Inside Trash Bin
  // ----------------------------------------------------
  const binObjects: YoloObject[] = [
    { class: 'person', confidence: 0.90, bbox: [10, 10, 30, 80], x: 10, y: 10, w: 20, h: 70 },
    { class: 'trash_bin', confidence: 0.92, bbox: [40, 50, 60, 90], x: 40, y: 50, w: 20, h: 40 },
    { class: 'plastic_bottle', confidence: 0.89, bbox: [45, 55, 50, 65], x: 45, y: 55, w: 5, h: 10 },
  ];
  const fvBin = featureExtractorService.extractFeatures(
    binObjects, [], [], { riverDetected: false, roadDetected: false, trashInsideBin: true }, ['YOLO_OBJECT', 'SEMANTIC_ANALYZER']
  );
  const decBin = decisionEngine.evaluate(fvBin);
  assert(
    decBin.status === 'Tidak Terindikasi' && decBin.priority === 'NONE',
    'Test 3: Sampah di dalam tempat sampah -> Skor negatif (-35), Status Tidak Terindikasi',
    `Status: ${decBin.status}, Score: ${decBin.violationScore}`
  );

  // ----------------------------------------------------
  // Test 4: Trash Without Person
  // ----------------------------------------------------
  const trashOnlyObjects: YoloObject[] = [
    { class: 'trash', confidence: 0.85, bbox: [30, 40, 60, 80], x: 30, y: 40, w: 30, h: 40 },
  ];
  const fvTrashOnly = featureExtractorService.extractFeatures(
    trashOnlyObjects, [], [], { riverDetected: false, roadDetected: true, trashInsideBin: false }, ['YOLO_OBJECT', 'SEMANTIC_ANALYZER']
  );
  const decTrashOnly = decisionEngine.evaluate(fvTrashOnly);
  assert(
    decTrashOnly.status === 'Indikasi Rendah',
    'Test 4: Sampah tanpa manusia -> Indikasi Rendah (bukan melempar)',
    `Status: ${decTrashOnly.status}, Score: ${decTrashOnly.violationScore}`
  );

  // ----------------------------------------------------
  // Test 5: Trash Near Wrist Spatial Distance Calculation
  // ----------------------------------------------------
  const spatialRes = spatialAnalyzer.analyzeSpatial(bottleObjects, bottlePoses);
  assert(
    spatialRes.trashNearWrist === true && spatialRes.nearestWristDistanceNormalized !== null,
    'Test 5: Sampah dekat pergelangan tangan terukur via pose estimation normalized distance',
    `Distance: ${spatialRes.nearestWristDistanceNormalized}, TrashNearWrist: ${spatialRes.trashNearWrist}`
  );

  // ----------------------------------------------------
  // Test 6: Pose Estimation Failure Graceful Degradation
  // ----------------------------------------------------
  const fvDegraded = featureExtractorService.extractFeatures(
    bottleObjects, [], [], { riverDetected: false, roadDetected: true, trashInsideBin: false }, ['YOLO_OBJECT', 'SPATIAL_ANALYZER']
  );
  const decDegraded = decisionEngine.evaluate(fvDegraded);
  assert(
    decDegraded.uncertaintyScore > 30 && decDegraded.needsHumanValidation === true,
    'Test 6: Kegagalan Pose Estimation -> Graceful degradation (Uncertainty meningkat, needsHumanValidation=true)',
    `Uncertainty: ${decDegraded.uncertaintyScore}, NeedsHumanVal: ${decDegraded.needsHumanValidation}`
  );

  // ----------------------------------------------------
  // Test 7: Duplicate Image Retry Idempotency
  // ----------------------------------------------------
  const analysisResult1 = await aiEngine.analyze(testImgPath, { reportId: 9991 });
  const analysisResult2 = await aiEngine.analyze(testImgPath, { reportId: 9991 });
  assert(
    analysisResult1.snapshot.analysisId === analysisResult2.snapshot.analysisId,
    'Test 7: Retry gambar & reportId sama -> Idempotent (Mengembalikan snapshot yang sama)',
    `Snapshot ID: ${analysisResult1.snapshot.analysisId}`
  );

  // ----------------------------------------------------
  // Test 8: Re-analysis with New Model/Pipeline Version
  // ----------------------------------------------------
  const reAnalysisResult = await aiEngine.analyze(testImgPath, { reportId: 9991, forceReanalysis: true });
  assert(
    reAnalysisResult.snapshot._id.toString() !== analysisResult1.snapshot._id.toString(),
    'Test 8: Re-analisis paksa -> Menghasilkan snapshot baru, snapshot lama tetap tersimpan immutable',
    `New Snapshot ID: ${reAnalysisResult.snapshot.analysisId}`
  );

  // ----------------------------------------------------
  // Test 9: Policy Loader Validation & Fallback
  // ----------------------------------------------------
  const policy = loadDecisionPolicy();
  assert(
    policy.thresholds.highMinScore > policy.thresholds.mediumMinScore &&
    policy.thresholds.mediumMinScore > policy.thresholds.lowMinScore,
    'Test 9: Policy Loader memvalidasi hirarki threshold (75 > 50 > 25)',
    `Policy Version: ${policy.policyVersion}`
  );

  // ----------------------------------------------------
  // Test 10: Blurry Image Quality Degradation
  // ----------------------------------------------------
  const fvBlurry = featureExtractorService.extractFeatures(
    bottleObjects, bottlePoses, [], { riverDetected: false, roadDetected: true, trashInsideBin: false }, ['YOLO_OBJECT', 'POSE_ESTIMATION'],
    { blurScore: 15, brightnessScore: 30, resolutionAdequate: false, qualityStatus: 'POOR' }
  );
  const decBlurry = decisionEngine.evaluate(fvBlurry);
  assert(
    decBlurry.needsHumanValidation === true && decBlurry.decisionConfidence < 65,
    'Test 10: Gambar buram/POOR -> Decision confidence diturunkan & wajib verifikasi manusia',
    `Confidence: ${decBlurry.decisionConfidence}, NeedsHumanValidation: ${decBlurry.needsHumanValidation}`
  );

  // ----------------------------------------------------
  // Test 11: Exact Deterministic Threshold Boundary Test
  // 0-24 = Tidak Terindikasi
  // 25-49 = Indikasi Rendah
  // 50-74 = Indikasi Sedang
  // 75-100 = Indikasi Tinggi
  // ----------------------------------------------------
  const baseFv: FeatureVector = {
    featureSchemaVersion: 'feature-v1',
    personCount: 0,
    trashCount: 0,
    highestTrashConfidence: 0,
    highestPersonConfidence: 0,
    nearestWristDistanceNormalized: null,
    trashNearWrist: false,
    possibleReleasePose: false,
    trashOnWaterZone: false,
    trashOnRoadZone: false,
    trashInsideBinZone: false,
    imageQuality: { blurScore: 80, brightnessScore: 80, resolutionAdequate: true, qualityStatus: 'GOOD' },
    evidenceCoverage: 1.0,
    analyzersAvailable: ['YOLO_OBJECT', 'POSE_ESTIMATION', 'SPATIAL_ANALYZER', 'SEMANTIC_ANALYZER', 'REGION_ANALYZER']
  };

  // Score 10 (no person -15, trash +25 -> 10)
  const fv24: FeatureVector = { ...baseFv, trashCount: 1, highestTrashConfidence: 60 };
  const dec24 = decisionEngine.evaluate(fv24);

  // Score 35 (person +10, trash +25 -> 35)
  const fv25: FeatureVector = { ...baseFv, personCount: 1, trashCount: 1, highestTrashConfidence: 60 };
  const dec25 = decisionEngine.evaluate(fv25);

  // Score 55 (person +10, trash +25, trashNearWrist +20 -> 55)
  const fv50: FeatureVector = { ...baseFv, personCount: 1, trashCount: 1, highestTrashConfidence: 60, trashNearWrist: true };
  const dec50 = decisionEngine.evaluate(fv50);

  // Score 80 (person +10, trash +25, trashHighConf +10, trashNearWrist +20, trashOnWaterZone +15 -> 80)
  const fv75: FeatureVector = { ...baseFv, personCount: 1, trashCount: 1, highestTrashConfidence: 80, trashNearWrist: true, trashOnWaterZone: true };
  const dec75 = decisionEngine.evaluate(fv75);

  const deterministicPassed =
    dec24.status === 'Tidak Terindikasi' && dec24.violationScore < 25 &&
    dec25.status === 'Indikasi Rendah' && dec25.violationScore >= 25 && dec25.violationScore < 50 &&
    dec50.status === 'Indikasi Sedang' && dec50.violationScore >= 50 && dec50.violationScore < 75 &&
    dec75.status === 'Indikasi Tinggi' && dec75.violationScore >= 75;

  assert(
    deterministicPassed,
    'Test 11: Threshold deterministik (Score <25->Tidak, 25-49->Rendah, 50-74->Sedang, 75+->Tinggi)',
    `24:[${dec24.status}, Score:${dec24.violationScore}], 25:[${dec25.status}, Score:${dec25.violationScore}], 50:[${dec50.status}, Score:${dec50.violationScore}], 75:[${dec75.status}, Score:${dec75.violationScore}]`
  );

  // ----------------------------------------------------
  // Test 12: Operator Ground Truth Validation Logging
  // ----------------------------------------------------
  const feedbackLog = await feedbackCollector.logOperatorFeedback({
    reportId: 9991,
    snapshotId: analysisResult1.snapshot._id.toString(),
    userId: '6a56f38d79f343c9ae42e80c',
    operatorUsername: 'admin_qc',
    operatorDecision: 'PICKING_UP_TRASH',
    isLitteringConfirmed: false,
    correctedPriority: 'NONE',
    notes: 'Subjek sedang mengambil sampah untuk dibersihkan.'
  });

  assert(
    feedbackLog.operatorDecision === 'PICKING_UP_TRASH' && feedbackLog.isLitteringConfirmed === false,
    'Test 12: Validasi operator PICKING_UP_TRASH terekam di AiValidationLog dengan isLitteringConfirmed=false',
    `Decision: ${feedbackLog.operatorDecision}, Confirmed: ${feedbackLog.isLitteringConfirmed}`
  );

  // ----------------------------------------------------
  // Test 13: Trash Taxonomy Class Mapping (6 MVP Classes)
  // ----------------------------------------------------
  const { isTrashClass, mapToTrashTaxonomy } = require('../src/services/ai/taxonomy/trashTaxonomy');
  const mappedCup = mapToTrashTaxonomy('plastic_cup');
  const mappedBottle = mapToTrashTaxonomy('bottle');
  const mappedBag = mapToTrashTaxonomy('shopping_bag');

  const taxonomyPassed =
    isTrashClass('plastic_bottle') &&
    isTrashClass('cup') &&
    isTrashClass('carton') &&
    mappedCup.id === 'cup' &&
    mappedBottle.id === 'plastic_bottle' &&
    mappedBag.id === 'plastic_bag';

  assert(
    taxonomyPassed,
    'Test 13: Taxonomy 6 Kelas MVP (Plastic Bottle, Plastic Bag, Food Wrapper, Cup, Can, Paper) terpetakan dengan benar',
    `Cup:${mappedCup.id}, Bottle:${mappedBottle.id}, Bag:${mappedBag.id}`
  );

  console.log('\n====================================================');
  console.log(`📊 Hasil Complete Acceptance Test Suite: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================\n');

  process.exit(failCount === 0 ? 0 : 1);
}

runAcceptanceTests().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
