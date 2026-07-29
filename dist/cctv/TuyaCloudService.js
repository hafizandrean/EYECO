"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TuyaCloudService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const TuyaClient_1 = require("./services/TuyaClient");
const TUYA_ENDPOINTS = {
    US: 'https://openapi.tuyaus.com',
    US_EAST: 'https://openapi-ueaz.tuyaus.com',
    SG: 'https://openapi.tuyaus.com',
    CN: 'https://openapi.tuyacn.com',
    EU: 'https://openapi.tuyaeu.com',
    EU_WEST: 'https://openapi-weaz.tuyaeu.com',
    IN: 'https://openapi.tuyain.com',
    SG: 'https://openapi-sg.iotbing.com',
};
class TuyaCloudService {
    static tokenCache = new Map();
    static sign(method, path, body, t, accessId, accessSecret, token = '') {
        const contentHash = crypto_1.default.createHash('sha256').update(body).digest('hex').toLowerCase();
        const stringToSign = `${method}\n${contentHash}\n\n${path}`;
        const signStr = `${accessId}${token}${t}${stringToSign}`;
        return crypto_1.default.createHmac('sha256', accessSecret).update(signStr).digest('hex').toUpperCase();
    }
    static async request(method, path, body, accessId, accessSecret, token) {
        const t = String(Date.now());
        const sig = this.sign(method, path, body, t, accessId, accessSecret, token || '');
        const baseUrl = process.env.TUYA_API_ENDPOINT || TUYA_ENDPOINTS.US;
        const headers = {
            client_id: accessId,
            sign: sig,
            t,
            sign_method: 'HMAC-SHA256',
            nonce: '',
        };
        if (token)
            headers.access_token = token;
        const url = `${baseUrl}${path}`;
        const options = { method, headers };
        if (body)
            options.body = body;
        const res = await fetch(url, options);
        return res.json();
    }
    static async getToken(accessId, accessSecret, region = 'US') {
        const cacheKey = `${accessId}:${accessSecret}`;
        const cached = this.tokenCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt)
            return cached.token;
        const baseUrl = process.env.TUYA_API_ENDPOINT || TUYA_ENDPOINTS[region] || TUYA_ENDPOINTS.US;
        const path = '/v1.0/token?grant_type=1';
        const t = String(Date.now());
        const sig = this.sign('GET', path, '', t, accessId, accessSecret);
        const res = await fetch(`${baseUrl}${path}`, {
            method: 'GET',
            headers: {
                client_id: accessId,
                sign: sig,
                t,
                sign_method: 'HMAC-SHA256',
                nonce: '',
            },
        });
        const data = await res.json();
        if (!data.success)
            throw new Error(`Tuya auth failed: ${data.msg} (code ${data.code})`);
        if (!data.result)
            throw new Error('Tuya auth returned empty result');
        const expiresAt = Date.now() + (data.result.expire_time * 1000) - 60000;
        this.tokenCache.set(cacheKey, { token: data.result.access_token, expiresAt });
        return data.result.access_token;
    }
    static async listDevices(accessId, accessSecret, region = 'US') {
        const baseUrl = TUYA_ENDPOINTS[region] || TUYA_ENDPOINTS.US;
        const client = new TuyaClient_1.TuyaClient(accessId, accessSecret, baseUrl);
        await client.getAccessToken();
        return await client.listDevices();
    }
    static async getDeviceInfo(accessId, accessSecret, deviceId, region = 'US') {
        const token = await this.getToken(accessId, accessSecret, region);
        const data = await this.request('GET', `/v1.0/devices/${deviceId}`, '', accessId, accessSecret, token);
        if (!data.success)
            throw new Error(`Tuya getDevice failed: ${data.msg}`);
        return data.result;
    }
    static async getStreamUrl(accessId, accessSecret, deviceId, region = 'US') {
        const token = await this.getToken(accessId, accessSecret, region);
        const path = `/v1.0/devices/${deviceId}/stream/actions/allocate`;
        const body = JSON.stringify({ type: 'hls' });
        const data = await this.request('POST', path, body, accessId, accessSecret, token);
        if (!data.success)
            throw new Error(`Tuya getStreamUrl failed: ${data.msg}`);
        return data.result;
    }
    static async getSnapshot(accessId, accessSecret, deviceId, region = 'US') {
        const token = await this.getToken(accessId, accessSecret, region);
        const data = await this.request('GET', `/v1.0/devices/${deviceId}/snapshot`, '', accessId, accessSecret, token);
        if (!data.success)
            throw new Error(`Tuya getSnapshot failed: ${data.msg}`);
        return data.result?.url || '';
    }
    static async validateCredentials(accessId, accessSecret, region = 'US') {
        try {
            const devices = await this.listDevices(accessId, accessSecret, region);
            return { ok: true, msg: `Found ${devices.length} device(s)`, devices };
        }
        catch (err) {
            return { ok: false, msg: err.message };
        }
    }
}
exports.TuyaCloudService = TuyaCloudService;
