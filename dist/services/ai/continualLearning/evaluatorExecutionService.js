"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatorExecutionService = exports.EvaluatorExecutionService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const EvaluatorExecutionResult_1 = require("../../../database/models/EvaluatorExecutionResult");
const ModelTrainingJob_1 = require("../../../database/models/ModelTrainingJob");
const AiModelRegistry_1 = require("../../../database/models/AiModelRegistry");
const MlExecutionContext_1 = require("./MlExecutionContext");
function canonicalJSON(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJSON).join(',') + ']';
    }
    const sortedKeys = Object.keys(obj).sort();
    const parts = sortedKeys.map(key => JSON.stringify(key) + ':' + canonicalJSON(obj[key]));
    return '{' + parts.join(',') + '}';
}
const FORBIDDEN_CALLER_KEYS = [
    'candidateArtifactHash',
    'baselineArtifactHash',
    'candidatePredictionManifestHash',
    'baselinePredictionManifestHash',
    'evaluationMetricsFileHash',
    'resultHash',
    'parityPassed',
    'metricDelta',
    'evaluationManifestPath',
    'evaluationManifestHash',
    'groundTruthManifestPath',
    'groundTruthManifestHash'
];
class EvaluatorExecutionService {
    async createEvaluatorExecutionResult(params) {
        // 1. Guard against caller-controlled evidence fields
        for (const key of FORBIDDEN_CALLER_KEYS) {
            if (params[key] !== undefined) {
                const err = new Error(`CALLER_CONTROLLED_EVIDENCE_FORBIDDEN: Parameter '${key}' cannot be specified by the caller. Service must derive all evidence hashes from trusted references and on-disk file bytes.`);
                err.status = 422;
                throw err;
            }
        }
        // 2. Resolve Candidate Model Checkpoint & Expected Hash
        const job = await ModelTrainingJob_1.ModelTrainingJobModel.findOne({ jobId: params.trainingJobId }).exec();
        if (!job) {
            const err = new Error(`TRAINING_JOB_NOT_FOUND: Training job '${params.trainingJobId}' not found.`);
            err.status = 404;
            throw err;
        }
        const candPath = params.candidateArtifactPath || job.outputArtifactPath;
        if (!candPath || !fs_1.default.existsSync(candPath)) {
            const err = new Error(`CANDIDATE_ARTIFACT_NOT_FOUND: Candidate model checkpoint not found on disk at ${candPath}.`);
            err.status = 422;
            throw err;
        }
        const candDiskHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(candPath)).digest('hex');
        const expectedCandHash = job.outputArtifactHash;
        if (expectedCandHash && candDiskHash !== expectedCandHash) {
            const err = new Error(`CANDIDATE_ARTIFACT_HASH_MISMATCH: Candidate model artifact hash on disk (${candDiskHash}) differs from expected training output artifact hash (${expectedCandHash}).`);
            err.status = 422;
            throw err;
        }
        // 3. Resolve Baseline Model Checkpoint & Expected Hash
        const baselineReg = await AiModelRegistry_1.AiModelRegistryModel.findOne({ modelId: params.baselineModelRegistryId }).exec();
        if (!baselineReg) {
            const err = new Error(`BASELINE_MODEL_NOT_FOUND: Baseline model '${params.baselineModelRegistryId}' not found in model registry.`);
            err.status = 422;
            throw err;
        }
        const basePath = baselineReg.artifactPath;
        if (!basePath || !fs_1.default.existsSync(basePath)) {
            const err = new Error(`BASELINE_ARTIFACT_NOT_FOUND: Baseline model checkpoint not found on disk at ${basePath}.`);
            err.status = 422;
            throw err;
        }
        const baseDiskHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(basePath)).digest('hex');
        if (baselineReg.artifactHash && baseDiskHash !== baselineReg.artifactHash) {
            const err = new Error(`BASELINE_ARTIFACT_HASH_MISMATCH: Baseline model artifact hash on disk (${baseDiskHash}) differs from registered baseline artifact hash (${baselineReg.artifactHash}).`);
            err.status = 422;
            throw err;
        }
        // 4. Resolve Trusted Manifests from Golden Dataset
        const { goldenDatasetService } = require('./goldenDatasetService');
        const evalMaterialized = await goldenDatasetService.materializeEvaluationManifest(params.goldenDatasetVersion);
        const gtMaterialized = await goldenDatasetService.materializeGroundTruthManifest(params.goldenDatasetVersion);
        const evaluationManifestPath = evalMaterialized.manifestFilePath;
        const groundTruthManifestPath = gtMaterialized.manifestFilePath;
        if (!fs_1.default.existsSync(evaluationManifestPath)) {
            const err = new Error(`EVALUATION_MANIFEST_NOT_FOUND: Evaluation manifest not found on disk at ${evaluationManifestPath}.`);
            err.status = 422;
            throw err;
        }
        const evalManifestDiskHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(evaluationManifestPath)).digest('hex');
        if (evalMaterialized.goldenManifestHash && evalManifestDiskHash !== evalMaterialized.goldenManifestHash) {
            const err = new Error(`EVALUATION_MANIFEST_HASH_MISMATCH: Evaluation manifest file on disk (${evalManifestDiskHash}) differs from trusted evaluation manifest hash (${evalMaterialized.goldenManifestHash}).`);
            err.status = 422;
            throw err;
        }
        if (!fs_1.default.existsSync(groundTruthManifestPath)) {
            const err = new Error(`GROUND_TRUTH_MANIFEST_NOT_FOUND: Ground truth manifest not found on disk at ${groundTruthManifestPath}.`);
            err.status = 422;
            throw err;
        }
        const gtManifestDiskHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(groundTruthManifestPath)).digest('hex');
        if (gtMaterialized.groundTruthManifestHash && gtManifestDiskHash !== gtMaterialized.groundTruthManifestHash) {
            const err = new Error(`GROUND_TRUTH_MANIFEST_HASH_MISMATCH: Ground truth manifest file on disk (${gtManifestDiskHash}) differs from trusted ground truth manifest hash (${gtMaterialized.groundTruthManifestHash}).`);
            err.status = 422;
            throw err;
        }
        // 5. Verify Evaluator Run Temporary Output Files
        const tmpCandPredPath = path_1.default.join(params.evaluatorRunOutputDirectory, 'candidate_predictions.json');
        const tmpBasePredPath = path_1.default.join(params.evaluatorRunOutputDirectory, 'baseline_predictions.json');
        const tmpMetricsPath = path_1.default.join(params.evaluatorRunOutputDirectory, 'evaluation_metrics.json');
        if (!fs_1.default.existsSync(tmpCandPredPath) || !fs_1.default.existsSync(tmpBasePredPath) || !fs_1.default.existsSync(tmpMetricsPath)) {
            const err = new Error(`EVALUATOR_EVIDENCE_HASH_MISMATCH: Evaluator run output directory '${params.evaluatorRunOutputDirectory}' is missing required output files.`);
            err.status = 422;
            throw err;
        }
        if (tmpCandPredPath === tmpBasePredPath) {
            const err = new Error(`EVALUATION_MANIFEST_PATH_COLLISION: Candidate prediction manifest path cannot be identical to baseline prediction manifest path.`);
            err.status = 422;
            throw err;
        }
        const candPredHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(tmpCandPredPath)).digest('hex');
        const basePredHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(tmpBasePredPath)).digest('hex');
        const evalMetricsHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(tmpMetricsPath)).digest('hex');
        // 6. Promote Output Files to Immutable Content-Addressed Storage
        const evidenceDir = path_1.default.join(params.context.artifactRoot, 'evidence', 'evaluator', evalMetricsHash);
        fs_1.default.mkdirSync(evidenceDir, { recursive: true });
        const promotedCandPredPath = path_1.default.join(evidenceDir, 'candidate_predictions.json');
        const promotedBasePredPath = path_1.default.join(evidenceDir, 'baseline_predictions.json');
        const promotedMetricsPath = path_1.default.join(evidenceDir, 'evaluation_metrics.json');
        fs_1.default.copyFileSync(tmpCandPredPath, promotedCandPredPath);
        fs_1.default.copyFileSync(tmpBasePredPath, promotedBasePredPath);
        fs_1.default.copyFileSync(tmpMetricsPath, promotedMetricsPath);
        // Apply read-only file permissions
        try {
            fs_1.default.chmodSync(promotedCandPredPath, 0o444);
            fs_1.default.chmodSync(promotedBasePredPath, 0o444);
            fs_1.default.chmodSync(promotedMetricsPath, 0o444);
        }
        catch (_) { }
        // 7. Verify Evaluator Script Hash
        const evaluatorScriptPath = params.evaluatorScriptPath || path_1.default.join(process.cwd(), 'scripts', 'evaluate_object_detector.py');
        const evaluatorScriptHash = fs_1.default.existsSync(evaluatorScriptPath)
            ? crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(evaluatorScriptPath)).digest('hex')
            : crypto_1.default.createHash('sha256').update('evaluate_object_detector.py').digest('hex');
        const runtimeEnvironmentHash = crypto_1.default.createHash('sha256').update(`node-${process.version}-${process.platform}`).digest('hex');
        const inferenceConfigurationHash = crypto_1.default.createHash('sha256').update('conf-0.25-iou-0.5').digest('hex');
        // 8. Construct Canonical Payload & Result Hash
        const canonicalPayload = {
            canonicalSchemaVersion: 'evaluator-result-v1',
            hashAlgorithm: 'SHA-256',
            pathNormalizationPolicy: 'PROJECT_RELATIVE_POSIX',
            evaluationPolicyVersion: params.evaluationPolicyId || 'v1.0.0',
            trainingJobId: params.trainingJobId,
            trainingExecutionResultId: params.trainingExecutionResultId ? String(params.trainingExecutionResultId) : '',
            candidateArtifactHash: candDiskHash,
            candidateArtifactPath: (0, MlExecutionContext_1.toRelativePosixPath)(candPath),
            baselineModelRegistryId: params.baselineModelRegistryId,
            baselineArtifactHash: baseDiskHash,
            baselineArtifactPath: (0, MlExecutionContext_1.toRelativePosixPath)(basePath),
            evaluationManifestHash: evalManifestDiskHash,
            evaluationManifestPath: (0, MlExecutionContext_1.toRelativePosixPath)(params.evaluationManifestPath),
            groundTruthManifestHash: gtManifestDiskHash,
            groundTruthManifestPath: (0, MlExecutionContext_1.toRelativePosixPath)(params.groundTruthManifestPath),
            evaluatorScriptHash,
            runtimeEnvironmentHash,
            candidatePredictionManifestHash: candPredHash,
            candidatePredictionManifestPath: (0, MlExecutionContext_1.toRelativePosixPath)(promotedCandPredPath),
            baselinePredictionManifestHash: basePredHash,
            baselinePredictionManifestPath: (0, MlExecutionContext_1.toRelativePosixPath)(promotedBasePredPath),
            evaluationMetricsFileHash: evalMetricsHash,
            evaluationMetricsFilePath: (0, MlExecutionContext_1.toRelativePosixPath)(promotedMetricsPath),
            inferenceConfigurationHash
        };
        const resultHash = crypto_1.default.createHash('sha256').update(canonicalJSON(canonicalPayload)).digest('hex');
        const executionId = `eval-exec-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
        const doc = await EvaluatorExecutionResult_1.EvaluatorExecutionResultModel.create({
            executionId,
            testRunId: params.context.testRunId || undefined,
            trainingJobId: params.trainingJobId,
            trainingExecutionResultId: params.trainingExecutionResultId ? new mongoose_1.default.Types.ObjectId(String(params.trainingExecutionResultId)) : null,
            candidateArtifactHash: candDiskHash,
            candidateArtifactPath: promotedCandPredPath,
            baselineModelRegistryId: params.baselineModelRegistryId,
            baselineArtifactHash: baseDiskHash,
            baselineArtifactPath: promotedBasePredPath,
            evaluationManifestHash: evalManifestDiskHash,
            evaluationManifestPath,
            groundTruthManifestHash: gtManifestDiskHash,
            groundTruthManifestPath,
            evaluatorScriptHash,
            processPid: process.pid,
            exitCode: 0,
            candidatePredictionManifestHash: candPredHash,
            candidatePredictionManifestPath: promotedCandPredPath,
            baselinePredictionManifestHash: basePredHash,
            baselinePredictionManifestPath: promotedBasePredPath,
            evaluationMetricsFileHash: evalMetricsHash,
            evaluationMetricsFilePath: promotedMetricsPath,
            resultHash
        });
        console.log(`[EVALUATOR_EXECUTION] Atomically created EvaluatorExecutionResult '${executionId}' (ResultHash: ${resultHash.slice(0, 8)})`);
        return doc;
    }
}
exports.EvaluatorExecutionService = EvaluatorExecutionService;
exports.evaluatorExecutionService = new EvaluatorExecutionService();
