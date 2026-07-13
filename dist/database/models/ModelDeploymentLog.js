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
exports.ModelDeploymentLogModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ModelDeploymentLogSchema = new mongoose_1.Schema({
    modelIdFrom: { type: String, required: true, index: true },
    modelIdTo: { type: String, required: true, index: true },
    deployedBy: { type: String, required: true },
    deploymentType: { type: String, required: true, enum: ['HOT_SWAP', 'ROLLBACK', 'CANARY'] },
    validationResult: { type: String, required: true, enum: ['SUCCESS', 'FAILED'] },
    rollbackReason: { type: String, default: '' },
    rollbackTriggeredBy: { type: String, default: '' },
    pythonVersion: { type: String, default: '' },
    cudaVersion: { type: String, default: '' },
    ultralyticsVersion: { type: String, default: '' },
    downloadLatencyMs: { type: Number, required: true, default: 0 },
    checksumLatencyMs: { type: Number, required: true, default: 0 },
    loadLatencyMs: { type: Number, required: true, default: 0 },
    warmupLatencyMs: { type: Number, required: true, default: 0 },
    smokeValidationLatencyMs: { type: Number, required: true, default: 0 },
    totalDeploymentLatencyMs: { type: Number, required: true, default: 0 }
}, {
    timestamps: true
});
exports.ModelDeploymentLogModel = mongoose_1.default.model('ModelDeploymentLog', ModelDeploymentLogSchema);
