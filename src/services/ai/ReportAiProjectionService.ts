import { IReport } from '../../database/models/Report';
import { IAiSnapshot } from '../../database/models/AiSnapshot';

export type AiStatus = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ValidationStatus = 'PENDING' | 'VALID' | 'TIDAK_VALID';
export type WorkflowStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type AiDataIntegrityStatus = 'PENDING' | 'VALID' | 'LEGACY' | 'SNAPSHOT_MISSING' | 'INCONSISTENT';

export interface IReporterProjection {
  name: string;
  maskedEmail?: string;
  maskedPhone?: string;
  email?: string;
  phone?: string;
  isSelf: boolean;
}

export interface IReportAiProjection {
  aiStatus: AiStatus;
  aiStatusLabel: string;
  violationScore: number | null;
  decisionConfidence: number | null;
  objectConfidence: number | null;
  sceneConfidence: number | null;
  priority: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedAction: string | null;
  aiDataIntegrityStatus: AiDataIntegrityStatus;
  snapshotVersion: string | null;
  evidenceItems: any[];
  modelRegistryInfo?: any;
}

export class ReportAiProjectionService {
  /**
   * Derive AI status strictly from a valid indication score (0-100).
   * Note: 0 is a valid score (Tidak Terindikasi).
   * null / undefined / NaN / non-finite / out-of-bound values (<0 or >100) return 'NONE'.
   */
  public static deriveAiStatusFromScore(score: number | null | undefined): AiStatus {
    if (score === null || score === undefined || typeof score !== 'number' || !Number.isFinite(score)) {
      return 'NONE';
    }
    if (score < 0 || score > 100) {
      return 'NONE';
    }
    if (score >= 75) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    if (score >= 25) return 'LOW';
    return 'NONE';
  }

  public static normalizeAiStatus(rawStatus: string | null | undefined): AiStatus {
    if (!rawStatus) return 'NONE';
    const upper = String(rawStatus).toUpperCase().trim();
    if (upper.includes('TINGGI') || upper === 'HIGH') return 'HIGH';
    if (upper.includes('SEDANG') || upper === 'MEDIUM') return 'MEDIUM';
    if (upper.includes('RENDAH') || upper === 'LOW') return 'LOW';
    return 'NONE';
  }

