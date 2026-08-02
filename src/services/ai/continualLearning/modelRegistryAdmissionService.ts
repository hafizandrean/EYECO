import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { AiModelRegistryModel, IAiModelRegistry } from '../../../database/models/AiModelRegistry';
import { ModelTrainingJobModel } from '../../../database/models/ModelTrainingJob';
import { TrainingExecutionResultModel } from '../../../database/models/TrainingExecutionResult';
import { RootModelImportRecordModel } from '../../../database/models/RootModelImportRecord';
import { TrainingEligibilityEvaluationModel } from '../../../database/models/TrainingEligibilityEvaluation';
import { GoldenModelEvaluationModel } from '../../../database/models/GoldenModelEvaluation';
import { ModelArtifactValidationReportModel } from '../../../database/models/ModelArtifactValidationReport';
import { TargetModelType } from '../../../database/models/AiDatasetCandidate';

export interface IValidateLineageParams {
  modelType: string;
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  modelVersion: string;
  artifactPath: string;
  artifactHash: string;
  baseModelArtifactHash?: string;
  trainingJobId?: string | null;
  trainingExecutionResultId?: mongoose.Types.ObjectId | string | null;
  rootModelImportRecordId?: mongoose.Types.ObjectId | string | null;
  eligibilityEvaluationId?: mongoose.Types.ObjectId | string | null;
  goldenEvaluationId?: mongoose.Types.ObjectId | string | null;
  artifactValidationReportId?: mongoose.Types.ObjectId | string | null;
}

export class ModelRegistryAdmissionService {
  public async validateLineageIntegrity(params: IValidateLineageParams): Promise<{ valid: boolean; lineageType: 'TRAINED' | 'ROOT_IMPORT' }> {
    const isTrained = Boolean(params.trainingExecutionResultId || params.trainingJobId);
    const isRootImport = Boolean(params.rootModelImportRecordId);

    // Enforce mutually exclusive lineage paths
    if (isTrained && isRootImport) {
      const err: any = new Error('MODEL_REGISTRY_LINEAGE_AMBIGUOUS: Model registry record cannot specify both trained lineage and root model import lineage simultaneously.');
      err.status = 422;
      throw err;
    }

    if (!isTrained && !isRootImport) {
      const err: any = new Error('MODEL_REGISTRY_LINEAGE_INVALID: Model registry record must specify either trained lineage or root model import lineage.');
      err.status = 422;
      throw err;
    }

    // 1. Validate Artifact on Disk
    if (!params.artifactPath || !fs.existsSync(params.artifactPath)) {
      const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: PyTorch model artifact file not found on disk at ${params.artifactPath}.`);
      err.status = 422;
      throw err;
    }

    const diskBytes = fs.readFileSync(params.artifactPath);
    const diskHash = crypto.createHash('sha256').update(diskBytes).digest('hex');
    if (diskHash !== params.artifactHash) {
      const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: Artifact hash mismatch! Specified: ${params.artifactHash}, Computed: ${diskHash}.`);
      err.status = 422;
      throw err;
    }

    // 2. Validate Artifact Validation Report
    if (!params.artifactValidationReportId) {
      const err: any = new Error('MODEL_REGISTRY_LINEAGE_INVALID: ModelArtifactValidationReport reference is missing.');
      err.status = 422;
      throw err;
    }

    const valReport = await ModelArtifactValidationReportModel.findById(params.artifactValidationReportId).exec();
    if (!valReport || !valReport.loadPassed || !valReport.warmupPassed) {
      const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: ModelArtifactValidationReport '${params.artifactValidationReportId}' missing or failed framework validation.`);
      err.status = 422;
      throw err;
    }

    // 3. Validate Lineage Route
    if (isTrained) {
      if (!params.trainingJobId || !params.trainingExecutionResultId) {
        const err: any = new Error('MODEL_REGISTRY_LINEAGE_INVALID: Trained model lineage requires both trainingJobId and trainingExecutionResultId.');
        err.status = 422;
        throw err;
      }

      const job = await ModelTrainingJobModel.findOne({ jobId: params.trainingJobId }).exec();
      if (!job || job.status !== 'COMPLETED' || job.actualTrainingPerformed !== true) {
        const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: ModelTrainingJob '${params.trainingJobId}' missing or not COMPLETED.`);
        err.status = 422;
        throw err;
      }

      const trainResult = await TrainingExecutionResultModel.findById(params.trainingExecutionResultId).exec();
      if (!trainResult || trainResult.executionStatus !== 'SUCCEEDED' || trainResult.acceptedForFinalization !== true || trainResult.exitCode !== 0) {
        const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: TrainingExecutionResult '${params.trainingExecutionResultId}' missing, not accepted, or failed.`);
        err.status = 422;
        throw err;
      }

      if (params.eligibilityEvaluationId) {
        const eligDoc = await TrainingEligibilityEvaluationModel.findById(params.eligibilityEvaluationId).exec();
        if (!eligDoc || eligDoc.eligible !== true) {
          const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: TrainingEligibilityEvaluation '${params.eligibilityEvaluationId}' missing or not eligible.`);
          err.status = 422;
          throw err;
        }
      }

      if (params.goldenEvaluationId) {
        const goldenEvalDoc = await GoldenModelEvaluationModel.findById(params.goldenEvaluationId).exec();
        if (!goldenEvalDoc) {
          const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: GoldenModelEvaluation '${params.goldenEvaluationId}' does not exist.`);
          err.status = 422;
          throw err;
        }
      }

      return { valid: true, lineageType: 'TRAINED' };

    } else {
      const importRecord = await RootModelImportRecordModel.findById(params.rootModelImportRecordId).exec();
      if (!importRecord) {
        const err: any = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: RootModelImportRecord '${params.rootModelImportRecordId}' does not exist.`);
        err.status = 422;
        throw err;
      }

      return { valid: true, lineageType: 'ROOT_IMPORT' };
    }
  }

  public async registerModelCandidate(params: IValidateLineageParams & { createdByUserId: string; metrics?: Record<string, number> }): Promise<IAiModelRegistry> {
    const lineageCheck = await this.validateLineageIntegrity(params);

    const modelRecord = await AiModelRegistryModel.create({
      modelId: `model-${params.modelType.toLowerCase()}-${Date.now()}`,
      modelType: params.modelType as TargetModelType,
      modelVersion: params.modelVersion,
      environment: params.environment,
      status: 'TEST_ONLY',
      artifactPath: params.artifactPath,
      artifactHash: params.artifactHash,
      baseModelId: 'base-root',
      baseModelVersion: 'v1.0.0',
      baseModelArtifactHash: params.baseModelArtifactHash || 'sha256-base-hash',
      datasetVersion: 'v3.1.0-ds-provenance',
      datasetManifestHash: 'manifest-hash-provenance',
      trainingJobId: params.trainingJobId || null,
      trainingExecutionResultId: params.trainingExecutionResultId || null,
      rootModelImportRecordId: params.rootModelImportRecordId || null,
      eligibilityEvaluationId: params.eligibilityEvaluationId || null,
      goldenEvaluationId: params.goldenEvaluationId || null,
      artifactValidationReportId: params.artifactValidationReportId || null,
      metrics: params.metrics || {},
      promotionEligible: false,
      actualTrainingPerformed: lineageCheck.lineageType === 'TRAINED',
      actualEvaluationPerformed: true,
      approvedByUserId: new mongoose.Types.ObjectId(params.createdByUserId)
    });

    return modelRecord;
  }
}

export const modelRegistryAdmissionService = new ModelRegistryAdmissionService();
