"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 4: Operator Feedback Collector
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedbackCollector = exports.FeedbackCollector = void 0;
const AiValidationLog_1 = require("../../../database/models/AiValidationLog");
const mongoose_1 = __importDefault(require("mongoose"));
class FeedbackCollector {
    async logOperatorFeedback(params) {
        const log = await AiValidationLog_1.AiValidationLogModel.create({
            reportId: params.reportId,
            snapshotId: params.snapshotId ? new mongoose_1.default.Types.ObjectId(params.snapshotId) : undefined,
            userId: new mongoose_1.default.Types.ObjectId(params.userId),
            operatorUsername: params.operatorUsername,
            operatorDecision: params.operatorDecision,
            isLitteringConfirmed: params.isLitteringConfirmed,
            correctedPriority: params.correctedPriority,
            notes: params.notes || '',
            predictedStatus: params.predictedStatus || '',
            predictedScore: params.predictedScore || 0,
            inputImageHash: params.inputImageHash || '',
        });
        console.log(`[FEEDBACK] Logged operator feedback for Report #${params.reportId}: ${params.operatorDecision}`);
        return log;
    }
}
exports.FeedbackCollector = FeedbackCollector;
exports.feedbackCollector = new FeedbackCollector();
