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
exports.AiValidationLogModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AiValidationLogSchema = new mongoose_1.Schema({
    reportId: { type: Number, required: true, index: true },
    snapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', default: null },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    operatorUsername: { type: String, required: true },
    operatorDecision: {
        type: String,
        required: true,
        enum: [
            'CONFIRMED_LITTERING',
            'PROBABLE_LITTERING',
            'CARRYING_OBJECT',
            'DISPOSING_IN_BIN',
            'PICKING_UP_TRASH',
            'CLEANING_ACTIVITY',
            'PERSON_ONLY',
            'TRASH_ONLY',
            'NOT_ENOUGH_EVIDENCE',
            'FALSE_OBJECT_DETECTION',
            'IMAGE_QUALITY_TOO_LOW',
            'OTHER'
        ],
        index: true
    },
    isLitteringConfirmed: { type: Boolean, default: null },
    correctedPriority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    notes: { type: String, default: '' },
    yoloVersion: { type: String, default: '' },
    sceneVersion: { type: String, default: '' },
    decisionVersion: { type: String, default: '' },
    predictedStatus: { type: String, default: '' },
    predictedScore: { type: Number, default: 0 },
    inputImageHash: { type: String, default: '' },
}, { timestamps: true });
exports.AiValidationLogModel = mongoose_1.default.model('AiValidationLog', AiValidationLogSchema);
