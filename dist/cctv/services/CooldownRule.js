"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CooldownRule = void 0;
const Report_1 = require("../../database/models/Report");
class CooldownRule {
    name = 'Cooldown Policy';
    async evaluate(detection, context) {
        try {
            const cooldownMinutes = context.settings.cooldownMinutes;
            const cooldownLimit = new Date(Date.now() - cooldownMinutes * 60 * 1000);
            // Cari laporan di lokasi yang sama yang statusnya baru saja ditutup dalam masa cooldown
            const closedReport = await Report_1.ReportModel.findOne({
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
        }
        catch (err) {
            console.error('[CooldownRule] Error evaluating cooldown:', err.message);
            return { success: false, reason: `COOLDOWN_ERROR: ${err.message}` };
        }
    }
}
exports.CooldownRule = CooldownRule;
