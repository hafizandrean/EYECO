import crypto from 'crypto';
import { TuyaClient } from './services/TuyaClient';

const TUYA_ENDPOINTS: Record<string, string> = {
  US: 'https://openapi.tuyaus.com',
  US_EAST: 'https://openapi-ueaz.tuyaus.com',
  CN: 'https://openapi.tuyacn.com',
  EU: 'https://openapi.tuyaeu.com',
  EU_WEST: 'https://openapi-weaz.tuyaeu.com',
  IN: 'https://openapi.tuyain.com',
  SG: 'https://openapi-sg.iotbing.com',
};

interface TuyaTokenResponse {
  success: boolean;
  result?: { access_token: string; expire_time: number; refresh_token: string };
  msg?: string;
  code?: number;
}

interface TuyaDevice {
  id: string;
  name: string;
  model: string;
  category: string;
  online: boolean;
  ip: string;
  product_name: string;
  active_time: number;
  create_time: number;
  update_time: number;
}

interface TuyaStreamResult {
  url: string;
  expirationTime: number;
}

export class TuyaCloudService {
  private static tokenCache = new Map<string, { token: string; expiresAt: number }>();

  private static sign(method: string, path: string, body: string, t: string, accessId: string, accessSecret: string): string {
    const contentHash = crypto.createHash('sha256').update(body).digest('hex').toLowerCase();
    const signStr = `${accessId}${t}\n${method}\n${contentHash}\n\n${path}`;
    return crypto.createHmac('sha256', accessSecret).update(signStr).digest('hex').toUpperCase();
  }

  private static async request(method: string, path: string, body: string, accessId: string, accessSecret: string, token?: string): Promise<any> {
    const t = String(Date.now());
    const sig = this.sign(method, path, body, t, accessId, accessSecret);

    const baseUrl = process.env.TUYA_API_ENDPOINT || TUYA_ENDPOINTS.US;
    const headers: Record<string, string> = {
      client_id: accessId,
      sign: sig,
      t,
      sign_method: 'HMAC-SHA256',
      nonce: '',
    };
    if (token) headers.access_token = token;

    const url = `${baseUrl}${path}`;
    const options: RequestInit = { method, headers };
    if (body) options.body = body;

    const res = await fetch(url, options);
    return res.json();
  }

  static async getToken(accessId: string, accessSecret: string, region = 'US'): Promise<string> {
    const cacheKey = `${accessId}:${accessSecret}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.token;

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

    const data: TuyaTokenResponse = await res.json();
    if (!data.success) throw new Error(`Tuya auth failed: ${data.msg} (code ${data.code})`);
    if (!data.result) throw new Error('Tuya auth returned empty result');

    const expiresAt = Date.now() + (data.result.expire_time * 1000) - 60000;
    this.tokenCache.set(cacheKey, { token: data.result.access_token, expiresAt });
    return data.result.access_token;
  }

  static async listDevices(accessId: string, accessSecret: string, region = 'US'): Promise<any[]> {
    const baseUrl = TUYA_ENDPOINTS[region] || TUYA_ENDPOINTS.US;
    const client = new TuyaClient(accessId, accessSecret, baseUrl);
    await client.getAccessToken();
    return await client.listDevices();
  }

  static async getDeviceInfo(accessId: string, accessSecret: string, deviceId: string, region = 'US'): Promise<TuyaDevice> {
    const token = await this.getToken(accessId, accessSecret, region);
    const data = await this.request('GET', `/v1.0/devices/${deviceId}`, '', accessId, accessSecret, token);
    if (!data.success) throw new Error(`Tuya getDevice failed: ${data.msg}`);
    return data.result;
  }

  static async getStreamUrl(accessId: string, accessSecret: string, deviceId: string, region = 'US'): Promise<TuyaStreamResult> {
    const token = await this.getToken(accessId, accessSecret, region);
    const path = `/v1.0/devices/${deviceId}/stream/actions/allocate`;
    const body = JSON.stringify({ type: 'flv' });
    const data = await this.request('POST', path, body, accessId, accessSecret, token);
    if (!data.success) throw new Error(`Tuya getStreamUrl failed: ${data.msg}`);
    return data.result;
  }

  static async getSnapshot(accessId: string, accessSecret: string, deviceId: string, region = 'US'): Promise<string> {
    const token = await this.getToken(accessId, accessSecret, region);
    const data = await this.request('GET', `/v1.0/devices/${deviceId}/snapshot`, '', accessId, accessSecret, token);
    if (!data.success) throw new Error(`Tuya getSnapshot failed: ${data.msg}`);
    return data.result?.url || '';
  }

  static async validateCredentials(accessId: string, accessSecret: string, region = 'US'): Promise<{ ok: boolean; msg: string; devices?: any[] }> {
    try {
      const devices = await this.listDevices(accessId, accessSecret, region);
      return { ok: true, msg: `Found ${devices.length} device(s)`, devices };
    } catch (err: any) {
      return { ok: false, msg: err.message };
    }
  }
}
