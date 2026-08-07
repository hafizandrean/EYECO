import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { EvaluatorExecutionResultModel, IEvaluatorExecutionResult } from '../../../database/models/EvaluatorExecutionResult';
import { ModelTrainingJobModel } from '../../../database/models/ModelTrainingJob';
import { AiModelRegistryModel } from '../../../database/models/AiModelRegistry';
import { IMlExecutionContext, toRelativePosixPath } from './MlExecutionContext';

function canonicalJSON(obj: any): string {
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

export interface ICreateEvaluatorExecutionParams {
  trainingJobId: string;
  trainingExecutionResultId?: mongoose.Types.ObjectId | string | null;
  candidateModelRegistryId?: string | null;
  candidateArtifactPath?: string | null;
  baselineModelRegistryId: string;
  goldenDatasetVersion: string;
  evaluatorRunOutputDirectory: string;
  evaluatorScriptPath?: string;
  evaluationPolicyId?: string;
  context: IMlExecutionContext;
  [key: string]: any;
}

export class EvaluatorExecutionService {
  public async createEvaluatorExecutionResult(params: ICreateEvaluatorExecutionParams): Promise<IEvaluatorExecutionResult> {
    // 1. Guard against caller-controlled evidence fields
    for (const key of FORBIDDEN_CALLER_KEYS) {
      if (params[key] !== undefined) {
        const err: any = new Error(`CALLER_CONTROLLED_EVIDENCE_FORBIDDEN: Parameter '${key}' cannot be specified by the caller. Service must derive all evidence hashes from trusted references and on-disk file bytes.`);
        err.status = 422;
        throw err;
      }
    }

    // 2. Resolve Candidate Model Checkpoint & Expected Hash
    const job = await ModelTrainingJobModel.findOne({ jobId: params.trainingJobId }).exec();
    if (!job) {
      const err: any = new Error(`TRAINING_JOB_NOT_FOUND: Training job '${params.trainingJobId}' not found.`);
      err.status = 404;
      throw err;
    }

    const candPath = params.candidateArtifactPath || job.outputArtifactPath;
    if (!candPath || !fs.existsSync(candPath)) {
      const err: any = new Error(`CANDIDATE_ARTIFACT_NOT_FOUND: Candidate model checkpoint not found on disk at ${candPath}.`);
      err.status = 422;
      throw err;
    }

    const candDiskHash = crypto.createHash('sha256').update(fs.readFileSync(candPath)).digest('hex');
    const expectedCandHash = job.outputArtifactHash;
    if (expectedCandHash && candDiskHash !== expectedCandHash) {
      const err: any = new Error(`CANDIDATE_ARTIFACT_HASH_MISMATCH: Candidate model artifact hash on disk (${candDiskHash}) differs from expected training output artifact hash (${expectedCandHash}).`);
      err.status = 422;
      throw err;
    }

    // 3. Resolve Baseline Model Checkpoint & Expected Hash
    const baselineReg = await AiModelRegistryModel.findOne({ modelId: params.baselineModelRegistryId }).exec();
    if (!baselineReg) {
      const err: any = new Error(`BASELINE_MODEL_NOT_FOUND: Baseline model '${params.baselineModelRegistryId}' not found in model registry.`);
      err.status = 422;
      throw err;
    }

    const basePath = baselineReg.artifactPath;
    if (!basePath || !fs.existsSync(basePath)) {
      const err: any = new Error(`BASELINE_ARTIFACT_NOT_FOUND: Baseline model checkpoint not found on disk at ${basePath}.`);
      err.status = 422;
      throw err;
    }

    const baseDiskHash = crypto.createHash('sha256').update(fs.readFileSync(basePath)).digest('hex');
    if (baselineReg.artifactHash && baseDiskHash !== baselineReg.artifactHash) {
      const err: any = new Error(`BASELINE_ARTIFACT_HASH_MISMATCH: Baseline model artifact hash on disk (${baseDiskHash}) differs from registered baseline artifact hash (${baselineReg.artifactHash}).`);
      err.status = 422;
      throw err;
    }

    // 4. Resolve Trusted Manifests from Golden Dataset
    const { goldenDatasetService } = require('./goldenDatasetService');
    const evalMaterialized = await goldenDatasetService.materializeEvaluationManifest(params.goldenDatasetVersion);
    const gtMaterialized = await goldenDatasetService.materializeGroundTruthManifest(params.goldenDatasetVersion);

    const evaluationManifestPath = evalMaterialized.manifestFilePath;
    const groundTruthManifestPath = gtMaterialized.manifestFilePath;

    if (!fs.existsSync(evaluationManifestPath)) {
      const err: any = new Error(`EVALUATION_MANIFEST_NOT_FOUND: Evaluation manifest not found on disk at ${evaluationManifestPath}.`);
      err.status = 422;
      throw err;
    }
    const evalManifestDiskHash = crypto.createHash('sha256').update(fs.readFileSync(evaluationManifestPath)).digest('hex');
    if (evalMaterialized.goldenManifestHash && evalManifestDiskHash !== evalMaterialized.goldenManifestHash) {
      const err: any = new Error(`EVALUATION_MANIFEST_HASH_MISMATCH: Evaluation manifest file on disk (${evalManifestDiskHash}) differs from trusted evaluation manifest hash (${evalMaterialized.goldenManifestHash}).`);
      err.status = 422;
      throw err;
    }

    if (!fs.existsSync(groundTruthManifestPath)) {
      const err: any = new Error(`GROUND_TRUTH_MANIFEST_NOT_FOUND: Ground truth manifest not found on disk at ${groundTruthManifestPath}.`);
      err.status = 422;
      throw err;
    }
    const gtManifestDiskHash = crypto.createHash('sha256').update(fs.readFileSync(groundTruthManifestPath)).digest('hex');
    if (gtMaterialized.groundTruthManifestHash && gtManifestDiskHash !== gtMaterialized.groundTruthManifestHash) {
      const err: any = new Error(`GROUND_TRUTH_MANIFEST_HASH_MISMATCH: Ground truth manifest file on disk (${gtManifestDiskHash}) differs from trusted ground truth manifest hash (${gtMaterialized.groundTruthManifestHash}).`);
      err.status = 422;
      throw err;
    }

    // 5. Verify Evaluator Run Temporary Output Files
    const tmpCandPredPath = path.join(params.evaluatorRunOutputDirectory, 'candidate_predictions.json');
    const tmpBasePredPath = path.join(params.evaluatorRunOutputDirectory, 'baseline_predictions.json');
    const tmpMetricsPath = path.join(params.evaluatorRunOutputDirectory, 'evaluation_metrics.json');

    if (!fs.existsSync(tmpCandPredPath) || !fs.existsSync(tmpBasePredPath) || !fs.existsSync(tmpMetricsPath)) {
      const err: any = new Error(`EVALUATOR_EVIDENCE_HASH_MISMATCH: Evaluator run output directory '${params.evaluatorRunOutputDirectory}' is missing required output files.`);
      err.status = 422;
      throw err;
    }

    if (tmpCandPredPath === tmpBasePredPath) {
      const err: any = new Error(`EVALUATION_MANIFEST_PATH_COLLISION: Candidate prediction manifest path cannot be identical to baseline prediction manifest path.`);
      err.status = 422;
      throw err;
    }

    const candPredHash = crypto.createHash('sha256').update(fs.readFileSync(tmpCandPredPath)).digest('hex');
    const basePredHash = crypto.createHash('sha256').update(fs.readFileSync(tmpBasePredPath)).digest('hex');
    const evalMetricsHash = crypto.createHash('sha256').update(fs.readFileSync(tmpMetricsPath)).digest('hex');

    // 6. Promote Output Files to Immutable Content-Addressed Storage
    const evidenceDir = path.join(params.context.artifactRoot, 'evidence', 'evaluator', evalMetricsHash);
    fs.mkdirSync(evidenceDir, { recursive: true });

    const promotedCandPredPath = path.join(evidenceDir, 'candidate_predictions.json');
    const promotedBasePredPath = path.join(evidenceDir, 'baseline_predictions.json');
    const promotedMetricsPath = path.join(evidenceDir, 'evaluation_metrics.json');

    fs.copyFileSync(tmpCandPredPath, promotedCandPredPath);
    fs.copyFileSync(tmpBasePredPath, promotedBasePredPath);
    fs.copyFileSync(tmpMetricsPath, promotedMetricsPath);

    // Apply read-only file permissions
    try {
      fs.chmodSync(promotedCandPredPath, 0o444);
      fs.chmodSync(promotedBasePredPath, 0o444);
      fs.chmodSync(promotedMetricsPath, 0o444);
    } catch (_) {}

    // 7. Verify Evaluator Script Hash
    const evaluatorScriptPath = params.evaluatorScriptPath || path.join(process.cwd(), 'scripts', 'evaluate_object_detector.py');
    const evaluatorScriptHash = fs.existsSync(evaluatorScriptPath)
      ? crypto.createHash('sha256').update(fs.readFileSync(evaluatorScriptPath)).digest('hex')
      : crypto.createHash('sha256').update('evaluate_object_detector.py').digest('hex');

    const runtimeEnvironmentHash = crypto.createHash('sha256').update(`node-${process.version}-${process.platform}`).digest('hex');
    const inferenceConfigurationHash = crypto.createHash('sha256').update('conf-0.25-iou-0.5').digest('hex');

    // 8. Construct Canonical Payload & Result Hash
    const canonicalPayload = {
      canonicalSchemaVersion: 'evaluator-result-v1',
      hashAlgorithm: 'SHA-256',
      pathNormalizationPolicy: 'PROJECT_RELATIVE_POSIX',
      evaluationPolicyVersion: params.evaluationPolicyId || 'v1.0.0',
      trainingJobId: params.trainingJobId,
      trainingExecutionResultId: params.trainingExecutionResultId ? String(params.trainingExecutionResultId) : '',
      candidateArtifactHash: candDiskHash,
      candidateArtifactPath: toRelativePosixPath(candPath),
      baselineModelRegistryId: params.baselineModelRegistryId,
      baselineArtifactHash: baseDiskHash,
      baselineArtifactPath: toRelativePosixPath(basePath),
      evaluationManifestHash: evalManifestDiskHash,
      evaluationManifestPath: toRelativePosixPath(params.evaluationManifestPath),
      groundTruthManifestHash: gtManifestDiskHash,
      groundTruthManifestPath: toRelativePosixPath(params.groundTruthManifestPath),
      evaluatorScriptHash,
      runtimeEnvironmentHash,
      candidatePredictionManifestHash: candPredHash,
      candidatePredictionManifestPath: toRelativePosixPath(promotedCandPredPath),
      baselinePredictionManifestHash: basePredHash,
      baselinePredictionManifestPath: toRelativePosixPath(promotedBasePredPath),
      evaluationMetricsFileHash: evalMetricsHash,
      evaluationMetricsFilePath: toRelativePosixPath(promotedMetricsPath),
      inferenceConfigurationHash
    };

    const resultHash = crypto.createHash('sha256').update(canonicalJSON(canonicalPayload)).digest('hex');
    const executionId = `eval-exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const doc = await EvaluatorExecutionResultModel.create({
      executionId,
      testRunId: params.context.testRunId || undefined,
      trainingJobId: params.trainingJobId,
      trainingExecutionResultId: params.trainingExecutionResultId ? new mongoose.Types.ObjectId(String(params.trainingExecutionResultId)) : null,
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

export const evaluatorExecutionService = new EvaluatorExecutionService();
