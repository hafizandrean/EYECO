"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiPipelineScheduler = void 0;
const FrameCaptureService_1 = require("./FrameCaptureService");
const CctvAutoReportService_1 = require("./CctvAutoReportService");
const AiDetection_1 = require("../../database/models/AiDetection");
const AiMetric_1 = require("../../database/models/AiMetric");
const SystemSettings_1 = require("../../database/models/SystemSettings");
const Cctv_1 = require("../../database/models/Cctv");
const InferenceQueue_1 = require("./InferenceQueue");
const crypto_1 = __importDefault(require("crypto"));
class AiPipelineScheduler {
    static intervalId = null;
    static isRunning = false;
    static instanceId = crypto_1.default.randomUUID();
    static workspaceId = null;
    /**
     * Starts the background AI pipeline scheduler.
     * If workspaceId is provided, only processes cameras in that workspace.
     */
    static start(intervalMs = 20000, workspaceId) {
        if (this.intervalId)
            return;
        // Inisialisasi worker pool antrean AI
        InferenceQueue_1.InferenceQueue.startWorkers();
        this.workspaceId = workspaceId ?? null;
        console.log(`[AiPipelineScheduler] AI Detection Pipeline Scheduler started (${intervalMs}ms intervals)${workspaceId ? ` for workspace ${workspaceId}` : ''}.`);
        this.intervalId = setInterval(async () => {
            await this.runPipelineCycle();
        }, intervalMs);
        // Jalankan siklus pertama sesaat setelah booting
        setTimeout(() => this.runPipelineCycle(), 3000);
    }
    /**
     * Stops the background AI pipeline scheduler.
     */
    static async stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[AiPipelineScheduler] AI Detection Pipeline Scheduler stopped.');
            // Hentikan antrean secara graceful
            await InferenceQueue_1.InferenceQueue.shutdown();
        }
    }
    /**
     * Runs a single cycle of the AI pipeline for all active cameras.
     */
    static async runPipelineCycle() {
        if (this.isRunning)
            return; // Cegah tumpang tindih proses lokal jika kueri lambat
        this.isRunning = true;
        // 0. Coba dapatkan Distributed Lock untuk kluster horizontal (Leader Election)
        try {
            const now = new Date();
            const lockAcquired = await SystemSettings_1.SystemSettingsModel.findOneAndUpdate({
                key: 'scheduler.lock',
                $or: [
                    { 'value.locked': false },
                    { 'value.expiresAt': { $lt: now } }
                ]
            }, {
                $set: {
                    value: {
                        locked: true,
                        lockedBy: this.instanceId,
                        expiresAt: new Date(Date.now() + 60000) // Sewa lock 60 detik
                    }
                }
            }, { returnDocument: 'after' }).exec();
            if (!lockAcquired) {
                console.log('[AiPipelineScheduler] Skip cycle: Lock diperoleh instance lain.');
                this.isRunning = false;
                return;
            }
        }
        catch (err) {
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
            const filter = {
                isActive: true,
                monitoringEnabled: true,
                status: { $in: ['ONLINE', 'MONITORING'] }
            };
            if (this.workspaceId !== null) {
                filter.workspaceId = this.workspaceId;
            }
            const cameras = await Cctv_1.CctvModel.find(filter).lean().exec();
            framesProcessed = cameras.length;
            for (const camera of cameras) {
                const captureStartTime = Date.now();
                // 2. Capture Frame
                const frame = FrameCaptureService_1.FrameCaptureService.captureFrame(camera);
                const captureTime = Date.now() - captureStartTime;
                // Tentukan prioritas deteksi (HIGH untuk CCTV area kali/kritis)
                const priority = camera.priority || (camera.location.toLowerCase().includes('kali') ? 'HIGH' : 'NORMAL');
                const customWeight = camera.priorityWeight;
                // 3. Enqueue ke antrean prioritas asinkronus
                InferenceQueue_1.InferenceQueue.enqueue(frame, priority, customWeight)
                    .then(async (detection) => {
                    const inferenceTime = Date.now() - captureStartTime - captureTime;
                    const promotionStartTime = Date.now();
                    // 4. Jika terdeteksi objek potensial, jalankan auto-report dan promotion
                    if (detection) {
                        // Auto-create report if person detected
                        const autoReportResult = await CctvAutoReportService_1.CctvAutoReportService.processDetection(frame, detection);
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
                    const promotionCount = await AiDetection_1.AiDetectionModel.countDocuments({
                        cameraId: camera.id,
                        status: 'PROMOTED',
                        createdAt: { $gte: cycleIntervalLimit }
                    });
                    const duplicateCount = await AiDetection_1.AiDetectionModel.countDocuments({
                        cameraId: camera.id,
                        status: 'DUPLICATE',
                        createdAt: { $gte: cycleIntervalLimit }
                    });
                    const falsePositiveCount = await AiDetection_1.AiDetectionModel.countDocuments({
                        cameraId: camera.id,
                        status: 'LOW_CONFIDENCE',
                        createdAt: { $gte: cycleIntervalLimit }
                    });
                    await AiMetric_1.AiMetricModel.create({
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
        }
        catch (err) {
            console.error('[AiPipelineScheduler] AI pipeline cycle failed:', err);
        }
        finally {
            // Lepaskan Distributed Lock secara aman
            try {
                await SystemSettings_1.SystemSettingsModel.findOneAndUpdate({
                    key: 'scheduler.lock',
                    'value.lockedBy': this.instanceId
                }, {
                    $set: {
                        value: {
                            locked: false,
                            lockedBy: null,
                            expiresAt: null
                        }
                    }
                }).exec();
            }
            catch (lockErr) {
                console.error('[AiPipelineScheduler] Gagal melepaskan lock:', lockErr.message);
            }
            this.isRunning = false;
        }
    }
}
exports.AiPipelineScheduler = AiPipelineScheduler;
