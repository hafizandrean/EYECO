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
exports.StatisticalEvaluationJobModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const StatisticalEvaluationJobSchema = new mongoose_1.Schema({
    jobId: { type: String, required: true, unique: true, index: true },
    candidateModelId: { type: String, required: true, index: true },
    baselineModelId: { type: String, required: true, index: true },
    goldenDatasetVersion: { type: String, required: true },
    statisticalPolicyId: { type: String, required: true },
    status: {
        type: String,
        required: true,
        enum: ['QUEUED', 'CLAIMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
        default: 'QUEUED',
        index: true
    },
    workerId: { type: String, default: null },
    claimToken: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    resultEvaluationId: { type: String, default: null },
    errorMessage: { type: String, default: null },
    completedAt: { type: Date, default: null }
}, { timestamps: true });
exports.StatisticalEvaluationJobModel = mongoose_1.default.model('StatisticalEvaluationJob', StatisticalEvaluationJobSchema);
