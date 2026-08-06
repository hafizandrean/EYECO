// laporan.js - Kontroler Halaman Daftar Laporan Lingkungan (Card Table)
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { CONFIG } from '../core/config.js';
import { EventBus } from '../core/eventBus.js';
import { AppState } from '../core/state.js';
import { MacModal } from '../utils/macModal.js';

export class LaporanPage {
  constructor() {
    this.pollingTimer = null;
    this.currentPage = 1;
    this.limit = 10;
    this.reports = [];
    this.pagination = { totalPages: 1, hasPrev: false, hasNext: false };
    this.filters = {
      timeRange: 'semua',
      date: '',
      aiStatus: 'semua',
      adminStatus: 'semua',
      location: '',
      myReports: false,
    };
  }

  // Merender halaman daftar laporan
  async render(container) {
    // Check url search params for pre-filled filters
    const urlParams = new URLSearchParams(window.location.search);
    const searchLoc = urlParams.get('location');
    if (searchLoc) {
      this.filters.location = decodeURIComponent(searchLoc);
      // Clear URL params after parsing so it doesn't persist forever
      window.history.replaceState({}, '', '/dashboard/laporan');
    }

    container.innerHTML = `
      <!-- Page Header -->
      <div class="page-header" style="margin-bottom: var(--space-24);padding:14px 20px;border-radius:var(--radius-lg);background:rgba(255,255,255,0.55);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,0.7);">
        <div class="section-title" style="font-size: 1.8rem; font-weight: 800; color: var(--text-primary); margin: 0;">
          Log Aktivitas Lingkungan
        </div>
      </div>

      <!-- Advanced Filter row - single line, NO background -->
      <section class="filters-section" style="background: transparent; border: none; box-shadow: none; padding: 0; margin-bottom: var(--space-20);">
        <div class="filters-row">
          <div class="filter-item-compact">
            <label class="filter-label">Rentang Waktu</label>
            <select class="filter-control select-rounded" id="filter-time">
              <option value="semua" ${this.filters.timeRange === 'semua' ? 'selected' : ''}>Semua Waktu</option>
              <option value="hari_ini" ${this.filters.timeRange === 'hari_ini' ? 'selected' : ''}>Hari Ini</option>
              <option value="minggu_ini" ${this.filters.timeRange === 'minggu_ini' ? 'selected' : ''}>Minggu Ini</option>
            </select>
          </div>
          <div class="filter-item-compact">
            <label class="filter-label">Tanggal</label>
            <input type="date" class="filter-control input-rounded" id="filter-date" value="${this.filters.date}">
          </div>
          <div class="filter-item-compact">
            <label class="filter-label">Indikasi AI</label>
            <select class="filter-control select-rounded" id="filter-ai">
              <option value="semua" ${this.filters.aiStatus === 'semua' ? 'selected' : ''}>Semua Indikasi</option>
              <option value="TINGGI" ${this.filters.aiStatus === 'TINGGI' ? 'selected' : ''}>Tinggi</option>
              <option value="SEDANG" ${this.filters.aiStatus === 'SEDANG' ? 'selected' : ''}>Sedang</option>
              <option value="RENDAH" ${this.filters.aiStatus === 'RENDAH' ? 'selected' : ''}>Rendah</option>
              <option value="Tidak Terindikasi" ${this.filters.aiStatus === 'Tidak Terindikasi' ? 'selected' : ''}>Tidak Terindikasi</option>
            </select>
          </div>
          <div class="filter-item-compact">
            <label class="filter-label">Status</label>
            <select class="filter-control select-rounded" id="filter-admin">
              <option value="semua" ${this.filters.adminStatus === 'semua' ? 'selected' : ''}>Semua Status</option>
              <option value="MENUNGGU" ${this.filters.adminStatus === 'MENUNGGU' ? 'selected' : ''}>Menunggu</option>
              <option value="VALID" ${this.filters.adminStatus === 'VALID' ? 'selected' : ''}>Valid</option>
              <option value="DIABAIKAN" ${this.filters.adminStatus === 'DIABAIKAN' ? 'selected' : ''}>Diabaikan</option>
            </select>
          </div>
          <div class="filter-item-compact search-item-compact">
            <label class="filter-label">Cari</label>
            <div class="search-input-wrapper-laporan" style="position: relative;">
              <i data-lucide="search" class="search-input-icon-laporan" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 13px; height: 13px; color: var(--text-muted);"></i>
              <input type="text" class="filter-control input-rounded" id="search-location" placeholder="Lokasi..." value="${this.filters.location}" style="padding-left: 30px; width: 100%; font-size:0.78rem;">
            </div>
          </div>
          <div class="filter-item-compact filter-my-reports-compact">
            <label class="filter-label">&nbsp;</label>
            <label class="toggle-switch-inline" style="display:flex; align-items:center; gap:5px; cursor:pointer; white-space:nowrap;">
              <input type="checkbox" id="filter-my-reports" ${this.filters.myReports ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer;margin:0;">
              <span style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);">Saya</span>
            </label>
          </div>
          <div class="filter-item-compact reset-btn-compact">
            <label class="filter-label">&nbsp;</label>
            <button class="btn btn-glass btn-rounded" id="btn-reset-filters" style="height: 34px; padding: 0 12px; font-size:0.72rem; display:flex; align-items:center; gap:4px;">
              <i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i> Atur Ulang
            </button>
          </div>
        </div>
      </section>

      <!-- Logs Card Table -->
      <section class="glass-card card-table-section">
        <div class="card-header-clean">
          ${AppState.get('user')?.role === 'admin' || AppState.get('user')?.role === 'superadmin' ? `
            <button class="btn btn-sm btn-rounded" id="btn-clear-all-reports" style="background: rgba(239,68,68,0.1); color: #DC2626; border: 1px solid rgba(239,68,68,0.4); font-weight: 700;">
              <i data-lucide="trash-2" style="color:#DC2626;"></i> Hapus Semua Data
            </button>
          ` : ''}
        </div>

        <div class="card-table" id="reports-card-table">
          <!-- Populated by JS -->
        </div>

        <!-- Pagination -->
        <div class="pagination-container" id="pagination-controls">
          <button class="btn btn-glass btn-rounded btn-sm" id="btn-prev" disabled>
            <i data-lucide="chevron-left"></i> Sebelum
          </button>
          <span class="page-info" id="page-info-text">Halaman 1 dari 1</span>
          <button class="btn btn-glass btn-rounded btn-sm" id="btn-next" disabled>
            Selanjutnya <i data-lucide="chevron-right"></i>
          </button>
        </div>
      </section>
    `;

    this.bindEvents();
    this.renderSkeletons();
    
    // Initial fetch
    await this.loadData();

    // Start 10s polling
    this.startPolling();
  }

