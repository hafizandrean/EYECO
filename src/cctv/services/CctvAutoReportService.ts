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

import { CctvModel, ICctv } from '../../database/models/Cctv';
import { ReportModel } from '../../database/models/Report';
import { UserModel } from '../../database/models/User';
import { ReportRepository } from '../../database/repositories/ReportRepository';
import { AiDetectionModel, IAiDetection } from '../../database/models/AiDetection';
import { FrameCaptureService, ICapturedFrame } from './FrameCaptureService';
import { detectFile } from '../../services/aiDetection.service';
import { aiEngine } from '../../services/ai/aiEngine';
import { EvidenceService } from './EvidenceService';
import { SpoolRetryWorker } from '../../services/SpoolRetryWorker';
import { R2StorageService } from '../../services/R2StorageService';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

interface CooldownEntry {
  cameraId: number;
  cooldownUntil: number;
}

export class CctvAutoReportService {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;
  private static cooldowns: CooldownEntry[] = [];
  private static readonly COOLDOWN_MS = 60_000;
  private static readonly POLL_INTERVAL_MS = 10_000;
  private static workspaceId: number | null = null;

  // ── Standalone mode (start/stop background cycle) ──

  public static start(workspaceId?: number): void {
    if (this.intervalId) return;
    this.workspaceId = workspaceId ?? null;
    this.isRunning = true;
    console.log(`[CctvAutoReportService] Auto-report monitoring started${workspaceId ? ` for workspace ${workspaceId}` : ''}.`);
    this.intervalId = setInterval(() => this.cycle(), this.POLL_INTERVAL_MS);
    setTimeout(() => this.cycle(), 1000);
  }

