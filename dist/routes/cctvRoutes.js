"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const CctvAdapter_1 = require("../cctv/CctvAdapter");
const CctvHealthEngine_1 = require("../cctv/CctvHealthEngine");
const CctvScanner_1 = require("../cctv/CctvScanner");
const CctvRepository_1 = require("../database/repositories/CctvRepository");
const AiPipelineScheduler_1 = require("../cctv/services/AiPipelineScheduler");
const AiDetection_1 = require("../database/models/AiDetection");
const authMiddleware_1 = require("../auth/authMiddleware");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const workspaceId = user ? (user.workspaceId || -1) : -1;
        const cctvs = await CctvRepository_1.CctvRepository.getAll(workspaceId);
        const processed = cctvs.map((c) => {
            const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget(c);
            return {
                ...c,
                playUrl: playTarget.playUrl,
                mediaType: playTarget.playType,
                password: c.password ? '••••••••' : ''
            };
        });
        res.json({ success: true, data: processed });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/cctv failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        const workspaceId = user.workspaceId || -1;
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID tidak valid' });
        const c = await CctvRepository_1.CctvRepository.getById(id, workspaceId);
        if (!c)
            return res.status(404).json({ error: 'CCTV tidak ditemukan' });
        const decryptedPassword = user.role === 'admin' && c.password
            ? CctvRepository_1.CctvRepository.decryptCctvPassword(c.password)
            : '';
        const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget(c);
        res.json({
            success: true,
            data: { ...c, playUrl: playTarget.playUrl, mediaType: playTarget.playType, password: decryptedPassword }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/cctv/:id failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/scan', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const { ipOrHost, username, password, vendorHint, port, connectionMode } = req.body;
        if (!ipOrHost)
            return res.status(400).json({ error: 'IP Address / Host wajib diisi.' });
        const scanResult = await CctvScanner_1.CctvScanner.scan(ipOrHost, username, password, vendorHint, port ? parseInt(port) : undefined, connectionMode);
        res.json({ success: true, data: scanResult });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/scan failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const newCctv = await CctvRepository_1.CctvRepository.add({ ...req.body, workspaceId: user.workspaceId }, user.id);
        CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(newCctv.id);
        res.json({ success: true, data: newCctv });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv failed:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menambahkan CCTV' });
    }
});
router.put('/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const workspaceId = user ? (user.workspaceId || -1) : -1;
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID tidak valid' });
        const updated = await CctvRepository_1.CctvRepository.update(id, req.body, workspaceId);
        CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(id);
        res.json({ success: true, data: updated });
    }
    catch (err) {
        console.error('[SERVER ERROR] PUT /api/cctv/:id failed:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengubah CCTV' });
    }
});
router.delete('/clear-all', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const CctvModelLocal = (await Promise.resolve().then(() => __importStar(require('../database/models/Cctv')))).CctvModel;
        const workspaceId = user ? user.workspaceId : undefined;
        if (workspaceId !== undefined) {
            await CctvModelLocal.deleteMany({ workspaceId });
        }
        else {
            await CctvModelLocal.deleteMany({});
        }
        res.json({ success: true, message: 'Semua CCTV berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] DELETE /api/cctv/clear-all failed:', err);
        res.status(500).json({ error: 'Gagal menghapus semua CCTV' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const workspaceId = user ? (user.workspaceId || -1) : -1;
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID tidak valid' });
        await CctvRepository_1.CctvRepository.delete(id, workspaceId);
        res.json({ success: true, message: 'CCTV berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] DELETE /api/cctv/:id failed:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menghapus CCTV' });
    }
});
router.post('/:id/reconnect', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID tidak valid' });
        const camera = await CctvRepository_1.CctvRepository.getById(id, user.workspaceId);
        if (!camera)
            return res.status(404).json({ error: 'CCTV tidak ditemukan' });
        const success = await CctvHealthEngine_1.CctvHealthEngine.manualReconnect(id);
        if (success)
            res.json({ success: true, message: 'Reconnection triggered' });
        else
            res.status(400).json({ error: 'Failed to trigger reconnect' });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/:id/reconnect failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ── Monitoring Endpoints ──
router.post('/monitoring/start', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        AiPipelineScheduler_1.AiPipelineScheduler.start(20000, user.workspaceId);
        res.json({ success: true, message: 'AI monitoring pipeline started' });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /monitoring/start failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/monitoring/stop', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        await AiPipelineScheduler_1.AiPipelineScheduler.stop();
        res.json({ success: true, message: 'AI monitoring pipeline stopped' });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /monitoring/stop failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/monitoring/detections', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const workspaceId = user.workspaceId;
        // Get camera IDs in this workspace
        const CctvModel = (await Promise.resolve().then(() => __importStar(require('../database/models/Cctv')))).CctvModel;
        const camerasInWs = await CctvModel.find({ workspaceId }).select('id').lean().exec();
        const cameraIds = camerasInWs.map(c => c.id);
        if (cameraIds.length === 0) {
            return res.json({ success: true, data: [] });
        }
        const detections = await AiDetection_1.AiDetectionModel.find({
            status: { $in: ['INFERENCED', 'PROMOTED'] },
            cameraId: { $in: cameraIds }
        })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()
            .exec();
        // Enrich with auto-reported info
        const enriched = detections.map(d => ({
            id: d.id,
            cameraId: d.cameraId,
            location: d.location,
            capturedAt: d.capturedAt,
            confidence: d.confidence,
            severity: d.severity,
            status: d.status,
            autoReported: d.status === 'PROMOTED' && !!d.promotedReportId,
            promotedReportId: d.promotedReportId || null,
            createdAt: d.createdAt
        }));
        res.json({ success: true, data: enriched });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /monitoring/detections failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/:id/snapshot', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).send('Unauthorized');
        const workspaceId = user.workspaceId || -1;
        const id = parseInt(req.params.id);
        const camera = await CctvRepository_1.CctvRepository.getById(id, workspaceId);
        if (!camera)
            return res.status(404).send('Camera not found');
        if (camera.isDefault || camera.protocol === 'HTTP Image') {
            res.redirect(camera.streamUrl);
        }
        else {
            res.redirect('/uploads/detection_1.jpg');
        }
    }
    catch (err) {
        res.status(500).send('Internal Server Error');
    }
});
exports.default = router;
