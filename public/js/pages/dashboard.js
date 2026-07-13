// dashboard.js - Kontroler Halaman Dashboard Pemantauan Sungai
import { StatsService } from '../services/statsService.js';
import { ReportService } from '../services/reportService.js';
import { CctvService } from '../services/cctvService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { CONFIG } from '../core/config.js';
import { API } from '../services/api.js';


export class DashboardPage {
  constructor() {
    this.pollingTimer = null;
    this.stats = { total: 0, mostVulnerable: '-', valid: 0, cancelled: 0, pending: 0 };
    this.latestReports = [];
    this.cctvList = [];
    this.lastSeenReportId = null;
    this.searchQuery = '';
    this.filterTag = 'all';
    this.filterId = '';
    this.filterCamera = 'all';
    this.filterDate = '';
    this.filterStatus = 'all';
    this.editingCctvId = null;
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
          <span id="brief-system-status">🟢 MONITORING ACTIVE</span>
        </div>
        <div class="cc-hud-metrics">
          <div class="cc-hud-metric"><i data-lucide="video" style="width:14px;height:14px;"></i> <strong id="brief-online-count">0</strong> Cameras Online</div>
          <div class="cc-hud-metric"><i data-lucide="alert-circle" style="width:14px;height:14px;"></i> <strong id="brief-active-alerts">0</strong> Active Incidents</div>
          <div class="cc-hud-metric"><i data-lucide="clock" style="width:14px;height:14px;"></i> Last Detection: <strong id="brief-last-incident">—</strong></div>
        </div>
        <span class="cc-hud-date" id="brief-current-date">—</span>
      </div>

      <!-- 2. Subheader Control Panel -->
      <section class="glass-card control-panel-card" style="margin-bottom: var(--space-24);">
        <div class="control-left">
          <div class="form-group-inline">
            <label for="cctv-select-camera" class="caption-label">Saluran Aktif</label>
            <select id="cctv-select-camera" class="filter-control select-rounded">
              <option value="semua">Semua Saluran</option>
            </select>
          </div>
          ${isAdmin ? `
          <div class="form-group-inline" style="margin-left: 16px;">
            <label for="ai-engine-select" class="caption-label">AI Engine</label>
            <select id="ai-engine-select" class="filter-control select-rounded" style="border-color: rgba(47, 107, 255, 0.3); color: var(--primary); font-weight: 700;">
              <option value="MOCK">MOCK (Simulation)</option>
              <option value="FASTAPI">FASTAPI (Microservice)</option>
              <option value="ONNX">ONNX (Local)</option>
            </select>
          </div>
          ` : ''}
          <div id="ai-hud-metrics" style="display: flex; align-items: center; gap: 16px; margin-left: 20px; padding: 6px 12px; background: rgba(47, 107, 255, 0.05); border-radius: 8px; border: 1px solid rgba(47, 107, 255, 0.1); font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">
            <div><span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--success); margin-right: 6px; vertical-align: middle;" id="hud-engine-dot"></span>Engine: <span id="hud-engine-status" style="color: var(--success); font-weight: 800;">READY</span></div>
            <div>Queue: <span id="hud-queue-depth" style="font-weight: 800; color: var(--primary);">0</span>/<span id="hud-queue-capacity">50</span></div>
            <div>FPS: <span id="hud-inference-fps" style="font-weight: 800; color: var(--info);">0.0</span></div>
            <div>Model: <span id="hud-active-model" style="font-weight: 800;">yolov8-river-v1.0</span></div>
          </div>
        </div>
        <div class="control-right" style="position: relative;">
          ${isAdmin ? `
            <button id="btn-edit-eyeco-info" class="btn btn-glass btn-rounded" style="border-color: rgba(47, 107, 255, 0.3); color: var(--primary); margin-right: 8px;">
              <i data-lucide="edit-3"></i> Edit Info EYECO
            </button>
            <button id="btn-connect-cctv" class="btn btn-glass btn-rounded" style="border-color: rgba(47, 107, 255, 0.3); color: var(--primary);">
              <i data-lucide="plus-circle"></i> Hubungkan CCTV
            </button>
          ` : ''}

          <div class="toggle-wrapper" style="margin-right: 12px;">
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
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0 0 8px 0; letter-spacing: 0.4px;">Officer Status</h4>
            <div id="officer-live-list">
              <div style="font-size: 0.72rem; color: var(--text-muted); padding: 8px 0;">Tidak ada petugas aktif.</div>
            </div>
          </div>

          <div style="border-top: 1px solid var(--border); padding-top: var(--space-12);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Camera Health</span>
              <span id="stat-camera-health-val" style="font-size: 0.75rem; font-weight: 800; color: var(--success);">100%</span>
            </div>
            <div class="progress-bar-flat" style="width: 100%; height: 5px; background: rgba(0,0,0,0.05); border-radius: 3px; overflow: hidden;">
              <div id="stat-camera-health-bar" style="width: 100%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
            </div>
            <span id="stat-camera-health-desc" style="font-size: 0.62rem; color: var(--text-secondary); font-weight: 600; margin-top: 4px; display: block;">0/0 Online</span>
          </div>
        </aside>
      </div>

      <!-- 4. Secondary Zone: CCTV Grid -->
      <div class="command-center-secondary">

        <div class="cctv-section-compact">
          <div class="cctv-header-row">
            <div class="section-title"><i data-lucide="layout-grid" style="color:var(--primary);"></i> Live CCTV Grid</div>
            <div class="cctv-status-indicator">
              <span class="status-pulse-dot green" id="cctv-pulse-dot"></span>
              <span class="caption-label" id="cctv-status-text">LIVE MONITORING</span>
            </div>
          </div>
          <div class="cctv-grid" id="cctv-grid-container"></div>
        </div>
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

      <!-- Edit EYECO Info Modal Overlay -->
      <div id="edit-eyeco-info-modal" class="modal-overlay" style="display: none;">
        <div class="glass-card modal-container" style="max-width: 600px;">
          <div class="modal-header">
            <h3><i data-lucide="edit-3"></i> Edit Informasi EYECO</h3>
            <button class="btn-close-modal" id="btn-close-eyeco-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="edit-eyeco-info-form">
              <div class="form-group" style="margin-bottom: 16px;">
                <label class="form-label">Tentang EYECO</label>
                <textarea id="eyeco-input-about" class="filter-control input-rounded" style="width: 100%; min-height: 80px;" required></textarea>
              </div>

              <div class="form-group" style="margin-bottom: 16px;">
                <label class="form-label">Informasi Terkini (Satu baris per pengumuman)</label>
                <textarea id="eyeco-input-terkini" class="filter-control input-rounded" style="width: 100%; min-height: 100px; font-family: inherit;" placeholder="Tulis pengumuman baru baris demi baris..." required></textarea>
              </div>

              <div class="form-group" style="margin-bottom: 16px;">
                <label class="form-label">Berita & Informasi Seputar Sampah (Satu baris per berita)</label>
                <textarea id="eyeco-input-sampah" class="filter-control input-rounded" style="width: 100%; min-height: 100px; font-family: inherit;" placeholder="Tulis berita sampah baru baris demi baris..." required></textarea>
              </div>

              <div class="modal-actions-row" style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 12px;">
                <button type="button" class="btn btn-glass btn-rounded" id="btn-cancel-eyeco-modal">Batal</button>
                <button type="submit" class="btn btn-primary btn-rounded" id="btn-save-eyeco-info">
                  <i data-lucide="save"></i> Simpan Informasi
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
          <div class="vms-fs-header-right" style="position: relative;">
            <button class="vms-fs-icon-btn" id="vms-fs-btn-toggle-ai-mon" title="Toggle AI Monitoring"><i data-lucide="eye"></i></button>
            <button class="vms-fs-icon-btn" id="vms-fs-btn-more" title="More Actions"><i data-lucide="more-horizontal"></i></button>
            
            <!-- Dropdown Menu -->
            <div id="vms-fs-more-dropdown" class="glass-card" style="display: none; position: absolute; top: 40px; right: 0; width: 200px; z-index: 1000; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: #ffffff; box-shadow: var(--glass-shadow);">
              <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px;">
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-settings" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: var(--text-primary); text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;">
                    <i data-lucide="settings" style="width: 14px; height: 14px;"></i> Settings / Edit CCTV
                  </button>
                </li>
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-reconnect" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: var(--text-primary); text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;">
                    <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Reconnect Stream
                  </button>
                </li>
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-toggle-overlay" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: var(--text-primary); text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;">
                    <i data-lucide="scan-eye" style="width: 14px; height: 14px;"></i> Toggle AI Overlay
                  </button>
                </li>
                <li id="vms-fs-drop-delete-container" style="display: none; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 4px; margin-top: 4px;">
                  <button class="dropdown-item-btn" id="vms-fs-drop-delete" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: var(--danger); text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px; transition: background 0.15s;">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--danger);"></i> Putuskan CCTV
                  </button>
                </li>
              </ul>
            </div>
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
        <div class="vms-fs-controls-row" style="gap: 12px; font-weight: 800; font-size: 0.72rem;">
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-play" style="font-weight: 800; font-size: 0.72rem;">PAUSE</button>
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-mute" style="font-weight: 800; font-size: 0.72rem;">MUTE</button>
          <button class="vms-fs-ctrl-badge" id="vms-fs-btn-quality">HD</button>
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-grid" style="font-weight: 800; font-size: 0.72rem;">GRID</button>
          <button class="vms-fs-ctrl-btn" id="vms-fs-btn-rotate" style="font-weight: 800; font-size: 0.72rem;">ROTATE</button>
        </div>

        <!-- Action & Content area (No scroll, fixed bottom panel) -->
        <div class="vms-fs-bottom-panel">
          <!-- Actions Row (Pill + Circle buttons) -->
          <div class="vms-fs-actions-row" style="gap: var(--space-8);">
            <button class="vms-fs-pill-btn" id="vms-fs-action-playback" style="font-weight: 700;">Playback</button>
            <button class="vms-fs-pill-btn" id="vms-fs-action-snapshot" title="Ambil Foto Snapshot" style="font-weight: 700;">Snap</button>
            <button class="vms-fs-pill-btn" id="vms-fs-action-record" title="Mulai Rekam Video" style="font-weight: 700;">Rec</button>
            <button class="vms-fs-pill-btn" id="vms-fs-action-mic" title="Interkom Suara" style="font-weight: 700;">Talk</button>
            <button class="vms-fs-pill-btn" id="vms-fs-action-ai" title="Deteksi AI Bounding Boxes" style="font-weight: 700;">AI Box</button>
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

