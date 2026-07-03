// statsService.js - Layanan Agregasi Statistik EYECO
import { API } from './api.js';

class StatsServiceClass {
  // Mengambil total laporan, valid, ignored, rawan, pending
  async getStats() {
    return await API.get('/api/stats');
  }
}

export const StatsService = new StatsServiceClass();
