import { AiDetectionModel, IAiDetection } from '../../database/models/AiDetection';
import { ICapturedFrame } from './FrameCaptureService';
import { AiModelManager } from './AiModelManager';
import { TrackingEngine } from './TrackingEngine';
import { EvidenceService } from './EvidenceService';
import { getNextSequence } from '../../database/models/Counter';
import crypto from 'crypto';

export class InferenceService {
  private static tracker = new TrackingEngine();

  /**
   * Executes AI model inference on a captured frame using the active model engine.
   * Tracks detections, saves visual evidence, and logs the raw AI detection document.
   */
  public static async executeInference(frame: ICapturedFrame): Promise<IAiDetection | null> {
    const startTime = Date.now();

    try {
      // 1. Dapatkan AI engine aktif untuk kamera ini (mendukung Canary Routing)
      const engine = await AiModelManager.getEngineForCamera(frame.cameraId);
      console.log(`[InferenceService] Running inference on Camera #${frame.cameraId} via ${engine.name}`);

      // 2. Jalankan inferensi deteksi objek
      const rawResults = await engine.detect(frame);

      // Pre-Filtering: Lewati penyimpanan jika tidak ada deteksi atau confidence sangat rendah
      const maxConfidence = rawResults.length > 0 ? Math.max(...rawResults.map(r => r.confidence)) : 0;
      if (rawResults.length === 0 || maxConfidence < 0.45) {
        return null;
      }

      // 3. Asosiasikan ID pelacakan lintas-frame menggunakan Tracking Engine
      const trackedDetections = this.tracker.track(rawResults);

      // Tentukan tingkat bahaya (Severity) berdasarkan kelas deteksi
      const hasTrash = trackedDetections.some(d => d.class === 'trash');
      const hasPerson = trackedDetections.some(d => d.class === 'person');
      const hasBoat = trackedDetections.some(d => d.class === 'boat');

      let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
      if (hasTrash) {
        severity = 'HIGH';
        if (hasPerson) severity = 'CRITICAL'; // Orang membuang sampah
      } else if (hasBoat) {
        severity = 'MEDIUM';
      }

      // 4. Dapatkan autoincrement ID berikutnya untuk AiDetection (Atomic)
      const nextId = await getNextSequence('detectionId', AiDetectionModel);
      const trackingId = crypto.randomUUID();

      // Buat log deteksi AI mentah
      const aiDetection = await AiDetectionModel.create({
        id: nextId,
        cameraId: frame.cameraId,
        location: frame.location,
        capturedAt: frame.timestamp,
        confidence: maxConfidence,
        severity,
        trackingId,
        modelId: AiModelManager.getActiveModelId(),
        detections: trackedDetections,
        status: 'INFERENCED',
        processingTimeMs: Date.now() - startTime,
        // TTL 30 hari default expiration untuk data tidak terpromosikan
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      // 5. Simpan berkas bukti visual snapshot dan hash SHA-256 via EvidenceService
      await EvidenceService.saveEvidence(
        frame.cameraId,
        frame.imagePath,
        frame.timestamp,
        aiDetection._id
      );

      return aiDetection;
    } catch (err: any) {
      console.error('[InferenceService] Failed to execute AI inference cycle:', err.message);
      return null;
    }
  }
}
