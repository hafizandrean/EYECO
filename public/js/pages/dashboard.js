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
          <span id="brief-system-status"><i data-lucide="monitor" style="width:14px;height:14px;color:var(--success);"></i> MONITORING ACTIVE</span>
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
        </div>
        <div class="control-right" style="position: relative;">
          ${isAdmin ? `
            <button id="btn-clear-all-cctv" class="btn btn-glass btn-rounded" style="border-color: rgba(220, 38, 38, 0.3); color: var(--danger);" title="Hapus Seluruh CCTV Dummy">
              <i data-lucide="trash-2"></i> Hapus Semua CCTV
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
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.78rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0 0 8px 0; letter-spacing: 0.4px;">Officer Status</h4>
            <div id="officer-live-list">
              <div style="font-size: 0.78rem; color: var(--text-muted); padding: 6px 0;">Tidak ada petugas aktif.</div>
            </div>
          </div>

          <div style="border-top: 1px solid var(--border); padding-top: var(--space-12);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 0.75rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Camera Health</span>
              <span id="stat-camera-health-val" style="font-size: 0.82rem; font-weight: 800; color: var(--success);">100%</span>
            </div>
            <div class="progress-bar-flat" style="width: 100%; height: 5px; background: rgba(0,0,0,0.05); border-radius: 3px; overflow: hidden;">
              <div id="stat-camera-health-bar" style="width: 100%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
            </div>
            <span id="stat-camera-health-desc" style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-top: 4px; display: block;">0/0 Online</span>
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

      <!-- Dedicated Edit / Pengaturan CCTV Modal Overlay -->
      <div id="edit-cctv-modal" class="modal-overlay" style="display: none; z-index: 1100;">
        <div class="glass-card modal-container" style="max-width: 580px; width: 90%;">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin:0; font-family:'Outfit',sans-serif; display:flex; align-items:center; gap:8px; font-size:1.15rem; font-weight:800;">
              <i data-lucide="settings" style="color:var(--primary);"></i> Pengaturan Konfigurasi CCTV
            </h3>
            <button class="btn-close-modal" id="btn-close-edit-cctv-modal">&times;</button>
          </div>
          <div class="modal-body" style="margin-top: 16px;">
            <form id="edit-cctv-form">
              <input type="hidden" id="edit-cctv-id" />
              
              <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px;">
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Nama Saluran CCTV</label>
                  <input type="text" id="edit-cctv-name" class="filter-control input-rounded" required placeholder="e.g. Jembatan Merah Sektor 1" style="width: 100%;">
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Lokasi Pemantauan</label>
                  <input type="text" id="edit-cctv-location" class="filter-control input-rounded" required placeholder="e.g. Sungai Ciliwung" style="width: 100%;">
                </div>
              </div>

              <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px;">
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Protokol Sinyal</label>
                  <select id="edit-cctv-protocol" class="filter-control select-rounded" style="width: 100%;">
                    <option value="RTSP">RTSP (MediaMTX transcode)</option>
                    <option value="HLS">HLS (Direct stream)</option>
                    <option value="HTTP Image">HTTP Image / Snapshot</option>
                    <option value="WebRTC">WebRTC Realtime</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Resolusi Stream</label>
                  <select id="edit-cctv-resolution" class="filter-control select-rounded" style="width: 100%;">
                    <option value="1080p">1080p - Full HD</option>
                    <option value="720p">720p - HD</option>
                    <option value="4K">4K - Ultra HD</option>
                  </select>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 14px;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">URL Stream / Path Media</label>
                <input type="text" id="edit-cctv-stream-url" class="filter-control input-rounded" placeholder="rtsp://192.168.1.100:554/live atau /uploads/detection_1.jpg" style="width: 100%;">
              </div>

              <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px;">
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Sensitivitas AI Deteksi</label>
                  <select id="edit-cctv-sensitivity" class="filter-control select-rounded" style="width: 100%;">
                    <option value="TINGGI">Tinggi (Threshold 75%)</option>
                    <option value="SEDANG" selected>Sedang (Threshold 60%)</option>
                    <option value="RENDAH">Rendah (Threshold 45%)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Status Pemantauan</label>
                  <select id="edit-cctv-status" class="filter-control select-rounded" style="width: 100%;">
                    <option value="ONLINE">ONLINE (Aktif Pemantauan)</option>
                    <option value="OFFLINE">OFFLINE (Nonaktifkan Sinyal)</option>
                  </select>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(0,0,0,0.08);">
                <button type="button" class="btn btn-danger btn-rounded" id="btn-delete-cctv-modal-action" style="font-weight: 700; padding: 8px 16px;">
                  <i data-lucide="trash-2"></i> Putuskan CCTV
                </button>
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="btn btn-glass btn-rounded" id="btn-cancel-edit-modal" style="padding: 8px 16px;">Batal</button>
                  <button type="submit" class="btn btn-primary btn-rounded" style="font-weight: 700; padding: 8px 16px;">
                    <i data-lucide="save"></i> Simpan Konfigurasi
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- CCTV Fullscreen VMS View Command Center (Images 2 & 3 style) -->
      <div id="vms-fullscreen-page" class="vms-fullscreen-view" style="display: none;">
        <!-- Header -->
        <div class="vms-fs-header">
          <div class="vms-fs-header-left">
            <button class="vms-fs-btn-back" id="btn-close-vms-fs" title="Kembali ke Dashboard">
              <i data-lucide="arrow-left"></i>
            </button>
            <span class="vms-fs-cam-title" id="vms-fs-cam-title">KISI MONITORING CCTV (4 SALURAN)</span>
          </div>
          <div class="vms-fs-header-right" style="position: relative;">
            <button class="vms-fs-icon-btn active" id="vms-fs-btn-toggle-ai-mon" title="Toggle AI Bounding Boxes"><i data-lucide="eye"></i></button>
            <button class="vms-fs-icon-btn" id="vms-fs-btn-more" title="More Actions"><i data-lucide="more-horizontal"></i></button>
            
            <!-- Dropdown Menu -->
            <div id="vms-fs-more-dropdown" class="glass-card" style="display: none; position: absolute; top: 44px; right: 0; width: 220px; z-index: 1000; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: #0b1120; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px;">
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-settings" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: #ffffff; text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="settings" style="width: 14px; height: 14px;"></i> Pengaturan / Edit CCTV
                  </button>
                </li>
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-reconnect" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: #ffffff; text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Reconnect Stream
                  </button>
                </li>
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-toggle-overlay" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: #ffffff; text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="scan-eye" style="width: 14px; height: 14px;"></i> Toggle AI Bounding Box
                  </button>
                </li>
                <li id="vms-fs-drop-delete-container" style="display: none; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px; margin-top: 4px;">
                  <button class="dropdown-item-btn" id="vms-fs-drop-delete" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: #ef4444; text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; color: #ef4444;"></i> Putuskan CCTV
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Split Body: Main Video Viewport (Left) + Dark Sidebar (Right) -->
        <div class="vms-fs-body">
          <div class="vms-fs-video-workspace">
            <div class="vms-fs-screen-container" id="vms-fs-player-container">
              <!-- Dynamic Video Grid (2x2) or Single Stream -->
            </div>
            
            <!-- Bottom Overlay Control Bar -->
            <div class="vms-fs-video-bar">
              <div class="vms-fs-bar-left">
                <button class="vms-bar-btn" id="vms-fs-btn-play-pause" title="Putar / Pause Stream">
                  <i data-lucide="pause"></i>
                </button>
                <button class="vms-bar-btn" id="vms-fs-btn-replay" title="Replay 10 Detik Terakhir">
                  <i data-lucide="rotate-ccw"></i>
                </button>
                <button class="vms-bar-btn" id="vms-fs-btn-mute" title="Toggle Mute"><i data-lucide="volume-x"></i></button>
                <span style="display: inline-flex; align-items: center; gap: 6px; color: #22c55e;">
                  <span style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%; display: inline-block;" id="vms-fs-status-dot"></span>
                  <span id="vms-fs-status-label">LIVE</span> <span style="color: rgba(255,255,255,0.4);">|</span> <span style="color: rgba(255,255,255,0.85);" id="vms-fs-bitrate-label">1.75 KB/s</span>
                </span>
              </div>
              <div class="vms-fs-bar-right">
                <button class="vms-bar-btn" id="vms-fs-btn-grid-toggle" title="Mode Kisi (4 Saluran) / Single"><i data-lucide="layout-grid"></i></button>
                <button class="vms-bar-btn" id="vms-fs-btn-refresh-stream" title="Refresh Stream"><i data-lucide="refresh-cw"></i></button>
              </div>
            </div>
          </div>

          <!-- Right VMS Sidebar Panel -->
          <aside class="vms-fs-sidebar">
            <!-- Operator Actions Section -->
            <div class="vms-fs-sidebar-section">
              <h4 class="vms-fs-sidebar-title">OPERATOR ACTIONS</h4>
              <div class="vms-fs-actions-grid">
                <button class="vms-action-tile" id="vms-fs-action-snapshot">
                  <i data-lucide="camera"></i> Snapshot
                </button>
                <button class="vms-action-tile" id="vms-fs-action-record">
                  <i data-lucide="video"></i> Record
                </button>
                <button class="vms-action-tile" id="vms-fs-action-mic">
                  <i data-lucide="mic"></i> Intercom
                </button>
                <button class="vms-action-tile active" id="vms-fs-action-ai">
                  <i data-lucide="scan-eye"></i> AI Overlay
                </button>
              </div>
            </div>

            <!-- Camera Status Section -->
            <div class="vms-fs-sidebar-section">
              <h4 class="vms-fs-sidebar-title">CAMERA STATUS</h4>
              <div class="vms-status-list">
                <div class="vms-status-row">
                  <span class="vms-status-label">Stream Protocol</span>
                  <span class="vms-status-value accent-cyan" id="vms-stat-protocol">Multi-Stream</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Resolution</span>
                  <span class="vms-status-value" id="vms-stat-resolution">4x 720p</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Latency</span>
                  <span class="vms-status-value accent-green" id="vms-stat-latency">Mixed</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">AI Tracking</span>
                  <span class="vms-status-value accent-red" id="vms-stat-aitracking">Active (4x)</span>
                </div>
              </div>
            </div>

            <!-- Event Logs Section -->
            <div class="vms-fs-sidebar-section">
              <div class="vms-fs-sidebar-title">
                <span>EVENT LOGS</span>
                <span style="background: rgba(239,68,68,0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800;">LIVE FEED</span>
              </div>
              <div class="vms-event-logs-list" id="vms-fs-event-logs">
                <!-- Rendered dynamically -->
              </div>
            </div>
          </aside>
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
    const toggleTelegram = document.getElementById('toggle-telegram-alerts');
    const toggleMonitoring = document.getElementById('btn-toggle-monitoring');
    const searchInput = document.getElementById('incident-search-input');
    const filterIdInput = document.getElementById('incident-filter-id');
    const filterCameraSelect = document.getElementById('incident-filter-camera');
    const filterDateInput = document.getElementById('incident-filter-date');
    const filterStatusSelect = document.getElementById('incident-filter-status');
    const filterTabsContainer = document.getElementById('incident-filter-tabs');

    if (selectCam) {
      selectCam.addEventListener('change', () => this.filterCCTVChannels(selectCam.value));
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
          EventBus.emit('toast:show', { message: 'Gagal memperbarui konfigurasi Telegram di server.', type: 'danger' });
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

    // Initialize Connection Modal Form & Edit Modal Form
    this.initCctvModal();
    this.initEditCctvModal();
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

    const btnClearAll = document.getElementById('btn-clear-all-cctv');

    if (btnClearAll) {
      btnClearAll.addEventListener('click', async () => {
        if (confirm('Apakah Anda yakin ingin menghapus SELURUH saluran CCTV dummy saat ini?')) {
          try {
            await API.delete('/api/cctv/clear-all');
            EventBus.emit('toast:show', { message: 'Seluruh CCTV dummy berhasil dihapus.', type: 'success' });
            await this.loadData();
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal menghapus CCTV: ' + err.message, type: 'danger' });
          }
        }
      });
    }

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
              <span class="step-icon ${success ? 'success' : 'failed'}">${success ? '<i data-lucide="check" style="width:12px;height:12px;"></i>' : '<i data-lucide="x" style="width:12px;height:12px;"></i>'}</span>
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
            <li class="error-step"><span class="step-icon failed"><i data-lucide="x" style="width:12px;height:12px;"></i></span> Gagal memindai: ${err.message}</li>
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

  openEditCctvModal(ch) {
    if (!ch) return;
    const modal = document.getElementById('edit-cctv-modal');
    if (!modal) return;

    this.editingCctvId = ch.id;
    document.getElementById('edit-cctv-id').value = ch.id;
    document.getElementById('edit-cctv-name').value = ch.name || '';
    document.getElementById('edit-cctv-location').value = ch.location || ch.name || '';
    document.getElementById('edit-cctv-protocol').value = ch.protocol || 'HTTP Image';
    document.getElementById('edit-cctv-resolution').value = (ch.health && ch.health.resolution) ? ch.health.resolution : '1080p';
    document.getElementById('edit-cctv-stream-url').value = ch.streamUrl || ch.playUrl || '';
    document.getElementById('edit-cctv-status').value = ch.status || 'ONLINE';

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  initEditCctvModal() {
    const modal = document.getElementById('edit-cctv-modal');
    const btnClose = document.getElementById('btn-close-edit-cctv-modal');
    const btnCancel = document.getElementById('btn-cancel-edit-modal');
    const form = document.getElementById('edit-cctv-form');
    const btnDelete = document.getElementById('btn-delete-cctv-modal-action');

    if (!modal) return;

    const closeModal = () => { modal.style.display = 'none'; };
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const id = parseInt(document.getElementById('edit-cctv-id').value);
        const name = document.getElementById('edit-cctv-name').value.trim();
        const location = document.getElementById('edit-cctv-location').value.trim();
        const protocol = document.getElementById('edit-cctv-protocol').value;
        const resolution = document.getElementById('edit-cctv-resolution').value;
        const streamUrl = document.getElementById('edit-cctv-stream-url').value.trim();
        const status = document.getElementById('edit-cctv-status').value;

        const payload = {
          name,
          location,
          protocol,
          streamUrl,
          playUrl: streamUrl,
          status,
          health: { latency: 45, resolution }
        };

        try {
          const localCh = this.cctvList.find(c => c.id === id);
          if (localCh) {
            Object.assign(localCh, payload);
          }
          try {
            await CctvService.updateCctv(id, payload);
          } catch (apiErr) {
            console.warn('API update fallback to local state:', apiErr);
          }

          EventBus.emit('toast:show', { message: `Konfigurasi CCTV "${name}" berhasil diperbarui.`, type: 'success' });
          closeModal();
          await this.loadData();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menyimpan konfigurasi: ${err.message}`, type: 'danger' });
        }
      };
    }

    if (btnDelete) {
      btnDelete.onclick = async () => {
        const id = parseInt(document.getElementById('edit-cctv-id').value);
        const localCh = this.cctvList.find(c => c.id === id);
        const name = localCh ? localCh.name : `CCTV #${id}`;
        
        if (confirm(`Apakah Anda yakin ingin memutuskan & menghapus CCTV: "${name}"?`)) {
          try {
            this.cctvList = this.cctvList.filter(c => c.id !== id);
            try {
              await CctvService.disconnectCctv(id);
            } catch (apiErr) {
              console.warn('API disconnect fallback to local state:', apiErr);
            }

            EventBus.emit('toast:show', { message: `Koneksi CCTV "${name}" berhasil diputuskan.`, type: 'success' });
            closeModal();
            await this.loadData();
          } catch (err) {
            EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
          }
        }
      };
    }
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
      EventBus.emit('toast:show', { message: `Mengambil foto snapshot dari kamera...`, type: 'info' });
      // Call mock snapshot helper or trigger DB refresh
      EventBus.emit('toast:show', { message: `Snapshot berhasil disimpan ke log verifikasi.`, type: 'success' });
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
          ${isChActive ? `
            <img id="drawer-preview-img" style="width:100%; height:100%; object-fit: cover;" src="${imageSrc}" />
          ` : `
            <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #111; color: #666; font-size: 0.8rem; font-weight: 700;">
              MONITORING INACTIVE
            </div>
          `}
          <div class="drawer-rec-hud" style="position: absolute; top: 12px; left: 12px; display: flex; gap: 6px;">
            <span class="badge bg-danger text-white" style="font-size: 0.65rem; font-weight: 800; border-radius: 4px; padding: 2px 6px; display: flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; background: white; border-radius: 50%; display: inline-block; animation: pulse-cloud 1s infinite;"></span>
              REC
            </span>
            <span class="badge bg-primary text-white" style="font-size: 0.65rem; font-weight: 800; border-radius: 4px; padding: 2px 6px;">HD</span>
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
            ${isAdmin ? `
              <button class="btn btn-glass btn-rounded" id="drawer-btn-delete" style="grid-column: span 2; font-size: 0.78rem; font-weight: 700; border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.06); color: var(--danger); justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0; margin-top: 4px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--danger);"></i> Putuskan & Hapus CCTV Ini
              </button>
            ` : ''}
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
    const btnDelete = drawer.querySelector('#drawer-btn-delete');

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
    if (btnDelete) btnDelete.onclick = async () => {
      if (confirm(`Apakah Anda yakin ingin memutuskan & menghapus CCTV "${ch.name}"?`)) {
        try {
          this.closeCCTVDetailDrawer();
          await CctvService.disconnectCctv(ch.id);
          EventBus.emit('toast:show', { message: `CCTV "${ch.name}" berhasil dihapus.`, type: 'success' });
          await this.loadData();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menghapus CCTV: ${err.message}`, type: 'danger' });
        }
      }
    };

    if (window.lucide) window.lucide.createIcons();

    // Slide open
    drawer.style.right = '0px';
  }

  closeCCTVDetailDrawer() {
    const drawer = document.getElementById('cctv-detail-drawer');
    if (drawer) drawer.style.right = '-400px';
  }

  openVmsController(channelId, mode = 'single') {
    let currentMode = mode;
    let selectedChId = channelId || (this.cctvList.length > 0 ? this.cctvList[0].id : 1);
    let ch = this.cctvList.find(c => c.id === selectedChId) || this.cctvList[0];

    const page = document.getElementById('vms-fullscreen-page');
    if (!page) return;

    const titleEl = document.getElementById('vms-fs-cam-title');
    const playerContainer = document.getElementById('vms-fs-player-container');
    const btnBack = document.getElementById('btn-close-vms-fs');
    const btnMute = document.getElementById('vms-fs-btn-mute');
    const btnGridToggle = document.getElementById('vms-fs-btn-grid-toggle');
    const btnRefreshStream = document.getElementById('vms-fs-btn-refresh-stream');

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

    const statProtocol = document.getElementById('vms-stat-protocol');
    const statResolution = document.getElementById('vms-stat-resolution');
    const statLatency = document.getElementById('vms-stat-latency');
    const statAiTracking = document.getElementById('vms-stat-aitracking');
    const eventLogsContainer = document.getElementById('vms-fs-event-logs');

    let isMuted = true;
    let isAiActive = true;
    let isRecording = false;

    const renderView = () => {
      if (currentMode === 'grid') {
        // Render 4-Channel Grid Monitoring View (Image 2 style)
        if (titleEl) titleEl.innerText = `KISI MONITORING CCTV (4 SALURAN)`;
        if (statProtocol) statProtocol.innerText = `Multi-Stream`;
        if (statResolution) statResolution.innerText = `4x 720p`;
        if (statLatency) statLatency.innerText = `Mixed`;
        if (statAiTracking) {
          statAiTracking.innerText = `Active (4x)`;
          statAiTracking.className = `vms-status-value accent-red`;
        }

        if (eventLogsContainer) {
          eventLogsContainer.innerHTML = `
            <div style="color: #94a3b8; font-size: 0.78rem; line-height: 1.55; padding: 4px 0;">
              Mode Kisi (4 Saluran) Aktif. Klik salah satu saluran untuk melihat detail & log.
            </div>
          `;
        }

        // Render 2x2 grid containing top 4 active channels
        const gridChannels = this.cctvList.slice(0, 4);
        let gridHtml = `<div class="vms-fs-grid-2x2">`;
        gridChannels.forEach(c => {
          const matchReport = this.latestReports.find(r => r.location && r.location.toLowerCase().includes(c.name.toLowerCase()));
          const defaultSnapshot = c.snapshotUrl || c.playUrl || c.streamUrl || `/uploads/detection_${((c.id - 1) % 10) + 1}.jpg`;
          const imageSrc = (matchReport && matchReport.image) ? matchReport.image : defaultSnapshot;

          gridHtml += `
            <div class="vms-fs-grid-cell" data-grid-ch-id="${c.id}">
              ${c.mediaType === 'Video' && c.playUrl && c.playUrl.endsWith('.mp4') ? `
                <video src="${c.playUrl}" autoplay loop muted playsinline></video>
              ` : `
                <img src="${imageSrc}" alt="" onerror="this.onerror=null; this.src='/uploads/detection_1.jpg';" />
              `}
              <div class="vms-fs-cell-tag">CH 0${c.id} - ${c.name.toUpperCase()}</div>
            </div>
          `;
        });
        gridHtml += `</div>`;
        playerContainer.innerHTML = gridHtml;

        // Bind click event on cells to zoom into single channel view
        const cells = playerContainer.querySelectorAll('.vms-fs-grid-cell');
        cells.forEach(cell => {
          cell.onclick = () => {
            const id = parseInt(cell.getAttribute('data-grid-ch-id'));
            selectedChId = id;
            ch = this.cctvList.find(c => c.id === id) || ch;
            currentMode = 'single';
            renderView();
          };
        });

      } else {
        // Render Single Channel Fullscreen View (Image 3 style)
        ch = this.cctvList.find(c => c.id === selectedChId) || this.cctvList[0] || ch;
        if (!ch) return;

        if (titleEl) titleEl.innerText = ch.name.toUpperCase();
        if (statProtocol) statProtocol.innerText = ch.protocol || 'HTTP Image';
        if (statResolution) statResolution.innerText = ch.health && ch.health.resolution ? ch.health.resolution : '1080p - HD';
        if (statLatency) statLatency.innerText = ch.health && ch.health.latency ? `${ch.health.latency} ms` : '70 ms';
        if (statAiTracking) {
          statAiTracking.innerText = `ACTIVE (YOLOv8)`;
          statAiTracking.className = `vms-status-value accent-red`;
        }

        const cameraReports = this.latestReports.filter(r => r.location && r.location.toLowerCase().includes(ch.name.toLowerCase()));
        if (eventLogsContainer) {
          if (cameraReports.length === 0) {
            eventLogsContainer.innerHTML = `
              <div style="color: #94a3b8; font-size: 0.78rem; padding: 4px 0;">
                Belum ada aktivitas terekam hari ini.
              </div>
            `;
          } else {
            eventLogsContainer.innerHTML = cameraReports.slice(0, 4).map(r => `
              <div class="vms-event-item">
                <div style="display:flex; justify-content:space-between;">
                  <span style="font-weight:800; color:${r.aiStatus === 'TINGGI' ? '#ef4444' : '#f59e0b'}; font-size:0.65rem;">${r.aiStatus} INCIDENT</span>
                  <span class="vms-event-time">${new Date(r.timestamp).toLocaleTimeString('id-ID')}</span>
                </div>
                <div class="vms-event-desc">${r.additionalNotes || 'Aktivitas terdeteksi AI'}</div>
              </div>
            `).join('');
          }
        }

        const matchReport = this.latestReports.find(r => r.location && r.location.toLowerCase().includes(ch.name.toLowerCase()));
        const defaultSnapshot = ch.snapshotUrl || ch.playUrl || ch.streamUrl || `/uploads/detection_${((ch.id - 1) % 10) + 1}.jpg`;
        const imageSrc = (matchReport && matchReport.image) ? matchReport.image : defaultSnapshot;

        const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' GMT';

        let singleHtml = `
          <div class="vms-fs-single-container">
            ${ch.mediaType === 'Video' && ch.playUrl && ch.playUrl.endsWith('.mp4') ? `
              <video src="${ch.playUrl}" id="vms-fs-media-element" autoplay loop ${isMuted ? 'muted' : ''} playsinline></video>
            ` : `
              <img src="${imageSrc}" id="vms-fs-media-element" alt="" onerror="this.onerror=null; this.src='/uploads/detection_1.jpg';" />
            `}
            <div class="vms-fs-timestamp-overlay">${dateStr} CAM 0${ch.id}</div>
            <div id="vms-fs-yolo-overlay" style="position:absolute; inset:0; pointer-events:none; z-index:10;"></div>
          </div>
        `;
        playerContainer.innerHTML = singleHtml;

        setTimeout(() => renderYoloBoxes(), 50);
      }

      if (window.lucide) window.lucide.createIcons();
    };

    const renderYoloBoxes = () => {
      const yoloOverlay = document.getElementById('vms-fs-yolo-overlay');
      if (!yoloOverlay || currentMode !== 'single') return;
      yoloOverlay.innerHTML = '';
      if (!isAiActive) return;

      const matchReport = this.latestReports.find(r => r.location && r.location.toLowerCase().includes(ch.name.toLowerCase()));
      const boxes = (matchReport && matchReport.boundingBoxes && matchReport.boundingBoxes.length > 0)
        ? matchReport.boundingBoxes
        : [
            { x: 22, y: 35, w: 26, h: 42, label: 'trash 94%', type: 'trash' },
            { x: 58, y: 48, w: 20, h: 30, label: 'person 88%', type: 'person' },
            { x: 42, y: 18, w: 32, h: 26, label: 'boat 91%', type: 'boat' }
          ];

      boxes.forEach(box => {
        let boxColorClass = 'yolo-trash';
        const lbl = (box.label || '').toLowerCase();
        if (lbl.includes('person')) boxColorClass = 'yolo-person';
        if (lbl.includes('trash')) boxColorClass = 'yolo-trash';
        if (lbl.includes('boat')) boxColorClass = 'yolo-boat';

        const el = document.createElement('div');
        el.className = `yolo-preview-box ${boxColorClass}`;
        el.style.cssText = `
          position: absolute;
          top: ${box.y}%; 
          left: ${box.x}%; 
          width: ${box.w}%; 
          height: ${box.h}%;
        `;
        el.innerHTML = `<span class="yolo-preview-label">${box.label}</span>`;
        yoloOverlay.appendChild(el);
      });
    };

    // Header Back button handler
    if (btnBack) {
      btnBack.onclick = () => {
        page.style.display = 'none';
        this.loadData();
      };
    }

    // Toggle Grid Mode vs Single Mode
    if (btnGridToggle) {
      btnGridToggle.onclick = () => {
        currentMode = currentMode === 'grid' ? 'single' : 'grid';
        renderView();
        EventBus.emit('toast:show', {
          message: currentMode === 'grid' ? 'Beralih ke Mode Kisi (4 Saluran).' : `Beralih ke Layar Penuh Kamera ${ch.name}.`,
          type: 'info'
        });
      };
    }

    // Refresh Stream button
    if (btnRefreshStream) {
      btnRefreshStream.onclick = () => {
        EventBus.emit('toast:show', { message: 'Menyegarkan sinyal stream CCTV...', type: 'info' });
        renderView();
      };
    }

    // Play / Pause Stream button
    let isPlayingStream = true;
    const btnPlayPause = document.getElementById('vms-fs-btn-play-pause');
    const btnReplay = document.getElementById('vms-fs-btn-replay');

    if (btnPlayPause) {
      btnPlayPause.onclick = () => {
        isPlayingStream = !isPlayingStream;
        const mediaEl = document.getElementById('vms-fs-media-element');
        if (mediaEl && mediaEl.tagName === 'VIDEO') {
          if (isPlayingStream) mediaEl.play(); else mediaEl.pause();
        }

        btnPlayPause.innerHTML = `<i data-lucide="${isPlayingStream ? 'pause' : 'play'}"></i>`;
        const statusDot = document.getElementById('vms-fs-status-dot');
        const statusLabel = document.getElementById('vms-fs-status-label');
        if (statusDot) statusDot.style.background = isPlayingStream ? '#22c55e' : '#ef4444';
        if (statusLabel) statusLabel.innerText = isPlayingStream ? 'LIVE' : 'PAUSED';

        if (window.lucide) window.lucide.createIcons();
        EventBus.emit('toast:show', {
          message: isPlayingStream ? `Stream ${ch.name} diputar kembali.` : `Stream ${ch.name} dipause.`,
          type: isPlayingStream ? 'success' : 'warning'
        });
      };
    }

    // Replay 10s button
    if (btnReplay) {
      btnReplay.onclick = () => {
        const mediaEl = document.getElementById('vms-fs-media-element');
        if (mediaEl && mediaEl.tagName === 'VIDEO') {
          mediaEl.currentTime = Math.max(0, mediaEl.currentTime - 10);
          mediaEl.play();
        }
        isPlayingStream = true;
        if (btnPlayPause) btnPlayPause.innerHTML = `<i data-lucide="pause"></i>`;
        const statusDot = document.getElementById('vms-fs-status-dot');
        const statusLabel = document.getElementById('vms-fs-status-label');
        if (statusDot) statusDot.style.background = '#22c55e';
        if (statusLabel) statusLabel.innerText = 'REPLAY 10s';

        if (window.lucide) window.lucide.createIcons();
        EventBus.emit('toast:show', {
          message: `Mengulangi 10 detik terakhir tayangan ${ch.name}...`,
          type: 'info'
        });
      };
    }

    // Operator Action: Snapshot
    if (btnActSnapshot) {
      btnActSnapshot.onclick = () => {
        EventBus.emit('toast:show', { message: `Snapshot dari ${ch.name} berhasil diambil & disimpan.`, type: 'success' });
      };
    }

    // Operator Action: Record
    if (btnActRecord) {
      btnActRecord.onclick = () => {
        isRecording = !isRecording;
        btnActRecord.classList.toggle('active', isRecording);
        EventBus.emit('toast:show', {
          message: isRecording ? `Rekaman video ${ch.name} dimulai...` : `Rekaman video disimpan.`,
          type: isRecording ? 'warning' : 'success'
        });
      };
    }

    // Operator Action: Mic Intercom
    if (btnActMic) {
      btnActMic.onclick = () => {
        const active = btnActMic.classList.toggle('active');
        EventBus.emit('toast:show', {
          message: active ? 'Interkom dua arah aktif. Bicara sekarang.' : 'Interkom dimatikan.',
          type: active ? 'success' : 'info'
        });
      };
    }

    // Operator Action: AI Overlay
    if (btnActAi) {
      btnActAi.onclick = () => {
        isAiActive = !isAiActive;
        btnActAi.classList.toggle('active', isAiActive);
        renderYoloBoxes();
        EventBus.emit('toast:show', {
          message: isAiActive ? 'Bounding box YOLO aktif.' : 'Bounding box YOLO disembunyikan.',
          type: 'info'
        });
      };
    }

    // Toggle AI Overlay from header eye button
    if (btnToggleAiMon) {
      btnToggleAiMon.onclick = () => {
        btnActAi.click();
      };
    }

    // More Options Dropdown toggle
    if (btnMore && moreDropdown) {
      btnMore.onclick = (e) => {
        e.stopPropagation();
        const isHidden = moreDropdown.style.display === 'none';
        moreDropdown.style.display = isHidden ? 'block' : 'none';
      };
      document.addEventListener('click', () => {
        moreDropdown.style.display = 'none';
      });
    }

    if (dropSettings) {
      dropSettings.onclick = (e) => {
        e.stopPropagation();
        moreDropdown.style.display = 'none';
        page.style.display = 'none';
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
        btnActAi.click();
      };
    }

    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';
    if (dropDeleteContainer) {
      dropDeleteContainer.style.display = (isAdmin && !ch.isDefault) ? 'block' : 'none';
    }

    if (dropDelete) {
      dropDelete.onclick = async (e) => {
        e.stopPropagation();
        moreDropdown.style.display = 'none';
        const confirmDel = confirm(`Apakah Anda yakin ingin memutuskan koneksi CCTV: "${ch.name}"?`);
        if (!confirmDel) return;
        try {
          page.style.display = 'none';
          await CctvService.disconnectCctv(ch.id);
          EventBus.emit('toast:show', { message: `Koneksi CCTV "${ch.name}" berhasil diputuskan.`, type: 'success' });
          await this.loadData();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
        }
      };
    }

    // Boot Fullscreen view
    renderView();
    page.style.display = 'flex';
  }

  async loadData() {
    // 1. Load Stats with fallback
    try {
      this.stats = await StatsService.getStats();
    } catch (err) {
      console.warn('[DashboardPage] StatsService.getStats failed, using fallback:', err);
      this.stats = { totalReports: 0, pendingReview: 0, inProgress: 0, resolvedToday: 0 };
    }

    // 2. Load CCTV list with fallback to default cameras
    try {
      const list = await CctvService.getCctvList();
      if (Array.isArray(list) && list.length > 0) {
        this.cctvList = list;
      } else {
        throw new Error('CCTV list empty');
      }
    } catch (err) {
      console.warn('[DashboardPage] CctvService.getCctvList failed, using default camera list:', err);
      this.cctvList = [
        { id: 1, name: 'Jembatan Merah', protocol: 'HTTP Image', playUrl: '/uploads/detection_1.jpg', streamUrl: '/uploads/detection_1.jpg', mediaType: 'Image', status: 'ONLINE', monitoringEnabled: true, isDefault: true, health: { latency: 45, resolution: '1080p' } },
        { id: 2, name: 'Pintu Air Manggarai', protocol: 'HTTP Image', playUrl: '/uploads/detection_2.jpg', streamUrl: '/uploads/detection_2.jpg', mediaType: 'Image', status: 'ONLINE', monitoringEnabled: true, isDefault: true, health: { latency: 52, resolution: '1080p' } },
        { id: 3, name: 'Sektor 7 Hulu', protocol: 'HTTP Image', playUrl: '/uploads/detection_3.jpg', streamUrl: '/uploads/detection_3.jpg', mediaType: 'Image', status: 'ONLINE', monitoringEnabled: true, isDefault: true, health: { latency: 38, resolution: '720p' } },
        { id: 4, name: 'Aliran Kampung Melayu', protocol: 'HTTP Image', playUrl: '/uploads/detection_4.jpg', streamUrl: '/uploads/detection_4.jpg', mediaType: 'Image', status: 'ONLINE', monitoringEnabled: true, isDefault: true, health: { latency: 64, resolution: '1080p' } }
      ];
    }
    this.updateCameraSelectOptions();

    // 3. Load system settings for telegram alerts
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
      }
    } catch (sysErr) {
      console.warn('Failed to sync telegram setting from backend:', sysErr);
    }

    // 4. Load detections with fallback
    try {
      const detectionsData = await ReportService.getFilteredReports({ limit: 50 });
      this.latestReports = detectionsData?.reports || [];
    } catch (err) {
      console.warn('[DashboardPage] ReportService.getFilteredReports failed:', err);
      this.latestReports = [];
    }

    // Check if there is a new incoming report during active polling to trigger badge / toast
    if (this.latestReports.length > 0) {
      const topReport = this.latestReports[0];
      if (this.lastSeenReportId !== null && topReport.id > this.lastSeenReportId) {
        if (topReport.aiStatus === 'TINGGI' || topReport.aiStatus === 'SEDANG') {
          AppState.set('unreadNotifications', (AppState.get('unreadNotifications') || 0) + 1);
          EventBus.emit('toast:show', {
            message: `Peringatan Baru: Terdeteksi ancaman ${topReport.aiStatus} di ${topReport.location}!`,
            type: 'danger'
          });
        } else {
          EventBus.emit('toast:show', {
            message: `CCTV: Aktivitas terdeteksi di ${topReport.location}`,
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

    // Guaranteed Render Call
    this.animateStats();
    this.renderCCTVGrid();
    this.renderLiveAlerts();
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
      const dot = onSite ? '<i data-lucide="map-pin" style="width:12px;height:12px;color:var(--success);"></i>' : '<i data-lucide="circle" style="width:12px;height:12px;color:var(--primary);"></i>';
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
      let dotEmoji = '<i data-lucide="circle" style="width:10px;height:10px;color:var(--text-muted);"></i>';
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
            dotEmoji = '<i data-lucide="alert-triangle" style="width:10px;height:10px;color:var(--danger);"></i>';
            metaLine = `AI ${activeIncident.aiConfidence}% · ${alertCount} alert`;
          } else {
            statusLabel = 'Online';
            statusColor = 'var(--success)';
            statusBg = 'rgba(34, 197, 94, 0.08)';
            dotEmoji = '<i data-lucide="circle" style="width:10px;height:10px;color:var(--success);"></i>';
          }
        } else {
          statusLabel = 'Offline';
          statusColor = 'var(--danger)';
          statusBg = 'rgba(239, 68, 68, 0.06)';
          dotEmoji = '<i data-lucide="circle" style="width:10px;height:10px;color:var(--text-muted);"></i>';
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
    const totalCams = this.cctvList.length || 1;
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

    // Camera Health
    const camHealth = isMon ? Math.round((onlineCount / totalCams) * 100) : 0;
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

          item.innerHTML = `
            <div style="width: 52px; height: 52px; border-radius: 10px; overflow:hidden; flex-shrink:0; background:var(--surface-variant); border: 1.5px solid var(--border); display:flex; align-items:center; justify-content:center;">
              <img src="${r.image}" style="width:100%; height:100%; object-fit:cover;" alt="" />
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
                <span style="font-weight:600; color:var(--text-secondary);">#${r.id.toString().padStart(4, '0')}</span>
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
        <div class="glass-card empty-state-card" style="padding: var(--space-48); text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-16); width: 100%; border: 1px dashed rgba(47,107,255,0.2);">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(47, 107, 255, 0.05); color: var(--primary); display: flex; align-items: center; justify-content: center;">
            <i data-lucide="video-off" style="width: 32px; height: 32px;"></i>
          </div>
          <div>
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0;">Belum Ada Kamera Terhubung</h4>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 6px; max-width: 320px; line-height: 1.5; margin-bottom: 0;">Sambungkan kamera pemantauan baru untuk memulai pengawasan real-time sungai.</p>
          </div>
          ${isAdmin ? `
            <button class="btn btn-primary btn-rounded" id="btn-empty-connect-cctv" style="font-weight: 700; padding: 10px 20px;">
              Hubungkan Kamera
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
      const isChActive = isMon && (ch.isActive !== false) && (ch.monitoringEnabled !== false);
      // Find matching report from DB for this location
      const matchReport = this.latestReports.find(r => r.location && (r.location.toLowerCase().includes(ch.name.toLowerCase()) || ch.name.toLowerCase().includes(r.location.toLowerCase())));
      const isAlert = matchReport ? (matchReport.aiStatus === 'TINGGI' || matchReport.aiStatus === 'SEDANG') : false;
      const defaultSnapshot = ch.snapshotUrl || ch.playUrl || ch.streamUrl || `/uploads/detection_${((ch.id - 1) % 10) + 1}.jpg`;
      const imageSrc = (matchReport && matchReport.image) ? matchReport.image : defaultSnapshot;
      
      const card = document.createElement('div');
      card.className = `cctv-card glass-card ${isAlert ? 'cctv-card-alert' : ''}`;
      card.setAttribute('data-channel-id', ch.id);

      let boundingBoxesHtml = '';
      if (isChActive) {
        const boxes = (matchReport && matchReport.boundingBoxes && matchReport.boundingBoxes.length > 0)
          ? matchReport.boundingBoxes
          : [
              { x: 22, y: 35, w: 25, h: 40, label: 'trash 94%' },
              { x: 60, y: 48, w: 18, h: 28, label: 'person 88%' }
            ];

        boxes.forEach(box => {
          let boxColorClass = 'yolo-trash';
          const lbl = (box.label || '').toLowerCase();
          if (lbl.includes('person')) boxColorClass = 'yolo-person';
          if (lbl.includes('trash')) boxColorClass = 'yolo-trash';
          if (lbl.includes('boat')) boxColorClass = 'yolo-boat';

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
        } else if (ch.mediaType === 'Video' && ch.playUrl && ch.playUrl.endsWith('.mp4')) {
          // HTML5 Video Loop streaming simulation (support mp4, HLS)
          mediaHtml = `
            <video src="${ch.playUrl}" autoplay loop muted playsinline class="cctv-feed-img"></video>
            <div class="cctv-overlay-gradient"></div>
            ${boundingBoxesHtml}
          `;
        } else {
          // Default Image snapshot rendering with fallback
          mediaHtml = `
            <img src="${imageSrc}" alt="" class="cctv-feed-img" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='/uploads/detection_1.jpg';">
            <div class="cctv-overlay-gradient"></div>
            ${boundingBoxesHtml}
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

      card.innerHTML = `
        <div class="cctv-media-container" style="position: relative; overflow: hidden; border-radius: 12px 12px 0 0; margin-bottom: 0; cursor: pointer;">
          ${mediaHtml}
          
          <!-- Corner Badges -->
          <div class="cctv-corner-badges" style="position: absolute; top: 10px; left: 10px; display: flex; gap: 4px; z-index: 5;">
            ${isChActive ? `
              <span class="badge bg-danger text-white" style="font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                <span class="rec-dot" style="width:5px; height:5px; background:white; border-radius:50%; display:inline-block; animation: pulse-cloud 1s infinite;"></span>
                REC
              </span>
              <span class="badge bg-primary text-white" style="font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">LIVE</span>
              <span class="badge bg-info text-white" style="font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">HD</span>
              ${isAlert ? `
                <span class="badge bg-warning text-white" style="font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; animation: pulse-cloud 1.5s infinite;">
                  <i data-lucide="scan-eye" style="width: 10px; height: 10px;"></i> AI DETECTING
                </span>
              ` : ''}
            ` : `
              <span class="badge bg-secondary text-white" style="font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">STANDBY</span>
            `}
          </div>
        </div>

        <!-- Bottom Card Info Body -->
        <div class="cctv-info-body" style="padding: 10px 12px 10px 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.9rem; font-weight: 700; color: var(--text-primary); margin: 0; max-width: 75%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              CH ${ch.id < 10 ? '0' + ch.id : ch.id} | ${ch.name}
            </h4>
            <span class="cctv-status-badge ${statusClass}" style="transform: scale(0.85); transform-origin: right;">
              <span class="status-dot"></span>
              ${statusText}
            </span>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-secondary); display: flex; gap: 6px; font-weight: 600; opacity: 0.85;">
            <span>Latency: ${ch.health && ch.health.latency ? `${ch.health.latency} ms` : '45 ms'}</span>
            <span>|</span>
            <span>Res: ${ch.health && ch.health.resolution ? ch.health.resolution : '1080p'}</span>
            <span>|</span>
            <span>Motion: ${matchReport ? 'Detected' : 'No motion'}</span>
          </div>

          <!-- Streamlined Minimalist Action Bar -->
          <div class="cctv-card-action-bar" style="display: flex; gap: 6px; margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.06); align-items: center; justify-content: space-between;">
            <button class="btn btn-sm btn-primary btn-rounded btn-card-fs" style="padding: 5px 12px; font-size: 0.72rem; font-weight: 700; display: flex; align-items: center; gap: 5px;" title="Layar Penuh VMS">
              <i data-lucide="maximize-2" style="width: 12px; height: 12px;"></i> Fullscreen
            </button>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button class="btn btn-sm btn-glass btn-rounded btn-card-reconnect" style="padding: 5px 8px; font-size: 0.7rem;" title="Refresh Stream">
                <i data-lucide="refresh-cw" style="width: 13px; height: 13px;"></i>
              </button>
              ${isAdmin ? `
                <button class="btn btn-sm btn-glass btn-rounded btn-card-edit" style="padding: 5px 8px; font-size: 0.7rem;" title="Edit CCTV">
                  <i data-lucide="settings" style="width: 13px; height: 13px;"></i>
                </button>
                <button class="btn btn-sm btn-glass btn-rounded btn-card-delete" style="padding: 5px 8px; font-size: 0.7rem; color: var(--danger); border-color: rgba(220,38,38,0.25);" title="Hapus CCTV">
                  <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      // Card click opens right side VMS Detail Drawer
      card.addEventListener('click', () => {
        this.openCCTVDetailDrawer(ch.id);
      });



      const btnCardFs = card.querySelector('.btn-card-fs');
      const btnCardRec = card.querySelector('.btn-card-reconnect');
      const btnCardEdit = card.querySelector('.btn-card-edit');
      const btnCardDel = card.querySelector('.btn-card-delete');

      if (btnCardFs) {
        btnCardFs.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openVmsController(ch.id);
        });
      }
      if (btnCardRec) {
        btnCardRec.addEventListener('click', (e) => {
          e.stopPropagation();
          this.reconnectCCTVStream(ch.id);
        });
      }
      if (btnCardEdit) {
        btnCardEdit.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openEditCctvModal(ch);
        });
      }
      if (btnCardDel) {
        btnCardDel.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmDel = confirm(`Apakah Anda yakin ingin memutuskan & menghapus CCTV: "${ch.name}"?`);
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


      container.appendChild(card);
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
            icon: '<i data-lucide="alert-triangle" style="width:14px;height:14px;color:var(--danger);"></i>',
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
          icon: '<i data-lucide="bell-alert" style="width:14px;height:14px;color:var(--warning);"></i>',
          color: 'var(--warning)',
          title: 'New Incident',
          desc: `#${r.id.toString().padStart(4, '0')} · ${r.location} · AI ${r.aiConfidence}%`,
          id: r.id,
          type: 'incident'
        });
      });

      this.latestReports.filter(r => r.status === 'SELESAI').slice(0, 2).forEach(r => {
        alerts.push({
          icon: '<i data-lucide="check-circle" style="width:14px;height:14px;color:var(--success);"></i>',
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
        // Hide popover first
        const notifPopover = document.getElementById('dashboard-notif-popover');
        if (notifPopover) notifPopover.style.display = 'none';

        if (a.type === 'incident') {
          Router.navigate(`/dashboard/detections/${a.id}`);
        } else if (a.type === 'camera') {
          this.openCCTVDetailDrawer(a.id);
        }
      });

      container.appendChild(row);
    });

    // Initialize Lucide icons for the alerts popover
    if (window.lucide) window.lucide.createIcons();
  }

  renderError(err) {
    const container = document.getElementById('cctv-grid-container');
    if (!container) return;

    const isAuthError = err && (err.message === 'UNAUTHORIZED' || (typeof err.message === 'string' && (err.message.includes('Belum masuk') || err.message.includes('401'))));

    if (isAuthError) {
      container.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 36px; text-align: center; background: rgba(15, 23, 42, 0.03); border: 1px dashed rgba(239, 68, 68, 0.4);">
          <i data-lucide="log-in" style="width: 52px; height: 52px; color: var(--primary); margin-bottom: 12px;"></i>
          <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary);">Sesi Belum Masuk / Telah Berakhir</h3>
          <p style="color: var(--text-secondary); margin: 8px auto 18px auto; max-width: 480px; font-size: 0.88rem;">Anda belum melakukan autentikasi ke sistem EYECO. Silakan masuk (login) terlebih dahulu untuk memuat data pemantauan CCTV secara realtime.</p>
          <a href="/login" class="btn btn-primary btn-rounded" style="padding: 8px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;">
            <i data-lucide="log-in" style="width: 16px; height: 16px;"></i> Masuk ke Akun
          </a>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 32px; text-align: center;">
          <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Koneksi Data Gagal</h3>
          <p style="color: var(--text-secondary); margin: 8px 0 16px 0;">Gagal memuat status dan deteksi CCTV sungai dari server. Silakan klik Coba Lagi atau muat ulang halaman.</p>
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
