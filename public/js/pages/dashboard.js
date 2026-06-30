// dashboard.js - Kontroler Halaman Dashboard Pemantauan Sungai
import { StatsService } from '../services/statsService.js';
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { CONFIG } from '../core/config.js';

export class DashboardPage {
  constructor() {
    this.pollingTimer = null;
    this.stats = { total: 0, mostVulnerable: '-', valid: 0, cancelled: 0, pending: 0 };
    this.latestReports = [];
  }

  // Merender halaman dashboard utama
  async render(container) {
    container.innerHTML = `
      <!-- Subheader Control Panel -->
      <section class="glass-card control-panel-card">
        <div class="control-left">
          <div class="form-group-inline">
            <label for="cctv-select-camera" class="caption-label">Saluran Aktif</label>
            <select id="cctv-select-camera" class="filter-control select-rounded">
              <option value="semua">Semua Saluran (8 CCTV)</option>
              <option value="1">Kamera 01 - Jembatan Merah</option>
              <option value="2">Kamera 02 - Sektor 7 Hulu</option>
              <option value="3">Kamera 03 - Pintu Air Manggarai</option>
              <option value="4">Kamera 04 - Aliran Kampung Melayu</option>
              <option value="5">Kamera 05 - Bendungan Katulampa</option>
              <option value="6">Kamera 06 - Kali Ciliwung Depok</option>
              <option value="7">Kamera 07 - Pintu Air Karet</option>
              <option value="8">Kamera 08 - Sektor 12 Hilir</option>
            </select>
          </div>
        </div>
        <div class="control-right">
          <div class="toggle-wrapper">
            <span class="caption-label">Telegram Alerts</span>
            <label class="switch">
              <input type="checkbox" id="toggle-telegram-alerts" ${AppState.get('telegramAlerts') ? 'checked' : ''}>
              <span class="slider round"></span>
            </label>
          </div>
          <button id="btn-toggle-monitoring" class="btn ${AppState.get('isMonitoring') ? 'btn-danger' : 'btn-primary'} btn-rounded">
            <i data-lucide="${AppState.get('isMonitoring') ? 'video-off' : 'video'}"></i>
            <span id="btn-monitoring-text">${AppState.get('isMonitoring') ? 'Hentikan Pemantauan' : 'Mulai Pemantauan'}</span>
          </button>
        </div>
      </section>

      <!-- Stats Grid -->
      <section class="stats-grid" id="dashboard-stats-grid">
        <div class="glass-card stat-card glow-blue">
          <div class="stat-icon-wrapper blue">
            <i data-lucide="video"></i>
          </div>
          <div class="stat-info">
            <div class="stat-label">Total Kamera Aktif</div>
            <div class="stat-value" id="stat-cameras-active">0</div>
            <div class="stat-subtext">8 Saluran Terhubung</div>
          </div>
        </div>
        <div class="glass-card stat-card glow-amber">
          <div class="stat-icon-wrapper amber">
            <i data-lucide="alert-triangle"></i>
          </div>
          <div class="stat-info">
            <div class="stat-label">Peringatan Hari Ini</div>
            <div class="stat-value" id="stat-alerts-today">0</div>
            <div class="stat-subtext" id="stat-alerts-active-subtext">0 aktif</div>
          </div>
        </div>
        <div class="glass-card stat-card glow-teal">
          <div class="stat-icon-wrapper teal">
            <i data-lucide="users"></i>
          </div>
          <div class="stat-info">
            <div class="stat-label">Orang Terdeteksi</div>
            <div class="stat-value" id="stat-people-count">0</div>
            <div class="stat-subtext">Denyut Ketinggian Normal</div>
          </div>
        </div>
        <div class="glass-card stat-card glow-emerald">
          <div class="stat-icon-wrapper emerald">
            <i data-lucide="activity"></i>
          </div>
          <div class="stat-info">
            <div class="stat-label">Status Sistem</div>
            <div class="stat-value text-success" id="stat-system-status">Online</div>
            <div class="stat-subtext">Semua Sistem Stabil</div>
          </div>
        </div>
      </section>

      <!-- Main Layout CCTV & Alerts -->
      <div class="dashboard-layout">
        <div class="dashboard-left">
          <!-- CCTV Grid -->
          <div class="cctv-header-row">
            <div class="section-title"><i data-lucide="layout-grid"></i> Pemantauan Sungai Real-Time</div>
            <div class="cctv-status-indicator">
              <span class="status-pulse-dot green" id="cctv-pulse-dot"></span>
              <span class="caption-label" id="cctv-status-text">LIVE STREAMING</span>
            </div>
          </div>
          <div class="cctv-grid" id="cctv-grid-container">
            <!-- CCTV Cards populated by JS -->
          </div>

          <!-- Recent Activity Widget -->
          <div class="glass-card recent-activity-card" style="margin-top: 28px;">
            <div class="card-header-clean">
              <div class="section-title"><i data-lucide="history"></i> Aktivitas Terbaru Hari Ini</div>
            </div>
            <div class="timeline" id="recent-activity-timeline">
              <!-- Timeline items populated by JS -->
            </div>
          </div>
        </div>

        <!-- Sidebar Live Alerts -->
        <aside class="dashboard-sidebar">
          <div class="glass-card sidebar-alerts-card">
            <div class="section-title" style="margin-bottom: 20px;"><i data-lucide="bell-ring" class="text-danger"></i> Live Alerts</div>
            <div class="sidebar-alerts-list" id="sidebar-alerts-list-container">
              <!-- Alerts populated by JS -->
            </div>
          </div>
        </aside>
      </div>
    `;

    this.bindEvents();
    
    // Skeleton loading simulation
    this.renderSkeletons();
    
    // Load initial data
    await this.loadData();

    // Start polling
    this.startPolling();
  }

