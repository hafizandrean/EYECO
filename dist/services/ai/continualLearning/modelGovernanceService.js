"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelGovernanceService = exports.ModelGovernanceService = void 0;
const AiModelRegistry_1 = require("../../../database/models/AiModelRegistry");
const modelRegistryAdmissionService_1 = require("./modelRegistryAdmissionService");
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = __importDefault(require("crypto"));
class ModelGovernanceService {
    async registerModelCandidate(params) {
        const { job, goldenEvaluation: evaluation } = params;
        // Production Admission Guard Audit
        const isProductionEligible = job.executionMode === 'ACTUAL' &&
            job.actualTrainingPerformed === true &&
            job.actualEvaluationPerformed === true &&
            job.promotionEligible === true &&
            evaluation.evaluationMode === 'ACTUAL' &&
            evaluation.metricsSource === 'ACTUAL' &&
            evaluation.actualModelInferencePerformed === true &&
            evaluation.overallPassed === true &&
            evaluation.promotionEligible === true &&
            evaluation.statisticallyMeaningful === true;
        const status = isProductionEligible ? 'AWAITING_APPROVAL' : 'TEST_ONLY';
        const randomSuffix = crypto_1.default.randomBytes(3).toString('hex');
        const modelId = `model-${job.targetModel.toLowerCase()}-${Date.now()}-${randomSuffix}`;
        const modelVersion = `v3.${Date.now()}-cand`;
        // Validate lineage integrity prior to registry entry
        if (job.outputArtifactPath && fs_1.default.existsSync(job.outputArtifactPath)) {
            await modelRegistryAdmissionService_1.modelRegistryAdmissionService.validateLineageIntegrity({
                modelType: job.targetModel,
                environment: isProductionEligible ? job.jobEnvironment : 'TEST',
                modelVersion,
                artifactPath: job.outputArtifactPath,
                artifactHash: job.outputArtifactHash || 'hash-missing',
                baseModelArtifactHash: job.baseModelArtifactHash,
                trainingJobId: job.jobId,
                trainingExecutionResultId: job.trainingExecutionResultId,
                eligibilityEvaluationId: job.approvedEligibilityEvaluationId,
                goldenEvaluationId: evaluation._id,
                artifactValidationReportId: new mongoose_1.default.Types.ObjectId()
            });
        }
        const modelDoc = await AiModelRegistry_1.AiModelRegistryModel.create({
            modelId,
            modelType: job.targetModel,
            modelVersion,
            environment: isProductionEligible ? job.jobEnvironment : 'TEST',
            status,
            artifactPath: job.outputArtifactPath || null,
            artifactHash: job.outputArtifactHash || null,
            baseModelId: job.baseModelId || 'yolov8n-baseline',
            baseModelVersion: job.baseModelVersion || 'v3.0.0',
            baseModelArtifactHash: job.baseModelArtifactHash || 'sha256-base-model-hash',
            datasetVersion: job.datasetVersion,
            datasetManifestHash: job.datasetManifestHash,
            trainingJobId: job.jobId,
            trainingExecutionResultId: job.trainingExecutionResultId || null,
            eligibilityEvaluationId: job.approvedEligibilityEvaluationId,
            goldenEvaluationId: evaluation._id,
            metrics: evaluation.candidateMetrics,
            promotionEligible: isProductionEligible
        });
        if (!isProductionEligible) {
            const reason = evaluation.evaluationPurpose === 'PIPELINE_SMOKE_TEST' || !evaluation.statisticallyMeaningful
                ? 'EVALUATION_NOT_STATISTICALLY_MEANINGFUL'
                : 'STUB_OR_SIMULATION_MODE';
            console.warn(`[MODEL_GOVERNANCE] Job ${job.jobId} registered as Model ${modelId} with status 'TEST_ONLY' (Admission to PRODUCTION denied: ${reason}).`);
        }
        else {
            console.log(`[MODEL_GOVERNANCE] Model Candidate ${modelId} registered with status 'AWAITING_APPROVAL'.`);
        }
        return modelDoc;
    }
    async promoteModelStatus(params) {
        const { modelId, targetStatus, approvedByUserId } = params;
        const model = await AiModelRegistry_1.AiModelRegistryModel.findOne({ modelId }).exec();
        if (!model)
            throw new Error(`Model ${modelId} not found.`);
        if (model.status === 'TEST_ONLY' || !model.promotionEligible) {
            const err = new Error(`MODEL_REGISTRY_ADMISSION_DENIED: Model ${modelId} has status TEST_ONLY (promotionEligible = false). Cannot promote to ${targetStatus}. Reason: EVALUATION_NOT_STATISTICALLY_MEANINGFUL or SIMULATION_MODE.`);
            err.status = 422;
            throw err;
        }
        model.status = targetStatus;
        model.approvedByUserId = new mongoose_1.default.Types.ObjectId(approvedByUserId);
        model.approvedAt = new Date();
        await model.save();
        console.log(`[MODEL_GOVERNANCE] Model ${modelId} promoted to ${targetStatus} by admin ${approvedByUserId}`);
        return model;
    }
}
exports.ModelGovernanceService = ModelGovernanceService;
exports.modelGovernanceService = new ModelGovernanceService();
const fs_1 = __importDefault(require("fs"));
