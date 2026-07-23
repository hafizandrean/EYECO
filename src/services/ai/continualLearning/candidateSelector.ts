/**
 * EYECO AI Engine v3.0 — Layer 5: Candidate Selector
 */

export class CandidateSelector {
  public calculateCandidateScore(params: {
    uncertaintyScore: number; // 0-100
    isOperatorCorrected: boolean;
    violationScore: number; // 0-100
    analyzerDisagreement: boolean;
  }): number {
    const uncertaintyWeight = params.uncertaintyScore * 0.30;
    const correctionWeight = params.isOperatorCorrected ? 30 : 0;
    const thresholdProximity = (params.violationScore >= 45 && params.violationScore <= 55) || (params.violationScore >= 70 && params.violationScore <= 80) ? 15 : 0;
    const disagreementWeight = params.analyzerDisagreement ? 15 : 0;
    const rarityWeight = 10;

    return Math.round(uncertaintyWeight + correctionWeight + thresholdProximity + disagreementWeight + rarityWeight);
  }
}

export const candidateSelector = new CandidateSelector();
