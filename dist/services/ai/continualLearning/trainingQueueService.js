"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainingQueueService = exports.TrainingQueueService = void 0;
const ModelTrainingJob_1 = require("../../../database/models/ModelTrainingJob");
const AiDatasetVersion_1 = require("../../../database/models/AiDatasetVersion");
const AiGoldenDatasetVersion_1 = require("../../../database/models/AiGoldenDatasetVersion");
const TrainingEligibilityEvaluation_1 = require("../../../database/models/TrainingEligibilityEvaluation");
const TrainingEligibilityPolicy_1 = require("../../../database/models/TrainingEligibilityPolicy");
const goldenDatasetService_1 = require("./goldenDatasetService");
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = __importDefault(require("crypto"));
class TrainingQueueService {
    async createTrainingJob(params) {
        const executionMode = params.executionMode || 'STUB';
        const jobEnvironment = params.jobEnvironment || 'TEST';
        // 1. Dataset Eligibility & Status Guard
        const datasetVersion = await AiDatasetVersion_1.AiDatasetVersionModel.findOne({ datasetVersion: params.datasetVersionStr }).exec();
        if (!datasetVersion || datasetVersion.status !== 'READY' || !datasetVersion.structurallyValid || !datasetVersion.trainingEligible || !datasetVersion.approvedEligibilityEvaluationId) {
            const err = new Error(`DATASET_NOT_TRAINING_ELIGIBLE: Dataset version ${params.datasetVersionStr} is not READY or not training eligible.`);
            err.status = 422;
            throw err;
        }
        // 2. Evaluation Guard
        const evaluation = await TrainingEligibilityEvaluation_1.TrainingEligibilityEvaluationModel.findById(datasetVersion.approvedEligibilityEvaluationId).exec();
        if (!evaluation || !evaluation.eligible) {
            const err = new Error(`DATASET_ELIGIBILITY_PENDING: Approved eligibility evaluation missing or not eligible.`);
            err.status = 409;
            throw err;
        }
        // 3. Current Policy Status Guard (P0: Re-verify policy is STILL APPROVED)
        const prodPolicy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyVersion: evaluation.policyVersion }).exec();
        if (!prodPolicy || prodPolicy.status !== 'APPROVED') {
            const err = new Error(`POLICY_RETIRED_TERMINAL: Policy ${evaluation.policyVersion} associated with evaluation is in status '${prodPolicy?.status || 'UNKNOWN'}' (not APPROVED). Cannot create training job.`);
            err.status = 409;
            throw err;
        }
        // Environment Guard: PRODUCTION job requires PRODUCTION APPROVED policy
        if (jobEnvironment === 'PRODUCTION' && prodPolicy.environment !== 'PRODUCTION') {
            const err = new Error(`ENVIRONMENT_MISMATCH: Cannot create PRODUCTION training job using policy in '${prodPolicy.environment}' environment.`);
            err.status = 422;
            throw err;
        }
        // 4. Golden Dataset Guard
        const goldenDataset = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion: params.goldenDatasetVersionStr }).exec();
        if (!goldenDataset || goldenDataset.status !== 'APPROVED' || !goldenDataset.approvalEligible) {
            const err = new Error(`GOLDEN_DATASET_INSUFFICIENT: Golden dataset ${params.goldenDatasetVersionStr} is not APPROVED or not composition eligible.`);
            err.status = 422;
            throw err;
        }
        // 5. Zero Overlap Guard
        const overlapCheck = goldenDatasetService_1.goldenDatasetService.checkOverlap(goldenDataset.manifestItems, datasetVersion.manifestItems);
        if (overlapCheck.hasOverlap) {
            const err = new Error(`GOLDEN_DATASET_TRAINING_OVERLAP: Training dataset overlaps with Golden Baseline Dataset! Overlapping: ${overlapCheck.overlappingHashes.join(', ')}`);
            err.status = 409;
            throw err;
        }
        // Compute Job Identity Hash for Idempotency
        const baseModelId = 'yolov8n-baseline';
        const baseModelArtifactHash = 'sha256-base-model-hash';
        const trainingConfig = { batchSize: 16, epochs: 10, lr0: 0.01 };
        const trainingConfigHash = crypto_1.default.createHash('sha256').update(JSON.stringify(trainingConfig)).digest('hex');
        const provenancePayload = {
            targetModel: params.targetModel,
            jobEnvironment,
            executionMode,
            datasetVersion: params.datasetVersionStr,
            datasetManifestHash: datasetVersion.manifestHash,
            approvedEligibilityEvaluationId: evaluation._id.toString(),
            approvedEligibilityEvaluationHash: evaluation.evaluationHash,
            approvedEligibilityPolicyId: prodPolicy.policyId,
            approvedEligibilityPolicyVersion: prodPolicy.policyVersion,
            approvedEligibilityPolicyHash: prodPolicy.policyHash,
            goldenDatasetVersion: params.goldenDatasetVersionStr,
            goldenManifestHash: goldenDataset.manifestHash,
            baseModelId,
            baseModelArtifactHash,
            trainingConfigHash
        };
        const jobIdentityHash = crypto_1.default.createHash('sha256').update(JSON.stringify(provenancePayload)).digest('hex');
        // Check for existing Job with identical provenance (Idempotency)
        const existingJob = await ModelTrainingJob_1.ModelTrainingJobModel.findOne({ jobIdentityHash }).exec();
        if (existingJob) {
            console.log(`[TRAINING_QUEUE] Idempotent hit for Job ${existingJob.jobId} (Hash: ${jobIdentityHash.slice(0, 8)})`);
            return existingJob;
        }
        const randomSuffix = crypto_1.default.randomBytes(3).toString('hex');
        const jobId = `job-train-${params.targetModel.toLowerCase()}-${Date.now()}-${randomSuffix}`;
        try {
            const job = await ModelTrainingJob_1.ModelTrainingJobModel.create({
                jobId,
                jobIdentityHash,
                targetModel: params.targetModel,
                jobEnvironment,
                executionMode,
                completionType: executionMode === 'STUB' ? 'SIMULATION' : 'ACTUAL',
                actualTrainingPerformed: false,
                actualEvaluationPerformed: false,
                promotionEligible: false, // STUB is NEVER promotion eligible
                metricsSource: executionMode === 'STUB' ? 'SYNTHETIC' : 'ACTUAL',
                outputArtifactPath: null,
                outputArtifactHash: null,
                datasetVersion: params.datasetVersionStr,
                datasetManifestHash: datasetVersion.manifestHash,
                approvedEligibilityEvaluationId: evaluation._id,
                approvedEligibilityEvaluationHash: evaluation.evaluationHash,
                approvedEligibilityPolicyId: prodPolicy.policyId,
                approvedEligibilityPolicyVersion: prodPolicy.policyVersion,
                approvedEligibilityPolicyHash: prodPolicy.policyHash,
                goldenDatasetVersion: params.goldenDatasetVersionStr,
                goldenManifestHash: goldenDataset.manifestHash,
                baseModelId,
                baseModelVersion: 'v3.0.0',
                baseModelArtifactHash,
                trainingConfig,
                trainingConfigHash,
                status: 'QUEUED',
                createdByUserId: new mongoose_1.default.Types.ObjectId(params.createdByUserId)
            });
            console.log(`[TRAINING_QUEUE] Successfully QUEUED Training Job ${jobId} (ExecutionMode: ${executionMode}, PromotionEligible: false)`);
            return job;
        }
        catch (err) {
            if (err.code === 11000) {
                const raceJob = await ModelTrainingJob_1.ModelTrainingJobModel.findOne({ jobIdentityHash }).exec();
                if (raceJob)
                    return raceJob;
            }
            throw err;
        }
    }
    async cancelJob(jobId, actorUserId, reason) {
        const job = await ModelTrainingJob_1.ModelTrainingJobModel.findOne({ jobId }).exec();
        if (!job)
            throw new Error(`Job ${jobId} not found.`);
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
            throw new Error(`Cannot cancel job ${jobId} in status '${job.status}'.`);
        }
        if (job.status === 'QUEUED') {
            job.status = 'CANCELLED';
            job.cancellationRequestedAt = new Date();
            job.cancellationRequestedBy = new mongoose_1.default.Types.ObjectId(actorUserId);
            job.cancellationReason = reason;
            await job.save();
            console.log(`[TRAINING_QUEUE] Queued Job ${jobId} CANCELLED immediately.`);
        }
        else {
            // PREPARING_DATASET, TRAINING, EVALUATING -> Set cancellationRequestedAt so worker stops
            job.cancellationRequestedAt = new Date();
            job.cancellationRequestedBy = new mongoose_1.default.Types.ObjectId(actorUserId);
            job.cancellationReason = reason;
            await job.save();
            console.log(`[TRAINING_QUEUE] Cancellation requested for running Job ${jobId}. Worker will stop execution.`);
        }
        return job;
    }
}
exports.TrainingQueueService = TrainingQueueService;
exports.trainingQueueService = new TrainingQueueService();
