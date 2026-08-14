// api.js - Wrapper Fetch dasar untuk EYECO dengan Penanganan Offline & Error
import { EventBus } from '../core/eventBus.js';

class ApiService {
  constructor() {
    this.isOffline = !navigator.onLine;

    window.addEventListener('online', () => this.setOnlineStatus(true));
    window.addEventListener('offline', () => this.setOnlineStatus(false));
  }

  setOnlineStatus(isOnline) {
    this.isOffline = !isOnline;
    EventBus.emit('networkStatusChanged', isOnline);
    if (!isOnline) {
      EventBus.emit('toast:show', { message: 'Koneksi terputus! Anda sedang offline.', type: 'danger' });
    } else {
      EventBus.emit('toast:show', { message: 'Koneksi terhubung kembali.', type: 'success' });
    }
  }

  // Request generic fetch wrapper
  async request(url, options = {}) {
    if (!navigator.onLine) {
      this.isOffline = true;
      throw new Error('OFFLINE');
    }
    this.isOffline = false;

    try {
      // credentials: 'include' memastikan cookie session_token selalu dikirim
      const response = await fetch(url, { credentials: 'include', ...options });
      console.log(`[API] ${options.method || 'GET'} ${url} → ${response.status} ${response.statusText}`);

      // Tangani status otentikasi (401)
      if (response.status === 401 && !url.includes('/api/auth/me')) {
        EventBus.emit('auth:unauthorized');
        throw new Error('UNAUTHORIZED');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Check if CSV or JSON
      const contentType = response.headers.get('content-type');

      // Guard: Jika API mengembalikan HTML (misalnya sesi redirect ke /login yang diikuti fetch),
      // treat sebagai unauthorized agar tidak crash di JSON.parse()
      if (contentType && contentType.includes('text/html') && url.startsWith('/api/')) {
        console.warn('[API] Got HTML response for API URL — likely session redirect:', url);
        EventBus.emit('auth:unauthorized');
        throw new Error('UNAUTHORIZED');
      }

      if (contentType && contentType.includes('text/csv')) {
        return response.blob();
      }

      return await response.json();
    } catch (err) {
      console.warn('[API] Request error:', url, err.message);
      if (!navigator.onLine) {
        this.setOnlineStatus(false);
      }
      throw err;
    }
  }

  get(url, options = {}) {
    console.log('[API] GET:', url);
    return this.request(url, { ...options, method: 'GET' });
  }

  post(url, body, options = {}) {
    const headers = options.headers || {};
    let formattedBody = body;

    // Otomatis deteksi jenis konten untuk menetapkan Header JSON
    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      formattedBody = JSON.stringify(body);
    }

    return this.request(url, {
      ...options,
      method: 'POST',
      headers,
      body: formattedBody
    });
  }

  put(url, body, options = {}) {
    const headers = options.headers || {};
    let formattedBody = body;

    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      formattedBody = JSON.stringify(body);
    }

    return this.request(url, {
      ...options,
      method: 'PUT',
      headers,
      body: formattedBody
    });
  }

  patch(url, body, options = {}) {
    const headers = options.headers || {};
    let formattedBody = body;

    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      formattedBody = JSON.stringify(body);
    }

    return this.request(url, {
      ...options,
      method: 'PATCH',
      headers,
      body: formattedBody
    });
  }

  delete(url, options = {}) {
    return this.request(url, { ...options, method: 'DELETE' });
  }
}

export const API = new ApiService();
