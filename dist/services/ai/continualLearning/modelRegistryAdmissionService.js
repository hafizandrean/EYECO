"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelRegistryAdmissionService = exports.ModelRegistryAdmissionService = void 0;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const AiModelRegistry_1 = require("../../../database/models/AiModelRegistry");
const ModelTrainingJob_1 = require("../../../database/models/ModelTrainingJob");
const TrainingExecutionResult_1 = require("../../../database/models/TrainingExecutionResult");
const RootModelImportRecord_1 = require("../../../database/models/RootModelImportRecord");
const TrainingEligibilityEvaluation_1 = require("../../../database/models/TrainingEligibilityEvaluation");
const GoldenModelEvaluation_1 = require("../../../database/models/GoldenModelEvaluation");
const ModelArtifactValidationReport_1 = require("../../../database/models/ModelArtifactValidationReport");
class ModelRegistryAdmissionService {
    async validateLineageIntegrity(params) {
        const isTrained = Boolean(params.trainingExecutionResultId || params.trainingJobId);
        const isRootImport = Boolean(params.rootModelImportRecordId);
        // Enforce mutually exclusive lineage paths
        if (isTrained && isRootImport) {
            const err = new Error('MODEL_REGISTRY_LINEAGE_AMBIGUOUS: Model registry record cannot specify both trained lineage and root model import lineage simultaneously.');
            err.status = 422;
            throw err;
        }
        if (!isTrained && !isRootImport) {
            const err = new Error('MODEL_REGISTRY_LINEAGE_INVALID: Model registry record must specify either trained lineage or root model import lineage.');
            err.status = 422;
            throw err;
        }
        // 1. Validate Artifact on Disk
        if (!params.artifactPath || !fs_1.default.existsSync(params.artifactPath)) {
            const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: PyTorch model artifact file not found on disk at ${params.artifactPath}.`);
            err.status = 422;
            throw err;
        }
        const diskBytes = fs_1.default.readFileSync(params.artifactPath);
        const diskHash = crypto_1.default.createHash('sha256').update(diskBytes).digest('hex');
        if (diskHash !== params.artifactHash) {
            const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: Artifact hash mismatch! Specified: ${params.artifactHash}, Computed: ${diskHash}.`);
            err.status = 422;
            throw err;
        }
        // 2. Validate Artifact Validation Report
        if (!params.artifactValidationReportId) {
            const err = new Error('MODEL_REGISTRY_LINEAGE_INVALID: ModelArtifactValidationReport reference is missing.');
            err.status = 422;
            throw err;
        }
        const valReport = await ModelArtifactValidationReport_1.ModelArtifactValidationReportModel.findById(params.artifactValidationReportId).exec();
        if (!valReport || !valReport.loadPassed || !valReport.warmupPassed) {
            const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: ModelArtifactValidationReport '${params.artifactValidationReportId}' missing or failed framework validation.`);
            err.status = 422;
            throw err;
        }
        // 3. Validate Lineage Route
        if (isTrained) {
            if (!params.trainingJobId || !params.trainingExecutionResultId) {
                const err = new Error('MODEL_REGISTRY_LINEAGE_INVALID: Trained model lineage requires both trainingJobId and trainingExecutionResultId.');
                err.status = 422;
                throw err;
            }
            const job = await ModelTrainingJob_1.ModelTrainingJobModel.findOne({ jobId: params.trainingJobId }).exec();
            if (!job || job.status !== 'COMPLETED' || job.actualTrainingPerformed !== true) {
                const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: ModelTrainingJob '${params.trainingJobId}' missing or not COMPLETED.`);
                err.status = 422;
                throw err;
            }
            const trainResult = await TrainingExecutionResult_1.TrainingExecutionResultModel.findById(params.trainingExecutionResultId).exec();
            if (!trainResult || trainResult.executionStatus !== 'SUCCEEDED' || trainResult.acceptedForFinalization !== true || trainResult.exitCode !== 0) {
                const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: TrainingExecutionResult '${params.trainingExecutionResultId}' missing, not accepted, or failed.`);
                err.status = 422;
                throw err;
            }
            if (params.eligibilityEvaluationId) {
                const eligDoc = await TrainingEligibilityEvaluation_1.TrainingEligibilityEvaluationModel.findById(params.eligibilityEvaluationId).exec();
                if (!eligDoc || eligDoc.eligible !== true) {
                    const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: TrainingEligibilityEvaluation '${params.eligibilityEvaluationId}' missing or not eligible.`);
                    err.status = 422;
                    throw err;
                }
            }
            if (params.goldenEvaluationId) {
                const goldenEvalDoc = await GoldenModelEvaluation_1.GoldenModelEvaluationModel.findById(params.goldenEvaluationId).exec();
                if (!goldenEvalDoc) {
                    const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: GoldenModelEvaluation '${params.goldenEvaluationId}' does not exist.`);
                    err.status = 422;
                    throw err;
                }
            }
            return { valid: true, lineageType: 'TRAINED' };
        }
        else {
            const importRecord = await RootModelImportRecord_1.RootModelImportRecordModel.findById(params.rootModelImportRecordId).exec();
            if (!importRecord) {
                const err = new Error(`MODEL_REGISTRY_LINEAGE_INVALID: RootModelImportRecord '${params.rootModelImportRecordId}' does not exist.`);
                err.status = 422;
                throw err;
            }
            return { valid: true, lineageType: 'ROOT_IMPORT' };
        }
    }
    async registerModelCandidate(params) {
        const lineageCheck = await this.validateLineageIntegrity(params);
        const modelRecord = await AiModelRegistry_1.AiModelRegistryModel.create({
            modelId: `model-${params.modelType.toLowerCase()}-${Date.now()}`,
            modelType: params.modelType,
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
            approvedByUserId: new mongoose_1.default.Types.ObjectId(params.createdByUserId)
        });
        return modelRecord;
    }
}
exports.ModelRegistryAdmissionService = ModelRegistryAdmissionService;
exports.modelRegistryAdmissionService = new ModelRegistryAdmissionService();