  public static getSnapshotRequiredCutoff(): Date {
    const raw = process.env.AI_SNAPSHOT_REQUIRED_FROM;
    if (!raw) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[FATAL] AI_SNAPSHOT_REQUIRED_FROM environment variable is required in production.');
      }
      return new Date('2026-07-30T12:00:00.000Z'); // 30 Juli 2026, 19:00 WIB
    }
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      throw new Error(`[FATAL] AI_SNAPSHOT_REQUIRED_FROM invalid date format: ${raw}`);
    }
    return parsed;
  }

  public static classifyIntegrity(report: Partial<IReport>, snapshot: Partial<IAiSnapshot> | null): AiDataIntegrityStatus {
    if (report.analysisState === 'PROCESSING') {
      return 'PENDING';
    }

    if (report.activeSnapshotId) {
      if (!snapshot) return 'SNAPSHOT_MISSING';

      const decision = (snapshot.decision || {}) as any;
      const snapshotScore = typeof decision.violationScore === 'number' && Number.isFinite(decision.violationScore) ? decision.violationScore : null;
      const reportScore = typeof report.violationScore === 'number' && Number.isFinite(report.violationScore) ? report.violationScore : null;

      const snapshotStatus = this.normalizeAiStatus(decision.status || decision.aiStatus);
      const reportStatus = this.normalizeAiStatus(report.aiStatus);

      if (snapshotScore !== reportScore || snapshotStatus !== reportStatus) {
        return 'INCONSISTENT';
      }
      return 'VALID';
    }

    const createdAt = report.createdAt ? new Date(report.createdAt) : (report.timestamp ? new Date(report.timestamp) : new Date(0));
    if (createdAt >= this.getSnapshotRequiredCutoff()) {
      return 'SNAPSHOT_MISSING';
    }

    return 'LEGACY';
  }

  public static buildReportAiProjection(report: any, snapshot: any | null): IReportAiProjection {
    const integrityStatus = this.classifyIntegrity(report, snapshot);

    if (integrityStatus === 'PENDING') {
      return {
        aiStatus: this.normalizeAiStatus(report.aiStatus),
        aiStatusLabel: 'Sedang dianalisis',
        violationScore: null,
        decisionConfidence: null,
        objectConfidence: null,
        sceneConfidence: null,
        priority: 'NONE',
        recommendedAction: 'Menunggu hasil analisis AI v3.0...',
        aiDataIntegrityStatus: 'PENDING',
        snapshotVersion: null,
        evidenceItems: [],
      };
    }

    if (integrityStatus === 'VALID' && snapshot) {
      const decision = snapshot.decision || {};
      const rawScore = decision.violationScore;
      const isValidScore = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100;
      const score = isValidScore ? rawScore : null;
      
      const isOutcomeIncomplete = decision.analysisOutcome === 'INCOMPLETE' || score === null;
      const derivedStatus = isOutcomeIncomplete ? 'NONE' : this.deriveAiStatusFromScore(score);

      const statusLabels: Record<AiStatus, string> = {
        'HIGH': 'Indikasi Tinggi',
        'MEDIUM': 'Indikasi Sedang',
        'LOW': 'Indikasi Rendah',
        'NONE': isOutcomeIncomplete ? 'Analisis Tidak Lengkap' : 'Tidak Terindikasi'
      };

      return {
        aiStatus: derivedStatus,
        aiStatusLabel: statusLabels[derivedStatus],
        violationScore: score,
        decisionConfidence: typeof decision.decisionConfidence === 'number' ? decision.decisionConfidence : null,
        objectConfidence: typeof decision.objectConfidence === 'number' ? decision.objectConfidence : null,
        sceneConfidence: typeof decision.sceneConfidence === 'number' ? decision.sceneConfidence : null,
        priority: isOutcomeIncomplete ? 'NONE' : (decision.priority || 'NONE'),
        recommendedAction: decision.recommendedAction || (isOutcomeIncomplete ? 'Analisis AI tidak lengkap. Lakukan pemeriksaan operator.' : null),
        aiDataIntegrityStatus: 'VALID',
        snapshotVersion: snapshot.pipelineVersion || 'v3.0.0',
        evidenceItems: snapshot.evidenceItems || [],
        modelRegistryInfo: snapshot.modelRegistryInfo || null,
      };
    }

    if (integrityStatus === 'SNAPSHOT_MISSING') {
      return {
        aiStatus: this.normalizeAiStatus(report.aiStatus),
        aiStatusLabel: report.aiStatus || 'Tidak Tersedia',
        violationScore: null,
        decisionConfidence: null,
        objectConfidence: null,
        sceneConfidence: null,
        priority: 'NONE',
        recommendedAction: 'Verifikasi operator dan jalankan analisis ulang',
        aiDataIntegrityStatus: 'SNAPSHOT_MISSING',
        snapshotVersion: null,
        evidenceItems: [],
      };
    }

    if (integrityStatus === 'INCONSISTENT') {
      const rawScore = report.violationScore;
      const isValidScore = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100;
      return {
        aiStatus: this.normalizeAiStatus(report.aiStatus),
        aiStatusLabel: 'Inkonsisten',
        violationScore: isValidScore ? rawScore : null,
        decisionConfidence: typeof report.decisionConfidence === 'number' ? report.decisionConfidence : null,
        objectConfidence: typeof report.objectConfidence === 'number' ? report.objectConfidence : null,
        sceneConfidence: typeof report.sceneConfidence === 'number' ? report.sceneConfidence : null,
        priority: report.priority || 'NONE',
        recommendedAction: report.recommendedAction || null,
        aiDataIntegrityStatus: 'INCONSISTENT',
        snapshotVersion: null,
        evidenceItems: [],
      };
    }

    // LEGACY report
    const rawScore = report.violationScore;
    const isValidScore = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100;
    const validScore = isValidScore ? rawScore : null;
    const derivedStatus = validScore !== null ? this.deriveAiStatusFromScore(validScore) : this.normalizeAiStatus(report.aiStatus);

    return {
      aiStatus: derivedStatus,
      aiStatusLabel: validScore === null ? 'Tidak Tersedia' : (derivedStatus === 'NONE' ? 'Tidak Terindikasi' : (derivedStatus === 'HIGH' ? 'Indikasi Tinggi' : (derivedStatus === 'MEDIUM' ? 'Indikasi Sedang' : 'Indikasi Rendah'))),
      violationScore: validScore,
      decisionConfidence: null,
      objectConfidence: null,
      sceneConfidence: null,
      priority: report.priority && report.priority !== 'NONE' ? report.priority : 'NONE',
      recommendedAction: report.recommendedAction || null,
      aiDataIntegrityStatus: 'LEGACY',
      snapshotVersion: null,
      evidenceItems: [],
    };
  }

  public static maskEmail(email?: string): string {
    if (!email || !email.includes('@')) return '***@***';
    const [name, domain] = email.split('@');
    if (name.length <= 2) return `${name.charAt(0)}***@${domain}`;
    return `${name.slice(0, 2)}***@${domain}`;
  }

  public static maskPhone(phone?: string): string {
    if (!phone) return '08***';
    const clean = phone.replace(/[^0-9+]/g, '');
    if (clean.length <= 4) return '08***';
    return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
  }

  public static projectReporterForViewer(
    uploaderDoc: any | null,
    uploaderUserId: number,
    viewerUserId: number,
    viewerRole: string
  ): IReporterProjection {
    const isSelf = uploaderUserId === viewerUserId;
    const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';

    const rawName = uploaderDoc?.name || uploaderDoc?.username || `User #${uploaderUserId}`;
    const rawEmail = uploaderDoc?.email || '';
    const rawPhone = uploaderDoc?.phone || '';

    if (isAdmin || isSelf) {
      return {
        name: rawName,
        email: rawEmail,
        phone: rawPhone,
        maskedEmail: this.maskEmail(rawEmail),
        maskedPhone: this.maskPhone(rawPhone),
        isSelf
      };
    }

    return {
      name: isSelf ? rawName : (uploaderDoc?.username ? `@${uploaderDoc.username}` : 'Pelapor Terverifikasi'),
      maskedEmail: this.maskEmail(rawEmail),
      maskedPhone: this.maskPhone(rawPhone),
      isSelf
    };
  }
}
