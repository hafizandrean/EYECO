import crypto from 'crypto';
import mongoose from 'mongoose';
import { AiDatasetCandidateModel, TargetModelType } from '../../../database/models/AiDatasetCandidate';
import { StatisticalEvaluationPolicyModel, IStatisticalEvaluationPolicy } from '../../../database/models/StatisticalEvaluationPolicy';
import { DatasetReadinessEvaluationModel, IDatasetReadinessEvaluation } from '../../../database/models/DatasetReadinessEvaluation';
import { IMlExecutionContext } from './MlExecutionContext';

export interface IEvaluateReadinessParams {
  targetModel?: TargetModelType;
  environment?: 'TEST' | 'STAGING' | 'PRODUCTION';
  policyId?: string;
  evaluatedByUserId?: string;
  context?: IMlExecutionContext;
}

export class DatasetReadinessService {
  public async getOrCreateDefaultStatisticalPolicy(): Promise<IStatisticalEvaluationPolicy> {
    let policy = await StatisticalEvaluationPolicyModel.findOne({ policyVersion: 'v1.0.0-stat-policy' }).exec();
    if (!policy) {
      const config = {
        confidenceLevel: 0.95,
        bootstrapIterations: 1000,
        minimumMapImprovement: 0.03,
        maximumAllowedFprRegression: 0.00,
        minimumEvaluationGroups: 3,
        minimumItemsPerSubgroup: 2,
        minimumPositiveItemsPerClass: 2,
        minimumNegativeWindows: 2,
        minimumCameraCount: 2,
        subgroupRegressionRules: [
          { subgroup: 'DAY', minimumItemsRequired: 2, maximumAllowedRegression: 0.00 },
          { subgroup: 'NIGHT', minimumItemsRequired: 2, maximumAllowedRegression: 0.00 },
          { subgroup: 'SMALL_OBJECT', minimumItemsRequired: 2, maximumAllowedRegression: 0.00 },
          { subgroup: 'BLUR_OCCLUDED', minimumItemsRequired: 2, maximumAllowedRegression: 0.00 }
        ]
      };
      const policyHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
      policy = await StatisticalEvaluationPolicyModel.create({
        policyId: 'stat-eval-v1-policy',
        policyVersion: 'v1.0.0-stat-policy',
        policyHash,
        targetModel: 'OBJECT_DETECTOR',
        environment: 'STAGING',
        status: 'APPROVED',
        configuration: config
      });
    }
    return policy;
  }

  public async evaluateDatasetReadiness(params: IEvaluateReadinessParams): Promise<IDatasetReadinessEvaluation> {
    const targetModel: TargetModelType = params.targetModel || 'OBJECT_DETECTOR';
    const envVal = params.environment || 'STAGING';
    const policy = await this.getOrCreateDefaultStatisticalPolicy();

    const candidates = await AiDatasetCandidateModel.find({
      targetModel,
      approvalStatus: 'APPROVED'
    }).exec();

    let positiveCount = 0;
    let negativeCount = 0;
    let dayCount = 0;
    let nightCount = 0;
    let smallObjectCount = 0;
    let blurCount = 0;
    let independentWindowCount = 0;
    const cameraSet = new Set<string>();

    for (const cand of candidates) {
      if (cand.datasetUsageRole === 'TRAINING_POSITIVE') positiveCount++;
      if (cand.datasetUsageRole === 'TRAINING_NEGATIVE') negativeCount++;

      const meta = cand.conditionMetadata;
      if (meta) {
        if (meta.lighting === 'DAY') dayCount++;
        if (meta.lighting === 'NIGHT') nightCount++;
        if (meta.objectScale === 'SMALL') smallObjectCount++;
        if (meta.blurLevel !== undefined && meta.blurLevel !== null && meta.blurLevel > 0) blurCount++;
        if (meta.samplingSource === 'INDEPENDENT_WINDOW') independentWindowCount++;
        if (meta.cameraId) cameraSet.add(meta.cameraId);
      }
    }

    const totalCandidates = candidates.length;
    const cameraLocationCount = cameraSet.size;

    const unsatisfiedRuleReasons: string[] = [];
    const cfg = policy.configuration;

    if (totalCandidates < cfg.minimumEvaluationGroups * 2) {
      unsatisfiedRuleReasons.push(`Total candidate count (${totalCandidates}) below minimum required (${cfg.minimumEvaluationGroups * 2}).`);
    }
    if (positiveCount < cfg.minimumPositiveItemsPerClass) {
      unsatisfiedRuleReasons.push(`Positive sample count (${positiveCount}) below minimum required (${cfg.minimumPositiveItemsPerClass}).`);
    }
    if (negativeCount < cfg.minimumNegativeWindows) {
      unsatisfiedRuleReasons.push(`Negative sample count (${negativeCount}) below minimum required (${cfg.minimumNegativeWindows}).`);
    }
    if (dayCount < cfg.minimumItemsPerSubgroup) {
      unsatisfiedRuleReasons.push(`Day lighting sample count (${dayCount}) below minimum required (${cfg.minimumItemsPerSubgroup}).`);
    }
    if (nightCount < cfg.minimumItemsPerSubgroup) {
      unsatisfiedRuleReasons.push(`Night lighting sample count (${nightCount}) below minimum required (${cfg.minimumItemsPerSubgroup}).`);
    }
    if (smallObjectCount < cfg.minimumItemsPerSubgroup) {
      unsatisfiedRuleReasons.push(`Small object sample count (${smallObjectCount}) below minimum required (${cfg.minimumItemsPerSubgroup}).`);
    }
    if (cameraLocationCount < cfg.minimumCameraCount) {
      unsatisfiedRuleReasons.push(`Camera location count (${cameraLocationCount}) below minimum required (${cfg.minimumCameraCount}).`);
    }

    const totalRules = 7;
    const passedRules = totalRules - unsatisfiedRuleReasons.length;
    const overallReadinessPercentage = Math.round((passedRules / totalRules) * 100);
    const readyForTraining = unsatisfiedRuleReasons.length === 0;

    const breakdown = {
      totalCandidates,
      positiveCount,
      negativeCount,
      dayCount,
      nightCount,
      smallObjectCount,
      blurCount,
      independentWindowCount,
      cameraLocationCount
    };

    const evaluationId = `readiness-eval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const canonicalPayload = {
      evaluationId,
      targetModel,
      environment: envVal,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
      readyForTraining,
      overallReadinessPercentage,
      breakdown,
      unsatisfiedRuleReasons
    };

    const resultHash = crypto.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');

    const evalRecord = await DatasetReadinessEvaluationModel.create({
      evaluationId,
      targetModel,
      environment: envVal,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
      readyForTraining,
      overallReadinessPercentage,
      breakdown,
      unsatisfiedRuleReasons,
      evaluatedByUserId: params.evaluatedByUserId && mongoose.Types.ObjectId.isValid(params.evaluatedByUserId) ? new mongoose.Types.ObjectId(params.evaluatedByUserId) : undefined,
      resultHash
    });

    console.log(`[DATASET_READINESS] Evaluated Dataset Readiness '${evaluationId}' (Ready: ${readyForTraining}, Percentage: ${overallReadinessPercentage}%)`);
    return evalRecord;
  }
}

export const datasetReadinessService = new DatasetReadinessService();
