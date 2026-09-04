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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
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
    try {
        const { TuyaClient } = require('../cctv/services/TuyaClient');
        const { CctvModel } = require('../database/models/Cctv');
        const camDoc = await CctvModel.findOne({
            $or: [
                { id: isNaN(Number(cameraId)) ? -999 : Number(cameraId) },
                { username: cameraId },
                { description: { $regex: cameraId } }
            ]
        }).lean();
        // --- Extract actual Tuya Device ID from description for ALL vendors ---
        let tuyaDeviceId = cameraId;
        if (camDoc?.description) {
            // Try 'Tuya Device ID: xxx' pattern (TUYA vendor)
            const tuyaIdMatch = camDoc.description.match(/Tuya Device ID[:\s]+([a-zA-Z0-9]+)/);
            // Try 'Virtual ID: xxx' pattern (KRISBOW vendor)
            const vidMatch = camDoc.description.match(/Virtual ID[:\s]+([a-zA-Z0-9]+)/);
            if (tuyaIdMatch && tuyaIdMatch[1]) {
                tuyaDeviceId = tuyaIdMatch[1];
                console.log(`[TUYA] Extracted Tuya Device ID from description: ${tuyaDeviceId}`);
            }
            else if (vidMatch && vidMatch[1]) {
                tuyaDeviceId = vidMatch[1];
                console.log(`[TUYA] Extracted Virtual ID from description: ${tuyaDeviceId}`);
            }
            else if (camDoc.username && camDoc.username.length > 10) {
                tuyaDeviceId = camDoc.username;
                console.log(`[TUYA] Using username as device ID: ${tuyaDeviceId}`);
            }
        }
        // Also check streamUrl for embedded device ID pattern
        if (tuyaDeviceId === cameraId && camDoc?.streamUrl) {
            const streamIdMatch = camDoc.streamUrl.match(/\/hls-proxy\/([a-zA-Z0-9]+)\//);
            if (streamIdMatch && streamIdMatch[1] && streamIdMatch[1].length > 10) {
                tuyaDeviceId = streamIdMatch[1];
                console.log(`[TUYA] Extracted device ID from streamUrl: ${tuyaDeviceId}`);
            }
        }
        const accessId = process.env.TUYA_CLIENT_ID || 'vhxcdfe5q7d5vr4wsgs3';
        const accessSecret = process.env.TUYA_CLIENT_SECRET || '0757b40d43884b83952b3b306814fba9';
        // Try primary endpoint, then fallback to India endpoint
        const primaryEndpoint = process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com';
        const client = new TuyaClient(accessId, accessSecret, primaryEndpoint);
        await client.getAccessToken();
        // Try Tuya Cloud native HLS (cached first, allocate fresh if expired)
        let streamUrl = '';
        let forceRefresh = false;
        try {
            streamUrl = await client.getStreamUrl(tuyaDeviceId, 'HLS');
        }
        catch (e) {
            console.warn(`[TUYA] HLS cache miss for ${tuyaDeviceId}: ${e.message}`);
        }
        // Fetch the manifest and check validity
        if (streamUrl) {
            const hlsRes = await fetch(streamUrl).catch(() => null);
            const playlistText = hlsRes ? await hlsRes.text().catch(() => '') : '';
            if (hlsRes?.ok && playlistText.includes('#EXT') && !playlistText.includes('session not found')) {
                const baseUrl = new URL(streamUrl);
                const lines = playlistText.split('\n');
                const rewrittenLines = [];
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i].trim();
                    if (line.startsWith('#EXT-X-KEY:')) {
                        const idx = line.indexOf('URI="');
                        if (idx !== -1) {
                            const endIdx = line.indexOf('"', idx + 5);
                            if (endIdx !== -1) {
                                const origUri = line.substring(idx + 5, endIdx);
                                const absUri = new URL(origUri, baseUrl).toString();
                                const proxied = `/api/cctv/hls-proxy/subresource?url=${encodeURIComponent(absUri)}`;
                                line = line.substring(0, idx + 5) + proxied + line.substring(endIdx);
                            }
                        }
                    }
                    else if (line.length > 0 && !line.startsWith('#')) {
                        const absUri = new URL(line, baseUrl).toString();
                        line = `/api/cctv/hls-proxy/subresource?url=${encodeURIComponent(absUri)}`;
                    }
                    rewrittenLines.push(line);
                }
                console.log(`[TUYA HLS PROXY] Serving native HLS for device ${tuyaDeviceId}`);
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(rewrittenLines.join('\n'));
            }
            // Session expired — clear cache and force fresh allocation
            console.warn(`[TUYA HLS PROXY] Session expired for ${tuyaDeviceId}, re-allocating HLS...`);
            TuyaClient.clearStreamCache(tuyaDeviceId);
            forceRefresh = true;
        }
        // Allocate fresh HLS session with 3s retry for 4G solar camera wake-up
        console.log(`[TUYA HLS PROXY] Allocating fresh HLS session for ${tuyaDeviceId}...`);
        let freshUrl = '';
        try {
            freshUrl = await client.getStreamUrl(tuyaDeviceId, 'HLS', true);
        }
        catch (hlsErr) {
            console.warn(`[TUYA HLS PROXY] First HLS allocation attempt failed for ${tuyaDeviceId}: ${hlsErr.message}. Retrying in 3s for camera wake-up...`);
            await new Promise(r => setTimeout(r, 3000));
            try {
                freshUrl = await client.getStreamUrl(tuyaDeviceId, 'HLS', true);
            }
            catch (retryErr) {
                console.warn(`[TUYA HLS PROXY] HLS allocation retry failed for ${tuyaDeviceId}: ${retryErr.message}. Falling back to RTSP transcoder.`);
            }
        }
        if (freshUrl && freshUrl.startsWith('http')) {
            const freshRes = await fetch(freshUrl);
            const freshPlaylist = await freshRes.text();
            if (!freshRes.ok || !freshPlaylist.includes('#EXT')) {
                throw new Error(`Fresh HLS stream invalid for ${tuyaDeviceId}`);
            }
            const baseUrl = new URL(freshUrl);
            const lines = freshPlaylist.split('\n');
            const rewrittenLines = [];
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line.startsWith('#EXT-X-KEY:')) {
                    const idx = line.indexOf('URI="');
                    if (idx !== -1) {
                        const endIdx = line.indexOf('"', idx + 5);
                        if (endIdx !== -1) {
                            const origUri = line.substring(idx + 5, endIdx);
                            const absUri = new URL(origUri, baseUrl).toString();
                            line = line.substring(0, idx + 5) + `/api/cctv/hls-proxy/subresource?url=${encodeURIComponent(absUri)}` + line.substring(endIdx);
                        }
                    }
                }
                else if (line.length > 0 && !line.startsWith('#')) {
                    const absUri = new URL(line, baseUrl).toString();
                    line = `/api/cctv/hls-proxy/subresource?url=${encodeURIComponent(absUri)}`;
                }
                rewrittenLines.push(line);
            }
            console.log(`[TUYA HLS PROXY] Serving fresh HLS session for device ${tuyaDeviceId}`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(rewrittenLines.join('\n'));
        }
        // HLS failed entirely — fall back to RTSP transcoder (SIGSEGV fixed by removing -tls_verify 0)
        console.log(`[TUYA RTSP FALLBACK] HLS unavailable, trying RTSP transcoder for ${tuyaDeviceId}...`);
        // Reuse existing healthy transcoder session if available
        if (RtspHlsTranscoder_1.RtspHlsTranscoder.isRunning(tuyaDeviceId)) {
            const existingPlaylist = RtspHlsTranscoder_1.RtspHlsTranscoder.getPlaylistPath(tuyaDeviceId);
            if (fs_1.default.existsSync(existingPlaylist)) {
                const content = fs_1.default.readFileSync(existingPlaylist, 'utf8');
                if (content.includes('.ts')) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                    res.setHeader('Cache-Control', 'no-cache');
                    return res.sendFile(existingPlaylist);
                }
                RtspHlsTranscoder_1.RtspHlsTranscoder.stop(tuyaDeviceId);
            }
        }
        // Allocate fresh RTSP/RTSPS stream via Tuya Cloud relay (works for Krisbow 4G behind CGNAT)
        console.log(`[TUYA RTSP TRANSCODER] Allocating fresh RTSP stream via Tuya Cloud relay for ${tuyaDeviceId}...`);
        const rtspUrl = await client.getStreamUrl(tuyaDeviceId, 'RTSP', true);
        console.log(`[TUYA RTSP TRANSCODER] Got relay URL: ${rtspUrl.slice(0, 60)}...`);
        await RtspHlsTranscoder_1.RtspHlsTranscoder.start(tuyaDeviceId, rtspUrl);
        const playlistPath = RtspHlsTranscoder_1.RtspHlsTranscoder.getPlaylistPath(tuyaDeviceId);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendFile(playlistPath);
    }
    catch (err) {
        console.error(`[HLS Proxy Error] Device ${cameraId}:`, err.message);
        const isSubscriptionExpired = err.message?.includes('28841002') || err.message?.includes('subscription has expired');
        const isNoPerm = err.message?.includes('28841107') || err.message?.includes('suspended');
        if (isSubscriptionExpired || isNoPerm) {
            // Return a special JSON error that the frontend can interpret
            res.setHeader('Content-Type', 'application/json');
            return res.status(503).json({
                error: 'TUYA_SUBSCRIPTION_EXPIRED',
                message: 'Langganan IoT Core Video Streaming Tuya sudah kedaluwarsa.',
                action: 'Perbarui subscription di iot.tuya.com → project Anda → Enable Service → Camera Management'
            });
        }
        res.status(502).json({ error: `Stream Allocation Failed: ${err.message}` });
    }
});
// Proxy for subresources (.ts segment chunks and AES key files)
router.get('/hls-proxy/subresource', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl)
            return res.status(400).send('Missing url parameter');
        const response = await fetch(targetUrl);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        if (response.headers.get('content-type')) {
            res.setHeader('Content-Type', response.headers.get('content-type'));
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
    }
    catch (err) {
        console.error('[HLS Subresource Proxy Error]:', err.message);
        res.status(502).send(err.message);
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
    await CctvModel.updateOne({ _id: cctv._id }, { $set: { streamUrl: proxyUrl, playUrl: proxyUrl } });
    console.log(`[TUYA] HLS proxy URL set for ${cctv.name}: ${proxyUrl}`);
    return proxyUrl;
}
router.get('/', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        let workspaceId = undefined;
        if (user && user.role !== 'superadmin' && user.workspaceId && user.workspaceId !== -1) {
            workspaceId = user.workspaceId;
        }
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
// ─── GET /api/cctv/stats ─────────────────────────────────────────────────────
// Centralized workspace-scoped CCTV statistics endpoint
router.get('/stats', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        let workspaceId = undefined;
        if (user && user.role !== 'superadmin' && user.workspaceId && user.workspaceId !== -1) {
            workspaceId = user.workspaceId;
        }
        const { CctvModel } = require('../database/models/Cctv');
        const query = {};
        if (workspaceId !== undefined) {
            query.workspaceId = workspaceId;
        }
        const cameras = await CctvModel.find(query).lean().exec();
        const registeredTotal = cameras.length;
        const onlineTotal = cameras.filter((c) => c.status === 'ONLINE').length;
        const offlineTotal = registeredTotal - onlineTotal;
        const activeStreamTotal = onlineTotal > 0 ? 1 : 0;
        res.json({
            success: true,
            registeredTotal,
            onlineTotal,
            offlineTotal,
            activeStreamTotal,
            workspaceId: workspaceId ?? 'GLOBAL'
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/cctv/stats failed:', err);
        res.status(500).json({ error: 'Gagal mengambil statistik CCTV' });
    }
});
router.get('/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        let workspaceId = undefined;
        if (user.role !== 'superadmin' && user.workspaceId && user.workspaceId !== -1) {
            workspaceId = user.workspaceId;
        }
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
router.get('/:id/tuya-stream', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        const workspaceId = user.workspaceId || -1;
        const id = parseInt(req.params.id);
        const camera = await CctvRepository_1.CctvRepository.getById(id, workspaceId);
        if (!camera || camera.vendor !== 'TUYA') {
            return res.status(404).json({ error: 'CCTV Tuya tidak ditemukan' });
        }
        // streamUrl was saved as tuya://accessId/accessSecret/deviceId
        const match = camera.streamUrl.match(/tuya:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
        if (!match) {
            return res.status(400).json({ error: 'Format Tuya streamUrl tidak valid' });
        }
        const [, accessId, accessSecret, deviceId] = match;
        const { TuyaCloudService } = await Promise.resolve().then(() => __importStar(require('../cctv/TuyaCloudService')));
        const result = await TuyaCloudService.getStreamUrl(accessId, accessSecret, deviceId, 'US');
        res.json({ success: true, data: result.url });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/cctv/:id/tuya-stream failed:', err);
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
        if (req.body.vendor === 'KRISBOW') {
            let deviceId = (req.body.tuyaDeviceId || req.body.virtualId || req.body.deviceId || '').trim();
            const ip = (req.body.ip || req.body.host || '38.52.195.243').trim();
            if (!deviceId && req.body.description) {
                const match = req.body.description.match(/Virtual ID:\s*([a-zA-Z0-9_-]+)/) || req.body.description.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
                if (match)
                    deviceId = match[1];
            }
            if (!deviceId) {
                return res.status(400).json({ error: 'Virtual ID / Device ID Krisbow Sync wajib diisi.' });
            }
            const proxyUrl = `/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;
            req.body.tuyaDeviceId = deviceId;
            req.body.streamUrl = proxyUrl;
            req.body.playUrl = proxyUrl;
            req.body.mediaType = 'HLS';
            req.body.protocol = 'HLS';
            if (!req.body.description || !req.body.description.includes('Virtual ID')) {
                req.body.description = req.body.description ? `${req.body.description} | Virtual ID: ${deviceId} | IP: ${ip}` : `Virtual ID: ${deviceId} | IP: ${ip} | Tuya Device ID: ${deviceId}`;
            }
            const newCctv = await CctvRepository_1.CctvRepository.add({ ...req.body, workspaceId: user.workspaceId }, user.id);
            CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(newCctv.id);
            return res.json({ success: true, data: newCctv });
        }
        if (req.body.vendor === 'TUYA') {
            const accessId = (req.body.tuyaAccessId || req.body.username || '').trim();
            const accessSecret = (req.body.tuyaAccessSecret || req.body.password || '').trim();
            let deviceId = (req.body.tuyaDeviceId || '').trim();
            if (!deviceId && req.body.description) {
                const match = req.body.description.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
                if (match)
                    deviceId = match[1];
            }
            if (!accessId || !accessSecret) {
                return res.status(400).json({ error: 'Access ID dan Access Secret Tuya wajib diisi.' });
            }
            if (!deviceId || deviceId === 'Pilih dari daftar device') {
                return res.status(400).json({ error: 'Device ID Tuya tidak valid.' });
            }
            const region = req.body.tuyaRegion || 'SG';
            const proxyUrl = `/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;
            req.body.username = accessId;
            req.body.password = accessSecret;
            req.body.tuyaAccessId = accessId;
            req.body.tuyaAccessSecret = accessSecret;
            req.body.tuyaDeviceId = deviceId;
            req.body.tuyaRegion = region;
            req.body.streamUrl = proxyUrl;
            req.body.playUrl = proxyUrl;
            req.body.mediaType = 'HLS';
            req.body.protocol = 'HLS';
            if (!req.body.description || !req.body.description.includes('Tuya Device ID')) {
                req.body.description = req.body.description ? `${req.body.description} | Tuya Device ID: ${deviceId}` : `Tuya Device ID: ${deviceId}`;
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
        const workspaceId = (user && user.workspaceId && user.workspaceId !== -1) ? user.workspaceId : undefined;
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID tidak valid' });
        const camera = await CctvRepository_1.CctvRepository.getById(id);
        if (!camera)
            return res.status(404).json({ error: 'CCTV tidak ditemukan' });
        const isCredentialsChanged = (req.body.username !== undefined && req.body.username !== camera.username) ||
            (req.body.password !== undefined && req.body.password !== camera.password) ||
            (req.body.vendor !== undefined && req.body.vendor !== camera.vendor);
        if (req.body.vendor === 'TUYA' && isCredentialsChanged) {
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
        const updated = await CctvRepository_1.CctvRepository.update(id, req.body);
        CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(id).catch(e => console.warn('[HEALTH ENGINE BACKGROUND CHECK ERROR]', e));
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
        const workspaceId = (user && user.workspaceId && user.workspaceId !== -1) ? user.workspaceId : undefined;
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
        // Get camera IDs in this workspace (or all cameras if workspaceId is not specified)
        const CctvModel = (await Promise.resolve().then(() => __importStar(require('../database/models/Cctv')))).CctvModel;
        const cameraQuery = {};
        if (workspaceId !== undefined && workspaceId !== null) {
            cameraQuery.workspaceId = workspaceId;
        }
        const camerasInWs = await CctvModel.find(cameraQuery).select('id').lean().exec();
        const cameraIds = camerasInWs.map(c => c.id);
        const detectionQuery = {
            status: { $in: ['INFERENCED', 'PROMOTED', 'DUPLICATE', 'LOW_CONFIDENCE'] }
        };
        if (cameraIds.length > 0) {
            detectionQuery.cameraId = { $in: cameraIds };
        }
        const detections = await AiDetection_1.AiDetectionModel.find(detectionQuery)
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
        const clientId = req.body.clientId || process.env.TUYA_CLIENT_ID || 'vqy8kv443e5ef3vrxce8';
        const clientSecret = req.body.clientSecret || process.env.TUYA_CLIENT_SECRET || 'd6a294ee060747049fd683be64854c5c';
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
