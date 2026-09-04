"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../auth/authMiddleware");
const Report_1 = require("../database/models/Report");
const AiEvidence_1 = require("../database/models/AiEvidence");
const R2StorageService_1 = require("../services/R2StorageService");
const mongoose_1 = __importDefault(require("mongoose"));
const router = (0, express_1.Router)();
/**
 * GET /api/reports/:reportId/evidence
 * Object-level authorized presigned GET URL for a report's primary evidence.
 */
router.get('/reports/:reportId/evidence', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: Harap masuk terlebih dahulu.' });
        }
        const reportIdParam = req.params.reportId;
        const reportIdNum = parseInt(reportIdParam);
        const query = !isNaN(reportIdNum)
            ? { id: reportIdNum, deletedAt: null }
            : { _id: new mongoose_1.default.Types.ObjectId(reportIdParam), deletedAt: null };
        const report = await Report_1.ReportModel.findOne(query).exec();
        if (!report) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan.' });
        }
        // Object-level ACL Authorization Check
        const isAdmin = user.role === 'admin' || user.role === 'superadmin';
        const isOwner = report.userId && report.userId.toString() === user._id?.toString();
        const isSameWorkspace = user.workspaceId && report.workspaceId === user.workspaceId;
        if (!isAdmin && !isOwner && !isSameWorkspace) {
            return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke berkas bukti laporan ini.' });
        }
        // Find linked evidence or use report's r2Key / storageKey
        let r2Key = '';
        if (report.primaryEvidenceId) {
            const ev = await AiEvidence_1.AiEvidenceModel.findById(report.primaryEvidenceId).exec();
            if (ev && ev.storage && ev.storage.key) {
                r2Key = ev.storage.key;
            }
        }
        if (!r2Key && report.image) {
            const relPath = report.image.replace(/^\/+uploads\/+/, '').replace(/^\/+/, '');
            if (relPath.startsWith('laporan_auto/')) {
                r2Key = relPath;
            }
            else if (relPath.startsWith('laporan_manual/')) {
                r2Key = relPath;
            }
            else if (relPath.startsWith('evidence_') || relPath.startsWith('cctv_capture_')) {
                r2Key = `laporan_auto/${report.id}/${relPath}`;
            }
            else {
                r2Key = `laporan_auto/${report.id}/${relPath}`;
            }
        }
        if (!r2Key) {
            return res.status(404).json({ error: 'Bukti gambar tidak ditemukan pada laporan ini.', status: 'MISSING' });
        }
        // Check if Cloudflare R2 is configured
        if (!R2StorageService_1.R2StorageService.isConfigured()) {
            return res.json({
                url: report.image.startsWith('/') ? report.image : `/${report.image}`,
                isLocal: true,
                expiresInSeconds: 300,
                status: 'AVAILABLE'
            });
        }
        const duration = req.query.download === 'true' ? 900 : 300; // 5 min for UI display, 15 min for download
        const signedUrl = await R2StorageService_1.R2StorageService.getSignedUrl(r2Key, duration);
        // Security log: Log generic access WITHOUT logging full signature / token
        console.log(`[MEDIA_ACCESS] Generated signed URL for report #${report.id} (user #${user.id}, duration=${duration}s)`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        if (req.query.redirect === 'true') {
            return res.redirect(302, signedUrl);
        }
        res.json({
            url: signedUrl,
            r2Key,
            expiresInSeconds: duration,
            status: 'AVAILABLE'
        });
    }
    catch (err) {
        console.error('[MEDIA_ACCESS ERROR] Failed to resolve evidence URL:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
/**
 * GET /api/media/:mediaId
 * Direct media object resolution by AiEvidence ObjectId or numeric ID.
 */
router.get('/media/:mediaId', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: Harap masuk terlebih dahulu.' });
        }
        const mediaIdParam = req.params.mediaId;
        const mediaIdNum = parseInt(mediaIdParam);
        const query = !isNaN(mediaIdNum)
            ? { id: mediaIdNum }
            : { _id: new mongoose_1.default.Types.ObjectId(mediaIdParam) };
        const evidence = await AiEvidence_1.AiEvidenceModel.findOne(query).exec();
        if (!evidence) {
            return res.status(404).json({ error: 'Bukti media tidak ditemukan.', status: 'MISSING' });
        }
        // Object-level ACL Check via linked report
        if (evidence.reportId) {
            const report = await Report_1.ReportModel.findById(evidence.reportId).exec();
            if (report) {
                const isAdmin = user.role === 'admin' || user.role === 'superadmin';
                const isOwner = report.userId && report.userId.toString() === user._id?.toString();
                const isSameWorkspace = user.workspaceId && report.workspaceId === user.workspaceId;
                if (!isAdmin && !isOwner && !isSameWorkspace) {
                    return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke berkas media ini.' });
                }
            }
        }
        const r2Key = evidence.storage?.key || evidence.storageKey;
        if (!r2Key) {
            return res.status(404).json({ error: 'Bukti media tidak memiliki lokasi cloud.', status: 'MISSING' });
        }
        if (!R2StorageService_1.R2StorageService.isConfigured()) {
            return res.json({
                url: evidence.thumbnail || `/uploads/${r2Key}`,
                isLocal: true,
                status: evidence.storage?.status || 'AVAILABLE'
            });
        }
        const duration = 300;
        const signedUrl = await R2StorageService_1.R2StorageService.getSignedUrl(r2Key, duration);
        console.log(`[MEDIA_ACCESS] Generated signed URL for evidenceId=${evidence.id || evidence._id} (user #${user.id})`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        if (req.query.redirect === 'true') {
            return res.redirect(302, signedUrl);
        }
        res.json({
            url: signedUrl,
            r2Key,
            expiresInSeconds: duration,
            status: evidence.storage?.status || 'AVAILABLE'
        });
    }
    catch (err) {
        console.error('[MEDIA_ACCESS ERROR] Failed to resolve media URL:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
