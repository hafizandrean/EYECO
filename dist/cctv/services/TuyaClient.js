"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TuyaClient = void 0;
const crypto_1 = __importDefault(require("crypto"));
class TuyaClient {
    clientId;
    secret;
    baseUrl;
    accessToken = '';
    constructor(clientId, secret, regionUrl = 'https://openapi.tuyasg.com') {
        this.clientId = clientId;
        this.secret = secret;
        this.baseUrl = regionUrl;
    }
    encryptSHA256(str) {
        return crypto_1.default.createHash('sha256').update(str, 'utf8').digest('hex');
    }
    hmacSHA256(str, secret) {
        return crypto_1.default.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
    }
    getSign(method, pathAndQuery, bodyStr, t, nonce, useAccessToken = true) {
        const contentSha = this.encryptSHA256(bodyStr);
        const headers = ''; // standard is empty
        const stringToSign = `${method}\n${contentSha}\n${headers}\n${pathAndQuery}`;
        const str = useAccessToken && this.accessToken
            ? this.clientId + this.accessToken + t + nonce + stringToSign
            : this.clientId + t + nonce + stringToSign;
        return this.hmacSHA256(str, this.secret);
    }
    async getAccessToken() {
        const t = Date.now();
        const nonce = crypto_1.default.randomUUID();
        const pathAndQuery = '/v1.0/token?grant_type=1';
        const method = 'GET';
        const bodyStr = '';
        const sign = this.getSign(method, pathAndQuery, bodyStr, t, nonce, false);
        const headers = {
            'client_id': this.clientId,
            'sign': sign,
            't': String(t),
            'sign_method': 'HMAC-SHA256',
            'nonce': nonce
        };
        console.log(`[TUYA] Requesting access token from ${this.baseUrl}${pathAndQuery}`);
        const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
            method,
            headers
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(`Tuya token error: ${JSON.stringify(data)}`);
        }
        this.accessToken = data.result.access_token;
        console.log(`[TUYA] Successfully authenticated. Token: ${this.accessToken.substring(0, 8)}...`);
        return this.accessToken;
    }
    async request(method, pathAndQuery, body = null) {
        if (!this.accessToken) {
            await this.getAccessToken();
        }
        const t = Date.now();
        const nonce = crypto_1.default.randomUUID();
        const bodyStr = body ? JSON.stringify(body) : '';
        let sign = this.getSign(method, pathAndQuery, bodyStr, t, nonce, true);
        let headers = {
            'client_id': this.clientId,
            'access_token': this.accessToken,
            'sign': sign,
            't': String(t),
            'sign_method': 'HMAC-SHA256',
            'nonce': nonce,
            'Content-Type': 'application/json'
        };
        const url = `${this.baseUrl}${pathAndQuery}`;
        const options = {
            method,
            headers
        };
        if (body) {
            options.body = bodyStr;
        }
        const res = await fetch(url, options);
        const data = await res.json();
        // Handle token expired (error code 1010)
        if (!data.success && data.code === 1010) {
            console.log('[TUYA] Token expired. Refreshing token...');
            await this.getAccessToken();
            // Retry request
            sign = this.getSign(method, pathAndQuery, bodyStr, t, nonce, true);
            headers['access_token'] = this.accessToken;
            headers['sign'] = sign;
            const retryRes = await fetch(url, options);
            return await retryRes.json();
        }
        return data;
    }
    async listDevices() {
        console.log('[TUYA] Listing devices...');
        const devices = [];
        const seenIds = new Set();
        // 1. Try associated-users devices (Smart Home Basic Service API)
        try {
            const data = await this.request('GET', '/v1.0/iot-01/associated-users/devices?page_no=1&page_size=100');
            const list = data.result?.list || data.result?.devices || (Array.isArray(data.result) ? data.result : []);
            if (data.success && Array.isArray(list)) {
                console.log(`[TUYA] Found ${list.length} devices via associated-users API`);
                for (const item of list) {
                    if (!seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        devices.push(item);
                    }
                }
            }
            else {
                console.warn('[TUYA] associated-users devices returned unsuccess:', JSON.stringify(data));
            }
        }
        catch (err) {
            console.warn('[TUYA] associated-users devices query failed:', err.message);
        }
        // 3. Legacy query fallback if still empty
        if (devices.length === 0) {
            try {
                const data = await this.request('GET', '/v1.0/devices?page_no=1&page_size=100');
                const list = data.result?.list || data.result?.devices || (Array.isArray(data.result) ? data.result : []);
                if (data.success && Array.isArray(list)) {
                    for (const item of list) {
                        if (!seenIds.has(item.id)) {
                            seenIds.add(item.id);
                            devices.push(item);
                        }
                    }
                }
            }
            catch (err) {
                console.warn('[TUYA] Legacy list devices failed:', err.message);
            }
        }
        return devices;
    }
    async getStreamUrl(deviceId, protocol = 'RTSP') {
        console.log(`[TUYA] Allocating RTSP stream for real device ${deviceId}...`);
        const endpoints = [
            { method: 'POST', path: `/v1.0/devices/${deviceId}/stream/actions/allocate`, body: { type: 'RTSP' } },
            { method: 'POST', path: `/v1.0/devices/${deviceId}/stream/actions/allocate`, body: { type: 'rtsp' } },
            { method: 'POST', path: `/v1.0/devices/${deviceId}/stream/actions/allocate`, body: { type: 'hls' } },
            { method: 'POST', path: `/v1.0/devices/${deviceId}/stream/actions/allocate`, body: { type: 'HLS' } }
        ];
        let lastError = '';
        for (const ep of endpoints) {
            try {
                const data = await this.request(ep.method, ep.path, ep.body || null);
                console.log(`[TUYA STREAM LOG] ${ep.method} ${ep.path} -> success: ${data.success}, code: ${data.code}`);
                if (data.success && data.result?.url) {
                    console.log(`[TUYA SUCCESS] Real RTSP stream allocated for ${deviceId}: ${data.result.url.slice(0, 40)}...`);
                    return data.result.url;
                }
                lastError = data.msg || JSON.stringify(data);
            }
            catch (err) {
                console.warn(`[TUYA WARN] Endpoint ${ep.path} failed: ${err.message}`);
                lastError = err.message;
            }
        }
        throw new Error(`Tuya Cloud Stream Allocation Error (${deviceId}): ${lastError}`);
    }
}
exports.TuyaClient = TuyaClient;