  renderSkeletons() {
    const table = document.getElementById('reports-card-table');
    if (table) {
      table.innerHTML = Array(3).fill(0).map(() => `
        <div class="card-table-row skeleton-row glass-card">
          <div class="skeleton skeleton-thumb"></div>
          <div class="skeleton-row-details">
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line-short"></div>
          </div>
          <div class="skeleton skeleton-badge-box"></div>
          <div class="skeleton skeleton-badge-box"></div>
          <div class="skeleton skeleton-btn-box"></div>
        </div>
      `).join('');
    }
  }

  bindEvents() {
    const filterTime = document.getElementById('filter-time');
    const filterDate = document.getElementById('filter-date');
    const filterAi = document.getElementById('filter-ai');
    const filterAdmin = document.getElementById('filter-admin');
    const searchLocation = document.getElementById('search-location');
    const btnReset = document.getElementById('btn-reset-filters');
    const filterMyReports = document.getElementById('filter-my-reports');

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    // Trigger filters on change
    if (filterTime) {
      filterTime.addEventListener('change', () => {
        if (filterTime.value !== 'semua' && filterDate) {
          filterDate.value = '';
          this.filters.date = '';
        }
        this.applyFilters();
      });
    }

    if (filterDate) {
      filterDate.addEventListener('change', () => {
        if (filterDate.value && filterTime) {
          filterTime.value = 'semua';
          this.filters.timeRange = 'semua';
        }
        this.applyFilters();
      });
    }

    if (filterAi) filterAi.addEventListener('change', () => this.applyFilters());
    if (filterAdmin) filterAdmin.addEventListener('change', () => this.applyFilters());
    
    if (searchLocation) {
      searchLocation.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.applyFilters();
        }
      });
    }

    if (filterMyReports) {
      filterMyReports.addEventListener('change', () => this.applyFilters());
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.filters = { timeRange: 'semua', date: '', aiStatus: 'semua', adminStatus: 'semua', location: '', myReports: false };
        if (filterTime) filterTime.value = 'semua';
        if (filterDate) filterDate.value = '';
        if (filterAi) filterAi.value = 'semua';
        if (filterAdmin) filterAdmin.value = 'semua';
        if (searchLocation) searchLocation.value = '';
        if (filterMyReports) filterMyReports.checked = false;
        this.currentPage = 1;
        this.loadData();
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.loadData();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (this.currentPage < this.pagination.totalPages) {
          this.currentPage++;
          this.loadData();
        }
      });
    }

    // Clear all reports (admin only) — macOS-style prompt
    const btnClearAll = document.getElementById('btn-clear-all-reports');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', async () => {
        const confirmed = await MacModal.confirm(
          'Hapus Semua Data Laporan',
          `Semua laporan dan foto di workspace ini akan <strong>dihapus permanen</strong>.<br><br>Tindakan ini tidak dapat dibatalkan.`,
          { iconType: 'danger', confirmText: 'Lanjutkan', cancelText: 'Batal', confirmStyle: 'danger' }
        );
        if (!confirmed) return;

        // Second step: type "HAPUS SEMUA LAPORAN" to confirm
        const input = await MacModal.prompt(
          'Konfirmasi Penghapusan',
          `Ketik <strong>"HAPUS SEMUA LAPORAN"</strong> (huruf kapital) untuk mengonfirmasi penghapusan <strong>semua</strong> data laporan dan foto.`,
          {
            placeholder: 'Ketik "HAPUS SEMUA LAPORAN" di sini...',
            confirmText: 'Hapus Semua',
            cancelText: 'Batal',
            iconType: 'danger',
            confirmStyle: 'danger',
            validate: (val) => val === 'HAPUS SEMUA LAPORAN',
            errMsg: 'Konfirmasi belum sesuai.'
          }
        );
        if (!input || input.trim() !== 'HAPUS SEMUA LAPORAN') {
          EventBus.emit('toast:show', { message: 'Penghapusan dibatalkan. Teks konfirmasi tidak cocok.', type: 'info' });
          return;
        }

        try {
          btnClearAll.disabled = true;
          btnClearAll.innerHTML = '<i data-lucide="loader"></i> Menghapus...';
          if (window.lucide) window.lucide.createIcons();
          const res = await fetch('/api/clear-all', { method: 'DELETE', credentials: 'include' });
          const data = await res.json();
          if (data.success) {
            let msg = `${data.deleted} data laporan berhasil dihapus.`;
            if (data.filesDeleted > 0) msg += ` ${data.filesDeleted} file gambar juga dihapus.`;
            if (data.filesFailed > 0) msg += ` ${data.filesFailed} file gagal dihapus.`;
            EventBus.emit('toast:show', { message: msg, type: 'success' });
            this.currentPage = 1;
            await this.loadData();
          } else {
            EventBus.emit('toast:show', { message: data.error || 'Gagal menghapus data.', type: 'danger' });
          }
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal terhubung ke server.', type: 'danger' });
        } finally {
          if (btnClearAll) {
            btnClearAll.disabled = false;
            btnClearAll.innerHTML = '<i data-lucide="trash-2"></i> Hapus Semua Data';
            if (window.lucide) window.lucide.createIcons();
          }
        }
      });
    }
  }

  applyFilters() {
    this.filters.timeRange = document.getElementById('filter-time').value;
    this.filters.date = document.getElementById('filter-date').value;
    this.filters.aiStatus = document.getElementById('filter-ai').value;
    this.filters.adminStatus = document.getElementById('filter-admin').value;
    this.filters.location = document.getElementById('search-location').value;
    const myReportsCb = document.getElementById('filter-my-reports');
    this.filters.myReports = myReportsCb ? myReportsCb.checked : false;
    this.currentPage = 1;
    this.loadData();
  }

  async loadData() {
    try {
      const response = await ReportService.getFilteredReports(this.filters, this.currentPage, this.limit);
      this.reports = response.reports || [];
      this.pagination = response.pagination || { totalPages: 1, hasPrev: false, hasNext: false };

      this.renderTable();
      this.updatePaginationControls();
    } catch (err) {
      this.renderError();
    }
  }

  renderTable() {
    const container = document.getElementById('reports-card-table');
    if (!container) return;

    container.innerHTML = '';

    if (this.reports.length === 0) {
      // Empty state
      container.innerHTML = `
        <div class="empty-state-card" style="padding: 48px; text-align: center;">
          <i data-lucide="database-backup" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
          <h3>Tidak Ada Data Laporan</h3>
          <p style="color: var(--text-secondary); margin-top: 8px;">Tidak ada log monitoring yang sesuai dengan kriteria filter saat ini.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // Populate Card Table Rows
    this.reports.forEach(report => {
      const row = document.createElement('div');
      row.className = 'card-table-row glass-card';

      // Threat Badge
      let aiBadgeClass = 'badge-none';
      const s = (report.aiStatus || '').toUpperCase().replace('INDIKASI ', '');
      let aiLabel = 'Tidak Terindikasi';
      if (s === 'TINGGI') { aiBadgeClass = 'badge-high'; aiLabel = 'Tinggi'; }
      else if (s === 'SEDANG') { aiBadgeClass = 'badge-medium'; aiLabel = 'Sedang'; }
      else if (s === 'RENDAH') { aiBadgeClass = 'badge-low'; aiLabel = 'Rendah'; }

      // Admin Status Badge
      let adminBadgeClass = 'status-pending';
      if (report.adminStatus === 'VALID') adminBadgeClass = 'status-valid';
      else if (report.adminStatus === 'DIABAIKAN') adminBadgeClass = 'status-ignored';

      // Quick admin verification actions (Only for admin)
      let actionButtons = '';
      const currentUser = AppState.get('user');
      const isAdmin = currentUser?.role === 'admin';
      if (isAdmin && report.adminStatus === 'MENUNGGU') {
        actionButtons = `
          <button class="btn btn-soft btn-sm btn-quick-verify" data-id="${report.id}" data-action="VALID" style="color: var(--success); background: var(--success-bg); border: 1px solid rgba(16,185,129,0.2); font-weight: 700;">Valid</button>
          <button class="btn btn-soft btn-sm btn-quick-verify" data-id="${report.id}" data-action="DIABAIKAN" style="color: var(--danger); background: var(--danger-bg); border: 1px solid rgba(239,68,68,0.2); font-weight: 700;">Abaikan</button>
        `;
      }

      // Delete button (own report, within 10 min) — backend flag or client fallback
      let deleteBtnHtml = '';
      const canDelete = typeof report.canDelete === 'boolean'
        ? report.canDelete
        : (currentUser && report.userId &&
           (currentUser._id || currentUser.id || '').toString() === report.userId.toString() &&
           (report.createdAt || report.timestamp) &&
           (Date.now() - new Date(report.createdAt || report.timestamp).getTime()) < 10 * 60 * 1000);

      if (canDelete) {
        deleteBtnHtml = `
          <button class="btn-delete-report-list" data-id="${report.id}" title="Hapus laporan">
            <i data-lucide="trash-2" style="width:13px;height:13px;"></i> Hapus
          </button>
        `;
      }

      // Mini bounding boxes html for thumbnails
      let boxesHtml = '';
      if (report.boundingBoxes && report.boundingBoxes.length > 0) {
        report.boundingBoxes.forEach(box => {
          boxesHtml += `
            <div class="yolo-preview-box-mini" style="
              top: ${box.y}%; 
              left: ${box.x}%; 
              width: ${box.w}%; 
              height: ${box.h}%;
            "></div>
          `;
        });
      }

      row.innerHTML = `
        <div class="col-thumbnail">
          <div class="mini-thumbnail" style="display: flex; align-items: center; justify-content: center; background: var(--surface-soft);">
            ${(() => {
              const isVideoImage = report.image && report.image.endsWith('.mp4');
              return isVideoImage
                ? `<div style="display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; background: var(--surface-soft); color: var(--text-muted);">
                    <i data-lucide="video" style="width: 18px; height: 18px;"></i>
                   </div>`
                : `<img src="${report.image}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
                   <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: var(--surface-soft); color: var(--text-muted);">
                    <i data-lucide="image" style="width: 18px; height: 18px;"></i>
                   </div>`;
            })()}
            ${boxesHtml}
          </div>
        </div>
        <div class="col-details">
          <div class="row-location-title"><i data-lucide="map-pin" style="color: var(--primary);"></i> ${report.location}</div>
          <div class="row-timestamp-subtitle">${Formatter.formatDate(report.timestamp)}</div>
          ${report.uploaderInfo ? `<div class="row-reporter" style="font-size:0.72rem; color:var(--text-muted); margin-top:3px; display:flex; align-items:center; gap:4px;"><i data-lucide="user" style="width:10px;height:10px;"></i> ${report.uploaderInfo.name || report.uploaderInfo.username}</div>` : ''}
        </div>
        <div class="col-badge">
          ${report.analysisState === 'PROCESSING' || report.aiDataIntegrityStatus === 'PENDING'
            ? `<span class="badge badge-secondary" style="background: rgba(47,107,255,0.08); color: var(--primary);"><span class="pill-dot" style="background-color: currentColor;"></span>AI: Sedang dianalisis</span>
               <span class="row-confidence-label" style="font-size:0.72rem; color:var(--primary); font-weight:700; display:block; margin-top:2px;">Menunggu hasil AI</span>`
            : report.analysisState === 'REANALYSIS_PENDING'
              ? `<span class="badge badge-secondary" style="background: rgba(245,158,11,0.08); color: var(--warning);"><span class="pill-dot" style="background-color: currentColor;"></span>AI: Antrean Analisis Ulang</span>
                 <span class="row-confidence-label" style="font-size:0.72rem; color:var(--warning); font-weight:700; display:block; margin-top:2px;">Menunggu jadwal retry</span>`
              : report.analysisState === 'FAILED'
                ? `<span class="badge badge-secondary" style="background: rgba(239,68,68,0.08); color: var(--danger);"><span class="pill-dot" style="background-color: currentColor;"></span>AI: Gagal Analisis</span>
                   <span class="row-confidence-label" style="font-size:0.72rem; color:var(--text-muted); display:block; margin-top:2px;">Skor: Tidak tersedia</span>`
                : `<span class="badge ${aiBadgeClass}">
                     <span class="pill-dot" style="background-color: currentColor;"></span>
                     AI: ${aiLabel}
                   </span>
                   ${Number.isFinite(report.violationScore)
                     ? `<span class="row-confidence-label" style="font-weight:800; font-size:0.75rem; color:var(--text-secondary); display:block; margin-top:2px;">Skor: ${report.violationScore}/100</span>` 
                     : `<span class="row-confidence-label" style="font-size:0.72rem; color:var(--text-muted); display:block; margin-top:2px;">Skor: Tidak tersedia</span>`}`
          }
        </div>
        <div class="col-badge">
          <span class="status-badge ${adminBadgeClass}">${report.adminStatus}</span>
        </div>
        <div class="col-actions">
          <div class="action-group">
            ${actionButtons}
            ${deleteBtnHtml}
            <button class="btn btn-primary btn-sm btn-view-details" data-id="${report.id}">Detail Data</button>
          </div>
        </div>
      `;

      // View details click handler
      row.querySelector('.btn-view-details').addEventListener('click', () => {
        Router.navigate(`/dashboard/detections/${report.id}`);
      });

      // Quick verify actions click handlers
      const quickBtns = row.querySelectorAll('.btn-quick-verify');
      quickBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const action = btn.getAttribute('data-action');
          const actionLabel = action === 'VALID' ? 'Valid' : 'Abaikan';
          const confirmed = await MacModal.confirm(
            `${actionLabel} Laporan #${id}?`,
            `Laporan ini akan ditandai sebagai <strong>${actionLabel}</strong>. ${action === 'DIABAIKAN' ? 'Laporan akan diarsipkan.' : 'Status akan dikonfirmasi sebagai valid.'}`,
            { iconType: action === 'VALID' ? 'success' : 'warning', confirmText: 'Ya, ' + actionLabel, cancelText: 'Batal', confirmStyle: 'primary' }
          );
          if (!confirmed) return;
          await ReportService.verifyReport(id, action, 'Verifikasi cepat dari Laporan logs.');
          this.loadData();
        });
      });

      // Delete from list
      const deleteBtn = row.querySelector('.btn-delete-report-list');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await MacModal.confirm(
            'Hapus Laporan',
            `Apakah Anda yakin ingin menghapus laporan <strong>#${report.id}</strong>? Tindakan ini tidak dapat dibatalkan.`,
            { iconType: 'danger', confirmText: 'Hapus', cancelText: 'Batal', confirmStyle: 'danger' }
          );
          if (!confirmed) return;
          deleteBtn.disabled = true;
          deleteBtn.innerHTML = '...';
          try {
            const res = await fetch(`/api/detections/${report.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              EventBus.emit('toast:show', { message: 'Laporan berhasil dihapus', type: 'success' });
              this.loadData();
            } else {
              EventBus.emit('toast:show', { message: data.error || 'Gagal menghapus laporan', type: 'danger' });
              deleteBtn.disabled = false;
              deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:13px;height:13px;"></i> Hapus';
              if (window.lucide) window.lucide.createIcons();
            }
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal menghapus laporan', type: 'danger' });
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:13px;height:13px;"></i> Hapus';
            if (window.lucide) window.lucide.createIcons();
          }
        });
      }

      container.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  updatePaginationControls() {
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const pageText = document.getElementById('page-info-text');

    if (btnPrev) btnPrev.disabled = !this.pagination.hasPrev;
    if (btnNext) btnNext.disabled = !this.pagination.hasNext;
    if (pageText) pageText.innerText = `Halaman ${this.currentPage} dari ${this.pagination.totalPages}`;
  }

  renderError() {
    const container = document.getElementById('reports-card-table');
    if (container) {
      container.innerHTML = `
        <div class="glass-card error-alert-card" style="padding: 32px; text-align: center;">
          <i data-lucide="alert-octagon" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Gagal Memuat Logs Laporan</h3>
          <p style="color: var(--text-secondary); margin: 8px 0 16px 0;">Terjadi gangguan saat mengambil data pemantauan dari server.</p>
          <button id="btn-retry-laporan" class="btn btn-primary btn-rounded">
            <i data-lucide="refresh-cw"></i> Coba Lagi
          </button>
        </div>
      `;

      const btnRetry = document.getElementById('btn-retry-laporan');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => this.loadData());
      }

      if (window.lucide) window.lucide.createIcons();
    }
  }

  startPolling() {
    this.pollingTimer = setInterval(() => {
      this.loadData();
    }, CONFIG.POLLING_INTERVAL);
  }

  destroy() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}
export const Laporan = new LaporanPage();