  public static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.workspaceId = null;
    console.log('[CctvAutoReportService] Auto-report monitoring stopped.');
  }

  public static getStatus(): { running: boolean } {
    return { running: this.isRunning };
  }

  // Standalone cycle: capture + detect person + create report
  private static async cycle(): Promise<void> {
    try {
      const query: any = {
        isActive: true,
        monitoringEnabled: true,
        status: { $in: ['ONLINE', 'MONITORING'] }
      };
      if (this.workspaceId !== null) {
        query.workspaceId = this.workspaceId;
      }
      const cameras = await CctvModel.find(query).lean().exec();

      for (const camera of cameras) {
        if (this.isOnCooldown(camera.id)) continue;
        await this.processCameraSnapshot(camera);
      }
    } catch (err) {
      console.error('[CctvAutoReportService] Cycle error:', err);
    }
  }

  // Process a single camera snapshot using OS Temp directory & Private R2 Storage
  private static async processCameraSnapshot(camera: ICctv): Promise<void> {
    try {
      let lastCapturePath = path.join(os.tmpdir(), 'eyeco', `cctv_capture_${camera.id}.jpg`);
      if (!fs.existsSync(lastCapturePath)) {
        return;
      }

      const detectionResult = await detectFile(lastCapturePath, { conf: 0.15 });
      if (!detectionResult || !detectionResult.boxes) return;

      const personClasses = ['person', 'cctv persons', 'people', 'sitting', 'standing', 'orang'];
      const personDetections = detectionResult.boxes.filter(b =>
        personClasses.some(pc => b.label.toLowerCase().includes(pc))
      );
      if (personDetections.length === 0) return;

      // Find admin in the same workspace as the camera
      const adminUser = await UserModel.findOne({ workspaceId: camera.workspaceId, role: 'admin' }).sort({ id: 1 }).lean().exec();
      if (!adminUser) return;

      // AI Engine analysis
      let aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' = 'Tidak Terindikasi';
      let violationScore: number | null = 0;
      let decisionConfidence: number | null = 0;

      try {
        const aiAnalysis = await aiEngine.analyze(lastCapturePath);
        const rawStatus = aiAnalysis.decision.status as string;
        if (rawStatus === 'Indikasi Tinggi' || rawStatus === 'TINGGI') {
          aiStatus = 'TINGGI';
        } else if (rawStatus === 'Indikasi Sedang' || rawStatus === 'SEDANG') {
          aiStatus = 'SEDANG';
        } else if (rawStatus === 'Indikasi Rendah' || rawStatus === 'RENDAH') {
          aiStatus = 'RENDAH';
        } else {
          aiStatus = 'Tidak Terindikasi';
        }
        violationScore = aiAnalysis.decision.violationScore;
        decisionConfidence = aiAnalysis.decision.decisionConfidence;
      } catch {
        const trashDets = detectionResult.boxes.filter(b =>
          !personClasses.some(pc => b.label.toLowerCase().includes(pc))
        );
        if (trashDets.length === 0) {
          aiStatus = 'Tidak Terindikasi';
          violationScore = Math.round(10 + 15 * Math.max(...personDetections.map(d => d.confidence)));
        } else {
          const hasOverlap = checkOverlap(personDetections, trashDets);
          if (hasOverlap) {
            aiStatus = 'SEDANG';
            violationScore = Math.round(50 + 20 * Math.max(...trashDets.map(d => d.confidence)));
          } else {
            aiStatus = 'TINGGI';
            violationScore = Math.round(70 + 25 * Math.max(...trashDets.map(d => d.confidence)));
          }
        }
      }

      if (aiStatus !== 'TINGGI' && aiStatus !== 'SEDANG') {
        return;
      }

      const maxPersonConf = Math.max(...personDetections.map(d => d.confidence));

      // Save captured image to OS Temp directory first (out of repo)
      const tempDir = path.join(os.tmpdir(), 'eyeco');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const uniqueFilename = `evidence_${Date.now()}_${camera.id}.jpg`;
      const tempAbsolutePath = path.join(tempDir, uniqueFilename);
      fs.copyFileSync(lastCapturePath, tempAbsolutePath);

      const fileBuffer = fs.readFileSync(tempAbsolutePath);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const newReport = await ReportRepository.create({
        location: camera.location || 'Lokasi CCTV',
        aiStatus,
        aiConfidence: decisionConfidence || Math.round(maxPersonConf * 100),
        image: `/uploads/laporan_auto/${uniqueFilename}`,
        identity: `CCTV-CAM-${String(camera.id).padStart(2, '0')}`,
        sourceType: 'AI_CCTV',
        additionalNotes: `Deteksi otomatis dari CCTV ${camera.name} di ${camera.location}. Terdeteksi ${personDetections.length} orang.`,
        boundingBoxes: detectionResult.boxes.map(b => {
          const labelMap: Record<string, string> = {
            'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang', 'cctv persons': 'Orang',
            'trash': 'Sampah', 'sampah': 'Sampah', 'boat': 'Perahu', 'perahu': 'Perahu'
          };
          const cleanLabel = labelMap[b.label.toLowerCase()] || b.label;
          return { label: cleanLabel, confidence: b.confidence, x: b.x, y: b.y, w: b.w, h: b.h };
        }),
      }, (adminUser as any).id);

      if (newReport) {
        // Save evidence via EvidenceService (R2 Upload + Verification + DB Persist)
        const evidence = await EvidenceService.saveEvidence(
          camera.id,
          tempAbsolutePath,
          new Date(),
          newReport._id,
          newReport.id
        );

        if (evidence && evidence.storage && evidence.storage.key) {
          await ReportModel.updateOne(
            { _id: newReport._id },
            {
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
            }
          ).exec();
        }
        console.log(`[CctvAutoReportService] ✅ Auto-report #${newReport.id} for camera #${camera.id}`);
      }

      this.setCooldown(camera.id);
    } catch (err) {
      console.error(`[CctvAutoReportService] Error camera #${camera.id}:`, err);
    }
  }

  // ── Pipeline-integration mode (called from AiPipelineScheduler) ──

  public static async processDetection(
    frame: ICapturedFrame,
    detection: IAiDetection
  ): Promise<{ reportId: number; autoReported: boolean } | null> {
    try {
      if (this.isOnCooldown(frame.cameraId)) return null;

      const hasViolation = ['MEDIUM', 'HIGH', 'CRITICAL'].includes(detection.severity);
      if (!hasViolation) return null;

      const camera = await CctvModel.findOne({ id: frame.cameraId }).lean().exec();
      if (!camera) return null;

      const workspaceId = camera.workspaceId;
      let admin = await UserModel.findOne({ workspaceId, role: 'admin' }).sort({ createdAt: 1 }).lean().exec();
      if (!admin) {
        admin = await UserModel.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean().exec();
      }
      const uploaderId = admin ? admin.id : 1;

      let aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' = 'Tidak Terindikasi';
      if (detection.severity === 'CRITICAL' || detection.severity === 'HIGH') {
        aiStatus = 'TINGGI';
      } else if (detection.severity === 'MEDIUM') {
        aiStatus = 'SEDANG';
      } else if (detection.severity === 'LOW') {
        aiStatus = 'RENDAH';
      }

      // Save to OS Temp directory
      const tempDir = path.join(os.tmpdir(), 'eyeco');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const uniqueFilename = `evidence_${Date.now()}_${frame.cameraId}.jpg`;
      const tempAbsolutePath = path.join(tempDir, uniqueFilename);

      let sourceAbsolutePath = path.isAbsolute(frame.imagePath) ? frame.imagePath : path.join(process.cwd(), 'public', frame.imagePath);
      if (!fs.existsSync(sourceAbsolutePath)) {
        const altTemp = path.join(tempDir, path.basename(frame.imagePath));
        if (fs.existsSync(altTemp)) sourceAbsolutePath = altTemp;
      }

      if (fs.existsSync(sourceAbsolutePath)) {
        fs.copyFileSync(sourceAbsolutePath, tempAbsolutePath);
      }

      const labelMap: Record<string, string> = {
        'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang',
        'trash': 'Sampah', 'sampah': 'Sampah', 'boat': 'Perahu', 'perahu': 'Perahu'
      };
      const indonesianClasses = detection.detections.map(d => labelMap[d.class.toLowerCase()] || d.class);
      const maxConfidence = Math.max(...detection.detections.map(d => d.confidence), 0);

      const report = await ReportRepository.create({
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
      }, uploaderId);

      if (report) {
        const evidence = await EvidenceService.saveEvidence(
          frame.cameraId,
          tempAbsolutePath,
          new Date(),
          detection._id,
          report.id
        );

        if (evidence && evidence.storage && evidence.storage.key) {
          await ReportModel.updateOne(
            { _id: report._id },
            {
              $set: {
                r2Key: evidence.storage.key,
                primaryEvidenceId: evidence._id,
                thumbnailEvidenceId: evidence._id,
                evidenceIds: [evidence._id]
              }
            }
          ).exec();
        }
      }

      this.setCooldown(frame.cameraId);

      await AiDetectionModel.updateOne(
        { id: detection.id },
        { $set: { status: 'PROMOTED', promotedReportId: report.id } }
      ).exec();

      console.log(`[CctvAutoReportService] Auto-report #${report.id} for camera #${frame.cameraId}`);
      return { reportId: report.id, autoReported: true };
    } catch (err) {
      console.error('[CctvAutoReportService] processDetection error:', err);
      return null;
    }
  }

  public static clearCooldown(cameraId: number): void {
    this.cooldowns = this.cooldowns.filter(c => c.cameraId !== cameraId);
  }

  public static getCooldownRemaining(cameraId: number): number {
    const entry = this.cooldowns.find(c => c.cameraId === cameraId);
    if (!entry) return 0;
    return Math.max(0, entry.cooldownUntil - Date.now());
  }

  public static getCooldownStatus(): Array<{ cameraId: number; remainingMs: number }> {
    const now = Date.now();
    return this.cooldowns
      .filter(c => c.cooldownUntil > now)
      .map(c => ({ cameraId: c.cameraId, remainingMs: c.cooldownUntil - now }));
  }

  private static isOnCooldown(cameraId: number): boolean {
    const now = Date.now();
    this.cooldowns = this.cooldowns.filter(c => c.cooldownUntil > now);
    return this.cooldowns.some(c => c.cameraId === cameraId);
  }

  private static setCooldown(cameraId: number): void {
    this.cooldowns.push({ cameraId, cooldownUntil: Date.now() + this.COOLDOWN_MS });
  }
}

function checkOverlap(
  personDets: Array<{ x: number; y: number; w: number; h: number }>,
  trashDets: Array<{ x: number; y: number; w: number; h: number }>
): boolean {
  for (const trash of trashDets) {
    const tx1 = trash.x, ty1 = trash.y, tx2 = trash.x + trash.w, ty2 = trash.y + trash.h;
    const trashArea = (tx2 - tx1) * (ty2 - ty1);
    if (trashArea <= 0) continue;
    for (const person of personDets) {
      const px1 = person.x, py1 = person.y, px2 = person.x + person.w, py2 = person.y + person.h;
      const ix1 = Math.max(tx1, px1), iy1 = Math.max(ty1, py1);
      const ix2 = Math.min(tx2, px2), iy2 = Math.min(ty2, py2);
      if (ix1 < ix2 && iy1 < iy2) {
        const interArea = (ix2 - ix1) * (iy2 - iy1);
        if (interArea / trashArea > 0.3) return true;
      }
    }
  }
  return false;
}
