import { AiGoldenDatasetVersionModel, IAiGoldenDatasetVersion, GoldenDatasetStatus } from '../../../database/models/AiGoldenDatasetVersion';
import { AiDatasetVersionModel, IDatasetManifestItem } from '../../../database/models/AiDatasetVersion';
import { AiDatasetCandidateModel } from '../../../database/models/AiDatasetCandidate';
import { GoldenDatasetCompositionPolicyModel, IGoldenDatasetCompositionPolicy } from '../../../database/models/GoldenDatasetCompositionPolicy';
import { assetValidationService } from './assetValidationService';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface IEvaluationManifestMaterialization {
  goldenDatasetVersion: string;
  goldenManifestHash: string;
  items: Array<{
    goldenItemId: string;
    candidateId: string;
    snapshotId: string;
    imagePath: string;
    recomputedImageHash: string;
    annotationHash: string;
    split: string;
  }>;
}

export interface IGroundTruthManifestMaterialization {
  sourceGoldenDatasetHash: string;
  items: Array<{
    goldenItemId: string;
    imagePath: string;
    recomputedImageHash: string;
    annotationHash: string;
    operatorDecision: string;
    annotations: any[];
  }>;
}

export class GoldenDatasetService {
  public static readonly VERSION_PREFIX = 'v3.0.0-golden';

  public async getOrCreateDefaultCompositionPolicy(): Promise<IGoldenDatasetCompositionPolicy> {
    let policy = await GoldenDatasetCompositionPolicyModel.findOne({ policyVersion: 'v1.0.0-golden-policy' }).exec();
    if (!policy) {
      const config = {
        minimumTotalItems: 5,
        minimumPositiveItems: 3,
        minimumNegativeItems: 1,
        minimumItemsPerClass: 1,
        minimumCameraCount: 1,
        minimumLocationCount: 1,
        requireDayExamples: false,
        requireNightExamples: false,
        minimumSmallObjectItems: 0,
        minimumBlurOrOcclusionItems: 0
      };
      const policyHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
      policy = await GoldenDatasetCompositionPolicyModel.create({
        policyId: 'policy-golden-v1.0.0-prod',
        policyVersion: 'v1.0.0-golden-policy',
        policyHash,
        targetModel: 'OBJECT_DETECTOR',
        environment: 'PRODUCTION',
        status: 'APPROVED',
        configuration: config,
        approvedByUserId: new mongoose.Types.ObjectId(),
        approvedAt: new Date()
      });
    }
    return policy;
  }

  public checkOverlap(goldenItems: IDatasetManifestItem[], candidateItems: IDatasetManifestItem[]): { hasOverlap: boolean; overlappingHashes: string[] } {
    const candidateHashes = new Set<string>();
    for (const cItem of candidateItems) {
      if (cItem.inputImageHash) candidateHashes.add(`img:${cItem.inputImageHash}`);
      if (cItem.parentImageHash) candidateHashes.add(`parent:${cItem.parentImageHash}`);
      if (cItem.sourceVideoHash) candidateHashes.add(`vid:${cItem.sourceVideoHash}`);
      if (cItem.incidentId) candidateHashes.add(`inc:${cItem.incidentId}`);
    }

    const overlappingHashes: string[] = [];
    for (const gItem of goldenItems) {
      if (gItem.inputImageHash && candidateHashes.has(`img:${gItem.inputImageHash}`)) overlappingHashes.push(`img:${gItem.inputImageHash}`);
      if (gItem.parentImageHash && candidateHashes.has(`parent:${gItem.parentImageHash}`)) overlappingHashes.push(`parent:${gItem.parentImageHash}`);
      if (gItem.sourceVideoHash && candidateHashes.has(`vid:${gItem.sourceVideoHash}`)) overlappingHashes.push(`vid:${gItem.sourceVideoHash}`);
      if (gItem.incidentId && candidateHashes.has(`inc:${gItem.incidentId}`)) overlappingHashes.push(`inc:${gItem.incidentId}`);
    }

    return {
      hasOverlap: overlappingHashes.length > 0,
      overlappingHashes
    };
  }