      <!-- 5. CCTV VMS Detail Drawer Panel -->
      <div id="cctv-detail-drawer" class="cctv-drawer" style="position: fixed; top: 0; right: -400px; width: 380px; height: 100vh; background: #ffffff; border-left: 1px solid var(--border); box-shadow: -10px 0 40px rgba(0,0,0,0.05); z-index: 1050; transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column;">
        <!-- Filled dynamically by JS -->
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
    const selectCam = document.getElementById('cctv-select-camera');
    const selectEngine = document.getElementById('ai-engine-select');
    const toggleTelegram = document.getElementById('toggle-telegram-alerts');
    const toggleMonitoring = document.getElementById('btn-toggle-monitoring');
    const searchInput = document.getElementById('incident-search-input');
    const filterIdInput = document.getElementById('incident-filter-id');
    const filterCameraSelect = document.getElementById('incident-filter-camera');
    const filterDateInput = document.getElementById('incident-filter-date');
    const filterStatusSelect = document.getElementById('incident-filter-status');
    const filterTabsContainer = document.getElementById('incident-filter-tabs');
    const notifBtn = document.getElementById('btn-dashboard-notifications');
    const notifPopover = document.getElementById('dashboard-notif-popover');

    if (selectCam) {
      selectCam.addEventListener('change', () => this.filterCCTVChannels(selectCam.value));
    }

    if (selectEngine) {
      selectEngine.addEventListener('change', async () => {
        const engineVal = selectEngine.value;
        try {
          await API.post('/api/system-settings', {
            key: 'ai.engine',
            value: engineVal,
            reason: 'Engine hot-swapped via Dashboard Selector',
            approvedBy: 'Admin'
          });
          EventBus.emit('toast:show', {
            message: `AI Engine berhasil diganti ke ${engineVal}.`,
            type: 'success'
          });
        } catch (err) {
          console.error('Failed to update AI engine setting:', err);
          EventBus.emit('toast:show', {
            message: `Gagal mengganti AI Engine: ${err.message}`,
            type: 'danger'
          });
        }
      });
    }

    if (toggleTelegram) {
      toggleTelegram.addEventListener('change', async () => {
        const isChecked = toggleTelegram.checked;
        AppState.set('telegramAlerts', isChecked);
        
        try {
          await API.post('/api/system-settings', {
            key: 'telegram.enabled',
            value: isChecked,
            reason: 'Toggled via Dashboard Control Panel',
            approvedBy: 'Admin'
          });
          EventBus.emit('toast:show', {
            message: isChecked ? 'Notifikasi Telegram diaktifkan.' : 'Notifikasi Telegram dinonaktifkan.',
            type: isChecked ? 'success' : 'warning'
          });
        } catch (err) {
          console.error('Failed to update telegram setting:', err);
          EventBus.emit('toast:show', { message: `Gagal memperbarui konfigurasi Telegram: ${err.message}`, type: 'danger' });
          // Revert UI switch
          toggleTelegram.checked = !isChecked;
          AppState.set('telegramAlerts', !isChecked);
        }
      });
    }

    if (toggleMonitoring) {
      toggleMonitoring.addEventListener('click', async () => {
        const isMonitoring = AppState.get('isMonitoring');
        const nextMonitoringState = !isMonitoring;
        
        try {
          // Send request to backend
          const enabledResult = await CctvService.toggleGlobalMonitoring(nextMonitoringState);
          
          AppState.set('isMonitoring', enabledResult);

          // Update button visual
          toggleMonitoring.className = `btn ${enabledResult ? 'btn-danger' : 'btn-primary'} btn-rounded`;
          toggleMonitoring.innerHTML = `
            <i data-lucide="${enabledResult ? 'video-off' : 'video'}"></i>
            <span id="btn-monitoring-text">${enabledResult ? 'Hentikan Pemantauan' : 'Mulai Pemantauan'}</span>
          `;
          
          // Trigger CCTV static screen
          this.updateCCTVMonitoringState(enabledResult);
          
          if (window.lucide) window.lucide.createIcons();
          
          EventBus.emit('toast:show', {
            message: enabledResult ? 'Pemantauan AI aktif secara global!' : 'Pemantauan AI dinonaktifkan!',
            type: enabledResult ? 'success' : 'warning'
          });
          
          await this.loadData();
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengubah status pemantauan.', type: 'danger' });
        }
      });
    }

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



    // Initialize Connection Modal Form
    this.initCctvModal();
    this.initEyecoInfoModal();
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
        this.editingCctvId = null;
        form.reset();
        scannerBox.style.display = 'none';
        btnSave.disabled = true;
        
        // Restore title and button text
        const modalTitle = modal.querySelector('.modal-header h3');
        if (modalTitle) {
          modalTitle.innerHTML = `<i data-lucide="plus-circle"></i> Hubungkan CCTV Baru`;
        }
        if (btnSave) {
          btnSave.innerHTML = `<i data-lucide="save"></i> Hubungkan CCTV`;
        }

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

        const name = document.getElementById('cctv-input-name').value;
        const location = document.getElementById('cctv-input-location').value;
        const description = document.getElementById('cctv-input-description').value;
        const vendor = document.getElementById('cctv-input-vendor').value;
        const host = document.getElementById('cctv-input-host').value;
        const port = document.getElementById('cctv-input-port').value;
        const protocol = document.getElementById('cctv-input-mode').value;
        const username = document.getElementById('cctv-input-username').value;
        const password = document.getElementById('cctv-input-password').value;

        btnSave.disabled = true;

