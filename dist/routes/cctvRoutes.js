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
const RtspHlsTranscoder_1 = require("../cctv/services/RtspHlsTranscoder");
const router = (0, express_1.Router)();
// ── RTSP→HLS Transcoder endpoint ─────────────────────────────────────────────
// Browser calls GET /api/cctv/hls-proxy/:cameraId/stream.m3u8
// Server fetches fresh RTSP URL from Tuya, starts ffmpeg to transcode to HLS,
// and redirects browser to the local /hls/:cameraId/stream.m3u8 static file.
router.get('/hls-proxy/:cameraId/stream.m3u8', async (req, res) => {
    const { cameraId } = req.params;
    // Reuse existing transcoding session if already active to prevent constant restarts
    if (RtspHlsTranscoder_1.RtspHlsTranscoder.isRunning(cameraId)) {
        console.log(`[RTSP→HLS] Transcoder for device ${cameraId} is already running. Reusing session.`);
        return res.redirect(RtspHlsTranscoder_1.RtspHlsTranscoder.getPublicUrl(cameraId));
    }
    try {
        const { TuyaClient } = require('../cctv/services/TuyaClient');
        const client = new TuyaClient(process.env.TUYA_CLIENT_ID || 'r5vap3snnr339dyeua5j', process.env.TUYA_CLIENT_SECRET || '5a93707b474b41b9b888b1e2a12ed1c9', 'https://openapi-sg.iotbing.com');
        await client.getAccessToken();
        const rtspUrl = await client.getStreamUrl(cameraId, 'rtsp');
        // Start or restart ffmpeg transcoder
        const publicUrl = await RtspHlsTranscoder_1.RtspHlsTranscoder.start(cameraId, rtspUrl);
        res.redirect(publicUrl);
    }
    catch (err) {
        console.error(`[HLS Proxy Error] Device ${cameraId}:`, err.message);
        res.status(502).json({ error: `Tuya Real Stream Allocation Failed: ${err.message}` });
    }
});
// Stop transcoder for a specific camera (called on page close / disconnect)
router.delete('/hls-proxy/:cameraId', (req, res) => {
    const { cameraId } = req.params;
    RtspHlsTranscoder_1.RtspHlsTranscoder.stop(cameraId);
    res.json({ success: true });
});
async function refreshTuyaStreamUrl(cctv) {
    if (cctv.vendor !== 'TUYA')
        return cctv.streamUrl;
    const match = cctv.description?.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
    if (!match)
        return cctv.streamUrl;
    const deviceId = match[1];
    const proxyUrl = `/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;
    const { CctvModel } = require('../database/models/Cctv');
    await CctvModel.updateOne({ _id: cctv._id }, { $set: { streamUrl: proxyUrl, playUrl: proxyUrl, protocol: 'HLS', mediaType: 'HLS' } });
    console.log(`[TUYA] HLS proxy URL set for ${cctv.name}: ${proxyUrl}`);
    return proxyUrl;
}
router.get('/', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const workspaceId = user ? (user.workspaceId || -1) : -1;
        const cctvs = await CctvRepository_1.CctvRepository.getAll(workspaceId);
        const { CctvModel } = require('../database/models/Cctv');
        const processed = await Promise.all(cctvs.map(async (c) => {
            let currentStreamUrl = c.streamUrl;
            let currentProtocol = c.protocol;
            if (c.vendor === 'TUYA') {
                currentStreamUrl = await refreshTuyaStreamUrl(c);
                // Re-read the latest protocol from DB after potential refresh
                const freshDoc = await CctvModel.findOne({ _id: c._id }).lean();
                if (freshDoc)
                    currentProtocol = freshDoc.protocol;
            }
            const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget({ ...c, streamUrl: currentStreamUrl, protocol: currentProtocol });
            return {
                ...c,
                streamUrl: currentStreamUrl,
                playUrl: playTarget.playUrl,
                mediaType: playTarget.playType,
                protocol: currentProtocol,
                password: c.password ? '••••••••' : ''
            };
        }));
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
        let currentStreamUrl = c.streamUrl;
        if (c.vendor === 'TUYA') {
            currentStreamUrl = await refreshTuyaStreamUrl(c);
        }
        const decryptedPassword = user.role === 'admin' && c.password
            ? CctvRepository_1.CctvRepository.decryptCctvPassword(c.password)
            : '';
        const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget({ ...c, streamUrl: currentStreamUrl });
        res.json({
            success: true,
            data: {
                ...c,
                streamUrl: currentStreamUrl,
                playUrl: playTarget.playUrl,
                mediaType: playTarget.playType,
                password: decryptedPassword
            }
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
router.post('/tuya-devices', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Khusus Admin' });
        const { accessId, accessSecret, region } = req.body;
        if (!accessId || !accessSecret) {
            return res.status(400).json({ error: 'Access ID dan Secret wajib diisi' });
        }
        const { TuyaCloudService } = await Promise.resolve().then(() => __importStar(require('../cctv/TuyaCloudService')));
        const result = await TuyaCloudService.validateCredentials(accessId, accessSecret, region || 'US');
        if (result.ok) {
            res.json({ success: true, data: result.devices || [] });
        }
        else {
            res.json({ success: false, error: result.msg });
        }
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/tuya-devices failed:', err);
        res.status(500).json({ success: false, error: err.message });
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
        if (req.body.vendor === 'TUYA') {
            const { username: accessId, password: accessSecret, description } = req.body;
            const match = description?.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
            const deviceId = match ? match[1] : '';
            if (!accessId || !accessSecret) {
                return res.status(400).json({ error: 'Access ID dan Access Secret Tuya wajib diisi.' });
            }
            if (!deviceId || deviceId === 'Pilih dari daftar device') {
                return res.status(400).json({ error: 'Device ID Tuya tidak valid.' });
            }
            const { TuyaCloudService } = await Promise.resolve().then(() => __importStar(require('../cctv/TuyaCloudService')));
            let validation = { ok: false, msg: '', devices: [] };
            let allDevices = [];
            let anyRegionOk = false;
            for (const reg of ['SG', 'US', 'US_EAST', 'EU', 'EU_WEST', 'CN', 'IN']) {
                const valResult = await TuyaCloudService.validateCredentials(accessId, accessSecret, reg);
                if (valResult.ok) {
                    anyRegionOk = true;
                    if (Array.isArray(valResult.devices)) {
                        allDevices.push(...valResult.devices);
                    }
                }
                else {
                    validation.msg = valResult.msg;
                }
            }
            validation.ok = anyRegionOk;
            validation.devices = allDevices;
            if (!validation.ok) {
                return res.status(400).json({ error: `Kredensial Tuya tidak valid: ${validation.msg}` });
            }
            const deviceExists = allDevices.some((d) => d.id === deviceId);
            if (!deviceExists) {
                return res.status(400).json({ error: `Device ID "${deviceId}" tidak ditemukan pada akun Tuya Anda.` });
            }
        }
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
        const camera = await CctvRepository_1.CctvRepository.getById(id, workspaceId);
        if (!camera)
            return res.status(404).json({ error: 'CCTV tidak ditemukan' });
        const vendor = req.body.vendor !== undefined ? req.body.vendor : camera.vendor;
        if (vendor === 'TUYA') {
            const accessId = req.body.username !== undefined ? req.body.username : camera.username;
            const accessSecret = req.body.password !== undefined ? req.body.password : (camera.password ? CctvRepository_1.CctvRepository.decryptCctvPassword(camera.password) : '');
            const description = req.body.description !== undefined ? req.body.description : camera.description;
            const match = description?.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
            const deviceId = match ? match[1] : '';
            if (!accessId || !accessSecret) {
                return res.status(400).json({ error: 'Access ID dan Access Secret Tuya wajib diisi.' });
            }
            if (!deviceId || deviceId === 'Pilih dari daftar device') {
                return res.status(400).json({ error: 'Device ID Tuya tidak valid.' });
            }
            const { TuyaCloudService } = await Promise.resolve().then(() => __importStar(require('../cctv/TuyaCloudService')));
            let validation = { ok: false, msg: '', devices: [] };
            let allDevices = [];
            let anyRegionOk = false;
            for (const reg of ['SG', 'US', 'US_EAST', 'EU', 'EU_WEST', 'CN', 'IN']) {
                const valResult = await TuyaCloudService.validateCredentials(accessId, accessSecret, reg);
                if (valResult.ok) {
                    anyRegionOk = true;
                    if (Array.isArray(valResult.devices)) {
                        allDevices.push(...valResult.devices);
                    }
                }
                else {
                    validation.msg = valResult.msg;
                }
            }
            validation.ok = anyRegionOk;
            validation.devices = allDevices;
            if (!validation.ok) {
                return res.status(400).json({ error: `Kredensial Tuya tidak valid: ${validation.msg}` });
            }
            const deviceExists = allDevices.some((d) => d.id === deviceId);
            if (!deviceExists) {
                return res.status(400).json({ error: `Device ID "${deviceId}" tidak ditemukan pada akun Tuya Anda.` });
            }
        }
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
router.get('/monitoring/status', async (req, res) => {
    try {
        const running = AiPipelineScheduler_1.AiPipelineScheduler.getStatus();
        res.json({ success: true, running });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /monitoring/status failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/monitoring/start', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        AiPipelineScheduler_1.AiPipelineScheduler.start(5000, user.workspaceId);
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
            status: { $in: ['INFERENCED', 'PROMOTED', 'DUPLICATE', 'LOW_CONFIDENCE'] },
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
            detections: d.detections || [], // Add detections field!
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
            const fs = require('fs');
            const path = require('path');
            const capturePath = path.join(process.cwd(), 'public/uploads', `cctv_capture_${camera.id}.jpg`);
            if (fs.existsSync(capturePath)) {
                res.sendFile(capturePath);
            }
            else {
                res.status(404).send('Belum ada snapshot yang tersimpan untuk kamera ini.');
            }
        }
    }
    catch (err) {
        res.status(500).send('Internal Server Error');
    }
});
router.post('/tuya-sync', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const clientId = req.body.clientId || process.env.TUYA_CLIENT_ID || 'r5vap3snnr339dyeua5j';
        const clientSecret = req.body.clientSecret || process.env.TUYA_CLIENT_SECRET || '5a93707b474b41b9b888b1e2a12ed1c9';
        const region = req.body.region || 'https://openapi-sg.iotbing.com';
        const { TuyaClient } = require('../cctv/services/TuyaClient');
        const { CctvModel } = require('../database/models/Cctv');
        const client = new TuyaClient(clientId, clientSecret, region);
        await client.getAccessToken();
        const devices = await client.listDevices();
        let cameras = devices.filter((d) => {
            const category = (d.category || '').toLowerCase();
            const name = (d.name || '').toLowerCase();
            const productName = (d.product_name || '').toLowerCase();
            return (category === 'sp' ||
                category === 'ipc' ||
                category === 'dghsxj' ||
                category.includes('cam') ||
                category.includes('sp') ||
                category.includes('xj') ||
                category.includes('shipin') ||
                name.includes('camera') ||
                name.includes('cctv') ||
                name.includes('solar') ||
                productName.includes('camera') ||
                productName.includes('cctv') ||
                productName.includes('solar'));
        });
        if (cameras.length === 0) {
            return res.json({ success: true, message: 'Tidak ditemukan perangkat IPC/Kamera pada akun Tuya Anda.', synced: 0 });
        }
        // Purge old dummy or invalid Tuya cameras from DB
        await CctvModel.deleteMany({
            vendor: 'TUYA',
            workspaceId: user.workspaceId,
            $or: [
                { description: { $regex: 'a368caa9d0ba8c2813gfir' } },
                { description: { $regex: 'tuya_dev_' } }
            ]
        });
        const syncedDevices = [];
        for (const cam of cameras) {
            const existing = await CctvModel.findOne({
                description: { $regex: cam.id },
                workspaceId: user.workspaceId
            });
            let streamUrl = `/api/cctv/hls-proxy/${cam.id}/stream.m3u8`;
            try {
                streamUrl = await client.getStreamUrl(cam.id, 'hls');
            }
            catch (streamErr) {
                try {
                    streamUrl = await client.getStreamUrl(cam.id, 'rtsp');
                }
                catch (rtspErr) {
                    console.warn(`[TUYA SYNC WARNING] Could not allocate direct URL for ${cam.name}: ${rtspErr.message}`);
                    streamUrl = `/api/cctv/hls-proxy/${cam.id}/stream.m3u8`;
                }
            }
            if (existing) {
                await CctvModel.updateOne({ _id: existing._id }, {
                    $set: {
                        streamUrl,
                        playUrl: streamUrl,
                        status: cam.online ? 'ONLINE' : 'OFFLINE',
                        isActive: true
                    }
                });
                syncedDevices.push({ id: existing.id, name: cam.name, action: 'updated' });
            }
            else {
                // Determine protocol type from URL
                let detectedProtocol = 'HLS';
                if (streamUrl.startsWith('rtsps://') || streamUrl.startsWith('rtsp://')) {
                    detectedProtocol = 'RTSP_TUYA';
                }
                else if (streamUrl.startsWith('http') && streamUrl.includes('m3u8')) {
                    detectedProtocol = 'HLS';
                }
                else if (streamUrl.includes('localhost')) {
                    detectedProtocol = 'RTSP_TUYA';
                }
                const newCctv = await CctvRepository_1.CctvRepository.add({
                    name: cam.name,
                    location: 'Tuya Cloud Device',
                    description: `Tuya Device ID: ${cam.id}`,
                    vendor: 'TUYA',
                    model: cam.product_name || 'IPC',
                    protocol: detectedProtocol,
                    mediaType: 'Video',
                    streamUrl: streamUrl,
                    playUrl: streamUrl,
                    capabilities: {
                        rtsp: streamUrl.startsWith('rtsp'),
                        hls: streamUrl.startsWith('http') && streamUrl.includes('m3u8'),
                        snapshot: false,
                        mjpeg: false,
                        onvif: false,
                        cloud: true
                    },
                    status: cam.online ? 'ONLINE' : 'OFFLINE',
                    workspaceId: user.workspaceId
                }, user.id);
                syncedDevices.push({ id: newCctv.id, name: cam.name, action: 'created' });
            }
        }
        res.json({
            success: true,
            message: `Berhasil sinkronisasi ${syncedDevices.length} kamera CCTV dari Tuya Developer Platform.`,
            data: syncedDevices
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/tuya-sync failed:', err);
        const detail = err.cause ? `${err.message} (Cause: ${err.cause.message || err.cause})` : err.message;
        res.status(500).json({ error: detail || 'Internal Server Error' });
    }
});
exports.default = router;
