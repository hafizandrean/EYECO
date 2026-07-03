import { IPromotionRule, RuleContext } from './PromotionRule';
import { IAiDetection } from '../../database/models/AiDetection';

export class ConfidenceRule implements IPromotionRule {
  public name = 'Confidence Filter';

  public async evaluate(detection: IAiDetection, context: RuleContext): Promise<{ success: boolean; reason?: string }> {
    if (detection.confidence < context.settings.confidenceThreshold) {
      return {
        success: false,
        reason: `LOW_CONFIDENCE: Confidence ${detection.confidence} is below threshold ${context.settings.confidenceThreshold}`
      };
    }
    return { success: true };
  }
}
