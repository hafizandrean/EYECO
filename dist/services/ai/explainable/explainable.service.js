"use strict";
/**
 * EYECO AI Engine v3.0 — Explainable AI Reason Generator
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.explainableService = exports.ExplainableService = void 0;
class ExplainableService {
    generateExplainableReport(evidenceItems, decision, fv) {
        const defaultLimitations = [
            'Satu foto belum cukup untuk memastikan aktivitas membuang atau melempar sampah.',
            'Analisis posisi spasial diukur berdasarkan kedekatan geometris pergelangan tangan dan area objek.'
        ];
        const limitations = Array.from(new Set([
            ...defaultLimitations,
            ...evidenceItems.flatMap(e => e.limitations || [])
        ]));
        let summaryText = '';
        if (decision.status === 'Tidak Terindikasi') {
            summaryText = 'Tidak ditemukan bukti visual yang cukup untuk menunjukkan indikasi pembuangan sampah sembarangan.';
        }
        else if (decision.status === 'Indikasi Rendah') {
            summaryText = 'Manusia terdeteksi, namun tidak ditemukan hubungan spasial yang cukup kuat dengan objek sampah.';
        }
        else if (decision.status === 'Indikasi Sedang') {
            summaryText = 'Objek sampah teridentifikasi di sekitar manusia. Satu foto belum cukup untuk memastikan aktivitas membuang sampah.';
        }
        else if (decision.status === 'Indikasi Tinggi') {
            summaryText = 'Terdapat indikasi kuat berdasarkan keberadaan objek sampah, kedekatan posisi tangan, dan lokasi terlarang. Verifikasi operator tetap diperlukan.';
        }
        return {
            evidenceChecklist: evidenceItems,
            limitations,
            summaryText
        };
    }
}
exports.ExplainableService = ExplainableService;
exports.explainableService = new ExplainableService();
