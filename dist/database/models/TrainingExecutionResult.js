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
exports.TrainingExecutionResultModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const TrainingExecutionResultSchema = new mongoose_1.Schema({
    executionId: { type: String, required: true, unique: true, index: true },
    trainingJobId: { type: String, required: true, index: true },
    workerId: { type: String, required: true },
    claimTokenHash: { type: String, required: true },
    attemptNumber: { type: Number, required: true, default: 1 },
    executionStatus: {
        type: String,
        enum: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
        required: true
    },
    terminationReason: { type: String },
    trainerScriptPath: { type: String, required: true },
    trainerScriptHash: { type: String, required: true },
    commandArgumentsHash: { type: String, required: true },
    processPid: { type: Number, required: true },
    exitCode: { type: Number, required: true },
    stdoutHash: { type: String, required: true },
    stderrHash: { type: String, required: true },
    runtimeEnvironmentHash: { type: String, required: true },
    pythonVersion: { type: String, required: true },
    ultralyticsVersion: { type: String, required: true },
    torchVersion: { type: String, required: true },
    deviceType: { type: String, required: true, default: 'cpu' },
    seed: { type: Number, required: true, default: 42 },
    datasetExportHash: { type: String, required: true },
    dataYamlHash: { type: String, required: true },
    trainingConfigHash: { type: String, required: true },
    baseModelArtifactHash: { type: String, required: true },
    epochsRequested: { type: Number, required: true },
    epochsCompleted: { type: Number, required: true },
    bestEpoch: { type: Number, required: true },
    resultsCsvHash: { type: String, required: true },
    bestCheckpointHash: { type: String, required: true },
    acceptedForFinalization: { type: Boolean, required: true, default: false },
    resultHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
TrainingExecutionResultSchema.index({ trainingJobId: 1, attemptNumber: 1, executionId: 1 }, { unique: true });
TrainingExecutionResultSchema.index({ trainingJobId: 1, attemptNumber: 1, acceptedForFinalization: 1 }, { unique: true, partialFilterExpression: { acceptedForFinalization: true } });
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    err.status = 422;
    if (typeof next === 'function') {
        return next(err);
    }
    throw err;
}
TrainingExecutionResultSchema.pre('save', function (next) {
    if (!this.isNew) {
        return blockMutation('TRAINING_RESULT_IMMUTABLE: TrainingExecutionResult documents are strictly append-only. Modification and deletion are REJECTED.', next);
    }
    if (typeof next === 'function')
        next();
});
const queryBlocker = function (next) {
    blockMutation('TRAINING_RESULT_IMMUTABLE: TrainingExecutionResult documents are strictly append-only. Modification and deletion are REJECTED.', next);
};
TrainingExecutionResultSchema.pre('updateOne', queryBlocker);
TrainingExecutionResultSchema.pre('updateMany', queryBlocker);
TrainingExecutionResultSchema.pre('findOneAndUpdate', queryBlocker);
TrainingExecutionResultSchema.pre('replaceOne', queryBlocker);
TrainingExecutionResultSchema.pre('deleteOne', queryBlocker);
TrainingExecutionResultSchema.pre('deleteMany', queryBlocker);
TrainingExecutionResultSchema.pre('findOneAndDelete', queryBlocker);
exports.TrainingExecutionResultModel = mongoose_1.default.model('TrainingExecutionResult', TrainingExecutionResultSchema);
