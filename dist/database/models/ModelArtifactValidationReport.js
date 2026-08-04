"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelArtifactValidationReportModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ModelArtifactValidationReportSchema = new mongoose_1.Schema({
    validationReportId: { type: String, required: true, unique: true, index: true },
    modelType: { type: String, required: true },
    environment: { type: String, enum: ['STAGING', 'PRODUCTION'], required: true },
    artifactPath: { type: String, required: true, index: true },
    requestedArtifactHash: { type: String, required: true },
    loadedArtifactHash: { type: String, required: true, index: true },
    artifactSize: { type: Number, required: true },
    framework: { type: String, enum: ['ULTRALYTICS'], required: true, default: 'ULTRALYTICS' },
    frameworkVersion: { type: String, required: true, default: '8.0.0' },
    torchVersion: { type: String, required: true, default: '2.0.0' },
    pythonVersion: { type: String, required: true, default: '3.10.0' },
    loadPassed: { type: Boolean, required: true },
    warmupPassed: { type: Boolean, required: true },
    task: { type: String, required: true, default: 'detect' },
    classNames: { type: [String], required: true },
    classMappingHash: { type: String, required: true },
    parameterCount: { type: Number, required: true },
    stateDictKeysHash: { type: String, required: true },
    outputSchemaPassed: { type: Boolean, required: true },
    validatorScriptHash: { type: String, required: true },
    validatorRuntimeHash: { type: String, required: true },
    processPid: { type: Number, required: true },
    exitCode: { type: Number, required: true },
    stdoutHash: { type: String, required: true },
    stderrHash: { type: String, required: true },
    resultHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    err.status = 422;
    if (typeof next === 'function') {
        return next(err);
    }
    throw err;
}
ModelArtifactValidationReportSchema.pre('save', function (next) {
    if (!this.isNew) {
        return blockMutation('MODEL_ARTIFACT_VALIDATION_REPORT_IMMUTABLE: ModelArtifactValidationReport documents are strictly append-only. Modification and deletion are REJECTED.', next);
    }
    if (typeof next === 'function')
        next();
});
const queryBlocker = function (next) {
    blockMutation('MODEL_ARTIFACT_VALIDATION_REPORT_IMMUTABLE: ModelArtifactValidationReport documents are strictly append-only. Modification and deletion are REJECTED.', next);
};
ModelArtifactValidationReportSchema.pre('updateOne', queryBlocker);
ModelArtifactValidationReportSchema.pre('updateMany', queryBlocker);
ModelArtifactValidationReportSchema.pre('findOneAndUpdate', queryBlocker);
ModelArtifactValidationReportSchema.pre('replaceOne', queryBlocker);
ModelArtifactValidationReportSchema.pre('deleteOne', queryBlocker);
ModelArtifactValidationReportSchema.pre('deleteMany', queryBlocker);
ModelArtifactValidationReportSchema.pre('findOneAndDelete', queryBlocker);
exports.ModelArtifactValidationReportModel = mongoose_1.default.model('ModelArtifactValidationReport', ModelArtifactValidationReportSchema);
