"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 5: Candidate Selector
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.candidateSelector = exports.CandidateSelector = void 0;
class CandidateSelector {
    calculateCandidateScore(params) {
        const uncertaintyWeight = params.uncertaintyScore * 0.30;
        const correctionWeight = params.isOperatorCorrected ? 30 : 0;
        const thresholdProximity = (params.violationScore >= 45 && params.violationScore <= 55) || (params.violationScore >= 70 && params.violationScore <= 80) ? 15 : 0;
        const disagreementWeight = params.analyzerDisagreement ? 15 : 0;
        const rarityWeight = 10;
        return Math.round(uncertaintyWeight + correctionWeight + thresholdProximity + disagreementWeight + rarityWeight);
    }
}
exports.CandidateSelector = CandidateSelector;
exports.candidateSelector = new CandidateSelector();
