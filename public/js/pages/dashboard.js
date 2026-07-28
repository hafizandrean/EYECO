// dashboard.js - Kontroler Halaman Dashboard Pemantauan Lingkungan
import { StatsService } from '../services/statsService.js';
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { CONFIG } from '../core/config.js';
import { API } from '../services/api.js';
import { animateCounter, createScrollObserver } from '../utils/animations.js';


export class DashboardPage {
  constructor() {
    this.pollingTimer = null;
    this.stats = { total: 0, mostVulnerable: '-', valid: 0, cancelled: 0, pending: 0 };
    this.latestReports = [];
    this.searchQuery = '';
    this.filterTag = 'all';
    this.filterId = '';
    this.filterCamera = 'all';
    this.filterDate = '';
    this.filterStatus = 'all';
  }

  // Merender halaman dashboard utama
  async render(container) {
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';

    container.innerHTML = `
      <!-- 1. Command Center HUD -->
      <div class="cc-hud glass-card" id="command-center-hud">
        <div class="cc-hud-status">
          <span class="status-pulse-dot green" id="cc-hud-pulse"></span>
          <span id="brief-system-status"><i data-lucide="monitor" style="width:14px;height:14px;color:var(--success);"></i> MONITORING ACTIVE</span>
        </div>
        <div class="cc-hud-metrics">
          <div class="cc-hud-metric"><i data-lucide="video" style="width:14px;height:14px;"></i> <strong id="brief-online-count">0</strong> Cameras Online</div>
          <div class="cc-hud-metric"><i data-lucide="alert-circle" style="width:14px;height:14px;"></i> <strong id="brief-active-alerts">0</strong> Active Incidents</div>
          <div class="cc-hud-metric"><i data-lucide="clock" style="width:14px;height:14px;"></i> Last Detection: <strong id="brief-last-incident">—</strong></div>
        </div>
        <span class="cc-hud-date" id="brief-current-date">—</span>
      </div>

      <!-- 2. Stats summary cards & Validation chart (from laporan) -->
      <section class="stats-chart-layout">
        <!-- Stats cards -->
        <div class="stats-vertical-grid">
          <div class="glass-card stat-card glow-yellow">
            <div class="stat-icon-wrapper yellow"><i data-lucide="folder-open"></i></div>
            <div class="stat-info">
              <div class="stat-label">Total Laporan</div>
              <div class="stat-value" id="dashboard-stat-total">0</div>
            </div>
          </div>
          <div class="glass-card stat-card glow-blue">
            <div class="stat-icon-wrapper blue"><i data-lucide="map"></i></div>
            <div class="stat-info">
              <div class="stat-label">Titik Paling Rawan</div>
              <div class="stat-value" id="dashboard-stat-rawan">-</div>
            </div>
          </div>
          <div class="glass-card stat-card glow-green">
            <div class="stat-icon-wrapper green"><i data-lucide="check-square"></i></div>
            <div class="stat-info">
              <div class="stat-label">Validasi Selesai</div>
              <div class="stat-value" id="dashboard-stat-valid">0</div>
            </div>
          </div>
          <div class="glass-card stat-card glow-red">
            <div class="stat-icon-wrapper red"><i data-lucide="x-circle"></i></div>
            <div class="stat-info">
              <div class="stat-label">Dibatalkan</div>
              <div class="stat-value" id="dashboard-stat-cancelled">0</div>
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
              <span class="chart-value" id="dashboard-val-pending-count">0</span>
              <div class="chart-bar pending" id="dashboard-bar-pending" style="height: 0%;"></div>
              <span class="chart-label">Menunggu</span>
            </div>
            <div class="chart-bar-wrapper">
              <span class="chart-value" id="dashboard-val-valid-count">0</span>
              <div class="chart-bar valid" id="dashboard-bar-valid" style="height: 0%;"></div>
              <span class="chart-label">Valid</span>
            </div>
            <div class="chart-bar-wrapper">
              <span class="chart-value" id="dashboard-val-ignored-count">0</span>
              <div class="chart-bar ignored" id="dashboard-bar-ignored" style="height: 0%;"></div>
              <span class="chart-label">Dibatalkan</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 3. Primary Zone: Incident Queue (dominant) + Operational Summary -->
      <div class="command-center-primary">

        <!-- Active Incident Queue — largest component -->
        <div class="incident-queue-panel glass-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-16);">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 800; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
              <span class="status-pulse-dot red" style="width: 8px; height: 8px; background: var(--danger); border-radius: 50%;"></span>
              Active Incident Queue
            </h3>
            <span id="active-incidents-badge-count" style="font-size: 0.72rem; font-weight: 800; color: var(--danger); background: rgba(239, 68, 68, 0.08); padding: 4px 12px; border-radius: var(--radius-pill);">0 Queue</span>
          </div>

          <!-- Advanced Search & Filters -->
          <div class="incident-filter-row">
            <div style="position: relative;">
              <i data-lucide="search" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 13px; height: 13px; color: var(--text-secondary);"></i>
              <input type="text" id="incident-search-input" class="incident-filter-input" placeholder="Cari lokasi, kamera..." style="padding-left: 32px;" />
            </div>
            <input type="text" id="incident-filter-id" class="incident-filter-input" placeholder="ID (#0042)" />
            <select id="incident-filter-camera" class="incident-filter-input">
              <option value="all">Semua Kamera</option>
            </select>
            <input type="date" id="incident-filter-date" class="incident-filter-input" />
            <select id="incident-filter-status" class="incident-filter-input">
              <option value="all">Semua Status</option>
              <option value="waiting">Waiting Review</option>
              <option value="validated">Validated</option>
              <option value="assigned">Assigned</option>
              <option value="progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          <div class="filter-tabs" id="incident-filter-tabs" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: var(--space-16);">
            <button class="btn btn-sm btn-glass active" data-filter="all">All</button>
            <button class="btn btn-sm btn-glass" data-filter="waiting">Waiting</button>
            <button class="btn btn-sm btn-glass" data-filter="validated">Validated</button>
            <button class="btn btn-sm btn-glass" data-filter="progress">In Progress</button>
            <button class="btn btn-sm btn-glass" data-filter="resolved">Resolved</button>
          </div>

          <div id="dashboard-active-incidents-list" style="display: flex; flex-direction: column; gap: 10px;">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- Operational Summary Sidebar -->
        <aside class="operational-summary-panel glass-card">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.78rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0; letter-spacing: 0.5px;">Operational Summary</h4>

          <div class="ops-metric-grid">
            <div class="ops-metric-card">
              <div class="ops-metric-value" id="stat-waiting-review" style="color: var(--warning);">0</div>
              <div class="ops-metric-label">Waiting Review</div>
            </div>
            <div class="ops-metric-card">
              <div class="ops-metric-value" id="stat-assigned" style="color: var(--primary);">0</div>
              <div class="ops-metric-label">Assigned</div>
            </div>
            <div class="ops-metric-card">
              <div class="ops-metric-value" id="stat-in-progress" style="color: var(--info);">0</div>
              <div class="ops-metric-label">Officer On Site</div>
            </div>
            <div class="ops-metric-card">
              <div class="ops-metric-value" id="stat-resolved-today" style="color: var(--success);">0</div>
              <div class="ops-metric-label">Resolved Today</div>
            </div>
          </div>

          <div class="officer-live-panel">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.78rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0 0 8px 0; letter-spacing: 0.4px;">Officer Status</h4>
            <div id="officer-live-list">
              <div style="font-size: 0.78rem; color: var(--text-muted); padding: 6px 0;">Tidak ada petugas aktif.</div>
            </div>
          </div>

          <div style="border-top: 1px solid var(--border); padding-top: var(--space-12);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.75rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">System Status</span>
              <span id="stat-system-health-val" style="font-size: 0.82rem; font-weight: 800; color: var(--success);">Active</span>
            </div>
            <div class="progress-bar-flat" style="width: 100%; height: 5px; background: rgba(0,0,0,0.05); border-radius: 3px; overflow: hidden;">
              <div id="stat-system-health-bar" style="width: 100%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
            </div>
            <span id="stat-system-health-desc" style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-top: 4px; display: block;">System Online</span>
          </div>
        </aside>
      </div>
    `;

    this.bindEvents();
    
    // Skeleton loading simulation
    this.renderSkeletons();
    
    // Load initial data safely
    try {
      await this.loadData();
    } catch (err) {
      console.warn('[Dashboard] loadData inside render failed:', err);
    }

    // Start polling
    this.startPolling();
  }