        try {
          if (this.editingCctvId) {
            // Edit Mode
            const payload = {
              name,
              location,
              description,
              vendor,
              protocol,
              username,
              password,
              streamUrl: host + (port ? `:${port}` : '')
            };
            await CctvService.updateCctv(this.editingCctvId, payload);
            EventBus.emit('toast:show', { message: 'Konfigurasi CCTV berhasil diperbarui!', type: 'success' });
          } else {
            // Create Mode
            if (!detectedConfig) return;
            detectedConfig.name = name;
            detectedConfig.location = location;
            detectedConfig.description = description;
            await CctvService.connectCctv(detectedConfig);
            EventBus.emit('toast:show', { message: 'CCTV Baru berhasil dihubungkan ke sistem!', type: 'success' });
          }

          modal.style.display = 'none';
          
          // Reload
          await this.loadData();
          
          // If drawer is open, refresh it
          if (this.editingCctvId) {
            const drawer = document.getElementById('cctv-detail-drawer');
            if (drawer && drawer.style.right === '0px') {
              this.openCCTVDetailDrawer(this.editingCctvId);
            }
          }
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menyimpan CCTV: ${err.message}`, type: 'danger' });
          btnSave.disabled = false;
        }
      });
    }
  }

  initEyecoInfoModal() {
    const btnEdit = document.getElementById('btn-edit-eyeco-info');
    const modal = document.getElementById('edit-eyeco-info-modal');
    const btnClose = document.getElementById('btn-close-eyeco-modal');
    const btnCancel = document.getElementById('btn-cancel-eyeco-modal');
    const form = document.getElementById('edit-eyeco-info-form');
    const btnSave = document.getElementById('btn-save-eyeco-info');

    const inputAbout = document.getElementById('eyeco-input-about');
    const inputTerkini = document.getElementById('eyeco-input-terkini');
    const inputSampah = document.getElementById('eyeco-input-sampah');

    if (!modal) return;

    const openModal = async () => {
      modal.style.display = 'flex';
      
      try {
        const settings = await API.get('/api/system-settings');
        const infoSetting = settings.find(s => s.key === 'eyeco.information');
        
        if (infoSetting && infoSetting.value) {
          const val = infoSetting.value;
          inputAbout.value = val.about || '';
          inputTerkini.value = Array.isArray(val.terkini) ? val.terkini.join('\n') : '';
          inputSampah.value = Array.isArray(val.sampah) ? val.sampah.join('\n') : '';
        } else {
          inputAbout.value = "EYECO adalah platform monitoring aliran sungai berbasis AI berbasis Deep Learning (YOLOv8) untuk mendeteksi sampah dan aktivitas pembuangan sampah liar secara real-time.";
          inputTerkini.value = [
            "Uji Coba Model AI Baru (yolov8-river-v1.1-canary) berhasil disebarkan di Sektor 7 Hulu.",
            "Fitur laporan otomatis via bot telegram interaktif kini dapat digunakan oleh seluruh warga.",
            "Pembersihan massal sungai Ciliwung bersama dinas kebersihan dijadwalkan pada hari Sabtu ini."
          ].join('\n');
          inputSampah.value = [
            "Daur Ulang Plastik: Plastik PET membutuhkan waktu hingga 450 tahun untuk terurai di alam bebas.",
            "Bahaya Sampah Sungai: Penumpukan sampah organik di dasar sungai memicu eutrofikasi dan mengurangi oksigen air.",
            "Kampanye Pilah Sampah: Memisahkan sampah organik dan anorganik dari rumah membantu mempercepat proses daur ulang."
          ].join('\n');
        }
      } catch (err) {
        console.error('Failed to load EYECO information settings:', err);
      }
    };

    const closeModal = () => {
      modal.style.display = 'none';
    };

    if (btnEdit) {
      btnEdit.addEventListener('click', openModal);
    }
    if (btnClose) {
      btnClose.addEventListener('click', closeModal);
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', closeModal);
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btnSave.disabled = true;

        const about = inputAbout.value.trim();
        const terkini = inputTerkini.value.split('\n').map(l => l.trim()).filter(Boolean);
        const sampah = inputSampah.value.split('\n').map(l => l.trim()).filter(Boolean);

        try {
          await API.post('/api/system-settings', {
            key: 'eyeco.information',
            value: { about, terkini, sampah },
            reason: 'Updated via EYECO Info Management Modal',
            approvedBy: 'Admin'
          });

          EventBus.emit('toast:show', {
            message: 'Informasi EYECO berhasil diperbarui.',
            type: 'success'
          });
          closeModal();
        } catch (err) {
          console.error('Failed to save EYECO information settings:', err);
          EventBus.emit('toast:show', {
            message: `Gagal memperbarui informasi: ${err.message}`,
            type: 'danger'
          });
        } finally {
          btnSave.disabled = false;
        }
      });
    }
  }

  openEditCctvModal(ch) {
    this.editingCctvId = ch.id;
    const modal = document.getElementById('connect-cctv-modal');
    const form = document.getElementById('connect-cctv-form');
    const btnSave = document.getElementById('btn-save-cctv');
    const scannerBox = document.querySelector('.scanner-hud-box');
    
    if (!modal || !form) return;

    // Reset Form
    form.reset();
    scannerBox.style.display = 'none';

    // Set title
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) {
      modalTitle.innerHTML = `<i data-lucide="settings"></i> Pengaturan & Pemeliharaan CCTV`;
    }

    // Set button text
    if (btnSave) {
      btnSave.innerHTML = `<i data-lucide="save"></i> Simpan Konfigurasi`;
      btnSave.disabled = false;
    }

    // Pre-fill values
    document.getElementById('cctv-input-name').value = ch.name || '';
    document.getElementById('cctv-input-location').value = ch.location || '';
    document.getElementById('cctv-input-description').value = ch.description || '';
    document.getElementById('cctv-input-vendor').value = ch.vendor || 'GENERIC';
    
    // Extract host and port from streamUrl
    let host = ch.streamUrl || '';
    let port = '554';
    if (host.includes('://')) {
      const urlPart = host.split('://')[1];
      const hostPort = urlPart.split('/')[0];
      if (hostPort.includes(':')) {
        host = hostPort.split(':')[0];
        port = hostPort.split(':')[1];
      } else {
        host = hostPort;
      }
    } else if (host.includes(':')) {
      host = ch.streamUrl.split(':')[0];
      port = ch.streamUrl.split(':')[1];
    }
    
    document.getElementById('cctv-input-host').value = host;
    document.getElementById('cctv-input-port').value = port;
    document.getElementById('cctv-input-mode').value = ch.protocol || 'AUTO';
    document.getElementById('cctv-input-username').value = ch.username || '';
    document.getElementById('cctv-input-password').value = ch.password || '';

    // Show modal
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async reconnectCCTVStream(id) {
    try {
      EventBus.emit('toast:show', { message: `Menginisialisasi ulang koneksi kamera...`, type: 'info' });
      await CctvService.reconnectCctv(id);
      EventBus.emit('toast:show', { message: `Kamera berhasil dihubungkan kembali.`, type: 'success' });
      await this.loadData();
      // If drawer is open, refresh it
      const drawer = document.getElementById('cctv-detail-drawer');
      if (drawer && drawer.style.right === '0px') {
        this.openCCTVDetailDrawer(id);
      }
    } catch (err) {
      console.error(err);
      EventBus.emit('toast:show', { message: `Gagal menghubungkan kembali: ${err.message}`, type: 'danger' });
    }
  }

  async takeCCTVSnapshot(id) {
    try {
      const ch = this.cctvList.find(c => c.id === id);
      if (!ch) return;
      EventBus.emit('toast:show', { message: `Mengambil foto snapshot dari kamera...`, type: 'info' });
      
      const matchReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
      const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : '/uploads/detection_1.jpg');

      const a = document.createElement('a');
      a.href = imageSrc;
      a.download = `Snapshot_${ch.name}_${new Date().toISOString().slice(0, 10)}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      EventBus.emit('toast:show', { message: `Snapshot "${ch.name}" berhasil disimpan!`, type: 'success' });
      await this.loadData();
    } catch (err) {
      console.error(err);
      EventBus.emit('toast:show', { message: `Gagal mengambil snapshot: ${err.message}`, type: 'danger' });
    }
  }

  openCCTVDetailDrawer(channelId) {
    const ch = this.cctvList.find(c => c.id === channelId);
    if (!ch) return;

    const drawer = document.getElementById('cctv-detail-drawer');
    if (!drawer) return;

    const isMon = AppState.get('isMonitoring');
    const isChActive = isMon && ch.isActive;
    const matchReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
    const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : '/uploads/detection_1.jpg');
    const statusText = isChActive ? (ch.status === 'ONLINE' ? 'ONLINE' : ch.status) : 'STANDBY';
    const statusColor = statusText === 'ONLINE' ? 'var(--success)' : 'var(--danger)';

    // Render drawer interior
    drawer.innerHTML = `
      <div class="drawer-header" style="padding: 20px; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; background: #fafafa; border-top-left-radius: var(--radius-card); border-top-right-radius: var(--radius-card);">
        <div style="display: flex; flex-direction: column; gap: 4px; max-width: 80%;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="status-pulse-dot" style="width: 8px; height: 8px; background: ${statusColor}; border-radius: 50%; display: inline-block;"></span>
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.1rem; font-weight: 800; color: var(--text-primary); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="drawer-camera-name">${ch.name}</h3>
          </div>
          <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600;" id="drawer-camera-location">${ch.location}</span>
        </div>
        <button id="btn-close-drawer" style="background: none; border: none; font-size: 1.6rem; cursor: pointer; color: var(--text-secondary); font-weight: 800; padding: 0 4px;">&times;</button>
      </div>

      <div class="drawer-body" style="padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 20px;">
        <!-- Preview image / player -->
        <div class="drawer-feed-container" style="width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; position: relative; border: 1px solid rgba(0,0,0,0.05);">
          ${isChActive ? (ch.mediaType === 'Video' ? `
            <video id="drawer-preview-video" style="width:100%; height:100%; object-fit: cover;" src="${ch.playUrl}" autoplay loop muted playsinline></video>
          ` : `
            <img id="drawer-preview-img" style="width:100%; height:100%; object-fit: cover;" src="${imageSrc}" />
          `) : `
            <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #111; color: #666; font-size: 0.8rem; font-weight: 700;">
              MONITORING INACTIVE
            </div>
          `}
          <div class="drawer-rec-hud" style="position: absolute; top: 12px; left: 12px; display: flex; gap: 6px;">
            <span class="badge" style="background: var(--danger); color: white; font-size: 0.65rem; font-weight: 800; border-radius: 4px; padding: 2px 6px; display: flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; background: white; border-radius: 50%; display: inline-block; animation: pulse-cloud 1s infinite;"></span>
              REC
            </span>
            <span class="badge" style="background: var(--primary); color: white; font-size: 0.65rem; font-weight: 800; border-radius: 4px; padding: 2px 6px;">HD</span>
          </div>
        </div>

        <!-- Camera Health Specs Center -->
        <div style="display: flex; flex-direction: column; gap: var(--space-8);">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0; letter-spacing: 0.5px;">Camera Health Center</h4>
          
          <div style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.03); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: var(--text-secondary); font-weight: 600;">Status Koneksi</span>
              <strong id="drawer-health-status" style="color: ${statusColor};">${statusText}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: var(--text-secondary); font-weight: 600;">Resolusi Stream</span>
              <strong id="drawer-health-resolution">1920 x 1080 (HD)</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: var(--text-secondary); font-weight: 600;">Jaringan Latency</span>
              <strong id="drawer-health-latency">${ch.health.latency ? `${ch.health.latency} ms` : '52 ms'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: var(--text-secondary); font-weight: 600;">Uptime Sistem</span>
              <strong id="drawer-health-uptime">99.8%</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: var(--text-secondary); font-weight: 600;">Packet Loss</span>
              <strong id="drawer-health-packetloss" style="color: var(--success);">0.1%</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: var(--text-secondary); font-weight: 600;">Reconnect Queue</span>
              <strong id="drawer-health-reconnect">0 Antrean</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; border-top: 1px solid rgba(0,0,0,0.05); padding-top: var(--space-8); margin-top: 2px;">
              <span style="color: var(--text-secondary); font-weight: 600;">Pemantauan AI</span>
              <strong id="drawer-health-ai" style="color: ${ch.monitoringEnabled ? 'var(--success)' : 'var(--danger)'};">
                ${ch.monitoringEnabled ? 'AKTIF' : 'PAUSED'}
              </strong>
            </div>
          </div>
        </div>

        <!-- Quick Actions Menu -->
        <div style="display: flex; flex-direction: column; gap: var(--space-8);">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0; letter-spacing: 0.5px;">Quick Operator Actions</h4>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button class="btn btn-glass btn-rounded" id="drawer-btn-reconnect" style="font-size: 0.78rem; font-weight: 700; border-color: rgba(47,107,255,0.25); color: var(--primary); justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0;">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Reconnect
            </button>
            <button class="btn btn-glass btn-rounded" id="drawer-btn-snapshot" style="font-size: 0.78rem; font-weight: 700; border-color: rgba(0,0,0,0.1); color: var(--text-primary); justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0;">
              <i data-lucide="camera" style="width: 14px; height: 14px;"></i> Snapshot
            </button>
            <button class="btn btn-glass btn-rounded" id="drawer-btn-stream" style="font-size: 0.78rem; font-weight: 700; border-color: rgba(0,0,0,0.1); color: var(--text-primary); justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0;">
              <i data-lucide="external-link" style="width: 14px; height: 14px;"></i> Fullscreen
            </button>
            <button class="btn btn-glass btn-rounded" id="drawer-btn-maintenance" style="font-size: 0.78rem; font-weight: 700; border-color: rgba(0,0,0,0.1); color: var(--text-primary); justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0;">
              <i data-lucide="settings" style="width: 14px; height: 14px;"></i> Settings
            </button>
            <button class="btn ${ch.monitoringEnabled ? 'btn-danger' : 'btn-success'} btn-rounded" id="drawer-btn-toggle-ai" style="grid-column: span 2; font-size: 0.78rem; font-weight: 700; justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0; color: white;">
              <i data-lucide="${ch.monitoringEnabled ? 'video-off' : 'video'}" style="width: 14px; height: 14px;"></i> 
              ${ch.monitoringEnabled ? 'Hentikan Pemantauan AI' : 'Mulai Pemantauan AI'}
            </button>
          </div>
        </div>

        <!-- Camera Incident History -->
        <div style="display: flex; flex-direction: column; gap: var(--space-8);">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0; letter-spacing: 0.5px;">Recent Event Log</h4>
          <div id="drawer-camera-history" style="display: flex; flex-direction: column; gap: 8px;">
            <!-- Populate from latest reports matching this location -->
          </div>
        </div>
      </div>
    `;

    // Bind event log items
    const historyList = drawer.querySelector('#drawer-camera-history');
    if (historyList) {
      const cameraReports = this.latestReports.filter(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
      if (cameraReports.length === 0) {
        historyList.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-secondary);">No events logged for this sector.</div>`;
      } else {
        cameraReports.slice(0, 3).forEach(r => {
          const logItem = document.createElement('div');
          logItem.style.cssText = 'display:flex; flex-direction:column; gap:4px; padding: 8px 12px; background: rgba(0,0,0,0.01); border: 1px solid rgba(0,0,0,0.02); border-radius: 8px; font-size: 0.75rem;';
          const labelColor = r.aiStatus === 'TINGGI' ? 'var(--danger)' : 'var(--warning)';
          const category = r.boundingBoxes && r.boundingBoxes[0] ? r.boundingBoxes[0].label : 'Sampah';
          
          logItem.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 700; color: ${labelColor}; text-transform: uppercase; font-size: 0.65rem;">${r.aiStatus} WARNING</span>
              <span style="color: var(--text-secondary); font-size: 0.65rem;">${new Date(r.timestamp).toLocaleTimeString('id-ID')}</span>
            </div>
            <div style="font-weight: 600; color: var(--text-primary); margin-top:2px;">Terdeteksi objek "${category}"</div>
          `;
          historyList.appendChild(logItem);
        });
      }
    }

    // Bind drawer close button
    const btnClose = drawer.querySelector('#btn-close-drawer');
    if (btnClose) btnClose.onclick = () => this.closeCCTVDetailDrawer();

    // Bind quick actions
    const btnReconnect = drawer.querySelector('#drawer-btn-reconnect');
    const btnSnapshot = drawer.querySelector('#drawer-btn-snapshot');
    const btnStream = drawer.querySelector('#drawer-btn-stream');
    const btnMaintenance = drawer.querySelector('#drawer-btn-maintenance');

    if (btnReconnect) btnReconnect.onclick = () => this.reconnectCCTVStream(ch.id);
    if (btnSnapshot) btnSnapshot.onclick = () => this.takeCCTVSnapshot(ch.id);
    if (btnStream) btnStream.onclick = () => {
      this.closeCCTVDetailDrawer();
      this.openVmsController(ch.id);
    };
    if (btnMaintenance) btnMaintenance.onclick = () => {
      this.closeCCTVDetailDrawer();
      this.openEditCctvModal(ch);
    };

    const btnToggleAi = drawer.querySelector('#drawer-btn-toggle-ai');
    if (btnToggleAi) {
      btnToggleAi.onclick = async () => {
        const nextState = !ch.monitoringEnabled;
        try {
          await CctvService.toggleCameraMonitoring(ch.id, nextState);
          EventBus.emit('toast:show', {
            message: nextState ? `Pemantauan AI aktif untuk ${ch.name}!` : `Pemantauan AI dinonaktifkan untuk ${ch.name}!`,
            type: nextState ? 'success' : 'warning'
          });
          // Reload local list and redraw drawer
          this.cctvList = await CctvService.getCctvList();
          this.openCCTVDetailDrawer(ch.id);
          this.renderCCTVGrid();
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengubah status pemantauan kamera.', type: 'danger' });
        }
      };
    }

    if (window.lucide) window.lucide.createIcons();

    // Slide open
    drawer.style.right = '0px';
  }

  closeCCTVDetailDrawer() {
    const drawer = document.getElementById('cctv-detail-drawer');
    if (drawer) drawer.style.right = '-400px';
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

    const btnToggleAiMon = document.getElementById('vms-fs-btn-toggle-ai-mon');
    const btnMore = document.getElementById('vms-fs-btn-more');
    const moreDropdown = document.getElementById('vms-fs-more-dropdown');
    const dropSettings = document.getElementById('vms-fs-drop-settings');
    const dropReconnect = document.getElementById('vms-fs-drop-reconnect');
    const dropToggleOverlay = document.getElementById('vms-fs-drop-toggle-overlay');
    const dropDeleteContainer = document.getElementById('vms-fs-drop-delete-container');
    const dropDelete = document.getElementById('vms-fs-drop-delete');

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
    let micStream = null;

    const matchReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
    const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : '/uploads/detection_1.jpg');

    // 1. Render Active player view
    const renderActivePlayer = () => {
      let playerHtml = '';
      if (ch.mediaType === 'Cloud') {
        const playUrl = ch.playUrl && ch.playUrl !== '/cloud-viewer' ? ch.playUrl : '/uploads/orang buang sampah.mp4';
        playerHtml = `
          <video src="${playUrl}" id="vms-fs-media-element" autoplay loop ${isMuted ? 'muted' : ''} playsinline style="width:100%; height:100%; object-fit:contain;"></video>
          <div style="position: absolute; top: 12px; right: 16px; z-index: 10;">
            <a href="${ch.streamUrl || '#'}" target="_blank" class="btn btn-primary btn-sm btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="display: flex; align-items: center; gap: 6px; font-weight: 600; background: var(--primary) !important; color: white !important; text-decoration: none;">
              <i data-lucide="cloud" style="width: 14px; height: 14px;"></i> Buka Cloud App
            </a>
          </div>
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
      } else if (ch.mediaType === 'Video') {
        let cloudOverlayHtml = '';
        if (ch.protocol === 'CLOUD_VIEWER') {
          cloudOverlayHtml = `
            <div style="position: absolute; top: 12px; right: 16px; z-index: 10;">
              <a href="${ch.streamUrl || '#'}" target="_blank" class="btn btn-primary btn-sm btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="display: flex; align-items: center; gap: 6px; font-weight: 600; background: var(--primary) !important; color: white !important; text-decoration: none;">
                <i data-lucide="cloud" style="width: 14px; height: 14px;"></i> Buka Cloud App
              </a>
            </div>
          `;
        }
        playerHtml = `
          <video src="${ch.playUrl}" id="vms-fs-media-element" autoplay loop ${isMuted ? 'muted' : ''} playsinline style="width:100%; height:100%; object-fit:contain;"></video>
          ${cloudOverlayHtml}
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

      // Check and attach HLS to fullscreen player
      if (ch.playUrl && ch.playUrl.includes('.m3u8')) {
        const videoEl = document.getElementById('vms-fs-media-element');
        if (videoEl && videoEl.tagName === 'VIDEO') {
          videoEl.removeAttribute('src');
          if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({
              maxBufferSize: 0,
              maxBufferLength: 2,
              liveSyncDurationCount: 3
            });
            hls.loadSource(ch.playUrl);
            hls.attachMedia(videoEl);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
              videoEl.play().catch(e => console.log('HLS fs play fail:', e));
            });
            videoEl._hlsInstance = hls;
          } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = ch.playUrl;
          }
        }
      }

      setTimeout(() => {
        renderYoloBoxes();
      }, 50);

      this.activeRenderYoloBoxes = renderYoloBoxes;
    };

    const renderYoloBoxes = () => {
      const yoloOverlay = document.getElementById('vms-fs-yolo-overlay');
      if (!yoloOverlay) return;
      yoloOverlay.innerHTML = '';
      if (!isAiActive) return;

      // Align overlay container precisely with the actual displayed media boundaries (contain math)
      const mediaEl = document.getElementById('vms-fs-media-element');
      const mediaContainer = playerContainer;

      if (mediaEl && mediaContainer) {
        const containerWidth = mediaContainer.clientWidth;
        const containerHeight = mediaContainer.clientHeight;
        if (containerWidth > 0 && containerHeight > 0) {
          const mediaWidth = mediaEl.naturalWidth || mediaEl.videoWidth || 1280;
          const mediaHeight = mediaEl.naturalHeight || mediaEl.videoHeight || 720;
          
          if (mediaWidth > 0 && mediaHeight > 0) {
            const containerRatio = containerWidth / containerHeight;
            const mediaRatio = mediaWidth / mediaHeight;

            let displayedWidth = 0;
            let displayedHeight = 0;
            let displayedLeft = 0;
            let displayedTop = 0;

            if (mediaRatio > containerRatio) {
              displayedWidth = containerWidth;
              displayedHeight = containerWidth / mediaRatio;
              displayedLeft = 0;
              displayedTop = (containerHeight - displayedHeight) / 2;
            } else {
              displayedHeight = containerHeight;
              displayedWidth = containerHeight * mediaRatio;
              displayedLeft = (containerWidth - displayedWidth) / 2;
              displayedTop = 0;
            }

            yoloOverlay.style.left = `${displayedLeft}px`;
            yoloOverlay.style.top = `${displayedTop}px`;
            yoloOverlay.style.width = `${displayedWidth}px`;
            yoloOverlay.style.height = `${displayedHeight}px`;
          }
        }

        // Attach listeners to trigger realignment once metadata/dimensions are loaded
        if (!mediaEl.hasAttribute('data-aligned-listener')) {
          mediaEl.setAttribute('data-aligned-listener', 'true');
          const reAlign = () => {
            renderYoloBoxes();
          };
          mediaEl.addEventListener('loadedmetadata', reAlign);
          mediaEl.addEventListener('load', reAlign);
        }
      }

      const currentReport = this.latestReports.find(r => r.location.toLowerCase().includes(ch.name.toLowerCase()));
      if (currentReport && currentReport.boundingBoxes) {
        currentReport.boundingBoxes.forEach(box => {
          let boxColorClass = 'yolo-default';
          if (box.label === 'person') boxColorClass = 'yolo-person';
          if (box.label === 'trash') boxColorClass = 'yolo-trash';
          if (box.label === 'boat') boxColorClass = 'yolo-boat';

          const el = document.createElement('div');
          el.className = `yolo-preview-box ${boxColorClass}`;
          el.setAttribute('data-camera-id', ch.id);
          el.setAttribute('data-confidence', `${Math.round(box.confidence * 100)}%`);
          el.style.cssText = `
            position: absolute;
            top: ${box.y}%; 
            left: ${box.x}%; 
            width: ${box.w}%; 
            height: ${box.h}%;
          `;
          el.innerHTML = `<span class="yolo-preview-label">${box.label.toUpperCase().replace('_', ' ')} [${Math.round(box.confidence * 100)}%]</span>`;
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

      // Scrub simulation
      const media = document.getElementById('vms-fs-media-element');
      if (media) {
        if (ch.mediaType === 'Video') {
          if (media.duration) {
            media.currentTime = (val / 1440) * media.duration;
          }
        } else if (ch.mediaType === 'Image') {
          const frameIndex = (val % 4) + 1;
          media.src = `/uploads/detection_${frameIndex}.jpg`;
        }
      }
    };
    timelineSlider.oninput = updateSeekerProgress;



    // 4. Back/Close button handler
    let handleClose = () => {
      page.style.display = 'none';
      if (recordInterval) {
        clearInterval(recordInterval);
      }
      this.activeRenderYoloBoxes = null;
      this.loadData();
    };
    btnBack.onclick = handleClose;

    // 5. Controls binding
    btnPlay.onclick = () => {
      const media = document.getElementById('vms-fs-media-element');
      if (!media) return;
      if (isPlaying) {
        if (ch.mediaType === 'Video') media.pause();
        btnPlay.innerText = 'PLAY';
        isPlaying = false;
        EventBus.emit('toast:show', { message: 'Video dijeda.', type: 'info' });
      } else {
        if (ch.mediaType === 'Video') media.play();
        btnPlay.innerText = 'PAUSE';
        isPlaying = true;
        EventBus.emit('toast:show', { message: 'Video dilanjutkan.', type: 'info' });
      }
    };

    btnMute.onclick = () => {
      const media = document.getElementById('vms-fs-media-element');
      if (!media) return;
      if (isMuted) {
        if (ch.mediaType === 'Video') media.muted = false;
        btnMute.innerText = 'MUTE';
        isMuted = false;
        EventBus.emit('toast:show', { message: 'Suara aktif.', type: 'info' });
      } else {
        if (ch.mediaType === 'Video') media.muted = true;
        btnMute.innerText = 'SOUND';
        isMuted = true;
        EventBus.emit('toast:show', { message: 'Suara dimatikan.', type: 'info' });
      }
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
      if (!document.fullscreenElement) {
        if (page.requestFullscreen) {
          page.requestFullscreen();
        } else if (page.webkitRequestFullscreen) {
          page.webkitRequestFullscreen();
        }
        btnRotate.innerHTML = '<i data-lucide="minimize"></i>';
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        btnRotate.innerHTML = '<i data-lucide="screen-share"></i>';
      }
      if (window.lucide) window.lucide.createIcons();
    };

    const onFsChange = () => {
      if (!document.fullscreenElement) {
        btnRotate.innerHTML = '<i data-lucide="screen-share"></i>';
      } else {
        btnRotate.innerHTML = '<i data-lucide="minimize"></i>';
      }
      if (window.lucide) window.lucide.createIcons();
    };
    document.addEventListener('fullscreenchange', onFsChange);

    const originalHandleClose = handleClose;
    handleClose = () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
      }
      originalHandleClose();
    };
    btnBack.onclick = handleClose;

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

        // Download stream/recording simulation file
        if (ch.mediaType === 'Video') {
          const a = document.createElement('a');
          a.href = ch.playUrl;
          a.download = `Rekaman_${ch.name}_${new Date().toISOString().slice(0, 10)}.mp4`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          const a = document.createElement('a');
          a.href = imageSrc;
          a.download = `Rekaman_${ch.name}_${new Date().toISOString().slice(0, 10)}.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        EventBus.emit('toast:show', { message: 'Klip rekaman berhasil disimpan ke galeri lokal.', type: 'success' });
      }
    };

    btnActMic.onclick = async () => {
      btnActMic.classList.toggle('active');
      const isActive = btnActMic.classList.contains('active');
      
      if (isActive) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          EventBus.emit('toast:show', { 
            message: 'Interkom suara aktif. Mikrofon terhubung.', 
            type: 'success' 
          });
        } catch (err) {
          btnActMic.classList.remove('active');
          EventBus.emit('toast:show', { 
            message: 'Akses mikrofon ditolak atau tidak tersedia.', 
            type: 'danger' 
          });
        }
      } else {
        if (micStream) {
          micStream.getTracks().forEach(track => track.stop());
          micStream = null;
        }
        EventBus.emit('toast:show', { 
          message: 'Interkom suara dinonaktifkan.', 
          type: 'info' 
        });
      }
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

    // Header actions binding
    const updateAiMonButtonState = () => {
      if (btnToggleAiMon) {
        btnToggleAiMon.style.color = ch.monitoringEnabled ? 'var(--primary)' : 'var(--text-secondary)';
        btnToggleAiMon.title = ch.monitoringEnabled ? 'Hentikan Pemantauan AI' : 'Mulai Pemantauan AI';
      }
    };
    updateAiMonButtonState();

    if (btnToggleAiMon) {
      btnToggleAiMon.onclick = async (e) => {
        e.stopPropagation();
        const nextState = !ch.monitoringEnabled;
        try {
          await CctvService.toggleCameraMonitoring(ch.id, nextState);
          ch.monitoringEnabled = nextState;
          updateAiMonButtonState();
          
          EventBus.emit('toast:show', {
            message: nextState ? `Pemantauan AI aktif untuk ${ch.name}!` : `Pemantauan AI dinonaktifkan untuk ${ch.name}!`,
            type: nextState ? 'success' : 'warning'
          });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengubah status pemantauan kamera.', type: 'danger' });
        }
      };
    }

    if (btnMore && moreDropdown) {
      btnMore.onclick = (e) => {
        e.stopPropagation();
        const isHidden = moreDropdown.style.display === 'none';
        moreDropdown.style.display = isHidden ? 'block' : 'none';
      };
      
      const closeDropdown = () => {
        moreDropdown.style.display = 'none';
      };
      document.addEventListener('click', closeDropdown);

      const originalHandleClose = handleClose;
      handleClose = () => {
        document.removeEventListener('click', closeDropdown);
        originalHandleClose();
      };
    }

    if (dropSettings) {
      dropSettings.onclick = (e) => {
        e.stopPropagation();
        moreDropdown.style.display = 'none';
        page.style.display = 'none'; // Close player
        this.openEditCctvModal(ch);
      };
    }

    if (dropReconnect) {
      dropReconnect.onclick = (e) => {
        e.stopPropagation();
        moreDropdown.style.display = 'none';
        this.reconnectCCTVStream(ch.id);
      };
    }

    if (dropToggleOverlay) {
      dropToggleOverlay.onclick = (e) => {
        e.stopPropagation();
        moreDropdown.style.display = 'none';
        btnActAi.click(); // Trigger AI overlay toggle
      };
    }

    // Show/hide delete option in dropdown
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';
    if (dropDeleteContainer) {
      dropDeleteContainer.style.display = isAdmin ? 'block' : 'none';
    }

    if (dropDelete) {
      dropDelete.onclick = async (e) => {
        e.stopPropagation();
        moreDropdown.style.display = 'none';
        
        const confirmDel = confirm(`Apakah Anda yakin ingin memutuskan koneksi CCTV: "${ch.name}"?`);
        if (!confirmDel) return;

        try {
          page.style.display = 'none'; // Close player
          await CctvService.disconnectCctv(ch.id);
          EventBus.emit('toast:show', { message: `Koneksi CCTV "${ch.name}" berhasil diputuskan.`, type: 'success' });
          await this.loadData();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
        }
      };
    }

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

      // Load AI Engine Telemetry for HUD
      try {
        const readyStatus = await API.get('/health/ready');
        if (readyStatus && readyStatus.aiEngine) {
          const ai = readyStatus.aiEngine;
          const hudStatus = document.getElementById('hud-engine-status');
          const hudDot = document.getElementById('hud-engine-dot');
          const hudQueue = document.getElementById('hud-queue-depth');
          const hudCap = document.getElementById('hud-queue-capacity');
          const hudFps = document.getElementById('hud-inference-fps');
          const hudModel = document.getElementById('hud-active-model');

          if (hudStatus) {
            hudStatus.innerText = ai.status || 'HEALTHY';
            if (ai.status === 'SLOW') {
              hudStatus.style.color = 'var(--warning)';
              if (hudDot) hudDot.style.background = 'var(--warning)';
            } else if (ai.status === 'DEGRADED') {
              hudStatus.style.color = 'var(--danger)';
              if (hudDot) hudDot.style.background = 'var(--danger)';
            } else if (ai.status === 'OFFLINE') {
              hudStatus.style.color = 'var(--text-muted)';
              if (hudDot) hudDot.style.background = 'var(--text-muted)';
            } else {
              hudStatus.style.color = 'var(--success)';
              if (hudDot) hudDot.style.background = 'var(--success)';
            }
          }
          if (hudQueue) hudQueue.innerText = ai.queueLength ?? '0';
          if (hudCap) hudCap.innerText = ai.queueCapacity ?? '50';
          if (hudFps) hudFps.innerText = (ai.fpsThroughput !== undefined ? ai.fpsThroughput : 0.0).toFixed(1);
          if (hudModel) hudModel.innerText = ai.activeModelName || 'yolov8-river-v1.0';
        }
      } catch (hudErr) {
        console.warn('Failed to load AI HUD telemetry status:', hudErr);
      }
      
      // Load system settings for telegram alerts
      try {
        const sysSettings = await API.get('/api/system-settings');
        if (sysSettings && Array.isArray(sysSettings)) {
          const telegramSetting = sysSettings.find(s => s.key === 'telegram.enabled');
          if (telegramSetting) {
            const isEnabled = telegramSetting.value === true;
            AppState.set('telegramAlerts', isEnabled);
            const toggleTelegram = document.getElementById('toggle-telegram-alerts');
            if (toggleTelegram) {
              toggleTelegram.checked = isEnabled;
            }
          }
          const engineSetting = sysSettings.find(s => s.key === 'ai.engine');
          if (engineSetting) {
            const selectEngine = document.getElementById('ai-engine-select');
            if (selectEngine) {
              selectEngine.value = engineSetting.value || 'MOCK';
            }
          }
        }
      } catch (sysErr) {
        console.error('Failed to sync telegram setting from backend:', sysErr);
      }

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
      if (this.activeRenderYoloBoxes) {
        this.activeRenderYoloBoxes();
      }
    } catch (err) {
      console.error('[DashboardPage] loadData failed:', err);
      this.renderError();
    }
  }

  updateCameraSelectOptions() {
    const selectCam = document.getElementById('cctv-select-camera');
    const filterCam = document.getElementById('incident-filter-camera');
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

    if (filterCam) {
      const filterVal = filterCam.value;
      filterCam.innerHTML = `<option value="all">Semua Kamera</option>`;
      this.cctvList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `CAM-${c.id.toString().padStart(2, '0')} · ${c.name}`;
        if (c.id.toString() === filterVal) opt.selected = true;
        filterCam.appendChild(opt);
      });
    }
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

  formatCameraUptime(ch) {
    if (ch.status !== 'ONLINE') {
      const ref = ch.lastHeartbeat || ch.lastConnected;
      const mins = ref ? Math.floor((Date.now() - new Date(ref).getTime()) / 60000) : 0;
      return mins > 0 ? `Disconnected ${mins} menit` : 'Disconnected';
    }
    const ref = ch.lastConnected || ch.lastHeartbeat;
    if (!ref) return 'Online';
    const hrs = Math.floor((Date.now() - new Date(ref).getTime()) / 3600000);
    return hrs < 1 ? 'Online · < 1 jam uptime' : `Online · ${hrs} jam uptime`;
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
      queue = queue.filter(r => r.id.toString().includes(this.filterId.replace(/^0+/, '')));
    }

    if (this.filterCamera && this.filterCamera !== 'all') {
      const cam = this.cctvList.find(c => c.id.toString() === this.filterCamera);
      if (cam) {
        queue = queue.filter(r =>
          r.location.toLowerCase().includes(cam.name.toLowerCase()) ||
          r.location.toLowerCase().includes(cam.location.toLowerCase())
        );
      }
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
      const dot = onSite ? '🟢' : '🔵';
      const state = onSite ? 'On Site' : 'Assigned';
      const time = Formatter.formatTime(r.timestamp);
      return `
        <div class="officer-live-item">
          <span>${dot}</span>
          <div style="flex:1; min-width:0;">
            <strong style="color: var(--text-primary);">${r.assignedOfficer}</strong>
            <div style="color: var(--text-secondary); font-size: 0.68rem;">DLH · ${state} · #${r.id.toString().padStart(4, '0')}</div>
          </div>
          <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700;">${time}</span>
        </div>
      `;
    }).join('');
  }

  updateCameraNetworkList() {
    const container = document.getElementById('cctv-network-list');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');

    this.cctvList.forEach((ch) => {
      let statusLabel = 'Offline';
      let statusColor = 'var(--text-muted)';
      let statusBg = 'rgba(0, 0, 0, 0.05)';
      let dotEmoji = '⚪';
      let metaLine = this.formatCameraUptime(ch);

      const camReports = this.latestReports.filter(r =>
        r.location.toLowerCase().includes(ch.name.toLowerCase()) ||
        r.location.toLowerCase().includes(ch.location.toLowerCase())
      );
      const activeIncident = camReports.find(r => r.adminStatus === 'MENUNGGU');
      const alertCount = camReports.filter(r => r.adminStatus === 'MENUNGGU').length;

      if (isMon) {
        if (ch.status === 'ONLINE') {
          if (activeIncident) {
            statusLabel = 'Incident Active';
            statusColor = 'var(--danger)';
            statusBg = 'rgba(239, 68, 68, 0.08)';
            dotEmoji = '🔴';
            metaLine = `AI ${activeIncident.aiConfidence}% · ${alertCount} alert`;
          } else {
            statusLabel = 'Online';
            statusColor = 'var(--success)';
            statusBg = 'rgba(34, 197, 94, 0.08)';
            dotEmoji = '🟢';
          }
        } else {
          statusLabel = 'Offline';
          statusColor = 'var(--danger)';
          statusBg = 'rgba(239, 68, 68, 0.06)';
          dotEmoji = '⚪';
        }
      }

      const item = document.createElement('div');
      item.className = 'camera-network-card hover-lift';

      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
          <div style="min-width: 0; flex: 1;">
            <div class="cam-id">${dotEmoji} CAM-${ch.id.toString().padStart(2, '0')}</div>
            <div class="cam-location">${ch.location || ch.name}</div>
            <div class="cam-meta">${metaLine}</div>
          </div>
          <span class="cam-status-pill" style="background: ${statusBg}; color: ${statusColor};">${statusLabel}</span>
        </div>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCCTVDetailDrawer(ch.id);
      });

      container.appendChild(item);
    });
  }

  animateStats() {
    const isMon = AppState.get('isMonitoring');

    // 1. Current Date
    const currentDateEl = document.getElementById('brief-current-date');
    if (currentDateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      currentDateEl.innerText = new Date().toLocaleDateString('id-ID', options);
    }

    // 2. Camera Online count
    const totalCams = this.cctvList.length;
    const onlineCount = isMon ? this.cctvList.filter(c => c.status === 'ONLINE').length : 0;
    
    // Active Alerts count (all non-resolved waiting + in progress)
    const activeAlerts = isMon ? this.latestReports.filter(r =>
      r.adminStatus === 'MENUNGGU' || (r.adminStatus === 'VALID' && r.status !== 'SELESAI')
    ).length : 0;

    // Update HUD
    const briefOnline = document.getElementById('brief-online-count');
    const briefAlerts = document.getElementById('brief-active-alerts');
    const briefSystem = document.getElementById('brief-system-status');
    const briefLast = document.getElementById('brief-last-incident');
    const hudPulse = document.getElementById('cc-hud-pulse');
    const hudCard = document.getElementById('command-center-hud');

    if (briefOnline) briefOnline.innerText = `${onlineCount}`;
    if (briefAlerts) briefAlerts.innerText = `${activeAlerts}`;
    if (briefSystem) {
      briefSystem.innerText = isMon ? '🟢 MONITORING ACTIVE' : '🔴 MONITORING INACTIVE';
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

    // Camera Health
    const camHealth = isMon ? (totalCams > 0 ? Math.round((onlineCount / totalCams) * 100) : 100) : 0;
    const camValEl = document.getElementById('stat-camera-health-val');
    const camBarEl = document.getElementById('stat-camera-health-bar');
    const camDescEl = document.getElementById('stat-camera-health-desc');

    if (camValEl) camValEl.innerText = `${camHealth}%`;
    if (camBarEl) {
      camBarEl.style.width = `${camHealth}%`;
      camBarEl.style.background = !isMon ? 'var(--text-muted)' : (camHealth >= 90 ? 'var(--success)' : (camHealth >= 60 ? 'var(--warning)' : 'var(--danger)'));
    }
    if (camDescEl) {
      camDescEl.innerText = `${onlineCount}/${totalCams} Cameras Online`;
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
          
          const severityText = isHigh ? '🔥 HIGH' : (isMed ? '🟠 MEDIUM' : '🔵 LOW');
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
              officerHtml = `<span class="officer-status-chip on-site">🟢 ${r.assignedOfficer} · Cleaning · ${Formatter.formatTime(r.timestamp)}</span>`;
            } else if (r.status === 'SELESAI') {
              officerHtml = `<span class="officer-status-chip done">✓ ${r.assignedOfficer} · Selesai</span>`;
            } else {
              officerHtml = `<span class="officer-status-chip assigned">🔵 DLH · ${r.assignedOfficer} · Assigned</span>`;
            }
          }

          item.innerHTML = `
            <div style="display:flex; align-items:center; gap:14px; min-width:0; flex: 1;">
              <div style="width: 48px; height: 48px; border-radius: 8px; overflow:hidden; flex-shrink:0; background:#000;">
                <img src="${r.image}" style="width:100%; height:100%; object-fit:cover;" alt="" />
              </div>
              <div style="min-width: 0; flex:1;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span style="font-size: 0.6rem; font-weight: 900; color: ${severityColor};">${severityText}</span>
                  <span style="font-size: 0.55rem; font-weight: 900; background: ${workflowColor}12; color: ${workflowColor}; border: 1px solid ${workflowColor}22; padding: 1px 6px; border-radius: 4px;">${workflowState}</span>
                  <strong style="font-size:0.88rem; color:var(--text-primary);">${labelText}</strong>
                  <span style="font-size: 0.68rem; font-weight: 700; color: var(--primary);">AI ${r.aiConfidence}%</span>
                  ${waitingLabel ? `<span class="waiting-time-chip">${waitingLabel}</span>` : ''}
                </div>
                <div style="font-size:0.74rem; color:var(--text-secondary); margin-top:3px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                  <span><i data-lucide="map-pin" style="width:11px;height:11px;display:inline-block;vertical-align:middle;"></i> ${r.location}</span>
                  <span>·</span>
                  <span>${Formatter.formatTime(r.timestamp)}</span>
                  <span>·</span>
                  <span>#${r.id.toString().padStart(4, '0')}</span>
                </div>
                ${officerHtml}
              </div>
            </div>
            <button class="btn btn-sm btn-glass btn-open-incident" style="border-color: rgba(47, 107, 255, 0.25); color: var(--primary); padding: 6px 14px; font-size:0.7rem; font-weight:800; flex-shrink:0;">
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
    this.updateCameraNetworkList();
    if (window.lucide) window.lucide.createIcons();
  }

  // Render Grid CCTV dinamik
  renderCCTVGrid() {
    const container = document.getElementById('cctv-grid-container');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';

    if (this.cctvList.length === 0) {
      container.classList.remove('single-channel-active');
      container.innerHTML = `
        <div class="glass-card empty-state-card" style="grid-column: 1 / -1; display: flex !important; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-20); padding: var(--space-48); text-align: center; width: 100%; border: 1px dashed rgba(47,107,255,0.25); background: var(--surface); border-radius: var(--radius-card); box-shadow: var(--glass-shadow);">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(47, 107, 255, 0.05); color: var(--primary); display: flex; align-items: center; justify-content: center;">
            <i data-lucide="video-off" style="width: 32px; height: 32px;"></i>
          </div>
          <div>
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.25rem; font-weight: 800; color: var(--text-primary); margin: 0;">Belum Ada Kamera Terhubung</h4>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 8px; max-width: 340px; line-height: 1.5; margin-bottom: 0;">Sambungkan kamera pemantauan baru untuk memulai pengawasan real-time sungai.</p>
          </div>
          ${isAdmin ? `
            <button class="btn btn-primary btn-rounded" id="btn-empty-connect-cctv" style="font-weight: 700; padding: 10px 24px; display: inline-flex; align-items: center; gap: 8px;">
              <i data-lucide="plus-circle" style="width: 16px; height: 16px;"></i> Hubungkan Kamera
            </button>
          ` : ''}
        </div>
      `;
      const btnEmptyConnect = document.getElementById('btn-empty-connect-cctv');
      if (btnEmptyConnect) {
        btnEmptyConnect.onclick = () => {
          const btnConnect = document.getElementById('btn-connect-cctv');
          if (btnConnect) btnConnect.click();
        };
      }
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const selectCam = document.getElementById('cctv-select-camera');
    const selectedValue = selectCam ? selectCam.value : 'semua';

    if (container) {
      const statsGrid = document.getElementById('dashboard-stats-grid');
      if (selectedValue === 'semua') {
        container.classList.remove('single-channel-active');
        if (statsGrid) statsGrid.classList.remove('single-view-compact');
      } else {
        container.classList.add('single-channel-active');
        if (statsGrid) statsGrid.classList.add('single-view-compact');
      }
    }

    this.cctvList.forEach(ch => {
      if (selectedValue !== 'semua' && ch.id.toString() !== selectedValue) {
        return;
      }
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
            <div class="yolo-preview-box ${boxColorClass}" 
              data-camera-id="${ch.id}" 
              data-confidence="${Math.round(box.confidence * 100)}%" 
              style="
                top: ${box.y}%; 
                left: ${box.x}%; 
                width: ${box.w}%; 
                height: ${box.h}%;
              ">
              <span class="yolo-preview-label">${box.label.toUpperCase().replace('_', ' ')} [${Math.round(box.confidence * 100)}%]</span>
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
          // Cloud vendor mode - play video simulation loop with overlay button
          const playUrl = ch.playUrl && ch.playUrl !== '/cloud-viewer' ? ch.playUrl : '/uploads/orang buang sampah.mp4';
          mediaHtml = `
            <video src="${playUrl}" autoplay loop muted playsinline class="cctv-feed-img"></video>
            <div class="cloud-action-overlay" style="position: absolute; top: 12px; right: 12px; z-index: 10;">
              <a href="${ch.streamUrl || '#'}" target="_blank" class="btn btn-primary btn-xs btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="font-size: 0.65rem; padding: 4px 8px; display: flex; align-items: center; gap: 4px; background: var(--primary) !important; color: white !important; text-decoration: none;">
                <i data-lucide="cloud" style="width: 10px; height: 10px;"></i> Buka Cloud App
              </a>
            </div>
            <div class="cctv-overlay-gradient"></div>
            <div class="yolo-bounding-boxes-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4;">
              ${boundingBoxesHtml}
            </div>
          `;
        } else if (ch.mediaType === 'Video') {
          // HTML5 Video Loop streaming simulation (support mp4, HLS)
          let cloudBtnHtml = '';
          if (ch.protocol === 'CLOUD_VIEWER') {
            cloudBtnHtml = `
              <div class="cloud-action-overlay" style="position: absolute; top: 12px; right: 12px; z-index: 10;">
                <a href="${ch.streamUrl || '#'}" target="_blank" class="btn btn-primary btn-xs btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="font-size: 0.65rem; padding: 4px 8px; display: flex; align-items: center; gap: 4px; background: var(--primary) !important; color: white !important; text-decoration: none;">
                  <i data-lucide="cloud" style="width: 10px; height: 10px;"></i> Buka Cloud App
                </a>
              </div>
            `;
          }
          mediaHtml = `
            <video src="${ch.playUrl}" autoplay loop muted playsinline class="cctv-feed-img"></video>
            ${cloudBtnHtml}
            <div class="cctv-overlay-gradient"></div>
            <div class="yolo-bounding-boxes-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4;">
              ${boundingBoxesHtml}
            </div>
          `;
        } else {
          // Default Image snapshot rendering
          mediaHtml = `
            <img src="${imageSrc}" alt="Kamera ${ch.name}" class="cctv-feed-img" loading="lazy" decoding="async">
            <div class="cctv-overlay-gradient"></div>
            <div class="yolo-bounding-boxes-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4;">
              ${boundingBoxesHtml}
            </div>
          `;
        }
      } else {
        // Pemantauan nonaktif
        mediaHtml = `
          <div class="cctv-static-screen">
            <div class="static-noise"></div>
            <div class="static-label">PAUSED</div>
          </div>
        `;
      }

      // Setup status class
      let statusClass = 'status-offline';
      let statusText = 'OFFLINE';
      if (isChActive) {
        if (ch.status === 'ONLINE' || ch.status === 'MONITORING') {
          statusClass = isAlert ? 'status-alert' : 'status-live';
          statusText = isAlert ? 'AI DETECTING' : 'LIVE';
        } else if (ch.status === 'CONNECTING' || ch.status === 'BUFFERING') {
          statusClass = 'status-connecting';
          statusText = ch.status;
        } else {
          statusClass = 'status-offline';
          statusText = ch.status;
        }
      } else if (!ch.monitoringEnabled || !isMon) {
        statusClass = 'status-offline';
        statusText = 'PAUSED';
      }

      const hoverOverlayHtml = `
        <div class="cctv-hover-overlay" style="position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; gap: 10px; opacity: 0; transition: opacity 0.15s ease; border-radius: 12px; z-index: 10;">
          <button class="hover-action-btn fs" style="width:36px; height:36px; border-radius:50%; border:none; background: rgba(255,255,255,0.9); color: var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Fullscreen Player">
            <i data-lucide="maximize-2" style="width: 16px; height: 16px;"></i>
          </button>
          <button class="hover-action-btn reconnect" style="width:36px; height:36px; border-radius:50%; border:none; background: rgba(255,255,255,0.9); color: var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Reconnect Stream">
            <i data-lucide="refresh-cw" style="width: 16px; height: 16px;"></i>
          </button>
          <button class="hover-action-btn snapshot" style="width:36px; height:36px; border-radius:50%; border:none; background: rgba(255,255,255,0.9); color: var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Take Snapshot">
            <i data-lucide="camera" style="width: 16px; height: 16px;"></i>
          </button>
          ${isAdmin ? `
            <button class="hover-action-btn toggle-mon" style="width:36px; height:36px; border-radius:50%; border:none; background: ${ch.monitoringEnabled ? 'var(--danger)' : 'var(--success)'}; color: white; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="${ch.monitoringEnabled ? 'Hentikan Pemantauan AI' : 'Mulai Pemantauan AI'}">
              <i data-lucide="${ch.monitoringEnabled ? 'video-off' : 'video'}" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="hover-action-btn toggle-active" style="width:36px; height:36px; border-radius:50%; border:none; background: ${ch.isActive ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)'}; color: white; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="${ch.isActive ? 'Nonaktifkan Saluran CCTV' : 'Aktifkan Saluran CCTV'}">
              <i data-lucide="power" style="width: 16px; height: 16px;"></i>
            </button>
          ` : ''}
          <button class="hover-action-btn detail" style="width:36px; height:36px; border-radius:50%; border:none; background: var(--primary); color: white; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Open detail VMS Drawer">
            <i data-lucide="info" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
      `;

      card.innerHTML = `
        <div class="cctv-media-container" style="position: relative; overflow: hidden; border-radius: 12px; margin-bottom: 0;">
          ${mediaHtml}
          ${hoverOverlayHtml}
          
          <!-- Corner Badges -->
          <div class="cctv-corner-badges" style="position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; z-index: 5;">
            ${isChActive ? `
              <span class="badge" style="background: var(--danger); color: white; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                <span class="rec-dot" style="width:6px; height:6px; background:white; border-radius:50%; display:inline-block; animation: pulse-cloud 1s infinite;"></span>
                REC
              </span>
              <span class="badge" style="background: var(--primary); color: white; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">LIVE</span>
              <span class="badge" style="background: var(--info); color: white; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">HD</span>
              ${isAlert ? `
                <span class="badge" style="background: var(--warning); color: white; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; animation: pulse-cloud 1.5s infinite;">
                  <i data-lucide="scan-eye" style="width: 10px; height: 10px;"></i> AI DETECTING
                </span>
              ` : ''}
            ` : `
              <span class="badge" style="background: #64748b; color: white; font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">STANDBY</span>
            `}
          </div>

          ${isAdmin ? `
            <button class="btn-disconnect-cctv" data-id="${ch.id}" title="Putuskan CCTV" style="position: absolute; top: 12px; right: 12px; z-index: 15; background: rgba(0,0,0,0.5); border: none; border-radius: 50%; width: 28px; height: 28px; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          ` : ''}
        </div>
        
        <!-- Bottom Info -->
        <div class="cctv-info-body" style="padding: 12px var(--space-8) var(--space-8) var(--space-8); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.92rem; font-weight: 700; color: var(--text-primary); margin: 0; max-width: 75%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              CH ${ch.id.toString().padStart(2, '0')} | ${ch.name}
            </h4>
            <span class="cctv-status-badge ${statusClass}" style="transform: scale(0.9); transform-origin: right;">
              <span class="status-dot"></span>
              ${statusText}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); display: flex; gap: 8px; font-weight: 600; opacity: 0.85;">
            <span>Latency: ${ch.health.latency ? `${ch.health.latency} ms` : '52 ms'}</span>
            <span>|</span>
            <span>Res: 1080p</span>
            <span>|</span>
            <span>Last Motion: ${matchReport ? '2 mins ago' : 'No motion'}</span>
          </div>
        </div>
      `;

      // Card click opens right side VMS Detail Drawer
      card.addEventListener('click', () => {
        this.openCCTVDetailDrawer(ch.id);
      });

      // Bind hover overlay quick actions
      const btnFs = card.querySelector('.hover-action-btn.fs');
      const btnRec = card.querySelector('.hover-action-btn.reconnect');
      const btnSnap = card.querySelector('.hover-action-btn.snapshot');
      const btnToggleMon = card.querySelector('.hover-action-btn.toggle-mon');
      const btnDet = card.querySelector('.hover-action-btn.detail');

      if (btnFs) {
        btnFs.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openVmsController(ch.id);
        });
      }
      if (btnRec) {
        btnRec.addEventListener('click', (e) => {
          e.stopPropagation();
          this.reconnectCCTVStream(ch.id);
        });
      }
      if (btnSnap) {
        btnSnap.addEventListener('click', (e) => {
          e.stopPropagation();
          this.takeCCTVSnapshot(ch.id);
        });
      }
      if (btnToggleMon) {
        btnToggleMon.addEventListener('click', async (e) => {
          e.stopPropagation();
          const nextState = !ch.monitoringEnabled;
          try {
            await CctvService.toggleCameraMonitoring(ch.id, nextState);
            EventBus.emit('toast:show', {
              message: nextState ? `Pemantauan AI aktif untuk ${ch.name}!` : `Pemantauan AI dinonaktifkan untuk ${ch.name}!`,
              type: nextState ? 'success' : 'warning'
            });
            await this.loadData();
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal mengubah status pemantauan kamera.', type: 'danger' });
          }
        });
      }
      if (btnDet) {
        btnDet.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openCCTVDetailDrawer(ch.id);
        });
      }

      // Bind delete action
      if (isAdmin) {
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

        // Bind toggle active (power) action
        const btnToggleActive = card.querySelector('.hover-action-btn.toggle-active');
        if (btnToggleActive) {
          btnToggleActive.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nextActiveState = !ch.isActive;
            try {
              await CctvService.toggleCameraActive(ch.id, nextActiveState);
              EventBus.emit('toast:show', { 
                message: `Saluran CCTV "${ch.name}" berhasil ${nextActiveState ? 'diaktifkan' : 'dinonaktifkan'}.`, 
                type: 'success' 
              });
              await this.loadData();
            } catch (err) {
              EventBus.emit('toast:show', { message: `Gagal mengubah status aktif CCTV: ${err.message}`, type: 'danger' });
            }
          });
        }
      }

      container.appendChild(card);

      // Check if HLS stream is used, and initialize Hls.js if browser doesn't support it natively
      if (ch.playUrl && ch.playUrl.includes('.m3u8')) {
        const videoEl = card.querySelector('.cctv-feed-img');
        if (videoEl && videoEl.tagName === 'VIDEO') {
          videoEl.removeAttribute('src');
          if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({
              maxBufferSize: 0,
              maxBufferLength: 2,
              liveSyncDurationCount: 3
            });
            hls.loadSource(ch.playUrl);
            hls.attachMedia(videoEl);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
              videoEl.play().catch(e => console.log('HLS play fail:', e));
            });
            videoEl._hlsInstance = hls;
          } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = ch.playUrl;
          }
        }
      }

      // Dynamic alignment of bounding boxes to contain aspect ratio
      const mediaEl = card.querySelector('.cctv-feed-img');
      const boxContainer = card.querySelector('.yolo-bounding-boxes-container');
      const mediaContainer = card.querySelector('.cctv-media-container');

      if (mediaEl && boxContainer && mediaContainer) {
        const alignBoxes = () => {
          const containerWidth = mediaContainer.clientWidth;
          const containerHeight = mediaContainer.clientHeight;
          if (containerWidth === 0 || containerHeight === 0) return;

          let mediaWidth = 0;
          let mediaHeight = 0;
          if (mediaEl.tagName === 'VIDEO') {
            mediaWidth = mediaEl.videoWidth;
            mediaHeight = mediaEl.videoHeight;
          } else if (mediaEl.tagName === 'IMG') {
            mediaWidth = mediaEl.naturalWidth;
            mediaHeight = mediaEl.naturalHeight;
          }

          if (mediaWidth === 0 || mediaHeight === 0) return;

          const containerRatio = containerWidth / containerHeight;
          const mediaRatio = mediaWidth / mediaHeight;

          let displayedWidth = 0;
          let displayedHeight = 0;
          let displayedLeft = 0;
          let displayedTop = 0;

          // Check if object-fit is contain (especially for single channel view or vertical videos)
          const fitMode = window.getComputedStyle(mediaEl).objectFit;
          if (fitMode === 'contain') {
            if (mediaRatio > containerRatio) {
              displayedWidth = containerWidth;
              displayedHeight = containerWidth / mediaRatio;
              displayedLeft = 0;
              displayedTop = (containerHeight - displayedHeight) / 2;
            } else {
              displayedHeight = containerHeight;
              displayedWidth = containerHeight * mediaRatio;
              displayedLeft = (containerWidth - displayedWidth) / 2;
              displayedTop = 0;
            }
          } else {
            // cover
            displayedWidth = containerWidth;
            displayedHeight = containerHeight;
            displayedLeft = 0;
            displayedTop = 0;
          }

          boxContainer.style.left = `${displayedLeft}px`;
          boxContainer.style.top = `${displayedTop}px`;
          boxContainer.style.width = `${displayedWidth}px`;
          boxContainer.style.height = `${displayedHeight}px`;
        };

        // Attach listeners for dynamic loading
        if (mediaEl.tagName === 'VIDEO') {
          mediaEl.addEventListener('loadedmetadata', alignBoxes);
        } else if (mediaEl.tagName === 'IMG') {
          mediaEl.addEventListener('load', alignBoxes);
        }
        
        // Also observe resizing (e.g. window resize or container toggle)
        const resizeObserver = new ResizeObserver(() => alignBoxes());
        resizeObserver.observe(mediaContainer);
        
        // Initial run
        setTimeout(alignBoxes, 50);
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // Filter CCTV Channels based on dropdown choice
  filterCCTVChannels(value) {
    this.renderCCTVGrid();
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

  // Populate compact notification popover (Camera Offline, New Incident, Officer Finished)
  renderLiveAlerts() {
    const container = document.getElementById('dashboard-notif-list');
    const badge = document.getElementById('notif-badge-count');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');
    const alerts = [];

    if (isMon) {
      this.cctvList.forEach(ch => {
        if (ch.status === 'OFFLINE' || ch.status === 'ERROR' || ch.status === 'DISCONNECTED') {
          alerts.push({
            icon: '🔴',
            color: 'var(--danger)',
            title: `Camera Offline: CAM-${ch.id.toString().padStart(2, '0')}`,
            desc: `${ch.name} terputus dari jaringan.`,
            id: ch.id,
            type: 'camera'
          });
        }
      });

      this.latestReports.filter(r => r.adminStatus === 'MENUNGGU').slice(0, 3).forEach(r => {
        alerts.push({
          icon: '🚨',
          color: 'var(--warning)',
          title: 'New Incident',
          desc: `#${r.id.toString().padStart(4, '0')} · ${r.location} · AI ${r.aiConfidence}%`,
          id: r.id,
          type: 'incident'
        });
      });

      this.latestReports.filter(r => r.status === 'SELESAI').slice(0, 2).forEach(r => {
        alerts.push({
          icon: '✓',
          color: 'var(--success)',
          title: 'Officer Finished',
          desc: `Kasus #${r.id.toString().padStart(4, '0')} selesai ditangani${r.assignedOfficer ? ` · ${r.assignedOfficer}` : ''}.`,
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
        if (a.type === 'incident') {
          Router.navigate(`/dashboard/detections/${a.id}`);
        } else if (a.type === 'camera') {
          this.openCCTVDetailDrawer(a.id);
        }
      });

      container.appendChild(row);
    });
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

    this.startTrackingSimulation();
  }

  getCameraBoundary(cameraId) {
    switch (cameraId) {
      case 2: // Sektor 7 Hulu (River is on the left, shack is on the right)
        return { minLeft: 10, maxLeft: 35, minTop: 25, maxTop: 75 };
      case 4: // Aliran Kampung Melayu (River center)
        return { minLeft: 42, maxLeft: 72, minTop: 30, maxTop: 70 };
      case 6: // Kali Ciliwung Depok (River is center-right)
        return { minLeft: 40, maxLeft: 78, minTop: 25, maxTop: 75 };
      case 7: // Pintu Air Karet (River center)
        return { minLeft: 30, maxLeft: 70, minTop: 35, maxTop: 70 };
      case 8: // Sektor 12 Hilir (River is left-center)
        return { minLeft: 15, maxLeft: 55, minTop: 25, maxTop: 75 };
      default: // General default (River center-middle)
        return { minLeft: 20, maxLeft: 75, minTop: 25, maxTop: 75 };
    }
  }

  startTrackingSimulation() {
    if (this.trackingTimer) clearInterval(this.trackingTimer);
    
    this.trackingTimer = setInterval(() => {
      const boxes = document.querySelectorAll('.yolo-preview-box');
      boxes.forEach(box => {
        let currentTop = parseFloat(box.style.top);
        let currentLeft = parseFloat(box.style.left);
        
        if (isNaN(currentTop) || isNaN(currentLeft)) return;

        // Read metadata
        const cameraId = parseInt(box.getAttribute('data-camera-id')) || 0;
        const boundary = this.getCameraBoundary(cameraId);

        // Apply a small random walk to simulate drifting/moving objects
        const maxDrift = 4;
        let nextTop = currentTop + (Math.random() - 0.5) * maxDrift;
        let nextLeft = currentLeft + (Math.random() - 0.5) * maxDrift;

        // Clamp inside camera-specific river stream boundary visually
        nextTop = Math.max(boundary.minTop, Math.min(boundary.maxTop, nextTop));
        nextLeft = Math.max(boundary.minLeft, Math.min(boundary.maxLeft, nextLeft));

        // Update box position styles
        box.style.top = `${nextTop}%`;
        box.style.left = `${nextLeft}%`;

        // Live Telemetry Hud update: update coordinates text in real-time!
        const label = box.querySelector('.yolo-preview-label');
        if (label) {
          const rawText = label.getAttribute('data-raw-text') || label.innerText.split('[')[0].trim();
          if (!label.hasAttribute('data-raw-text')) {
            label.setAttribute('data-raw-text', rawText);
          }
          const conf = box.getAttribute('data-confidence') || '92%';
          
          label.innerHTML = `${rawText} [${conf}] <span style="font-size:0.5rem; opacity:0.8; font-family:monospace; margin-left:6px; color:rgba(255,255,255,0.95); background:rgba(0,0,0,0.25); padding:1px 3px; border-radius:2px;">X:${Math.round(nextLeft * 10)} Y:${Math.round(nextTop * 10)}</span>`;
        }
      });
    }, 1500);
  }

  // Destructor called when page changes
  destroy() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.trackingTimer) {
      clearInterval(this.trackingTimer);
      this.trackingTimer = null;
    }
  }
}
export const Dashboard = new DashboardPage();