  public async createGoldenDatasetVersion(params: {
    targetModel: 'OBJECT_DETECTOR';
    manifestItems: IDatasetManifestItem[];
    createdByUserId: string;
  }): Promise<IAiGoldenDatasetVersion> {
    const policy = await this.getOrCreateDefaultCompositionPolicy();
    const config = policy.configuration;

    // 1. Candidate Approval Lineage Verification & Recompute SHA-256 Byte Hashes
    for (const item of params.manifestItems) {
      if (item.candidateId) {
        const candDoc = await AiDatasetCandidateModel.findById(item.candidateId).exec();
        if (!candDoc || candDoc.approvalStatus !== 'APPROVED' || !candDoc.approvedByUserId || !candDoc.reviewedAt) {
          const err: any = new Error(`GOLDEN_ITEM_CANDIDATE_NOT_APPROVED: Candidate ${item.candidateId} is missing or not APPROVED (Status: ${candDoc?.approvalStatus}).`);
          err.status = 422;
          throw err;
        }
      }

      // 2. Label Consistency Verification
      const isNeg = item.operatorDecision === 'FALSE_OBJECT_DETECTION' || item.operatorDecision === 'REJECTED';
      const isPos = item.operatorDecision === 'TRUE_OBJECT_DETECTION' || item.operatorDecision === 'ACCEPTED';

      if (isNeg && Array.isArray(item.annotations) && item.annotations.length > 0) {
        const err: any = new Error(`GOLDEN_LABEL_CONTRADICTION: Item report #${item.reportId} has decision ${item.operatorDecision} but contains positive annotations.`);
        err.status = 422;
        throw err;
      }
      if (isPos && (!Array.isArray(item.annotations) || item.annotations.length === 0)) {
        const err: any = new Error(`GOLDEN_LABEL_CONTRADICTION: Item report #${item.reportId} has decision ${item.operatorDecision} but contains 0 annotations.`);
        err.status = 422;
        throw err;
      }

      // Recompute file byte SHA-256 hash from disk if file exists
      if (item.imagePath) {
        const fullPath = (item.imagePath.startsWith('/uploads/') || item.imagePath.startsWith('uploads/'))
          ? path.join(process.cwd(), 'public', item.imagePath.startsWith('/') ? item.imagePath : '/' + item.imagePath)
          : (path.isAbsolute(item.imagePath) ? item.imagePath : path.join(process.cwd(), 'public', item.imagePath));
        if (fs.existsSync(fullPath)) {
          const fileBytes = fs.readFileSync(fullPath);
          item.inputImageHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
        }
      }
    }

    // 3. Exact Training Overlap Verification across Candidates and Approved Dataset Versions
    const goldenCandIdSet = new Set(params.manifestItems.map(i => i.candidateId ? String(i.candidateId) : ''));
    const approvedCandidates = await AiDatasetCandidateModel.find({ approvalStatus: 'APPROVED' }).exec();
    const candidateManifestItems: IDatasetManifestItem[] = approvedCandidates
      .filter(c => !goldenCandIdSet.has(String(c._id)))
      .map((c, idx) => ({
        candidateId: c._id as mongoose.Types.ObjectId,
        snapshotId: c.snapshotId,
        reportId: c.reportId,
        imagePath: '',
        inputImageHash: c.inputImageHash,
        sourceVideoHash: c.sourceVideoHash,
        operatorDecision: c.operatorDecision || 'TRUE_OBJECT_DETECTION',
        split: 'TRAIN' as const,
        groupKey: `cand-group-${idx}`,
        annotations: []
      }));

    const approvedDatasets = await AiDatasetVersionModel.find({ status: 'READY' }).exec();
    for (const ds of approvedDatasets) {
      if (Array.isArray(ds.manifestItems)) {
        candidateManifestItems.push(...ds.manifestItems);
      }
    }

    const overlapResult = this.checkOverlap(params.manifestItems, candidateManifestItems);
    if (overlapResult.hasOverlap) {
      const timestamp = Date.now();
      const goldenDatasetVersion = `${GoldenDatasetService.VERSION_PREFIX}-${params.targetModel.toLowerCase()}-${timestamp}-${crypto.randomBytes(3).toString('hex')}`;
      const manifestHash = crypto.createHash('sha256').update(JSON.stringify(params.manifestItems)).digest('hex');

      const invalidDoc = await AiGoldenDatasetVersionModel.create({
        goldenDatasetVersion,
        targetModel: params.targetModel,
        status: 'INVALID',
        structurallyValid: false,
        compositionEligible: false,
        approvalEligible: false,
        manifestHash,
        itemCount: params.manifestItems.length,
        positiveCount: 0,
        negativeCount: 0,
        classDistribution: {},
        locationDistribution: {},
        manifestItems: params.manifestItems
      });

      const err: any = new Error(`GOLDEN_TRAINING_EXACT_OVERLAP: Golden dataset creation REJECTED due to exact image byte overlap with training dataset. Overlapping: ${overlapResult.overlappingHashes.join(', ')}`);
      err.status = 409;
      err.goldenDatasetVersion = goldenDatasetVersion;
      throw err;
    }

    const positiveCount = params.manifestItems.filter((i) => i.operatorDecision === 'TRUE_OBJECT_DETECTION' || i.operatorDecision === 'ACCEPTED').length;
    const negativeCount = params.manifestItems.filter((i) => i.operatorDecision === 'FALSE_OBJECT_DETECTION' || i.operatorDecision === 'REJECTED').length;

    const classDist: Record<string, number> = {};
    const locDist: Record<string, number> = {};

    for (const item of params.manifestItems) {
      if (item.annotations) {
        for (const ann of item.annotations) {
          classDist[ann.className] = (classDist[ann.className] || 0) + 1;
        }
      }
      if (item.groupKey) {
        locDist[item.groupKey] = (locDist[item.groupKey] || 0) + 1;
      }
    }

    const isTotalSufficient = params.manifestItems.length >= config.minimumTotalItems;
    const isPosSufficient = positiveCount >= config.minimumPositiveItems;
    const isNegSufficient = negativeCount >= config.minimumNegativeItems;

    const approvalEligible = isTotalSufficient && isPosSufficient && isNegSufficient;
    const status: GoldenDatasetStatus = approvalEligible ? 'READY_FOR_REVIEW' : 'INSUFFICIENT_DATA';

    const timestamp = Date.now();
    const goldenDatasetVersion = `${GoldenDatasetService.VERSION_PREFIX}-${params.targetModel.toLowerCase()}-${timestamp}-${crypto.randomBytes(3).toString('hex')}`;

    const manifestHash = crypto.createHash('sha256').update(JSON.stringify(params.manifestItems)).digest('hex');

    const doc = await AiGoldenDatasetVersionModel.create({
      goldenDatasetVersion,
      targetModel: params.targetModel,
      status,
      structurallyValid: true,
      compositionEligible: approvalEligible,
      approvalEligible,
      manifestHash,
      itemCount: params.manifestItems.length,
      positiveCount,
      negativeCount,
      classDistribution: classDist,
      locationDistribution: locDist,
      manifestItems: params.manifestItems
    });

    console.log(`[GOLDEN_DATASET] Created Golden Dataset ${goldenDatasetVersion} (Status: ${status}, Items: ${params.manifestItems.length}, ApprovalEligible: ${approvalEligible})`);
    return doc;
  }

