// dashboard.js - Kontroler Halaman Dashboard Pemantauan Sungai
import { StatsService } from '../services/statsService.js';
import { ReportService } from '../services/reportService.js';
import { CctvService } from '../services/cctvService.js';
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
    this.cctvList = [];
    this.lastSeenReportId = null;
  }

  // Merender halaman dashboard utama
  async render(container) {
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';

    container.innerHTML = `
      <!-- Subheader Control Panel -->
      <section class="glass-card control-panel-card">
        <div class="control-left">
          <div class="form-group-inline">
            <label for="cctv-select-camera" class="caption-label">Saluran Aktif</label>
            <select id="cctv-select-camera" class="filter-control select-rounded">
              <option value="semua">Semua Saluran</option>
            </select>
          </div>
        </div>
        <div class="control-right">
          ${isAdmin ? `
            <button id="btn-connect-cctv" class="btn btn-glass btn-rounded" style="border-color: rgba(59, 130, 246, 0.4); color: var(--primary);">
              <i data-lucide="plus-circle"></i> Hubungkan CCTV
            </button>
          ` : ''}
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
            <div class="stat-value" id="stat-cameras-active">0 Kamera</div>
            <div class="stat-subtext" id="stat-cameras-subtext">0 Saluran Terhubung</div>
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
            <div class="stat-value" id="stat-people-count">0 Orang</div>
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

      <!-- Connect CCTV Modal Overlay -->
      <div id="connect-cctv-modal" class="modal-overlay" style="display: none;">
        <div class="glass-card modal-container" style="max-width: 550px;">
          <div class="modal-header">
            <h3><i data-lucide="plus-circle"></i> Hubungkan CCTV Baru</h3>
            <button class="btn-close-modal" id="btn-close-cctv-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="connect-cctv-form">
              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Nama CCTV</label>
                  <input type="text" id="cctv-input-name" class="filter-control input-rounded" value="CCTV Jembatan Utama Sektor 1" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Lokasi Pemantauan</label>
                  <input type="text" id="cctv-input-location" class="filter-control input-rounded" value="Sungai Ciliwangi" required>
                </div>
              </div>
              
              <div class="form-group">
                <label class="form-label">Deskripsi (Opsional)</label>
                <textarea id="cctv-input-description" class="filter-control input-rounded" placeholder="Keterangan mengenai cakupan kamera..." rows="2"></textarea>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Vendor / Brand</label>
                  <select id="cctv-input-vendor" class="filter-control select-rounded">
                    <option value="GENERIC">Generic IP Cam</option>
                    <option value="KRISBOW" selected>Krisbow Sync</option>
                    <option value="HIKVISION">Hikvision</option>
                    <option value="DAHUA">Dahua</option>
                    <option value="EZVIZ">Ezviz</option>
                    <option value="CUSTOM">Lainnya (Kustom)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">IP Address / Host</label>
                  <input type="text" id="cctv-input-host" class="filter-control input-rounded" value="127.0.0.1" required>
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Port Kamera</label>
                  <input type="number" id="cctv-input-port" class="filter-control input-rounded" value="554" placeholder="Auto (e.g. 554, 80)">
                </div>
                <div class="form-group">
                  <label class="form-label">Mode Koneksi (Protokol)</label>
                  <select id="cctv-input-mode" class="filter-control select-rounded">
                    <option value="AUTO" selected>Auto Detect (Rekomendasi)</option>
                    <option value="RTSP">RTSP (MediaMTX transcode)</option>
                    <option value="HLS">HLS (Direct stream)</option>
                    <option value="MJPEG">MJPEG Stream</option>
                    <option value="SNAPSHOT">SNAPSHOT (1 FPS Refresh)</option>
                    <option value="CLOUD_VIEWER">CLOUD (Krisbow App Fallback)</option>
                  </select>
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Username Kamera (Opsional)</label>
                  <input type="text" id="cctv-input-username" class="filter-control input-rounded" value="admin">
                </div>
                <div class="form-group">
                  <label class="form-label">Password Kamera (Opsional)</label>
                  <input type="password" id="cctv-input-password" class="filter-control input-rounded" value="admin123">
                </div>
              </div>

              <!-- Discovery Scanner HUD -->
              <div class="scanner-hud-box" style="display: none;">
                <div class="scanner-title">
                  <span class="pulse-dot"></span> Diagnostik Pemindaian CCTV...
                </div>
                <ul class="scanner-steps-list" id="scanner-steps-list">
                  <!-- JS dynamically appends scanner stages -->
                </ul>
                <div class="scanner-capabilities-hud" id="scanner-capabilities-hud" style="display: none;">
                  <!-- Capabilities matrix -->
                </div>
              </div>

              <div class="modal-actions-row" style="margin-top: 20px;">
                <button type="button" class="btn btn-glass btn-rounded" id="btn-scan-cctv" style="width: 48%; border-color: var(--primary); color: var(--primary);">
                  <i data-lucide="activity"></i> Scan & Deteksi
                </button>
                <button type="submit" class="btn btn-primary btn-rounded" id="btn-save-cctv" style="width: 48%;" disabled>
                  <i data-lucide="save"></i> Hubungkan CCTV
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- CCTV Fullscreen VMS View (Image 2 style) -->
      <div id="vms-fullscreen-page" class="vms-fullscreen-view" style="display: none;">
        <!-- Header -->
        <div class="vms-fs-header">
          <div class="vms-fs-header-left">
            <button class="vms-fs-btn-back" id="btn-close-vms-fs">
              <i data-lucide="chevron-left"></i>
            </button>
            <span class="vms-fs-cam-title" id="vms-fs-cam-title">JALAN TERAS SAMPING</span>
          </div>
          <div class="vms-fs-header-right">
            <button class="vms-fs-icon-btn"><i data-lucide="video"></i></button>
            <button class="vms-fs-icon-btn"><i data-lucide="more-horizontal"></i></button>
          </div>
        </div>

        <!-- Video Player Section -->
        <div class="vms-fs-video-section">
          <div class="vms-fs-player-wrapper" id="vms-fs-player-container">
            <!-- Video/Image feed or Cloud view -->
          </div>
          <!-- Seeker Red Progress Line -->
          <div class="vms-fs-red-divider">
            <div class="vms-fs-red-progress" id="vms-fs-seeker-progress" style="width: 100%;"></div>
          </div>
        </div>

        <!-- Control Row -->
        <div class="vms-fs-controls-row">
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-play"><i data-lucide="pause"></i></button>
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-mute"><i data-lucide="volume-2"></i></button>
          <button class="vms-fs-ctrl-badge" id="vms-fs-btn-quality">HD</button>
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-grid"><i data-lucide="layout-grid"></i></button>
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-rotate"><i data-lucide="screen-share"></i></button>
        </div>

        <!-- Action & Content area (No scroll, fixed bottom panel) -->
        <div class="vms-fs-bottom-panel">
          <!-- Actions Row (Pill + Circle buttons) -->
          <div class="vms-fs-actions-row">
            <button class="vms-fs-pill-btn" id="vms-fs-action-playback">
              <i data-lucide="history"></i> Playback
            </button>
            
            <button class="vms-fs-circle-btn" id="vms-fs-action-snapshot" title="Ambil Foto Snapshot">
              <i data-lucide="camera"></i>
            </button>
            
            <button class="vms-fs-circle-btn" id="vms-fs-action-record" title="Mulai Rekam Video">
              <i data-lucide="video"></i>
            </button>
            
            <button class="vms-fs-circle-btn" id="vms-fs-action-mic" title="Interkom Suara">
              <i data-lucide="mic"></i>
            </button>
            
            <button class="vms-fs-circle-btn" id="vms-fs-action-ai" title="Deteksi AI Bounding Boxes">
              <i data-lucide="scan-eye"></i>
            </button>
          </div>

          <!-- Playback Timeline slider (Visible in Playback mode) -->
          <div class="vms-fs-timeline-container" id="vms-fs-timeline-container" style="display: none; width: 100%; max-width: 600px; margin-top: 8px;">
            <div class="vms-fs-timeline-row">
              <input type="range" class="vms-fs-timeline-slider" id="vms-fs-timeline-slider" min="0" max="1440" value="720">
              <span class="vms-fs-timestamp" id="vms-fs-timestamp">12:00:00</span>
            </div>
          </div>
        </div>
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

    // Initialize Connection Modal Form
    this.initCctvModal();
  }

  initCctvModal() {
    const btnConnect = document.getElementById('btn-connect-cctv');
    const modal = document.getElementById('connect-cctv-modal');
    const btnClose = document.getElementById('btn-close-cctv-modal');
    const form = document.getElementById('connect-cctv-form');
    const btnScan = document.getElementById('btn-scan-cctv');
    const btnSave = document.getElementById('btn-save-cctv');
    const scannerBox = document.querySelector('.scanner-hud-box');
    const stepsList = document.getElementById('scanner-steps-list');
    const capabilitiesHud = document.getElementById('scanner-capabilities-hud');

    if (!modal) return;

    if (btnConnect) {
      btnConnect.addEventListener('click', () => {
        form.reset();
        scannerBox.style.display = 'none';
        btnSave.disabled = true;
        modal.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });

    let detectedConfig = null;

    if (btnScan) {
      btnScan.addEventListener('click', async () => {
        const host = document.getElementById('cctv-input-host').value;
        const port = document.getElementById('cctv-input-port').value;
        const mode = document.getElementById('cctv-input-mode').value;
        const username = document.getElementById('cctv-input-username').value;
        const password = document.getElementById('cctv-input-password').value;
        const vendor = document.getElementById('cctv-input-vendor').value;

        if (!host) {
          EventBus.emit('toast:show', { message: 'Silakan masukkan IP Address / Host kamera.', type: 'warning' });
          return;
        }

        // Show scanner UI
        scannerBox.style.display = 'block';
        capabilitiesHud.style.display = 'none';
        stepsList.innerHTML = `
          <li><span class="step-icon spinner"></span> Menghubungi host ${host}...</li>
        `;
        btnScan.disabled = true;

        try {
          // Trigger api scan
          const result = await CctvService.scanCamera({
            ipOrHost: host,
            port: port ? parseInt(port) : undefined,
            connectionMode: mode,
            username,
            password,
            vendorHint: vendor
          });

          // Render steps
          stepsList.innerHTML = '';
          
          const appendStep = (text, success) => {
            const li = document.createElement('li');
            li.innerHTML = `
              <span class="step-icon ${success ? 'success' : 'failed'}">${success ? '✓' : '✗'}</span>
              <span>${text}</span>
            `;
            stepsList.appendChild(li);
          };

          appendStep(`Ping ke host ${host}: Terhubung`, result.ping);
          
          // Port scan steps
          const openPorts = Object.keys(result.ports).filter(p => result.ports[p]);
          if (openPorts.length > 0) {
            appendStep(`Port terbuka ditemukan: ${openPorts.join(', ')}`, true);
          } else {
            appendStep(`Tidak ada port standard CCTV yang terbuka`, false);
          }

          appendStep(`Protokol ONVIF: ${result.onvif ? 'Ditemukan' : 'Tidak didukung'}`, result.onvif);
          appendStep(`Protokol RTSP Stream: ${result.rtsp ? 'Ditemukan & Terbuka' : 'Tidak didukung'}`, result.rtsp);
          appendStep(`Snapshot JPG Endpoint: ${result.snapshot ? 'Didukung' : 'Tidak didukung'}`, result.snapshot);
          appendStep(`Modus Cloud Vendor: ${result.cloud ? 'Aktif (Kamera Baterai/Cloud)' : 'Mati'}`, result.cloud);

          // Render capability pills
          capabilitiesHud.innerHTML = '';
          capabilitiesHud.style.display = 'flex';
          
          const addCapPill = (name, supported) => {
            const pill = document.createElement('span');
            pill.className = `cap-pill ${supported ? 'enabled' : 'disabled'}`;
            pill.innerHTML = `<span class="cap-dot"></span> ${name}`;
            capabilitiesHud.appendChild(pill);
          };

          addCapPill('RTSP', result.rtsp);
          addCapPill('ONVIF', result.onvif);
          addCapPill('Snapshot', result.snapshot);
          addCapPill('Cloud Mode', result.cloud);

          // Save detected configuration
          detectedConfig = {
            name: document.getElementById('cctv-input-name').value || `Kamera ${host}`,
            location: document.getElementById('cctv-input-location').value || 'Lokasi Kustom',
            description: document.getElementById('cctv-input-description').value || '',
            vendor: result.details.vendor || vendor,
            model: result.details.resolution || 'Generic Model',
            protocol: result.details.protocol,
            mediaType: result.details.mediaType,
            streamUrl: result.details.streamUrl || host,
            playUrl: result.details.playUrl || host,
            username,
            password,
            capabilities: {
              rtsp: result.rtsp,
              hls: result.details.protocol === 'HLS',
              snapshot: result.snapshot,
              mjpeg: result.mjpeg,
              onvif: result.onvif,
              cloud: result.cloud
            }
          };

          EventBus.emit('toast:show', { message: 'Pemindaian selesai! Kemampuan kamera berhasil diidentifikasi.', type: 'success' });
          btnSave.disabled = false; // Enable submit button!

        } catch (err) {
          stepsList.innerHTML += `
            <li class="error-step"><span class="step-icon failed">✗</span> Gagal memindai: ${err.message}</li>
          `;
          EventBus.emit('toast:show', { message: 'Pemindaian kamera gagal.', type: 'danger' });
        } finally {
          btnScan.disabled = false;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!detectedConfig) return;

        // Force values if admin edited them after scanning
        detectedConfig.name = document.getElementById('cctv-input-name').value;
        detectedConfig.location = document.getElementById('cctv-input-location').value;
        detectedConfig.description = document.getElementById('cctv-input-description').value;

        btnSave.disabled = true;

        try {
          await CctvService.connectCctv(detectedConfig);
          EventBus.emit('toast:show', { message: 'CCTV Baru berhasil dihubungkan ke sistem!', type: 'success' });
          modal.style.display = 'none';
          
          // Reload
          await this.loadData();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menyimpan CCTV: ${err.message}`, type: 'danger' });
          btnSave.disabled = false;
        }
      });
    }
  }

  openVmsController(channelId) {
    const ch = this.cctvList.find(c => c.id === channelId);
    if (!ch) return;

    const page = document.getElementById('vms-fullscreen-page');
    const titleEl = document.getElementById('vms-fs-cam-title');
    const playerContainer = document.getElementById('vms-fs-player-container');
    const btnBack = document.getElementById('btn-close-vms-fs');
    
    const seekerProgress = document.getElementById('vms-fs-seeker-progress');
    const timelineContainer = document.getElementById('vms-fs-timeline-container');
    const timelineSlider = document.getElementById('vms-fs-timeline-slider');
    const timestampLabel = document.getElementById('vms-fs-timestamp');
    
    const btnPlay = document.getElementById('vms-fs-btn-play');
    const btnMute = document.getElementById('vms-fs-btn-mute');
    const btnQuality = document.getElementById('vms-fs-btn-quality');
    const btnGrid = document.getElementById('vms-fs-btn-grid');
    const btnRotate = document.getElementById('vms-fs-btn-rotate');
    
    const btnActPlayback = document.getElementById('vms-fs-action-playback');
    const btnActSnapshot = document.getElementById('vms-fs-action-snapshot');
    const btnActRecord = document.getElementById('vms-fs-action-record');
    const btnActMic = document.getElementById('vms-fs-action-mic');
    const btnActAi = document.getElementById('vms-fs-action-ai');

    if (!page) return;

    // Set Header
    titleEl.innerText = ch.name.toUpperCase();

    // Player state variables
    let isPlaying = true;
    let isMuted = true;
    let isHd = true;
    let isPlaybackMode = false;
    let isAiActive = true;
    let isRecording = false;
    let recordInterval = null;

    const matchReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
    const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : '/uploads/detection_1.jpg');

    // 1. Render Active player view
    const renderActivePlayer = () => {
      let playerHtml = '';
      if (ch.mediaType === 'Cloud') {
        playerHtml = `
          <div class="cctv-cloud-overlay" style="background: rgba(9, 13, 22, 0.95); height: 100%; width: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px;">
            <i data-lucide="cloud" class="cloud-icon" style="color: var(--primary); width: 48px; height: 48px;"></i>
            <span class="cloud-title" style="font-size: 1.15rem; font-weight: 700; color: white;">Mode Cloud Vendor</span>
            <span class="cloud-desc" style="color: rgba(255,255,255,0.6); max-width: 320px; font-size: 0.75rem; text-align: center; margin-bottom: 12px;">Kamera Krisbow Sync Battery Solar terhubung ke Server Cloud Krisbow.</span>
            <a href="${ch.streamUrl || '#'}" target="_blank" class="btn btn-primary btn-rounded btn-cloud-action" onclick="event.stopPropagation();">
              <i data-lucide="external-link"></i> Buka Cloud App
            </a>
          </div>
        `;
      } else if (ch.mediaType === 'Video') {
        playerHtml = `
          <video src="${ch.playUrl}" id="vms-fs-media-element" autoplay loop ${isMuted ? 'muted' : ''} playsinline style="width:100%; height:100%; object-fit:contain;"></video>
          <!-- Video overlay stats ala mobile -->
          <div style="position: absolute; top: 12px; left: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.72rem; color: white; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 4px;">
            <span style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%;"></span>
            <span>Live</span>
            <span style="opacity: 0.5;">|</span>
            <span>1.75 KB/s</span>
          </div>
          <div class="vms-rec-badge" id="vms-fs-rec-badge" style="display:none; position:absolute; top:12px; right:16px; background:rgba(239,68,68,0.85); color:white; font-size:0.7rem; font-weight:800; padding:3px 8px; border-radius:4px; align-items:center; gap:5px; z-index: 10;">
            <span class="rec-dot" style="width:6px; height:6px; background:white; border-radius:50%; display:inline-block; animation: pulse-cloud 1s infinite;"></span>
            REC <span id="vms-fs-rec-timer">00:00</span>
          </div>
          <div id="vms-fs-yolo-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 5;"></div>
        `;
      } else {
        playerHtml = `
          <img src="${imageSrc}" id="vms-fs-media-element" style="width:100%; height:100%; object-fit:contain;">
          <!-- Video overlay stats ala mobile -->
          <div style="position: absolute; top: 12px; left: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.72rem; color: white; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 4px;">
            <span style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%;"></span>
            <span>Live</span>
            <span style="opacity: 0.5;">|</span>
            <span>1.75 KB/s</span>
          </div>
          <div class="vms-rec-badge" id="vms-fs-rec-badge" style="display:none; position:absolute; top:12px; right:16px; background:rgba(239,68,68,0.85); color:white; font-size:0.7rem; font-weight:800; padding:3px 8px; border-radius:4px; align-items:center; gap:5px; z-index: 10;">
            <span class="rec-dot" style="width:6px; height:6px; background:white; border-radius:50%; display:inline-block; animation: pulse-cloud 1s infinite;"></span>
            REC <span id="vms-fs-rec-timer">00:00</span>
          </div>
          <div id="vms-fs-yolo-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 5;"></div>
        `;
      }
      playerContainer.innerHTML = playerHtml;

      setTimeout(() => {
        renderYoloBoxes();
      }, 50);

      if (window.lucide) window.lucide.createIcons();
    };

    const renderYoloBoxes = () => {
      const yoloOverlay = document.getElementById('vms-fs-yolo-overlay');
      if (!yoloOverlay) return;
      yoloOverlay.innerHTML = '';
      if (!isAiActive) return;

      if (matchReport && matchReport.boundingBoxes) {
        matchReport.boundingBoxes.forEach(box => {
          let boxColorClass = 'yolo-default';
          if (box.label === 'person') boxColorClass = 'yolo-person';
          if (box.label === 'trash') boxColorClass = 'yolo-trash';
          if (box.label === 'boat') boxColorClass = 'yolo-boat';

          const el = document.createElement('div');
          el.className = `yolo-preview-box ${boxColorClass}`;
          el.style.cssText = `
            position: absolute;
            top: ${box.y}%; 
            left: ${box.x}%; 
            width: ${box.w}%; 
            height: ${box.h}%;
            border: 2px solid var(--primary);
          `;
          el.innerHTML = `<span class="yolo-preview-label" style="background:var(--primary); color:white; font-size:0.6rem; font-weight:800; padding:1px 4px; border-radius:2px; position:absolute; top:-16px; left:-2px; white-space:nowrap;">${box.label}</span>`;
          yoloOverlay.appendChild(el);
        });
      }
    };

    // 2. Seeker line indicator logic
    const updateSeekerProgress = () => {
      const val = parseInt(timelineSlider.value);
      const percent = (val / 1440) * 100;
      if (seekerProgress) seekerProgress.style.width = `${percent}%`;
      const hours = Math.floor(val / 60).toString().padStart(2, '0');
      const minutes = (val % 60).toString().padStart(2, '0');
      timestampLabel.innerText = `${hours}:${minutes}:00`;
    };
    timelineSlider.oninput = updateSeekerProgress;



    // 4. Back/Close button handler
    const handleClose = () => {
      page.style.display = 'none';
      if (recordInterval) {
        clearInterval(recordInterval);
      }
      this.loadData();
    };
    btnBack.onclick = handleClose;

    // 5. Controls binding
    btnPlay.onclick = () => {
      const media = document.getElementById('vms-fs-media-element');
      if (!media) return;
      if (isPlaying) {
        if (ch.mediaType === 'Video') media.pause();
        btnPlay.innerHTML = '<i data-lucide="play"></i>';
        isPlaying = false;
        EventBus.emit('toast:show', { message: 'Video dijeda.', type: 'info' });
      } else {
        if (ch.mediaType === 'Video') media.play();
        btnPlay.innerHTML = '<i data-lucide="pause"></i>';
        isPlaying = true;
        EventBus.emit('toast:show', { message: 'Video dilanjutkan.', type: 'info' });
      }
      if (window.lucide) window.lucide.createIcons();
    };

    btnMute.onclick = () => {
      const media = document.getElementById('vms-fs-media-element');
      if (!media) return;
      if (isMuted) {
        if (ch.mediaType === 'Video') media.muted = false;
        btnMute.innerHTML = '<i data-lucide="volume-x"></i>';
        isMuted = false;
        EventBus.emit('toast:show', { message: 'Suara aktif.', type: 'info' });
      } else {
        if (ch.mediaType === 'Video') media.muted = true;
        btnMute.innerHTML = '<i data-lucide="volume-2"></i>';
        isMuted = true;
        EventBus.emit('toast:show', { message: 'Suara dimatikan.', type: 'info' });
      }
      if (window.lucide) window.lucide.createIcons();
    };

    btnQuality.onclick = () => {
      isHd = !isHd;
      btnQuality.innerText = isHd ? 'HD' : 'SD';
      btnQuality.style.borderColor = isHd ? 'var(--primary)' : '#718096';
      btnQuality.style.color = isHd ? 'var(--primary)' : '#718096';
      EventBus.emit('toast:show', { message: `Kualitas streaming diatur ke ${isHd ? 'High Definition (HD)' : 'Standard Definition (SD)'}`, type: 'info' });
    };

    btnGrid.onclick = () => {
      EventBus.emit('toast:show', { message: 'Kembali ke halaman Dashboard Pemantauan.', type: 'info' });
      handleClose();
    };

    btnRotate.onclick = () => {
      const media = document.getElementById('vms-fs-media-element');
      if (!media) return;
      if (media.requestFullscreen) {
        media.requestFullscreen();
      } else if (media.webkitRequestFullscreen) {
        media.webkitRequestFullscreen();
      }
    };

    // 6. Action Row Bindings
    btnActPlayback.onclick = () => {
      isPlaybackMode = !isPlaybackMode;
      if (isPlaybackMode) {
        timelineContainer.style.display = 'block';
        btnActPlayback.classList.add('active');
        EventBus.emit('toast:show', { message: 'Modus Pemutaran Rekaman (Playback) aktif.', type: 'warning' });
      } else {
        timelineContainer.style.display = 'none';
        btnActPlayback.classList.remove('active');
        EventBus.emit('toast:show', { message: 'Kembali ke penayangan langsung (Live).', type: 'success' });
      }
    };

    btnActSnapshot.onclick = () => {
      EventBus.emit('toast:show', { message: 'Mengambil snapshot kamera...', type: 'info' });
      btnActSnapshot.classList.add('active');
      setTimeout(() => {
        btnActSnapshot.classList.remove('active');
        const a = document.createElement('a');
        a.href = imageSrc;
        a.download = `Snapshot_${ch.name}_${new Date().toISOString().slice(0, 10)}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        EventBus.emit('toast:show', { message: 'Snapshot berhasil disimpan!', type: 'success' });
      }, 500);
    };

    btnActRecord.onclick = () => {
      isRecording = !isRecording;
      const badge = document.getElementById('vms-fs-rec-badge');
      const timerEl = document.getElementById('vms-fs-rec-timer');

      if (isRecording) {
        btnActRecord.classList.add('active');
        if (badge) badge.style.display = 'flex';
        EventBus.emit('toast:show', { message: 'Perekaman klip video dimulai.', type: 'info' });
        
        let seconds = 0;
        if (timerEl) timerEl.innerText = '00:00';
        recordInterval = setInterval(() => {
          seconds++;
          const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
          const secs = (seconds % 60).toString().padStart(2, '0');
          if (timerEl) timerEl.innerText = `${mins}:${secs}`;
        }, 1000);
      } else {
        btnActRecord.classList.remove('active');
        if (badge) badge.style.display = 'none';
        if (recordInterval) {
          clearInterval(recordInterval);
          recordInterval = null;
        }
        EventBus.emit('toast:show', { message: 'Klip rekaman disimpan ke galeri lokal.', type: 'success' });
      }
    };

    btnActMic.onclick = () => {
      btnActMic.classList.toggle('active');
      const isActive = btnActMic.classList.contains('active');
      EventBus.emit('toast:show', { 
        message: isActive ? 'Interkom suara aktif. Tekan untuk bicara.' : 'Interkom suara dinonaktifkan.', 
        type: isActive ? 'success' : 'info' 
      });
    };

    btnActAi.onclick = () => {
      isAiActive = !isAiActive;
      btnActAi.classList.toggle('active', isAiActive);
      renderYoloBoxes();
      EventBus.emit('toast:show', { 
        message: isAiActive ? 'Pembatas deteksi YOLO diaktifkan.' : 'Pembatas deteksi YOLO dinonaktifkan.', 
        type: 'info' 
      });
    };

    // Boot Fullscreen view
    renderActivePlayer();
    updateSeekerProgress();
    page.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async loadData() {
    try {
      // Load Stats
      const stats = await StatsService.getStats();
      this.stats = stats;

      // Load CCTV list
      this.cctvList = await CctvService.getCctvList();
      this.updateCameraSelectOptions();
      
      // Load detections
      const detectionsData = await ReportService.getFilteredReports({ limit: 50 });
      this.latestReports = detectionsData.reports || [];

      // Check if there is a new incoming report during active polling to trigger badge / toast
      if (this.latestReports.length > 0) {
        const topReport = this.latestReports[0];
        if (this.lastSeenReportId !== null && topReport.id > this.lastSeenReportId) {
          // New report detected!
          if (topReport.aiStatus === 'TINGGI' || topReport.aiStatus === 'SEDANG') {
            AppState.set('unreadNotifications', (AppState.get('unreadNotifications') || 0) + 1);
            EventBus.emit('toast:show', {
              message: `🚨 Peringatan Baru: Terdeteksi ancaman ${topReport.aiStatus} di ${topReport.location}!`,
              type: 'danger'
            });
          } else {
            EventBus.emit('toast:show', {
              message: `📷 CCTV: Aktivitas terdeteksi di ${topReport.location}`,
              type: 'info'
            });
          }
        }
        this.lastSeenReportId = topReport.id;
      }
      
      // Update state notification - show all recent detections and verifications
      const allNotificationItems = this.latestReports.map(r => {
        let title = '';
        let message = '';
        let level = 'info'; // 'high', 'medium', 'low', 'info', 'success'
        
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

      // Maintain comments notifications if any are stored in AppState
      const currentNotifications = AppState.get('notifications') || [];
      const commentNotifs = currentNotifications.filter(n => n.isComment);

      // Merge and sort
      const merged = [...commentNotifs, ...allNotificationItems].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      AppState.set('notifications', merged.slice(0, 20));
      
      // Render
      this.animateStats();
      this.renderCCTVGrid();
      this.renderLiveAlerts();
    } catch (err) {
      console.error('[DashboardPage] loadData failed:', err);
      this.renderError();
    }
  }

  updateCameraSelectOptions() {
    const selectCam = document.getElementById('cctv-select-camera');
    if (!selectCam) return;
    
    const currentValue = selectCam.value;
    selectCam.innerHTML = `<option value="semua">Semua Saluran (${this.cctvList.length} CCTV)</option>`;
    
    this.cctvList.forEach(c => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = `Kamera ${c.id.toString().padStart(2, '0')} - ${c.name}`;
      if (c.id.toString() === currentValue) {
        option.selected = true;
      }
      selectCam.appendChild(option);
    });
  }

  animateStats() {
    const activeCamsEl = document.getElementById('stat-cameras-active');
    const camsSubtextEl = document.getElementById('stat-cameras-subtext');
    const alertsTodayEl = document.getElementById('stat-alerts-today');
    const alertsActiveSub = document.getElementById('stat-alerts-active-subtext');
    const peopleCountEl = document.getElementById('stat-people-count');
    const systemStatusEl = document.getElementById('stat-system-status');

    const isMon = AppState.get('isMonitoring');

    if (activeCamsEl) {
      const onlineCount = this.cctvList.filter(c => c.status === 'ONLINE').length;
      activeCamsEl.innerText = isMon ? `${onlineCount} Kamera` : '0 Kamera';
    }
    if (camsSubtextEl) {
      camsSubtextEl.innerText = `${this.cctvList.length} Saluran Terhubung`;
    }
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

  // Render Grid CCTV dinamik
  renderCCTVGrid() {
    const container = document.getElementById('cctv-grid-container');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';

    this.cctvList.forEach(ch => {
      const isChActive = isMon && ch.isActive;
      // Find matching report from DB for this location
      const matchReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
      const isAlert = matchReport ? (matchReport.aiStatus === 'TINGGI' || matchReport.aiStatus === 'SEDANG') : false;
      const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : '/uploads/detection_1.jpg');
      
      const card = document.createElement('div');
      card.className = `cctv-card glass-card ${isAlert ? 'cctv-card-alert' : ''}`;
      card.setAttribute('data-channel-id', ch.id);

      let boundingBoxesHtml = '';
      if (isChActive && matchReport && matchReport.boundingBoxes) {
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

      // Render Dynamic player or image based on protocol and media type capabilities
      let mediaHtml = '';
      if (isChActive) {
        if (ch.status === 'OFFLINE' || ch.status === 'ERROR' || ch.status === 'DISCONNECTED') {
          // Render static offline screen with status
          mediaHtml = `
            <div class="cctv-static-screen">
              <div class="static-noise"></div>
              <div class="static-label text-danger">${ch.status}</div>
            </div>
          `;
        } else if (ch.mediaType === 'Cloud') {
          // Cloud vendor mode rendering
          mediaHtml = `
            <div class="cctv-cloud-overlay">
              <i data-lucide="cloud" class="cloud-icon" style="color: var(--primary);"></i>
              <span class="cloud-title">Mode Cloud Vendor</span>
              <a href="${ch.streamUrl}" target="_blank" class="btn btn-primary btn-sm btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="margin-bottom: 20px;">
                <i data-lucide="external-link"></i> Buka Cloud App
              </a>
            </div>
          `;
        } else if (ch.mediaType === 'Video') {
          // HTML5 Video Loop streaming simulation (support mp4, HLS)
          mediaHtml = `
            <video src="${ch.playUrl}" autoplay loop muted playsinline class="cctv-feed-img"></video>
            <div class="cctv-overlay-gradient"></div>
            ${boundingBoxesHtml}
          `;
        } else {
          // Default Image snapshot rendering
          mediaHtml = `
            <img src="${imageSrc}" alt="Kamera ${ch.name}" class="cctv-feed-img" loading="lazy" decoding="async">
            <div class="cctv-overlay-gradient"></div>
            ${boundingBoxesHtml}
          `;
        }
      } else {
        // Pemantauan nonaktif
        mediaHtml = `
          <div class="cctv-static-screen">
            <div class="static-noise"></div>
            <div class="static-label">OFFLINE</div>
          </div>
        `;
      }

      // Setup status class
      let statusClass = 'status-offline';
      let statusText = 'OFFLINE';
      if (isChActive) {
        if (ch.status === 'ONLINE') {
          statusClass = isAlert ? 'status-alert' : 'status-live';
          statusText = isAlert ? 'WARNING' : 'ONLINE';
        } else if (ch.status === 'CONNECTING' || ch.status === 'BUFFERING') {
          statusClass = 'status-connecting';
          statusText = ch.status;
        } else {
          statusClass = 'status-offline';
          statusText = ch.status;
        }
      }

      card.innerHTML = `
        <div class="cctv-media-container">
          ${mediaHtml}
          ${isChActive && ch.status === 'ONLINE' ? `
            <div class="cctv-hud-header">
              <span class="cctv-rec-pill"><span class="rec-dot"></span>REC</span>
              <span class="cctv-fps-badge">${ch.health.fps ? `${ch.health.fps} FPS` : 'LIVE'}</span>
            </div>
            <div class="cctv-hud-footer">
              <span class="cctv-ch-badge">CH ${ch.id.toString().padStart(2, '0')}</span>
              <span class="cctv-loc-name">${ch.name}</span>
            </div>
          ` : ''}
          ${isAdmin && !ch.isDefault ? `
            <button class="btn-disconnect-cctv" data-id="${ch.id}" title="Putuskan CCTV">
              <i data-lucide="trash-2"></i>
            </button>
          ` : ''}
        </div>
        <div class="cctv-info-row">
          <span class="cctv-status-badge ${statusClass}">
            <span class="status-dot"></span>
            ${statusText}
          </span>
          <span class="cctv-type-text">${ch.health.latency ? `${ch.health.latency} ms` : ''} ${ch.protocol}</span>
        </div>
      `;

      // Zoom view on click (Open Interactive VMS Controller Modal)
      card.addEventListener('click', () => {
        this.openVmsController(ch.id);
      });

      // Bind delete action
      if (isAdmin && !ch.isDefault) {
        const btnDelete = card.querySelector('.btn-disconnect-cctv');
        if (btnDelete) {
          btnDelete.addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmDel = confirm(`Apakah Anda yakin ingin memutuskan koneksi CCTV: "${ch.name}"?`);
            if (!confirmDel) return;

            try {
              await CctvService.disconnectCctv(ch.id);
              EventBus.emit('toast:show', { message: `Koneksi CCTV "${ch.name}" berhasil diputuskan.`, type: 'success' });
              await this.loadData();
            } catch (err) {
              EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
            }
          });
        }
      }

      container.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // Filter CCTV Channels based on dropdown choice
  filterCCTVChannels(value) {
    const cards = document.querySelectorAll('.cctv-card');
    const container = document.getElementById('cctv-grid-container');
    if (container) {
      if (value === 'semua') {
        container.classList.remove('single-channel-active');
      } else {
        container.classList.add('single-channel-active');
      }
    }
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
