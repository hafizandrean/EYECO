import { Router } from 'express';
import fs from 'fs';
import { CctvAdapter } from '../cctv/CctvAdapter';
import { CctvHealthEngine } from '../cctv/CctvHealthEngine';
import { CctvScanner } from '../cctv/CctvScanner';
import { CctvRepository } from '../database/repositories/CctvRepository';
import { AiPipelineScheduler } from '../cctv/services/AiPipelineScheduler';
import { AiDetectionModel } from '../database/models/AiDetection';
import { authMiddleware, getLoggedInUser } from '../auth/authMiddleware';
import { roleGuard } from '../auth/RoleMiddleware';
import { RtspHlsTranscoder } from '../cctv/services/RtspHlsTranscoder';
import { TuyaClient } from '../cctv/services/TuyaClient';
const router = Router();


// ── RTSP→HLS Transcoder endpoint ─────────────────────────────────────────────
// Browser calls GET /api/cctv/hls-proxy/:cameraId/stream.m3u8
// Server fetches fresh RTSP URL from Tuya, starts ffmpeg to transcode to HLS,
// and redirects browser to the local /hls/:cameraId/stream.m3u8 static file.

router.get('/hls-proxy/:cameraId/stream.m3u8', async (req, res) => {
  const { cameraId } = req.params;
  
  // Reuse existing transcoding session if already active to prevent constant restarts
  if (RtspHlsTranscoder.isRunning(cameraId)) {
    console.log(`[RTSP→HLS] Transcoder for device ${cameraId} is already running. Reusing session.`);
    const playlistPath = RtspHlsTranscoder.getPlaylistPath(cameraId);
    if (fs.existsSync(playlistPath)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(playlistPath);
    }
  }

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

    const accessId = camDoc?.tuyaAccessId || camDoc?.username || process.env.TUYA_CLIENT_ID || 'vhxcdfe5q7d5vr4wsgs3';
    const accessSecret = camDoc?.tuyaAccessSecret || camDoc?.password || process.env.TUYA_CLIENT_SECRET || '0757b40d43884h83952b3b306814fba9';

    const client = new TuyaClient(
      accessId,
      accessSecret,
      process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com'
    );
    await client.getAccessToken();
    const streamUrl = await client.getStreamUrl(cameraId, 'HLS');

    if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
      console.log(`[TUYA HLS PROXY] Proxying Tuya Native Cloud HLS URL for device ${cameraId}: ${streamUrl.slice(0, 60)}...`);
      const hlsRes = await fetch(streamUrl);
      const playlistText = await hlsRes.text();

      if (hlsRes.ok && playlistText.includes('#EXT') && !playlistText.includes('session not found')) {
        const baseUrl = new URL(streamUrl);
        const lines = playlistText.split('\n');
        const rewrittenLines: string[] = [];

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
          } else if (line.length > 0 && !line.startsWith('#')) {
            const absUri = new URL(line, baseUrl).toString();
            line = `/api/cctv/hls-proxy/subresource?url=${encodeURIComponent(absUri)}`;
          }
          rewrittenLines.push(line);
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(rewrittenLines.join('\n'));
      }
      console.warn(`[TUYA HLS PROXY] Native HLS session expired or invalid, clearing cache and falling back to RTSP transcoder...`);
      TuyaClient.clearStreamCache(cameraId);
    }

    // Allocate fresh RTSP stream as robust fallback
    const rtspUrl = await client.getStreamUrl(cameraId, 'RTSP', true);
    await RtspHlsTranscoder.start(cameraId, rtspUrl);
    const playlistPath = RtspHlsTranscoder.getPlaylistPath(cameraId);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(playlistPath);
  } catch (err: any) {
    TuyaClient.clearStreamCache(cameraId);
    console.error(`[HLS Proxy Error] Device ${cameraId}:`, err.message);
    res.status(502).json({ error: `Tuya Real Stream Allocation Failed: ${err.message}` });
  }
});

