// detail.js - Kontroler Halaman Detail Analisis Laporan Sungai
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';

export class DetailPage {
  constructor() {
    this.reportId = null;
    this.report = null;
  }

  // Merender halaman detail laporan
  async render(container, id) {
    this.reportId = parseInt(id);

    container.innerHTML = `
      <!-- Back navigation bar -->
      <section class="detail-nav-row">
        <button class="btn btn-glass btn-rounded btn-back-route" id="btn-detail-back">
          <i data-lucide="arrow-left"></i> Kembali ke Daftar
        </button>
      </section>

      <!-- Main Detail grid layout -->
      <div class="detail-grid-layout" id="detail-grid-container">
        <!-- Render loading skeleton initially -->
        <div class="glass-card skeleton-detail-img"></div>
        <div class="glass-card skeleton-detail-form"></div>
      </div>
    `;

    // Back click trigger
    document.getElementById('btn-detail-back').addEventListener('click', () => {
      // If we came from Laporan page, go back to Laporan. Otherwise default to Dashboard.
      const lastActiveTab = sessionStorage.getItem('lastActiveTab');
      if (lastActiveTab === 'laporan') {
        Router.navigate('/dashboard/laporan');
      } else {
        Router.navigate('/dashboard');
      }
    });

    if (window.lucide) window.lucide.createIcons();

    // Load initial data
    await this.loadData();
  }

