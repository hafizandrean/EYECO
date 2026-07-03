import { IPromotionRule, RuleContext } from './PromotionRule';
import { IAiDetection } from '../../database/models/AiDetection';
import { ReportModel } from '../../database/models/Report';
import { TimelineEventModel } from '../../database/models/TimelineEvent';
import { UserModel } from '../../database/models/User';
import mongoose from 'mongoose';

export class DuplicateRule implements IPromotionRule {
  public name = 'Duplicate Check';

  public async evaluate(detection: IAiDetection, context: RuleContext): Promise<{ success: boolean; reason?: string }> {
    try {
      const duplicateLimit = new Date(Date.now() - context.settings.duplicateTimeWindowSeconds * 1000);

      // Cari laporan aktif pada kamera yang sama, dengan kelas deteksi yang sama, dalam jendela waktu duplikasi
      const openReport = await ReportModel.findOne({
        status: { $nin: ['CLOSED', 'REJECTED'] },
        timestamp: { $gte: duplicateLimit },
        'sourceMetadata.cameraId': detection.cameraId,
        'boundingBoxes.label': context.mainClass
      });

      if (openReport) {
        // Cari admin utama untuk relasi aktor default
        const adminUser = await UserModel.findOne({ id: 1 });
        const adminObjectId = adminUser ? adminUser._id as mongoose.Types.ObjectId : new mongoose.Types.ObjectId('000000000000000000000001');

        // Tandai deteksi sebagai DUPLICATE
        detection.status = 'DUPLICATE';
        detection.promotedReportId = openReport.id;
        detection.rejectedReason = 'DUPLICATE';
        await detection.save();

        // Tambahkan log di timeline laporan yang sudah ada
        await TimelineEventModel.create({
          reportId: openReport._id,
          eventVersion: 1,
          type: 'DETECTION',
          actorId: adminObjectId,
          actorName: 'YOLOv8',
          actorRole: 'AI',
          title: 'Deteksi AI Berlanjut',
          description: `Sistem AI mendeteksi keberadaan objek '${context.mainClass}' kembali di kamera ini. (Confidence: ${Math.round(detection.confidence * 100)}%, Severity: ${detection.severity}).`,
          metadata: { confidence: detection.confidence, severity: detection.severity, trackingId: detection.trackingId },
          ipAddress: '127.0.0.1',
          userAgent: 'EYECO AI Engine',
          createdAt: new Date()
        });

        return {
          success: false,
          reason: `DUPLICATE: Active incident exists for this camera and class (Report #${openReport.id}).`
        };
      }

      return { success: true };
    } catch (err: any) {
      console.error('[DuplicateRule] Error evaluating duplicates:', err.message);
      return { success: false, reason: `DUPLICATE_ERROR: ${err.message}` };
    }
  }
}
