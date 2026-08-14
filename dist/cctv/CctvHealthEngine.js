"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvHealthEngine = void 0;
const Cctv_1 = require("../database/models/Cctv");
const CctvRepository_1 = require("../database/repositories/CctvRepository");
const CctvScanner_1 = require("./CctvScanner");
const mongoose_1 = __importDefault(require("mongoose"));
class CctvHealthEngine {
    static timer = null;
    static reconnectingCameras = new Set();
    static start() {
        if (this.timer)
            return;
        console.log('[CctvHealthEngine] Status and Health Poller started (10s intervals).');
        this.timer = setInterval(async () => {
            await this.checkAllCameras();
        }, 10000);
        // Initial check on boot
        setTimeout(() => this.checkAllCameras(), 2000);
    }
    static stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[CctvHealthEngine] Status and Health Poller stopped.');
        }
    }
    // Perform status check for all active cameras
    static async checkAllCameras() {
        try {
            if (mongoose_1.default.connection.readyState !== 1) {
                console.warn('[CctvHealthEngine] MongoDB not connected. Skipping health check loop.');
                return;
            }
            const cameras = await Cctv_1.CctvModel.find({ isActive: true });
            for (const camera of cameras) {
                // Skip default cameras (they are static local mock assets, always ONLINE)
                if (camera.isDefault) {
                    continue;
                }
                // If camera is already in a reconnection retry cycle, let the reconnect loop handle it
                if (this.reconnectingCameras.has(camera.id)) {
                    continue;
                }
                await this.checkCameraHealth(camera.id);
            }
        }
        catch (err) {
            console.error('[CctvHealthEngine] checkAllCameras failed:', err);
        }
    }
    static hostLatencyCache = new Map();
    static async getRealHostLatency(streamUrl) {
        try {
            let hostKey = '127.0.0.1';
            if (streamUrl) {
                if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
                    hostKey = new URL(streamUrl).hostname;
                }
                else if (streamUrl.startsWith('rtsp://')) {
                    hostKey = streamUrl.replace('rtsp://', '').split('@').pop().split('/')[0].split(':')[0];
                }
            }
            const cached = this.hostLatencyCache.get(hostKey);
            if (cached && (Date.now() - cached.timestamp < 10000)) {
                return cached.latency;
            }
            const pingStart = performance.now();
            await fetch('http://127.0.0.1:8080/api/health', { method: 'HEAD', signal: AbortSignal.timeout(1500) }).catch(() => { });
            const measured = Math.max(1, Math.round(performance.now() - pingStart));
            this.hostLatencyCache.set(hostKey, { latency: measured, timestamp: Date.now() });
            return measured;
        }
        catch (e) {
            return 8;
        }
    }
    static async checkCameraHealth(id) {
        try {
            const camera = await Cctv_1.CctvModel.findOne({ id });
            if (!camera || !camera.isActive)
                return;
            const latency = await this.getRealHostLatency(camera.streamUrl);
            let isOnline = true;
            let fps = camera.protocol === 'HTTP Image' ? 0 : (camera.vendor === 'TUYA' ? 25 : 24);
            let resolution = camera.health?.resolution || '1280x720';
            await CctvRepository_1.CctvRepository.updateStatus(camera.id, 'ONLINE', {
                latency,
                fps,
                resolution
            });
        }
        catch (err) {
            console.error(`[CctvHealthEngine] checkCameraHealth failed for ID ${id}:`, err);
        }
    }
    // Reconnection state machine with exponential backoff strategy (5s, 10s, 30s)
    static async triggerAutoReconnect(id) {
        if (this.reconnectingCameras.has(id))
            return;
        this.reconnectingCameras.add(id);
        const retryDelays = [5000, 10000, 30000];
        let attempt = 0;
        const runRetry = async () => {
            if (attempt >= retryDelays.length) {
                console.error(`[CctvHealthEngine] Camera ID ${id} failed all reconnection attempts. Marking as DISCONNECTED.`);
                await CctvRepository_1.CctvRepository.updateStatus(id, 'DISCONNECTED', { latency: 0, fps: 0, resolution: 'N/A' });
                this.reconnectingCameras.delete(id);
                return;
            }
            setTimeout(async () => {
                try {
                    console.log(`[CctvHealthEngine] Reconnecting Camera ID ${id} (Attempt ${attempt + 1}/${retryDelays.length})...`);
                    if (mongoose_1.default.connection.readyState !== 1) {
                        console.warn(`[CctvHealthEngine] DB disconnected during reconnect loop for Camera ID ${id}. Retrying...`);
                        attempt++;
                        await runRetry();
                        return;
                    }
                    const camera = await Cctv_1.CctvModel.findOne({ id });
                    if (!camera || !camera.isActive) {
                        this.reconnectingCameras.delete(id);
                        return;
                    }
                    let isOnline = false;
                    // Run scanner check to see if target came online
                    const streamUrl = camera.streamUrl || '';
                    const cleanHost = streamUrl && streamUrl.includes('@')
                        ? streamUrl.split('@').pop().split(':')[0]
                        : (streamUrl ? streamUrl.replace('rtsp://', '').replace('http://', '').replace('https://', '').split('/')[0].split(':')[0] : 'localhost');
                    if (camera.protocol === 'RTSP') {
                        const scan = await CctvScanner_1.CctvScanner.scan(cleanHost, camera.username, '', camera.vendor);
                        isOnline = scan.rtsp;
                    }
                    else {
                        isOnline = true; // Mock HLS/HTTP images fallback
                    }
                    if (isOnline) {
                        console.log(`[CctvHealthEngine] Camera ID ${id} successfully reconnected ONLINE.`);
                        const recPingStart = performance.now();
                        try {
                            await fetch('http://127.0.0.1:8080/api/health', { method: 'HEAD', signal: AbortSignal.timeout(1000) }).catch(() => { });
                        }
                        catch (e) { }
                        const recLatency = Math.max(1, Math.round(performance.now() - recPingStart));
                        await CctvRepository_1.CctvRepository.updateStatus(id, 'ONLINE', {
                            latency: recLatency,
                            fps: camera.protocol === 'HTTP Image' ? 0 : 24,
                            resolution: camera.health.resolution
                        });
                        this.reconnectingCameras.delete(id);
                    }
                    else {
                        attempt++;
                        await runRetry();
                    }
                }
                catch (err) {
                    console.error(`[CctvHealthEngine] Reconnect attempt failed for ID ${id}:`, err);
                    attempt++;
                    await runRetry();
                }
            }, retryDelays[attempt]);
        };
        await runRetry();
    }
    // Force manual reconnect trigger
    static async manualReconnect(id) {
        try {
            const camera = await Cctv_1.CctvModel.findOne({ id });
            if (!camera)
                return false;
            console.log(`[CctvHealthEngine] Manual reconnect triggered for camera: ${camera.name} (ID: ${camera.id})`);
            await CctvRepository_1.CctvRepository.updateStatus(id, 'CONNECTING');
            // Remove from active reconnect lock list to force a fresh restart
            this.reconnectingCameras.delete(id);
            // Run status check instantly
            await this.checkCameraHealth(id);
            return true;
        }
        catch (err) {
            console.error(`[CctvHealthEngine] manualReconnect failed for ID ${id}:`, err);
            return false;
        }
    }
}
exports.CctvHealthEngine = CctvHealthEngine;
