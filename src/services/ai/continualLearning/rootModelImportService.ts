import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { RootModelImportRecordModel, IRootModelImportRecord } from '../../../database/models/RootModelImportRecord';
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

export interface ICreateRootModelImportParams {
  importRecordId?: string;
  modelType: string;
  environment: 'STAGING' | 'PRODUCTION';
  artifactPath: string;
  artifactHash: string;
  artifactValidationReportId: mongoose.Types.ObjectId | string;
  sourceType: 'LOCAL_APPROVED_IMPORT' | 'VENDOR_BASE_MODEL';
  sourceReference?: string;
  sourceArtifactHash: string;
  classMappingHash: string;
  frameworkVersion?: string;
  modelTask?: string;
  importedByUserId: mongoose.Types.ObjectId | string;
  approvedByUserId: mongoose.Types.ObjectId | string;
  approvalReason: string;
  approvalPolicyVersion?: string;
  validatorScriptPath?: string;
  context: IMlExecutionContext;
}

export class RootModelImportService {
  public async createRootModelImportRecord(params: ICreateRootModelImportParams): Promise<IRootModelImportRecord> {
    const importRecordId = params.importRecordId || `root-import-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const frameworkVersion = params.frameworkVersion || 'ultralytics-v8.0.0';
    const modelTask = params.modelTask || 'detect';
    const approvalPolicyVersion = params.approvalPolicyVersion || 'v1.0.0';

    const validatorScriptPath = params.validatorScriptPath || path.join(process.cwd(), 'scripts', 'validate_yolo_artifact.py');
    if (!fs.existsSync(validatorScriptPath)) {
      const err: any = new Error(`ROOT_IMPORT_VALIDATOR_SCRIPT_NOT_FOUND: Validator script not found on disk at ${validatorScriptPath}.`);
      err.status = 422;
      throw err;
    }
    const validatorScriptHash = crypto.createHash('sha256').update(fs.readFileSync(validatorScriptPath)).digest('hex');

    const serviceModulePath = __filename;
    const importServiceModuleHash = fs.existsSync(serviceModulePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(serviceModulePath)).digest('hex')
      : crypto.createHash('sha256').update('root-model-import-service-v1').digest('hex');

    const runtimeEnvironmentHash = crypto.createHash('sha256').update(`node-${process.version}-${process.platform}`).digest('hex');

    const normArtifactPath = toRelativePosixPath(params.artifactPath);

    const canonicalPayload = {
      canonicalSchemaVersion: 'root-model-import-v1',
      hashAlgorithm: 'SHA-256',
      pathNormalizationPolicy: 'PROJECT_RELATIVE_POSIX',
      importRecordId,
      modelType: params.modelType,
      environment: params.environment,
      artifactPath: normArtifactPath,
      artifactHash: params.artifactHash,
      artifactValidationReportId: String(params.artifactValidationReportId),
      sourceType: params.sourceType,
      sourceReference: params.sourceReference || '',
      sourceArtifactHash: params.sourceArtifactHash,
      classMappingHash: params.classMappingHash,
      frameworkVersion,
      modelTask,
      importedByUserId: String(params.importedByUserId),
      approvedByUserId: String(params.approvedByUserId),
      approvalReason: params.approvalReason,
      approvalPolicyVersion,
      importMechanism: 'SERVICE_DIRECT_IMPORT',
      importServiceModuleHash,
      validatorScriptHash,
      runtimeEnvironmentHash
    };

    const resultHash = crypto.createHash('sha256').update(canonicalJSON(canonicalPayload)).digest('hex');

    const doc = await RootModelImportRecordModel.create({
      importRecordId,
      modelType: params.modelType,
      environment: params.environment,
      artifactPath: params.artifactPath,
      artifactHash: params.artifactHash,
      artifactValidationReportId: new mongoose.Types.ObjectId(String(params.artifactValidationReportId)),
      sourceType: params.sourceType,
      sourceReference: params.sourceReference,
      sourceArtifactHash: params.sourceArtifactHash,
      classMappingHash: params.classMappingHash,
      frameworkVersion,
      modelTask,
      importedByUserId: new mongoose.Types.ObjectId(String(params.importedByUserId)),
      approvedByUserId: new mongoose.Types.ObjectId(String(params.approvedByUserId)),
      approvalReason: params.approvalReason,
      approvalPolicyVersion,
      importScriptHash: validatorScriptHash, // Backwards compatibility for schema
      runtimeEnvironmentHash,
      resultHash
    });

    console.log(`[ROOT_MODEL_IMPORT] Created RootModelImportRecord ${importRecordId} (ResultHash: ${resultHash.slice(0, 8)})`);
    return doc;
  }
}

export const rootModelImportService = new RootModelImportService();
