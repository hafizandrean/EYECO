"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromotionService = void 0;
const AiEvidence_1 = require("../../database/models/AiEvidence");
const Report_1 = require("../../database/models/Report");
const User_1 = require("../../database/models/User");
const TimelineEvent_1 = require("../../database/models/TimelineEvent");
const SystemSettings_1 = require("../../database/models/SystemSettings");
const NotificationDispatcher_1 = require("../../notifications/NotificationDispatcher");
const ConfidenceRule_1 = require("./ConfidenceRule");
const VerificationRule_1 = require("./VerificationRule");
const CooldownRule_1 = require("./CooldownRule");
const DuplicateRule_1 = require("./DuplicateRule");
const mongoose_1 = __importDefault(require("mongoose"));
class PromotionService {
    static cachedRules = null;
    static lastCacheRefresh = 0;
    static rules = [
        new ConfidenceRule_1.ConfidenceRule(),
        new VerificationRule_1.VerificationRule(),
        new CooldownRule_1.CooldownRule(),
        new DuplicateRule_1.DuplicateRule()
    ];
    /**
     * Orchestrates the evaluation of rules.
     * Promotes the detection if all rules pass, otherwise logs the specific rejectedReason.
     */
    static async evaluateDetection(detection) {
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
            const context = {
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
            const evidence = await AiEvidence_1.AiEvidenceModel.findOne({ linkedDetectionId: detection._id });
            const imagePath = evidence ? evidence.storageKey : `/uploads/cctv_capture_${detection.cameraId}.jpg`;
            // Cari admin utama untuk relasi pelapor default
            const adminUser = await User_1.UserModel.findOne({ id: 1 });
            const adminObjectId = adminUser ? adminUser._id : new mongoose_1.default.Types.ObjectId('000000000000000000000001');
            // Cari max integer ID Laporan
            const lastReport = await Report_1.ReportModel.findOne().sort({ id: -1 }).exec();
            const nextReportId = lastReport ? lastReport.id + 1 : 1;
            let aiStatus = 'Tidak Terindikasi';
            if (detection.severity === 'CRITICAL' || detection.severity === 'HIGH')
                aiStatus = 'TINGGI';
            else if (detection.severity === 'MEDIUM')
                aiStatus = 'SEDANG';
            else if (detection.severity === 'LOW')
                aiStatus = 'RENDAH';
            const newReport = await Report_1.ReportModel.create({
                id: nextReportId,
                userId: adminObjectId,
                location: detection.location,
                timestamp: new Date(),
                aiStatus,
                aiConfidence: Math.round(detection.confidence * 100),
                adminStatus: 'MENUNGGU',
                image: imagePath,
                identity: `CCTV-CAM-${detection.cameraId.toString().padStart(2, '0')}`,
                // sourceType: 'AI_CCTV', — disabled
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
            await TimelineEvent_1.TimelineEventModel.insertMany([
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
            await NotificationDispatcher_1.NotificationDispatcher.dispatch(newReport);
        }
        catch (err) {
            console.error('[PromotionService] Promotion orchestration failed:', err.message);
            detection.status = 'FAILED_PROMOTION';
            detection.rejectedReason = `SYSTEM_ERROR: ${err.message}`;
            await detection.save();
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
