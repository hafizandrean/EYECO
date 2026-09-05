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
const Counter_1 = require("../../database/models/Counter");
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
            // Pre-Filtering: Lewati penyimpanan jika tidak ada deteksi atau confidence sangat rendah
            const maxConfidence = rawResults.length > 0 ? Math.max(...rawResults.map(r => r.confidence)) : 0;
            if (rawResults.length === 0 || maxConfidence < 0.25) {
                console.log(`[InferenceService] Camera #${frame.cameraId} skipped: no results or low confidence (${maxConfidence.toFixed(2)} < 0.25)`);
                return null;
            }
            // 3. Asosiasikan ID pelacakan lintas-frame menggunakan Tracking Engine
            const trackedDetections = this.tracker.track(rawResults);
            // Tentukan tingkat bahaya (Severity) berdasarkan kelas deteksi
            const hasTrash = trackedDetections.some(d => ['trash', 'sampah', 'waste', 'plastic', 'bottle', 'cardboard', 'box', 'junk'].includes(d.class.toLowerCase()));
            const hasBag = trackedDetections.some(d => ['bag', 'backpack', 'handbag', 'suitcase', 'kantong', 'tas'].includes(d.class.toLowerCase()));
            const hasVehicle = trackedDetections.some(d => ['motorcycle', 'bicycle', 'car', 'truck', 'sepeda', 'sepeda motor', 'mobil', 'truk'].includes(d.class.toLowerCase()));
            const hasBoat = trackedDetections.some(d => ['boat', 'perahu'].includes(d.class.toLowerCase()));
            const hasPerson = trackedDetections.some(d => ['person', 'people', 'orang', 'cctv persons', 'walking', 'standing', 'sitting'].includes(d.class.toLowerCase()));
            const isSittingOnly = trackedDetections.some(d => d.class.toLowerCase() === 'sitting') && !hasBag && !hasTrash && !hasVehicle;
            let severity = 'LOW';
            if (hasTrash) {
                severity = 'HIGH';
                if (hasPerson || hasVehicle)
                    severity = 'CRITICAL'; // Orang / pengendara membuang sampah
            }
            else if (hasPerson && (hasBag || hasVehicle)) {
                severity = 'HIGH'; // Orang membawa kantong/tas atau mengendarai motor (potensi pembuangan)
            }
            else if (hasBoat) {
                severity = 'MEDIUM'; // Perahu di sungai
            }
            else if (hasPerson && !isSittingOnly) {
                severity = 'MEDIUM'; // Orang berjalan / berdiri di area CCTV (bukan hanya duduk diam tanpa barang)
            }
            else {
                severity = 'LOW'; // Orang hanya duduk santai tanpa barang/tas/kendaraan/sampah (skip auto-report)
            }
            // 4. Dapatkan autoincrement ID berikutnya untuk AiDetection (Atomic)
            const nextId = await (0, Counter_1.getNextSequence)('detectionId', AiDetection_1.AiDetectionModel);
            const trackingId = crypto_1.default.randomUUID();
            // Buat log deteksi AI mentah
            const aiDetection = await AiDetection_1.AiDetectionModel.create({
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
            // 5. Simpan berkas bukti visual snapshot secara async (tidak blocking inference pipeline)
            setImmediate(() => {
                EvidenceService_1.EvidenceService.saveEvidence(frame.cameraId, frame.imagePath, frame.timestamp, aiDetection._id).catch((evidErr) => {
                    console.warn(`[InferenceService] Evidence save failed (non-critical) for camera #${frame.cameraId}:`, evidErr.message);
                });
            });
            return aiDetection;
        }
        catch (err) {
            console.error('[InferenceService] Failed to execute AI inference cycle:', err.message);
            return null;
        }
    }
}
exports.InferenceService = InferenceService;
