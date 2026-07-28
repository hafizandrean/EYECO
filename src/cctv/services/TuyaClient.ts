import crypto from 'crypto';

export class TuyaClient {
  private clientId: string;
  private secret: string;
  private baseUrl: string;
  private accessToken: string = '';

  constructor(clientId: string, secret: string, regionUrl: string = 'https://openapi.tuyasg.com') {
    this.clientId = clientId;
    this.secret = secret;
    this.baseUrl = regionUrl;
  }

  private encryptSHA256(str: string): string {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
  }

  private hmacSHA256(str: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
  }

  private getSign(
    method: string,
    pathAndQuery: string,
    bodyStr: string,
    t: number,
    nonce: string,
    useAccessToken: boolean = true
  ): string {
    const contentSha = this.encryptSHA256(bodyStr);
    const headers = ''; // standard is empty
    const stringToSign = `${method}\n${contentSha}\n${headers}\n${pathAndQuery}`;
    
    const str = useAccessToken && this.accessToken
      ? this.clientId + this.accessToken + t + nonce + stringToSign
      : this.clientId + t + nonce + stringToSign;

    return this.hmacSHA256(str, this.secret);
  }

  public async getAccessToken(): Promise<string> {
    const t = Date.now();
    const nonce = crypto.randomUUID();
    const pathAndQuery = '/v1.0/token?grant_type=1';
    const method = 'GET';
    const bodyStr = '';

    const sign = this.getSign(method, pathAndQuery, bodyStr, t, nonce, false);

    const headers: Record<string, string> = {
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

    const data = await res.json() as any;
    if (!data.success) {
      throw new Error(`Tuya token error: ${JSON.stringify(data)}`);
    }

    this.accessToken = data.result.access_token;
    console.log(`[TUYA] Successfully authenticated. Token: ${this.accessToken.substring(0, 8)}...`);
    return this.accessToken;
  }

  public async request(method: string, pathAndQuery: string, body: any = null): Promise<any> {
    if (!this.accessToken) {
      await this.getAccessToken();
    }

    const t = Date.now();
    const nonce = crypto.randomUUID();
    const bodyStr = body ? JSON.stringify(body) : '';

    let sign = this.getSign(method, pathAndQuery, bodyStr, t, nonce, true);

    let headers: Record<string, string> = {
      'client_id': this.clientId,
      'access_token': this.accessToken,
      'sign': sign,
      't': String(t),
      'sign_method': 'HMAC-SHA256',
      'nonce': nonce,
      'Content-Type': 'application/json'
    };

    const url = `${this.baseUrl}${pathAndQuery}`;
    const options: RequestInit = {
      method,
      headers
    };

    if (body) {
      options.body = bodyStr;
    }

    const res = await fetch(url, options);
    const data = await res.json() as any;

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

  public async listDevices(): Promise<any[]> {
    console.log('[TUYA] Listing devices...');
    const devices: any[] = [];
    const seenIds = new Set<string>();

    // 1. Try associated-users devices (Smart Home Basic Service API)
    try {
      const data = await this.request('GET', '/v1.0/iot-01/associated-users/devices?page_no=1&page_size=100');
      if (data.success && data.result?.list) {
        console.log(`[TUYA] Found ${data.result.list.length} devices via associated-users API`);
        for (const item of data.result.list) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            devices.push(item);
          }
        }
      } else {
        console.warn('[TUYA] associated-users devices returned unsuccess:', JSON.stringify(data));
      }
    } catch (err: any) {
      console.warn('[TUYA] associated-users devices query failed:', err.message);
    }

    // 3. Legacy query fallback if still empty
    if (devices.length === 0) {
      try {
        const data = await this.request('GET', '/v1.0/devices?page_no=1&page_size=100');
        if (data.success && data.result?.list) {
          for (const item of data.result.list) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              devices.push(item);
            }
          }
        }
      } catch (err: any) {
        console.warn('[TUYA] Legacy list devices failed:', err.message);
      }
    }

    return devices;
  }

  public async getStreamUrl(deviceId: string, protocol: 'RTSP' | 'HLS' = 'RTSP'): Promise<string> {
    console.log(`[TUYA] Allocating RTSP stream for real device ${deviceId}...`);

    const endpoints: Array<{ method: string; path: string; body?: any }> = [
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
      } catch (err: any) {
        console.warn(`[TUYA WARN] Endpoint ${ep.path} failed: ${err.message}`);
        lastError = err.message;
      }
    }

    throw new Error(`Tuya Cloud Stream Allocation Error (${deviceId}): ${lastError}`);
  }
}

