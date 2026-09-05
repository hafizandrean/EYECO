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
const EvidenceService_1 = require("./EvidenceService");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
class CctvAutoReportService {
    static isRunning = false;
    static intervalId = null;
    static cooldowns = [];
    static COOLDOWN_MS = 10_000;
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
    // Process a single camera snapshot using OS Temp directory & Private R2 Storage
    static async processCameraSnapshot(camera) {
        try {
            let lastCapturePath = path_1.default.join(os_1.default.tmpdir(), 'eyeco', `cctv_capture_${camera.id}.jpg`);
            if (!fs_1.default.existsSync(lastCapturePath)) {
                return;
            }
            const detectionResult = await (0, aiDetection_service_1.detectFile)(lastCapturePath, { conf: 0.15 });
            if (!detectionResult || !detectionResult.boxes)
                return;
            // If there are ANY detections, allow it to proceed. Don't restrict to person only.
            const personClasses = ['person', 'cctv persons', 'people', 'sitting', 'standing', 'orang'];
            const personDetections = detectionResult.boxes.filter(b => personClasses.some(pc => b.label.toLowerCase().includes(pc)));
            // if (personDetections.length === 0) return;
            // Find admin in the same workspace as the camera, or fallback to global admin
            let adminUser = await User_1.UserModel.findOne({ workspaceId: camera.workspaceId, role: 'admin' }).sort({ id: 1 }).lean().exec();
            if (!adminUser) {
                adminUser = await User_1.UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean().exec();
            }
            const creatorId = adminUser ? adminUser.id : 1;
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
            // Allow all detections to generate a report
            // if (aiStatus !== 'TINGGI' && aiStatus !== 'SEDANG') {
            //   return;
            // }
            const maxPersonConf = Math.max(...personDetections.map(d => d.confidence));
            // Save captured image to OS Temp directory first (out of repo)
            const tempDir = path_1.default.join(os_1.default.tmpdir(), 'eyeco');
            if (!fs_1.default.existsSync(tempDir))
                fs_1.default.mkdirSync(tempDir, { recursive: true });
            const uniqueFilename = `evidence_${Date.now()}_${camera.id}.jpg`;
            const tempAbsolutePath = path_1.default.join(tempDir, uniqueFilename);
            fs_1.default.copyFileSync(lastCapturePath, tempAbsolutePath);
            const fileBuffer = fs_1.default.readFileSync(tempAbsolutePath);
            const fileHash = crypto_1.default.createHash('sha256').update(fileBuffer).digest('hex');
            const newReport = await ReportRepository_1.ReportRepository.create({
                location: camera.location || 'Lokasi CCTV',
                aiStatus,
                aiConfidence: decisionConfidence || Math.round(maxPersonConf * 100),
                image: `/uploads/laporan_auto/${uniqueFilename}`,
                identity: `CCTV-CAM-${String(camera.id).padStart(2, '0')}`,
                sourceType: 'AI_CCTV',
                additionalNotes: `Deteksi otomatis dari CCTV ${camera.name} di ${camera.location}. Terdeteksi ${personDetections.length} orang.`,
                boundingBoxes: detectionResult.boxes.map(b => {
                    const labelMap = {
                        'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang', 'cctv persons': 'Orang',
                        'trash': 'Sampah', 'sampah': 'Sampah', 'boat': 'Perahu', 'perahu': 'Perahu'
                    };
                    const cleanLabel = labelMap[b.label.toLowerCase()] || b.label;
                    return { label: cleanLabel, confidence: b.confidence, x: b.x, y: b.y, w: b.w, h: b.h };
                }),
            }, creatorId, camera.workspaceId);
            if (newReport) {
                // Save evidence via EvidenceService (R2 Upload + Verification + DB Persist)
                const evidence = await EvidenceService_1.EvidenceService.saveEvidence(camera.id, tempAbsolutePath, new Date(), newReport._id, newReport.id);
                if (evidence && evidence.storage && evidence.storage.key) {
                    await Report_1.ReportModel.updateOne({ _id: newReport._id }, {
                        $set: {
                            r2Key: evidence.storage.key,
                            primaryEvidenceId: evidence._id,
                            thumbnailEvidenceId: evidence._id,
                            evidenceIds: [evidence._id],
                            violationScore,
                            objectConfidence: Math.round(Math.max(...detectionResult.boxes.map(b => b.confidence)) * 100),
                            decisionConfidence: decisionConfidence || Math.round(maxPersonConf * 100),
                            priority: aiStatus === 'TINGGI' ? 'HIGH' : (aiStatus === 'SEDANG' ? 'MEDIUM' : 'LOW'),
                        }
                    }).exec();
                }
                console.log(`[CctvAutoReportService] ✅ Auto-report #${newReport.id} for camera #${camera.id}`);
            }
            this.setCooldown(camera.id);
        }
        catch (err) {
            console.error(`[CctvAutoReportService] Error camera #${camera.id}:`, err);
        }
    }
    // ── Pipeline-integration mode (called from AiPipelineScheduler) ──
    static async processDetection(frame, detection) {
        try {
            if (this.isOnCooldown(frame.cameraId))
                return null;
            const camera = await Cctv_1.CctvModel.findOne({ id: frame.cameraId }).lean().exec();
            if (!camera)
                return null;
            const workspaceId = camera.workspaceId;
            let admin = await User_1.UserModel.findOne({ workspaceId, role: 'admin' }).sort({ createdAt: 1 }).lean().exec();
            if (!admin) {
                admin = await User_1.UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean().exec();
            }
            const uploaderId = admin ? admin.id : 1;
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
            // Prepare temp image file path
            const tempDir = path_1.default.join(os_1.default.tmpdir(), 'eyeco');
            if (!fs_1.default.existsSync(tempDir))
                fs_1.default.mkdirSync(tempDir, { recursive: true });
            const uniqueFilename = `evidence_${Date.now()}_${frame.cameraId}.jpg`;
            const tempAbsolutePath = path_1.default.join(tempDir, uniqueFilename);
            let sourceAbsolutePath = path_1.default.isAbsolute(frame.imagePath) ? frame.imagePath : path_1.default.join(process.cwd(), 'public', frame.imagePath);
            if (!fs_1.default.existsSync(sourceAbsolutePath)) {
                const altTemp = path_1.default.join(tempDir, path_1.default.basename(frame.imagePath));
                if (fs_1.default.existsSync(altTemp))
                    sourceAbsolutePath = altTemp;
            }
            if (fs_1.default.existsSync(sourceAbsolutePath)) {
                fs_1.default.copyFileSync(sourceAbsolutePath, tempAbsolutePath);
            }
            const labelMap = {
                'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang',
                'trash': 'Sampah', 'sampah': 'Sampah', 'boat': 'Perahu', 'perahu': 'Perahu'
            };
            const indonesianClasses = detection.detections.map(d => labelMap[d.class.toLowerCase()] || d.class);
            const maxConfidence = Math.max(...detection.detections.map(d => d.confidence), 0);
            // ── STEP 1: Buat laporan di DB SEKARANG (tanpa menunggu R2 upload) ──
            // Laporan langsung muncul di daftar laporan tanpa delay
            const report = await ReportRepository_1.ReportRepository.create({
                location: camera.location,
                aiStatus,
                aiConfidence: Math.round(maxConfidence * 100),
                image: `/uploads/laporan_auto/${uniqueFilename}`,
                identity: `AI Deteksi: ${camera.name}`,
                sourceType: 'AI_CCTV',
                additionalNotes: `Deteksi otomatis pelanggaran ${aiStatus} dari CCTV ${camera.name} di ${camera.location}. Objek: ${indonesianClasses.join(', ')}.`,
                boundingBoxes: detection.detections.map(d => ({
                    label: labelMap[d.class.toLowerCase()] || d.class,
                    confidence: d.confidence,
                    x: d.bbox[0], y: d.bbox[1], w: d.bbox[2], h: d.bbox[3]
                }))
            }, uploaderId, camera.workspaceId);
            // Set cooldown & update detection status immediately — tidak perlu tunggu upload
            this.setCooldown(frame.cameraId);
            AiDetection_1.AiDetectionModel.updateOne({ id: detection.id }, { $set: { status: 'PROMOTED', promotedReportId: report.id } }).exec().catch(() => { });
            console.log(`[CctvAutoReportService] ✅ Auto-report #${report.id} MUNCUL LANGSUNG di daftar untuk kamera #${frame.cameraId}`);
            // ── STEP 2: Upload gambar ke R2 di BACKGROUND (tidak blocking UI) ──
            const reportId = report.id;
            const reportMongoId = report._id;
            setImmediate(async () => {
                try {
                    const evidence = await EvidenceService_1.EvidenceService.saveEvidence(frame.cameraId, tempAbsolutePath, new Date(), detection._id, reportId);
                    if (evidence && evidence.storage && evidence.storage.key) {
                        await Report_1.ReportModel.updateOne({ _id: reportMongoId }, {
                            $set: {
                                r2Key: evidence.storage.key,
                                primaryEvidenceId: evidence._id,
                                thumbnailEvidenceId: evidence._id,
                                evidenceIds: [evidence._id],
                                violationScore: aiStatus === 'TINGGI' ? 85 : (aiStatus === 'SEDANG' ? 65 : 30),
                                objectConfidence: Math.round(maxConfidence * 100),
                                decisionConfidence: Math.round(maxConfidence * 100),
                                priority: aiStatus === 'TINGGI' ? 'HIGH' : (aiStatus === 'SEDANG' ? 'MEDIUM' : 'LOW'),
                                aiDataIntegrityStatus: 'VALID'
                            }
                        }).exec();
                        console.log(`[CctvAutoReportService] 📦 Evidence R2 selesai untuk laporan #${reportId}`);
                    }
                }
                catch (bgErr) {
                    console.warn(`[CctvAutoReportService] Background R2 upload gagal untuk laporan #${reportId}:`, bgErr);
                }
            });
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
