"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const CctvAdapter_1 = require("../cctv/CctvAdapter");
const CctvHealthEngine_1 = require("../cctv/CctvHealthEngine");
const CctvScanner_1 = require("../cctv/CctvScanner");
const CctvRepository_1 = require("../database/repositories/CctvRepository");
const authMiddleware_1 = require("../auth/authMiddleware");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        const workspaceId = user.role === 'admin' ? undefined : (user.workspaceId || -1);
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
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID tidak valid' });
        const updated = await CctvRepository_1.CctvRepository.update(id, req.body, user.workspaceId);
        CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(id);
        res.json({ success: true, data: updated });
    }
    catch (err) {
        console.error('[SERVER ERROR] PUT /api/cctv/:id failed:', err);
        res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengubah CCTV' });
    }
});
router.delete('/:id', async (req, res) => {
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
        await CctvRepository_1.CctvRepository.delete(id, user.workspaceId);
        res.json({ success: true, message: 'CCTV berhasil diputuskan' });
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