  async loadData() {
    const grid = document.getElementById('detail-grid-container');
    if (!grid) return;

    if (isNaN(this.reportId)) {
      EventBus.emit('toast:show', { message: 'ID Laporan tidak valid.', type: 'danger' });
      Router.navigate('/dashboard');
      return;
    }

    try {
      const report = await ReportService.getReportById(this.reportId);
      this.report = report;

      // Draw Page Layout
      let aiLevelClass = 'none';
      if (report.aiStatus === 'TINGGI') aiLevelClass = 'high';
      if (report.aiStatus === 'SEDANG') aiLevelClass = 'medium';
      if (report.aiStatus === 'RENDAH') aiLevelClass = 'low';

      // Admin verification badges
      let adminBadgeClass = 'status-pending';
      if (report.adminStatus === 'VALID') adminBadgeClass = 'status-valid';
      if (report.adminStatus === 'DIABAIKAN') adminBadgeClass = 'status-ignored';

      // Generate Bounding Boxes
      let boxesHtml = '';
      if (report.boundingBoxes && report.boundingBoxes.length > 0) {
        report.boundingBoxes.forEach(box => {
          let boxColorClass = 'yolo-default';
          if (box.label === 'person') boxColorClass = 'yolo-person';
          if (box.label === 'trash') boxColorClass = 'yolo-trash';
          if (box.label === 'boat') boxColorClass = 'yolo-boat';

          boxesHtml += `
            <div class="yolo-box ${boxColorClass}" style="
              top: ${box.y}%; 
              left: ${box.x}%; 
              width: ${box.w}%; 
              height: ${box.h}%;
            ">
              <span class="yolo-box-label">${box.label} ${(box.confidence).toFixed(2)}</span>
            </div>
          `;
        });
      }

      grid.innerHTML = `
        <!-- Left: Image Canvas and Metadata -->
        <main class="glass-card detail-main-card">
          <div class="image-canvas-container" id="detail-image-wrapper">
            <img src="${report.image}" alt="CCTV Capture Laporan" class="detail-main-img">
            ${boxesHtml}
            <div class="scanning-laser-line" id="scanning-laser"></div>
          </div>

          <div class="detail-info-list" style="margin-top: 24px;">
            <div class="detail-info-item">
              <span class="detail-info-label">Hasil AI Status</span>
              <span class="badge badge-${levelToBadge(aiLevelClass)}">${report.aiStatus}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Keyakinan AI</span>
              <span class="detail-info-val" style="font-weight: 700;">${report.aiConfidence ? `${report.aiConfidence}%` : 'N/A'}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Waktu Deteksi</span>
              <span class="detail-info-val">${Formatter.formatDate(report.timestamp)}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Lokasi Sungai</span>
              <span class="detail-info-val"><i data-lucide="map-pin" style="width: 14px; height: 14px; display:inline-block; color:var(--primary); margin-right:4px;"></i> ${report.location}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Ciri/Identitas</span>
              <span class="detail-info-val">${report.identity || 'Belum diketahui'}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Jenis Pemantauan</span>
              <span class="detail-info-val">${report.sourceType || 'Gambar'}</span>
            </div>
          </div>

          <div class="detail-description-box">
            <span class="detail-info-label" style="display:block; margin-bottom: 8px;">Keterangan Tambahan</span>
            <p class="description-text">${report.additionalNotes || 'Tidak ada catatan tambahan.'}</p>
          </div>
        </main>

        <!-- Right: Admin validation form & actions -->
        <aside class="glass-card detail-sidebar-card">
          <div class="card-header-clean">
            <h3 class="section-title"><i data-lucide="check-square" class="text-primary"></i> Verifikasi Keputusan</h3>
          </div>

          <div class="form-group" style="margin-bottom: 24px;">
            <label class="form-label">Status Saat Ini</label>
            <div style="margin-top: 4px;">
              <span class="status-badge ${adminBadgeClass}" id="detail-current-admin-status-pill">${report.adminStatus}</span>
            </div>
          </div>

          <form id="detail-verify-form" class="detail-verify-form">
            <div class="form-group">
              <label class="form-label" for="verify-status-select">Tentukan Validasi</label>
              <select class="form-control select-rounded" id="verify-status-select" required>
                <option value="MENUNGGU" ${report.adminStatus === 'MENUNGGU' ? 'selected' : ''}>Menunggu (Belum Diverifikasi)</option>
                <option value="VALID" ${report.adminStatus === 'VALID' ? 'selected' : ''}>Valid (Tindak Lanjut Laporan)</option>
                <option value="DIABAIKAN" ${report.adminStatus === 'DIABAIKAN' ? 'selected' : ''}>Abaikan (Bukan Ancaman/Salah AI)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="verify-notes-input">Catatan Tindak Lanjut</label>
              <textarea class="form-control textarea-rounded" id="verify-notes-input" placeholder="Masukkan instruksi rujukan dinas sosial atau ketua RT setempat...">${report.adminNotes || ''}</textarea>
            </div>

            <button type="submit" class="btn btn-primary btn-rounded" style="width: 100%; margin-top: 16px;">
              <i data-lucide="save"></i> Simpan Keputusan
            </button>
          </form>

          <div class="divider-line"></div>

          <!-- Telegram broadcast simulated button -->
          <button class="btn btn-glass btn-rounded" id="btn-telegram-dispatch" style="width: 100%; color: var(--primary); border-color: rgba(59, 130, 246, 0.4);">
            <i data-lucide="send"></i> Kirim ke Telegram Tim Respon
          </button>
        </aside>
      `;

      this.bindActionEvents();

    } catch (err) {
      grid.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 32px; text-align: center;">
          <i data-lucide="alert-octagon" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Gagal Memuat Detail Laporan</h3>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">Log deteksi sungai tidak ditemukan atau otorisasi gagal.</p>
        </div>
      `;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  bindActionEvents() {
    const form = document.getElementById('detail-verify-form');
    const telegramBtn = document.getElementById('btn-telegram-dispatch');
    const statusSelect = document.getElementById('verify-status-select');
    const notesInput = document.getElementById('verify-notes-input');

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newStatus = statusSelect.value;
        const notes = notesInput.value;

        try {
          const updated = await ReportService.verifyReport(this.reportId, newStatus, notes);
          
          // Update status pill visual
          const statusPill = document.getElementById('detail-current-admin-status-pill');
          if (statusPill) {
            statusPill.innerText = updated.adminStatus;
            
            let adminBadgeClass = 'status-pending';
            if (updated.adminStatus === 'VALID') adminBadgeClass = 'status-valid';
            if (updated.adminStatus === 'DIABAIKAN') adminBadgeClass = 'status-ignored';
            statusPill.className = `status-badge ${adminBadgeClass}`;
          }
        } catch (err) {
          // Error notification handled inside service layer
        }
      });
    }

    if (telegramBtn) {
      telegramBtn.addEventListener('click', async () => {
        telegramBtn.disabled = true;
        telegramBtn.innerHTML = '<span class="spinner-neon" style="width:14px; height:14px; border-width:2px; display:inline-block; margin-right:8px;"></span> Mengirim...';
        
        try {
          // Simulated network delay
          await new Promise(resolve => setTimeout(resolve, 1500));
          EventBus.emit('toast:show', { message: 'Laporan berhasil disiarkan ke Telegram Respon Cepat!', type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengirim pesan Telegram.', type: 'danger' });
        } finally {
          telegramBtn.disabled = false;
          telegramBtn.innerHTML = '<i data-lucide="send"></i> Kirim ke Telegram Tim Respon';
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }
  }

  destroy() {
    // No polling on detail page
  }
}

// Helpers
function levelToBadge(level) {
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  if (level === 'low') return 'low';
  return 'none';
}

export const Detail = new DetailPage();