  renderSkeletons() {
    const grid = document.getElementById('cctv-grid-container');
    if (grid) {
      grid.innerHTML = Array(8).fill(0).map(() => `
        <div class="cctv-card skeleton-cctv">
          <div class="skeleton skeleton-media"></div>
          <div class="skeleton-info">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-tag"></div>
          </div>
        </div>
      `).join('');
    }

    const timeline = document.getElementById('recent-activity-timeline');
    if (timeline) {
      timeline.innerHTML = Array(3).fill(0).map(() => `
        <div class="timeline-item skeleton-timeline">
          <div class="skeleton skeleton-circle"></div>
          <div class="skeleton-text-group">
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line-short"></div>
          </div>
        </div>
      `).join('');
    }

    const alerts = document.getElementById('sidebar-alerts-list-container');
    if (alerts) {
      alerts.innerHTML = Array(3).fill(0).map(() => `
        <div class="alert-item-card skeleton-alert">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line-short"></div>
        </div>
      `).join('');
    }
  }

  bindEvents() {
    const selectCam = document.getElementById('cctv-select-camera');
    const toggleTelegram = document.getElementById('toggle-telegram-alerts');
    const toggleMonitoring = document.getElementById('btn-toggle-monitoring');

    if (selectCam) {
      selectCam.addEventListener('change', () => this.filterCCTVChannels(selectCam.value));
    }

    if (toggleTelegram) {
      toggleTelegram.addEventListener('change', () => {
        AppState.set('telegramAlerts', toggleTelegram.checked);
      });
    }

    if (toggleMonitoring) {
      toggleMonitoring.addEventListener('click', () => {
        const isMonitoring = AppState.get('isMonitoring');
        AppState.set('isMonitoring', !isMonitoring);

        // Update button visual
        toggleMonitoring.className = `btn ${!isMonitoring ? 'btn-danger' : 'btn-primary'} btn-rounded`;
        toggleMonitoring.innerHTML = `
          <i data-lucide="${!isMonitoring ? 'video-off' : 'video'}"></i>
          <span id="btn-monitoring-text">${!isMonitoring ? 'Hentikan Pemantauan' : 'Mulai Pemantauan'}</span>
        `;
        
        // Trigger CCTV static screen
        this.updateCCTVMonitoringState(!isMonitoring);
        
        if (window.lucide) window.lucide.createIcons();
      });
    }
  }

  async loadData() {
    try {
      // Load Stats
      const stats = await StatsService.getStats();
      this.stats = stats;
      
      // Load detections
      const detectionsData = await ReportService.getFilteredReports({ limit: 50 });
      this.latestReports = detectionsData.reports || [];
      
      // Update state notification
      const highAlerts = this.latestReports.filter(r => r.aiStatus === 'TINGGI' || r.aiStatus === 'SEDANG');
      AppState.set('notifications', highAlerts);
      
      // Render
      this.animateStats();
      this.renderCCTVGrid();
      this.renderRecentActivity();
      this.renderLiveAlerts();
    } catch (err) {
      this.renderError();
    }
  }

