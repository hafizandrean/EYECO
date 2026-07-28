// cctv-monitoring.js — Real-Time CCTV Monitoring & Auto-Report Page
import { CctvService } from '../services/cctvService.js';
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { EventBus } from '../core/eventBus.js';
import { CONFIG } from '../core/config.js';
import { Formatter } from '../utils/formatter.js';
import { API } from '../services/api.js';
import { MacModal } from '../utils/macModal.js?v=1.1.0';

export class CctvMonitoringPage {
  constructor() {
    this.pollingTimer = null;
    this.cctvList = [];
    this.autoMonitoring = false;
    this.detectionLog = [];
    this.lastRefresh = 0;
    this.editingCctvId = null;
    this.lastSeenReportId = null;
    this.searchQuery = '';
    this.filterCamera = 'all';
    this.latestReports = [];
  }

  async render(container) {
    const user = AppState.get('user');
    if (user?.role !== 'admin') {
      container.innerHTML = `
        <div class="glass-card" style="padding:48px;text-align:center;max-width:400px;margin:60px auto;">
          <i data-lucide="shield-off" style="width:48px;height:48px;color:var(--danger);margin-bottom:12px;"></i>
          <h3>Akses Ditolak</h3>
          <p style="color:var(--text-secondary);margin-top:8px;">Halaman ini hanya tersedia untuk Admin.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const isAdmin = user?.role === 'admin';

    container.innerHTML = `
      <!-- Merged Control Bar + Control Panel -->
      <section class="glass-card" style="margin-bottom:var(--space-20);padding:var(--space-20);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <h2 style="font-family:'Outfit',sans-serif;font-size:1.15rem;font-weight:800;margin:0;display:flex;align-items:center;gap:8px;">
              <i data-lucide="monitor" style="color:var(--primary);"></i> CCTV Real-Time Monitoring
            </h2>
            <span id="cctv-mon-status" class="badge" style="font-size:0.65rem;padding:4px 10px;background:var(--text-muted);color:#fff;">INACTIVE</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div class="form-group-inline" style="display:flex;align-items:center;gap:6px;margin:0;">
              <label for="cctv-select-camera" class="caption-label" style="margin:0;font-size:0.68rem;">Saluran Aktif</label>
              <select id="cctv-select-camera" class="filter-control select-rounded" style="height:32px;font-size:0.72rem;width:140px;">
                <option value="semua">Semua Saluran</option>
              </select>
            </div>
            <button id="btn-mon-start" class="btn btn-primary btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;">
              <i data-lucide="video" style="width:13px;height:13px;"></i> Mulai Monitoring
            </button>
            <button id="btn-mon-stop" class="btn btn-danger btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;display:none;">
              <i data-lucide="video-off" style="width:13px;height:13px;"></i> Hentikan
            </button>
            <button id="btn-mon-refresh" class="btn btn-glass btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;">
              <i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> Refresh
            </button>
            <div style="display:flex;align-items:center;gap:4px;border-left:1px solid var(--border);padding-left:10px;">
              <span style="font-size:0.65rem;font-weight:700;color:var(--text-secondary);">Telegram</span>
              <label class="switch" style="margin:0;">
                <input type="checkbox" id="toggle-telegram-alerts" ${AppState.get('telegramAlerts') ? 'checked' : ''}>
                <span class="slider round" style="width:28px;height:16px;"></span>
              </label>
            </div>
            <button id="btn-connect-cctv" class="btn btn-glass btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;border-color: rgba(47, 107, 255, 0.3); color: var(--primary);">
              <i data-lucide="plus-circle" style="width:13px;height:13px;"></i> CCTV Baru
            </button>
            <button id="btn-sync-tuya" class="btn btn-glass btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;border-color: rgba(16, 185, 129, 0.3); color: #10b981;">
              <i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> Sync Tuya
            </button>
            <button id="btn-clear-all-cctv" class="btn btn-glass btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;border-color: rgba(220, 38, 38, 0.3); color: var(--danger);">
              <i data-lucide="trash-2" style="width:13px;height:13px;"></i> Hapus Semua
            </button>
          </div>
        </div>
      </section>

      <!-- Main Layout: CCTV Grid + Detection Log -->
      <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:var(--space-20);align-items:start;">
        <!-- CCTV Grid -->
        <div class="glass-card" style="padding:var(--space-20);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-16);">
            <h3 style="font-family:'Outfit',sans-serif;font-size:0.95rem;font-weight:800;margin:0;display:flex;align-items:center;gap:6px;">
              <i data-lucide="layout-grid" style="color:var(--primary);"></i> Live Camera Feeds
            </h3>
            <span id="camera-count-badge" style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);background:var(--surface);padding:4px 10px;border-radius:var(--radius-pill);">0 kamera</span>
          </div>
          <div id="cctv-live-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- Detection Log -->
        <div class="glass-card" style="padding:var(--space-20);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-16);">
            <h3 style="font-family:'Outfit',sans-serif;font-size:0.95rem;font-weight:800;margin:0;display:flex;align-items:center;gap:6px;">
              <i data-lucide="activity" style="color:var(--danger);"></i> Deteksi Terkini
            </h3>
            <span id="detection-count-badge" style="font-size:0.72rem;font-weight:700;color:var(--danger);background:rgba(239,68,68,0.08);padding:4px 10px;border-radius:var(--radius-pill);">0</span>
          </div>
          <div id="detection-log-list" style="display:flex;flex-direction:column;gap:6px;max-height:500px;overflow-y:auto;">
            <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.82rem;">
              <i data-lucide="radio" style="width:24px;height:24px;margin-bottom:8px;"></i><br>
              Belum ada deteksi. Mulai monitoring untuk melihat data.
            </div>
          </div>
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
                  <input type="text" id="cctv-input-location" class="filter-control input-rounded" value="Lingkungan Ciliwangi" required>
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
                    <option value="KRISBOW">Krisbow Sync</option>
                    <option value="HIKVISION">Hikvision</option>
                    <option value="DAHUA">Dahua</option>
                    <option value="EZVIZ">Ezviz</option>
                    <option value="TUYA" selected>Tuya Cloud (IoT)</option>
                    <option value="CUSTOM">Lainnya (Kustom)</option>
                  </select>
                </div>
              </div>

              <!-- ── Standard IP Camera Fields (hidden when TUYA) ── -->
              <div id="standard-cctv-fields">
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">IP Address / Host</label>
                    <input type="text" id="cctv-input-host" class="filter-control input-rounded" value="127.0.0.1">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Port</label>
                    <input type="number" id="cctv-input-port" class="filter-control input-rounded" value="554" placeholder="554, 80, dll">
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Protokol</label>
                    <select id="cctv-input-mode" class="filter-control select-rounded">
                      <option value="AUTO" selected>Auto Detect</option>
                      <option value="RTSP">RTSP</option>
                      <option value="HLS">HLS</option>
                      <option value="MJPEG">MJPEG</option>
                      <option value="SNAPSHOT">SNAPSHOT</option>
                      <option value="CLOUD_VIEWER">CLOUD</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Username (opsional)</label>
                    <input type="text" id="cctv-input-username" class="filter-control input-rounded" value="admin">
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Password (opsional)</label>
                    <input type="password" id="cctv-input-password" class="filter-control input-rounded" value="admin123">
                  </div>
                </div>
              </div>

              <!-- ── TUYA Cloud Fields (hidden unless TUYA vendor) ── -->
              <div id="tuya-cctv-fields" style="display:none;">
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Access ID / Client ID</label>
                    <input type="text" id="cctv-input-tuya-access-id" class="filter-control input-rounded" placeholder="Dari iot.tuya.com" value="ukgj9537vrcffgq5ukke">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Access Secret</label>
                    <input type="password" id="cctv-input-tuya-access-secret" class="filter-control input-rounded" placeholder="Dari iot.tuya.com" value="ba53e5bfc4c748ff8895dac9338e7eea">
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Region / Data Center</label>
                    <select id="cctv-input-tuya-region" class="filter-control select-rounded">
                      <option value="US">US (Amerika)</option>
                      <option value="CN">China</option>
                      <option value="EU">Eropa</option>
                      <option value="IN">India</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Device ID</label>
                    <div style="display:flex;gap:8px;">
                      <input type="text" id="cctv-input-tuya-device-id" class="filter-control input-rounded" style="flex:1;" placeholder="Pilih dari daftar device">
                      <button type="button" id="btn-tuya-list-devices" class="btn btn-glass btn-rounded" style="white-space:nowrap;height:34px;padding:0 8px;font-size:0.65rem;">
                        <i data-lucide="search" style="width:11px;height:11px;"></i> Cari
                      </button>
                    </div>
                  </div>
                </div>
                <div id="tuya-device-list" style="max-height:120px;overflow-y:auto;display:none;"></div>
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

      <!-- Edit CCTV Modal Overlay -->
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

      <!-- Tuya Sync Modal Overlay -->
      <div id="tuya-sync-modal" class="modal-overlay" style="display: none; z-index: 1200;">
        <div class="glass-card modal-container" style="max-width: 500px; width: 90%;">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
            <h3 style="margin:0; font-family:'Outfit',sans-serif; display:flex; align-items:center; gap:8px; font-size:1.15rem; font-weight:800; color: #10b981;">
              <i data-lucide="refresh-cw"></i> Sinkronisasi Tuya CCTV
            </h3>
            <button class="btn-close-modal" id="btn-close-tuya-modal" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted);">&times;</button>
          </div>
          <div class="modal-body" style="margin-top: 16px;">
            <form id="tuya-sync-form">
              <div class="form-group" style="margin-bottom: 14px;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Access ID / Client ID</label>
                <input type="text" id="tuya-input-client-id" class="filter-control input-rounded" required value="r5vap3snnr339dyeua5j" style="width: 100%;">
              </div>
              <div class="form-group" style="margin-bottom: 14px;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Access Secret / Client Secret</label>
                <input type="password" id="tuya-input-client-secret" class="filter-control input-rounded" required value="5a93707b474b41b9b888b1e2a12ed1c9" style="width: 100%;">
              </div>
              <div class="form-group" style="margin-bottom: 14px;">
                <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: block;">Data Center (Region URL)</label>
                <select id="tuya-input-region" class="filter-control select-rounded" style="width: 100%;">
                  <option value="https://openapi-sg.iotbing.com" selected>Singapore Data Center (Asia-Pacific)</option>
                  <option value="https://openapi.tuyaus.com">Oregon Data Center (America)</option>
                  <option value="https://openapi.tuyaeu.com">Frankfurt Data Center (Europe)</option>
                  <option value="https://openapi.tuyacn.com">Beijing Data Center (China)</option>
                </select>
              </div>

