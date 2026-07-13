// cctvService.js - Service untuk berkomunikasi dengan API manajemen CCTV
import { API } from './api.js';

export const CctvService = {
  // Ambil daftar semua saluran CCTV (seeded + kustom) beserta statusnya
  async getCctvList() {
    try {
      const response = await API.get('/api/cctv');
      if (response && response.success) {
        return response.data;
      }
      return [];
    } catch (err) {
      console.error('[CctvService] getCctvList failed:', err);
      throw err;
    }
  },

  // Ambil detail konfigurasi satu CCTV
  async getCctvDetails(id) {
    try {
      const response = await API.get(`/api/cctv/${id}`);
      if (response && response.success) {
        return response.data;
      }
      throw new Error(response?.error || 'Gagal memuat detail CCTV');
    } catch (err) {
      console.error(`[CctvService] getCctvDetails failed for ID ${id}:`, err);
      throw err;
    }
  },

  // Lakukan pemindaian (discovery scan) kemampuan IP/Host CCTV
  async scanCamera(payload) {
    try {
      const response = await API.post('/api/cctv/scan', payload);
      if (response && response.success) {
        return response.data;
      }
      throw new Error(response?.error || 'Gagal memindai kamera');
    } catch (err) {
      console.error('[CctvService] scanCamera failed:', err);
      throw err;
    }
  },

  // Tambahkan koneksi CCTV baru ke sistem
  async connectCctv(payload) {
    try {
      const response = await API.post('/api/cctv', payload);
      if (response && response.success) {
        return response.data;
      }
      throw new Error(response?.error || 'Gagal menambahkan koneksi CCTV');
    } catch (err) {
      console.error('[CctvService] connectCctv failed:', err);
      throw err;
    }
  },

  // Ubah konfigurasi CCTV yang ada
  async updateCctv(id, payload) {
    try {
      const response = await API.put(`/api/cctv/${id}`, payload);
      if (response && response.success) {
        return response.data;
      }
      throw new Error(response?.error || 'Gagal mengubah konfigurasi CCTV');
    } catch (err) {
      console.error(`[CctvService] updateCctv failed for ID ${id}:`, err);
      throw err;
    }
  },

  // Putuskan / hapus koneksi CCTV kustom
  async disconnectCctv(id) {
    try {
      const response = await API.delete(`/api/cctv/${id}`);
      if (response && response.success) {
        return true;
      }
      throw new Error(response?.error || 'Gagal menghapus koneksi CCTV');
    } catch (err) {
      console.error(`[CctvService] disconnectCctv failed for ID ${id}:`, err);
      throw err;
    }
  },

  // Pemicu koneksi ulang manual
  async reconnectCctv(id) {
    try {
      const response = await API.post(`/api/cctv/${id}/reconnect`);
      if (response && response.success) {
        return true;
      }
      throw new Error(response?.error || 'Gagal memicu koneksi ulang');
    } catch (err) {
      console.error(`[CctvService] reconnectCctv failed for ID ${id}:`, err);
      throw err;
    }
  },

  // Ubah status pemantauan global
  async toggleGlobalMonitoring(enabled) {
    try {
      const response = await API.post('/api/cctv/monitoring', { enabled });
      if (response && response.success) {
        return response.monitoringEnabled;
      }
      throw new Error(response?.error || 'Gagal mengubah status pemantauan global');
    } catch (err) {
      console.error('[CctvService] toggleGlobalMonitoring failed:', err);
      throw err;
    }
  },

  // Ubah status pemantauan per-kamera tertentu
  async toggleCameraMonitoring(id, enabled) {
    try {
      const response = await API.patch(`/api/cctv/${id}/monitoring`, { enabled });
      if (response && response.success) {
        return response.monitoringEnabled;
      }
      throw new Error(response?.error || 'Gagal mengubah status pemantauan kamera');
    } catch (err) {
      console.error(`[CctvService] toggleCameraMonitoring failed for ID ${id}:`, err);
      throw err;
    }
  },

  // Ubah status aktif/nonaktif per-kamera tertentu
  async toggleCameraActive(id, isActive) {
    try {
      const response = await API.patch(`/api/cctv/${id}/active`, { isActive });
      if (response && response.success) {
        return response.data.isActive;
      }
      throw new Error(response?.error || 'Gagal mengubah status aktif kamera');
    } catch (err) {
      console.error(`[CctvService] toggleCameraActive failed for ID ${id}:`, err);
      throw err;
    }
  }
};
