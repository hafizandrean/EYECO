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
exports.TrainingEligibilityEvaluationModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const GateResultSchema = new mongoose_1.Schema({
    gate: { type: String, required: true },
    passed: { type: Boolean, required: true },
    observedValue: { type: mongoose_1.Schema.Types.Mixed, default: null },
    requiredValue: { type: mongoose_1.Schema.Types.Mixed, default: null },
    reasons: { type: [String], default: [] }
}, { _id: false });
const TrainingEligibilityEvaluationSchema = new mongoose_1.Schema({
    datasetVersion: { type: String, required: true, index: true },
    policyVersion: { type: String, default: 'v1.0.0-strict-policy', required: true },
    policyHash: { type: String, required: true },
    environment: { type: String, required: true, enum: ['TEST', 'STAGING', 'PRODUCTION'], default: 'PRODUCTION', index: true },
    structurallyValid: { type: Boolean, required: true },
    eligible: { type: Boolean, required: true, index: true },
    gateResults: { type: [GateResultSchema], default: [] },
    evaluatedAt: { type: Date, default: Date.now },
    evaluatedBy: { type: mongoose_1.Schema.Types.Mixed, default: 'SYSTEM' },
    evaluationHash: { type: String, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
exports.TrainingEligibilityEvaluationModel = mongoose_1.default.model('TrainingEligibilityEvaluation', TrainingEligibilityEvaluationSchema);
