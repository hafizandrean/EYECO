// reportService.js - Layanan Kelola Data Laporan & Aktivitas Sungai
import { API } from './api.js';
import { EventBus } from '../core/eventBus.js';
import { AppState } from '../core/state.js';

class ReportServiceClass {
  constructor() {
    this.lastCommentsState = new Map(); // reportId -> commentCount
  }

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

    const response = await API.get(`/api/detections?${queryParams.toString()}`);
    
    // Check for comment updates
    if (response && response.reports) {
      this.checkForNewComments(response.reports);
    }
    
    return response;
  }

  checkForNewComments(reports) {
    const currentUser = AppState.get('user');
    if (!currentUser) return;

    reports.forEach(report => {
      const comments = report.comments || [];
      const prevCount = this.lastCommentsState.get(report.id);

      if (prevCount !== undefined && comments.length > prevCount) {
        // Find new comments that were added
        const newComments = comments.slice(prevCount);
        newComments.forEach(comment => {
          // If the comment is from someone else
          if (comment.userId !== currentUser.id && !comment.isDeleted) {
            // Push notification to AppState
            const notifications = AppState.get('notifications') || [];
            
            // Check if this comment notification is already in the list to avoid duplicate
            const alreadyNotified = notifications.some(n => n.commentId === comment._id);
            if (!alreadyNotified) {
              notifications.unshift({
                id: report.id,
                commentId: comment._id,
                location: report.location,
                aiStatus: 'Info',
                aiConfidence: 0,
                timestamp: new Date(comment.createdAt || comment.timestamp || Date.now()),
                isComment: true,
                message: `Komentar baru dari ${comment.username || 'Pengguna'}: "${comment.text.substring(0, 30)}${comment.text.length > 30 ? '...' : ''}"`
              });
              AppState.set('notifications', notifications);
              AppState.set('unreadNotifications', (AppState.get('unreadNotifications') || 0) + 1);

              // Show toast
              EventBus.emit('toast:show', {
                message: `Komentar baru di ${report.location} dari ${comment.username || 'Pengguna'}`,
                type: 'info'
              });
            }
          }
        });
      }

      // Seed initial state or update cached comment count
      this.lastCommentsState.set(report.id, comments.length);
    });
  }

  // Ambil data komentar terfilter dan terpaginasi
  async getComments(id, page = 1, limit = 10, sortBy = 'newest') {
    const queryParams = new URLSearchParams({ page, limit, sortBy });
    const response = await API.get(`/api/detections/${id}/comments?${queryParams.toString()}`);
    return response.data; // uses sendSuccess wrapper { success: true, data: { comments, pagination } }
  }

  // Tambah komentar baru
  async addComment(id, text) {
    const response = await API.post(`/api/detections/${id}/comments`, { text });
    return response.data;
  }

  // Hapus komentar (soft delete)
  async deleteComment(id, commentId) {
    const response = await API.post(`/api/detections/${id}/comments/${commentId}?_method=DELETE`, {}, {
      // API is standard DELETE, but our fetch wrapper POST has method overrides if needed.
      // Wait, our API.request method supports GET/POST but we can write custom methods.
      // Let's see: API.request takes option.method. Let's write standard DELETE request!
    });
    // Wait, let's check API class:
    // API has a request(url, options) which takes method in options.
    // So we can do: API.request(`/api/detections/${id}/comments/${commentId}`, { method: 'DELETE' })
  }

  // Let's implement deleteComment correctly:
  async deleteComment(id, commentId) {
    const response = await API.request(`/api/detections/${id}/comments/${commentId}`, { method: 'DELETE' });
    return response.data;
  }

  // Suka / tidak suka komentar
  async toggleLikeComment(id, commentId) {
    const response = await API.post(`/api/detections/${id}/comments/${commentId}/like`);
    return response.data;
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
