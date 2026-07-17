// laporan.js - Kontroler Halaman Daftar Laporan Sungai (Card Table)
import { ReportService } from '../services/reportService.js';
import { StatsService } from '../services/statsService.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { CONFIG } from '../core/config.js';
import { EventBus } from '../core/eventBus.js';
import { AppState } from '../core/state.js';
import { animateCounter, createScrollObserver } from '../utils/animations.js';

export class LaporanPage {
  constructor() {
    this.pollingTimer = null;
    this.currentPage = 1;
    this.limit = 5;
    this.stats = { total: 0, mostVulnerable: '-', valid: 0, cancelled: 0, pending: 0 };
    this.reports = [];
    this.pagination = { totalPages: 1, hasPrev: false, hasNext: false };
    this.filters = {
      timeRange: 'semua',
      date: '',
      aiStatus: 'semua',
      adminStatus: 'semua',
      location: ''
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
      <!-- Stats summary cards & Validation chart -->
      <section class="stats-chart-layout">
        <!-- Stats cards -->
        <div class="stats-vertical-grid">
          <div class="glass-card stat-card glow-yellow">
            <div class="stat-icon-wrapper yellow"><i data-lucide="folder-open"></i></div>
            <div class="stat-info">
              <div class="stat-label">Total Laporan</div>
              <div class="stat-value" id="laporan-stat-total">0</div>
            </div>
          </div>
          <div class="glass-card stat-card glow-blue">
            <div class="stat-icon-wrapper blue"><i data-lucide="map"></i></div>
            <div class="stat-info">
              <div class="stat-label">Titik Paling Rawan</div>
              <div class="stat-value" id="laporan-stat-rawan">-</div>
            </div>
          </div>
          <div class="glass-card stat-card glow-green">
            <div class="stat-icon-wrapper green"><i data-lucide="check-square"></i></div>
            <div class="stat-info">
              <div class="stat-label">Validasi Selesai</div>
              <div class="stat-value" id="laporan-stat-valid">0</div>
            </div>
          </div>
          <div class="glass-card stat-card glow-red">
            <div class="stat-icon-wrapper red"><i data-lucide="x-circle"></i></div>
            <div class="stat-info">
              <div class="stat-label">Dibatalkan</div>
              <div class="stat-value" id="laporan-stat-cancelled">0</div>
            </div>
          </div>
        </div>

        <!-- Chart card -->
        <div class="glass-card validation-chart-card">
          <div class="card-header-clean">
            <div class="section-title"><i data-lucide="bar-chart-3"></i> Grafik Validasi Admin</div>
          </div>
          <div class="chart-container">
            <div class="chart-bar-wrapper">
              <span class="chart-value" id="laporan-val-pending-count">0</span>
              <div class="chart-bar pending" id="laporan-bar-pending" style="height: 0%;"></div>
              <span class="chart-label">Menunggu</span>
            </div>
            <div class="chart-bar-wrapper">
              <span class="chart-value" id="laporan-val-valid-count">0</span>
              <div class="chart-bar valid" id="laporan-bar-valid" style="height: 0%;"></div>
              <span class="chart-label">Valid</span>
            </div>
            <div class="chart-bar-wrapper">
              <span class="chart-value" id="laporan-val-ignored-count">0</span>
              <div class="chart-bar ignored" id="laporan-bar-ignored" style="height: 0%;"></div>
              <span class="chart-label">Dibatalkan</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Advanced Filter row -->
      <section class="glass-card filters-section">
        <div class="filters-grid">
          <div class="filter-item">
            <label class="filter-label">Rentang Waktu</label>
            <select class="filter-control select-rounded" id="filter-time">
              <option value="semua" ${this.filters.timeRange === 'semua' ? 'selected' : ''}>Semua Waktu</option>
              <option value="hari_ini" ${this.filters.timeRange === 'hari_ini' ? 'selected' : ''}>Hari Ini</option>
              <option value="minggu_ini" ${this.filters.timeRange === 'minggu_ini' ? 'selected' : ''}>Minggu Ini</option>
            </select>
          </div>
          <div class="filter-item">
            <label class="filter-label">Pilih Tanggal</label>
            <input type="date" class="filter-control input-rounded" id="filter-date" value="${this.filters.date}">
          </div>
          <div class="filter-item">
            <label class="filter-label">Hasil Indikasi AI</label>
            <select class="filter-control select-rounded" id="filter-ai">
              <option value="semua" ${this.filters.aiStatus === 'semua' ? 'selected' : ''}>Semua Indikasi</option>
              <option value="TINGGI" ${this.filters.aiStatus === 'TINGGI' ? 'selected' : ''}>Tinggi</option>
              <option value="SEDANG" ${this.filters.aiStatus === 'SEDANG' ? 'selected' : ''}>Sedang</option>
              <option value="RENDAH" ${this.filters.aiStatus === 'RENDAH' ? 'selected' : ''}>Rendah</option>
              <option value="Tidak Terindikasi" ${this.filters.aiStatus === 'Tidak Terindikasi' ? 'selected' : ''}>Tidak Terindikasi</option>
            </select>
          </div>
          <div class="filter-item">
            <label class="filter-label">Status Validasi</label>
            <select class="filter-control select-rounded" id="filter-admin">
              <option value="semua" ${this.filters.adminStatus === 'semua' ? 'selected' : ''}>Semua Status</option>
              <option value="MENUNGGU" ${this.filters.adminStatus === 'MENUNGGU' ? 'selected' : ''}>Menunggu</option>
              <option value="VALID" ${this.filters.adminStatus === 'VALID' ? 'selected' : ''}>Valid</option>
              <option value="DIABAIKAN" ${this.filters.adminStatus === 'DIABAIKAN' ? 'selected' : ''}>Diabaikan</option>
            </select>
          </div>
          <div class="filter-item search-item">
            <label class="filter-label">Cari Lokasi</label>
            <div class="search-input-wrapper-laporan" style="position: relative;">
              <i data-lucide="search" class="search-input-icon-laporan" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-muted);"></i>
              <input type="text" class="filter-control input-rounded" id="search-location" placeholder="Masukkan lokasi..." value="${this.filters.location}" style="padding-left: 36px; width: 100%;">
            </div>
          </div>
          <div class="filter-item reset-filter-col">
            <label class="filter-label" style="visibility: hidden; pointer-events: none;">&nbsp;</label>
            <button class="btn btn-glass btn-rounded" id="btn-reset-filters" style="width: 100%; height: 40px;">
              <i data-lucide="rotate-ccw"></i> Reset Filter
            </button>
          </div>
        </div>
      </section>

      <!-- Logs Card Table -->
      <section class="glass-card card-table-section">
        <div class="card-header-clean">
          <div class="section-title"><i data-lucide="database"></i> Log Aktivitas Sungai</div>
          ${AppState.get('user')?.role === 'admin' ? `
            <button class="btn btn-glass btn-sm btn-rounded" id="btn-clear-all-reports" style="color: var(--error); border-color: rgba(239,68,68,0.3);">
              <i data-lucide="trash-2"></i> Hapus Semua Data
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

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.filters = { timeRange: 'semua', date: '', aiStatus: 'semua', adminStatus: 'semua', location: '' };
        if (filterTime) filterTime.value = 'semua';
        if (filterDate) filterDate.value = '';
        if (filterAi) filterAi.value = 'semua';
        if (filterAdmin) filterAdmin.value = 'semua';
        if (searchLocation) searchLocation.value = '';
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

    // Clear all reports (admin only)
    const btnClearAll = document.getElementById('btn-clear-all-reports');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', async () => {
        const confirmMsg = `PERINGATAN: Semua ${this.pagination.totalPages > 1 ? 'data laporan' : 'data laporan'} di workspace ini akan DIHAPUS PERMANEN.\\n\\nTindakan ini tidak dapat dibatalkan.\\n\\nKetik "HAPUS" untuk konfirmasi:`;
        const input = window.prompt(confirmMsg);
        if (input !== 'HAPUS') {
          EventBus.emit('toast:show', { message: 'Penghapusan dibatalkan.', type: 'info' });
          return;
        }
        try {
          btnClearAll.disabled = true;
          btnClearAll.innerHTML = '<i data-lucide="loader"></i> Menghapus...';
          if (window.lucide) window.lucide.createIcons();
          const res = await fetch('/api/reports/clear-all', { method: 'DELETE', credentials: 'include' });
          const data = await res.json();
          if (data.success) {
            EventBus.emit('toast:show', { message: `${data.deleted} data laporan berhasil dihapus.`, type: 'success' });
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
    this.currentPage = 1;
    this.loadData();
  }

  async loadData() {
    try {
      // 1. Fetch Stats
      const stats = await StatsService.getStats();
      this.stats = stats;

      // 2. Fetch Reports
      const response = await ReportService.getFilteredReports(this.filters, this.currentPage, this.limit);
      this.reports = response.reports || [];
      this.pagination = response.pagination || { totalPages: 1, hasPrev: false, hasNext: false };

      // Render
      this.renderStatsAndCharts();
      this.renderTable();
      this.updatePaginationControls();
    } catch (err) {
      this.renderError();
    }
  }

  renderStatsAndCharts() {
    const totalEl = document.getElementById('laporan-stat-total');
    const rawanEl = document.getElementById('laporan-stat-rawan');
    const validEl = document.getElementById('laporan-stat-valid');
    const cancelledEl = document.getElementById('laporan-stat-cancelled');

    const pendingCount = document.getElementById('laporan-val-pending-count');
    const validCount = document.getElementById('laporan-val-valid-count');
    const ignoredCount = document.getElementById('laporan-val-ignored-count');

    const barPending = document.getElementById('laporan-bar-pending');
    const barValid = document.getElementById('laporan-bar-valid');
    const barIgnored = document.getElementById('laporan-bar-ignored');

    // Set initial = 0
    if (totalEl) totalEl.innerText = '0';
    if (rawanEl) rawanEl.innerText = '-';
    if (validEl) validEl.innerText = '0';
    if (cancelledEl) cancelledEl.innerText = '0';
    if (pendingCount) pendingCount.innerText = '0';
    if (validCount) validCount.innerText = '0';
    if (ignoredCount) ignoredCount.innerText = '0';

    // Set chart bars to 0 first
    if (barPending) barPending.style.height = '0%';
    if (barValid) barValid.style.height = '0%';
    if (barIgnored) barIgnored.style.height = '0%';

    // Scroll observer — animasi jalan saat masuk viewport
    createScrollObserver('.stats-chart-layout', () => {
      // Animate counters naik perlahan
      if (totalEl) animateCounter(totalEl, this.stats.total, 1200);
      if (rawanEl) rawanEl.innerText = this.stats.mostVulnerable;
      if (validEl) animateCounter(validEl, this.stats.valid, 1200);
      if (cancelledEl) animateCounter(cancelledEl, this.stats.cancelled, 1200);

      if (pendingCount) animateCounter(pendingCount, this.stats.pending, 1000);
      if (validCount) animateCounter(validCount, this.stats.valid, 1000);
      if (ignoredCount) animateCounter(ignoredCount, this.stats.cancelled, 1000);

      // Set chart bars heights with transition
      const maxVal = Math.max(this.stats.pending, this.stats.valid, this.stats.cancelled, 1);
      if (barPending) {
        barPending.style.transition = 'height 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        barPending.style.height = `${(this.stats.pending / maxVal) * 80}%`;
      }
      if (barValid) {
        barValid.style.transition = 'height 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        barValid.style.height = `${(this.stats.valid / maxVal) * 80}%`;
      }
      if (barIgnored) {
        barIgnored.style.transition = 'height 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        barIgnored.style.height = `${(this.stats.cancelled / maxVal) * 80}%`;
      }
    });
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
      if (report.aiStatus === 'TINGGI') aiBadgeClass = 'badge-high';
      else if (report.aiStatus === 'SEDANG') aiBadgeClass = 'badge-medium';
      else if (report.aiStatus === 'RENDAH') aiBadgeClass = 'badge-low';

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
          <button class="btn btn-glass btn-sm btn-quick-verify" data-id="${report.id}" data-action="VALID" title="Verifikasi Valid">Valid</button>
          <button class="btn btn-glass btn-sm btn-quick-verify" data-id="${report.id}" data-action="DIABAIKAN" title="Abaikan Laporan">Abaikan</button>
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
          <div class="mini-thumbnail">
            <img src="${report.image}" alt="Bukti #${report.id}" loading="lazy" decoding="async">
            ${boxesHtml}
          </div>
        </div>
        <div class="col-details">
          <div class="row-location-title"><i data-lucide="map-pin" style="color: var(--primary);"></i> ${report.location}</div>
          <div class="row-timestamp-subtitle">${Formatter.formatDate(report.timestamp)}</div>
        </div>
        <div class="col-badge">
          <span class="badge ${aiBadgeClass}">
            <span class="pill-dot" style="background-color: currentColor;"></span>
            AI: ${report.aiStatus}
          </span>
          ${report.aiConfidence ? `<span class="row-confidence-label">${report.aiConfidence}% match</span>` : ''}
        </div>
        <div class="col-badge">
          <span class="status-badge ${adminBadgeClass}">${report.adminStatus}</span>
        </div>
        <div class="col-actions">
          <div class="action-group">
            ${actionButtons}
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
          if (confirm(`Tandai laporan #${id} sebagai ${action}?`)) {
            await ReportService.verifyReport(id, action, 'Verifikasi cepat dari Laporan logs.');
            this.loadData();
          }
        });
      });

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
