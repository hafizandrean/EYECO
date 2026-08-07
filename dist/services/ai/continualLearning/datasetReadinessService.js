"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.datasetReadinessService = exports.DatasetReadinessService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const AiDatasetCandidate_1 = require("../../../database/models/AiDatasetCandidate");
const StatisticalEvaluationPolicy_1 = require("../../../database/models/StatisticalEvaluationPolicy");
const DatasetReadinessEvaluation_1 = require("../../../database/models/DatasetReadinessEvaluation");
class DatasetReadinessService {
    async getOrCreateDefaultStatisticalPolicy() {
        let policy = await StatisticalEvaluationPolicy_1.StatisticalEvaluationPolicyModel.findOne({ policyVersion: 'v1.0.0-stat-policy' }).exec();
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
            const policyHash = crypto_1.default.createHash('sha256').update(JSON.stringify(config)).digest('hex');
            policy = await StatisticalEvaluationPolicy_1.StatisticalEvaluationPolicyModel.create({
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
    async evaluateDatasetReadiness(params) {
        const targetModel = params.targetModel || 'OBJECT_DETECTOR';
        const envVal = params.environment || 'STAGING';
        const policy = await this.getOrCreateDefaultStatisticalPolicy();
        const candidates = await AiDatasetCandidate_1.AiDatasetCandidateModel.find({
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
        const cameraSet = new Set();
        for (const cand of candidates) {
            if (cand.datasetUsageRole === 'TRAINING_POSITIVE')
                positiveCount++;
            if (cand.datasetUsageRole === 'TRAINING_NEGATIVE')
                negativeCount++;
            const meta = cand.conditionMetadata;
            if (meta) {
                if (meta.lighting === 'DAY')
                    dayCount++;
                if (meta.lighting === 'NIGHT')
                    nightCount++;
                if (meta.objectScale === 'SMALL')
                    smallObjectCount++;
                if (meta.blurLevel !== undefined && meta.blurLevel !== null && meta.blurLevel > 0)
                    blurCount++;
                if (meta.samplingSource === 'INDEPENDENT_WINDOW')
                    independentWindowCount++;
                if (meta.cameraId)
                    cameraSet.add(meta.cameraId);
            }
        }
        const totalCandidates = candidates.length;
        const cameraLocationCount = cameraSet.size;
        const unsatisfiedRuleReasons = [];
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
        const evaluationId = `readiness-eval-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
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
        const resultHash = crypto_1.default.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
        const evalRecord = await DatasetReadinessEvaluation_1.DatasetReadinessEvaluationModel.create({
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
            evaluatedByUserId: params.evaluatedByUserId && mongoose_1.default.Types.ObjectId.isValid(params.evaluatedByUserId) ? new mongoose_1.default.Types.ObjectId(params.evaluatedByUserId) : undefined,
            resultHash
        });
        console.log(`[DATASET_READINESS] Evaluated Dataset Readiness '${evaluationId}' (Ready: ${readyForTraining}, Percentage: ${overallReadinessPercentage}%)`);
        return evalRecord;
    }
}
exports.DatasetReadinessService = DatasetReadinessService;
exports.datasetReadinessService = new DatasetReadinessService();