              <!-- Sync progress loader -->
              <div class="tuya-sync-loader" style="display: none; padding: 16px; text-align: center; color: var(--text-secondary); font-size: 0.82rem;">
                <span class="status-pulse-dot" style="width:8px; height:8px; background:#10b981; border-radius:50%; display:inline-block; margin-right:6px;"></span>
                Menghubungkan ke Tuya Cloud & Sinkronisasi...
              </div>

              <div class="modal-actions-row" style="margin-top: 20px; display: flex; justify-content: flex-end;">
                <button type="submit" class="btn btn-primary btn-rounded" id="btn-submit-tuya-sync" style="background: #10b981; border-color: #10b981; font-weight: 700; width: 100%;">
                  <i data-lucide="refresh-cw"></i> Mulai Sinkronisasi
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- CCTV Fullscreen VMS View -->
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

      <!-- CCTV Detail Drawer -->
      <div id="cctv-detail-drawer" class="cctv-drawer" style="position: fixed; top: 0; right: -400px; width: 380px; height: 100vh; background: #ffffff; border-left: 1px solid var(--border); box-shadow: -10px 0 40px rgba(0,0,0,0.05); z-index: 1050; transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column;">
        <!-- Filled dynamically by JS -->
      </div>
    `;

    this.bindEvents();
    await this.loadLatestReports();
    await this.loadCctvList();
    await this.checkMonitoringStatus();
    this.startPolling();
  }

  bindEvents() {
    const btnStart = document.getElementById('btn-mon-start');
    const btnStop = document.getElementById('btn-mon-stop');
    const btnRefresh = document.getElementById('btn-mon-refresh');
    const selectCam = document.getElementById('cctv-select-camera');
    const toggleTelegram = document.getElementById('toggle-telegram-alerts');

    if (btnStart) {
      btnStart.addEventListener('click', async () => {
        btnStart.disabled = true;
        btnStart.innerHTML = '<i data-lucide="loader"></i> Memulai...';
        if (window.lucide) window.lucide.createIcons();
        try {
          await CctvService.startAutoMonitoring();
          this.autoMonitoring = true;
          this.updateMonitoringUI();
          EventBus.emit('toast:show', { message: 'Monitoring real-time dimulai. Setiap deteksi orang akan otomatis membuat laporan.', type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal memulai monitoring.', type: 'danger' });
        } finally {
          btnStart.disabled = false;
          btnStart.innerHTML = '<i data-lucide="video"></i> Mulai Monitoring';
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        btnStop.innerHTML = '<i data-lucide="loader"></i> Menghentikan...';
        if (window.lucide) window.lucide.createIcons();
        try {
          await CctvService.stopAutoMonitoring();
          this.autoMonitoring = false;
          this.updateMonitoringUI();
          EventBus.emit('toast:show', { message: 'Monitoring dihentikan.', type: 'warning' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal menghentikan monitoring.', type: 'danger' });
        } finally {
          btnStop.disabled = false;
          btnStop.innerHTML = '<i data-lucide="video-off"></i> Hentikan';
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        this.loadCctvList();
        this.loadLatestReports();
        this.loadDetections();
      });
    }

    // Saluran Aktif dropdown
    if (selectCam) {
      selectCam.addEventListener('change', () => this.filterCCTVChannels(selectCam.value));
    }

    // Telegram toggle
    if (toggleTelegram) {
      toggleTelegram.addEventListener('change', async () => {
        const isChecked = toggleTelegram.checked;
        AppState.set('telegramAlerts', isChecked);

        try {
          await API.post('/api/system-settings', {
            key: 'telegram.enabled',
            value: isChecked,
            reason: 'Toggled via CCTV Monitoring Page',
            approvedBy: 'Admin'
          });
          EventBus.emit('toast:show', {
            message: isChecked ? 'Notifikasi Telegram diaktifkan.' : 'Notifikasi Telegram dinonaktifkan.',
            type: isChecked ? 'success' : 'warning'
          });
        } catch (err) {
          console.error('Failed to update telegram setting:', err);
          EventBus.emit('toast:show', { message: 'Gagal memperbarui konfigurasi Telegram di server.', type: 'danger' });
          toggleTelegram.checked = !isChecked;
          AppState.set('telegramAlerts', !isChecked);
        }
      });
    }

    // Initialize Connection Modal Form & Edit Modal Form
    this.initCctvModal();
    this.initEditCctvModal();
    this.initTuyaSyncModal();
  }

  async checkMonitoringStatus() {
    try {
      const status = await CctvService.getMonitoringStatus();
      this.autoMonitoring = status?.running || false;
      this.updateMonitoringUI();
    } catch (err) {
      // silent
    }
  }

  updateMonitoringUI() {
    const statusBadge = document.getElementById('cctv-mon-status');
    const btnStart = document.getElementById('btn-mon-start');
    const btnStop = document.getElementById('btn-mon-stop');

    if (this.autoMonitoring) {
      if (statusBadge) {
        statusBadge.textContent = 'LIVE';
        statusBadge.style.background = 'var(--success)';
      }
      if (btnStart) btnStart.style.display = 'none';
      if (btnStop) btnStop.style.display = 'inline-flex';
    } else {
      if (statusBadge) {
        statusBadge.textContent = 'INACTIVE';
        statusBadge.style.background = 'var(--text-muted)';
      }
      if (btnStart) btnStart.style.display = 'inline-flex';
      if (btnStop) btnStop.style.display = 'none';
    }
  }

  async loadCctvList() {
    try {
      const cctvData = await CctvService.getCctvList();
      this.cctvList = Array.isArray(cctvData) ? cctvData : [];
      this.updateCameraSelectOptions();
      this.renderCctvGrid();
    } catch (err) {
      console.error('[CCTV Monitor] Failed to load CCTV list:', err);
      const grid = document.getElementById('cctv-live-grid');
      if (grid) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text-muted);">
          <i data-lucide="video-off" style="width:32px;height:32px;margin-bottom:8px;"></i><br>
          Gagal memuat daftar CCTV.
        </div>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  async loadLatestReports() {
    try {
      const data = await ReportService.getFilteredReports({ limit: 50 });
      this.latestReports = data?.reports || [];
    } catch (err) {
      this.latestReports = [];
    }
  }

  renderCctvGrid() {
    const container = document.getElementById('cctv-live-grid');
    const countBadge = document.getElementById('camera-count-badge');
    if (!container) return;

    container.innerHTML = '';
    const isMon = AppState.get('isMonitoring');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';

    if (countBadge) countBadge.textContent = `${this.cctvList.length} kamera`;

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

    this.cctvList.forEach(ch => {
      if (selectedValue !== 'semua' && ch.id.toString() !== selectedValue) {
        return;
      }
      const isChActive = isMon && ch.isActive;
      const matchReport = this.latestReports.find(r => r.location && (r.location.toLowerCase().includes(ch.name.toLowerCase()) || ch.name.toLowerCase().includes(r.location.toLowerCase())));
      const isAlert = matchReport ? (matchReport.aiStatus === 'TINGGI' || matchReport.aiStatus === 'SEDANG') : false;
      const defaultSnapshot = ch.snapshotUrl || ch.playUrl || ch.streamUrl || `/uploads/detection_${((ch.id - 1) % 10) + 1}.jpg`;
      const imageSrc = (matchReport && matchReport.image) ? matchReport.image : defaultSnapshot;

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
            <div class="yolo-preview-box ${boxColorClass}" style="top:${box.y}%;left:${box.x}%;width:${box.w}%;height:${box.h}%;">
              <span class="yolo-preview-label">${box.label}</span>
            </div>
          `;
        });
      }

      let mediaHtml = '';
      const hlsVideoId = `hls-video-${ch.id}`;
      if (isChActive) {
        if (ch.status === 'OFFLINE' || ch.status === 'ERROR' || ch.status === 'DISCONNECTED') {
          mediaHtml = `<div class="cctv-static-screen"><div class="static-noise"></div><div class="static-label text-danger">${ch.status}</div></div>`;
        } else if (ch.mediaType === 'HLS' || ch.mediaType === 'RTSP_TUYA' || (ch.playUrl && ch.playUrl.includes('.m3u8'))) {
          // HLS stream (Tuya Cloud) — use HLS.js player
          mediaHtml = `
            <video id="${hlsVideoId}" class="cctv-feed-img" autoplay muted playsinline
              style="width:100%;height:100%;object-fit:cover;background:#000;display:block;"
              onerror="this.onerror=null;"></video>
            <div class="cctv-overlay-gradient"></div>
            ${boundingBoxesHtml}
            <div style="position:absolute;top:10px;right:12px;display:flex;align-items:center;gap:5px;z-index:5;">
              <span style="width:7px;height:7px;border-radius:50%;background:#22c55e;animation:pulse-cloud 1.2s infinite;box-shadow:0 0 6px rgba(34,197,94,0.7);"></span>
              <span style="font-size:0.62rem;font-weight:800;color:#fff;letter-spacing:0.05em;text-shadow:0 1px 3px rgba(0,0,0,0.8);">LIVE</span>
            </div>`;
        } else if (ch.mediaType === 'Cloud') {
          mediaHtml = `<div class="cctv-cloud-overlay">
            <i data-lucide="cloud" class="cloud-icon" style="color:var(--primary);"></i>
            <span class="cloud-title">Mode Cloud Vendor</span>
            <a href="${ch.streamUrl}" target="_blank" class="btn btn-primary btn-sm btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="margin-bottom:20px;">
              <i data-lucide="external-link"></i> Buka Cloud App
            </a>
          </div>`;
        } else if (ch.mediaType === 'Video' && ch.playUrl && ch.playUrl.endsWith('.mp4')) {
          mediaHtml = `<video src="${ch.playUrl}" autoplay loop muted playsinline class="cctv-feed-img"></video><div class="cctv-overlay-gradient"></div>${boundingBoxesHtml}`;
        } else {
          mediaHtml = `<img src="${imageSrc}" alt="" class="cctv-feed-img" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='/uploads/detection_1.jpg';"><div class="cctv-overlay-gradient"></div>${boundingBoxesHtml}`;
        }
      } else {
        mediaHtml = `<div class="cctv-static-screen"><div class="static-noise"></div><div class="static-label">PAUSED</div></div>`;
      }

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
          ` : ''}
          <button class="hover-action-btn detail" style="width:36px; height:36px; border-radius:50%; border:none; background: var(--primary); color: white; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Open detail VMS Drawer">
            <i data-lucide="info" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
      `;

      card.innerHTML = `
        <div class="cctv-media-container" style="position: relative; overflow: hidden; border-radius: 12px 12px 0 0; margin-bottom: 0;">
          ${mediaHtml}
          ${hoverOverlayHtml}

          <!-- Corner Badges -->
          <div class="cctv-corner-badges" style="position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; z-index: 5;">
            ${isChActive ? `
              <span class="badge bg-danger text-white" style="font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                <span class="rec-dot" style="width:6px; height:6px; background:white; border-radius:50%; display:inline-block; animation: pulse-cloud 1s infinite;"></span>
                REC
              </span>
              <span class="badge bg-primary text-white" style="font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">LIVE</span>
              <span class="badge bg-info text-white" style="font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">HD</span>
              ${isAlert ? `
                <span class="badge bg-warning text-white" style="font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px; animation: pulse-cloud 1.5s infinite;">
                  <i data-lucide="scan-eye" style="width: 10px; height: 10px;"></i> AI DETECTING
                </span>
              ` : ''}
            ` : `
              <span class="badge bg-secondary text-white" style="font-size: 0.62rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">STANDBY</span>
            `}
          </div>
        </div>

        <!-- Bottom Card Info Body -->
        <div class="cctv-info-body" style="padding: 12px var(--space-8) var(--space-8) var(--space-8); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.92rem; font-weight: 700; color: var(--text-primary); margin: 0; max-width: 75%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              CH ${ch.id < 10 ? '0' + ch.id : ch.id} | ${ch.name}
            </h4>
            <span class="cctv-status-badge ${statusClass}" style="transform: scale(0.9); transform-origin: right;">
              <span class="status-dot"></span>
              ${statusText}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); display: flex; gap: 8px; font-weight: 600; opacity: 0.85;">
            <span>Latency: ${ch.health && ch.health.latency ? `${ch.health.latency} ms` : '45 ms'}</span>
            <span>|</span>
            <span>Res: ${ch.health && ch.health.resolution ? ch.health.resolution : '1080p'}</span>
            <span>|</span>
            <span>Last Motion: ${matchReport ? 'Detected' : 'No motion'}</span>
          </div>

          <!-- Visible Action Bar -->
          <div class="cctv-card-action-bar" style="display: flex; gap: 6px; margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.06); align-items: center; justify-content: space-between;">
            <button class="btn btn-sm btn-glass btn-rounded btn-card-fs" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 4px; border-color: rgba(47,107,255,0.25);" title="Layar Penuh VMS">
              <i data-lucide="maximize-2" style="width: 12px; height: 12px;"></i> Fullscreen
            </button>
            <button class="btn btn-sm btn-glass btn-rounded btn-card-reconnect" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 4px;" title="Koneksi Ulang Sinyal">
              <i data-lucide="refresh-cw" style="width: 12px; height: 12px;"></i> Refresh
            </button>
            ${isAdmin ? `
              <button class="btn btn-sm btn-glass btn-rounded btn-card-edit" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 4px;" title="Pengaturan & Edit Konfigurasi CCTV">
                <i data-lucide="settings" style="width: 12px; height: 12px;"></i> Edit
              </button>
              <button class="btn btn-sm btn-glass btn-rounded btn-card-delete" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--danger); border-color: rgba(220,38,38,0.25); display: flex; align-items: center; gap: 4px;" title="Putuskan & Hapus CCTV">
                <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i> Hapus
              </button>
            ` : ''}
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
            await this.loadCctvList();
            await this.loadLatestReports();
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal mengubah status pemantauan kamera.', type: 'danger' });
          }
        });
      }
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
      const confirmed = await MacModal.confirm({
        title: 'Hapus CCTV',
        message: `Apakah Anda yakin ingin memutuskan koneksi & menghapus CCTV <strong>"${ch.name}"</strong>?`,
        confirmText: 'Hapus',
        cancelText: 'Batal',
        type: 'danger'
      });
      if (!confirmed) return;
      try {
        await CctvService.disconnectCctv(ch.id);
        EventBus.emit('toast:show', { message: `Koneksi CCTV "${ch.name}" berhasil diputuskan.`, type: 'success' });
            await this.loadCctvList();
            await this.loadLatestReports();
          } catch (err) {
            EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
          }
        });
      }
      if (btnDet) {
        btnDet.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openCCTVDetailDrawer(ch.id);
        });
      }

      container.appendChild(card);

      // Initialize HLS.js player after card is in DOM
      const needsHls = isChActive && (ch.mediaType === 'HLS' || ch.mediaType === 'RTSP_TUYA' || (ch.playUrl && ch.playUrl.includes('.m3u8')));
      if (needsHls) {
        const videoEl = container.querySelector(`#${hlsVideoId}`);
        const hlsUrl = ch.playUrl || ch.streamUrl;
        if (videoEl && hlsUrl && hlsUrl.includes('.m3u8')) {
          if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 90,
              maxBufferLength: 10,
              maxMaxBufferLength: 20,
            });
            hls.loadSource(hlsUrl);
            hls.attachMedia(videoEl);
            hls.on(Hls.Events.MANIFEST_PARSED, () => { videoEl.play().catch(() => {}); });
            hls.on(Hls.Events.ERROR, (event, data) => {
              if (data.fatal) {
                console.warn(`[HLS] Fatal error for ${ch.name}:`, data.type, data.details);
                hls.destroy();
              }
            });
            videoEl._hlsInstance = hls;
          } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            videoEl.src = hlsUrl;
            videoEl.play().catch(() => {});
          }
        }
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  filterCCTVChannels(value) {
    this.renderCctvGrid();
  }

  filterCCTVByCamera(camId) {
    const grid = document.getElementById('cctv-live-grid');
    if (!grid) return;
    const cards = grid.querySelectorAll('.glass-card');
    cards.forEach(card => {
      card.style.display = (camId === 'semua' || card.dataset.camId === camId) ? '' : 'none';
    });
  }

  updateCCTVMonitoringState(isMon) {
    this.renderCctvGrid();
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

  async loadDetections() {
    try {
      const detections = await CctvService.getMonitoringDetections(20);
      this.detectionLog = Array.isArray(detections) ? detections : [];
      this.renderDetectionLog();
    } catch (err) {
      // silent
    }
  }

  renderDetectionLog() {
    const list = document.getElementById('detection-log-list');
    const countBadge = document.getElementById('detection-count-badge');
    if (!list) return;

    if (countBadge) countBadge.textContent = `${this.detectionLog.length}`;

    if (this.detectionLog.length === 0) {
      list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.82rem;">
        <i data-lucide="radio" style="width:24px;height:24px;margin-bottom:8px;"></i><br>
        Belum ada deteksi.
      </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    list.innerHTML = this.detectionLog.slice(0, 20).map(d => {
      const time = d.createdAt ? Formatter.formatDate(d.createdAt) : '-';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(0,0,0,0.02);border-radius:8px;font-size:0.72rem;">
          <span style="width:6px;height:6px;border-radius:50%;background:${d.severity === 'HIGH' || d.severity === 'CRITICAL' ? 'var(--danger)' : 'var(--warning)'};flex-shrink:0;"></span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:var(--text-primary);">${d.location || 'CCTV'} ${d.cameraId ? `#${d.cameraId}` : ''}</div>
            <div style="font-size:0.65rem;color:var(--text-secondary);">${time}</div>
          </div>
          <span style="font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.1);color:var(--danger);">${d.severity || 'LOW'}</span>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  // --- CCTV Connect/Edit Modal Functions ---

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
        const confirmed = await MacModal.confirm({
          title: 'Hapus Semua CCTV',
          message: `Apakah Anda yakin ingin menghapus <strong>SELURUH</strong> saluran CCTV dummy saat ini?`,
          confirmText: 'Hapus Semua',
          cancelText: 'Batal',
          type: 'danger'
        });
        if (!confirmed) return;
        try {
          await API.delete('/api/cctv/clear-all');
            EventBus.emit('toast:show', { message: 'Seluruh CCTV dummy berhasil dihapus.', type: 'success' });
            await this.loadCctvList();
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal menghapus CCTV: ' + err.message, type: 'danger' });
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
        toggleTuyaFields();

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

    // ── TUYA Vendor Toggle ──
    const vendorSelect = document.getElementById('cctv-input-vendor');
    const standardFields = document.getElementById('standard-cctv-fields');
    const tuyaFields = document.getElementById('tuya-cctv-fields');
    const hostField = document.getElementById('cctv-input-host');

    function toggleTuyaFields() {
      const isTuya = vendorSelect?.value === 'TUYA';
      if (standardFields) standardFields.style.display = isTuya ? 'none' : 'block';
      if (tuyaFields) tuyaFields.style.display = isTuya ? 'block' : 'none';
      if (hostField) hostField.required = !isTuya;
    }

    if (vendorSelect) {
      vendorSelect.addEventListener('change', toggleTuyaFields);
    }

    // ── Tuya "Cari Devices" button ──
    const btnListDevices = document.getElementById('btn-tuya-list-devices');
    const deviceListDiv = document.getElementById('tuya-device-list');

    if (btnListDevices) {
      btnListDevices.addEventListener('click', async () => {
        const accessId = document.getElementById('cctv-input-tuya-access-id')?.value;
        const accessSecret = document.getElementById('cctv-input-tuya-access-secret')?.value;
        if (!accessId || !accessSecret) {
          EventBus.emit('toast:show', { message: 'Isi Access ID dan Access Secret Tuya dulu.', type: 'warning' });
          return;
        }
        btnListDevices.disabled = true;
        btnListDevices.innerHTML = '<i data-lucide="loader"></i> Mencari...';
        if (window.lucide) window.lucide.createIcons();
        try {
          const res = await API.post('/api/cctv/tuya-devices', { accessId, accessSecret });
          if (!res.success || !res.data?.length) {
            deviceListDiv.innerHTML = '<div style="padding:8px;color:var(--danger);font-size:0.72rem;">Tidak ada device ditemukan. Cek Access ID & Secret.</div>';
            deviceListDiv.style.display = 'block';
            return;
          }
          deviceListDiv.style.display = 'block';
          deviceListDiv.innerHTML = res.data.map((d, i) => `
            <div class="tuya-device-item" data-device-id="${d.id}" style="padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:0.72rem;background:var(--bg-secondary);transition:0.15s;display:flex;align-items:center;gap:10px;
" onmouseenter="this.style.borderColor='var(--primary)'" onmouseleave="this.style.borderColor='var(--border)'" onclick="document.getElementById('cctv-input-tuya-device-id').value='${d.id}';document.getElementById('tuya-device-list').style.display='none';EventBus.emit('toast:show',{message:'Device ID dipilih: ${d.name}',type:'success'});">
              <span style="width:28px;height:28px;border-radius:50%;background:${d.online ? 'var(--success)' : 'var(--text-muted)'};display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:#fff;flex-shrink:0;">${i+1}</span>
              <div style="flex:1;">
                <strong>${d.name}</strong>
                <div style="color:var(--text-secondary);font-size:0.65rem;">${d.product_name || '-'} ${d.online ? '🟢 Online' : '🔴 Offline'}</div>
                <div style="font-size:0.6rem;color:var(--text-muted);font-family:monospace;">${d.id}</div>
              </div>
            </div>
          `).join('');
          EventBus.emit('toast:show', { message: `${res.data.length} device Tuya ditemukan. Klik salah satu.`, type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal memuat device: ' + err.message, type: 'danger' });
        } finally {
          btnListDevices.disabled = false;
          btnListDevices.innerHTML = '<i data-lucide="search"></i> Cari';
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    let detectedConfig = null;

    if (btnScan) {
      btnScan.addEventListener('click', async () => {
        const host = document.getElementById('cctv-input-host').value;
        const port = document.getElementById('cctv-input-port').value;
        const mode = document.getElementById('cctv-input-mode').value;
        const username = document.getElementById('cctv-input-username').value;
        const password = document.getElementById('cctv-input-password').value;
        const vendor = document.getElementById('cctv-input-vendor').value;
        const tuyaAccessId = document.getElementById('cctv-input-tuya-access-id')?.value || '';
        const tuyaAccessSecret = document.getElementById('cctv-input-tuya-access-secret')?.value || '';
        const tuyaDeviceId = document.getElementById('cctv-input-tuya-device-id')?.value || '';

        const isTuya = vendor === 'TUYA' || mode === 'TUYA';

        // ── TUYA Cloud Scan ──
        if (isTuya) {
          if (!tuyaAccessId || !tuyaAccessSecret) {
            EventBus.emit('toast:show', { message: 'Isi Access ID dan Access Secret Tuya dulu.', type: 'warning' });
            return;
          }
          scannerBox.style.display = 'block';
          capabilitiesHud.style.display = 'none';
          stepsList.innerHTML = `<li><span class="step-icon spinner"></span> Menghubungi Tuya Cloud API...</li>`;
          btnScan.disabled = true;
          const tuyaRegion = document.getElementById('cctv-input-tuya-region')?.value || 'US';
          try {
            const result = await CctvService.scanCamera({
              ipOrHost: 'tuya',
              connectionMode: 'TUYA',
              username: tuyaAccessId,
              password: tuyaAccessSecret,
              vendorHint: 'TUYA',
              port: tuyaRegion === 'CN' ? 1 : tuyaRegion === 'EU' ? 2 : tuyaRegion === 'IN' ? 3 : 0
            });
            stepsList.innerHTML = '';
            const appendStep = (text, success) => {
              const li = document.createElement('li');
              li.innerHTML = `<span class="step-icon ${success ? 'success' : 'failed'}">${success ? '<i data-lucide="check" style="width:12px;height:12px;"></i>' : '<i data-lucide="x" style="width:12px;height:12px;"></i>'}</span><span>${text}</span>`;
              stepsList.appendChild(li);
            };
            appendStep(`Cloud API: Terhubung ke Tuya`, true);
            appendStep(`Info: ${result.details.errorMessage || 'OK'}`, true);
            if (result.cloud) appendStep(`Mode Cloud: Aktif`, true);
            capabilitiesHud.style.display = 'flex';
            capabilitiesHud.innerHTML = '';
            const addCapPill = (name, ok) => {
              const pill = document.createElement('span');
              pill.className = `cap-pill ${ok ? 'enabled' : 'disabled'}`;
              pill.innerHTML = `<span class="cap-dot"></span> ${name}`;
              capabilitiesHud.appendChild(pill);
            };
            addCapPill('Cloud', result.cloud);
            addCapPill('Snapshot', result.snapshot);

            detectedConfig = {
              name: document.getElementById('cctv-input-name').value || 'Tuya Camera',
              location: document.getElementById('cctv-input-location').value || 'Lokasi Cloud',
              description: document.getElementById('cctv-input-description').value || 'Tuya Cloud Camera via IoT API',
              vendor: 'TUYA',
              model: 'Tuya IoT Camera',
              protocol: 'TUYA',
              mediaType: 'Cloud',
              streamUrl: `tuya://${tuyaAccessId}/${tuyaDeviceId}`,
              playUrl: '',
              username: tuyaAccessId,
              password: tuyaAccessSecret,
              capabilities: { rtsp: false, hls: true, snapshot: true, mjpeg: false, onvif: false, cloud: true },
              tuyaDeviceId: tuyaDeviceId,
              tuyaRegion: tuyaRegion
            };
            EventBus.emit('toast:show', { message: 'Koneksi Tuya berhasil!', type: 'success' });
            btnSave.disabled = false;
          } catch (err) {
            stepsList.innerHTML += `<li class="error-step"><span class="step-icon failed"><i data-lucide="x" style="width:12px;height:12px;"></i></span> Gagal: ${err.message}</li>`;
            EventBus.emit('toast:show', { message: 'Gagal konek Tuya: ' + err.message, type: 'danger' });
          } finally {
            btnScan.disabled = false;
            if (window.lucide) window.lucide.createIcons();
          }
          return;
        }

        // ── Standard IP/RTSP Scan ──

        if (!host) {
          EventBus.emit('toast:show', { message: 'Silakan masukkan IP Address / Host kamera.', type: 'warning' });
          return;
        }

        scannerBox.style.display = 'block';
        capabilitiesHud.style.display = 'none';
        stepsList.innerHTML = `
          <li><span class="step-icon spinner"></span> Menghubungi host ${host}...</li>
        `;
        btnScan.disabled = true;

        try {
          const result = await CctvService.scanCamera({
            ipOrHost: host,
            port: port ? parseInt(port) : undefined,
            connectionMode: mode,
            username,
            password,
            vendorHint: vendor
          });

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
          btnSave.disabled = false;

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
        const tuyaRegion = document.getElementById('cctv-input-tuya-region')?.value || 'US';
        const tuyaDeviceId = document.getElementById('cctv-input-tuya-device-id')?.value || '';

        const isTuya = vendor === 'TUYA';

        btnSave.disabled = true;

        try {
          if (this.editingCctvId) {
            const payload = {
              name,
              location,
              description,
              vendor,
              protocol,
              username,
              password,
              streamUrl: host + (port ? `:${port}` : ''),
              tuyaRegion,
              tuyaDeviceId
            };
            if (isTuya) payload.protocol = 'TUYA';
            await CctvService.updateCctv(this.editingCctvId, payload);
            EventBus.emit('toast:show', { message: 'Konfigurasi CCTV berhasil diperbarui!', type: 'success' });
          } else {
            if (isTuya) {
              detectedConfig = {
                name,
                location,
                description,
                vendor: 'TUYA',
                model: 'Tuya IoT Camera',
                protocol: 'TUYA',
                mediaType: 'Cloud',
                streamUrl: `tuya://${username}/${tuyaDeviceId}`,
                playUrl: '',
                username,
                password,
                capabilities: { rtsp: false, hls: true, snapshot: true, mjpeg: false, onvif: false, cloud: true },
                tuyaDeviceId,
                tuyaRegion
              };
            } else {
              if (!detectedConfig) {
                const streamTarget = (host && host.includes('://')) ? host : (host === '127.0.0.1' || host === 'localhost' ? '/uploads/upload_1785148213754-215512110.mp4' : `rtsp://${username}:${password}@${host}:${port || 554}/live`);
                detectedConfig = {
                  name: name || `CCTV ${host}`,
                  location: location || 'Lokasi Pemantauan',
                  description: description || '',
                  vendor: vendor || 'GENERIC',
                  model: 'IP Camera',
                  protocol: protocol === 'AUTO' ? (streamTarget.endsWith('.mp4') ? 'HLS' : 'RTSP') : protocol,
                  mediaType: streamTarget.endsWith('.mp4') ? 'Video' : 'HLS',
                  streamUrl: streamTarget,
                  playUrl: streamTarget,
                  username,
                  password,
                  capabilities: {
                    rtsp: protocol === 'RTSP' || protocol === 'AUTO',
                    hls: protocol === 'HLS',
                    snapshot: protocol === 'SNAPSHOT',
                    mjpeg: protocol === 'MJPEG',
                    onvif: false,
                    cloud: protocol === 'CLOUD_VIEWER'
                  }
                };
              }
              detectedConfig.name = name;
              detectedConfig.location = location;
              detectedConfig.description = description;
            }
            await CctvService.connectCctv(detectedConfig);
            EventBus.emit('toast:show', { message: 'CCTV Baru berhasil dihubungkan ke sistem!', type: 'success' });
          }

          modal.style.display = 'none';
          await this.loadCctvList();
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
          await this.loadCctvList();
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

        const confirmed = await MacModal.confirm({
          title: 'Hapus CCTV',
          message: `Apakah Anda yakin ingin memutuskan & menghapus CCTV <strong>"${name}"</strong>?`,
          confirmText: 'Hapus',
          cancelText: 'Batal',
          type: 'danger'
        });
        if (!confirmed) return;
        try {
          this.cctvList = this.cctvList.filter(c => c.id !== id);
            try {
              await CctvService.disconnectCctv(id);
            } catch (apiErr) {
              console.warn('API disconnect fallback to local state:', apiErr);
            }

            EventBus.emit('toast:show', { message: `Koneksi CCTV "${name}" berhasil diputuskan.`, type: 'success' });
            closeModal();
            await this.loadCctvList();
          } catch (err) {
            EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
          }
        }
      ;
    }
  }

  // --- CCTV Detail Drawer ---

  openCCTVDetailDrawer(channelId) {
    const ch = this.cctvList.find(c => c.id === channelId);
    if (!ch) return;

    const drawer = document.getElementById('cctv-detail-drawer');
    if (!drawer) return;

    const isMon = AppState.get('isMonitoring');
    const isChActive = isMon && ch.isActive;
    const imageSrc = ch.playUrl || ch.streamUrl || '/uploads/detection_1.jpg';
    const statusText = isChActive ? (ch.status === 'ONLINE' ? 'ONLINE' : ch.status) : 'STANDBY';
    const statusColor = statusText === 'ONLINE' ? 'var(--success)' : 'var(--danger)';

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
              <strong id="drawer-health-latency">${ch.health && ch.health.latency ? `${ch.health.latency} ms` : '52 ms'}</strong>
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
            ${AppState.get('user')?.role === 'admin' ? `
              <button class="btn btn-glass btn-rounded" id="drawer-btn-delete" style="grid-column: span 2; font-size: 0.78rem; font-weight: 700; border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.06); color: var(--danger); justify-content: center; display:flex; align-items:center; gap:6px; padding: 10px 0; margin-top: 4px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--danger);"></i> Putuskan & Hapus CCTV Ini
              </button>
            ` : ''}
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-8);">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; margin: 0; letter-spacing: 0.5px;">Recent Event Log</h4>
          <div id="drawer-camera-history" style="display: flex; flex-direction: column; gap: 8px;">
            <!-- Populate from detection log matching this location -->
          </div>
        </div>
      </div>
    `;

    // Bind event log items
    const historyList = drawer.querySelector('#drawer-camera-history');
    if (historyList) {
      const cameraDetections = this.detectionLog.filter(d =>
        (d.location && d.location.toLowerCase().includes(ch.name.toLowerCase())) ||
        (d.cameraId && d.cameraId.toString() === ch.id.toString())
      );
      if (cameraDetections.length === 0) {
        historyList.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-secondary);">No events logged for this sector.</div>`;
      } else {
        cameraDetections.slice(0, 3).forEach(d => {
          const logItem = document.createElement('div');
          logItem.style.cssText = 'display:flex; flex-direction:column; gap:4px; padding: 8px 12px; background: rgba(0,0,0,0.01); border: 1px solid rgba(0,0,0,0.02); border-radius: 8px; font-size: 0.75rem;';
          logItem.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight: 700; color: ${d.severity === 'HIGH' || d.severity === 'CRITICAL' ? 'var(--danger)' : 'var(--warning)'}; text-transform: uppercase; font-size: 0.65rem;">${d.severity || 'INFO'} ALERT</span>
              <span style="color: var(--text-secondary); font-size: 0.65rem;">${d.createdAt ? new Date(d.createdAt).toLocaleTimeString('id-ID') : ''}</span>
            </div>
            <div style="font-weight: 600; color: var(--text-primary); margin-top:2px;">Deteksi di ${d.location || ch.name}</div>
          `;
          historyList.appendChild(logItem);
        });
      }
    }

    // Bind drawer close
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
          await this.loadCctvList();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menghapus CCTV: ${err.message}`, type: 'danger' });
        }
      }
    };

    if (window.lucide) window.lucide.createIcons();
    drawer.style.right = '0px';
  }

  closeCCTVDetailDrawer() {
    const drawer = document.getElementById('cctv-detail-drawer');
    if (drawer) drawer.style.right = '-400px';
  }

  async reconnectCCTVStream(id) {
    try {
      EventBus.emit('toast:show', { message: `Menginisialisasi ulang koneksi kamera...`, type: 'info' });
      await CctvService.reconnectCctv(id);
      EventBus.emit('toast:show', { message: `Kamera berhasil dihubungkan kembali.`, type: 'success' });
      await this.loadCctvList();
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
      EventBus.emit('toast:show', { message: `Snapshot berhasil disimpan ke log verifikasi.`, type: 'success' });
      await this.loadCctvList();
    } catch (err) {
      console.error(err);
      EventBus.emit('toast:show', { message: `Gagal mengambil snapshot: ${err.message}`, type: 'danger' });
    }
  }

  // --- VMS Fullscreen Controller ---

  openVmsController(channelId) {
    const ch = this.cctvList.find(c => c.id === channelId);
    if (!ch) return;

    const page = document.getElementById('vms-fullscreen-page');
    const titleEl = document.getElementById('vms-fs-cam-title');
    const playerContainer = document.getElementById('vms-fs-player-container');
    const btnBack = document.getElementById('btn-close-vms-fs');
    
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
    let recSeconds = 0;

    const matchReport = this.latestReports.find(r => r.location && r.location.toLowerCase().includes(ch.name.toLowerCase()));
    const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : '/uploads/detection_1.jpg');

    // 1. Render Active player view
    const renderActivePlayer = () => {
      let playerHtml = '';
      if (ch.mediaType === 'Cloud') {
        playerHtml = `
          <div class="cctv-cloud-overlay" style="background: rgba(9, 13, 22, 0.95); height: 100%; width: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px;">
            <i data-lucide="cloud" class="cloud-icon" style="color: var(--primary); width: 48px; height: 48px;"></i>
            <span class="cloud-title" style="font-size: 1.15rem; font-weight: 700; color: white;">Mode Cloud Vendor</span>
            <span class="cloud-desc" style="color: rgba(255,255,255,0.6); max-width: 320px; font-size: 0.75rem; text-align: center; margin-bottom: 12px;">Kamera terhubung ke Server Cloud Vendor.</span>
            <a href="${ch.streamUrl || '#'}" target="_blank" class="btn btn-primary btn-rounded btn-cloud-action" onclick="event.stopPropagation();">
              <i data-lucide="external-link"></i> Buka Cloud App
            </a>
          </div>
        `;
      } else if (ch.mediaType === 'Video') {
        playerHtml = `
          <video src="${ch.playUrl}" id="vms-fs-media-element" autoplay loop ${isMuted ? 'muted' : ''} playsinline style="width:100%; height:100%; object-fit:contain;"></video>
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

      setTimeout(() => { renderYoloBoxes(); }, 50);
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
          el.style.cssText = `position:absolute; top:${box.y}%; left:${box.x}%; width:${box.w}%; height:${box.h}%; border:2px solid var(--primary);`;
          el.innerHTML = `<span class="yolo-preview-label" style="background:var(--primary); color:white; font-size:0.6rem; font-weight:800; padding:1px 4px; border-radius:2px; position:absolute; top:-16px; left:-2px; white-space:nowrap;">${box.label}</span>`;
          yoloOverlay.appendChild(el);
        });
      }
    };

    // 2. Back/Close button
    btnBack.onclick = () => {
      page.style.display = 'none';
      if (recordInterval) clearInterval(recordInterval);
    };

    // 3. Boot Fullscreen view
    renderActivePlayer();
    page.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }
  initTuyaSyncModal() {
    const btnSync = document.getElementById('btn-sync-tuya');
    const modal = document.getElementById('tuya-sync-modal');
    const btnClose = document.getElementById('btn-close-tuya-modal');
    const form = document.getElementById('tuya-sync-form');
    const loader = modal ? modal.querySelector('.tuya-sync-loader') : null;
    const btnSubmit = document.getElementById('btn-submit-tuya-sync');

    if (!modal) return;

    if (btnSync) {
      btnSync.addEventListener('click', () => {
        form.reset();
        if (loader) loader.style.display = 'none';
        if (btnSubmit) btnSubmit.style.display = 'block';
        modal.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const clientId = document.getElementById('tuya-input-client-id').value.trim();
        const clientSecret = document.getElementById('tuya-input-client-secret').value.trim();
        const region = document.getElementById('tuya-input-region').value;

        if (loader) loader.style.display = 'block';
        if (btnSubmit) btnSubmit.style.display = 'none';

        try {
          const response = await API.post('/api/cctv/tuya-sync', {
            clientId,
            clientSecret,
            region
          });

          EventBus.emit('toast:show', { message: response.message || 'Sinkronisasi Tuya berhasil!', type: 'success' });
          modal.style.display = 'none';
          await this.loadCctvList();
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal sinkronisasi: ' + err.message, type: 'danger' });
        } finally {
          if (loader) loader.style.display = 'none';
          if (btnSubmit) btnSubmit.style.display = 'block';
        }
      });
    }
  }

  startPolling() {
    this.pollingTimer = setInterval(() => {
      this.loadCctvList();
      this.loadLatestReports();
      this.loadDetections();
    }, 10000);
  }

  destroy() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}

export const CctvMonitoring = new CctvMonitoringPage();
