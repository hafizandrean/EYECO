"use strict";
/**
 * EYECO — CCTV Auto-Report Service
 *
 * Service yang menonton frame CCTV dan otomatis membuat laporan
 * ketika terdeteksi manusia (person) di frame.
 * Dilengkapi cooldown per kamera untuk mencegah duplikasi.
 *
 * Dual-mode: dipanggil dari AiPipelineScheduler.processDetection()
 * atau dijalankan standalone via start()/stop().
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvAutoReportService = void 0;
const Cctv_1 = require("../../database/models/Cctv");
const Report_1 = require("../../database/models/Report");
const User_1 = require("../../database/models/User");
const ReportRepository_1 = require("../../database/repositories/ReportRepository");
const AiDetection_1 = require("../../database/models/AiDetection");
const aiDetection_service_1 = require("../../services/aiDetection.service");
const aiEngine_1 = require("../../services/ai/aiEngine");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
class CctvAutoReportService {
    static isRunning = false;
    static intervalId = null;
    static cooldowns = [];
    static COOLDOWN_MS = 60_000;
    static POLL_INTERVAL_MS = 10_000;
    static workspaceId = null;
    // ── Standalone mode (start/stop background cycle) ──
    static start(workspaceId) {
        if (this.intervalId)
            return;
        this.workspaceId = workspaceId ?? null;
        this.isRunning = true;
        console.log(`[CctvAutoReportService] Auto-report monitoring started${workspaceId ? ` for workspace ${workspaceId}` : ''}.`);
        this.intervalId = setInterval(() => this.cycle(), this.POLL_INTERVAL_MS);
        setTimeout(() => this.cycle(), 1000);
    }
    static stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        this.workspaceId = null;
        console.log('[CctvAutoReportService] Auto-report monitoring stopped.');
    }
    static getStatus() {
        return { running: this.isRunning };
    }
    // Standalone cycle: capture + detect person + create report
    static async cycle() {
        try {
            const query = {
                isActive: true,
                monitoringEnabled: true,
                status: { $in: ['ONLINE', 'MONITORING'] }
            };
            if (this.workspaceId !== null) {
                query.workspaceId = this.workspaceId;
            }
            const cameras = await Cctv_1.CctvModel.find(query).lean().exec();
            for (const camera of cameras) {
                if (this.isOnCooldown(camera.id))
                    continue;
                await this.processCameraSnapshot(camera);
            }
        }
        catch (err) {
            console.error('[CctvAutoReportService] Cycle error:', err);
        }
    }
    // Process a single camera snapshot
    static async processCameraSnapshot(camera) {
        try {
            const lastCapturePath = path_1.default.resolve(__dirname, `../../../public/uploads/cctv_capture_${camera.id}.jpg`);
            if (!fs_1.default.existsSync(lastCapturePath))
                return;
            const detectionResult = await (0, aiDetection_service_1.detectFile)(lastCapturePath, { conf: 0.15 });
            if (!detectionResult || !detectionResult.boxes)
                return;
            const personClasses = ['person', 'cctv persons', 'people', 'sitting', 'standing', 'orang'];
            const personDetections = detectionResult.boxes.filter(b => personClasses.some(pc => b.label.toLowerCase().includes(pc)));
            if (personDetections.length === 0)
                return;
            // Find admin in the same workspace as the camera
            const adminUser = await User_1.UserModel.findOne({ workspaceId: camera.workspaceId, role: 'admin' }).sort({ id: 1 }).lean().exec();
            if (!adminUser)
                return;
            // AI Engine analysis
            let aiStatus = 'Tidak Terindikasi';
            let violationScore = 0;
            let decisionConfidence = 0;
            try {
                const aiAnalysis = await aiEngine_1.aiEngine.analyze(lastCapturePath);
                const rawStatus = aiAnalysis.decision.status;
                if (rawStatus === 'Indikasi Tinggi' || rawStatus === 'TINGGI') {
                    aiStatus = 'TINGGI';
                }
                else if (rawStatus === 'Indikasi Sedang' || rawStatus === 'SEDANG') {
                    aiStatus = 'SEDANG';
                }
                else if (rawStatus === 'Indikasi Rendah' || rawStatus === 'RENDAH') {
                    aiStatus = 'RENDAH';
                }
                else {
                    aiStatus = 'Tidak Terindikasi';
                }
                violationScore = aiAnalysis.decision.violationScore;
                decisionConfidence = aiAnalysis.decision.decisionConfidence;
            }
            catch {
                const trashDets = detectionResult.boxes.filter(b => !personClasses.some(pc => b.label.toLowerCase().includes(pc)));
                if (trashDets.length === 0) {
                    aiStatus = 'Tidak Terindikasi';
                    violationScore = Math.round(10 + 15 * Math.max(...personDetections.map(d => d.confidence)));
                }
                else {
                    const hasOverlap = checkOverlap(personDetections, trashDets);
                    if (hasOverlap) {
                        aiStatus = 'SEDANG';
                        violationScore = Math.round(50 + 20 * Math.max(...trashDets.map(d => d.confidence)));
                    }
                    else {
                        aiStatus = 'TINGGI';
                        violationScore = Math.round(70 + 25 * Math.max(...trashDets.map(d => d.confidence)));
                    }
                }
            }
            // Only auto-report if it triggers a medium (SEDANG) or high (TINGGI) violation
            if (aiStatus !== 'TINGGI' && aiStatus !== 'SEDANG') {
                return;
            }
            const maxPersonConf = Math.max(...personDetections.map(d => d.confidence));
            // Copy the captured image to a unique filepath to preserve evidence from being overwritten
            const uniqueFilename = `evidence_${Date.now()}_${camera.id}.jpg`;
            const uniqueRelativePath = `/uploads/${uniqueFilename}`;
            const uniqueAbsolutePath = path_1.default.join(process.cwd(), 'public', uniqueRelativePath);
            try {
                if (fs_1.default.existsSync(lastCapturePath)) {
                    fs_1.default.copyFileSync(lastCapturePath, uniqueAbsolutePath);
                }
            }
            catch (copyErr) {
                console.error('[CctvAutoReportService] Failed to copy standalone evidence image:', copyErr);
            }
            const newReport = await ReportRepository_1.ReportRepository.create({
                location: camera.location || 'Lokasi CCTV',
                aiStatus,
                aiConfidence: decisionConfidence || Math.round(maxPersonConf * 100),
                image: uniqueRelativePath,
                identity: `CCTV-CAM-${String(camera.id).padStart(2, '0')}`,
                sourceType: 'AI_CCTV',
                additionalNotes: `Deteksi otomatis dari CCTV ${camera.name} di ${camera.location}. Terdeteksi ${personDetections.length} orang.`,
                boundingBoxes: detectionResult.boxes.map(b => {
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
                    const cleanLabel = labelMap[b.label.toLowerCase()] || b.label;
                    return {
                        label: cleanLabel,
                        confidence: b.confidence,
                        x: b.x,
                        y: b.y,
                        w: b.w,
                        h: b.h
                    };
                }),
            }, adminUser.id);
            if (newReport) {
                // Upload evidence ke R2 (laporan_auto) + update image/r2Key
                const { R2StorageService } = await Promise.resolve().then(() => __importStar(require('../../services/R2StorageService')));
                try {
                    if (fs_1.default.existsSync(uniqueAbsolutePath)) {
                        const r2Key = `eyecofiles/laporan_auto/${newReport.id}/${uniqueFilename}`;
                        await R2StorageService.uploadFile(uniqueAbsolutePath, r2Key, 'image/jpeg', true);
                        const r2Url = await R2StorageService.getPublicUrl(r2Key);
                        const imagePath = `/uploads/laporan_auto/${newReport.id}/${uniqueFilename}`;
                        await Report_1.ReportModel.updateOne({ _id: newReport._id }, { $set: { image: imagePath, r2Key, r2Url } }).exec();
                        // Keep local file for fallback serving & continuous AI pipeline
                        // try { fs.unlinkSync(uniqueAbsolutePath); } catch { /* ignore */ }
                        console.log(`[CctvAutoReportService] Evidence #${newReport.id} uploaded to R2: ${r2Key}`);
                    }
                }
                catch (r2Err) {
                    console.warn('[CctvAutoReportService] R2 auto-report evidence upload failed (local fallback):', r2Err.message);
                }
                await Report_1.ReportModel.updateOne({ _id: newReport._id }, { $set: {
                        violationScore,
                        objectConfidence: Math.round(Math.max(...detectionResult.boxes.map(b => b.confidence)) * 100),
                        decisionConfidence: decisionConfidence || Math.round(maxPersonConf * 100),
                        priority: aiStatus === 'TINGGI' ? 'HIGH' : (aiStatus === 'SEDANG' ? 'MEDIUM' : 'LOW'),
                    } }).exec();
                console.log(`[CctvAutoReportService] ✅ Auto-report #${newReport.id} for camera #${camera.id}`);
            }
            this.setCooldown(camera.id);
        }
        catch (err) {
            console.error(`[CctvAutoReportService] Error camera #${camera.id}:`, err);
        }
    }
    // ── Pipeline-integration mode (called from AiPipelineScheduler) ──
    /**
     * Process a detection from the AI pipeline.
     * Called by AiPipelineScheduler when inference detects something.
     */
    static async processDetection(frame, detection) {
        try {
            if (this.isOnCooldown(frame.cameraId))
                return null;
            // Only promote if it qualifies as a violation (MEDIUM, HIGH, or CRITICAL severity)
            const hasViolation = ['MEDIUM', 'HIGH', 'CRITICAL'].includes(detection.severity);
            if (!hasViolation)
                return null;
            const camera = await Cctv_1.CctvModel.findOne({ id: frame.cameraId }).lean().exec();
            if (!camera)
                return null;
            const workspaceId = camera.workspaceId;
            let admin = await User_1.UserModel.findOne({ workspaceId, role: 'admin' })
                .sort({ createdAt: 1 }).lean().exec();
            if (!admin) {
                admin = await User_1.UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean().exec();
            }
            const uploaderId = admin ? admin.id : 1;
            const boundingBoxes = detection.detections.map(d => {
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
                    x: d.bbox[0], y: d.bbox[1], w: d.bbox[2], h: d.bbox[3]
                };
            });
            const maxConfidence = Math.max(...detection.detections.map(d => d.confidence), 0);
            let aiStatus = 'Tidak Terindikasi';
            if (detection.severity === 'CRITICAL' || detection.severity === 'HIGH') {
                aiStatus = 'TINGGI';
            }
            else if (detection.severity === 'MEDIUM') {
                aiStatus = 'SEDANG';
            }
            else if (detection.severity === 'LOW') {
                aiStatus = 'RENDAH';
            }
            // Copy the captured frame image to a unique filepath to preserve evidence from being overwritten
            const uniqueFilename = `evidence_${Date.now()}_${frame.cameraId}.jpg`;
            const uniqueRelativePath = `/uploads/${uniqueFilename}`;
            const uniqueAbsolutePath = path_1.default.join(process.cwd(), 'public', uniqueRelativePath);
            const sourceAbsolutePath = path_1.default.join(process.cwd(), 'public', frame.imagePath);
            try {
                if (fs_1.default.existsSync(sourceAbsolutePath)) {
                    fs_1.default.copyFileSync(sourceAbsolutePath, uniqueAbsolutePath);
                    console.log(`[CctvAutoReportService] Saved unique evidence image: ${uniqueRelativePath}`);
                }
            }
            catch (copyErr) {
                console.error('[CctvAutoReportService] Failed to copy pipeline evidence image:', copyErr);
            }
            const labelMap = {
                'person': 'Orang',
                'people': 'Orang',
                'sitting': 'Orang',
                'standing': 'Orang',
                'orang': 'Orang',
                'trash': 'Sampah',
                'sampah': 'Sampah',
                'boat': 'Perahu',
                'perahu': 'Perahu',
                'clock': 'Jam',
                'jam': 'Jam',
                'plastic': 'Plastik',
                'bottle': 'Botol',
                'bag': 'Kantong',
                'waste': 'Sampah',
                'cardboard': 'Kardus',
                'object': 'Objek'
            };
            const indonesianClasses = detection.detections.map(d => labelMap[d.class.toLowerCase()] || d.class);
            const report = await ReportRepository_1.ReportRepository.create({
                location: camera.location,
                aiStatus,
                aiConfidence: Math.round(maxConfidence * 100),
                image: uniqueRelativePath,
                identity: `AI Deteksi: ${camera.name}`,
                sourceType: 'AI_CCTV',
                additionalNotes: `Deteksi otomatis pelanggaran ${aiStatus} dari CCTV ${camera.name} di ${camera.location}. Objek: ${indonesianClasses.join(', ')}.`,
                boundingBoxes
            }, uploaderId);
            this.setCooldown(frame.cameraId);
            await AiDetection_1.AiDetectionModel.updateOne({ id: detection.id }, { $set: { status: 'PROMOTED', promotedReportId: report.id } }).exec();
            console.log(`[CctvAutoReportService] Auto-report #${report.id} for camera #${frame.cameraId}`);
            return { reportId: report.id, autoReported: true };
        }
        catch (err) {
            console.error('[CctvAutoReportService] processDetection error:', err);
            return null;
        }
    }
    static clearCooldown(cameraId) {
        this.cooldowns = this.cooldowns.filter(c => c.cameraId !== cameraId);
    }
    static getCooldownRemaining(cameraId) {
        const entry = this.cooldowns.find(c => c.cameraId === cameraId);
        if (!entry)
            return 0;
        return Math.max(0, entry.cooldownUntil - Date.now());
    }
    static getCooldownStatus() {
        const now = Date.now();
        return this.cooldowns
            .filter(c => c.cooldownUntil > now)
            .map(c => ({ cameraId: c.cameraId, remainingMs: c.cooldownUntil - now }));
    }
    static isOnCooldown(cameraId) {
        const now = Date.now();
        this.cooldowns = this.cooldowns.filter(c => c.cooldownUntil > now);
        return this.cooldowns.some(c => c.cameraId === cameraId);
    }
    static setCooldown(cameraId) {
        this.cooldowns.push({ cameraId, cooldownUntil: Date.now() + this.COOLDOWN_MS });
    }
}
exports.CctvAutoReportService = CctvAutoReportService;
// ── Standalone helper ──
function checkOverlap(personDets, trashDets) {
    for (const trash of trashDets) {
        const tx1 = trash.x, ty1 = trash.y, tx2 = trash.x + trash.w, ty2 = trash.y + trash.h;
        const trashArea = (tx2 - tx1) * (ty2 - ty1);
        if (trashArea <= 0)
            continue;
        for (const person of personDets) {
            const px1 = person.x, py1 = person.y, px2 = person.x + person.w, py2 = person.y + person.h;
            const ix1 = Math.max(tx1, px1), iy1 = Math.max(ty1, py1);
            const ix2 = Math.min(tx2, px2), iy2 = Math.min(ty2, py2);
            if (ix1 < ix2 && iy1 < iy2) {
                const interArea = (ix2 - ix1) * (iy2 - iy1);
                if (interArea / trashArea > 0.3)
                    return true;
            }
        }
    }
    return false;
}
