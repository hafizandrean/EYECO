"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 3: Rule-Based Decision Strategy
 * Policy-Driven Heuristic Decision Engine with deterministic score thresholds.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleBasedStrategy = exports.RuleBasedStrategy = void 0;
const policyLoader_1 = require("./policyLoader");
class RuleBasedStrategy {
    evaluate(fv) {
        const policy = (0, policyLoader_1.loadDecisionPolicy)();
        const w = policy.weights;
        // ── Confidence multipliers (0-1) ──
        const personConf = fv.highestPersonConfidence / 100;
        const trashConf = fv.highestTrashConfidence / 100;
        // ── Deterministic scoring per scenario ──
        // Person only (walking by, no trash) → Tidak Terindikasi, score ~5-24
        // Person + trash near wrist (holding) → Indikasi Sedang, score ~50-74
        // Person + trash possibleReleasePose (discarding) → Indikasi Tinggi, score ~70-95
        // Person + trash no wrist, no release (on ground) → Indikasi Sedang/Tinggi, score ~55-75
        // Trash only (no person) → Indikasi Rendah, score ~25-49
        let score = 0;
        if (fv.personCount > 0 && fv.trashCount === 0) {
            // Person only — walking by, no trash detected
            score = 5 + 15 * personConf; // 5–20 range
        }
        else if (fv.personCount > 0 && fv.trashCount > 0 && fv.trashNearWrist) {
            // Person + trash near wrist — holding/carrying object
            score = 50 + 24 * personConf; // 50–74 range (Indikasi Sedang)
        }
        else if (fv.personCount > 0 && fv.trashCount > 0 && fv.possibleReleasePose) {
            // Person + trash with release pose — discarding/throwing
            score = 70 + 25 * trashConf; // 70–95 range (Indikasi Tinggi)
        }
        else if (fv.personCount > 0 && fv.trashCount > 0) {
            // Person + trash, no wrist near, no release pose — trash on ground
            score = 55 + 20 * trashConf; // 55–75 range
        }
        else if (fv.trashCount > 0) {
            // Trash only — no person detected
            score = 25 + 15 * trashConf; // 25–40 range (Indikasi Rendah)
        }
        else {
            // Nothing detected
            score = 0;
        }
        // Apply policy weights
        if (fv.trashNearWrist)
            score += (w.trashNearWrist || 20);
        if (fv.possibleReleasePose)
            score += (w.trashAppearsAirborne || 15);
        if (fv.trashOnWaterZone)
            score += (w.trashOnWaterZone || 15);
        if (fv.trashOnRoadZone)
            score += (w.trashOnRoadZone || 10);
        if (fv.trashInsideBinZone)
            score += (w.trashInsideBinZone || -35);
        if (fv.trashLargePile)
            score += (w.trashLargePile || 30);
        // Clamp to 0–100 with 1 decimal place
        let violationScore = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
        if (!Number.isFinite(violationScore))
            violationScore = 0;
        // ── Simplified Heuristic Decision Confidence ──
        const evidenceCoverageFactor = fv.evidenceCoverage * 25;
        const objectReliability = (fv.highestTrashConfidence > 0 ? fv.highestTrashConfidence / 100 : (fv.personCount > 0 ? 0.7 : 0.4)) * 35;
        const analyzerFactor = (fv.analyzersAvailable.length >= 3 ? 0.9 : 0.6) * 25;
        const agreementFactor = (fv.trashInsideBinZone || (fv.trashCount === 0 && fv.personCount > 0) ? 0.95 : 0.8) * 15;
        // Image quality impact on decision confidence (simplified)
        let qualityFactor = 0.9 * 15;
        if (fv.imageQuality && fv.imageQuality.qualityStatus === 'POOR') {
            qualityFactor = 0.2 * 15;
        }
        else if (fv.imageQuality && (fv.imageQuality.qualityStatus === 'ACCEPTABLE' || fv.imageQuality.qualityStatus === 'LOW' || (fv.imageQuality.blurScore < 80))) {
            qualityFactor = 0.5 * 15;
        }
        const calculatedConfidence = Math.round(evidenceCoverageFactor + objectReliability + analyzerFactor + agreementFactor + qualityFactor);
        let decisionConfidence = Math.max(10, Math.min(100, calculatedConfidence));
        if (fv.imageQuality && fv.imageQuality.qualityStatus === 'POOR') {
            decisionConfidence = Math.max(10, decisionConfidence - 25);
        }
        else if (fv.imageQuality && (fv.imageQuality.qualityStatus === 'ACCEPTABLE' || fv.imageQuality.qualityStatus === 'LOW')) {
            decisionConfidence = Math.max(10, decisionConfidence - 10);
        }
        const uncertaintyScore = 100 - decisionConfidence;
        // Object & scene confidence — continuous (1 decimal)
        const objectConfidence = fv.highestTrashConfidence > 0 ? fv.highestTrashConfidence : (fv.highestPersonConfidence > 0 ? fv.highestPersonConfidence : 0);
        const sceneConfidence = Math.round(fv.evidenceCoverage * 1000) / 10;
        // ── Deterministic Threshold Mapping ──
        // 0–24   = Tidak Terindikasi
        // 25–49  = Indikasi Rendah
        // 50–74  = Indikasi Sedang
        // 75–100 = Indikasi Tinggi
        let status = 'Tidak Terindikasi';
        if (violationScore >= policy.thresholds.highMinScore && fv.trashCount > 0 && !fv.trashInsideBinZone) {
            status = 'Indikasi Tinggi';
        }
        else if (violationScore >= policy.thresholds.mediumMinScore && fv.trashCount > 0 && !fv.trashInsideBinZone) {
            status = 'Indikasi Sedang';
        }
        else if (violationScore >= policy.thresholds.lowMinScore && fv.trashCount > 0 && !fv.trashInsideBinZone) {
            status = 'Indikasi Rendah';
        }
        else {
            status = 'Tidak Terindikasi';
        }
        // ── Operational Priority ──
        let priority = 'NONE';
        let recommendedAction = 'Tidak diperlukan tindakan otomatis';
        if (status === 'Tidak Terindikasi') {
            priority = 'NONE';
            recommendedAction = 'Tidak diperlukan tindakan otomatis';
        }
        else if (status === 'Indikasi Rendah') {
            priority = 'LOW';
            recommendedAction = 'Pantau berkala oleh sistem';
        }
        else if (status === 'Indikasi Sedang') {
            priority = 'MEDIUM';
            recommendedAction = 'Verifikasi operator diperlukan';
        }
        else if (status === 'Indikasi Tinggi') {
            priority = 'HIGH';
            recommendedAction = 'Verifikasi operator segera & siarkan alert Telegram';
        }
        const needsHumanValidation = uncertaintyScore >= 30 || status === 'Indikasi Sedang' || status === 'Indikasi Tinggi' || (fv.imageQuality && (fv.imageQuality.qualityStatus === 'POOR' || fv.imageQuality.qualityStatus === 'ACCEPTABLE' || fv.imageQuality.qualityStatus === 'LOW' || fv.imageQuality.blurScore < 100));
        return {
            status,
            violationScore,
            objectConfidence,
            sceneConfidence,
            decisionConfidence,
            uncertaintyScore,
            confidenceType: 'HEURISTIC_RELIABILITY',
            priority,
            recommendedAction,
            needsHumanValidation,
            policyVersion: policy.policyVersion,
        };
    }
}
exports.RuleBasedStrategy = RuleBasedStrategy;
exports.ruleBasedStrategy = new RuleBasedStrategy();
