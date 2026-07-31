import { FrameCaptureService } from './FrameCaptureService';
import { InferenceService } from './InferenceService';
import { PromotionService } from './PromotionService';
import { CctvAutoReportService } from './CctvAutoReportService';
import { AiDetectionModel } from '../../database/models/AiDetection';
import { AiMetricModel } from '../../database/models/AiMetric';
import { SystemSettingsModel } from '../../database/models/SystemSettings';
import { CctvModel } from '../../database/models/Cctv';
import { InferenceQueue } from './InferenceQueue';
import crypto from 'crypto';

export class AiPipelineScheduler {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static instanceId = crypto.randomUUID();
  private static workspaceId: number | null = null;

  private static bootTimeoutId: NodeJS.Timeout | null = null;
  private static isStopping = false;

  public static getStatus(): boolean {
    return this.intervalId !== null && !this.isStopping;
  }

  /**
   * Starts the background AI pipeline scheduler.
   * If workspaceId is provided, only processes cameras in that workspace.
   */
  public static start(intervalMs: number = 20000, workspaceId?: number) {
    if (this.intervalId) return;
    this.isStopping = false;

    // Inisialisasi worker pool antrean AI
    InferenceQueue.startWorkers();

    this.workspaceId = workspaceId ?? null;

    console.log(`[AiPipelineScheduler] AI Detection Pipeline Scheduler started (${intervalMs}ms intervals)${workspaceId ? ` for workspace ${workspaceId}` : ''}.`);
    this.intervalId = setInterval(async () => {
      await this.runPipelineCycle();
    }, intervalMs);

    // Jalankan siklus pertama sesaat setelah booting
    this.bootTimeoutId = setTimeout(() => this.runPipelineCycle(), 3000);
  }

  /**
   * Stops the background AI pipeline scheduler.
   */
  public static async stop() {
    this.isStopping = true;
    if (this.bootTimeoutId) {
      clearTimeout(this.bootTimeoutId);
      this.bootTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[AiPipelineScheduler] AI Detection Pipeline Scheduler stopped.');
      
      // Hentikan antrean secara graceful
      await InferenceQueue.shutdown();
    }
  }