// Proxy for subresources (.ts segment chunks and AES key files)
router.get('/hls-proxy/subresource', async (req, res) => {
  try {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    const response = await fetch(targetUrl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type')!);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    console.error('[HLS Subresource Proxy Error]:', err.message);
    res.status(502).send(err.message);
  }
});

// Stop transcoder for a specific camera (called on page close / disconnect)
router.delete('/hls-proxy/:cameraId', (req, res) => {
  const { cameraId } = req.params;
  RtspHlsTranscoder.stop(cameraId);
  res.json({ success: true });
});

async function refreshTuyaStreamUrl(cctv: any): Promise<string> {
  if (cctv.vendor !== 'TUYA') return cctv.streamUrl;

  const match = cctv.description?.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
  if (!match) return cctv.streamUrl;
  const deviceId = match[1];

  const proxyUrl = `/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;

  const { CctvModel } = require('../database/models/Cctv');
  await CctvModel.updateOne(
    { _id: (cctv as any)._id },
    { $set: { streamUrl: proxyUrl, playUrl: proxyUrl } }
  );
  console.log(`[TUYA] HLS proxy URL set for ${cctv.name}: ${proxyUrl}`);
  return proxyUrl;
}


router.get('/', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    let workspaceId: number | undefined = undefined;
    if (user && user.role !== 'superadmin' && user.workspaceId && user.workspaceId !== -1) {
      workspaceId = user.workspaceId;
    }
    const cctvs = await CctvRepository.getAll(workspaceId);
    
    const { CctvModel } = require('../database/models/Cctv');
    const processed = await Promise.all(cctvs.map(async (c) => {
      let currentStreamUrl = c.streamUrl;
      let currentProtocol = c.protocol;

      if (c.vendor === 'TUYA') {
        currentStreamUrl = await refreshTuyaStreamUrl(c);
        // Re-read the latest protocol from DB after potential refresh
        const freshDoc = await CctvModel.findOne({ _id: (c as any)._id }).lean();
        if (freshDoc) currentProtocol = freshDoc.protocol;
      }
      
      const playTarget = CctvAdapter.getPlayTarget({ ...c, streamUrl: currentStreamUrl, protocol: currentProtocol } as any);
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
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/cctv failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── GET /api/cctv/stats ─────────────────────────────────────────────────────
// Centralized workspace-scoped CCTV statistics endpoint
router.get('/stats', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    let workspaceId: number | undefined = undefined;
    if (user && user.role !== 'superadmin' && user.workspaceId && user.workspaceId !== -1) {
      workspaceId = user.workspaceId;
    }

    const { CctvModel } = require('../database/models/Cctv');
    const query: Record<string, unknown> = {};
    if (workspaceId !== undefined) {
      query.workspaceId = workspaceId;
    }

    const cameras = await CctvModel.find(query).lean().exec();
    const registeredTotal = cameras.length;
    const onlineTotal = cameras.filter((c: any) => c.status === 'ONLINE').length;
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
  } catch (err: any) {
    console.error('[SERVER ERROR] GET /api/cctv/stats failed:', err);
    res.status(500).json({ error: 'Gagal mengambil statistik CCTV' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });

    let workspaceId: number | undefined = undefined;
    if (user.role !== 'superadmin' && user.workspaceId && user.workspaceId !== -1) {
      workspaceId = user.workspaceId;
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });
    const c = await CctvRepository.getById(id, workspaceId);
    if (!c) return res.status(404).json({ error: 'CCTV tidak ditemukan' });

    let currentStreamUrl = c.streamUrl;
    if (c.vendor === 'TUYA') {
      currentStreamUrl = await refreshTuyaStreamUrl(c);
    }

    const decryptedPassword = user.role === 'admin' && c.password
      ? CctvRepository.decryptCctvPassword(c.password)
      : '';

    const playTarget = CctvAdapter.getPlayTarget({ ...c, streamUrl: currentStreamUrl } as any);
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
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/cctv/:id failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    if (!user.workspaceId) return res.status(403).json({ error: 'Admin belum diassign ke workspace' });

    const { ipOrHost, username, password, vendorHint, port, connectionMode } = req.body;
    if (!ipOrHost) return res.status(400).json({ error: 'IP Address / Host wajib diisi.' });

    const scanResult = await CctvScanner.scan(ipOrHost, username, password, vendorHint, port ? parseInt(port) : undefined, connectionMode);
    res.json({ success: true, data: scanResult });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/cctv/scan failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/tuya-devices', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Khusus Admin' });

    const { accessId, accessSecret, region } = req.body;
    if (!accessId || !accessSecret) {
      return res.status(400).json({ error: 'Access ID dan Secret wajib diisi' });
    }

    const { TuyaCloudService } = await import('../cctv/TuyaCloudService');
    const result = await TuyaCloudService.validateCredentials(accessId, accessSecret, region || 'US');
    if (result.ok) {
      res.json({ success: true, data: result.devices || [] });
    } else {
      res.json({ success: false, error: result.msg });
    }
  } catch (err: any) {
    console.error('[SERVER ERROR] POST /api/cctv/tuya-devices failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/tuya-stream', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    const workspaceId = user.workspaceId || -1;
    const id = parseInt(req.params.id);
    const camera = await CctvRepository.getById(id, workspaceId);
    
    if (!camera || camera.vendor !== 'TUYA') {
      return res.status(404).json({ error: 'CCTV Tuya tidak ditemukan' });
    }

    // streamUrl was saved as tuya://accessId/accessSecret/deviceId
    const match = camera.streamUrl.match(/tuya:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Format Tuya streamUrl tidak valid' });
    }

    const [, accessId, accessSecret, deviceId] = match;
    const { TuyaCloudService } = await import('../cctv/TuyaCloudService');
    const result = await TuyaCloudService.getStreamUrl(accessId, accessSecret, deviceId, 'US');
    
    res.json({ success: true, data: result.url });
  } catch (err: any) {
    console.error('[SERVER ERROR] GET /api/cctv/:id/tuya-stream failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    if (!user.workspaceId) return res.status(403).json({ error: 'Admin belum diassign ke workspace' });

    if (req.body.vendor === 'KRISBOW') {
      let deviceId = (req.body.tuyaDeviceId || req.body.virtualId || req.body.deviceId || '').trim();
      const ip = (req.body.ip || req.body.host || '38.52.195.243').trim();
      if (!deviceId && req.body.description) {
        const match = req.body.description.match(/Virtual ID:\s*([a-zA-Z0-9_-]+)/) || req.body.description.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
        if (match) deviceId = match[1];
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

      const newCctv = await CctvRepository.add({ ...req.body, workspaceId: user.workspaceId }, user.id);
      CctvHealthEngine.checkCameraHealth(newCctv.id);
      return res.json({ success: true, data: newCctv });
    }

    if (req.body.vendor === 'TUYA') {
      const accessId = (req.body.tuyaAccessId || req.body.username || '').trim();
      const accessSecret = (req.body.tuyaAccessSecret || req.body.password || '').trim();
      let deviceId = (req.body.tuyaDeviceId || '').trim();
      if (!deviceId && req.body.description) {
        const match = req.body.description.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
        if (match) deviceId = match[1];
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

    const newCctv = await CctvRepository.add({ ...req.body, workspaceId: user.workspaceId }, user.id);
    CctvHealthEngine.checkCameraHealth(newCctv.id);
    res.json({ success: true, data: newCctv });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] POST /api/cctv failed:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menambahkan CCTV' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    const workspaceId = (user && user.workspaceId && user.workspaceId !== -1) ? user.workspaceId : undefined;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

    const camera = await CctvRepository.getById(id);
    if (!camera) return res.status(404).json({ error: 'CCTV tidak ditemukan' });

    const isCredentialsChanged = (req.body.username !== undefined && req.body.username !== camera.username) ||
                                 (req.body.password !== undefined && req.body.password !== camera.password) ||
                                 (req.body.vendor !== undefined && req.body.vendor !== camera.vendor);

    if (req.body.vendor === 'TUYA' && isCredentialsChanged) {
      const accessId = req.body.username !== undefined ? req.body.username : camera.username;
      const accessSecret = req.body.password !== undefined ? req.body.password : (camera.password ? CctvRepository.decryptCctvPassword(camera.password) : '');
      const description = req.body.description !== undefined ? req.body.description : camera.description;
      const match = description?.match(/Tuya Device ID:\s*([a-zA-Z0-9_-]+)/);
      const deviceId = match ? match[1] : '';

      if (!accessId || !accessSecret) {
        return res.status(400).json({ error: 'Access ID dan Access Secret Tuya wajib diisi.' });
      }
      if (!deviceId || deviceId === 'Pilih dari daftar device') {
        return res.status(400).json({ error: 'Device ID Tuya tidak valid.' });
      }

      const { TuyaCloudService } = await import('../cctv/TuyaCloudService');
      let validation: any = { ok: false, msg: '', devices: [] };
      let allDevices: any[] = [];
      let anyRegionOk = false;
      for (const reg of ['SG', 'US', 'US_EAST', 'EU', 'EU_WEST', 'CN', 'IN']) {
        const valResult = await TuyaCloudService.validateCredentials(accessId, accessSecret, reg);
        if (valResult.ok) {
          anyRegionOk = true;
          if (Array.isArray(valResult.devices)) {
            allDevices.push(...valResult.devices);
          }
        } else {
          validation.msg = valResult.msg;
        }
      }
      validation.ok = anyRegionOk;
      validation.devices = allDevices;

      if (!validation.ok) {
        return res.status(400).json({ error: `Kredensial Tuya tidak valid: ${validation.msg}` });
      }

      const deviceExists = allDevices.some((d: any) => d.id === deviceId);
      if (!deviceExists) {
        return res.status(400).json({ error: `Device ID "${deviceId}" tidak ditemukan pada akun Tuya Anda.` });
      }
    }

    const updated = await CctvRepository.update(id, req.body);
    CctvHealthEngine.checkCameraHealth(id).catch(e => console.warn('[HEALTH ENGINE BACKGROUND CHECK ERROR]', e));
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] PUT /api/cctv/:id failed:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengubah CCTV' });
  }
});

router.delete('/clear-all', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    const CctvModelLocal = (await import('../database/models/Cctv')).CctvModel;
    const workspaceId = user ? user.workspaceId : undefined;
    if (workspaceId !== undefined) {
      await CctvModelLocal.deleteMany({ workspaceId });
    } else {
      await CctvModelLocal.deleteMany({});
    }
    res.json({ success: true, message: 'Semua CCTV berhasil dihapus' });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] DELETE /api/cctv/clear-all failed:', err);
    res.status(500).json({ error: 'Gagal menghapus semua CCTV' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    const workspaceId = (user && user.workspaceId && user.workspaceId !== -1) ? user.workspaceId : undefined;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

    await CctvRepository.delete(id, workspaceId);
    res.json({ success: true, message: 'CCTV berhasil dihapus' });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] DELETE /api/cctv/:id failed:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menghapus CCTV' });
  }
});



router.post('/:id/reconnect', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    if (!user.workspaceId) return res.status(403).json({ error: 'Admin belum diassign ke workspace' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID tidak valid' });

    const camera = await CctvRepository.getById(id, user.workspaceId);
    if (!camera) return res.status(404).json({ error: 'CCTV tidak ditemukan' });

    const success = await CctvHealthEngine.manualReconnect(id);
    if (success) res.json({ success: true, message: 'Reconnection triggered' });
    else res.status(400).json({ error: 'Failed to trigger reconnect' });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/cctv/:id/reconnect failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── Monitoring Endpoints ──
router.get('/monitoring/status', async (req, res) => {
  try {
    const running = AiPipelineScheduler.getStatus();
    res.json({ success: true, running });
  } catch (err) {
    console.error('[SERVER ERROR] GET /monitoring/status failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/monitoring/start', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    if (!user.workspaceId) return res.status(403).json({ error: 'Admin belum diassign ke workspace' });

    AiPipelineScheduler.start(5000, user.workspaceId);
    res.json({ success: true, message: 'AI monitoring pipeline started' });
  } catch (err) {
    console.error('[SERVER ERROR] POST /monitoring/start failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/monitoring/stop', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });

    await AiPipelineScheduler.stop();
    res.json({ success: true, message: 'AI monitoring pipeline stopped' });
  } catch (err) {
    console.error('[SERVER ERROR] POST /monitoring/stop failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/monitoring/detections', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });

    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const workspaceId = user.workspaceId;
    
    // Get camera IDs in this workspace
    const CctvModel = (await import('../database/models/Cctv')).CctvModel;
    const camerasInWs = await CctvModel.find({ workspaceId }).select('id').lean().exec();
    const cameraIds = camerasInWs.map(c => c.id);
    
    if (cameraIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const detections = await AiDetectionModel.find({ 
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
  } catch (err) {
    console.error('[SERVER ERROR] GET /monitoring/detections failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/:id/snapshot', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).send('Unauthorized');
    const workspaceId = user.workspaceId || -1;
    const id = parseInt(req.params.id);
    const camera = await CctvRepository.getById(id, workspaceId);
    if (!camera) return res.status(404).send('Camera not found');

    if (camera.isDefault || camera.protocol === 'HTTP Image') {
      res.redirect(camera.streamUrl);
    } else {
      const fs = require('fs');
      const path = require('path');
      const capturePath = path.join(process.cwd(), 'public/uploads', `cctv_capture_${camera.id}.jpg`);
      if (fs.existsSync(capturePath)) {
        res.sendFile(capturePath);
      } else {
        res.status(404).send('Belum ada snapshot yang tersimpan untuk kamera ini.');
      }
    }
  } catch (err) {
    res.status(500).send('Internal Server Error');
  }
});

router.post('/tuya-sync', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    if (!user.workspaceId) return res.status(403).json({ error: 'Admin belum diassign ke workspace' });

    const clientId = req.body.clientId || process.env.TUYA_CLIENT_ID || 'vqy8kv443e5ef3vrxce8';
    const clientSecret = req.body.clientSecret || process.env.TUYA_CLIENT_SECRET || 'd6a294ee060747049fd683be64854c5c';

    const region = req.body.region || 'https://openapi-sg.iotbing.com';

    const { TuyaClient } = require('../cctv/services/TuyaClient');
    const { CctvModel } = require('../database/models/Cctv');
    const client = new TuyaClient(clientId, clientSecret, region);

    await client.getAccessToken();
    const devices = await client.listDevices();
    let cameras = devices.filter((d: any) => {
      const category = (d.category || '').toLowerCase();
      const name = (d.name || '').toLowerCase();
      const productName = (d.product_name || '').toLowerCase();
      
      return (
        category === 'sp' ||
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
        productName.includes('solar')
      );
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
      } catch (streamErr: any) {
        try {
          streamUrl = await client.getStreamUrl(cam.id, 'rtsp');
        } catch (rtspErr: any) {
          console.warn(`[TUYA SYNC WARNING] Could not allocate direct URL for ${cam.name}: ${rtspErr.message}`);
          streamUrl = `/api/cctv/hls-proxy/${cam.id}/stream.m3u8`;
        }
      }

      if (existing) {
        await CctvModel.updateOne(
          { _id: existing._id },
          { 
            $set: { 
              streamUrl, 
              playUrl: streamUrl, 
              status: cam.online ? 'ONLINE' : 'OFFLINE',
              isActive: true
            } 
          }
        );
        syncedDevices.push({ id: existing.id, name: cam.name, action: 'updated' });
      } else {
        // Determine protocol type from URL
        let detectedProtocol = 'HLS';
        if (streamUrl.startsWith('rtsps://') || streamUrl.startsWith('rtsp://')) {
          detectedProtocol = 'RTSP_TUYA';
        } else if (streamUrl.startsWith('http') && streamUrl.includes('m3u8')) {
          detectedProtocol = 'HLS';
        } else if (streamUrl.includes('localhost')) {
          detectedProtocol = 'RTSP_TUYA';
        }

        const newCctv = await CctvRepository.add({
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
  } catch (err: any) {
    console.error('[SERVER ERROR] POST /api/cctv/tuya-sync failed:', err);
    const detail = err.cause ? `${err.message} (Cause: ${err.cause.message || err.cause})` : err.message;
    res.status(500).json({ error: detail || 'Internal Server Error' });
  }
});

export default router;