  animateStats() {
    const activeCamsEl = document.getElementById('stat-cameras-active');
    const alertsTodayEl = document.getElementById('stat-alerts-today');
    const alertsActiveSub = document.getElementById('stat-alerts-active-subtext');
    const peopleCountEl = document.getElementById('stat-people-count');
    const systemStatusEl = document.getElementById('stat-system-status');

    const isMon = AppState.get('isMonitoring');

    if (activeCamsEl) activeCamsEl.innerText = isMon ? '8 Kamera' : '0 Kamera';
    if (alertsTodayEl) alertsTodayEl.innerText = this.stats.total;
    if (alertsActiveSub) alertsActiveSub.innerText = `${this.stats.pending} aktif`;
    
    // Count people currently in YOLO detections
    let totalPeople = 0;
    if (isMon) {
      this.latestReports.slice(0, 8).forEach(r => {
        if (r.boundingBoxes) {
          totalPeople += r.boundingBoxes.filter(b => b.label === 'person').length;
        }
      });
    }
    if (peopleCountEl) peopleCountEl.innerText = `${totalPeople || 0} Orang`;
    if (systemStatusEl) {
      systemStatusEl.innerText = isMon ? 'Online' : 'Offline';
      systemStatusEl.className = isMon ? 'stat-value text-success' : 'stat-value text-muted';
    }
  }

