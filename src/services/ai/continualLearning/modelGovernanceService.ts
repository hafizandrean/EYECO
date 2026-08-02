import { AiModelRegistryModel, IAiModelRegistry, ModelRegistryStatus } from '../../../database/models/AiModelRegistry';
import { IModelTrainingJob } from '../../../database/models/ModelTrainingJob';
import { IGoldenModelEvaluation } from '../../../database/models/GoldenModelEvaluation';
import { modelRegistryAdmissionService } from './modelRegistryAdmissionService';
import mongoose from 'mongoose';
import crypto from 'crypto';

export class ModelGovernanceService {
  public async registerModelCandidate(params: {
    job: IModelTrainingJob;
    goldenEvaluation: IGoldenModelEvaluation;
    createdByUserId: string;
  }): Promise<IAiModelRegistry> {
    const { job, goldenEvaluation: evaluation } = params;

    // Production Admission Guard Audit
    const isProductionEligible =
      job.executionMode === 'ACTUAL' &&
      job.actualTrainingPerformed === true &&
      job.actualEvaluationPerformed === true &&
      job.promotionEligible === true &&
      evaluation.evaluationMode === 'ACTUAL' &&
      evaluation.metricsSource === 'ACTUAL' &&
      evaluation.actualModelInferencePerformed === true &&
      evaluation.overallPassed === true &&
      evaluation.promotionEligible === true &&
      evaluation.statisticallyMeaningful === true;

    const status: ModelRegistryStatus = isProductionEligible ? 'AWAITING_APPROVAL' : 'TEST_ONLY';
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const modelId = `model-${job.targetModel.toLowerCase()}-${Date.now()}-${randomSuffix}`;
    const modelVersion = `v3.${Date.now()}-cand`;

    // Validate lineage integrity prior to registry entry
    if (job.outputArtifactPath && fs.existsSync(job.outputArtifactPath)) {
      await modelRegistryAdmissionService.validateLineageIntegrity({
        modelType: job.targetModel,
        environment: isProductionEligible ? job.jobEnvironment : 'TEST',
        modelVersion,
        artifactPath: job.outputArtifactPath,
        artifactHash: job.outputArtifactHash || 'hash-missing',
        baseModelArtifactHash: job.baseModelArtifactHash,
        trainingJobId: job.jobId,
        trainingExecutionResultId: job.trainingExecutionResultId,
        eligibilityEvaluationId: job.approvedEligibilityEvaluationId,
        goldenEvaluationId: evaluation._id as any,
        artifactValidationReportId: new mongoose.Types.ObjectId()
      });
    }

    const modelDoc = await AiModelRegistryModel.create({
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
      goldenEvaluationId: evaluation._id as any,
      metrics: evaluation.candidateMetrics,
      promotionEligible: isProductionEligible
    });

    if (!isProductionEligible) {
      const reason = evaluation.evaluationPurpose === 'PIPELINE_SMOKE_TEST' || !evaluation.statisticallyMeaningful
        ? 'EVALUATION_NOT_STATISTICALLY_MEANINGFUL'
        : 'STUB_OR_SIMULATION_MODE';
      console.warn(`[MODEL_GOVERNANCE] Job ${job.jobId} registered as Model ${modelId} with status 'TEST_ONLY' (Admission to PRODUCTION denied: ${reason}).`);
    } else {
      console.log(`[MODEL_GOVERNANCE] Model Candidate ${modelId} registered with status 'AWAITING_APPROVAL'.`);
    }

    return modelDoc;
  }

  public async promoteModelStatus(params: {
    modelId: string;
    targetStatus: ModelRegistryStatus;
    approvedByUserId: string;
  }): Promise<IAiModelRegistry> {
    const { modelId, targetStatus, approvedByUserId } = params;
    const model = await AiModelRegistryModel.findOne({ modelId }).exec();
    if (!model) throw new Error(`Model ${modelId} not found.`);

    if (model.status === 'TEST_ONLY' || !model.promotionEligible) {
      const err: any = new Error(`MODEL_REGISTRY_ADMISSION_DENIED: Model ${modelId} has status TEST_ONLY (promotionEligible = false). Cannot promote to ${targetStatus}. Reason: EVALUATION_NOT_STATISTICALLY_MEANINGFUL or SIMULATION_MODE.`);
      err.status = 422;
      throw err;
    }

    model.status = targetStatus;
    model.approvedByUserId = new mongoose.Types.ObjectId(approvedByUserId);
    model.approvedAt = new Date();
    await model.save();

    console.log(`[MODEL_GOVERNANCE] Model ${modelId} promoted to ${targetStatus} by admin ${approvedByUserId}`);
    return model;
  }
}

export const modelGovernanceService = new ModelGovernanceService();
import fs from 'fs';