  /**
   * Runs a single cycle of the AI pipeline for all active cameras.
   */
  private static async runPipelineCycle() {
    if (this.isStopping || this.isRunning) return; // Cegah tumpang tindih proses lokal jika kueri lambat
    this.isRunning = true;

    // Run single-flight stale lease recovery & pending re-analysis job
    try {
      await PromotionService.runPeriodicRecoveryJob();
    } catch (recErr: any) {
      console.error('[AiPipelineScheduler] Promotion recovery failed:', recErr.message);
    }

    // 0. Coba dapatkan Distributed Lock untuk kluster horizontal (Leader Election)
    try {
      const now = new Date();
      const lockAcquired = await SystemSettingsModel.findOneAndUpdate(
        {
          key: 'scheduler.lock',
          $or: [
            { 'value.locked': false },
            { 'value.expiresAt': { $lt: now } }
          ]
        },
        {
          $set: {
            value: {
              locked: true,
              lockedBy: this.instanceId,
              expiresAt: new Date(Date.now() + 60000) // Sewa lock 60 detik
            }
          }
        },
        { returnDocument: 'after' }
      ).exec();

      if (!lockAcquired) {
        console.log('[AiPipelineScheduler] Skip cycle: Lock diperoleh instance lain.');
        this.isRunning = false;
        return;
      }
    } catch (err: any) {
      console.error('[AiPipelineScheduler] Gagal mengecek distributed lock:', err.message);
      this.isRunning = false;
      return;
    }

    const cycleStartTime = Date.now();
    let framesProcessed = 0;
    let inferenceTimesSum = 0;

    try {
      // 1. Ambil kamera aktif yang online dan memiliki monitoringEnabled = true
      // Filter by workspace if specified
      const filter: any = {
        isActive: true,
        monitoringEnabled: true,
        status: { $in: ['ONLINE', 'MONITORING'] }
      };
      if (this.workspaceId !== null) {
        filter.workspaceId = this.workspaceId;
      }
      const cameras = await CctvModel.find(filter).lean().exec();
      framesProcessed = cameras.length;

      for (const camera of cameras) {
        const captureStartTime = Date.now();

        // 2. Capture Frame
        const frame = await FrameCaptureService.captureFrame(camera);
        const captureTime = Date.now() - captureStartTime;

        // Tentukan prioritas deteksi (HIGH untuk CCTV area kali/kritis)
        const priority = (camera as any).priority || (camera.location.toLowerCase().includes('kali') ? 'HIGH' : 'NORMAL');
        const customWeight = (camera as any).priorityWeight;

        // 3. Enqueue ke antrean prioritas asinkronus
        InferenceQueue.enqueue(frame, priority, customWeight)
          .then(async (detection) => {
            const inferenceTime = Date.now() - captureStartTime - captureTime;
            const promotionStartTime = Date.now();
            
            // 4. Jika terdeteksi objek potensial, jalankan auto-report dan promotion
            if (detection) {
              // Auto-create report if person detected
              const autoReportResult = await CctvAutoReportService.processDetection(frame, detection);
              if (autoReportResult) {
                console.log(`[AiPipelineTrace] Auto-report #${autoReportResult.reportId} created for camera #${camera.id}`);
              }

              // Legacy promotion check (disabled by default)
              console.log(`[AiPipelineTrace] Detection found.${autoReportResult ? ' Auto-report created.' : ' No person detected.'}`);
            }
            const promotionTime = Date.now() - promotionStartTime;
            const totalTime = captureTime + inferenceTime + promotionTime;

            // Cetak trace audit log asinkronus
            console.log(`[AiPipelineTrace] Camera #${camera.id} (${camera.location}) | Priority: ${priority} | Capture: ${captureTime}ms | Inference: ${inferenceTime}ms | Promotion: ${promotionTime}ms | Total: ${totalTime}ms`);

            // 5. Catat AI Metrics per kamera (Time-Series Bucket)
            const cycleIntervalLimit = new Date(Date.now() - 20000);
            const promotionCount = await AiDetectionModel.countDocuments({
              cameraId: camera.id,
              status: 'PROMOTED',
              createdAt: { $gte: cycleIntervalLimit }
            });
            const duplicateCount = await AiDetectionModel.countDocuments({
              cameraId: camera.id,
              status: 'DUPLICATE',
              createdAt: { $gte: cycleIntervalLimit }
            });
            const falsePositiveCount = await AiDetectionModel.countDocuments({
              cameraId: camera.id,
              status: 'LOW_CONFIDENCE',
              createdAt: { $gte: cycleIntervalLimit }
            });

            await AiMetricModel.create({
              timestamp: new Date(),
              cameraId: camera.id,
              framesProcessed: 1,
              averageInferenceTimeMs: inferenceTime,
              promotionCount,
              duplicateCount,
              falsePositiveCount
            });
          })
          .catch(err => {
            console.warn(`[AiPipelineScheduler] Frame dari kamera #${camera.id} dilewati: ${err.message}`);
          });
      }

    } catch (err) {
      console.error('[AiPipelineScheduler] AI pipeline cycle failed:', err);
    } finally {
      // Lepaskan Distributed Lock secara aman
      try {
        await SystemSettingsModel.findOneAndUpdate(
          {
            key: 'scheduler.lock',
            'value.lockedBy': this.instanceId
          },
          {
            $set: {
              value: {
                locked: false,
                lockedBy: null,
                expiresAt: null
              }
            }
          }
        ).exec();
      } catch (lockErr: any) {
        console.error('[AiPipelineScheduler] Gagal melepaskan lock:', lockErr.message);
      }
      this.isRunning = false;
    }
  }
}
