"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvScanner = void 0;
const dns_1 = __importDefault(require("dns"));
const net_1 = __importDefault(require("net"));
class CctvScanner {
    // Run step-by-step discovery scanner
    static async scan(ipOrHost, username, password, vendorHint, customPort, forcedMode) {
        const result = {
            ping: false,
            ports: { 80: false, 443: false, 554: false, 8000: false, 8080: false, 8554: false, 37777: false },
            onvif: false,
            rtsp: false,
            snapshot: false,
            mjpeg: false,
            cloud: false,
            details: {}
        };
        // Clean IP/Host string from prefix
        let cleanHost = ipOrHost;
        if (ipOrHost.startsWith('http://')) {
            cleanHost = ipOrHost.substring(7).split('/')[0].split(':')[0];
        }
        else if (ipOrHost.startsWith('https://')) {
            cleanHost = ipOrHost.substring(8).split('/')[0].split(':')[0];
        }
        else if (ipOrHost.startsWith('rtsp://')) {
            cleanHost = ipOrHost.substring(7).split('/')[0].split('@').pop().split(':')[0];
        }
        try {
            // 1. Resolve host / DNS check
            const ip = await new Promise((resolve, reject) => {
                dns_1.default.lookup(cleanHost, (err, address) => {
                    if (err)
                        reject(err);
                    else
                        resolve(address);
                });
            }).catch(() => cleanHost);
            // Simulate ping (checks if the host is responsive)
            result.ping = true; // Set to true since it resolved, simulating success.
            // 2. TCP Port Scan
            const portsToScan = [80, 443, 554, 8000, 8080, 8554, 37777];
            if (customPort && !portsToScan.includes(customPort)) {
                portsToScan.push(customPort);
            }
            for (const port of portsToScan) {
                result.ports[port] = await this.probePort(ip, port, 1000);
            }
            // 3. Probing HLS/HTTP stream if URL is provided
            if (ipOrHost.startsWith('http://') || ipOrHost.startsWith('https://')) {
                const isM3u8 = ipOrHost.includes('.m3u8');
                const isMp4 = ipOrHost.includes('.mp4');
                if (isM3u8) {
                    result.rtsp = false;
                    result.ports[80] = true;
                    result.details.protocol = 'HLS';
                    result.details.mediaType = 'Video';
                    result.details.streamUrl = ipOrHost;
                    result.details.playUrl = ipOrHost;
                    return result;
                }
                else if (isMp4) {
                    result.ports[80] = true;
                    result.details.protocol = 'MP4';
                    result.details.mediaType = 'Video';
                    result.details.streamUrl = ipOrHost;
                    result.details.playUrl = ipOrHost;
                    return result;
                }
            }
            // 4. ONVIF Detection simulation
            if (result.ports[80] || result.ports[8080] || result.ports[8000]) {
                if (cleanHost.includes('192.168') || vendorHint === 'HIKVISION' || vendorHint === 'DAHUA') {
                    result.onvif = true;
                    result.details.vendor = vendorHint || 'HIKVISION';
                    result.details.resolution = '1920x1080';
                }
            }
            // 5. RTSP Template Probing
            if (result.ports[554]) {
                result.rtsp = true;
                result.details.protocol = 'RTSP';
                result.details.mediaType = 'Video';
                let path = '/live';
                if (vendorHint === 'HIKVISION') {
                    path = '/Streaming/Channels/101';
                }
                else if (vendorHint === 'DAHUA') {
                    path = '/cam/realmonitor?channel=1&subtype=0';
                }
                else if (vendorHint === 'KRISBOW') {
                    path = '/live/ch0';
                }
                const credentialsPart = username && password ? `${username}:${password}@` : '';
                result.details.streamUrl = `rtsp://${credentialsPart}${cleanHost}:554${path}`;
                result.details.playUrl = `http://localhost:8554/${vendorHint?.toLowerCase() || 'camera'}_${cleanHost.replace(/\./g, '_')}/index.m3u8`;
                result.details.resolution = '1920x1080';
                result.details.vendor = vendorHint || 'GENERIC';
            }
            // 6. Snapshot capability check
            if (result.ports[80] || result.ports[8080]) {
                result.snapshot = true;
                if (!result.rtsp) {
                    result.details.protocol = 'HTTP Image';
                    result.details.mediaType = 'Image';
                    result.details.streamUrl = `http://${cleanHost}:${result.ports[80] ? 80 : 8080}/onvif-http/snapshot.jpg`;
                    result.details.resolution = '1280x720';
                    result.details.vendor = vendorHint || 'GENERIC';
                }
            }
            // 7. Cloud Fallback check
            if (!result.rtsp && !result.onvif && (vendorHint === 'KRISBOW' || vendorHint === 'EZVIZ')) {
                result.cloud = true;
                result.details.protocol = 'CLOUD_VIEWER';
                result.details.mediaType = 'Cloud';
                result.details.streamUrl = '/cloud-viewer';
                result.details.playUrl = cleanHost;
                result.details.vendor = vendorHint;
                result.details.resolution = '2560x1440 (Ultra HD)';
            }
            if (!result.rtsp && !result.snapshot && !result.cloud) {
                result.cloud = true;
                result.details.protocol = 'CLOUD_VIEWER';
                result.details.mediaType = 'Cloud';
                result.details.streamUrl = '/cloud-viewer';
                result.details.playUrl = cleanHost;
                result.details.vendor = vendorHint || 'GENERIC';
                result.details.resolution = 'N/A';
            }
            // 8. Connection Mode Force/Override
            if (forcedMode && forcedMode !== 'AUTO') {
                result.details.protocol = forcedMode === 'SNAPSHOT' ? 'HTTP Image' : forcedMode;
                if (forcedMode === 'RTSP') {
                    result.rtsp = true;
                    result.details.mediaType = 'Video';
                    const credentialsPart = username && password ? `${username}:${password}@` : '';
                    const rtspPort = customPort || 554;
                    let path = '/live';
                    if (vendorHint === 'HIKVISION')
                        path = '/Streaming/Channels/101';
                    else if (vendorHint === 'DAHUA')
                        path = '/cam/realmonitor?channel=1&subtype=0';
                    else if (vendorHint === 'KRISBOW')
                        path = '/live/ch0';
                    result.details.streamUrl = `rtsp://${credentialsPart}${cleanHost}:${rtspPort}${path}`;
                    result.details.playUrl = `http://localhost:8554/${vendorHint?.toLowerCase() || 'camera'}_${cleanHost.replace(/\./g, '_')}/index.m3u8`;
                }
                else if (forcedMode === 'HLS') {
                    result.details.mediaType = 'Video';
                    result.details.streamUrl = ipOrHost.includes('://') ? ipOrHost : `http://${cleanHost}:${customPort || 80}/index.m3u8`;
                    result.details.playUrl = result.details.streamUrl;
                }
                else if (forcedMode === 'MJPEG') {
                    result.mjpeg = true;
                    result.details.mediaType = 'Video';
                    result.details.streamUrl = ipOrHost.includes('://') ? ipOrHost : `http://${cleanHost}:${customPort || 80}/mjpeg`;
                    result.details.playUrl = result.details.streamUrl;
                }
                else if (forcedMode === 'SNAPSHOT') {
                    result.snapshot = true;
                    result.details.mediaType = 'Image';
                    result.details.streamUrl = ipOrHost.includes('://') ? ipOrHost : `http://${cleanHost}:${customPort || 80}/snapshot.jpg`;
                    result.details.playUrl = `/api/cctv/proxy-snapshot?host=${cleanHost}&port=${customPort || 80}`;
                }
                else if (forcedMode === 'CLOUD_VIEWER') {
                    result.cloud = true;
                    result.details.mediaType = 'Cloud';
                    result.details.streamUrl = '/cloud-viewer';
                    result.details.playUrl = cleanHost;
                }
            }
        }
        catch (err) {
            console.error('[CctvScanner] Scan failed:', err);
            result.details.errorMessage = err.message || 'Scan error occurred';
        }
        return result;
    }
    static probePort(host, port, timeout) {
        return new Promise((resolve) => {
            const socket = new net_1.default.Socket();
            let status = false;
            socket.setTimeout(timeout);
            socket.on('connect', () => {
                status = true;
                socket.destroy();
            });
            socket.on('timeout', () => {
                socket.destroy();
            });
            socket.on('error', () => {
                socket.destroy();
            });
            socket.on('close', () => {
                resolve(status);
            });
            socket.connect(port, host);
        });
    }
}
exports.CctvScanner = CctvScanner;
