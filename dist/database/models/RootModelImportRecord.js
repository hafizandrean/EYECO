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
exports.RootModelImportRecordModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const RootModelImportRecordSchema = new mongoose_1.Schema({
    importRecordId: { type: String, required: true, unique: true, index: true },
    modelType: { type: String, required: true },
    environment: { type: String, enum: ['STAGING', 'PRODUCTION'], required: true },
    artifactPath: { type: String, required: true },
    artifactHash: { type: String, required: true },
    artifactValidationReportId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'ModelArtifactValidationReport', required: true },
    sourceType: { type: String, enum: ['LOCAL_APPROVED_IMPORT', 'VENDOR_BASE_MODEL'], required: true },
    sourceReference: { type: String },
    sourceArtifactHash: { type: String, required: true },
    classMappingHash: { type: String, required: true },
    frameworkVersion: { type: String, required: true, default: 'ultralytics-v8.0.0' },
    modelTask: { type: String, required: true, default: 'detect' },
    importedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    approvalReason: { type: String, required: true },
    approvalPolicyVersion: { type: String, required: true, default: 'v1.0.0' },
    importScriptHash: { type: String, required: true },
    runtimeEnvironmentHash: { type: String, required: true },
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
RootModelImportRecordSchema.pre('save', function (next) {
    if (!this.isNew) {
        return blockMutation('ROOT_IMPORT_RECORD_IMMUTABLE: RootModelImportRecord documents are strictly append-only. Modification and deletion are REJECTED.', next);
    }
    if (typeof next === 'function')
        next();
});
const queryBlocker = function (next) {
    blockMutation('ROOT_IMPORT_RECORD_IMMUTABLE: RootModelImportRecord documents are strictly append-only. Modification and deletion are REJECTED.', next);
};
RootModelImportRecordSchema.pre('updateOne', queryBlocker);
RootModelImportRecordSchema.pre('updateMany', queryBlocker);
RootModelImportRecordSchema.pre('findOneAndUpdate', queryBlocker);
RootModelImportRecordSchema.pre('replaceOne', queryBlocker);
RootModelImportRecordSchema.pre('deleteOne', queryBlocker);
RootModelImportRecordSchema.pre('deleteMany', queryBlocker);
RootModelImportRecordSchema.pre('findOneAndDelete', queryBlocker);
exports.RootModelImportRecordModel = mongoose_1.default.model('RootModelImportRecord', RootModelImportRecordSchema);
