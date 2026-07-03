import { AiDetectionModel, IAiDetection } from '../../database/models/AiDetection';
import { AiEvidenceModel } from '../../database/models/AiEvidence';
import { ReportModel } from '../../database/models/Report';
import { UserModel } from '../../database/models/User';
import { TimelineEventModel } from '../../database/models/TimelineEvent';
import { SystemSettingsModel } from '../../database/models/SystemSettings';
import { NotificationDispatcher } from '../../notifications/NotificationDispatcher';
import { RuleContext, IPromotionRule } from './PromotionRule';
import { ConfidenceRule } from './ConfidenceRule';
import { VerificationRule } from './VerificationRule';
import { CooldownRule } from './CooldownRule';
import { DuplicateRule } from './DuplicateRule';
import mongoose from 'mongoose';

export class PromotionService {
  private static cachedRules: any = null;
  private static lastCacheRefresh = 0;

  private static rules: IPromotionRule[] = [
    new ConfidenceRule(),
    new VerificationRule(),
    new CooldownRule(),
    new DuplicateRule()
  ];

  /**
   * Orchestrates the evaluation of rules.
   * Promotes the detection if all rules pass, otherwise logs the specific rejectedReason.
   */
  public static async evaluateDetection(detection: IAiDetection): Promise<void> {
    try {
      // 1. Ambil aturan bisnis terpusat dengan mekanisme Caching Memori (TTL 30 detik)
      const settings = await this.getSystemRules();

      // Ambil kelas deteksi utama (default ke 'trash' atau deteksi pertama)
      const mainDetection = detection.detections.find(d => d.class === 'trash') || detection.detections[0];
      if (!mainDetection) {
        detection.status = 'FAILED_PROMOTION';
        detection.rejectedReason = 'NO_DETECTIONS_FOUND';
        await detection.save();
        return;
      }
      const mainClass = mainDetection.class;

      const context: RuleContext = {
        settings,
        mainClass
      };

      // 2. Evaluasi seluruh aturan secara sekuensial
      for (const rule of this.rules) {
        const result = await rule.evaluate(detection, context);
        if (!result.success) {
          // Rule Engine memicu penolakan
          const reasonCode = result.reason?.split(':')[0] || 'REJECTED';
          detection.status = this.mapReasonToStatus(reasonCode);
          detection.rejectedReason = result.reason || rule.name;
          await detection.save();
          console.log(`[PromotionService] Detection #${detection.id} rejected by rule: ${rule.name}. Reason: ${result.reason}`);
          return;
        }
      }

      // 3. Seluruh Aturan Lolos: Promosikan deteksi menjadi Laporan Insiden Baru
      console.log(`[PromotionService] Detection #${detection.id} passed all rules. Promoting...`);
      detection.status = 'PROMOTED';
      detection.promotionReason = 'ALL_RULES_PASSED';

      // Cari berkas snapshot bukti
      const evidence = await AiEvidenceModel.findOne({ linkedDetectionId: detection._id });
      const imagePath = evidence ? evidence.storageKey : '/uploads/detection_1.jpg';

      // Cari admin utama untuk relasi pelapor default
      const adminUser = await UserModel.findOne({ id: 1 });
      const adminObjectId = adminUser ? adminUser._id as mongoose.Types.ObjectId : new mongoose.Types.ObjectId('000000000000000000000001');

      // Cari max integer ID Laporan
      const lastReport = await ReportModel.findOne().sort({ id: -1 }).exec();
      const nextReportId = lastReport ? lastReport.id + 1 : 1;

      let aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' = 'Tidak Terindikasi';
      if (detection.severity === 'CRITICAL' || detection.severity === 'HIGH') aiStatus = 'TINGGI';
      else if (detection.severity === 'MEDIUM') aiStatus = 'SEDANG';
      else if (detection.severity === 'LOW') aiStatus = 'RENDAH';

      const newReport = await ReportModel.create({
        id: nextReportId,
        userId: adminObjectId,
        location: detection.location,
        timestamp: new Date(),
        aiStatus,
        aiConfidence: Math.round(detection.confidence * 100),
        adminStatus: 'MENUNGGU',
        image: imagePath,
        identity: `CCTV-CAM-${detection.cameraId.toString().padStart(2, '0')}`,
        sourceType: 'AI_CCTV',
        additionalNotes: `Deteksi otomatis oleh model AI di kamera ${detection.location}.`,
        adminNotes: '',
        boundingBoxes: detection.detections.map(d => ({
          label: d.class,
          confidence: d.confidence,
          x: d.bbox[0],
          y: d.bbox[1],
          w: d.bbox[2],
          h: d.bbox[3]
        })),
        status: 'NEW',
        sla: {
          detectedAt: new Date()
        },
        sourceMetadata: {
          cameraId: detection.cameraId,
          modelId: detection.modelId,
          confidence: detection.confidence,
          detectionId: detection.id,
          ruleVersion: 'v1.0',
          modelVersion: '1.0'
        }
      });

      // Link Report ID ke deteksi
      detection.promotedReportId = newReport.id;
      
      // Kunci Detection & Evidence dari TTL deletion
      detection.expiresAt = null;
      await detection.save();

      if (evidence) {
        evidence.expiresAt = null;
        await evidence.save();
      }

      // Catat Timeline awal insiden
      await TimelineEventModel.insertMany([
        {
          reportId: newReport._id,
          eventVersion: 1,
          type: 'DETECTION',
          actorId: adminObjectId,
          actorName: 'YOLOv8',
          actorRole: 'AI',
          title: 'Deteksi AI Otomatis',
          description: `Sistem AI mendeteksi ancaman dengan status ${aiStatus} di ${newReport.location}.`,
          metadata: { confidence: newReport.aiConfidence, camera: `CCTV-CAM-${detection.cameraId}` },
          ipAddress: '127.0.0.1',
          userAgent: 'EYECO AI Engine',
          createdAt: new Date()
        },
        {
          reportId: newReport._id,
          eventVersion: 1,
          type: 'REVIEW',
          actorId: adminObjectId,
          actorName: 'System',
          actorRole: 'AI',
          title: 'Antrean Tinjauan',
          description: 'Laporan otomatis dari kamera masuk antrean verifikasi petugas.',
          metadata: {},
          ipAddress: '127.0.0.1',
          userAgent: 'EYECO AI Engine',
          createdAt: new Date()
        }
      ]);

      // Kirim Notifikasi
      await NotificationDispatcher.dispatch(newReport);

    } catch (err: any) {
      console.error('[PromotionService] Promotion orchestration failed:', err.message);
      detection.status = 'FAILED_PROMOTION';
      detection.rejectedReason = `SYSTEM_ERROR: ${err.message}`;
      await detection.save();
    }
  }

