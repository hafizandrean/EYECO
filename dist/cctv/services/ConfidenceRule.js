"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfidenceRule = void 0;
class ConfidenceRule {
    name = 'Confidence Filter';
    async evaluate(detection, context) {
        if (detection.confidence < context.settings.confidenceThreshold) {
            return {
                success: false,
                reason: `LOW_CONFIDENCE: Confidence ${detection.confidence} is below threshold ${context.settings.confidenceThreshold}`
            };
        }
        return { success: true };
    }
}
exports.ConfidenceRule = ConfidenceRule;
