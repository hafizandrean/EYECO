"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rootModelImportService = exports.RootModelImportService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const RootModelImportRecord_1 = require("../../../database/models/RootModelImportRecord");
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
class RootModelImportService {
    async createRootModelImportRecord(params) {
        const importRecordId = params.importRecordId || `root-import-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
        const frameworkVersion = params.frameworkVersion || 'ultralytics-v8.0.0';
        const modelTask = params.modelTask || 'detect';
        const approvalPolicyVersion = params.approvalPolicyVersion || 'v1.0.0';
        const validatorScriptPath = params.validatorScriptPath || path_1.default.join(process.cwd(), 'scripts', 'validate_yolo_artifact.py');
        if (!fs_1.default.existsSync(validatorScriptPath)) {
            const err = new Error(`ROOT_IMPORT_VALIDATOR_SCRIPT_NOT_FOUND: Validator script not found on disk at ${validatorScriptPath}.`);
            err.status = 422;
            throw err;
        }
        const validatorScriptHash = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(validatorScriptPath)).digest('hex');
        const serviceModulePath = __filename;
        const importServiceModuleHash = fs_1.default.existsSync(serviceModulePath)
            ? crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(serviceModulePath)).digest('hex')
            : crypto_1.default.createHash('sha256').update('root-model-import-service-v1').digest('hex');
        const runtimeEnvironmentHash = crypto_1.default.createHash('sha256').update(`node-${process.version}-${process.platform}`).digest('hex');
        const normArtifactPath = (0, MlExecutionContext_1.toRelativePosixPath)(params.artifactPath);
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
        const resultHash = crypto_1.default.createHash('sha256').update(canonicalJSON(canonicalPayload)).digest('hex');
        const doc = await RootModelImportRecord_1.RootModelImportRecordModel.create({
            importRecordId,
            modelType: params.modelType,
            environment: params.environment,
            artifactPath: params.artifactPath,
            artifactHash: params.artifactHash,
            artifactValidationReportId: new mongoose_1.default.Types.ObjectId(String(params.artifactValidationReportId)),
            sourceType: params.sourceType,
            sourceReference: params.sourceReference,
            sourceArtifactHash: params.sourceArtifactHash,
            classMappingHash: params.classMappingHash,
            frameworkVersion,
            modelTask,
            importedByUserId: new mongoose_1.default.Types.ObjectId(String(params.importedByUserId)),
            approvedByUserId: new mongoose_1.default.Types.ObjectId(String(params.approvedByUserId)),
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
exports.RootModelImportService = RootModelImportService;
exports.rootModelImportService = new RootModelImportService();
