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
        const endpoints = Array.from(new Set([this.baseUrl, 'https://openapi.tuyasg.com', 'https://openapi-sg.iotbing.com']));
        let lastErr = '';
        for (const ep of endpoints) {
            try {
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
                console.log(`[TUYA] Requesting access token from ${ep}${pathAndQuery}`);
                const res = await fetch(`${ep}${pathAndQuery}`, { method, headers });
                const data = await res.json();
                if (data.success && data.result?.access_token) {
                    this.baseUrl = ep; // Lock into working endpoint
                    this.accessToken = data.result.access_token;
                    console.log(`[TUYA] Successfully authenticated via ${ep}. Token: ${this.accessToken.substring(0, 8)}...`);
                    return this.accessToken;
                }
                lastErr = data.msg || JSON.stringify(data);
            }
            catch (e) {
                lastErr = e.message;
            }
        }
        throw new Error(`Tuya token error: ${lastErr}`);
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
        const options = { method, headers };
        if (body)
            options.body = bodyStr;
        const res = await fetch(url, options);
        const data = await res.json();
        // Handle token expired (error code 1010)
        if (!data.success && data.code === 1010) {
            console.log('[TUYA] Token expired. Refreshing token...');
            await this.getAccessToken();
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
            if (!data.success && (data.code === 28841002 || (data.msg && data.msg.includes('expired')))) {
                throw new Error('IoT Core service subscription has expired (code 28841002)');
            }
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
            if (err.message.includes('expired'))
                throw err;
            console.warn('[TUYA] associated-users devices query failed:', err.message);
        }
        // 2. Legacy query fallback if still empty
        if (devices.length === 0) {
            try {
                const data = await this.request('GET', '/v1.0/devices?page_no=1&page_size=100');
                if (!data.success && (data.code === 28841002 || (data.msg && data.msg.includes('expired')))) {
                    throw new Error('IoT Core service subscription has expired (code 28841002)');
                }
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
                if (err.message.includes('expired'))
                    throw err;
                console.warn('[TUYA] Legacy list devices failed:', err.message);
            }
        }
        return devices;
    }
    async getDeviceStatus(deviceId) {
        try {
            const data = await this.request('GET', `/v1.0/devices/${deviceId}`);
            if (data.success && data.result) {
                return { online: !!data.result.online, name: data.result.name, raw: data.result };
            }
        }
        catch (err) {
            console.warn(`[TUYA] getDeviceStatus for ${deviceId} failed: ${err.message}`);
        }
        return { online: false };
    }
    static streamCache = new Map();
    static pendingAlloc = new Map();
    static clearStreamCache(deviceId) {
        console.log(`[TUYA CACHE] Invalidating cached stream for device ${deviceId}`);
        TuyaClient.streamCache.delete(`hls:${deviceId}`);
        TuyaClient.streamCache.delete(`rtsp:${deviceId}`);
    }
    async getStreamUrl(deviceId, protocol = 'HLS', forceFresh = false) {
        const cacheKey = `${protocol.toLowerCase()}:${deviceId}`;
        const cached = TuyaClient.streamCache.get(cacheKey);
        if (!forceFresh && cached && Date.now() < cached.expiresAt) {
            console.log(`[TUYA CACHE] Returning active cached stream URL for ${deviceId}`);
            return cached.url;
        }
        // Deduplicate concurrent allocation requests for the same device+protocol
        const pendingKey = cacheKey;
        if (TuyaClient.pendingAlloc.has(pendingKey)) {
            console.log(`[TUYA CACHE] Waiting for pending allocation for ${deviceId}...`);
            return TuyaClient.pendingAlloc.get(pendingKey);
        }
        const allocPromise = this._doAllocate(deviceId, protocol, forceFresh, cached);
        TuyaClient.pendingAlloc.set(pendingKey, allocPromise);
        try {
            const url = await allocPromise;
            return url;
        }
        finally {
            TuyaClient.pendingAlloc.delete(pendingKey);
        }
    }
    async _doAllocate(deviceId, protocol, forceFresh, cached) {
        const cacheKey = `${protocol.toLowerCase()}:${deviceId}`;
        console.log(`[TUYA] Allocating fresh ${protocol} stream for device ${deviceId}...`);
        // Only try the endpoints matching the requested protocol
        const types = protocol === 'HLS' ? ['hls', 'HLS'] : ['rtsp', 'RTSP'];
        const endpoints = types.map(type => ({
            method: 'POST',
            path: `/v1.0/devices/${deviceId}/stream/actions/allocate`,
            body: { type }
        }));
        let lastError = '';
        for (const ep of endpoints) {
            try {
                const data = await this.request(ep.method, ep.path, ep.body);
                console.log(`[TUYA STREAM LOG] ${ep.method} ${ep.path} -> success: ${data.success}, code: ${data.code}`);
                if (data.success && data.result?.url) {
                    const url = data.result.url;
                    console.log(`[TUYA SUCCESS] Real stream allocated for ${deviceId}: ${url.slice(0, 60)}...`);
                    // Validate that the returned URL matches the requested protocol
                    const isHlsUrl = url.startsWith('http://') || url.startsWith('https://');
                    const isRtspUrl = url.startsWith('rtsp://') || url.startsWith('rtsps://');
                    if ((protocol === 'HLS' && isHlsUrl) || (protocol === 'RTSP' && isRtspUrl)) {
                        // Cache stream URL for 5 minutes (300s) to prevent rate limits while keeping session fresh
                        TuyaClient.streamCache.set(cacheKey, { url, expiresAt: Date.now() + 300000 });
                        return url;
                    }
                    console.warn(`[TUYA] Allocation returned wrong protocol URL (expected ${protocol}): ${url.slice(0, 40)}`);
                }
                // On any Tuya error (100003 rate limit, 外部服务异常, etc.) — use stale cached URL if NOT forceFresh
                if (!forceFresh && !data.success && cached?.url) {
                    console.warn(`[TUYA CACHE FALLBACK] Allocation failed (${data.msg || data.code}), reusing stale stream URL`);
                    TuyaClient.streamCache.set(cacheKey, { url: cached.url, expiresAt: Date.now() + 15000 });
                    return cached.url;
                }
                lastError = data.msg || JSON.stringify(data);
            }
            catch (err) {
                console.warn(`[TUYA WARN] Endpoint ${ep.path} failed: ${err.message}`);
                lastError = err.message;
            }
        }
        // Last resort: return stale cached URL rather than throwing (only if not forceFresh)
        if (!forceFresh && cached?.url) {
            console.warn(`[TUYA CACHE FALLBACK] All allocation attempts failed for ${deviceId}, falling back to stale cache`);
            TuyaClient.streamCache.set(cacheKey, { url: cached.url, expiresAt: Date.now() + 15000 });
            return cached.url;
        }
        const status = await this.getDeviceStatus(deviceId);
        console.warn(`[TUYA WARN] Stream allocation failed for ${deviceId}. Tuya Cloud reports device is: ${status.online ? 'ONLINE (P2P stream busy or rate limited)' : 'OFFLINE (device disconnected or sleeping)'}`);
        throw new Error(`Tuya Cloud Stream Allocation Error (${deviceId}): ${lastError} [Device is ${status.online ? 'ONLINE' : 'OFFLINE'}]`);
    }
}
exports.TuyaClient = TuyaClient;
