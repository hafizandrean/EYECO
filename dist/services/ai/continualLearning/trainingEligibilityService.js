"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainingEligibilityService = exports.TrainingEligibilityService = void 0;
const AiDatasetVersion_1 = require("../../../database/models/AiDatasetVersion");
const AiDatasetCandidate_1 = require("../../../database/models/AiDatasetCandidate");
const assetValidationService_1 = require("./assetValidationService");
const DatasetAssetValidationReport_1 = require("../../../database/models/DatasetAssetValidationReport");
const TrainingEligibilityEvaluation_1 = require("../../../database/models/TrainingEligibilityEvaluation");
const TrainingEligibilityPolicy_1 = require("../../../database/models/TrainingEligibilityPolicy");
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = __importDefault(require("crypto"));
class TrainingEligibilityService {
    static DEFAULT_POLICY_VERSION = 'v1.0.0-strict-policy';
    async getOrCreateDefaultProductionPolicy() {
        let policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyVersion: TrainingEligibilityService.DEFAULT_POLICY_VERSION, environment: 'PRODUCTION' }).exec();
        if (!policy) {
            const config = {
                minimumTotalSamples: 10,
                minimumTrainSamples: 6,
                minimumValidationSamples: 1,
                minimumTestSamples: 1,
                minimumIndependentGroups: 3,
                minimumSamplesPerClass: 5,
                minimumCameraCount: 1,
                minimumLocationCount: 1
            };
            const policyHash = crypto_1.default.createHash('sha256').update(JSON.stringify(config)).digest('hex');
            policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.create({
                policyId: `policy-${TrainingEligibilityService.DEFAULT_POLICY_VERSION}-prod`,
                policyVersion: TrainingEligibilityService.DEFAULT_POLICY_VERSION,
                policyHash,
                targetModel: 'OBJECT_DETECTOR',
                environment: 'PRODUCTION',
                status: 'APPROVED',
                configuration: config,
                approvedByUserId: new mongoose_1.default.Types.ObjectId(),
                approvedAt: new Date()
            });
        }
        return policy;
    }
    async approvePolicy(policyId, approvedByUserId) {
        const policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyId }).exec();
        if (!policy) {
            throw new Error(`Policy ${policyId} not found.`);
        }
        if (policy.status === 'RETIRED') {
            const err = new Error(`POLICY_RETIRED_TERMINAL: Cannot re-approve a RETIRED policy. Create a new policy version.`);
            err.status = 409;
            throw err;
        }
        // Check for conflicting policy with same version but different hash
        const conflict = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({
            policyVersion: policy.policyVersion,
            policyId: { $ne: policyId },
            policyHash: { $ne: policy.policyHash }
        }).exec();
        if (conflict) {
            const err = new Error(`POLICY_VERSION_HASH_CONFLICT: Policy version ${policy.policyVersion} already exists with different hash.`);
            err.status = 409;
            throw err;
        }
        policy.status = 'APPROVED';
        policy.approvedByUserId = new mongoose_1.default.Types.ObjectId(approvedByUserId);
        policy.approvedAt = new Date();
        await policy.save();
        console.log(`[POLICY_GOVERNANCE] Policy ${policyId} APPROVED by admin ${approvedByUserId}`);
        return policy;
    }
    async retirePolicy(policyId, adminUserId) {
        const policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyId }).exec();
        if (!policy) {
            throw new Error(`Policy ${policyId} not found.`);
        }
        policy.status = 'RETIRED';
        await policy.save();
        console.log(`[POLICY_GOVERNANCE] Policy ${policyId} RETIRED by admin ${adminUserId}`);
        return policy;
    }
    async getOrCreateDefaultStagingPolicy() {
        let policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyVersion: TrainingEligibilityService.DEFAULT_POLICY_VERSION, environment: 'STAGING' }).exec();
        if (!policy) {
            const config = {
                minimumTotalSamples: 5,
                minimumTrainSamples: 1,
                minimumValidationSamples: 1,
                minimumTestSamples: 1,
                minimumIndependentGroups: 1,
                minimumSamplesPerClass: 1,
                minimumCameraCount: 1,
                minimumLocationCount: 1
            };
            const policyHash = crypto_1.default.createHash('sha256').update(JSON.stringify(config)).digest('hex');
            policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.create({
                policyId: `policy-${TrainingEligibilityService.DEFAULT_POLICY_VERSION}-staging`,
                policyVersion: TrainingEligibilityService.DEFAULT_POLICY_VERSION,
                policyHash,
                targetModel: 'OBJECT_DETECTOR',
                environment: 'STAGING',
                status: 'APPROVED',
                configuration: config,
                approvedByUserId: new mongoose_1.default.Types.ObjectId(),
                approvedAt: new Date()
            });
        }
        return policy;
    }
    async evaluateDatasetEligibility(params) {
        const environment = params.environment || 'PRODUCTION';
        const datasetVersionStr = params.datasetVersionStr;
        const datasetVersion = await AiDatasetVersion_1.AiDatasetVersionModel.findOne({ datasetVersion: datasetVersionStr }).exec();
        if (!datasetVersion) {
            throw new Error(`Dataset version ${datasetVersionStr} not found.`);
        }
        let policyToUse = environment === 'STAGING'
            ? await this.getOrCreateDefaultStagingPolicy()
            : await this.getOrCreateDefaultProductionPolicy();
        if (params.policyId) {
            const foundPolicy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyId: params.policyId }).exec();
            if (foundPolicy)
                policyToUse = foundPolicy;
        }
        const config = params.customPolicyConfig ? { ...policyToUse.configuration, ...params.customPolicyConfig } : policyToUse.configuration;
        const policyHash = crypto_1.default.createHash('sha256').update(JSON.stringify(config)).digest('hex');
        const gateResults = [];
        let isEligible = true;
        // 1. POLICY_APPROVAL_STATE_GATE (P0: Enforce policy status === APPROVED & approvedByUserId != null)
        const isPolicyApproved = policyToUse.status === 'APPROVED' && policyToUse.approvedByUserId != null && policyToUse.approvedAt != null;
        gateResults.push({
            gate: 'POLICY_APPROVAL_STATE_GATE',
            passed: isPolicyApproved,
            observedValue: policyToUse.status,
            requiredValue: 'APPROVED',
            reasons: isPolicyApproved ? [] : [`Policy '${policyToUse.policyId}' is in status '${policyToUse.status}' (not APPROVED by admin). Eligibility evaluation REJECTED.`]
        });
        if (!isPolicyApproved)
            isEligible = false;
        // 2. DATASET_STATUS_READY_GATE (P0: Block promotion of INSUFFICIENT_DATA datasets)
        const isStatusReady = datasetVersion.status === 'READY';
        gateResults.push({
            gate: 'DATASET_STATUS_READY_GATE',
            passed: isStatusReady,
            observedValue: datasetVersion.status,
            requiredValue: 'READY',
            reasons: isStatusReady ? [] : [`Dataset status '${datasetVersion.status}' cannot be promoted to ELIGIBLE. Only READY datasets can be evaluated for training.`]
        });
        if (!isStatusReady)
            isEligible = false;
        // 3. CANDIDATE_ASSIGNMENT_CONSISTENCY_GATE (P0)
        const candidates = await AiDatasetCandidate_1.AiDatasetCandidateModel.find({ _id: { $in: datasetVersion.includedCandidateIds } }).exec();
        const isAssignmentConsistent = candidates.length === datasetVersion.includedCandidateIds.length &&
            candidates.every(c => c.approvalStatus === 'ASSIGNED_TO_DATASET' && c.assignedDatasetVersion === datasetVersionStr);
        gateResults.push({
            gate: 'CANDIDATE_ASSIGNMENT_CONSISTENCY_GATE',
            passed: isAssignmentConsistent,
            observedValue: `${candidates.filter(c => c.approvalStatus === 'ASSIGNED_TO_DATASET').length}/${datasetVersion.includedCandidateIds.length} assigned`,
            requiredValue: `${datasetVersion.includedCandidateIds.length}/${datasetVersion.includedCandidateIds.length} assigned`,
            reasons: isAssignmentConsistent ? [] : ['Candidate assignment is inconsistent (candidates were released or unassigned).']
        });
        if (!isAssignmentConsistent)
            isEligible = false;
        // 4. MANIFEST_INTEGRITY_GATE
        const isManifestIntegrityValid = datasetVersion.structurallyValid && datasetVersion.status !== 'INVALID';
        gateResults.push({
            gate: 'MANIFEST_INTEGRITY_GATE',
            passed: isManifestIntegrityValid,
            observedValue: datasetVersion.status,
            requiredValue: 'READY / INSUFFICIENT_DATA',
            reasons: isManifestIntegrityValid ? [] : ['Dataset manifest status is INVALID or corrupted.']
        });
        if (!isManifestIntegrityValid)
            isEligible = false;
        // 5. PINNED_ASSET_VALIDATION_GATE
        let assetReport = null;
        if (params.assetValidationReportId) {
            assetReport = await DatasetAssetValidationReport_1.DatasetAssetValidationReportModel.findById(params.assetValidationReportId).exec();
        }
        else {
            assetReport = await DatasetAssetValidationReport_1.DatasetAssetValidationReportModel.findOne({ datasetVersion: datasetVersionStr }).sort({ createdAt: -1 }).exec();
        }
        if (!assetReport) {
            assetReport = await assetValidationService_1.assetValidationService.validateDatasetAssets(datasetVersionStr);
        }
        const isAssetReportValid = assetReport && assetReport.datasetVersion === datasetVersionStr && assetReport.passed === true;
        gateResults.push({
            gate: 'PINNED_ASSET_VALIDATION_GATE',
            passed: !!isAssetReportValid,
            observedValue: assetReport ? `${assetReport.validItemCount}/${assetReport.checkedItemCount} valid` : 'REPORT_MISSING',
            requiredValue: `${datasetVersion.splitCounts.total}/${datasetVersion.splitCounts.total} valid`,
            reasons: isAssetReportValid ? [] : (assetReport ? assetReport.failureReasons : ['Pinned Asset Validation Report missing or failed.'])
        });
        if (!isAssetReportValid)
            isEligible = false;
        // 6. LEAKAGE_AUDIT_GATE
        const isLeakagePassed = datasetVersion.leakageCheckStatus === 'PASSED';
        gateResults.push({
            gate: 'LEAKAGE_AUDIT_GATE',
            passed: isLeakagePassed,
            observedValue: datasetVersion.leakageCheckStatus,
            requiredValue: 'PASSED',
            reasons: isLeakagePassed ? [] : ['Cross-split data leakage detected in manifest.']
        });
        if (!isLeakagePassed)
            isEligible = false;
        // 7. MINIMUM_SAMPLES_GATE
        const counts = datasetVersion.splitCounts || { train: 0, val: 0, test: 0, total: 0 };
        const isMinSamplesPassed = counts.total >= config.minimumTotalSamples &&
            counts.train >= config.minimumTrainSamples &&
            counts.val >= config.minimumValidationSamples &&
            counts.test >= config.minimumTestSamples;
        gateResults.push({
            gate: 'MINIMUM_SAMPLES_GATE',
            passed: isMinSamplesPassed,
            observedValue: `Total:${counts.total}, Train:${counts.train}, Val:${counts.val}, Test:${counts.test}`,
            requiredValue: `Total:${config.minimumTotalSamples}, Train:${config.minimumTrainSamples}, Val:${config.minimumValidationSamples}, Test:${config.minimumTestSamples}`,
            reasons: isMinSamplesPassed ? [] : [`Sample count below policy threshold (Total:${counts.total}/${config.minimumTotalSamples})`]
        });
        if (!isMinSamplesPassed)
            isEligible = false;
        // 8. INDEPENDENT_GROUPS_GATE
        const manifestItems = datasetVersion.manifestItems || [];
        const uniqueGroups = new Set(manifestItems.map(item => item.groupKey));
        const isGroupsPassed = uniqueGroups.size >= config.minimumIndependentGroups;
        gateResults.push({
            gate: 'INDEPENDENT_GROUPS_GATE',
            passed: isGroupsPassed,
            observedValue: uniqueGroups.size,
            requiredValue: config.minimumIndependentGroups,
            reasons: isGroupsPassed ? [] : [`Unique lineage groups ${uniqueGroups.size} below minimum ${config.minimumIndependentGroups}`]
        });
        if (!isGroupsPassed)
            isEligible = false;
        const evaluationPayload = {
            datasetVersion: datasetVersionStr,
            policyVersion: policyToUse.policyVersion,
            policyHash,
            environment,
            structurallyValid: datasetVersion.structurallyValid,
            eligible: isEligible,
            gateResults,
            evaluatedAt: new Date(),
            evaluatedBy: 'SYSTEM'
        };
        const evaluationHash = crypto_1.default.createHash('sha256').update(JSON.stringify(evaluationPayload)).digest('hex');
        const evaluationDoc = await TrainingEligibilityEvaluation_1.TrainingEligibilityEvaluationModel.create({
            ...evaluationPayload,
            evaluationHash
        });
        // Pointers Update Guard: Update approved pointer if environment is PRODUCTION or STAGING and policy is APPROVED
        if ((environment === 'PRODUCTION' || environment === 'STAGING') && isPolicyApproved && isEligible) {
            datasetVersion.trainingEligibilityStatus = 'ELIGIBLE';
            datasetVersion.trainingEligible = true;
            datasetVersion.approvedEligibilityEvaluationId = evaluationDoc._id;
            datasetVersion.approvedEligibilityPolicyVersion = policyToUse.policyVersion;
            datasetVersion.approvedEligibilityEvaluationHash = evaluationHash;
            await datasetVersion.save();
        }
        console.log(`[ELIGIBILITY_SERVICE] Evaluated ${datasetVersionStr} (Eligible: ${isEligible}, Env: ${environment}, PolicyStatus: ${policyToUse.status})`);
        return evaluationDoc;
    }
}
exports.TrainingEligibilityService = TrainingEligibilityService;
exports.trainingEligibilityService = new TrainingEligibilityService();
