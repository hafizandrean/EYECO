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
    if (this.isOffline) {
      throw new Error('OFFLINE');
    }

    try {
      const response = await fetch(url, options);

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
      if (contentType && contentType.includes('text/csv')) {
        return response.blob();
      }

      return await response.json();
    } catch (err) {
      if (err.message === 'OFFLINE' || err.message.includes('Failed to fetch')) {
        this.setOnlineStatus(false);
        throw new Error('Koneksi jaringan gagal. Silakan coba lagi.');
      }
      throw err;
    }
  }

  get(url, options = {}) {
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
}

export const API = new ApiService();