  // Render Grid CCTV 8 Saluran
  renderCCTVGrid() {
    const container = document.getElementById('cctv-grid-container');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');
    const channels = [
      { id: 1, name: 'Jembatan Merah', type: 'Gambar' },
      { id: 2, name: 'Sektor 7 Hulu', type: 'Live Stream' },
      { id: 3, name: 'Pintu Air Manggarai', type: 'Live Stream' },
      { id: 4, name: 'Aliran Kampung Melayu', type: 'Video' },
      { id: 5, name: 'Bendungan Katulampa', type: 'Gambar' },
      { id: 6, name: 'Kali Ciliwung Depok', type: 'Gambar' },
      { id: 7, name: 'Pintu Air Karet', type: 'Live Stream' },
      { id: 8, name: 'Sektor 12 Hilir', type: 'Video' }
    ];

    channels.forEach(ch => {
      // Find matching report from DB for this location, if any, to render dynamically!
      // If not, map to default detection images.
      const matchReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
      const imageSrc = matchReport ? matchReport.image : `/uploads/detection_${ch.id}.jpg`;
      const isAlert = matchReport ? (matchReport.aiStatus === 'TINGGI' || matchReport.aiStatus === 'SEDANG') : false;
      
      const card = document.createElement('div');
      card.className = `cctv-card glass-card ${isAlert ? 'cctv-card-alert' : ''}`;
      card.setAttribute('data-channel-id', ch.id);

      let boundingBoxesHtml = '';
      if (isMon && matchReport && matchReport.boundingBoxes) {
        matchReport.boundingBoxes.forEach(box => {
          let boxColorClass = 'yolo-default';
          if (box.label === 'person') boxColorClass = 'yolo-person';
          if (box.label === 'trash') boxColorClass = 'yolo-trash';
          if (box.label === 'boat') boxColorClass = 'yolo-boat';

          boundingBoxesHtml += `
            <div class="yolo-preview-box ${boxColorClass}" style="
              top: ${box.y}%; 
              left: ${box.x}%; 
              width: ${box.w}%; 
              height: ${box.h}%;
            ">
              <span class="yolo-preview-label">${box.label}</span>
            </div>
          `;
        });
      }

      card.innerHTML = `
        <div class="cctv-media-container">
          ${isMon ? `
            <img src="${imageSrc}" alt="Kamera ${ch.name}" class="cctv-feed-img" loading="lazy" decoding="async">
            <div class="cctv-overlay-gradient"></div>
            ${boundingBoxesHtml}
            <div class="cctv-hud-header">
              <span class="cctv-rec-pill"><span class="rec-dot"></span>REC</span>
              <span class="cctv-fps-badge">24 FPS</span>
            </div>
            <div class="cctv-hud-footer">
              <span class="cctv-ch-badge">CH 0${ch.id}</span>
              <span class="cctv-loc-name">${ch.name}</span>
            </div>
          ` : `
            <div class="cctv-static-screen">
              <div class="static-noise"></div>
              <div class="static-label">OFFLINE</div>
            </div>
          `}
        </div>
        <div class="cctv-info-row">
          <span class="cctv-status-badge ${isMon ? (isAlert ? 'status-alert' : 'status-live') : 'status-offline'}">
            <span class="status-dot"></span>
            ${isMon ? (isAlert ? 'WARNING' : 'LIVE') : 'OFFLINE'}
          </span>
          <span class="cctv-type-text">${ch.type}</span>
        </div>
      `;

      // Zoom view on click
      card.addEventListener('click', () => {
        if (matchReport) {
          Router.navigate(`/dashboard/detections/${matchReport.id}`);
        } else {
          EventBus.emit('toast:show', { message: `Kamera 0${ch.id} Jaringan normal. Tidak ada insiden aktif.`, type: 'info' });
        }
      });

      container.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // Filter CCTV Channels based on dropdown choice
  filterCCTVChannels(value) {
    const cards = document.querySelectorAll('.cctv-card');
    cards.forEach(card => {
      const chId = card.getAttribute('data-channel-id');
      if (value === 'semua' || chId === value) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  // Turn monitoring on/off
  updateCCTVMonitoringState(isMon) {
    this.animateStats();
    this.renderCCTVGrid();
    
    // Toggle Live pulse dot on subheader
    const pulseDot = document.getElementById('cctv-pulse-dot');
    const statusText = document.getElementById('cctv-status-text');
    if (pulseDot && statusText) {
      if (isMon) {
        pulseDot.className = 'status-pulse-dot green';
        statusText.innerText = 'LIVE STREAMING';
      } else {
        pulseDot.className = 'status-pulse-dot grey';
        statusText.innerText = 'PEMANTAUAN NONAKTIF';
      }
    }
  }

  // Render recent activity timeline
  renderRecentActivity() {
    const container = document.getElementById('recent-activity-timeline');
    if (!container) return;

    container.innerHTML = '';
    
    // Get latest reports or mock if empty
    if (this.latestReports.length === 0) {
      container.innerHTML = `<div class="empty-timeline">Belum ada aktivitas terekam.</div>`;
      return;
    }

    // Populate timeline items
    const itemsToShow = this.latestReports.slice(0, 4);
    itemsToShow.forEach((report, index) => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      
      let icon = 'eye';
      let iconClass = 'blue';
      let titleText = `Kamera mendeteksi objek di ${report.location}`;

      if (report.aiStatus === 'TINGGI' || report.aiStatus === 'SEDANG') {
        icon = 'alert-octagon';
        iconClass = 'red';
        titleText = `Alarm Ancaman ${report.aiStatus} di ${report.location}`;
      } else if (report.adminStatus === 'VALID') {
        icon = 'check-check';
        iconClass = 'green';
        titleText = `Laporan #${report.id} diverifikasi VALID oleh Admin`;
      }

      item.innerHTML = `
        <div class="timeline-badge ${iconClass}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-title">${titleText}</span>
            <span class="timeline-time">${Formatter.formatTime(report.timestamp)}</span>
          </div>
          <p class="timeline-desc">${report.additionalNotes || 'Analisis AI selesai.'}</p>
        </div>
      `;
      container.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // Render Sidebar Live Alerts panel
  renderLiveAlerts() {
    const container = document.getElementById('sidebar-alerts-list-container');
    if (!container) return;

    container.innerHTML = '';
    
    // Get reports that have High/Medium AI status
    const alerts = this.latestReports.filter(r => r.aiStatus === 'TINGGI' || r.aiStatus === 'SEDANG');

    if (alerts.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="padding: 24px; text-align: center; color: var(--text-muted);">
          <i data-lucide="shield-check" style="width: 32px; height: 32px; margin-bottom: 8px; color: var(--success);"></i>
          <p>Kondisi Sungai Aman</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    alerts.slice(0, 5).forEach((alert, index) => {
      const card = document.createElement('div');
      
      let levelClass = 'medium';
      if (alert.aiStatus === 'TINGGI') levelClass = 'high';
      
      card.className = `alert-item-card glow-${levelClass === 'high' ? 'red' : 'amber'}`;
      card.innerHTML = `
        <div class="alert-card-header">
          <span class="alert-badge-red">${alert.aiStatus}</span>
          ${index === 0 ? '<span class="pulse-new-badge">NEW</span>' : ''}
        </div>
        <div class="alert-card-body">
          <div class="alert-location"><i data-lucide="map-pin"></i> ${alert.location}</div>
          <div class="alert-info-row">
            <span>Keyakinan AI: <strong>${alert.aiConfidence || 0}%</strong></span>
            <span>${Formatter.formatTime(alert.timestamp)}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        Router.navigate(`/dashboard/detections/${alert.id}`);
      });

      container.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  renderError() {
    const container = document.getElementById('cctv-grid-container');
    if (container) {
      container.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 32px; text-align: center;">
          <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Koneksi Data Gagal</h3>
          <p style="color: var(--text-secondary); margin: 8px 0 16px 0;">Gagal memuat status dan deteksi CCTV sungai dari server.</p>
          <button id="btn-retry-dashboard" class="btn btn-primary btn-rounded">
            <i data-lucide="refresh-cw"></i> Coba Lagi
          </button>
        </div>
      `;

      const btnRetry = document.getElementById('btn-retry-dashboard');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => this.loadData());
      }

      if (window.lucide) window.lucide.createIcons();
    }
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
