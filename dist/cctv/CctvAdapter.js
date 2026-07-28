"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvAdapter = void 0;
const db_1 = require("../database/db");
class CctvAdapter {
    // Translate camera details to frontend play/stream targets
    static getPlayTarget(cctv) {
        // Default cameras (ID 1-8) use static local files
        if (cctv.isDefault) {
            return {
                playUrl: cctv.playUrl || cctv.streamUrl,
                playType: 'Image' // Default cameras map to static jpg image updates
            };
        }
        // Tuya cloud RTSP stream — direct rtsps:// URL, browser cannot play natively
        // Return as RTSP_TUYA so frontend can show Tuya-specific viewer UI
        if (cctv.protocol === 'RTSP_TUYA' || (cctv.vendor === 'TUYA' && (cctv.streamUrl || '').startsWith('rtsps'))) {
            return {
                playUrl: cctv.streamUrl || cctv.playUrl,
                playType: 'RTSP_TUYA'
            };
        }
        if (cctv.protocol === 'HLS' && (cctv.streamUrl || '').includes('m3u8')) {
            return {
                playUrl: cctv.streamUrl || cctv.playUrl,
                playType: 'HLS'
            };
        }
        if (cctv.protocol === 'RTSP' || cctv.protocol === 'RTMP') {
            // Map to local MediaMTX streaming gateway path
            const streamName = `${cctv.vendor.toLowerCase()}_camera_${cctv.id}`;
            return {
                playUrl: `http://localhost:8554/${streamName}/index.m3u8`,
                playType: 'Video'
            };
        }
        if (cctv.protocol === 'CLOUD_VIEWER') {
            return {
                playUrl: cctv.streamUrl || 'https://cloud-viewer.eyeco.id',
                playType: 'Cloud'
            };
        }
        if (cctv.protocol === 'TUYA') {
            return {
                playUrl: cctv.playUrl || cctv.streamUrl || `tuya://device/${cctv.id}`,
                playType: 'Cloud'
            };
        }
        // Default return HLS, MP4, MJPEG, or HTTP Image URLs
        return {
            playUrl: cctv.streamUrl,
            playType: cctv.mediaType
        };
    }
    // Parse and decrypt credentials for backend processing
    static getCredentials(cctv) {
        const decryptedPassword = cctv.password ? db_1.DatabaseManager.decryptCctvPassword(cctv.password) : '';
        return {
            username: cctv.username,
            password: decryptedPassword
        };
    }
}
exports.CctvAdapter = CctvAdapter;