  /**
   * Mengambil rules dari database dengan mekanisme cache memori (TTL 30 detik).
   */
  private static async getSystemRules(): Promise<any> {
    const now = Date.now();
    if (this.cachedRules && (now - this.lastCacheRefresh < 30000)) {
      return this.cachedRules;
    }

    const defaultRules = {
      confidenceThreshold: 0.70,
      verificationFrames: 3,
      cooldownMinutes: 3,
      duplicateRadiusMeters: 15,
      duplicateTimeWindowSeconds: 300,
      timelineUpdateIntervalSeconds: 120,
      archiveAfterDays: 180
    };

    try {
      const dbRules = await SystemSettingsModel.findOne({ key: 'ai.rules' });
      if (dbRules && dbRules.value) {
        this.cachedRules = { ...defaultRules, ...dbRules.value };
      } else {
        this.cachedRules = defaultRules;
      }
      this.lastCacheRefresh = now;
    } catch (err) {
      this.cachedRules = defaultRules;
    }
    return this.cachedRules;
  }

  /**
   * Helper: Memetakan status kegagalan evaluasi ke status database AiDetection
   */
  private static mapReasonToStatus(reason: string): any {
    switch (reason) {
      case 'LOW_CONFIDENCE':
        return 'LOW_CONFIDENCE';
      case 'WAITING_VERIFICATION':
        return 'WAITING_VERIFICATION';
      case 'DUPLICATE':
        return 'DUPLICATE';
      case 'COOLDOWN':
        return 'FAILED_PROMOTION';
      default:
        return 'FAILED_PROMOTION';
    }
  }
}
