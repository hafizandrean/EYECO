// reportService.js - Layanan Kelola Data Laporan & Aktivitas Sungai
import { API } from './api.js';
import { EventBus } from '../core/eventBus.js';

class ReportServiceClass {
  // Ambil data laporan terfilter dan terpaginasi
  async getFilteredReports(filters = {}, page = 1, limit = 5) {
    const queryParams = new URLSearchParams({
      page,
      limit,
      timeRange: filters.timeRange || 'semua',
      date: filters.date || '',
      aiStatus: filters.aiStatus || 'semua',
      adminStatus: filters.adminStatus || 'semua',
      location: filters.location || ''
    });

    return await API.get(`/api/detections?${queryParams.toString()}`);
  }

  // Ambil laporan tunggal berdasarkan ID
  async getReportById(id) {
    return await API.get(`/api/detections/${id}`);
  }

  // Simpan verifikasi keputusan admin
  async verifyReport(id, status, notes) {
    try {
      const response = await API.post(`/api/detections/${id}/verify`, { status, notes });
      EventBus.emit('toast:show', { message: `Laporan #${id} berhasil diupdate menjadi ${status}`, type: 'success' });
      EventBus.emit('report:updated', response);
      return response;
    } catch (err) {
      EventBus.emit('toast:show', { message: `Gagal memperbarui verifikasi: ${err.message}`, type: 'danger' });
      throw err;
    }
  }

  // Upload laporan baru (mengembalikan form data)
  async uploadReport(formData) {
    return await API.post('/api/detections', formData);
  }

  // Ekspor laporan ke file CSV (Admin)
  exportCSV() {
    try {
      window.open('/api/export', '_blank');
      EventBus.emit('toast:show', { message: 'Mengekspor laporan ke CSV...', type: 'success' });
    } catch (err) {
      EventBus.emit('toast:show', { message: 'Gagal mengekspor berkas.', type: 'danger' });
    }
  }
}

export const ReportService = new ReportServiceClass();