  public async approveGoldenDataset(goldenDatasetVersion: string, approvedByUserId: string): Promise<IAiGoldenDatasetVersion> {
    const doc = await AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion }).exec();
    if (!doc) {
      throw new Error(`Golden dataset version ${goldenDatasetVersion} not found.`);
    }

    if (doc.status === 'INVALID') {
      const err: any = new Error(`GOLDEN_DATASET_INVALID: Cannot approve Golden Dataset ${goldenDatasetVersion} with status INVALID (GOLDEN_TRAINING_EXACT_OVERLAP).`);
      err.status = 409;
      throw err;
    }

    if (doc.status === 'INSUFFICIENT_DATA' || !doc.approvalEligible) {
      const err: any = new Error(`GOLDEN_DATASET_INSUFFICIENT: Cannot approve Golden Dataset ${goldenDatasetVersion} with status INSUFFICIENT_DATA (item count ${doc.itemCount} below minimum).`);
      err.status = 422;
      throw err;
    }

    doc.status = 'APPROVED';
    doc.approvedByUserId = new mongoose.Types.ObjectId(approvedByUserId);
    doc.approvedAt = new Date();
    await doc.save();

    console.log(`[GOLDEN_DATASET] Golden Dataset ${goldenDatasetVersion} APPROVED by admin ${approvedByUserId}`);
    return doc;
  }

  public async materializeEvaluationManifest(goldenDatasetVersion: string): Promise<IEvaluationManifestMaterialization> {
    const doc = await AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion }).exec();
    if (!doc || doc.status !== 'APPROVED') {
      throw new Error(`GOLDEN_DATASET_NOT_APPROVED: Golden dataset ${goldenDatasetVersion} is missing or not APPROVED.`);
    }

    const materializedItems = doc.manifestItems.map((item, idx) => {
      const annHash = crypto.createHash('sha256').update(JSON.stringify(item.annotations || [])).digest('hex');
      return {
        goldenItemId: (item as any)._id ? String((item as any)._id) : `golden-item-${idx}`,
        candidateId: item.candidateId ? String(item.candidateId) : String(new mongoose.Types.ObjectId()),
        snapshotId: item.snapshotId ? String(item.snapshotId) : String(new mongoose.Types.ObjectId()),
        imagePath: item.imagePath,
        recomputedImageHash: item.inputImageHash,
        annotationHash: annHash,
        split: item.split || 'TEST'
      };
    });

    const manifestHash = crypto.createHash('sha256').update(JSON.stringify(materializedItems)).digest('hex');

    return {
      goldenDatasetVersion,
      goldenManifestHash: manifestHash,
      items: materializedItems
    };
  }

  public async materializeGroundTruthManifest(goldenDatasetVersion: string): Promise<IGroundTruthManifestMaterialization> {
    const doc = await AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion }).exec();
    if (!doc || doc.status !== 'APPROVED') {
      throw new Error(`GOLDEN_DATASET_NOT_APPROVED: Golden dataset ${goldenDatasetVersion} is missing or not APPROVED.`);
    }

    const items = doc.manifestItems.map((item, idx) => {
      const annHash = crypto.createHash('sha256').update(JSON.stringify(item.annotations || [])).digest('hex');
      return {
        goldenItemId: (item as any)._id ? String((item as any)._id) : `golden-item-${idx}`,
        imagePath: item.imagePath,
        recomputedImageHash: item.inputImageHash,
        annotationHash: annHash,
        operatorDecision: item.operatorDecision || 'TRUE_OBJECT_DETECTION',
        annotations: item.annotations || []
      };
    });

    return {
      sourceGoldenDatasetHash: doc.manifestHash,
      items
    };
  }
}

export const goldenDatasetService = new GoldenDatasetService();
