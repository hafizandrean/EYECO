"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportAiProjectionService = void 0;
class ReportAiProjectionService {
    static deriveAiStatusFromScore(score) {
        if (score === null || score === undefined || typeof score !== 'number' || isNaN(score)) {
            return 'NONE';
        }
        const safeScore = Math.max(0, Math.min(100, score));
        if (safeScore >= 75)
            return 'HIGH';
        if (safeScore >= 50)
            return 'MEDIUM';
        if (safeScore >= 25)
            return 'LOW';
        return 'NONE';
    }
    static normalizeAiStatus(rawStatus) {
        if (!rawStatus)
            return 'NONE';
        const upper = String(rawStatus).toUpperCase().trim();
        if (upper.includes('TINGGI') || upper === 'HIGH')
            return 'HIGH';
        if (upper.includes('SEDANG') || upper === 'MEDIUM')
            return 'MEDIUM';
        if (upper.includes('RENDAH') || upper === 'LOW')
            return 'LOW';
        return 'NONE';
    }
    static getSnapshotRequiredCutoff() {
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
    static classifyIntegrity(report, snapshot) {
        if (report.analysisState === 'PROCESSING') {
            return 'PENDING';
        }
        if (report.activeSnapshotId) {
            if (!snapshot)
                return 'SNAPSHOT_MISSING';
            const decision = (snapshot.decision || {});
            const snapshotScore = typeof decision.violationScore === 'number' ? decision.violationScore : null;
            const reportScore = typeof report.violationScore === 'number' ? report.violationScore : null;
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
    static buildReportAiProjection(report, snapshot) {
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
            const isOutcomeIncomplete = decision.analysisOutcome === 'INCOMPLETE' || decision.violationScore === null;
            const score = typeof decision.violationScore === 'number' ? decision.violationScore : null;
            const derivedStatus = isOutcomeIncomplete ? 'NONE' : this.deriveAiStatusFromScore(score);
            const statusLabels = {
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
                aiStatusLabel: report.aiStatus || 'Data Tidak Lengkap',
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
            return {
                aiStatus: this.normalizeAiStatus(report.aiStatus),
                aiStatusLabel: 'Inkonsisten',
                violationScore: typeof report.violationScore === 'number' ? report.violationScore : null,
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
        const validScore = typeof report.violationScore === 'number' && report.violationScore > 0 ? report.violationScore : null;
        const derivedStatus = validScore !== null ? this.deriveAiStatusFromScore(validScore) : this.normalizeAiStatus(report.aiStatus);
        return {
            aiStatus: derivedStatus,
            aiStatusLabel: report.aiStatus || 'Tidak Terindikasi',
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
    static maskEmail(email) {
        if (!email || !email.includes('@'))
            return '***@***';
        const [name, domain] = email.split('@');
        const maskedName = name.length <= 2 ? name + '***' : name.slice(0, 2) + '***';
        return `${maskedName}@${domain}`;
    }
    static maskPhone(phone) {
        if (!phone)
            return '08**********';
        const clean = phone.replace(/\D/g, '');
        if (clean.length <= 4)
            return '08**********';
        return clean.slice(0, 4) + '****' + clean.slice(-2);
    }
    static projectReporterForViewer(userDoc, reportUserId, viewerId, viewerRole) {
        const isOwner = Boolean(viewerId && String(viewerId) === String(reportUserId));
        const isAdmin = Boolean(viewerRole === 'admin' || viewerRole === 'superadmin');
        const name = userDoc?.name || userDoc?.username || 'Pelapor Anonim';
        const email = userDoc?.email || '';
        const phone = userDoc?.phone || '';
        if (isAdmin || isOwner) {
            return {
                name,
                email,
                phone,
                maskedEmail: this.maskEmail(email),
                maskedPhone: this.maskPhone(phone),
                isSelf: isOwner,
            };
        }
        return {
            name,
            maskedEmail: this.maskEmail(email),
            maskedPhone: this.maskPhone(phone),
            isSelf: false,
        };
    }
}
exports.ReportAiProjectionService = ReportAiProjectionService;
