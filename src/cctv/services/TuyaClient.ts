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
      } else {
        console.warn('[TUYA] associated-users devices returned unsuccess:', JSON.stringify(data));
      }
    } catch (err: any) {
      if (err.message.includes('expired')) throw err;
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
      } catch (err: any) {
        if (err.message.includes('expired')) throw err;
        console.warn('[TUYA] Legacy list devices failed:', err.message);
      }
    }

    return devices;
  }

  public async getDeviceStatus(deviceId: string): Promise<{ online: boolean; name?: string; raw?: any }> {
    try {
      const data = await this.request('GET', `/v1.0/devices/${deviceId}`);
      if (data.success && data.result) {
        return { online: !!data.result.online, name: data.result.name, raw: data.result };
      }
    } catch (err: any) {
      console.warn(`[TUYA] getDeviceStatus for ${deviceId} failed: ${err.message}`);
    }
    return { online: false };
  }

  private static streamCache = new Map<string, { url: string; expiresAt: number }>();
  private static pendingAlloc = new Map<string, Promise<string>>();

  public static clearStreamCache(deviceId: string): void {
    console.log(`[TUYA CACHE] Invalidating cached stream for device ${deviceId}`);
    TuyaClient.streamCache.delete(`hls:${deviceId}`);
    TuyaClient.streamCache.delete(`rtsp:${deviceId}`);
  }
  public async getStreamUrl(deviceId: string, protocol: 'HLS' | 'RTSP' = 'HLS', forceFresh = false): Promise<string> {
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
      return TuyaClient.pendingAlloc.get(pendingKey)!;
    }

    const allocPromise = this._doAllocate(deviceId, protocol, cached);
    TuyaClient.pendingAlloc.set(pendingKey, allocPromise);

    try {
      const url = await allocPromise;
      return url;
    } finally {
      TuyaClient.pendingAlloc.delete(pendingKey);
    }
  }

  private async _doAllocate(deviceId: string, protocol: 'HLS' | 'RTSP', cached?: { url: string; expiresAt: number }): Promise<string> {
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
          const url: string = data.result.url;
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

        // On any Tuya error (100003 rate limit, 外部服务异常, etc.) — use stale cached URL if available
        if (!data.success && cached?.url) {
          console.warn(`[TUYA CACHE FALLBACK] Allocation failed (${data.msg || data.code}), reusing stale stream URL`);
          TuyaClient.streamCache.set(cacheKey, { url: cached.url, expiresAt: Date.now() + 15000 });
          return cached.url;
        }

        lastError = data.msg || JSON.stringify(data);
      } catch (err: any) {
        console.warn(`[TUYA WARN] Endpoint ${ep.path} failed: ${err.message}`);
        lastError = err.message;
      }
    }

    // Last resort: return stale cached URL rather than throwing
    if (cached?.url) {
      console.warn(`[TUYA CACHE FALLBACK] All allocation attempts failed for ${deviceId}, falling back to stale cache`);
      TuyaClient.streamCache.set(cacheKey, { url: cached.url, expiresAt: Date.now() + 15000 });
      return cached.url;
    }

    const status = await this.getDeviceStatus(deviceId);
    console.warn(`[TUYA WARN] Stream allocation failed for ${deviceId}. Tuya Cloud reports device is: ${status.online ? 'ONLINE (P2P stream busy or rate limited)' : 'OFFLINE (device disconnected or sleeping)'}`);

    throw new Error(`Tuya Cloud Stream Allocation Error (${deviceId}): ${lastError} [Device is ${status.online ? 'ONLINE' : 'OFFLINE'}]`);
  }
}


