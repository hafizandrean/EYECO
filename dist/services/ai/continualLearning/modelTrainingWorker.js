"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelTrainingWorker = exports.ModelTrainingWorker = void 0;
const ModelTrainingJob_1 = require("../../../database/models/ModelTrainingJob");
const AiDatasetVersion_1 = require("../../../database/models/AiDatasetVersion");
const AiGoldenDatasetVersion_1 = require("../../../database/models/AiGoldenDatasetVersion");
const TrainingEligibilityPolicy_1 = require("../../../database/models/TrainingEligibilityPolicy");
const crypto_1 = __importDefault(require("crypto"));
class ModelTrainingWorker {
    static LEASE_DURATION_MS = 60000; // 60 seconds lease
    async claimNextJob(workerId) {
        const now = new Date();
        const claimToken = crypto_1.default.randomBytes(8).toString('hex');
        const leaseExpiresAt = new Date(now.getTime() + ModelTrainingWorker.LEASE_DURATION_MS);
        // Atomic claim query: status === QUEUED OR RETRY_WAIT OR lease expired
        const job = await ModelTrainingJob_1.ModelTrainingJobModel.findOneAndUpdate({
            $or: [
                { status: 'QUEUED' },
                { status: 'RETRY_WAIT' },
                { status: { $in: ['PREPARING_DATASET', 'TRAINING', 'EVALUATING'] }, leaseExpiresAt: { $lt: now } }
            ]
        }, {
            $set: {
                status: 'PREPARING_DATASET',
                workerId,
                claimToken,
                leaseExpiresAt,
                startedAt: now
            },
            $inc: { retryCount: 1 }
        }, { new: true }).exec();
        if (!job)
            return null;
        console.log(`[TRAINING_WORKER] Worker ${workerId} claimed Job ${job.jobId} (ClaimToken: ${claimToken}, Attempt: ${job.retryCount})`);
        // Pre-Execution Revalidation: Verify input integrity after claim
        const isIntegrityValid = await this.revalidateJobInputs(job);
        if (!isIntegrityValid) {
            await this.handleJobFailure(job, 'TRAINING_INPUT_INTEGRITY_FAILED', 'Job input integrity check failed at claim.', false);
            return job;
        }
        return job;
    }
    async sendHeartbeat(jobId, workerId, claimToken) {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + ModelTrainingWorker.LEASE_DURATION_MS);
        const updated = await ModelTrainingJob_1.ModelTrainingJobModel.findOneAndUpdate({ _id: jobId, workerId, claimToken, leaseExpiresAt: { $gt: now } }, { $set: { leaseExpiresAt } }, { new: true }).exec();
        if (!updated) {
            console.warn(`[TRAINING_WORKER] Heartbeat failed for Job ${jobId} (Worker ${workerId}) - Stale lease or mismatched claimToken`);
            return false;
        }
        return true;
    }
    async handleJobFailure(job, errorCode, errorMessage, isRetryable) {
        if (isRetryable && job.retryCount < job.maxRetries) {
            job.status = 'RETRY_WAIT';
            job.errorCode = errorCode;
            job.failureReason = errorMessage;
            await job.save();
            console.warn(`[TRAINING_WORKER] Job ${job.jobId} encountered retryable error '${errorCode}'. State -> RETRY_WAIT (Attempt ${job.retryCount}/${job.maxRetries})`);
        }
        else {
            job.status = 'FAILED';
            job.errorCode = (isRetryable && job.retryCount >= job.maxRetries) ? 'MAX_ATTEMPTS_EXHAUSTED' : errorCode;
            job.failureReason = errorMessage;
            job.actualTrainingPerformed = false;
            job.promotionEligible = false;
            job.claimToken = null;
            job.leaseExpiresAt = null;
            await job.save();
            console.error(`[TRAINING_WORKER] Job ${job.jobId} failed with error '${job.errorCode}'. State -> FAILED (Attempt ${job.retryCount}/${job.maxRetries})`);
        }
        return job;
    }
    async revalidateJobInputs(job) {
        const datasetVersion = await AiDatasetVersion_1.AiDatasetVersionModel.findOne({ datasetVersion: job.datasetVersion }).exec();
        if (!datasetVersion || datasetVersion.status !== 'READY' || datasetVersion.manifestHash !== job.datasetManifestHash) {
            return false;
        }
        const goldenDataset = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion: job.goldenDatasetVersion }).exec();
        if (!goldenDataset || goldenDataset.status !== 'APPROVED' || goldenDataset.manifestHash !== job.goldenManifestHash) {
            return false;
        }
        const policy = await TrainingEligibilityPolicy_1.TrainingEligibilityPolicyModel.findOne({ policyId: job.approvedEligibilityPolicyId }).exec();
        if (!policy || policy.status !== 'APPROVED' || policy.policyHash !== job.approvedEligibilityPolicyHash) {
            return false;
        }
        return true;
    }
    // Simulated Model Trainer Stub
    async runTrainerStub(job) {
        if (job.status === 'FAILED' || job.status === 'CANCELLED')
            return job;
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + ModelTrainingWorker.LEASE_DURATION_MS);
        // Atomic state update verifying claimToken and workerId (Stale Worker Protection)
        const updateJobState = async (nextStatus, extraFields = {}) => {
            const currentJob = await ModelTrainingJob_1.ModelTrainingJobModel.findOne({ _id: job._id }).exec();
            if (currentJob?.cancellationRequestedAt) {
                currentJob.status = 'CANCELLED';
                currentJob.actualTrainingPerformed = false;
                currentJob.promotionEligible = false;
                await currentJob.save();
                console.log(`[TRAINER_STUB] Job ${job.jobId} cancelled upon request.`);
                return currentJob;
            }
            const updated = await ModelTrainingJob_1.ModelTrainingJobModel.findOneAndUpdate({ _id: job._id, workerId: job.workerId, claimToken: job.claimToken }, {
                $set: {
                    status: nextStatus,
                    leaseExpiresAt,
                    ...extraFields
                }
            }, { new: true }).exec();
            if (!updated) {
                throw new Error(`STALE_WORKER_WRITE_BLOCKED: Stale worker ${job.workerId} write blocked for Job ${job.jobId}`);
            }
            return updated;
        };
        // Transition 1: TRAINING
        let currentJob = await updateJobState('TRAINING');
        if (currentJob.status === 'CANCELLED')
            return currentJob;
        console.log(`[TRAINER_STUB] Job ${job.jobId} state -> TRAINING`);
        // Transition 2: EVALUATING
        currentJob = await updateJobState('EVALUATING', {
            simulatedMetrics: { epochs: 10, mAP50_95: 0.78, precision: 0.82, recall: 0.76, loss: 0.045 }
        });
        if (currentJob.status === 'CANCELLED')
            return currentJob;
        console.log(`[TRAINER_STUB] Job ${job.jobId} state -> EVALUATING`);
        // Transition 3: COMPLETED (Simulation / Stub completion)
        currentJob = await updateJobState('COMPLETED', {
            completionType: 'SIMULATION',
            actualTrainingPerformed: false,
            actualEvaluationPerformed: false,
            promotionEligible: false, // STUB IS NOT PROMOTION ELIGIBLE!
            metricsSource: 'SYNTHETIC',
            outputArtifactPath: null,
            outputArtifactHash: null,
            simulatedMetrics: { goldenMAP50_95: 0.80, falsePositiveRate: 0.015 },
            completedAt: new Date()
        });
        console.log(`[TRAINER_STUB] Job ${job.jobId} state -> COMPLETED (SIMULATION STUB, PromotionEligible: false)`);
        return currentJob;
    }
}
exports.ModelTrainingWorker = ModelTrainingWorker;
exports.modelTrainingWorker = new ModelTrainingWorker();
