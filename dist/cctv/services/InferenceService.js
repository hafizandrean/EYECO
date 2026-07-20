"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InferenceService = void 0;
const AiDetection_1 = require("../../database/models/AiDetection");
const AiModelManager_1 = require("./AiModelManager");
const TrackingEngine_1 = require("./TrackingEngine");
const EvidenceService_1 = require("./EvidenceService");
const crypto_1 = __importDefault(require("crypto"));
class InferenceService {
    static tracker = new TrackingEngine_1.TrackingEngine();
    /**
     * Executes AI model inference on a captured frame using the active model engine.
     * Tracks detections, saves visual evidence, and logs the raw AI detection document.
     */
    static async executeInference(frame) {
        const startTime = Date.now();
        try {
            // 1. Dapatkan AI engine aktif untuk kamera ini (mendukung Canary Routing)
            const engine = await AiModelManager_1.AiModelManager.getEngineForCamera(frame.cameraId);
            console.log(`[InferenceService] Running inference on Camera #${frame.cameraId} via ${engine.name}`);
            // 2. Jalankan inferensi deteksi objek
            const rawResults = await engine.detect(frame);
            // Pre-Filtering: Lewati penyimpanan jika tidak ada deteksi atau confidence rendah
            const maxConfidence = rawResults.length > 0 ? Math.max(...rawResults.map(r => r.confidence)) : 0;
            if (rawResults.length === 0 || maxConfidence < 0.5) {
                return null;
            }
            // 3. Asosiasikan ID pelacakan lintas-frame menggunakan Tracking Engine
            const trackedDetections = this.tracker.track(rawResults);
            // Tentukan tingkat bahaya (Severity) berdasarkan kelas deteksi
            const hasTrash = trackedDetections.some(d => ['trash', 'plastic_bag', 'plastic_bottle', 'industrial_waste', 'chemical_foam', 'household_trash', 'organic_waste'].includes(d.class));
            const hasPerson = trackedDetections.some(d => d.class === 'person');
            const hasBoat = trackedDetections.some(d => ['boat', 'debris', 'logs', 'oil_spill'].includes(d.class));
            let severity = 'LOW';
            if (hasTrash) {
                severity = 'HIGH';
                if (hasPerson)
                    severity = 'CRITICAL'; // Orang membuang sampah
            }
            else if (hasBoat) {
                severity = 'MEDIUM';
            }
            // 4. Dapatkan autoincrement ID berikutnya untuk AiDetection dengan retry jika terjadi collision
            let attempts = 0;
            let aiDetection = null;
            const trackingId = crypto_1.default.randomUUID();
            while (attempts < 5) {
                try {
                    const lastDetection = await AiDetection_1.AiDetectionModel.findOne().sort({ id: -1 }).exec();
                    const nextId = lastDetection ? lastDetection.id + 1 : 1;
                    // Buat log deteksi AI mentah
                    aiDetection = await AiDetection_1.AiDetectionModel.create({
                        id: nextId,
                        cameraId: frame.cameraId,
                        location: frame.location,
                        capturedAt: frame.timestamp,
                        confidence: maxConfidence,
                        severity,
                        trackingId,
                        modelId: AiModelManager_1.AiModelManager.getActiveModelId(),
                        detections: trackedDetections,
                        status: 'INFERENCED',
                        processingTimeMs: Date.now() - startTime,
                        // TTL 30 hari default expiration untuk data tidak terpromosikan
                        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    });
                    break;
                }
                catch (createErr) {
                    if (createErr.code === 11000 || createErr.message.includes('E11000')) {
                        attempts++;
                        console.log(`[InferenceService] Duplicate key error on Detection ID. Retrying ID generation (Attempt ${attempts}/5)...`);
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 50));
                    }
                    else {
                        throw createErr;
                    }
                }
            }
            if (!aiDetection) {
                throw new Error('Gagal membuat log deteksi AI karena tabrakan ID yang persisten setelah 5 percobaan.');
            }
            // 5. Simpan berkas bukti visual snapshot dan hash SHA-256 via EvidenceService
            await EvidenceService_1.EvidenceService.saveEvidence(frame.cameraId, frame.imagePath, frame.timestamp, aiDetection._id);
            return aiDetection;
        }
        catch (err) {
            console.error('[InferenceService] Failed to execute AI inference cycle:', err.message);
            return null;
        }
    }
}
exports.InferenceService = InferenceService;
