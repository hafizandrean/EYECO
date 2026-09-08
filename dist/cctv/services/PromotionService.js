"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromotionService = void 0;
const AiDetection_1 = require("../../database/models/AiDetection");
const AiEvidence_1 = require("../../database/models/AiEvidence");
const Report_1 = require("../../database/models/Report");
const User_1 = require("../../database/models/User");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const TimelineEvent_1 = require("../../database/models/TimelineEvent");
const SystemSettings_1 = require("../../database/models/SystemSettings");
const NotificationDispatcher_1 = require("../../notifications/NotificationDispatcher");
const ConfidenceRule_1 = require("./ConfidenceRule");
const VerificationRule_1 = require("./VerificationRule");
const CooldownRule_1 = require("./CooldownRule");
const DuplicateRule_1 = require("./DuplicateRule");
const aiEngine_1 = require("../../services/ai/aiEngine");
const Counter_1 = require("../../database/models/Counter");
const mongoose_1 = __importDefault(require("mongoose"));
const fs_1 = __importDefault(require("fs"));
class PromotionService {
    static cachedRules = null;
    static lastCacheRefresh = 0;
    static rules = [
        new ConfidenceRule_1.ConfidenceRule(),
        new VerificationRule_1.VerificationRule(),
        new CooldownRule_1.CooldownRule(),
        new DuplicateRule_1.DuplicateRule()
    ];
    static async evaluateDetection(detection) {
        try {
            console.log(`[PromotionService] Evaluating detection #${detection.id} (${detection.location})...`);
            // 1. Ambil pengaturan sistem terbaru
            const settings = await this.getSystemRules();
            const mainDetection = detection.detections.find(d => d.class === 'trash') || detection.detections[0];
            if (!mainDetection) {
                detection.status = 'FAILED_PROMOTION';
                detection.rejectedReason = 'NO_DETECTIONS_FOUND';
                await detection.save();
                return;
            }
            const context = {
                settings,
                mainClass: mainDetection.class
            };
            // 2. Evaluasi seluruh aturan secara sekuensial
            for (const rule of this.rules) {
                const result = await rule.evaluate(detection, context);
                if (!result.success) {
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
            const evidence = await AiEvidence_1.AiEvidenceModel.findOne({ linkedDetectionId: detection._id });
            const imagePath = evidence ? (evidence.storageKey || evidence.storage?.key || '') : path_1.default.join(os_1.default.tmpdir(), 'eyeco', `cctv_capture_${detection.cameraId}.jpg`);
            // Cari admin utama untuk relasi pelapor default
            const adminUser = await User_1.UserModel.findOne({ id: 1 });
            const adminObjectId = adminUser ? adminUser._id : new mongoose_1.default.Types.ObjectId('000000000000000000000001');
            // Run stale lease recovery before evaluating detection
            await this.recoverExpiredAnalysis();
            // Check if a report for this sourceDetectionId already exists (Idempotency & Retry Guard)
            const existingReport = await Report_1.ReportModel.findOne({ sourceDetectionId: detection._id, deletedAt: null }).exec();
            if (existingReport) {
                if (existingReport.analysisState === 'READY') {
                    console.log(`[PromotionService] Idempotent hit: Report #${existingReport.id} is already READY.`);
                    detection.status = 'PROMOTED';
                    detection.promotedReportId = existingReport.id;
                    await detection.save();
                    return;
                }
                const now = new Date();
                const leaseExpired = existingReport.analysisLeaseExpiresAt ? new Date(existingReport.analysisLeaseExpiresAt).getTime() <= now.getTime() : false;
                if (existingReport.analysisState === 'PROCESSING' && !leaseExpired) {
                    console.log(`[PromotionService] Idempotent hit: Report #${existingReport.id} is currently PROCESSING with active lease.`);
                    detection.status = 'PROMOTED';
                    detection.promotedReportId = existingReport.id;
                    await detection.save();
                    return;
                }
                // Atomic claim attempt with MAX_ANALYSIS_ATTEMPTS check
                const claimToken = crypto.randomUUID();
                const leaseExpiresAt = new Date(now.getTime() + 30_000); // 30 second lease
                const claimedReport = await Report_1.ReportModel.findOneAndUpdate({
                    _id: existingReport._id,
                    $or: [
                        { analysisState: { $in: ['FAILED', 'REANALYSIS_PENDING'] } },
                        { analysisState: 'PROCESSING', analysisLeaseExpiresAt: { $lte: now } }
                    ],
                    analysisAttemptCount: { $lt: 3 }
                }, {
                    $set: {
                        analysisState: 'PROCESSING',
                        aiDataIntegrityStatus: 'PENDING',
                        analysisStartedAt: now,
                        analysisLeaseExpiresAt: leaseExpiresAt,
                        analysisErrorCode: null,
                        analysisClaimToken: claimToken
                    },
                    $inc: { analysisAttemptCount: 1 }
                }, { new: true }).exec();
                if (!claimedReport) {
                    console.warn(`[PromotionService] Reclaim denied for Report #${existingReport.id} (max attempts reached or claimed by concurrent worker).`);
                    detection.status = 'PROMOTED';
                    detection.promotedReportId = existingReport.id;
                    await detection.save();
                    return;
                }
                console.log(`[PromotionService] Atomically claimed Report #${claimedReport.id} (attempt #${claimedReport.analysisAttemptCount}, token ${claimToken}) for re-analysis.`);
                await this.runAiAnalysisAndFinalize(claimedReport, claimToken, detection, imagePath);
                return;
            }
            // Ambil integer ID Laporan secara atomic untuk mencegah race condition (Item #3)
            const nextReportId = await (0, Counter_1.getNextSequence)('reportId', Report_1.ReportModel);
            let initialAiStatus = 'Tidak Terindikasi';
            if (detection.severity === 'CRITICAL' || detection.severity === 'HIGH')
                initialAiStatus = 'Indikasi Tinggi';
            else if (detection.severity === 'MEDIUM')
                initialAiStatus = 'Indikasi Sedang';
            else if (detection.severity === 'LOW')
                initialAiStatus = 'Indikasi Rendah';
            const initialClaimToken = crypto.randomUUID();
            const now = new Date();
            const leaseExpiresAt = new Date(now.getTime() + 30_000); // 30 second lease
            // 1. Create Report in PROCESSING state first with duplicate key E11000 protection
            let newReportDoc = null;
            try {
                newReportDoc = await Report_1.ReportModel.create({
                    id: nextReportId,
                    userId: adminObjectId,
                    location: detection.location,
                    timestamp: now,
                    aiStatus: initialAiStatus,
                    aiConfidence: Math.round(detection.confidence * 100),
                    violationScore: null,
                    decisionConfidence: null,
                    objectConfidence: null,
                    sceneConfidence: null,
                    priority: null,
                    recommendedAction: null,
                    activeSnapshotId: null,
                    sourceDetectionId: detection._id,
                    analysisState: 'PROCESSING',
                    analysisStartedAt: now,
                    analysisLeaseExpiresAt: leaseExpiresAt,
                    analysisAttemptCount: 1,
                    analysisClaimToken: initialClaimToken,
                    adminStatus: 'MENUNGGU',
                    image: imagePath,
                    identity: `CCTV-CAM-${detection.cameraId.toString().padStart(2, '0')}`,
                    sourceType: 'Otomatis',
                    additionalNotes: `Deteksi otomatis oleh model AI di kamera ${detection.location}.`,
                    adminNotes: '',
                    boundingBoxes: detection.detections.map(d => {
                        const labelMap = {
                            'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang', 'cctv persons': 'Orang',
                            'bicycle': 'Sepeda', 'car': 'Mobil', 'motorcycle': 'Sepeda Motor', 'airplane': 'Pesawat', 'bus': 'Bus', 'train': 'Kereta',
                            'truck': 'Truk', 'boat': 'Perahu', 'perahu': 'Perahu', 'traffic light': 'Lampu Lalu Lintas', 'fire hydrant': 'Hidran Pemadam',
                            'stop sign': 'Rambu Stop', 'parking meter': 'Meteran Parkir', 'bench': 'Bangku', 'bird': 'Burung', 'cat': 'Kucing',
                            'dog': 'Anjing', 'horse': 'Kuda', 'sheep': 'Domba', 'cow': 'Sapi', 'elephant': 'Gajah', 'bear': 'Beruang',
                            'zebra': 'Zebra', 'giraffe': 'Jerapah', 'backpack': 'Ransel', 'umbrella': 'Payung', 'handbag': 'Tas Tangan',
                            'tie': 'Dasi', 'suitcase': 'Koper', 'frisbee': 'Frisbee', 'skis': 'Ski', 'snowboard': 'Papan Seluncur Salju',
                            'sports ball': 'Bola Olahraga', 'kite': 'Layang-layang', 'baseball bat': 'Pemukul Bisbol', 'baseball glove': 'Sarung Tangan Bisbol',
                            'skateboard': 'Papan Seluncur', 'surfboard': 'Papan Selancar', 'tennis racket': 'Raket Tenis', 'bottle': 'Botol',
                            'plastic': 'Plastik', 'wine glass': 'Gelas Anggur', 'cup': 'Cangkir', 'fork': 'Garpu', 'knife': 'Pisau',
                            'spoon': 'Sendok', 'bowl': 'Mangkuk', 'banana': 'Pisang', 'apple': 'Apel', 'sandwich': 'Roti Lapis',
                            'orange': 'Jeruk', 'broccoli': 'Brokoli', 'carrot': 'Wortel', 'hot dog': 'Hot Dog', 'pizza': 'Pizza',
                            'donut': 'Donat', 'cake': 'Kue', 'chair': 'Kursi', 'couch': 'Sofa', 'potted plant': 'Tanaman Pot',
                            'bed': 'Tempat Tidur', 'dining table': 'Meja Makan', 'toilet': 'Toilet', 'tv': 'TV', 'laptop': 'Laptop',
                            'mouse': 'Mouse', 'remote': 'Remote', 'keyboard': 'Keyboard', 'cell phone': 'Ponsel', 'microwave': 'Microwave',
                            'oven': 'Oven', 'toaster': 'Pemanggang Roti', 'sink': 'Wastafel', 'refrigerator': 'Kulkas', 'book': 'Buku',
                            'clock': 'Jam', 'jam': 'Jam', 'vase': 'Vas', 'scissors': 'Gunting', 'teddy bear': 'Boneka Beruang',
                            'hair drier': 'Pengering Rambut', 'toothbrush': 'Sikat Gigi', 'trash': 'Sampah', 'sampah': 'Sampah',
                            'waste': 'Sampah', 'bag': 'Kantong', 'cardboard': 'Kardus', 'object': 'Objek'
                        };
                        const cleanLabel = labelMap[d.class.toLowerCase()] || d.class;
                        return {
                            label: cleanLabel,
                            confidence: d.confidence,
                            x: d.bbox[0],
                            y: d.bbox[1],
                            w: d.bbox[2],
                            h: d.bbox[3]
                        };
                    }),
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
            }
            catch (createErr) {
                if (createErr.code === 11000 || (createErr.message && createErr.message.includes('E11000'))) {
                    console.log(`[PromotionService] Idempotent creation race detected on detection #${detection.id}. Winning worker is handling analysis.`);
                    const existing = await Report_1.ReportModel.findOne({ sourceDetectionId: detection._id, deletedAt: null }).exec();
                    if (existing) {
                        detection.status = 'PROMOTED';
                        detection.promotedReportId = existing.id;
                        await detection.save();
                        return; // Exit cleanly without executing redundant second inference
                    }
                }
                throw createErr;
            }
            await this.runAiAnalysisAndFinalize(newReportDoc, initialClaimToken, detection, imagePath);
        }
        catch (err) {
            console.error('[PromotionService] Promotion orchestration failed:', err.message);
            detection.status = 'FAILED_PROMOTION';
            detection.rejectedReason = `SYSTEM_ERROR: ${err.message}`;
            await detection.save();
        }
    }
    static isRecoveryRunning = false;
    static async runPeriodicRecoveryJob() {
        if (this.isRecoveryRunning)
            return;
        this.isRecoveryRunning = true;
        try {
            await this.recoverExpiredAnalysis();
            await this.processPendingReanalysis();
        }
        catch (err) {
            console.error('[PromotionService] Periodic recovery job failed:', err.message);
        }
        finally {
            this.isRecoveryRunning = false;
        }
    }
    /**
     * Finalizer to recover stale PROCESSING reports whose lease has expired
     */
    static async recoverExpiredAnalysis() {
        const now = new Date();
        try {
            // 1. Move expired attempts with count < 3 to REANALYSIS_PENDING
            const resPending = await Report_1.ReportModel.updateMany({
                analysisState: 'PROCESSING',
                analysisLeaseExpiresAt: { $lte: now },
                analysisAttemptCount: { $lt: 3 }
            }, {
                $set: {
                    analysisState: 'REANALYSIS_PENDING',
                    aiDataIntegrityStatus: 'PENDING',
                    analysisErrorCode: 'ANALYSIS_LEASE_EXPIRED',
                    analysisClaimToken: null,
                    analysisLeaseExpiresAt: null
                }
            });
            // 2. Move expired attempts with count >= 3 to FAILED
            const resFailed = await Report_1.ReportModel.updateMany({
                analysisState: 'PROCESSING',
                analysisLeaseExpiresAt: { $lte: now },
                analysisAttemptCount: { $gte: 3 }
            }, {
                $set: {
                    analysisState: 'FAILED',
                    aiDataIntegrityStatus: 'SNAPSHOT_MISSING',
                    analysisErrorCode: 'MAX_ANALYSIS_ATTEMPTS',
                    analysisClaimToken: null,
                    analysisLeaseExpiresAt: null
                }
            });
            const totalRecovered = resPending.modifiedCount + resFailed.modifiedCount;
            if (totalRecovered > 0) {
                console.log(`[PromotionService] Recovered ${totalRecovered} expired analysis leases (${resPending.modifiedCount} REANALYSIS_PENDING, ${resFailed.modifiedCount} FAILED).`);
            }
            return totalRecovered;
        }
        catch (err) {
            console.error('[PromotionService] recoverExpiredAnalysis failed:', err.message);
            return 0;
        }
    }
    /**
     * Process REANALYSIS_PENDING reports whose retry delay backoff has elapsed
     */
    static async processPendingReanalysis() {
        const now = new Date();
        try {
            const pendingReports = await Report_1.ReportModel.find({
                analysisState: 'REANALYSIS_PENDING',
                deletedAt: null,
                $or: [
                    { analysisNextRetryAt: null },
                    { analysisNextRetryAt: { $lte: now } }
                ]
            }).limit(5).exec();
            let processed = 0;
            for (const report of pendingReports) {
                if (!report.sourceDetectionId)
                    continue;
                const detection = await AiDetection_1.AiDetectionModel.findById(report.sourceDetectionId).exec();
                if (!detection)
                    continue;
                const claimToken = crypto.randomUUID();
                const leaseExpiresAt = new Date(now.getTime() + 30_000); // 30 second lease
                const claimedReport = await Report_1.ReportModel.findOneAndUpdate({
                    _id: report._id,
                    analysisState: 'REANALYSIS_PENDING',
                    analysisAttemptCount: { $lt: 3 }
                }, {
                    $set: {
                        analysisState: 'PROCESSING',
                        aiDataIntegrityStatus: 'PENDING',
                        analysisStartedAt: now,
                        analysisLeaseExpiresAt: leaseExpiresAt,
                        analysisErrorCode: null,
                        analysisClaimToken: claimToken,
                        analysisNextRetryAt: null
                    },
                    $inc: { analysisAttemptCount: 1 }
                }, { new: true }).exec();
                if (claimedReport) {
                    processed++;
                    const evidence = await AiEvidence_1.AiEvidenceModel.findOne({ linkedDetectionId: detection._id });
                    const imagePath = evidence ? (evidence.storageKey || evidence.storage?.key || '') : path_1.default.join(os_1.default.tmpdir(), 'eyeco', `cctv_capture_${detection.cameraId}.jpg`);
                    console.log(`[PromotionService] Processing REANALYSIS_PENDING Report #${claimedReport.id} (attempt #${claimedReport.analysisAttemptCount})...`);
                    await this.runAiAnalysisAndFinalize(claimedReport, claimToken, detection, imagePath);
                }
            }
            return processed;
        }
        catch (err) {
            console.error('[PromotionService] processPendingReanalysis failed:', err.message);
            return 0;
        }
    }
    static async runAiAnalysisAndFinalize(reportDoc, claimToken, detection, imagePath) {
        let snapshot = null;
        let decisionResult = null;
        try {
            const fullPath = path_1.default.isAbsolute(imagePath) ? imagePath : path_1.default.join(process.cwd(), 'public', imagePath.startsWith('/') ? imagePath.slice(1) : imagePath);
            if (fs_1.default.existsSync(fullPath)) {
                const aiRes = await aiEngine_1.aiEngine.analyzeImage(fullPath, { reportId: reportDoc.id });
                snapshot = aiRes.snapshot;
                decisionResult = aiRes.decision;
            }
        }
        catch (err) {
            console.warn(`[PromotionService] aiEngine.analyzeImage failed for CCTV detection #${detection.id}:`, err);
        }
        // Atomic update guarded by claimToken
        const isSuccess = Boolean(snapshot && decisionResult);
        const snapObj = snapshot;
        const decObj = decisionResult;
        const nextAttemptCount = reportDoc.analysisAttemptCount || 1;
        const maxExhausted = nextAttemptCount >= 3;
        const updatedReport = await Report_1.ReportModel.findOneAndUpdate({
            _id: reportDoc._id,
            analysisClaimToken: claimToken,
            analysisState: 'PROCESSING'
        }, {
            $set: {
                activeSnapshotId: isSuccess && snapObj ? snapObj._id : null,
                aiStatus: isSuccess && decObj ? decObj.status : reportDoc.aiStatus,
                violationScore: isSuccess && decObj ? decObj.violationScore : null,
                decisionConfidence: isSuccess && decObj ? decObj.decisionConfidence : null,
                objectConfidence: isSuccess && decObj ? decObj.objectConfidence : null,
                sceneConfidence: isSuccess && decObj ? decObj.sceneConfidence : null,
                priority: isSuccess && decObj ? decObj.priority : null,
                recommendedAction: isSuccess && decObj ? decObj.recommendedAction : 'Verifikasi operator dan jalankan analisis ulang',
                analysisState: isSuccess ? 'READY' : (maxExhausted ? 'FAILED' : 'REANALYSIS_PENDING'),
                aiDataIntegrityStatus: isSuccess ? 'VALID' : (maxExhausted ? 'SNAPSHOT_MISSING' : 'PENDING'),
                analysisErrorCode: isSuccess ? null : (maxExhausted ? 'MAX_ANALYSIS_ATTEMPTS' : 'ANALYSIS_FAILED_RETRY_PENDING'),
                analysisLeaseExpiresAt: null,
                analysisClaimToken: null,
                analysisNextRetryAt: isSuccess || maxExhausted ? null : new Date(Date.now() + Math.pow(2, nextAttemptCount) * 5000)
            }
        }, { new: true }).exec();
        if (!updatedReport) {
            console.warn(`[PromotionService] Stale worker write rejected! Report #${reportDoc.id} claim token ${claimToken} lost or lease expired.`);
            if (snapObj && snapObj._id) {
                try {
                    const isAlreadyActive = await Report_1.ReportModel.exists({ activeSnapshotId: snapObj._id });
                    if (!isAlreadyActive) {
                        console.warn(`[PromotionService] Safely deleting unreferenced snapshot ${snapObj._id} from stale worker attempt.`);
                        const { AiSnapshotModel } = require('../../database/models/AiSnapshot');
                        await AiSnapshotModel.deleteOne({ _id: snapObj._id, analysisClaimToken: claimToken });
                    }
                }
                catch (_) { }
            }
            return;
        }
        detection.promotedReportId = updatedReport.id;
        detection.expiresAt = null;
        await detection.save();
        const createdReport = updatedReport;
        const adminUser = await User_1.UserModel.findOne({ id: 1 });
        const adminObjectId = adminUser ? adminUser._id : new mongoose_1.default.Types.ObjectId('000000000000000000000001');
        // Catat Timeline awal insiden
        await TimelineEvent_1.TimelineEventModel.insertMany([
            {
                reportId: createdReport._id,
                eventVersion: 1,
                type: 'DETECTION',
                actorId: adminObjectId,
                actorName: 'YOLOv8',
                actorRole: 'AI',
                title: 'Deteksi AI Otomatis',
                description: `Sistem AI mendeteksi ancaman dengan status ${createdReport.aiStatus} di ${createdReport.location}.`,
                metadata: { confidence: createdReport.aiConfidence, camera: `CCTV-CAM-${detection.cameraId}` },
                ipAddress: '127.0.0.1',
                userAgent: 'EYECO AI Engine',
                createdAt: new Date()
            },
            {
                reportId: createdReport._id,
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
        // Kirim Notifikasi (HANYA dibuat bila analisis READY)
        if (createdReport.analysisState === 'READY' && createdReport.activeSnapshotId) {
            await NotificationDispatcher_1.NotificationDispatcher.dispatch(createdReport);
        }
    }
    /**
     * Mengambil rules dari database dengan mekanisme cache memori (TTL 30 detik).
     */
    static async getSystemRules() {
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
            const dbRules = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'ai.rules' });
            if (dbRules && dbRules.value) {
                this.cachedRules = { ...defaultRules, ...dbRules.value };
            }
            else {
                this.cachedRules = defaultRules;
            }
            this.lastCacheRefresh = now;
        }
        catch (err) {
            this.cachedRules = defaultRules;
        }
        return this.cachedRules;
    }
    /**
     * Helper: Memetakan status kegagalan evaluasi ke status database AiDetection
     */
    static mapReasonToStatus(reason) {
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
exports.PromotionService = PromotionService;
