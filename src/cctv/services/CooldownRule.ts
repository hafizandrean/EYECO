import { IPromotionRule, RuleContext } from './PromotionRule';
import { IAiDetection } from '../../database/models/AiDetection';
import { ReportModel } from '../../database/models/Report';

export class CooldownRule implements IPromotionRule {
  public name = 'Cooldown Policy';

  public async evaluate(detection: IAiDetection, context: RuleContext): Promise<{ success: boolean; reason?: string }> {
    try {
      const cooldownMinutes = context.settings.cooldownMinutes;
      const cooldownLimit = new Date(Date.now() - cooldownMinutes * 60 * 1000);

      // Cari laporan di lokasi yang sama yang statusnya baru saja ditutup dalam masa cooldown
      const closedReport = await ReportModel.findOne({
        location: detection.location,
        status: { $in: ['CLOSED', 'REJECTED'] },
        updatedAt: { $gte: cooldownLimit }
      });

      if (closedReport) {
        return {
          success: false,
          reason: `COOLDOWN: Incident recently closed at this location. Cooldown in progress until ${new Date(closedReport.updatedAt.getTime() + cooldownMinutes * 60 * 1000).toISOString()}`
        };
      }

      return { success: true };
    } catch (err: any) {
      console.error('[CooldownRule] Error evaluating cooldown:', err.message);
      return { success: false, reason: `COOLDOWN_ERROR: ${err.message}` };
    }
  }
}