  renderSkeletons() {
    const alerts = document.getElementById('dashboard-notif-list');
    if (alerts) {
      alerts.innerHTML = Array(3).fill(0).map(() => `
        <div style="font-size: 0.72rem; color: var(--text-secondary); padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,0.03);">
          <div class="skeleton skeleton-line" style="height: 10px; width: 80%; margin-bottom: 4px;"></div>
        </div>
      `).join('');
    }
  }

  bindEvents() {
    const searchInput = document.getElementById('incident-search-input');
    const filterIdInput = document.getElementById('incident-filter-id');
    const filterCameraSelect = document.getElementById('incident-filter-camera');
    const filterDateInput = document.getElementById('incident-filter-date');
    const filterStatusSelect = document.getElementById('incident-filter-status');
    const filterTabsContainer = document.getElementById('incident-filter-tabs');

    // Search Incident Queue Listener
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.animateStats();
      });
    }

    if (filterIdInput) {
      filterIdInput.addEventListener('input', (e) => {
        this.filterId = e.target.value.replace('#', '').trim();
        this.animateStats();
      });
    }

    if (filterCameraSelect) {
      filterCameraSelect.addEventListener('change', (e) => {
        this.filterCamera = e.target.value;
        this.animateStats();
      });
    }

    if (filterDateInput) {
      filterDateInput.addEventListener('change', (e) => {
        this.filterDate = e.target.value;
        this.animateStats();
      });
    }

    if (filterStatusSelect) {
      filterStatusSelect.addEventListener('change', (e) => {
        this.filterStatus = e.target.value;
        if (e.target.value !== 'all') {
          this.filterTag = e.target.value === 'assigned' ? 'validated' : e.target.value;
          filterTabsContainer?.querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-filter') === this.filterTag);
          });
        }
        this.animateStats();
      });
    }

    // Filter Incident Tabs Listeners
    if (filterTabsContainer) {
      const buttons = filterTabsContainer.querySelectorAll('button');
      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.filterTag = btn.getAttribute('data-filter');
          if (filterStatusSelect) filterStatusSelect.value = this.filterTag === 'all' ? 'all' : this.filterTag;
          this.animateStats();
        });
      });
    }
  }

  // Render stats & chart (adapted from laporan.js)
  renderStats() {
    const totalEl = document.getElementById('dashboard-stat-total');
    const rawanEl = document.getElementById('dashboard-stat-rawan');
    const validEl = document.getElementById('dashboard-stat-valid');
    const cancelledEl = document.getElementById('dashboard-stat-cancelled');

    const pendingCount = document.getElementById('dashboard-val-pending-count');
    const validCount = document.getElementById('dashboard-val-valid-count');
    const ignoredCount = document.getElementById('dashboard-val-ignored-count');

    const barPending = document.getElementById('dashboard-bar-pending');
    const barValid = document.getElementById('dashboard-bar-valid');
    const barIgnored = document.getElementById('dashboard-bar-ignored');

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
      // Animate counters
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

  async loadData() {
    // 1. Load Stats with fallback
    try {
      this.stats = await StatsService.getStats();
    } catch (err) {
      console.warn('[DashboardPage] StatsService.getStats failed, using fallback:', err);
      this.stats = { total: 0, mostVulnerable: '-', valid: 0, cancelled: 0, pending: 0 };
    }

    // 2. Load detections with fallback
    try {
      const detectionsData = await ReportService.getFilteredReports({ limit: 50 });
      this.latestReports = detectionsData?.reports || [];
    } catch (err) {
      console.warn('[DashboardPage] ReportService.getFilteredReports failed:', err);
      this.latestReports = [];
    }

    // 3. Update state notification
    const allNotificationItems = this.latestReports.map(r => {
      let title = '';
      let message = '';
      let level = 'info';
      
      if (r.adminStatus === 'VALID') {
        title = `Laporan #${r.id} Valid`;
        message = `Diverifikasi VALID oleh Admin di ${r.location}`;
        level = 'success';
      } else if (r.adminStatus === 'DIABAIKAN') {
        title = `Laporan #${r.id} Diabaikan`;
        message = `Ditandai DIABAIKAN di ${r.location}`;
        level = 'warning';
      } else if (r.aiStatus === 'TINGGI') {
        title = `Ancaman TINGGI di ${r.location}`;
        message = r.additionalNotes || 'Aktivitas sangat mencurigakan terdeteksi AI.';
        level = 'high';
      } else if (r.aiStatus === 'SEDANG') {
        title = `Ancaman SEDANG di ${r.location}`;
        message = r.additionalNotes || 'Aktivitas mencurigakan terdeteksi AI.';
        level = 'medium';
      } else if (r.aiStatus === 'RENDAH') {
        title = `Objek Terdeteksi di ${r.location}`;
        message = r.additionalNotes || 'Kamera mendeteksi objek dengan keyakinan rendah.';
        level = 'low';
      } else {
        title = `Kamera Aktif: ${r.location}`;
        message = `Objek terdeteksi di area pemantauan.`;
        level = 'info';
      }

      return {
        id: r.id,
        location: title,
        aiStatus: r.aiStatus,
        aiConfidence: r.aiConfidence,
        timestamp: r.timestamp,
        isCustom: true,
        level: level,
        message: message
      };
    });

    const currentNotifications = AppState.get('notifications') || [];
    const commentNotifs = currentNotifications.filter(n => n.isComment);
    const merged = [...commentNotifs, ...allNotificationItems].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    AppState.set('notifications', merged.slice(0, 20));

    // Render stats & incident queue
    this.renderStats();
    this.animateStats();
    this.renderLiveAlerts();
  }

  getPriorityScore(aiStatus) {
    return { TINGGI: 3, SEDANG: 2, RENDAH: 1 }[aiStatus] || 0;
  }

  getWaitingLabel(timestamp) {
    const mins = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
    if (mins < 1) return 'Baru saja';
    if (mins < 60) return `Waiting ${mins} min`;
    return `Waiting ${Math.floor(mins / 60)} jam`;
  }

  filterQueueReports(reports) {
    let queue = [...reports];

    if (this.searchQuery) {
      queue = queue.filter(r =>
        r.location.toLowerCase().includes(this.searchQuery) ||
        (r.boundingBoxes && r.boundingBoxes.some(b => b.label.toLowerCase().includes(this.searchQuery)))
      );
    }

    if (this.filterId) {
      queue = queue.filter(r => r.id && r.id.toString().includes(this.filterId.replace(/^0+/, '')));
    }

    if (this.filterCamera && this.filterCamera !== 'all') {
      queue = queue.filter(r =>
        r.location && r.location.toLowerCase().includes(this.filterCamera)
      );
    }

    if (this.filterDate) {
      queue = queue.filter(r => {
        const d = new Date(r.timestamp);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return iso === this.filterDate;
      });
    }

    const statusFilter = this.filterStatus !== 'all' ? this.filterStatus : this.filterTag;
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'waiting') {
        queue = queue.filter(r => r.adminStatus === 'MENUNGGU');
      } else if (statusFilter === 'validated') {
        queue = queue.filter(r => r.adminStatus === 'VALID' && !r.assignedOfficer);
      } else if (statusFilter === 'assigned') {
        queue = queue.filter(r => r.adminStatus === 'VALID' && r.assignedOfficer && r.status !== 'PROSES' && r.status !== 'SELESAI');
      } else if (statusFilter === 'progress') {
        queue = queue.filter(r => r.adminStatus === 'VALID' && r.status === 'PROSES');
      } else if (statusFilter === 'resolved') {
        queue = queue.filter(r => r.status === 'SELESAI');
      }
    }

    queue.sort((a, b) => {
      const prioDiff = this.getPriorityScore(b.aiStatus) - this.getPriorityScore(a.aiStatus);
      if (prioDiff !== 0) return prioDiff;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    return queue;
  }

  renderOfficerLivePanel(reports, isMon) {
    const container = document.getElementById('officer-live-list');
    if (!container) return;

    const active = isMon
      ? reports.filter(r => r.assignedOfficer && (r.status === 'PROSES' || (r.adminStatus === 'VALID' && r.status !== 'SELESAI')))
      : [];

    if (active.length === 0) {
      container.innerHTML = `<div style="font-size: 0.72rem; color: var(--text-muted); padding: 4px 0;">Tidak ada petugas aktif.</div>`;
      return;
    }

    container.innerHTML = active.slice(0, 4).map(r => {
      const onSite = r.status === 'PROSES';
      const dot = onSite ? '<i data-lucide="map-pin" style="width:12px;height:12px;color:var(--success);"></i>' : '<i data-lucide="circle" style="width:12px;height:12px;color:var(--primary);"></i>';
      const state = onSite ? 'On Site' : 'Assigned';
      const time = Formatter.formatTime(r.timestamp);
      return `
        <div class="officer-live-item">
          <span>${dot}</span>
          <div style="flex:1; min-width:0;">
            <strong style="color: var(--text-primary);">${r.assignedOfficer}</strong>
            <div style="color: var(--text-secondary); font-size: 0.68rem;">DLH · ${state} · #${String(r.id ?? '').padStart(4, '0')}</div>
          </div>
          <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700;">${time}</span>
        </div>
      `;
    }).join('');
  }

  animateStats() {
    const isMon = AppState.get('isMonitoring');

    // 1. Current Date
    const currentDateEl = document.getElementById('brief-current-date');
    if (currentDateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      currentDateEl.innerText = new Date().toLocaleDateString('id-ID', options);
    }

    // 2. HUD updates
    const activeAlerts = isMon ? this.latestReports.filter(r =>
      r.adminStatus === 'MENUNGGU' || (r.adminStatus === 'VALID' && r.status !== 'SELESAI')
    ).length : 0;

    const briefOnline = document.getElementById('brief-online-count');
    const briefAlerts = document.getElementById('brief-active-alerts');
    const briefSystem = document.getElementById('brief-system-status');
    const briefLast = document.getElementById('brief-last-incident');
    const hudPulse = document.getElementById('cc-hud-pulse');
    const hudCard = document.getElementById('command-center-hud');

    if (briefOnline) briefOnline.innerText = `${isMon ? this.latestReports.length : 0}`;
    if (briefAlerts) briefAlerts.innerText = `${activeAlerts}`;
    if (briefSystem) {
      briefSystem.innerHTML = isMon ? '<i data-lucide="monitor" style="width:14px;height:14px;color:var(--success);"></i> MONITORING ACTIVE' : '<i data-lucide="monitor-off" style="width:14px;height:14px;color:var(--danger);"></i> MONITORING INACTIVE';
    }
    if (hudPulse) {
      hudPulse.className = isMon ? 'status-pulse-dot green' : 'status-pulse-dot grey';
    }
    if (hudCard) {
      hudCard.style.opacity = isMon ? '1' : '0.85';
    }

    // Last Incident time
    let lastIncidentText = 'None';
    if (isMon && this.latestReports.length > 0) {
      const diffMs = new Date().getTime() - new Date(this.latestReports[0].timestamp).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) lastIncidentText = 'Baru saja';
      else if (diffMins < 60) lastIncidentText = `${diffMins} min ago`;
      else lastIncidentText = `${Math.floor(diffMins / 60)} hours ago`;
    }
    if (briefLast) briefLast.innerText = lastIncidentText;

    // System Status (replaces Camera Health)
    const sysValEl = document.getElementById('stat-system-health-val');
    const sysBarEl = document.getElementById('stat-system-health-bar');
    const sysDescEl = document.getElementById('stat-system-health-desc');

    if (sysValEl) sysValEl.innerText = isMon ? 'Active' : 'Standby';
    if (sysBarEl) {
      sysBarEl.style.width = isMon ? '100%' : '50%';
      sysBarEl.style.background = isMon ? 'var(--success)' : 'var(--text-muted)';
    }
    if (sysDescEl) {
      sysDescEl.innerText = isMon ? 'System Online' : 'Monitoring Paused';
    }

    // Filter & Render Active Incident Queue (priority sorted)
    const activeIncidentsList = document.getElementById('dashboard-active-incidents-list');
    const activeIncidentsBadge = document.getElementById('active-incidents-badge-count');

    const queueReports = this.filterQueueReports(this.latestReports);

    if (activeIncidentsBadge) {
      activeIncidentsBadge.innerText = `${queueReports.length} Queue`;
      activeIncidentsBadge.style.background = queueReports.length > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 197, 94, 0.08)';
      activeIncidentsBadge.style.color = queueReports.length > 0 ? 'var(--danger)' : 'var(--success)';
    }

    if (activeIncidentsList) {
      activeIncidentsList.innerHTML = '';
      if (!isMon) {
        activeIncidentsList.innerHTML = `
          <div style="font-size: 0.82rem; color: var(--text-muted); text-align: center; padding: var(--space-12);">
            Pemantauan dihentikan.
          </div>
        `;
      } else if (queueReports.length === 0) {
        activeIncidentsList.innerHTML = `
          <div style="font-size: 0.82rem; color: var(--text-secondary); text-align: center; padding: var(--space-12); display: flex; align-items: center; justify-content: center; gap: 6px;">
            <i data-lucide="check-circle" style="width: 14px; height: 14px; color: var(--success);"></i>
            Tidak ada insiden yang cocok dengan filter antrean.
          </div>
        `;
      } else {
        queueReports.forEach(r => {
          const item = document.createElement('div');
          const isHigh = r.aiStatus === 'TINGGI';
          const isMed = r.aiStatus === 'SEDANG';
          const priorityClass = isHigh ? 'incident-priority-high' : (isMed ? 'incident-priority-medium' : 'incident-priority-low');
          item.className = `incident-queue-item hover-lift ${priorityClass}`;
          
          const category = r.boundingBoxes && r.boundingBoxes[0] ? r.boundingBoxes[0].label : 'Sampah';
          const labelText = category === 'person' ? 'Pelaku membuang sampah' : `Illegal Dumping · ${category}`;
          
          const severityText = isHigh ? '<i data-lucide="flame" style="width:10px;height:10px;color:var(--danger);"></i> HIGH' : (isMed ? '<span style="display:inline-flex;align-items:center;gap:2px;"><i data-lucide="circle" style="width:8px;height:8px;color:var(--warning);fill:var(--warning);"></i> MEDIUM</span>' : '<span style="display:inline-flex;align-items:center;gap:2px;"><i data-lucide="circle" style="width:8px;height:8px;color:var(--info);fill:var(--info);"></i> LOW</span>');
          const severityColor = isHigh ? 'var(--danger)' : (isMed ? 'var(--warning)' : 'var(--info)');

          let workflowState = 'WAITING';
          let workflowColor = 'var(--warning)';
          if (r.adminStatus === 'VALID') {
            if (r.status === 'SELESAI') {
              workflowState = 'RESOLVED';
              workflowColor = 'var(--success)';
            } else if (r.status === 'PROSES') {
              workflowState = 'IN PROGRESS';
              workflowColor = 'var(--info)';
            } else if (r.assignedOfficer) {
              workflowState = 'ASSIGNED';
              workflowColor = 'var(--primary)';
            } else {
              workflowState = 'VALIDATED';
              workflowColor = 'var(--primary)';
            }
          } else if (r.adminStatus === 'DIABAIKAN') {
            workflowState = 'FALSE POSITIVE';
            workflowColor = 'var(--text-muted)';
          }

          const waitingLabel = r.adminStatus === 'MENUNGGU' ? this.getWaitingLabel(r.timestamp) : '';
          let officerHtml = '';
          if (r.assignedOfficer) {
            if (r.status === 'PROSES') {
              officerHtml = `<span class="officer-status-chip on-site"><i data-lucide="map-pin" style="width:12px;height:12px;color:var(--success);"></i> ${r.assignedOfficer} · Cleaning · ${Formatter.formatTime(r.timestamp)}</span>`;
            } else if (r.status === 'SELESAI') {
              officerHtml = `<span class="officer-status-chip done"><i data-lucide="check" style="width:12px;height:12px;color:var(--success);"></i> ${r.assignedOfficer} · Selesai</span>`;
            } else {
              officerHtml = `<span class="officer-status-chip assigned"><i data-lucide="briefcase" style="width:12px;height:12px;color:var(--primary);"></i> DLH · ${r.assignedOfficer} · Assigned</span>`;
            }
          }

          const isVideoImage = r.image && r.image.endsWith('.mp4');
          const thumbnailHtml = isVideoImage
            ? `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--surface-soft); color: var(--text-muted);"><i data-lucide="video" style="width: 20px; height: 20px;"></i></div>`
            : `<img src="${r.image}" style="width:100%; height:100%; object-fit:cover;" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div style="display:none; width: 100%; height: 100%; align-items: center; justify-content: center; background: var(--surface-soft); color: var(--text-muted);"><i data-lucide="image" style="width: 20px; height: 20px;"></i></div>`;

          item.innerHTML = `
            <div style="width: 52px; height: 52px; border-radius: 10px; overflow:hidden; flex-shrink:0; background:var(--surface-variant); border: 1.5px solid var(--border); display:flex; align-items:center; justify-content:center; position:relative;">
              ${thumbnailHtml}
            </div>
            <div style="min-width: 0; flex: 1;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-size: 0.6rem; font-weight: 900; color: ${severityColor};">${severityText}</span>
                <span style="font-size: 0.55rem; font-weight: 900; background: ${workflowColor}12; color: ${workflowColor}; border: 1px solid ${workflowColor}22; padding: 1px 6px; border-radius: 4px;">${workflowState}</span>
                <strong style="font-size:0.88rem; color:var(--text-primary);">${labelText}</strong>
                <span style="font-size: 0.68rem; font-weight: 700; color: var(--primary);">AI ${r.aiConfidence}%</span>
                ${waitingLabel ? `<span class="waiting-time-chip">${waitingLabel}</span>` : ''}
              </div>
              <div style="font-size:0.74rem; color:var(--text-secondary); margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <span><i data-lucide="map-pin" style="width:11px;height:11px;display:inline-block;vertical-align:middle;"></i> ${r.location}</span>
                <span style="color:var(--text-muted);">·</span>
                <span>${Formatter.formatTime(r.timestamp)}</span>
                <span style="color:var(--text-muted);">·</span>
                <span style="font-weight:600; color:var(--text-secondary);">#${String(r.id ?? '').padStart(4, '0')}</span>
              </div>
              ${officerHtml}
            </div>
            <button class="btn btn-sm btn-glass btn-open-incident" style="margin-left: auto; border-color: rgba(47, 107, 255, 0.25); color: var(--primary); padding: 8px 18px; font-size:0.7rem; font-weight:800; flex-shrink:0; white-space:nowrap;">
              Open Incident
            </button>
          `;
          
          item.onclick = () => Router.navigate(`/dashboard/detections/${r.id}`);
          const btnOpenInc = item.querySelector('.btn-open-incident');
          if (btnOpenInc) {
            btnOpenInc.onclick = (e) => {
              e.stopPropagation();
              Router.navigate(`/dashboard/detections/${r.id}`);
            };
          }
          activeIncidentsList.appendChild(item);
        });
      }
    }

    // Operational Summary metrics
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const statWaiting = document.getElementById('stat-waiting-review');
    const statAssigned = document.getElementById('stat-assigned');
    const statInProgress = document.getElementById('stat-in-progress');
    const statResolvedToday = document.getElementById('stat-resolved-today');

    if (statWaiting) statWaiting.innerText = isMon ? this.latestReports.filter(r => r.adminStatus === 'MENUNGGU').length : 0;
    if (statAssigned) statAssigned.innerText = isMon ? this.latestReports.filter(r => r.adminStatus === 'VALID' && r.assignedOfficer && r.status !== 'PROSES' && r.status !== 'SELESAI').length : 0;
    if (statInProgress) statInProgress.innerText = isMon ? this.latestReports.filter(r => r.status === 'PROSES').length : 0;
    if (statResolvedToday) statResolvedToday.innerText = isMon ? this.latestReports.filter(r => r.status === 'SELESAI' && new Date(r.timestamp) >= todayStart).length : 0;

    this.renderOfficerLivePanel(this.latestReports, isMon);
    if (window.lucide) window.lucide.createIcons();
  }

  // Populate compact notification popover (New Incident, Officer Finished)
  renderLiveAlerts() {
    const container = document.getElementById('dashboard-notif-list');
    const badge = document.getElementById('notif-badge-count');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');
    const alerts = [];

    if (isMon) {
      this.latestReports.filter(r => r.adminStatus === 'MENUNGGU').slice(0, 3).forEach(r => {
        alerts.push({
          icon: '<i data-lucide="bell-alert" style="width:14px;height:14px;color:var(--warning);"></i>',
          color: 'var(--warning)',
          title: 'New Incident',
          desc: `#${String(r.id ?? '').padStart(4, '0')} · ${r.location} · AI ${r.aiConfidence}%`,
          id: r.id,
          type: 'incident'
        });
      });

      this.latestReports.filter(r => r.status === 'SELESAI').slice(0, 2).forEach(r => {
        alerts.push({
          icon: '<i data-lucide="check-circle" style="width:14px;height:14px;color:var(--success);"></i>',
          color: 'var(--success)',
          title: 'Officer Finished',
          desc: `Kasus #${String(r.id ?? '').padStart(4, '0')} selesai ditangani${r.assignedOfficer ? ` · ${r.assignedOfficer}` : ''}.`,
          id: r.id,
          type: 'incident'
        });
      });
    }

    if (badge) {
      badge.innerText = alerts.length;
      badge.style.display = alerts.length > 0 ? 'flex' : 'none';
    }

    if (alerts.length === 0) {
      container.innerHTML = `<div style="font-size: 0.72rem; color: var(--text-muted); padding: 8px 0;">Tidak ada peringatan aktif.</div>`;
      return;
    }

    alerts.slice(0, 5).forEach(a => {
      const row = document.createElement('div');
      row.style.cssText = 'font-size: 0.72rem; color: var(--text-secondary); border-bottom: 1px solid rgba(0,0,0,0.04); padding: var(--space-8); margin-bottom: 4px; cursor: pointer; transition: background 0.15s; border-radius: var(--radius-button);';
      
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(0, 0, 0, 0.03)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });

      row.innerHTML = `
        <strong style="color: ${a.color};">${a.icon} ${a.title}</strong>
        <div style="margin-top: 2px; font-size: 0.68rem;">${a.desc}</div>
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const notifPopover = document.getElementById('dashboard-notif-popover');
        if (notifPopover) notifPopover.style.display = 'none';
        if (a.type === 'incident') {
          Router.navigate(`/dashboard/detections/${a.id}`);
        }
      });

      container.appendChild(row);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  renderError(err) {
    const container = document.getElementById('dashboard-active-incidents-list');
    if (!container) return;

    const isAuthError = err && (err.message === 'UNAUTHORIZED' || (typeof err.message === 'string' && (err.message.includes('Belum masuk') || err.message.includes('401'))));

    if (isAuthError) {
      container.innerHTML = `
        <div class="glass-card error-alert-card" style="padding: 36px; text-align: center; background: rgba(15, 23, 42, 0.03); border: 1px dashed rgba(239, 68, 68, 0.4);">
          <i data-lucide="log-in" style="width: 52px; height: 52px; color: var(--primary); margin-bottom: 12px;"></i>
          <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary);">Sesi Belum Masuk / Telah Berakhir</h3>
          <p style="color: var(--text-secondary); margin: 8px auto 18px auto; max-width: 480px; font-size: 0.88rem;">Anda belum melakukan autentikasi ke sistem EYECO.</p>
          <a href="/login" class="btn btn-primary btn-rounded" style="padding: 8px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;">
            <i data-lucide="log-in" style="width: 16px; height: 16px;"></i> Masuk ke Akun
          </a>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="glass-card error-alert-card" style="padding: 32px; text-align: center;">
          <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Koneksi Data Gagal</h3>
          <p style="color: var(--text-secondary); margin: 8px 0 16px 0;">Gagal memuat data dashboard dari server.</p>
          <button id="btn-retry-dashboard" class="btn btn-primary btn-rounded">
            <i data-lucide="refresh-cw"></i> Coba Lagi
          </button>
        </div>
      `;

      const btnRetry = document.getElementById('btn-retry-dashboard');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => this.loadData());
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  // Start 10s polling interval loop
  startPolling() {
    this.pollingTimer = setInterval(() => {
      this.loadData();
    }, CONFIG.POLLING_INTERVAL);
  }

  // Destructor called when page changes
  destroy() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}
export const Dashboard = new DashboardPage();
