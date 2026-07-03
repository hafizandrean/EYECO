import { IAiDetection } from '../../database/models/AiDetection';

export interface RuleContext {
  settings: {
    confidenceThreshold: number;
    verificationFrames: number;
    cooldownMinutes: number;
    duplicateRadiusMeters: number;
    duplicateTimeWindowSeconds: number;
    timelineUpdateIntervalSeconds: number;
    archiveAfterDays: number;
  };
  mainClass: string;
}

export interface IPromotionRule {
  name: string;
  evaluate(detection: IAiDetection, context: RuleContext): Promise<{ success: boolean; reason?: string }>;
}
