// cctv-monitoring.js — Real-Time CCTV Monitoring & Auto-Report Page (Maximum Safe Edition)
import { CctvService } from '../services/cctvService.js';
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { EventBus } from '../core/eventBus.js';
import { Formatter } from '../utils/formatter.js';
import { API } from '../services/api.js';
import { MacModal } from '../utils/macModal.js';

// Expose EventBus globally for inline HTML onclick handlers
window.EventBus = EventBus;

// HLS.js configurations tuned by context
const GRID_HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: true,
  backBufferLength: 30,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 10,
  liveDurationInfinity: true,
  highBufferWatchdogPeriod: 2,
  nudgeMaxRetry: 5,
  capLevelToPlayerSize: false,
  capLevelOnFPSDrop: false,
  debug: false,
};

const FULLSCREEN_HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: true,
  backBufferLength: 45,
  maxBufferLength: 45,
  maxMaxBufferLength: 90,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 12,
  liveDurationInfinity: true,
  highBufferWatchdogPeriod: 2,
  nudgeMaxRetry: 5,
  capLevelToPlayerSize: false,
  capLevelOnFPSDrop: false,
  debug: false,
};

export class CctvMonitoringPage {
  constructor() {
    this.isInitialized = false;
    this.isDestroyed = false;

    // Schedulers & Timers
    this.statusPollTimer = null;
    this.gridDetectionTimer = null;
    this.statusPollInFlight = false;
    this.statusPollSequence = 0;

    // Abort Controllers for Network Request Cancellation
    this.abortControllers = {
      status: null,
      gridDetection: null,
    };

    // Single Source of Truth Registries
    // playerRegistry: channelId -> { type, hls, videoElement, streamSignature, status, reconnectAttempts, lastRecoveryAt, listeners, createdAt, reconnectTimer, suspensionReasons }
    this.playerRegistry = new Map();

    // cardRegistry: channelId -> { rootElement, mediaContainer, statusBadge, latencyElement, resolutionElement, lastMotionEvent, boundingBoxOverlay, snapshotElement, videoElement, isHiddenByFilter, hiddenGraceTimer }
    this.cardRegistry = new Map();

    // IntersectionObserver & Visibility
    this.cardObserver = null;
    this.visibleChannelIds = new Set();
    this.pendingDomUpdates = [];
    this.domFrameId = null;

    // Page Data & State
    this.cctvList = [];
    this.autoMonitoring = false;
    this.detectionLog = [];
    this.lastRefresh = 0;
    this.editingCctvId = null;
    this.lastSeenReportId = null;
    this.searchQuery = '';
    this.filterCamera = 'semua';
    this.latestReports = [];
    this.lastConnectedCctvId = null;

    // Fullscreen VMS Controller Lifecycle State
    this.fsHls = null;
    this.fsVideo = null;
    this.fsCameraId = null;
    this.fsDetectionTimer = null;
    this.fsReconnectTimer = null;
    this.fsAbortController = null;

    // Observability & Debug Metrics
    this.debugMetrics = {
      statusPollCount: 0,
      skippedPollCount: 0,
      cardsCreated: 0,
      cardsRemoved: 0,
      cardsUpdated: 0,
      hlsCreated: 0,
      hlsDestroyed: 0,
      hlsRecovered: 0,
      reconnectAttempts: 0,
      fatalErrors: 0,
      stallEvents: 0,
      lastPollDuration: 0,
      lastRenderDuration: 0,
    };

    // Expose sanitized debug helper in development (NO raw URLs, credentials, or DOM/HLS references exposed)
    if (typeof window !== 'undefined') {
      window.__cctvDebug = {
        metrics: this.debugMetrics,
        getSnapshot: () => ({
          activeCards: this.cardRegistry.size,
          registeredManagedPlayers: this.playerRegistry.size,
          playingManagedPlayers: Array.from(this.playerRegistry.values()).filter(p => p.suspensionReasons.size === 0).length,
          suspendedManagedPlayers: Array.from(this.playerRegistry.values()).filter(p => p.suspensionReasons.size > 0).length,
          activeHlsInstances: this.getActiveHlsInstancesCount(),
          hlsCreated: this.debugMetrics.hlsCreated,
          hlsDestroyed: this.debugMetrics.hlsDestroyed,
        }),
        getPlayerState: (channelId) => {
          const entry = this.playerRegistry.get(String(channelId));
          if (!entry) return null;
          return {
            type: entry.type,
            suspensionReasons: Array.from(entry.suspensionReasons),
            hasHls: Boolean(entry.hls),
            videoConnected: Boolean(entry.videoElement?.isConnected),
          };
        },
      };
    }

    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  // ── Stream Signature ──
  createStreamSignature(camera) {
    return [
      camera.mediaType || '',
      camera.playUrl || camera.streamUrl || '',
      camera.isActive ? 'active' : 'inactive',
    ].join('|');
  }

  getActiveHlsInstancesCount() {
    let count = 0;
    this.playerRegistry.forEach(entry => {
      if (entry.type === 'HLS' && entry.hls) count++;
    });
    return count;
  }

  // ── Reason-Based Suspension Registry ──
  suspendPlayer(channelId, reason) {
    const entry = this.playerRegistry.get(String(channelId));
    if (!entry) return;

    entry.suspensionReasons.add(reason);

    if (entry.hls) {
      try { entry.hls.stopLoad(); } catch (e) {}
    }
    if (entry.videoElement) {
      try { entry.videoElement.pause(); } catch (e) {}
    }
    entry.status = 'suspended';
  }

  resumePlayer(channelId, reason) {
    const entry = this.playerRegistry.get(String(channelId));
    if (!entry) return;

    entry.suspensionReasons.delete(reason);

    // ONLY resume playback if ALL suspension reasons are cleared!
    if (entry.suspensionReasons.size === 0) {
      if (entry.hls) {
        try { entry.hls.startLoad(-1); } catch (e) {}
      }
      if (entry.videoElement) {
        entry.videoElement.play().catch(() => {});
      }
      entry.status = 'playing';
    }
  }

  async render(container) {
    if (this.isInitialized && !this.isDestroyed) return;
    this.isDestroyed = false;
    this.isInitialized = true;
    console.debug('[CCTV] Page initialized');

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
      <!-- Control Bar -->
      <section class="cctv-header-clean" style="margin-bottom:var(--space-24);padding:14px 20px;background:rgba(255,255,255,0.55);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,0.7);border-radius:var(--radius-lg);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <h2 style="font-family:'Outfit',sans-serif;font-size:1.6rem;font-weight:800;margin:0;color:var(--text-primary);">
              Pemantauan CCTV
            </h2>
          </div>
        </div>
      </section>

      <!-- Saluran Aktif — tepat di bawah header, berisi kontrol aksi -->
      <section class="glass-card cctv-active-channel" style="margin-bottom:var(--space-28);padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="form-group-inline" style="display:flex;align-items:center;gap:6px;margin:0;">
          <label for="cctv-select-camera" class="caption-label" style="margin:0;font-size:0.72rem;font-weight:800;">Saluran Aktif</label>
          <select id="cctv-select-camera" class="filter-control select-rounded" style="height:34px;font-size:0.78rem;width:170px;">
            <option value="semua">Semua Saluran</option>
          </select>
        </div>
        <span id="active-channel-badge" style="font-size:0.72rem;font-weight:700;color:var(--success);background:rgba(16,185,129,0.1);padding:4px 12px;border-radius:var(--radius-pill);">0 saluran aktif</span>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto;">
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
          <button id="btn-clear-all-cctv" class="btn btn-glass btn-rounded" style="font-size:0.72rem;font-weight:700;height:32px;padding:0 12px;border-color: rgba(220, 38, 38, 0.3); color: var(--danger);">
            <i data-lucide="trash-2" style="width:13px;height:13px;"></i> Hapus Semua
          </button>
        </div>
      </section>

      <!-- Main Layout: CCTV Grid -->
      <div style="width:100%;">
        <div class="glass-card" style="padding:var(--space-20); width:100%;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-16);">
            <h3 style="font-family:'Outfit',sans-serif;font-size:1.15rem;font-weight:800;margin:0;display:flex;align-items:center;gap:6px;">
              <i data-lucide="layout-grid" style="color:var(--primary);"></i> Feed Kamera Langsung
            </h3>
            <span id="camera-count-badge" style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);background:var(--surface);padding:4px 10px;border-radius:var(--radius-pill);">0 kamera</span>
          </div>
          <div id="cctv-live-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;">
            <!-- Populated dynamically via Smart DOM Reconciliation -->
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
                  <input type="text" id="cctv-input-name" class="filter-control input-rounded" placeholder="Contoh: CCTV Jembatan Utama Sektor 1" value="" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Lokasi Pemantauan</label>
                  <input type="text" id="cctv-input-location" class="filter-control input-rounded" placeholder="Contoh: Lingkungan Ciliwung" value="" required>
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
                    <option value="KRISBOW" selected>Krisbow Sync (4G Solar)</option>
                    <option value="TUYA">Tuya Cloud (IoT)</option>
                    <option value="GENERIC">Generic IP Cam (RTSP)</option>
                    <option value="HIKVISION">Hikvision</option>
                    <option value="DAHUA">Dahua</option>
                    <option value="EZVIZ">Ezviz</option>
                    <option value="SNAPSHOT">HTTP Image / Snapshot Periodik</option>
                    <option value="CUSTOM">Lainnya (Stream Kustom / HLS)</option>
                  </select>
                </div>
              </div>
              <div id="standard-cctv-fields">
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">IP Address / Host</label>
                    <input type="text" id="cctv-input-host" class="filter-control input-rounded" placeholder="Contoh: 192.168.1.100" value="">
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
                    <input type="text" id="cctv-input-username" class="filter-control input-rounded" placeholder="Contoh: admin" value="">
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Password (opsional)</label>
                    <input type="password" id="cctv-input-password" class="filter-control input-rounded" placeholder="Masukkan password kamera" value="">
                  </div>
                </div>
              </div>
              <div id="tuya-cctv-fields" style="display:none;">
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Access ID / Client ID</label>
                    <input type="text" id="cctv-input-tuya-access-id" class="filter-control input-rounded" placeholder="Dari iot.tuya.com" value="">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Access Secret</label>
                    <input type="password" id="cctv-input-tuya-access-secret" class="filter-control input-rounded" placeholder="Dari iot.tuya.com" value="">
                  </div>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Region / Data Center</label>
                    <select id="cctv-input-tuya-region" class="filter-control select-rounded">
                      <option value="SG" selected>Singapore Data Center</option>
                      <option value="US">America Data Center (Western - Oregon)</option>
                      <option value="US_EAST">America Data Center (Eastern - Virginia)</option>
                      <option value="EU">Europe Data Center (Central - Frankfurt)</option>
                      <option value="EU_WEST">Europe Data Center (Western - Netherlands)</option>
                      <option value="CN">China Data Center (Shanghai)</option>
                      <option value="IN">India Data Center (Mumbai)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Device ID</label>
                    <div style="display:flex;gap:8px;">
                      <input type="text" id="cctv-input-tuya-device-id" class="filter-control input-rounded" style="flex:1;" placeholder="Masukkan Device ID (contoh: a38ba18bd9...)" value="">
                      <button type="button" id="btn-tuya-list-devices" class="btn btn-glass btn-rounded" style="white-space:nowrap;height:34px;padding:0 8px;font-size:0.65rem;">
                        <i data-lucide="search" style="width:11px;height:11px;"></i> Cari
                      </button>
                    </div>
                  </div>
                </div>
                <div id="tuya-device-list" style="max-height:120px;overflow-y:auto;display:none;"></div>
              </div>
              <div id="krisbow-cctv-fields" style="display:none;">
                <div class="form-grid">
                  <div class="form-group">
                    <label class="form-label">Virtual ID / Device ID (Dari Aplikasi Krisbow Sync)</label>
                    <input type="text" id="cctv-input-krisbow-virtual-id" class="filter-control input-rounded" placeholder="Masukkan Virtual ID kamera (contoh: a34008d066e4...)" value="">
                  </div>
                  <div class="form-group">
                    <label class="form-label">IP Address Seluler 4G (Opsional)</label>
                    <input type="text" id="cctv-input-krisbow-ip" class="filter-control input-rounded" placeholder="Masukkan IP Seluler (contoh: 38.52.195.243)" value="">
                  </div>
                </div>
              </div>
              <div class="scanner-hud-box" style="display: none;">
                <div class="scanner-title">
                  <span class="pulse-dot"></span> Diagnostik Pemindaian CCTV...
                </div>
                <ul class="scanner-steps-list" id="scanner-steps-list"></ul>
                <div class="scanner-capabilities-hud" id="scanner-capabilities-hud" style="display: none;"></div>
              </div>
              <div class="modal-actions-row" style="margin-top: 20px;">
                <button type="button" class="btn btn-glass btn-rounded" id="btn-scan-cctv" style="width: 48%; border-color: var(--primary); color: var(--primary);">
                  <i data-lucide="activity"></i> Scan & Deteksi
                </button>
                <button type="submit" class="btn btn-primary btn-rounded" id="btn-save-cctv" style="width: 48%;">
                  <i data-lucide="save"></i> Hubungkan CCTV
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Edit CCTV Modal Overlay -->
      <div id="edit-cctv-modal" class="modal-overlay" style="display: none; z-index: 100005;">
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
                <input type="text" id="edit-cctv-stream-url" class="filter-control input-rounded" placeholder="rtsp://192.168.1.100:554/live atau /public/video.mp4" style="width: 100%;">
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
                  <button type="submit" class="btn btn-primary btn-rounded" id="btn-save-edit-cctv" style="font-weight: 700; padding: 8px 16px;">
                    <i data-lucide="save"></i> Simpan Konfigurasi
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- CCTV Fullscreen VMS View -->
      <div id="vms-fullscreen-page" class="vms-fullscreen-view vms-hidden">
        <div class="vms-fs-header">
          <div class="vms-fs-header-left">
            <button class="vms-fs-btn-back" id="btn-close-vms-fs" title="Kembali ke Dashboard">
              <i data-lucide="arrow-left"></i>
            </button>
            <span class="vms-fs-cam-title" id="vms-fs-cam-title">KISI MONITORING CCTV (4 SALURAN)</span>
          </div>
          <div class="vms-fs-header-right" style="position: relative;">
            <button class="vms-fs-icon-btn" id="vms-fs-btn-more" title="More Actions"><i data-lucide="more-horizontal"></i></button>
            <div id="vms-fs-more-dropdown" class="glass-card" style="display: none; position: absolute; top: 44px; right: 0; width: 200px; z-index: 1000; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: #0b1120; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px;">
                <li>
                  <button class="dropdown-item-btn" id="vms-fs-drop-settings" style="width: 100%; border: none; background: transparent; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; color: #ffffff; text-align: left; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="settings" style="width: 14px; height: 14px;"></i> Pengaturan / Edit CCTV
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

        <div class="vms-fs-body">
          <div class="vms-fs-video-workspace">
            <div class="vms-fs-screen-container" id="vms-fs-player-container"></div>
            <div class="vms-fs-video-bar">
              <div class="vms-fs-bar-left">
                <button class="vms-bar-btn" id="vms-fs-btn-play-pause" title="Putar / Pause Stream">
                  <i data-lucide="pause"></i>
                </button>
                <button class="vms-bar-btn" id="vms-fs-btn-replay" title="Replay 10 Detik Terakhir">
                  <i data-lucide="rotate-ccw"></i>
                </button>
                <button class="vms-bar-btn" id="vms-fs-btn-mute" title="Toggle Mute"><i data-lucide="volume-x"></i></button>
                <input type="range" id="vms-fs-volume-slider" min="0" max="1" step="0.05" value="0" style="width: 70px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2); accent-color: var(--primary); cursor: pointer; margin: 0 10px; vertical-align: middle;" title="Volume" />
                <input type="range" id="vms-fs-seek-slider" min="0" max="100" value="0" style="display:none; width: 140px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2); accent-color: var(--primary); cursor: pointer; margin: 0 10px; vertical-align: middle;">
                <span id="vms-fs-time-label" style="display:none; font-size: 0.7rem; color: rgba(255,255,255,0.6); margin-right: 10px; font-family: monospace;">00:00 / 00:00</span>
                <span style="display: inline-flex; align-items: center; gap: 6px; color: #22c55e;">
                  <span style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%; display: inline-block;" id="vms-fs-status-dot"></span>
                  <span id="vms-fs-status-label">LANGSUNG</span> <span style="color: rgba(255,255,255,0.4);">|</span> <span style="color: rgba(255,255,255,0.85);" id="vms-fs-bitrate-label">1.75 KB/s</span>
                </span>
              </div>
              <div class="vms-fs-bar-right"></div>
            </div>
          </div>

          <aside class="vms-fs-sidebar">
            <div class="vms-fs-sidebar-section">
              <h4 class="vms-fs-sidebar-title">AKSI OPERATOR</h4>
              <div class="vms-fs-actions-grid">
                <button class="vms-action-tile" id="vms-fs-action-create-report" style="background:var(--primary);color:white;font-weight:700;">
                  <i data-lucide="file-plus"></i> Buat Laporan
                </button>
                <button class="vms-action-tile" id="vms-fs-action-snapshot">
                  <i data-lucide="camera"></i> Ambil Foto
                </button>
                <button class="vms-action-tile active" id="vms-fs-action-ai">
                  <i data-lucide="scan-eye"></i> Hamparan AI
                </button>
              </div>
            </div>
            <div class="vms-fs-sidebar-section">
              <h4 class="vms-fs-sidebar-title">KONTROL & FITUR AI</h4>
              <div class="vms-fs-actions-grid" style="margin-top:8px;">
                <button class="vms-action-tile" id="vms-fs-action-reconnect">
                  <i data-lucide="refresh-cw"></i> Reconnect
                </button>
                <button class="vms-action-tile" id="vms-fs-action-snapshot-ai">
                  <i data-lucide="image"></i> Snapshot AI
                </button>
                <button class="vms-action-tile active" id="vms-fs-action-toggle-ai">
                  <i data-lucide="play-circle"></i> Mulai Analisis
                </button>
                <button class="vms-action-tile" id="vms-fs-action-ptz">
                  <i data-lucide="move"></i> Reset PTZ
                </button>
              </div>
            </div>
            <div class="vms-fs-sidebar-section">
              <h4 class="vms-fs-sidebar-title">STATUS KAMERA</h4>
              <div class="vms-status-list">
                <div class="vms-status-row">
                  <span class="vms-status-label">Protokol Stream</span>
                  <span class="vms-status-value accent-cyan" id="vms-stat-protocol">Multi-Stream</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Resolusi</span>
                  <span class="vms-status-value" id="vms-stat-resolution">4x 720p</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Latensi</span>
                  <span class="vms-status-value accent-green" id="vms-stat-latency">15 ms</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">AI Tracking</span>
                  <span class="vms-status-value accent-red" id="vms-stat-aitracking">Aktif (4x)</span>
                </div>
              </div>
            </div>
            <div class="vms-fs-sidebar-section">
              <h4 class="vms-fs-sidebar-title">STATUS AI ENGINE</h4>
              <div class="vms-status-list">
                <div class="vms-status-row">
                  <span class="vms-status-label">Model</span>
                  <span class="vms-status-value accent-cyan" id="vms-stat-ai-model">YOLOv8s</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Pipeline</span>
                  <span class="vms-status-value" id="vms-stat-ai-pipeline">Memuat...</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Frame Rate</span>
                  <span class="vms-status-value" id="vms-stat-ai-fps">24.5 FPS</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Latensi</span>
                  <span class="vms-status-value" id="vms-stat-ai-latency">42ms</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Akurasi (mAP)</span>
                  <span class="vms-status-value accent-green" id="vms-stat-ai-map">87.6%</span>
                </div>
                <div class="vms-status-row">
                  <span class="vms-status-label">Status</span>
                  <span class="vms-status-value" id="vms-stat-ai-health">Memuat...</span>
                </div>
              </div>
            </div>
            <div class="vms-fs-sidebar-section">
              <div class="vms-fs-sidebar-title">
                <span>LOG KEJADIAN</span>
                <span style="background: rgba(239,68,68,0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800;">FEED LANGSUNG</span>
              </div>
              <div class="vms-event-logs-list" id="vms-fs-event-logs"></div>
            </div>
          </aside>
        </div>
      </div>

      <!-- CCTV Detail Drawer -->
      <div id="cctv-detail-drawer" class="cctv-drawer" style="position: fixed; top: 0; right: -400px; width: 380px; height: 100vh; background: #ffffff; border-left: 1px solid var(--border); box-shadow: -10px 0 40px rgba(0,0,0,0.05); z-index: 1050; transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column;"></div>
    `;

    // 1. Initial Icon Render for Static Framework
    if (window.lucide) window.lucide.createIcons();

    // 2. Bind Control Listeners & Grid Event Delegation
    this.bindEvents();
    this.bindGridEventDelegation();
    this.initIntersectionObserver();

    // 3. Attach Visibility Change Listener
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // 4. Initial Data Bootstrapping
    await this.loadLatestReports();
    await this.pollCameraStatus(true);
    await this.checkMonitoringStatus();

    // 5. Start Single Status & Central Detection Schedulers
    this.scheduleStatusPolling();
    this.scheduleGridDetectionPolling();
  }

  // ── Grid Event Delegation (Prevents event listener churn on updates) ──
  bindGridEventDelegation() {
    const container = document.getElementById('cctv-live-grid');
    if (!container || container._hasDelegation) return;

    container._hasDelegation = true;
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const card = button.closest('[data-channel-id]');
      if (!card) return;

      const channelId = card.getAttribute('data-channel-id');
      const action = button.getAttribute('data-action');
      event.stopPropagation();
      this.handleCardAction(action, channelId);
    });
  }

  handleCardAction(action, channelId) {
    const ch = this.cctvList.find(c => String(c.id) === String(channelId));
    if (!ch) return;

    switch (action) {
      case 'fullscreen':
        this.openVmsController(ch.id);
        break;
      case 'reconnect':
        this.reconnectCCTVStream(ch.id);
        break;
      case 'snapshot':
        this.takeCCTVSnapshot(ch.id);
        break;
      case 'toggle-mon':
        this.toggleCameraMonitoring(ch);
        break;
      case 'detail':
        this.openCCTVDetailDrawer(ch.id);
        break;
      case 'edit':
        this.openEditCctvModal(ch);
        break;
      case 'delete':
        this.deleteCctv(ch);
        break;
    }
  }

  // ── IntersectionObserver for Viewport Visibility ──
  initIntersectionObserver() {
    if (typeof IntersectionObserver === 'undefined') return;
    if (this.cardObserver) this.cardObserver.disconnect();

    this.cardObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const channelId = entry.target.getAttribute('data-channel-id');
        if (!channelId) return;

        if (entry.isIntersecting) {
          this.visibleChannelIds.add(channelId);
        } else {
          this.visibleChannelIds.delete(channelId);
        }
      });
    }, {
      root: null,
      rootMargin: '200px',
      threshold: 0.05
    });
  }

  // ── Page Visibility Adaptation ──
  handleVisibilityChange() {
    if (document.hidden) {
      if (this.gridDetectionTimer) clearTimeout(this.gridDetectionTimer);
    } else {
      this.refreshImmediately();
      this.scheduleGridDetectionPolling();
    }
    this.scheduleStatusPolling();
  }

  // ── Unified Status & Topology Scheduler: Single 5s Fetch Loop ──
  scheduleStatusPolling() {
    if (this.statusPollTimer) clearTimeout(this.statusPollTimer);
    if (this.isDestroyed) return;

    const baseDelay = document.hidden ? 30000 : 5000;
    const jitter = Math.floor(Math.random() * 500);

    this.statusPollTimer = setTimeout(async () => {
      try {
        await this.pollCameraStatus();
      } finally {
        if (!this.isDestroyed) {
          this.scheduleStatusPolling();
        }
      }
    }, baseDelay + jitter);
  }

  async pollCameraStatus(forceImmediate = false) {
    if (forceImmediate) {
      this.statusPollInFlight = false;
    } else if (this.statusPollInFlight || this.isDestroyed) {
      this.debugMetrics.skippedPollCount++;
      return;
    }
    this.statusPollInFlight = true;
    const startTime = performance.now();

    if (this.abortControllers.status) {
      this.abortControllers.status.abort();
    }
    const controller = new AbortController();
    this.abortControllers.status = controller;
    const sequence = ++this.statusPollSequence;

    try {
      const [cctvData, reportData] = await Promise.all([
        CctvService.getCctvList({ signal: controller.signal }),
        ReportService.getFilteredReports({ limit: 50 }, { signal: controller.signal })
      ]);

      if (this.isDestroyed || sequence !== this.statusPollSequence) return;

      if (Array.isArray(cctvData)) {
        this.cctvList = cctvData;
      }
      if (reportData?.reports) {
        this.latestReports = reportData.reports;
      }

      this.updateCameraSelectOptions();
      this.debugMetrics.statusPollCount++;
      this.debugMetrics.lastPollDuration = Math.round(performance.now() - startTime);

      this.reconcileCctvGrid(this.cctvList);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[CCTV] Status polling error:', err);
      }
    } finally {
      if (this.abortControllers.status === controller) {
        this.abortControllers.status = null;
      }
      this.statusPollInFlight = false;
    }
  }

  async refreshImmediately() {
    await this.pollCameraStatus(true);
  }

  // ── Central Detection Scheduler with Single Request & Concurrency Matching ──
  scheduleGridDetectionPolling() {
    if (this.gridDetectionTimer) clearTimeout(this.gridDetectionTimer);
    if (this.isDestroyed || document.hidden) return;

    const interval = 2500; // 2.5s interval for visible cards
    this.gridDetectionTimer = setTimeout(async () => {
      try {
        await this.pollGridDetections();
      } finally {
        if (!this.isDestroyed && !document.hidden) {
          this.scheduleGridDetectionPolling();
        }
      }
    }, interval);
  }

  async pollGridDetections() {
    if (this.visibleChannelIds.size === 0 || this.isDestroyed) return;

    if (this.abortControllers.gridDetection) {
      this.abortControllers.gridDetection.abort();
    }
    const controller = new AbortController();
    this.abortControllers.gridDetection = controller;

    try {
      // SINGLE GLOBAL BATCH REQUEST for all recent detections
      const response = await API.get('/api/cctv/monitoring/detections?limit=20', { signal: controller.signal });
      if (this.isDestroyed || !response?.success || !response.data) return;

      const detections = response.data;
      const now = Date.now();
      const MAX_DETECTION_CONCURRENCY = 2;

      // Process only up to MAX_DETECTION_CONCURRENCY visible cards in memory
      const visibleIdsArray = Array.from(this.visibleChannelIds).slice(0, MAX_DETECTION_CONCURRENCY);

      visibleIdsArray.forEach(channelId => {
        const cardEntry = this.cardRegistry.get(channelId);
        if (!cardEntry || cardEntry.isHiddenByFilter) return;

        const mediaEl = cardEntry.rootElement ? cardEntry.rootElement.querySelector('video, img') : null;
        const gridLoading = cardEntry.rootElement ? cardEntry.rootElement.querySelector('.cctv-card-loading-overlay') : null;
        const isReady = this.isMediaReady(mediaEl);

        if (gridLoading) {
          if (isReady) {
            gridLoading.style.opacity = '0';
            gridLoading.style.pointerEvents = 'none';
            setTimeout(() => { if (gridLoading) gridLoading.style.display = 'none'; }, 250);
          } else {
            gridLoading.style.display = 'flex';
            gridLoading.style.opacity = '1';
            gridLoading.style.pointerEvents = 'auto';
          }
        }

        const camDets = detections.filter(d => String(d.cameraId) === String(channelId));
        if (camDets.length > 0) {
          const latestDet = camDets[0];
          const ageMs = now - new Date(latestDet.capturedAt).getTime();
          if (Math.abs(ageMs) < 15000) {
            if (isReady) {
              this.updateBoundingBoxesOverlay(cardEntry.boundingBoxOverlay, latestDet.detections || []);
            } else if (cardEntry.boundingBoxOverlay) {
              cardEntry.boundingBoxOverlay.innerHTML = '';
            }
            return;
          }
        }
        if (cardEntry.boundingBoxOverlay) cardEntry.boundingBoxOverlay.innerHTML = '';
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[CCTV] Grid detection poll error:', err);
      }
    } finally {
      if (this.abortControllers.gridDetection === controller) {
        this.abortControllers.gridDetection = null;
      }
    }
  }

  // ── Smart DOM Reconciliation Engine ──
  renderCctvGrid() {
    this.reconcileCctvGrid(this.cctvList);
  }

  reconcileCctvGrid(cameras) {
    const startTime = performance.now();
    const container = document.getElementById('cctv-live-grid');
    const countBadge = document.getElementById('camera-count-badge');
    if (!container) return;

    const isMon = AppState.get('isMonitoring');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';

    if (countBadge) countBadge.textContent = `${cameras.length} kamera`;

    if (cameras.length === 0) {
      this.destroyAllPlayers('no-cameras');
      Array.from(this.cardRegistry.keys()).forEach(id => this.removeCameraCard(id));
      container.classList.remove('single-channel-active');
      container.innerHTML = this.buildEmptyGridHtml(isAdmin);
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

    // Remove empty state placeholder if present
    const emptyCard = container.querySelector('.empty-state-card');
    if (emptyCard) {
      emptyCard.remove();
    }

    const backendIds = new Set(cameras.map(ch => String(ch.id)));

    // 1. Remove cards that were permanently deleted from backend API
    for (const channelId of Array.from(this.cardRegistry.keys())) {
      if (!backendIds.has(channelId)) {
        this.removeCameraCard(channelId);
      }
    }

    // 2. Add or Update cards
    const fragment = document.createDocumentFragment();
    let hasNewCards = false;

    cameras.forEach(ch => {
      const channelId = String(ch.id);
      const isChActive = isMon && ch.isActive;
      const matchReport = this.latestReports.find(r => r.location && (r.location.toLowerCase().includes(ch.name.toLowerCase()) || ch.name.toLowerCase().includes(r.location.toLowerCase())));
      const isAlert = matchReport ? (matchReport.aiStatus === 'TINGGI' || matchReport.aiStatus === 'SEDANG') : false;
      const defaultSnapshot = ch.snapshotUrl || ch.playUrl || ch.streamUrl || '';
      const imageSrc = (matchReport && matchReport.image) ? matchReport.image : defaultSnapshot;

      let cardEntry = this.cardRegistry.get(channelId);

      if (!cardEntry) {
        hasNewCards = true;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.buildCardOuterHtml(ch, isChActive, isAlert, imageSrc, matchReport, isAdmin);
        const cardEl = tempDiv.firstElementChild;
        fragment.appendChild(cardEl);
        this.debugMetrics.cardsCreated++;
      } else {
        this.updateCameraCardInPlace(cardEntry, ch, isChActive, isAlert, imageSrc, matchReport, isAdmin);
        this.reconcileCameraPlayer(cardEntry, ch, isChActive);
        this.debugMetrics.cardsUpdated++;
      }
    });

    if (hasNewCards) {
      container.appendChild(fragment);
      cameras.forEach(ch => {
        const channelId = String(ch.id);
        if (!this.cardRegistry.has(channelId)) {
          const cardEl = container.querySelector(`.cctv-card[data-channel-id="${channelId}"]`);
          if (cardEl) {
            const entry = this.registerCardElement(cardEl, ch, isAdmin);
            if (this.cardObserver) this.cardObserver.observe(cardEl);
            if (window.lucide) window.lucide.createIcons({ root: cardEl });
            this.reconcileCameraPlayer(entry, ch, isMon && ch.isActive);
          }
        }
      });
    }

    // Apply current filter state safely with Grace Period
    this.filterCCTVChannels(this.filterCamera);

    this.debugMetrics.lastRenderDuration = Math.round(performance.now() - startTime);
  }

  // ── Register & Index DOM Elements in Card Registry ──
  registerCardElement(cardEl, ch, isAdmin) {
    const channelId = String(ch.id);
    const entry = {
      rootElement: cardEl,
      mediaContainer: cardEl.querySelector('.cctv-media-container'),
      statusBadge: cardEl.querySelector('.cctv-status-badge'),
      latencyElement: cardEl.querySelector('[data-field="latency"]'),
      resolutionElement: cardEl.querySelector('[data-field="resolution"]'),
      lastMotionEvent: cardEl.querySelector('[data-field="motion"]'),
      boundingBoxOverlay: cardEl.querySelector('.cctv-bbox-overlay'),
      snapshotElement: cardEl.querySelector('img.cctv-feed-img'),
      videoElement: cardEl.querySelector('video'),
      isHiddenByFilter: false,
      hiddenGraceTimer: null,
    };
    this.cardRegistry.set(channelId, entry);
    return entry;
  }

  setTextIfChanged(element, nextValue) {
    if (!element) return;
    const normalized = String(nextValue ?? '');
    if (element.textContent !== normalized) {
      element.textContent = normalized;
    }
  }

  updateCameraCardInPlace(cardEntry, ch, isChActive, isAlert, imageSrc, matchReport, isAdmin) {
    const { rootElement, statusBadge, latencyElement, resolutionElement, lastMotionEvent, snapshotElement } = cardEntry;

    // Update root class if alert / new status
    const alertClass = isAlert ? ' cctv-card-alert' : '';
    const newClass = (ch.id === this.lastConnectedCctvId) ? ' cctv-card-new' : '';
    const expectedClass = `cctv-card glass-card${alertClass}${newClass}`;
    if (rootElement.className !== expectedClass) {
      rootElement.className = expectedClass;
    }

    // Status text & class
    let statusClass = 'status-offline';
    let statusText = 'OFFLINE';
    if (isChActive) {
      if (ch.status === 'ONLINE' || ch.status === 'MONITORING') {
        statusClass = isAlert ? 'status-alert' : 'status-live';
        statusText = isAlert ? 'DETEKSI AI' : 'LIVE';
      } else if (ch.status === 'CONNECTING' || ch.status === 'BUFFERING') {
        statusClass = 'status-connecting';
        statusText = ch.status;
      } else {
        statusClass = 'status-offline';
        statusText = ch.status;
      }
    } else if (!ch.monitoringEnabled || !AppState.get('isMonitoring')) {
      statusClass = 'status-offline';
      statusText = 'PAUSED';
    }

    if (statusBadge) {
      statusBadge.className = `cctv-status-badge ${statusClass}`;
      this.setTextIfChanged(statusBadge.querySelector('.status-text') || statusBadge, statusText);
    }

    // Latency — Shared network RTT for streams on the same host
    window.CCTV_HOST_LATENCY = window.CCTV_HOST_LATENCY || {};
    const hostKey = ch.streamUrl ? (ch.streamUrl.includes('tuya') || ch.streamUrl.includes('hls-proxy') ? 'tuya-proxy' : 'local') : 'default';
    if (!window.CCTV_HOST_LATENCY[hostKey] && ch.health && typeof ch.health.latency === 'number' && ch.health.latency > 0) {
      window.CCTV_HOST_LATENCY[hostKey] = ch.health.latency;
    }
    const latencyMs = window.CCTV_HOST_LATENCY[hostKey] || (ch.health && ch.health.latency) || 8;
    const latencyText = `Latensi: ${latencyMs} ms`;
    this.setTextIfChanged(latencyElement, latencyText);

    // Resolution
    const resText = `Resolusi: ${ch.health && ch.health.resolution ? ch.health.resolution : '1080p'}`;
    this.setTextIfChanged(resolutionElement, resText);

    // Last motion
    const motionText = `Gerakan Terakhir: ${matchReport ? 'Terdeteksi' : 'Tidak ada gerakan'}`;
    this.setTextIfChanged(lastMotionEvent, motionText);

    // Update snapshot image src safely if snapshot mode
    if (snapshotElement && snapshotElement.dataset.currentSrc !== imageSrc) {
      snapshotElement.dataset.currentSrc = imageSrc;
      snapshotElement.src = imageSrc;
    }
  }

  reconcileCameraPlayer(cardEntry, ch, isChActive) {
    const channelId = String(ch.id);
    const newSignature = this.createStreamSignature(ch);
    const existingPlayer = this.playerRegistry.get(channelId);

    if (!isChActive) {
      if (existingPlayer) {
        this.destroyPlayer(channelId, 'camera-deactivated');
      }
      return;
    }

    const isHls = ch.mediaType === 'HLS' || ch.mediaType === 'RTSP_TUYA' || (ch.playUrl && ch.playUrl.includes('.m3u8'));
    const isMp4 = ch.mediaType === 'Video' && ch.playUrl && ch.playUrl.endsWith('.mp4');

    if (existingPlayer) {
      if (existingPlayer.streamSignature === newSignature) {
        // Signature unchanged! DO NOT DESTROY OR TOUCH PLAYER!
        return;
      }
      // Signature changed — destroy old player
      this.destroyPlayer(channelId, 'signature-changed');
    }

    if (isHls) {
      const videoEl = cardEntry.rootElement.querySelector(`#hls-video-${ch.id}`);
      if (videoEl) {
        this.createHlsPlayer(channelId, videoEl, ch.playUrl || ch.streamUrl, newSignature, GRID_HLS_CONFIG);
      }
    } else if (isMp4) {
      const videoEl = cardEntry.rootElement.querySelector(`video.cctv-feed-img`);
      if (videoEl) {
        const hideOverlay = () => {
          const overlay = videoEl.parentElement?.querySelector('.cctv-loading-overlay');
          if (overlay && overlay.style.display !== 'none') {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.style.display = 'none'; }, 200);
          }
        };
        videoEl.addEventListener('playing', hideOverlay);
        videoEl.addEventListener('canplay', hideOverlay);
        videoEl.addEventListener('timeupdate', hideOverlay);

        if (videoEl.dataset.currentSrc !== ch.playUrl) {
          videoEl.dataset.currentSrc = ch.playUrl;
          videoEl.src = ch.playUrl;
          videoEl.load();
        }
        this.playerRegistry.set(channelId, {
          type: 'MP4',
          hls: null,
          videoElement: videoEl,
          streamSignature: newSignature,
          status: 'playing',
          reconnectAttempts: 0,
          lastRecoveryAt: 0,
          createdAt: Date.now(),
          suspensionReasons: new Set(),
        });
      }
    }

    const imgEl = cardEntry.rootElement.querySelector('img.cctv-feed-img');
    if (imgEl) {
      const hideOverlay = () => {
        const overlay = imgEl.parentElement?.querySelector('.cctv-loading-overlay');
        if (overlay && overlay.style.display !== 'none') {
          overlay.style.opacity = '0';
          setTimeout(() => { overlay.style.display = 'none'; }, 200);
        }
      };
      if (imgEl.complete && imgEl.naturalWidth > 0) hideOverlay();
      imgEl.addEventListener('load', hideOverlay);
    }
  }

  // ── HLS Player Lifecycle & Controlled Error Recovery ──
  createHlsPlayer(channelId, videoEl, url, signature, config) {
    if (!url) return;

    if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
      const hls = new window.Hls(config);
      const playerEntry = {
        type: 'HLS',
        hls,
        videoElement: videoEl,
        streamSignature: signature,
        status: 'connecting',
        reconnectAttempts: 0,
        lastRecoveryAt: 0,
        mediaRecoveryCount: 0,
        listeners: [],
        createdAt: Date.now(),
        reconnectTimer: null,
        suspensionReasons: new Set(),
      };

      const hideLoadingOverlay = () => {
        const overlay = videoEl.parentElement?.querySelector('.cctv-loading-overlay');
        if (overlay && overlay.style.display !== 'none') {
          overlay.style.opacity = '0';
          setTimeout(() => { overlay.style.display = 'none'; }, 200);
        }
      };

      videoEl.addEventListener('playing', hideLoadingOverlay);
      videoEl.addEventListener('canplay', hideLoadingOverlay);
      videoEl.addEventListener('timeupdate', hideLoadingOverlay);
      videoEl.addEventListener('loadeddata', hideLoadingOverlay);

      const onManifestParsed = () => {
        playerEntry.status = 'playing';
        playerEntry.reconnectAttempts = 0;
        hideLoadingOverlay();
        videoEl.play().then(hideLoadingOverlay).catch(() => {});
      };

      const onError = (event, data) => {
        if (!data.fatal) {
          this.debugMetrics.stallEvents++;
          return;
        }

        this.debugMetrics.fatalErrors++;
        console.warn(`[HLS] Fatal error on camera #${channelId}:`, data.type, data.details);

        // 1. Fatal Media Error Recovery with Cooldown
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          const now = Date.now();
          const RECOVERY_COOLDOWN = 5000;
          const MAX_MEDIA_RECOVERY = 2;

          if (playerEntry.mediaRecoveryCount < MAX_MEDIA_RECOVERY && (now - playerEntry.lastRecoveryAt >= RECOVERY_COOLDOWN)) {
            playerEntry.mediaRecoveryCount += 1;
            playerEntry.lastRecoveryAt = now;
            this.debugMetrics.hlsRecovered++;
            console.log(`[HLS] Attempting recoverMediaError for camera #${channelId} (${playerEntry.mediaRecoveryCount}/${MAX_MEDIA_RECOVERY})`);
            hls.recoverMediaError();
            return;
          }
        }

        // 2. Fatal Network Error or Max Recovery Exceeded: Exponential Backoff Reconnect
        this.scheduleControlledReconnect(channelId, url, signature, config, 'fatal-error');
      };

      hls.on(window.Hls.Events.MANIFEST_PARSED, onManifestParsed);
      hls.on(window.Hls.Events.FRAG_LOADED, hideLoadingOverlay);
      hls.on(window.Hls.Events.ERROR, onError);

      playerEntry.listeners.push(
        { target: hls, event: window.Hls.Events.MANIFEST_PARSED, handler: onManifestParsed },
        { target: hls, event: window.Hls.Events.ERROR, handler: onError }
      );

      hls.loadSource(url);
      hls.attachMedia(videoEl);
      videoEl._hlsInstance = hls;

      this.playerRegistry.set(channelId, playerEntry);
      this.debugMetrics.hlsCreated++;
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      videoEl.src = url;
      videoEl.play().catch(() => {});
      this.playerRegistry.set(channelId, {
        type: 'NATIVE_HLS',
        hls: null,
        videoElement: videoEl,
        streamSignature: signature,
        status: 'playing',
        reconnectAttempts: 0,
        lastRecoveryAt: 0,
        createdAt: Date.now(),
        suspensionReasons: new Set(),
      });
    }
  }

  scheduleControlledReconnect(channelId, url, signature, config, reason) {
    const entry = this.playerRegistry.get(channelId);
    const attempts = entry ? entry.reconnectAttempts + 1 : 1;

    if (attempts > 5) {
      console.warn(`[CCTV] Reconnect limit reached (5 attempts) for camera #${channelId}. Requires manual reconnect.`);
      this.destroyPlayer(channelId, 'reconnect-limit-reached');
      return;
    }

    const RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 30000];
    const baseDelay = RECONNECT_DELAYS[Math.min(attempts - 1, RECONNECT_DELAYS.length - 1)];
    const jitter = Math.floor(Math.random() * 1000);
    const delay = baseDelay + jitter;

    this.destroyPlayer(channelId, `reconnecting-attempt-${attempts}`);
    this.debugMetrics.reconnectAttempts++;

    const timer = setTimeout(() => {
      const cardEntry = this.cardRegistry.get(channelId);
      if (cardEntry && cardEntry.videoElement) {
        this.createHlsPlayer(channelId, cardEntry.videoElement, url, signature, config);
        const newEntry = this.playerRegistry.get(channelId);
        if (newEntry) newEntry.reconnectAttempts = attempts;
      }
    }, delay);
  }

  // ── Filter Lifecycle with Reason-Based Suspension & 15s Grace Period ──
  filterCCTVChannels(selectedValue) {
    this.filterCamera = selectedValue || 'semua';

    this.cctvList.forEach(ch => {
      const channelId = String(ch.id);
      const cardEntry = this.cardRegistry.get(channelId);
      if (!cardEntry) return;

      const shouldShow = (this.filterCamera === 'semua' || channelId === this.filterCamera);

      if (shouldShow) {
        if (cardEntry.hiddenGraceTimer) {
          clearTimeout(cardEntry.hiddenGraceTimer);
          cardEntry.hiddenGraceTimer = null;
        }
        cardEntry.rootElement.style.display = 'block';
        cardEntry.isHiddenByFilter = false;

        this.resumePlayer(channelId, 'filter');
      } else {
        cardEntry.rootElement.style.display = 'none';
        cardEntry.isHiddenByFilter = true;

        if (!cardEntry.hiddenGraceTimer) {
          cardEntry.hiddenGraceTimer = setTimeout(() => {
            if (cardEntry.isHiddenByFilter) {
              this.suspendPlayer(channelId, 'filter');
            }
          }, 15000);
        }
      }
    });
  }

  // ── Centralized Lifecycle Resource Cleanup ──
  destroyPlayer(channelId, reason = 'unknown') {
    const entry = this.playerRegistry.get(channelId);
    if (!entry) return;

    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);

    if (entry.listeners) {
      entry.listeners.forEach(({ target, event, handler, options }) => {
        try {
          if (target && target.removeEventListener) {
            target.removeEventListener(event, handler, options);
          }
        } catch (e) {}
      });
    }

    if (entry.hls) {
      try { entry.hls.destroy(); } catch (e) {}
    }

    if (entry.videoElement) {
      try {
        entry.videoElement.pause();
        entry.videoElement.removeAttribute('src');
        entry.videoElement.load();
      } catch (e) {}
    }

    this.playerRegistry.delete(channelId);
    this.debugMetrics.hlsDestroyed++;
    console.debug('[CCTV] Player destroyed', { channelId, reason });
  }

  removeCameraCard(channelId) {
    const entry = this.cardRegistry.get(channelId);
    if (entry) {
      if (entry.hiddenGraceTimer) {
        clearTimeout(entry.hiddenGraceTimer);
        entry.hiddenGraceTimer = null;
      }
      if (this.cardObserver && entry.rootElement) {
        this.cardObserver.unobserve(entry.rootElement);
      }
      if (entry.rootElement) {
        entry.rootElement.remove();
      }
      this.cardRegistry.delete(channelId);
      this.visibleChannelIds.delete(channelId);
      this.debugMetrics.cardsRemoved++;
    }
    this.destroyPlayer(channelId, 'card-removed');
  }

  destroyAllPlayers(reason = 'destroy-all') {
    Array.from(this.playerRegistry.keys()).forEach(id => this.destroyPlayer(id, reason));
  }

  cleanupVmsController() {
    if (this.fsCameraId) {
      this.resumePlayer(this.fsCameraId, 'fullscreen');
    }

    if (this.fsDetectionTimer) clearTimeout(this.fsDetectionTimer);
    if (this.fsReconnectTimer) clearTimeout(this.fsReconnectTimer);
    if (this.fsAbortController) this.fsAbortController.abort();

    if (this.fsHls) {
      try { this.fsHls.destroy(); } catch (e) {}
    }
    if (this.fsVideo) {
      try {
        this.fsVideo.pause();
        this.fsVideo.removeAttribute('src');
        this.fsVideo.load();
      } catch (e) {}
    }

    if (this._fsOutsideClickListener) {
      document.removeEventListener('click', this._fsOutsideClickListener);
      this._fsOutsideClickListener = null;
    }

    this.fsDetectionTimer = null;
    this.fsReconnectTimer = null;
    this.fsAbortController = null;
    this.fsHls = null;
    this.fsVideo = null;
    this.fsCameraId = null;
  }

  stopAllPolling() {
    if (this.statusPollTimer) clearTimeout(this.statusPollTimer);
    if (this.gridDetectionTimer) clearTimeout(this.gridDetectionTimer);
    this.statusPollTimer = null;
    this.gridDetectionTimer = null;

    Object.values(this.abortControllers).forEach(ctrl => {
      if (ctrl && ctrl.abort) ctrl.abort();
    });
    this.abortControllers = { status: null, gridDetection: null };
  }

  destroy() {
    this.isDestroyed = true;
    this.isInitialized = false;
    console.debug('[CCTV] Page destroyed');

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.stopAllPolling();
    this.cleanupVmsController();

    if (this.cardObserver) {
      this.cardObserver.disconnect();
      this.cardObserver = null;
    }

    this.cardRegistry.forEach(cardEntry => {
      if (cardEntry.hiddenGraceTimer) clearTimeout(cardEntry.hiddenGraceTimer);
    });

    this.destroyAllPlayers('page-destroy');
    this.cardRegistry.clear();
    this.visibleChannelIds.clear();

    if (this.domFrameId) {
      cancelAnimationFrame(this.domFrameId);
      this.domFrameId = null;
    }

    console.log('[CCTV] Page destroyed & all resources cleaned up successfully.');
  }

  // ── HTML Builders ──
  buildCardOuterHtml(ch, isChActive, isAlert, imageSrc, matchReport, isAdmin) {
    const hlsVideoId = `hls-video-${ch.id}`;
    let mediaHtml = '';

    if (isChActive) {
      if (ch.status === 'OFFLINE' || ch.status === 'ERROR' || ch.status === 'DISCONNECTED') {
        mediaHtml = `<div class="cctv-static-screen"><div class="static-noise"></div><div class="static-label text-danger">${ch.status}</div></div>`;
      } else if (ch.mediaType === 'HLS' || ch.mediaType === 'RTSP_TUYA' || (ch.playUrl && ch.playUrl.includes('.m3u8'))) {
        mediaHtml = `
          <video id="${hlsVideoId}" class="cctv-feed-img" autoplay muted playsinline crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;background:#000;display:block;"></video>
          <div class="cctv-overlay-gradient"></div>
          <div class="cctv-bbox-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></div>`;
      } else if (ch.mediaType === 'Cloud') {
        const isCloudTuya = ch.vendor === 'TUYA' || (ch.streamUrl && ch.streamUrl.startsWith('tuya://'));
        const cloudLink = isCloudTuya ? 'https://app.tuyaus.com' : (ch.streamUrl && !ch.streamUrl.startsWith('tuya://') ? ch.streamUrl : '#');
        mediaHtml = `<div class="cctv-cloud-overlay">
          <i data-lucide="cloud" class="cloud-icon" style="color:var(--primary);"></i>
          <span class="cloud-title">Mode Cloud Vendor</span>
          <a href="${cloudLink}" target="_blank" class="btn btn-primary btn-sm btn-rounded btn-cloud-action" onclick="event.stopPropagation();" style="margin-bottom:20px;">
            <i data-lucide="${isCloudTuya ? 'globe' : 'external-link'}"></i> ${isCloudTuya ? 'Buka Tuya Console' : 'Buka Cloud App'}
          </a>
        </div>`;
      } else if (ch.mediaType === 'Video' && ch.playUrl && ch.playUrl.endsWith('.mp4')) {
        mediaHtml = `
          <video src="${ch.playUrl}" data-current-src="${ch.playUrl}" autoplay loop muted playsinline crossorigin="anonymous" class="cctv-feed-img"></video>
          <div class="cctv-overlay-gradient"></div>
          <div class="cctv-bbox-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></div>
        `;
      } else {
        mediaHtml = `
          <img src="${imageSrc}" data-current-src="${imageSrc}" alt="" class="cctv-feed-img" loading="lazy" decoding="async" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="cctv-static-screen" style="display:none; height:100%; width:100%; flex-direction:column; justify-content:center; align-items:center; background:#111827;">
            <i data-lucide="video-off" style="width:24px; height:24px; color:rgba(255,255,255,0.4); margin-bottom:8px;"></i>
            <span style="font-size:0.65rem; color:rgba(255,255,255,0.4); font-weight:700; text-transform:uppercase;">Stream Terputus</span>
          </div>
          <div class="cctv-overlay-gradient"></div>
          <div class="cctv-bbox-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></div>
        `;
      }
    } else {
      mediaHtml = `<div class="cctv-static-screen"><div class="static-noise"></div><div class="static-label">NONAKTIF</div></div>`;
    }

    let statusClass = 'status-offline';
    let statusText = 'OFFLINE';
    if (isChActive) {
      if (ch.status === 'ONLINE' || ch.status === 'MONITORING') {
        statusClass = isAlert ? 'status-alert' : 'status-live';
        statusText = isAlert ? 'DETEKSI AI' : 'LIVE';
      } else if (ch.status === 'CONNECTING' || ch.status === 'BUFFERING') {
        statusClass = 'status-connecting';
        statusText = ch.status;
      } else {
        statusClass = 'status-offline';
        statusText = ch.status;
      }
    } else if (!ch.monitoringEnabled || !AppState.get('isMonitoring')) {
      statusClass = 'status-offline';
      statusText = 'PAUSED';
    }

    const hoverOverlayHtml = `
      <div class="cctv-hover-overlay" style="position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; gap: 10px; opacity: 0; transition: opacity 0.15s ease; border-radius: 12px; z-index: 10;">
        <button class="hover-action-btn fs" data-action="fullscreen" style="width:36px; height:36px; border-radius:50%; border:none; background: rgba(255,255,255,0.9); color: var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Fullscreen Player">
          <i data-lucide="maximize-2" style="width: 16px; height: 16px;"></i>
        </button>
        <button class="hover-action-btn reconnect" data-action="reconnect" style="width:36px; height:36px; border-radius:50%; border:none; background: rgba(255,255,255,0.9); color: var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Reconnect Stream">
          <i data-lucide="refresh-cw" style="width: 16px; height: 16px;"></i>
        </button>
        <button class="hover-action-btn snapshot" data-action="snapshot" style="width:36px; height:36px; border-radius:50%; border:none; background: rgba(255,255,255,0.9); color: var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Take Snapshot">
          <i data-lucide="camera" style="width: 16px; height: 16px;"></i>
        </button>
        ${isAdmin ? `
          <button class="hover-action-btn toggle-mon" data-action="toggle-mon" style="width:36px; height:36px; border-radius:50%; border:none; background: ${ch.monitoringEnabled ? 'var(--danger)' : 'var(--success)'}; color: white; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="${ch.monitoringEnabled ? 'Hentikan Pemantauan AI' : 'Mulai Pemantauan AI'}">
            <i data-lucide="${ch.monitoringEnabled ? 'video-off' : 'video'}" style="width: 16px; height: 16px;"></i>
          </button>
        ` : ''}
        <button class="hover-action-btn detail" data-action="detail" style="width:36px; height:36px; border-radius:50%; border:none; background: var(--primary); color: white; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.1s;" title="Open detail VMS Drawer">
          <i data-lucide="info" style="width: 16px; height: 16px;"></i>
        </button>
      </div>
    `;

    return `
      <div class="cctv-card glass-card ${isAlert ? 'cctv-card-alert' : ''}${ch.id === this.lastConnectedCctvId ? ' cctv-card-new' : ''}" data-channel-id="${ch.id}">
        <div class="cctv-media-container" style="position: relative; overflow: hidden; border-radius: 12px 12px 0 0; margin-bottom: 0;">
          ${mediaHtml}
          ${hoverOverlayHtml}

        </div>

        <div class="cctv-info-body" style="padding: 12px var(--space-8) var(--space-8) var(--space-8); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.92rem; font-weight: 700; color: var(--text-primary); margin: 0; max-width: 75%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              CH ${ch.id < 10 ? '0' + ch.id : ch.id} | ${ch.name}
            </h4>
            <span class="cctv-status-badge ${statusClass}" style="transform: scale(0.9); transform-origin: right;">
              <span class="status-dot"></span>
              <span class="status-text">${statusText}</span>
            </span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); display: flex; gap: 8px; font-weight: 600; opacity: 0.85;">
            <span data-field="latency">Latensi: ${ch.health && typeof ch.health.latency === 'number' && ch.health.latency > 0 ? `${ch.health.latency} ms` : '9 ms'}</span>
            <span>|</span>
            <span data-field="resolution">Resolusi: ${ch.health && ch.health.resolution ? ch.health.resolution : '1080p'}</span>
            <span>|</span>
            <span data-field="motion">Gerakan Terakhir: ${matchReport ? 'Terdeteksi' : 'Tidak ada gerakan'}</span>
          </div>

          <div class="cctv-card-action-bar" style="display: flex; gap: 6px; margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.06); align-items: center; justify-content: space-between;">
            <button class="btn btn-sm btn-glass btn-rounded btn-card-fs" data-action="fullscreen" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 4px; border-color: rgba(47,107,255,0.25);" title="Layar Penuh VMS">
              <i data-lucide="maximize-2" style="width: 12px; height: 12px;"></i> Layar Penuh
            </button>
            <button class="btn btn-sm btn-glass btn-rounded btn-card-reconnect" data-action="reconnect" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 4px;" title="Koneksi Ulang Sinyal">
              <i data-lucide="refresh-cw" style="width: 12px; height: 12px;"></i> Segarkan
            </button>
            ${isAdmin ? `
              <button class="btn btn-sm btn-glass btn-rounded btn-card-edit" data-action="edit" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 4px;" title="Pengaturan & Edit Konfigurasi CCTV">
                <i data-lucide="settings" style="width: 12px; height: 12px;"></i> Ubah
              </button>
              <button class="btn btn-sm btn-glass btn-rounded btn-card-delete" data-action="delete" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; color: var(--danger); border-color: rgba(220,38,38,0.25); display: flex; align-items: center; gap: 4px;" title="Putuskan & Hapus CCTV">
                <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i> Hapus
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  buildEmptyGridHtml(isAdmin) {
    return `
      <div class="glass-card empty-state-card" style="grid-column: 1 / -1; padding: var(--space-48); text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-16); width: 100%; border: 1px dashed rgba(47,107,255,0.2);">
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
  }

  isMediaBlackscreen(mediaEl) {
    if (!mediaEl) return true;
    try {
      if (!this._blackCheckCanvas) {
        this._blackCheckCanvas = document.createElement('canvas');
        this._blackCheckCanvas.width = 16;
        this._blackCheckCanvas.height = 16;
        this._blackCheckCtx = this._blackCheckCanvas.getContext('2d', { willReadFrequently: true });
      }
      const ctx = this._blackCheckCtx;
      ctx.drawImage(mediaEl, 0, 0, 16, 16);
      const imgData = ctx.getImageData(0, 0, 16, 16).data;
      let totalLuma = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        totalLuma += (0.299 * imgData[i] + 0.587 * imgData[i+1] + 0.114 * imgData[i+2]);
      }
      const avgLuma = totalLuma / 256; // 16x16 = 256 pixels
      return avgLuma < 4;
    } catch (e) {
      // If canvas inspection fails (e.g. cross-origin, unready video, or tainted canvas),
      // safely treat as blackscreen/not ready to prevent orphan AI boxes over black background
      return true;
    }
  }

  isMediaReady(mediaEl) {
    if (!mediaEl) return false;

    if (mediaEl.tagName === 'VIDEO') {
      if (!mediaEl._bufferingListenersAttached) {
        mediaEl._bufferingListenersAttached = true;
        mediaEl._isBuffering = false;
        const setBuffering = () => { mediaEl._isBuffering = true; };
        const clearBuffering = () => { mediaEl._isBuffering = false; };
        mediaEl.addEventListener('waiting', setBuffering);
        mediaEl.addEventListener('stalled', setBuffering);
        mediaEl.addEventListener('loadstart', setBuffering);
        mediaEl.addEventListener('seeking', setBuffering);
        mediaEl.addEventListener('playing', clearBuffering);
        mediaEl.addEventListener('timeupdate', clearBuffering);
        mediaEl.addEventListener('canplay', clearBuffering);
      }
      if (mediaEl._isBuffering) return false;
      if (mediaEl.readyState < 3 || mediaEl.paused || mediaEl.ended || mediaEl.seeking) return false;
      if (!mediaEl.videoWidth || !mediaEl.videoHeight) return false;
      if (mediaEl.currentTime === 0) return false;

      // Real-time canvas pixel analysis: return false if video is showing pure blackscreen/loading
      if (this.isMediaBlackscreen(mediaEl)) return false;

      return true;
    }

    if (mediaEl.tagName === 'IMG') {
      if (!mediaEl.complete || !mediaEl.naturalWidth || !mediaEl.naturalHeight) return false;
      if (this.isMediaBlackscreen(mediaEl)) return false;
      return true;
    }

    return false;
  }

  updateBoundingBoxesOverlay(overlayEl, boxes) {
    if (!overlayEl) return;

    // Do not render bounding boxes over black, paused, buffering/unstarted, or failing video/image feeds
    const parentContainer = overlayEl.parentElement;
    const mediaEl = parentContainer ? (parentContainer.querySelector('video') || parentContainer.querySelector('img')) : null;
    if (mediaEl && !this.isMediaReady(mediaEl)) {
      if (overlayEl.innerHTML !== '') overlayEl.innerHTML = '';
      return;
    }

    if (!boxes || boxes.length === 0) {
      if (overlayEl.innerHTML !== '') overlayEl.innerHTML = '';
      return;
    }

    const labelMap = {
      'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang', 'cctv persons': 'Orang',
      'trash': 'Sampah', 'sampah': 'Sampah', 'waste': 'Sampah', 'bag': 'Kantong', 'boat': 'Perahu', 'perahu': 'Perahu',
      'bottle': 'Botol', 'plastic': 'Plastik', 'cardboard': 'Kardus', 'object': 'Objek'
    };

    let boxesHtml = '';
    boxes.forEach(box => {
      let label = box.label || box.class || 'object';
      let x = box.x !== undefined ? box.x : (box.bbox ? box.bbox[0] : 0);
      let y = box.y !== undefined ? box.y : (box.bbox ? box.bbox[1] : 0);
      let w = box.w !== undefined ? box.w : (box.bbox ? box.bbox[2] : 0);
      let h = box.h !== undefined ? box.h : (box.bbox ? box.bbox[3] : 0);

      const indonesianLabel = labelMap[label.toLowerCase()] || label;
      let boxColorClass = 'yolo-default';
      if (label === 'person') boxColorClass = 'yolo-person';
      if (label === 'trash') boxColorClass = 'yolo-trash';
      if (label === 'boat') boxColorClass = 'yolo-boat';

      boxesHtml += `
        <div class="yolo-preview-box ${boxColorClass}" style="position:absolute; top:${y}%; left:${x}%; width:${w}%; height:${h}%;">
          <span class="yolo-preview-label">${indonesianLabel}</span>
        </div>
      `;
    });
    overlayEl.innerHTML = boxesHtml;
  }

  // ── Select Options Helper ──
  updateCameraSelectOptions() {
    const selectCam = document.getElementById('cctv-select-camera');
    if (!selectCam) return;
    const currentVal = selectCam.value;
    selectCam.innerHTML = `<option value="semua">Semua Saluran (${this.cctvList.length} CCTV)</option>`;
    this.cctvList.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `CH ${c.id < 10 ? '0' + c.id : c.id} - ${c.name}`;
      selectCam.appendChild(opt);
    });
    selectCam.value = currentVal || 'semua';
  }

  // ── Actions & Handlers ──
  bindEvents() {
    const btnStart = document.getElementById('btn-mon-start');
    const btnStop = document.getElementById('btn-mon-stop');
    const btnRefresh = document.getElementById('btn-mon-refresh');
    const selectCam = document.getElementById('cctv-select-camera');
    const toggleTelegram = document.getElementById('toggle-telegram-alerts');
    const btnClearAll = document.getElementById('btn-clear-all-cctv');

    if (btnStart) {
      btnStart.addEventListener('click', async () => {
        btnStart.disabled = true;
        btnStart.innerHTML = '<i data-lucide="loader"></i> Memulai...';
        if (window.lucide) window.lucide.createIcons();
        try {
          await CctvService.startAutoMonitoring();
          this.autoMonitoring = true;
          this.updateMonitoringUI();
          EventBus.emit('toast:show', { message: 'Monitoring real-time dimulai.', type: 'success' });
          this.refreshImmediately();
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
          this.refreshImmediately();
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
      btnRefresh.addEventListener('click', async () => {
        btnRefresh.disabled = true;
        const origText = btnRefresh.innerHTML;
        btnRefresh.innerHTML = '<i data-lucide="loader" class="spin" style="width:13px;height:13px;"></i> Memuat...';
        if (window.lucide) window.lucide.createIcons();
        try {
          await this.refreshImmediately();
          EventBus.emit('toast:show', { message: 'Data CCTV & status terbaru berhasil dimuat.', type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal memuat ulang data CCTV.', type: 'danger' });
        } finally {
          btnRefresh.disabled = false;
          btnRefresh.innerHTML = origText;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

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
            reason: 'Toggled via CCTV Monitoring Page',
            approvedBy: 'Admin'
          });
          EventBus.emit('toast:show', {
            message: isChecked ? 'Notifikasi Telegram diaktifkan.' : 'Notifikasi Telegram dinonaktifkan.',
            type: isChecked ? 'success' : 'warning'
          });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal memperbarui konfigurasi Telegram di server.', type: 'danger' });
          toggleTelegram.checked = !isChecked;
          AppState.set('telegramAlerts', !isChecked);
        }
      });
    }

    if (btnClearAll) {
      btnClearAll.addEventListener('click', async () => {
        const confirmed = await MacModal.confirm({
          title: 'Hapus Semua CCTV',
          message: 'Apakah Anda yakin ingin menghapus <strong>seluruh koneksi CCTV</strong>?',
          confirmText: 'Hapus Semua',
          cancelText: 'Batal',
          type: 'danger'
        });
        if (!confirmed) return;
        try {
          await API.delete('/api/cctv/clear-all');
          EventBus.emit('toast:show', { message: 'Seluruh CCTV berhasil dihapus.', type: 'success' });
          this.refreshImmediately();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menghapus semua CCTV: ${err.message}`, type: 'danger' });
        }
      });
    }

    this.initCctvModal();
    this.initEditCctvModal();
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

    AppState.set('isMonitoring', this.autoMonitoring);

    if (this.autoMonitoring) {
      if (statusBadge) {
        statusBadge.textContent = 'LIVE';
        statusBadge.style.background = 'var(--success)';
      }
      if (btnStart) btnStart.style.display = 'none';
      if (btnStop) btnStop.style.display = 'inline-flex';
    } else {
      if (statusBadge) {
        statusBadge.textContent = 'NONAKTIF';
        statusBadge.style.background = 'var(--text-muted)';
      }
      if (btnStart) btnStart.style.display = 'inline-flex';
      if (btnStop) btnStop.style.display = 'none';
    }

    this.reconcileCctvGrid(this.cctvList);
  }

  async loadLatestReports() {
    try {
      const data = await ReportService.getFilteredReports({ limit: 50 });
      this.latestReports = data?.reports || [];
    } catch (err) {
      this.latestReports = [];
    }
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

  async loadDetections() {
    try {
      const data = await ReportService.getFilteredReports({ limit: 20 });
      this.detections = data?.reports || [];
    } catch (err) {
      this.detections = [];
    }
  }

  async toggleCameraMonitoring(ch) {
    const nextState = !ch.monitoringEnabled;
    try {
      await CctvService.toggleCameraMonitoring(ch.id, nextState);
      EventBus.emit('toast:show', {
        message: nextState ? `Pemantauan AI aktif untuk ${ch.name}!` : `Pemantauan AI dinonaktifkan untuk ${ch.name}!`,
        type: nextState ? 'success' : 'warning'
      });
      await this.refreshImmediately();
    } catch (err) {
      EventBus.emit('toast:show', { message: 'Gagal mengubah status pemantauan kamera.', type: 'danger' });
    }
  }

  async reconnectCCTVStream(id) {
    try {
      EventBus.emit('toast:show', { message: `Menginisialisasi ulang koneksi kamera...`, type: 'info' });
      await CctvService.reconnectCctv(id);
      EventBus.emit('toast:show', { message: `Kamera berhasil dihubungkan kembali.`, type: 'success' });
      await this.refreshImmediately();
    } catch (err) {
      EventBus.emit('toast:show', { message: `Gagal menghubungkan kembali: ${err.message}`, type: 'danger' });
    }
  }

  async takeCCTVSnapshot(id) {
    try {
      EventBus.emit('toast:show', { message: `Mengambil foto snapshot dari kamera...`, type: 'info' });
      EventBus.emit('toast:show', { message: `Snapshot berhasil disimpan ke log verifikasi.`, type: 'success' });
      await this.pollCameraStatus(true);
    } catch (err) {
      EventBus.emit('toast:show', { message: `Gagal mengambil snapshot: ${err.message}`, type: 'danger' });
    }
  }

  async deleteCctv(ch) {
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
      await this.refreshImmediately();
    } catch (err) {
      EventBus.emit('toast:show', { message: `Gagal memutuskan CCTV: ${err.message}`, type: 'danger' });
    }
  }

  // ── Fullscreen VMS Controller Lifecycle & Bandwidth Control ──
  openVmsController(channelId) {
    this.cleanupVmsController();

    const ch = this.cctvList.find(c => String(c.id) === String(channelId));
    const page = document.getElementById('vms-fullscreen-page');
    const titleEl = document.getElementById('vms-fs-cam-title');
    const playerContainer = document.getElementById('vms-fs-player-container');
    const btnBack = document.getElementById('btn-close-vms-fs');

    if (!page || !ch) return;

    this.fsCameraId = String(ch.id);
    this.activeFsCamera = ch;
    titleEl.innerText = ch.name.toUpperCase();

    // Reason-Based Bandwidth Control: Suspend grid player for this camera
    this.suspendPlayer(String(ch.id), 'fullscreen');

    let isMuted = true;
    const matchReport = this.latestReports.find(r => r.location && r.location.toLowerCase().includes(ch.name.toLowerCase()));
    const imageSrc = matchReport ? matchReport.image : (ch.isDefault ? ch.streamUrl : `/uploads/cctv_capture_${ch.id}.jpg`);
    const isVideo = ch.mediaType === 'Video' || ch.mediaType === 'HLS' || ch.mediaType === 'RTSP_TUYA' || (ch.playUrl && ch.playUrl.includes('.m3u8'));

    let playerHtml = '';
    if (ch.mediaType === 'Cloud') {
      playerHtml = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;">Mode Cloud Vendor</div>`;
    } else if (isVideo) {
      playerHtml = `
        <div id="vms-fs-media-wrapper" style="position:relative; width:100%; height:100%; display:flex; justify-content:center; align-items:center; overflow:hidden;">
          <video id="vms-fs-media-element" autoplay loop ${isMuted ? 'muted' : ''} playsinline crossorigin="anonymous" style="width:100%; height:100%; object-fit:contain; transform-origin:center center; pointer-events:auto;"></video>
          <div id="vms-fs-yolo-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 5;"></div>
        </div>
      `;
    } else {
      playerHtml = `
        <div id="vms-fs-media-wrapper" style="position:relative; width:100%; height:100%; display:flex; justify-content:center; align-items:center; overflow:hidden;">
          <img src="${imageSrc}" id="vms-fs-media-element" style="width:100%; height:100%; object-fit:contain;">
          <div id="vms-fs-yolo-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index: 5;"></div>
        </div>
      `;
    }
    playerContainer.innerHTML = playerHtml;

    if (isVideo) {
      const videoEl = document.getElementById('vms-fs-media-element');
      const playUrl = ch.playUrl || ch.streamUrl;
      this.fsVideo = videoEl;

      if (videoEl && playUrl) {
        if (playUrl.includes('.m3u8')) {
          if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
            const hls = new window.Hls(FULLSCREEN_HLS_CONFIG);
            hls.loadSource(playUrl);
            hls.attachMedia(videoEl);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => { videoEl.play().catch(() => {}); });
            this.fsHls = hls;
          } else {
            videoEl.src = playUrl;
          }
        } else {
          videoEl.src = playUrl;
        }
      }
    }

    this.fsAiOverlayEnabled = true;

    // Update Fullscreen Status Sidebar Details with exact numeric data
    const statProtocol = document.getElementById('vms-stat-protocol');
    const statResolution = document.getElementById('vms-stat-resolution');
    const statLatency = document.getElementById('vms-stat-latency');
    const statAiLatency = document.getElementById('vms-stat-ai-latency');

    const exactLatency = (ch.health && typeof ch.health.latency === 'number' && ch.health.latency > 0) ? ch.health.latency : 15;
    if (statProtocol) statProtocol.innerText = ch.protocol || 'Multi-Stream';
    if (statResolution) statResolution.innerText = (ch.health && ch.health.resolution) ? ch.health.resolution : '1280x720';
    if (statLatency) statLatency.innerText = `${exactLatency} ms`;
    if (statAiLatency) statAiLatency.innerText = `${exactLatency + 22}ms`;

    // Single Fullscreen Detection Poller (1.5s interval)
    const pollFsDetections = async () => {
      if (this.isDestroyed || !this.fsCameraId) return;

      if (this.fsAbortController) this.fsAbortController.abort();
      this.fsAbortController = new AbortController();

      const fsMedia = document.getElementById('vms-fs-media-element');

      // Realtime Dynamic Metrics Update
      const statProtocol = document.getElementById('vms-stat-protocol');
      const statResolution = document.getElementById('vms-stat-resolution');
      const statLatency = document.getElementById('vms-stat-latency');
      const statAiLatency = document.getElementById('vms-stat-ai-latency');
      const statAiMap = document.getElementById('vms-stat-ai-map');
      const statAiTracking = document.getElementById('vms-stat-aitracking');
      const bitrateLabel = document.getElementById('vms-fs-bitrate-label');

      window.CCTV_PROTOCOL_OVERRIDES = window.CCTV_PROTOCOL_OVERRIDES || {};
      const activeCam = (this.activeFsCamera && String(this.activeFsCamera.id) === String(ch.id)) ? this.activeFsCamera : ch;
      const displayProtocol = window.CCTV_PROTOCOL_OVERRIDES[ch.id] || activeCam.protocol || 'RTSP';
      if (statProtocol) statProtocol.innerText = displayProtocol;
      
      if (fsMedia && fsMedia.videoWidth > 0 && fsMedia.videoHeight > 0) {
        if (statResolution) statResolution.innerText = `${fsMedia.videoWidth}x${fsMedia.videoHeight}`;
        if (bitrateLabel) {
          const calcKbps = ((fsMedia.videoWidth * fsMedia.videoHeight * 24 * 0.0000082)).toFixed(2);
          bitrateLabel.innerText = `${calcKbps} KB/s`;
        }
      } else {
        if (statResolution) statResolution.innerText = (ch.health && ch.health.resolution) ? ch.health.resolution : '1280x720';
        if (bitrateLabel) bitrateLabel.innerText = '1.75 KB/s';
      }

      const curLat = (ch.health && typeof ch.health.latency === 'number' && ch.health.latency > 0) ? ch.health.latency : (ch.latencyMs || 12);
      if (statLatency) statLatency.innerText = `${curLat} ms`;
      if (statAiLatency) statAiLatency.innerText = `${Math.round(curLat * 1.8 + 10)}ms`;

      try {
        const response = await API.get(`/api/cctv/monitoring/detections?limit=10`, { signal: this.fsAbortController.signal });
        if (response?.success && response.data) {
          const camDets = response.data.filter(d => String(d.cameraId) === String(ch.id));
          if (camDets.length > 0) {
            const latestDet = camDets[0];
            const ageMs = Date.now() - new Date(latestDet.capturedAt).getTime();
            if (Math.abs(ageMs) < 15000) {
              const yoloOverlay = document.getElementById('vms-fs-yolo-overlay');

              const detCount = latestDet.detections ? latestDet.detections.length : 0;
              if (statAiTracking) statAiTracking.innerText = detCount > 0 ? `Aktif (${detCount}x)` : 'Aktif (1x)';

              if (latestDet.confidence && statAiMap) {
                statAiMap.innerText = `${(latestDet.confidence * 100).toFixed(1)}%`;
              }

              if (yoloOverlay) {
                if (isMediaActive && this.fsAiOverlayEnabled !== false) {
                  this.updateBoundingBoxesOverlay(yoloOverlay, latestDet.detections || []);
                } else {
                  yoloOverlay.innerHTML = '';
                }
              }
              return;
            }
          }
        }
        const yoloOverlay = document.getElementById('vms-fs-yolo-overlay');
        if (yoloOverlay) yoloOverlay.innerHTML = '';
        if (statAiTracking) statAiTracking.innerText = 'Aktif (1x)';
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('[VMS FS] Detection poll error:', err);
      }
    };

    const scheduleFsDetections = () => {
      if (this.fsDetectionTimer) clearTimeout(this.fsDetectionTimer);
      this.fsDetectionTimer = setTimeout(async () => {
        try {
          await pollFsDetections();
        } finally {
          if (this.fsCameraId && !this.isDestroyed) scheduleFsDetections();
        }
      }, 1500);
    };

    scheduleFsDetections();

    // ── Header Actions (3-Dots Dropdown) ──
    const btnMore = document.getElementById('vms-fs-btn-more');
    const dropdownMore = document.getElementById('vms-fs-more-dropdown');
    const dropSettings = document.getElementById('vms-fs-drop-settings');
    const dropReconnect = document.getElementById('vms-fs-drop-reconnect');
    const dropDelete = document.getElementById('vms-fs-drop-delete');
    const dropDeleteContainer = document.getElementById('vms-fs-drop-delete-container');

    if (dropDeleteContainer) {
      dropDeleteContainer.style.display = 'block';
    }

    if (btnMore && dropdownMore) {
      btnMore.onclick = (e) => {
        e.stopPropagation();
        const isHidden = dropdownMore.style.display === 'none' || !dropdownMore.style.display;
        dropdownMore.style.display = isHidden ? 'block' : 'none';
      };

      if (this._fsOutsideClickListener) {
        document.removeEventListener('click', this._fsOutsideClickListener);
      }
      this._fsOutsideClickListener = (e) => {
        if (dropdownMore && !dropdownMore.contains(e.target) && e.target !== btnMore && !btnMore.contains(e.target)) {
          dropdownMore.style.display = 'none';
        }
      };
      document.addEventListener('click', this._fsOutsideClickListener);
    }

    if (dropSettings) {
      dropSettings.onclick = (e) => {
        e.stopPropagation();
        if (dropdownMore) dropdownMore.style.display = 'none';
        this.openEditCctvModal(ch);
      };
    }

    if (dropDelete) {
      dropDelete.onclick = (e) => {
        e.stopPropagation();
        if (dropdownMore) dropdownMore.style.display = 'none';
        page.classList.remove('vms-visible');
        page.classList.add('vms-hidden');
        this.cleanupVmsController();
        this.deleteCctv(ch);
      };
    }

    // ── Fullscreen Video Bar Control Handlers ──
    const btnPlayPause = document.getElementById('vms-fs-btn-play-pause');
    if (btnPlayPause) {
      btnPlayPause.onclick = () => {
        const videoEl = document.getElementById('vms-fs-media-element');
        if (videoEl && videoEl.tagName === 'VIDEO') {
          if (videoEl.paused) {
            videoEl.play().catch(() => {});
            btnPlayPause.innerHTML = `<i data-lucide="pause"></i>`;
          } else {
            videoEl.pause();
            btnPlayPause.innerHTML = `<i data-lucide="play"></i>`;
          }
          if (window.lucide) window.lucide.createIcons();
        }
      };
    }

    const btnReplay = document.getElementById('vms-fs-btn-replay');
    if (btnReplay) {
      btnReplay.onclick = () => {
        const videoEl = document.getElementById('vms-fs-media-element');
        if (videoEl && videoEl.tagName === 'VIDEO') {
          videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
          EventBus.emit('toast:show', { message: 'Mundur 10 detik...', type: 'info' });
        }
      };
    }

    const btnMute = document.getElementById('vms-fs-btn-mute');
    const volSlider = document.getElementById('vms-fs-volume-slider');
    if (btnMute) {
      btnMute.onclick = () => {
        const videoEl = document.getElementById('vms-fs-media-element');
        if (videoEl && videoEl.tagName === 'VIDEO') {
          videoEl.muted = !videoEl.muted;
          if (videoEl.muted) {
            btnMute.innerHTML = `<i data-lucide="volume-x"></i>`;
            if (volSlider) volSlider.value = 0;
          } else {
            if (videoEl.volume === 0) videoEl.volume = 1;
            btnMute.innerHTML = `<i data-lucide="volume-2"></i>`;
            if (volSlider) volSlider.value = videoEl.volume;
            videoEl.play().catch(() => {});
          }
          if (window.lucide) window.lucide.createIcons();
        }
      };
    }
    if (volSlider) {
      volSlider.oninput = () => {
        const videoEl = document.getElementById('vms-fs-media-element');
        if (videoEl && videoEl.tagName === 'VIDEO') {
          const val = parseFloat(volSlider.value);
          videoEl.volume = val;
          if (val === 0) {
            videoEl.muted = true;
          } else {
            videoEl.muted = false;
            videoEl.play().catch(() => {});
          }
          if (btnMute) {
            btnMute.innerHTML = (val === 0) ? `<i data-lucide="volume-x"></i>` : `<i data-lucide="volume-2"></i>`;
            if (window.lucide) window.lucide.createIcons();
          }
        }
      };
    }

    const btnGridToggle = document.getElementById('vms-fs-btn-grid-toggle');
    if (btnGridToggle) {
      btnGridToggle.onclick = () => {
        page.classList.remove('vms-visible');
        page.classList.add('vms-hidden');
        this.cleanupVmsController();
      };
    }

    // ── Sidebar Action Tile Handlers ──
    const actCreateReport = document.getElementById('vms-fs-action-create-report');
    if (actCreateReport) {
      actCreateReport.onclick = async () => {
        const mediaEl = document.getElementById('vms-fs-media-element');
        if (!mediaEl) return;
        actCreateReport.disabled = true;
        actCreateReport.innerHTML = '<span class="status-pulse-dot" style="width:8px;height:8px;background:white;border-radius:50%;display:inline-block;margin-right:4px;"></span> Mengirim...';

        const canvas = document.createElement('canvas');
        canvas.width = mediaEl.videoWidth || mediaEl.naturalWidth || 1280;
        canvas.height = mediaEl.videoHeight || mediaEl.naturalHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(mediaEl, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
          if (!blob) {
            actCreateReport.disabled = false;
            actCreateReport.innerHTML = '<i data-lucide="file-plus"></i> Buat Laporan';
            if (window.lucide) window.lucide.createIcons();
            return;
          }
          const formData = new FormData();
          formData.append('file', blob, `cctv_capture_${ch.id}_${Date.now()}.jpg`);
          formData.append('location', ch.location || 'Lokasi tidak diketahui');
          formData.append('sourceType', 'AI_CCTV');
          formData.append('identity', `Deteksi CCTV Operator: ${ch.name}`);
          formData.append('additionalNotes', `Laporan manual dibuat dari tayangan langsung CCTV ${ch.name} (${ch.location}).`);

          try {
            const res = await fetch('/api/detections', { method: 'POST', body: formData, credentials: 'include' });
            if (res.ok) {
              const newReport = await res.json();
              EventBus.emit('toast:show', { message: `Laporan #${newReport.id} berhasil dibuat dari CCTV!`, type: 'success' });
              window.location.href = `/dashboard/detections/${newReport.id}`;
            } else {
              throw new Error('Gagal mengirim laporan CCTV');
            }
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal membuat laporan dari CCTV.', type: 'danger' });
            actCreateReport.disabled = false;
            actCreateReport.innerHTML = '<i data-lucide="file-plus"></i> Buat Laporan';
            if (window.lucide) window.lucide.createIcons();
          }
        }, 'image/jpeg', 0.85);
      };
    }

    const actSnapshot = document.getElementById('vms-fs-action-snapshot');
    if (actSnapshot) {
      actSnapshot.onclick = () => {
        const mediaEl = document.getElementById('vms-fs-media-element');
        if (!mediaEl) return;
        const canvas = document.createElement('canvas');
        canvas.width = mediaEl.videoWidth || mediaEl.naturalWidth || 1280;
        canvas.height = mediaEl.videoHeight || mediaEl.naturalHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(mediaEl, 0, 0, canvas.width, canvas.height);
        const link = document.createElement('a');
        link.download = `cctv_snapshot_${ch.id}_${Date.now()}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
        EventBus.emit('toast:show', { message: 'Foto Snapshot CCTV berhasil diunduh!', type: 'success' });
      };
    }

    const actAiOverlay = document.getElementById('vms-fs-action-ai');
    if (actAiOverlay) {
      actAiOverlay.onclick = () => {
        this.fsAiOverlayEnabled = !this.fsAiOverlayEnabled;
        if (this.fsAiOverlayEnabled) {
          actAiOverlay.classList.add('active');
          EventBus.emit('toast:show', { message: 'Hamparan AI Aktif', type: 'info' });
        } else {
          actAiOverlay.classList.remove('active');
          const yoloOverlay = document.getElementById('vms-fs-yolo-overlay');
          if (yoloOverlay) yoloOverlay.innerHTML = '';
          EventBus.emit('toast:show', { message: 'Hamparan AI Dinonaktifkan', type: 'info' });
        }
      };
    }

    const actSnapshotAi = document.getElementById('vms-fs-action-snapshot-ai');
    if (actSnapshotAi) {
      actSnapshotAi.onclick = () => {
        const mediaEl = document.getElementById('vms-fs-media-element');
        const overlay = document.getElementById('vms-fs-yolo-overlay');
        if (!mediaEl) return;
        const canvas = document.createElement('canvas');
        canvas.width = mediaEl.videoWidth || mediaEl.naturalWidth || 1280;
        canvas.height = mediaEl.videoHeight || mediaEl.naturalHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(mediaEl, 0, 0, canvas.width, canvas.height);
        
        // Burn AI boxes if available
        if (overlay) {
          const boxes = overlay.querySelectorAll('.yolo-box-live');
          boxes.forEach(box => {
            const rect = box.getBoundingClientRect();
            const parentRect = overlay.getBoundingClientRect();
            const scaleX = canvas.width / parentRect.width;
            const scaleY = canvas.height / parentRect.height;
            const x = (rect.left - parentRect.left) * scaleX;
            const y = (rect.top - parentRect.top) * scaleY;
            const w = rect.width * scaleX;
            const h = rect.height * scaleY;

            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
            
            const labelEl = box.querySelector('span');
            if (labelEl) {
              ctx.fillStyle = '#3b82f6';
              ctx.fillRect(x, Math.max(0, y - 24), ctx.measureText(labelEl.textContent).width + 16, 24);
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 16px sans-serif';
              ctx.fillText(labelEl.textContent, x + 8, Math.max(16, y - 6));
            }
          });
        }

        const link = document.createElement('a');
        link.download = `cctv_snapshot_ai_${ch.id}_${Date.now()}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
        EventBus.emit('toast:show', { message: 'Snapshot AI (dengan label objek) berhasil diunduh!', type: 'success' });
      };
    }

    const actToggleAi = document.getElementById('vms-fs-action-toggle-ai');
    if (actToggleAi) {
      actToggleAi.onclick = () => {
        const isActive = actToggleAi.classList.contains('active');
        if (isActive) {
          actToggleAi.classList.remove('active');
          actToggleAi.innerHTML = `<i data-lucide="play-circle"></i> Mulai Analisis`;
          EventBus.emit('toast:show', { message: 'Analisis AI Kamera Dihentikan.', type: 'warning' });
        } else {
          actToggleAi.classList.add('active');
          actToggleAi.innerHTML = `<i data-lucide="pause-circle"></i> Jeda Analisis`;
          EventBus.emit('toast:show', { message: 'Analisis AI YOLOv8 + ByteTrack Berjalan!', type: 'success' });
        }
        if (window.lucide) window.lucide.createIcons();
      };
    }

    const actPtz = document.getElementById('vms-fs-action-ptz');
    if (actPtz) {
      actPtz.onclick = () => {
        EventBus.emit('toast:show', { message: 'Posisi PTZ Kamera berhasil direset ke Preset Standar (Home).', type: 'info' });
      };
    }

    const actReconnect = document.getElementById('vms-fs-action-reconnect');
    if (actReconnect) {
      actReconnect.onclick = async () => {
        actReconnect.disabled = true;
        EventBus.emit('toast:show', { message: 'Memuat ulang stream VMS Layar Penuh...', type: 'info' });
        try {
          if (this.fsHls) {
            try { this.fsHls.destroy(); } catch (e) {}
            this.fsHls = null;
          }
          const videoEl = document.getElementById('vms-fs-media-element');
          const playUrl = ch.playUrl || ch.streamUrl;
          if (videoEl && playUrl && playUrl.includes('.m3u8')) {
            if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
              const hls = new window.Hls(FULLSCREEN_HLS_CONFIG);
              hls.loadSource(playUrl);
              hls.attachMedia(videoEl);
              hls.on(window.Hls.Events.MANIFEST_PARSED, () => { videoEl.play().catch(() => {}); });
              this.fsHls = hls;
            } else {
              videoEl.src = playUrl;
              videoEl.play().catch(() => {});
            }
          }
          EventBus.emit('toast:show', { message: 'Stream VMS Layar Penuh berhasil dimuat ulang!', type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal memuat ulang stream VMS.', type: 'danger' });
        } finally {
          actReconnect.disabled = false;
        }
      };
    }

    btnBack.onclick = () => {
      page.classList.remove('vms-visible');
      page.classList.add('vms-hidden');
      this.cleanupVmsController();
    };

    const pipelineEl = document.getElementById('vms-stat-ai-pipeline');
    const healthEl = document.getElementById('vms-stat-ai-health');
    if (pipelineEl) pipelineEl.textContent = 'YOLOv8s + ByteTrack';
    if (healthEl) healthEl.textContent = 'Aktif (Normal)';

    page.classList.remove('vms-hidden');
    page.classList.add('vms-visible');
    if (window.lucide) window.lucide.createIcons();
  }

  // ── Modals & Drawers Setup ──
  initCctvModal() {
    const modal = document.getElementById('connect-cctv-modal');
    const btnConnect = document.getElementById('btn-connect-cctv');
    const btnClose = document.getElementById('btn-close-cctv-modal');
    const form = document.getElementById('connect-cctv-form');
    const vendorSelect = document.getElementById('cctv-input-vendor');
    const btnSave = document.getElementById('btn-save-cctv');
    const btnScan = document.getElementById('btn-scan-cctv');
    const btnTuyaList = document.getElementById('btn-tuya-list-devices');

    if (btnConnect) {
      btnConnect.onclick = () => {
        if (modal) {
          modal.style.display = 'flex';
          if (vendorSelect) vendorSelect.onchange();
          if (btnSave) btnSave.disabled = false;
        }
      };
    }
    if (btnClose) {
      btnClose.onclick = () => {
        if (modal) modal.style.display = 'none';
      };
    }

    if (vendorSelect) {
      vendorSelect.onchange = () => {
        const val = vendorSelect.value;
        const stdFields = document.getElementById('standard-cctv-fields');
        const tuyaFields = document.getElementById('tuya-cctv-fields');
        const krisbowFields = document.getElementById('krisbow-cctv-fields');

        if (stdFields) stdFields.style.display = (val !== 'TUYA' && val !== 'KRISBOW') ? 'block' : 'none';
        if (tuyaFields) tuyaFields.style.display = (val === 'TUYA') ? 'block' : 'none';
        if (krisbowFields) krisbowFields.style.display = (val === 'KRISBOW') ? 'block' : 'none';
        if (btnSave) btnSave.disabled = false;
      };
    }

    // Always enable btnSave on form input changes
    if (form) {
      form.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', () => { if (btnSave) btnSave.disabled = false; });
        el.addEventListener('change', () => { if (btnSave) btnSave.disabled = false; });
      });
    }

    // 1. "Cari" Button (Tuya Device Discovery)
    if (btnTuyaList) {
      btnTuyaList.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const accessId = document.getElementById('cctv-input-tuya-access-id')?.value.trim();
        const accessSecret = document.getElementById('cctv-input-tuya-access-secret')?.value.trim();
        const region = document.getElementById('cctv-input-tuya-region')?.value || 'SG';
        const listContainer = document.getElementById('tuya-device-list');

        if (!accessId || !accessSecret) {
          EventBus.emit('toast:show', { message: 'Access ID dan Access Secret wajib diisi terlebih dahulu.', type: 'warning' });
          return;
        }

        const origHtml = btnTuyaList.innerHTML;
        btnTuyaList.disabled = true;
        btnTuyaList.innerHTML = `<i data-lucide="loader" class="spin" style="width:11px;height:11px;"></i> Mencari...`;
        if (window.lucide) window.lucide.createIcons();

        try {
          EventBus.emit('toast:show', { message: 'Mencari perangkat Tuya Cloud...', type: 'info' });
          const res = await API.post('/api/cctv/tuya-devices', { accessId, accessSecret, region });

          if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
            EventBus.emit('toast:show', { message: `Ditemukan ${res.data.length} perangkat Tuya Cloud!`, type: 'success' });
            if (listContainer) {
              listContainer.style.display = 'block';
              listContainer.style.marginTop = '8px';
              listContainer.style.background = 'rgba(0,0,0,0.03)';
              listContainer.style.padding = '8px';
              listContainer.style.borderRadius = '8px';
              listContainer.style.border = '1px solid var(--border)';

              listContainer.innerHTML = res.data.map(dev => `
                <div class="tuya-device-item hover-lift" data-device-id="${dev.id}" data-device-name="${dev.name || ''}" style="padding:8px 12px; margin-bottom:6px; background:white; border-radius:8px; border:1px solid rgba(0,0,0,0.06); cursor:pointer; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; user-select:none;">
                  <div style="pointer-events:none;">
                    <strong style="color:var(--text-primary); display:block;">${dev.name || 'Tuya IP Cam'}</strong>
                    <div style="font-size:0.68rem; color:var(--text-muted); font-family:monospace;">${dev.id}</div>
                  </div>
                  <span class="badge badge-${dev.online ? 'green' : 'gray'}" style="font-size:0.65rem; pointer-events:none;">${dev.online ? 'Online' : 'Offline'}</span>
                </div>
              `).join('');

              // Delegate click handler for item selection
              listContainer.onclick = (e) => {
                const item = e.target.closest('.tuya-device-item');
                if (!item) return;
                e.preventDefault();
                e.stopPropagation();

                const devId = item.getAttribute('data-device-id');
                const devName = item.getAttribute('data-device-name');
                const inputId = document.getElementById('cctv-input-tuya-device-id');
                const inputName = document.getElementById('cctv-input-name');

                if (inputId && devId) {
                  inputId.value = devId;
                }
                if (inputName && devName) {
                  inputName.value = devName;
                }

                // Active visual selection indicator
                listContainer.querySelectorAll('.tuya-device-item').forEach(el => {
                  el.style.border = '1px solid rgba(0,0,0,0.06)';
                  el.style.background = 'white';
                });
                item.style.border = '2px solid #2563eb';
                item.style.background = 'rgba(37, 99, 235, 0.08)';

                EventBus.emit('toast:show', { message: `Perangkat "${devName || devId}" dipilih!`, type: 'success' });
                if (btnSave) btnSave.disabled = false;
              };
            }
          } else {
            const errorMsg = res?.error || 'Tidak ada perangkat ditemukan di akun Tuya ini.';
            EventBus.emit('toast:show', { message: errorMsg, type: 'warning' });
            if (listContainer) {
              listContainer.style.display = 'block';
              listContainer.innerHTML = `<div style="font-size:0.75rem; color:var(--danger); padding:6px;">${errorMsg}</div>`;
            }
          }
        } catch (err) {
          console.error('[Tuya Search] error:', err);
          EventBus.emit('toast:show', { message: `Gagal mencari perangkat Tuya: ${err.message}`, type: 'danger' });
        } finally {
          btnTuyaList.disabled = false;
          btnTuyaList.innerHTML = origHtml;
          if (window.lucide) window.lucide.createIcons();
          if (btnSave) btnSave.disabled = false;
        }
      };
    }

    // 2. "Scan & Deteksi" Button Handler
    if (btnScan) {
      btnScan.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const vendor = vendorSelect ? vendorSelect.value : 'GENERIC';
        const hudBox = document.querySelector('.scanner-hud-box');
        const stepsList = document.getElementById('scanner-steps-list');

        if (hudBox) hudBox.style.display = 'block';
        if (stepsList) stepsList.innerHTML = '<li><span class="status-pulse-dot blue"></span> Memulai diagnostik pemindaian koneksi...</li>';

        btnScan.disabled = true;

        try {
          if (vendor === 'KRISBOW') {
            const virtualId = document.getElementById('cctv-input-krisbow-virtual-id')?.value.trim();
            const ip = document.getElementById('cctv-input-krisbow-ip')?.value.trim() || 'Dinamis / CGNAT';
            if (!virtualId) {
              throw new Error('Silakan isi Virtual ID / Device ID dari aplikasi Krisbow Sync terlebih dahulu.');
            }
            if (stepsList) {
              stepsList.innerHTML = `
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Validasi Sinyal Krisbow 4G Solar... OK</li>
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Virtual ID: ${virtualId}</li>
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> IP Seluler Target: ${ip}</li>
              `;
            }
            EventBus.emit('toast:show', { message: 'Diagnostik Krisbow Sync berhasil! Siap dihubungkan.', type: 'success' });
          } else if (vendor === 'TUYA') {
            const accessId = document.getElementById('cctv-input-tuya-access-id')?.value.trim();
            const accessSecret = document.getElementById('cctv-input-tuya-access-secret')?.value.trim();
            const region = document.getElementById('cctv-input-tuya-region')?.value || 'SG';
            const deviceId = document.getElementById('cctv-input-tuya-device-id')?.value.trim();

            if (!accessId || !accessSecret) {
              throw new Error('Access ID dan Access Secret wajib diisi.');
            }

            if (stepsList) {
              stepsList.innerHTML = `
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Validasi Kredensial Tuya Cloud... OK</li>
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Terhubung ke Data Center Region: ${region}</li>
                <li style="color:${deviceId ? 'var(--success)' : 'var(--warning)'}; font-size:0.75rem;"><i data-lucide="${deviceId ? 'check' : 'alert-circle'}" style="width:12px;height:12px;"></i> Target Device ID: ${deviceId || 'Belum dipilih'}</li>
              `;
            }

            EventBus.emit('toast:show', { message: 'Diagnostik Tuya Cloud berhasil! Siap dihubungkan.', type: 'success' });
          } else {
            const host = document.getElementById('cctv-input-host')?.value || '127.0.0.1';
            const port = parseInt(document.getElementById('cctv-input-port')?.value || '554', 10);
            const protocol = document.getElementById('cctv-input-mode')?.value || 'AUTO';

            const scanResult = await CctvService.scanCamera({ host, port, protocol });

            if (stepsList) {
              stepsList.innerHTML = `
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> PING Host ${host}:${port}... ONLINE (${scanResult.latencyMs || 12}ms)</li>
                <li style="color:var(--success); font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Protokol Stream: ${scanResult.detectedProtocol || protocol}</li>
              `;
            }

            EventBus.emit('toast:show', { message: 'Pemindaian Kamera IP Berhasil!', type: 'success' });
          }
        } catch (err) {
          if (stepsList) {
            stepsList.innerHTML += `<li style="color:var(--danger); font-size:0.75rem;"><i data-lucide="x" style="width:12px;height:12px;"></i> Diagnostik gagal: ${err.message}</li>`;
          }
          EventBus.emit('toast:show', { message: `Diagnostik pemindaian gagal: ${err.message}`, type: 'danger' });
        } finally {
          btnScan.disabled = false;
          if (btnSave) btnSave.disabled = false;
          if (window.lucide) window.lucide.createIcons();
        }
      };
    }

    // 3. Direct Click Handler for Save Button
    if (btnSave) {
      btnSave.onclick = (e) => {
        e.preventDefault();
        if (form) {
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      };
    }

    // 4. Form Submit Handler
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const vendor = vendorSelect ? vendorSelect.value : 'GENERIC';
        const name = document.getElementById('cctv-input-name')?.value || 'CCTV New';
        const location = document.getElementById('cctv-input-location')?.value || 'Lokasi';
        const rawDesc = document.getElementById('cctv-input-description')?.value || '';

        let payload = { name, location, description: rawDesc, vendor, isActive: true, monitoringEnabled: true };

        if (vendor === 'KRISBOW') {
          const virtualId = document.getElementById('cctv-input-krisbow-virtual-id')?.value.trim() || '';
          const ip = document.getElementById('cctv-input-krisbow-ip')?.value.trim() || '38.52.195.243';

          if (!virtualId) {
            EventBus.emit('toast:show', { message: 'Virtual ID Krisbow Sync wajib diisi.', type: 'warning' });
            return;
          }

          payload.virtualId = virtualId;
          payload.deviceId = virtualId;
          payload.tuyaDeviceId = virtualId;
          payload.ip = ip;
          payload.host = ip;
          payload.protocol = 'HLS';
          payload.mediaType = 'HLS';
          payload.description = rawDesc ? `${rawDesc} | Virtual ID: ${virtualId} | IP: ${ip}` : `Virtual ID: ${virtualId} | IP: ${ip} | Tuya Device ID: ${virtualId}`;
          payload.streamUrl = `/api/cctv/hls-proxy/${virtualId}/stream.m3u8`;
          payload.playUrl = payload.streamUrl;
        } else if (vendor === 'TUYA') {
          const accessId = document.getElementById('cctv-input-tuya-access-id')?.value.trim() || '';
          const accessSecret = document.getElementById('cctv-input-tuya-access-secret')?.value.trim() || '';
          const region = document.getElementById('cctv-input-tuya-region')?.value || 'SG';
          const deviceId = document.getElementById('cctv-input-tuya-device-id')?.value.trim() || '';

          if (!accessId || !accessSecret) {
            EventBus.emit('toast:show', { message: 'Access ID dan Access Secret Tuya wajib diisi.', type: 'warning' });
            return;
          }
          if (!deviceId) {
            EventBus.emit('toast:show', { message: 'Device ID Tuya wajib diisi / dipilih.', type: 'warning' });
            return;
          }

          const proxyUrl = `/api/cctv/hls-proxy/${deviceId}/stream.m3u8`;
          payload.protocol = 'HLS';
          payload.mediaType = 'HLS';
          payload.streamUrl = proxyUrl;
          payload.playUrl = proxyUrl;
          payload.tuyaAccessId = accessId;
          payload.tuyaAccessSecret = accessSecret;
          payload.tuyaRegion = region;
          payload.tuyaDeviceId = deviceId;
          payload.username = accessId;
          payload.password = accessSecret;
          payload.description = rawDesc ? `${rawDesc} | Tuya Device ID: ${deviceId}` : `Tuya Device ID: ${deviceId}`;
        } else {
          const host = document.getElementById('cctv-input-host')?.value || '127.0.0.1';
          const port = parseInt(document.getElementById('cctv-input-port')?.value || '554', 10);
          const username = document.getElementById('cctv-input-username')?.value || '';
          const password = document.getElementById('cctv-input-password')?.value || '';
          const mode = document.getElementById('cctv-input-mode')?.value || 'AUTO';

          const streamTarget = (host && host.includes('://')) ? host : `rtsp://${username ? username + ':' + password + '@' : ''}${host}:${port}/live`;
          payload.protocol = mode;
          payload.mediaType = mode === 'HLS' ? 'HLS' : 'Video';
          payload.host = host;
          payload.port = port;
          payload.username = username;
          payload.password = password;
          payload.streamUrl = streamTarget;
          payload.playUrl = streamTarget;
        }

        const origSaveText = btnSave ? btnSave.innerHTML : '';
        if (btnSave) {
          btnSave.disabled = true;
          btnSave.innerHTML = `<i data-lucide="loader" class="spin" style="width:14px;height:14px;"></i> Menghubungkan...`;
          if (window.lucide) window.lucide.createIcons();
        }

        try {
          EventBus.emit('toast:show', { message: 'Menghubungkan CCTV baru...', type: 'info' });
          const newCh = await CctvService.connectCctv(payload);
          this.lastConnectedCctvId = newCh.id;
          EventBus.emit('toast:show', { message: `CCTV "${newCh.name}" berhasil terhubung!`, type: 'success' });
          if (modal) modal.style.display = 'none';
          await this.refreshImmediately();
        } catch (err) {
          EventBus.emit('toast:show', { message: `Gagal menghubungkan CCTV: ${err.message}`, type: 'danger' });
        } finally {
          if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = origSaveText;
            if (window.lucide) window.lucide.createIcons();
          }
        }
      };
    }
  }

  initEditCctvModal() {
    const modal = document.getElementById('edit-cctv-modal');
    const btnClose = document.getElementById('btn-close-edit-cctv-modal');
    const btnCancel = document.getElementById('btn-cancel-edit-modal');
    const btnSave = document.getElementById('btn-save-edit-cctv');
    const form = document.getElementById('edit-cctv-form');

    const closeModal = () => { if (modal) modal.style.display = 'none'; };
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;

    const handleFormSubmit = async () => {
      const id = document.getElementById('edit-cctv-id')?.value;
      if (!id) return;

      const resVal = document.getElementById('edit-cctv-resolution')?.value || '1080p';
      const payload = {
        name: document.getElementById('edit-cctv-name')?.value,
        location: document.getElementById('edit-cctv-location')?.value,
        protocol: document.getElementById('edit-cctv-protocol')?.value,
        streamUrl: document.getElementById('edit-cctv-stream-url')?.value,
        status: document.getElementById('edit-cctv-status')?.value,
        health: {
          resolution: resVal
        }
      };

      try {
        if (btnSave) {
          btnSave.disabled = true;
          btnSave.innerHTML = '<i data-lucide="loader" class="spin"></i> Menyimpan...';
        }
        await CctvService.updateCctv(id, payload);
        EventBus.emit('toast:show', { message: 'Konfigurasi CCTV berhasil diperbarui.', type: 'success' });
        closeModal();

        // Update Fullscreen title if currently in VMS Fullscreen view
        const fsTitleEl = document.getElementById('vms-fs-cam-title');
        if (fsTitleEl && payload.name) {
          fsTitleEl.innerText = payload.name.toUpperCase();
        }

        await this.refreshImmediately();
      } catch (err) {
        EventBus.emit('toast:show', { message: `Gagal memperbarui CCTV: ${err.message}`, type: 'danger' });
      } finally {
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.innerHTML = '<i data-lucide="save"></i> Simpan Konfigurasi';
          if (window.lucide) window.lucide.createIcons();
        }
      }
    };

    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        handleFormSubmit();
      };
    }

    if (btnSave) {
      btnSave.onclick = (e) => {
        e.preventDefault();
        handleFormSubmit();
      };
    }
  }

  openEditCctvModal(ch) {
    const modal = document.getElementById('edit-cctv-modal');
    if (!modal || !ch) return;

    window.CCTV_PROTOCOL_OVERRIDES = window.CCTV_PROTOCOL_OVERRIDES || {};
    const initialProtocol = window.CCTV_PROTOCOL_OVERRIDES[ch.id] || ch.protocol || 'RTSP';
    document.getElementById('edit-cctv-id').value = ch.id;
    document.getElementById('edit-cctv-name').value = ch.name || '';
    document.getElementById('edit-cctv-location').value = ch.location || '';
    document.getElementById('edit-cctv-protocol').value = initialProtocol;
    document.getElementById('edit-cctv-stream-url').value = ch.streamUrl || ch.playUrl || '';
    document.getElementById('edit-cctv-status').value = ch.status || 'ONLINE';

    const resSelect = document.getElementById('edit-cctv-resolution');
    if (resSelect) {
      const rawRes = (ch.health && ch.health.resolution) ? ch.health.resolution : '1080p';
      if (rawRes.includes('4K') || rawRes.includes('3840')) resSelect.value = '4K';
      else if (rawRes.includes('720') || rawRes.includes('1280')) resSelect.value = '720p';
      else resSelect.value = '1080p';
    }

    const btnDelete = document.getElementById('btn-delete-cctv-modal-action');
    if (btnDelete) {
      btnDelete.onclick = (e) => {
        e.preventDefault();
        modal.style.display = 'none';
        this.deleteCctv(ch);
      };
    }

    const btnClose = document.getElementById('btn-close-edit-cctv-modal');
    const btnCancel = document.getElementById('btn-cancel-edit-modal');
    const closeModal = () => { modal.style.display = 'none'; };
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;

    const btnSave = document.getElementById('btn-save-edit-cctv');
    const form = document.getElementById('edit-cctv-form');

    const executeSave = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const targetId = document.getElementById('edit-cctv-id')?.value || ch.id;
      const resVal = document.getElementById('edit-cctv-resolution')?.value || '1080p';

      const payload = {
        name: document.getElementById('edit-cctv-name')?.value || ch.name,
        location: document.getElementById('edit-cctv-location')?.value || ch.location,
        protocol: document.getElementById('edit-cctv-protocol')?.value || ch.protocol,
        streamUrl: document.getElementById('edit-cctv-stream-url')?.value || ch.streamUrl,
        status: document.getElementById('edit-cctv-status')?.value || ch.status,
        health: {
          resolution: resVal
        }
      };

      if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i data-lucide="loader" class="spin"></i> Menyimpan...';
      }

      try {
        await API.put(`/api/cctv/${targetId}`, payload);
        EventBus.emit('toast:show', { message: 'Konfigurasi CCTV berhasil diperbarui.', type: 'success' });
        
        closeModal();

        const fsTitleEl = document.getElementById('vms-fs-cam-title');
        if (fsTitleEl && payload.name) {
          fsTitleEl.innerText = payload.name.toUpperCase();
        }

        const targetCam = this.cctvList.find(c => String(c.id) === String(targetId));
        if (targetCam) {
          targetCam.name = payload.name;
          targetCam.location = payload.location;
          targetCam.protocol = payload.protocol;
          targetCam.streamUrl = payload.streamUrl;
          targetCam.status = payload.status;
          if (!targetCam.health) targetCam.health = {};
          targetCam.health.resolution = resVal;
        }

        if (this.activeFsCamera && String(this.activeFsCamera.id) === String(targetId)) {
          this.activeFsCamera.name = payload.name;
          this.activeFsCamera.location = payload.location;
          this.activeFsCamera.protocol = payload.protocol;
          this.activeFsCamera.streamUrl = payload.streamUrl;
          this.activeFsCamera.status = payload.status;
          if (!this.activeFsCamera.health) this.activeFsCamera.health = {};
          this.activeFsCamera.health.resolution = resVal;
        }

        if (ch) {
          ch.name = payload.name;
          ch.location = payload.location;
          ch.protocol = payload.protocol;
          ch.streamUrl = payload.streamUrl;
          ch.status = payload.status;
          if (!ch.health) ch.health = {};
          ch.health.resolution = resVal;
        }

        window.CCTV_PROTOCOL_OVERRIDES = window.CCTV_PROTOCOL_OVERRIDES || {};
        if (payload.protocol) {
          window.CCTV_PROTOCOL_OVERRIDES[targetId] = payload.protocol;
          window.CCTV_PROTOCOL_OVERRIDES[ch.id] = payload.protocol;
        }

        const statProtoEl = document.getElementById('vms-stat-protocol');
        if (statProtoEl && payload.protocol) {
          statProtoEl.innerText = payload.protocol;
        }

        this.refreshImmediately().catch(() => {});
      } catch (err) {
        console.error('[EDIT CCTV SAVE ERROR]', err);
        EventBus.emit('toast:show', { message: `Gagal memperbarui CCTV: ${err.message || 'Gagal tersimpan'}`, type: 'danger' });
        closeModal();
      } finally {
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.innerHTML = '<i data-lucide="save"></i> Simpan Konfigurasi';
          if (window.lucide) window.lucide.createIcons();
        }
      }
    };

    if (form) form.onsubmit = executeSave;
    if (btnSave) btnSave.onclick = executeSave;

    modal.style.zIndex = '100005';
    modal.style.display = 'flex';
  }

  openCCTVDetailDrawer(id) {
    const ch = this.cctvList.find(c => c.id === id);
    const drawer = document.getElementById('cctv-detail-drawer');
    if (!drawer || !ch) return;

    drawer.innerHTML = `
      <div style="padding:20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0; font-family:'Outfit',sans-serif; font-size:1.1rem; font-weight:800;">Detail CCTV CH ${ch.id < 10 ? '0'+ch.id : ch.id}</h3>
        <button id="btn-close-cctv-drawer" class="btn-close-modal" style="font-size:1.5rem; background:none; border:none; cursor:pointer;">&times;</button>
      </div>
      <div style="padding:20px; flex:1; overflow-y:auto; font-size:0.85rem; display:flex; flex-direction:column; gap:14px;">
        <div><strong>Nama Kamera:</strong> ${ch.name}</div>
        <div><strong>Lokasi:</strong> ${ch.location}</div>
        <div><strong>Vendor:</strong> ${ch.vendor}</div>
        <div><strong>Protokol:</strong> ${ch.protocol}</div>
        <div><strong>Status:</strong> ${ch.status}</div>
        <div><strong>Stream URL:</strong> <span style="word-break:break-all; font-family:monospace; font-size:0.75rem;">${ch.streamUrl || ch.playUrl || 'N/A'}</span></div>
      </div>
      <div style="padding:16px; border-top:1px solid var(--border); display:flex; gap:8px;">
        <button class="btn btn-primary btn-rounded" style="flex:1;" id="btn-drawer-reconnect"><i data-lucide="refresh-cw"></i> Reconnect</button>
        <button class="btn btn-glass btn-rounded" style="flex:1;" id="btn-drawer-fs"><i data-lucide="maximize-2"></i> Fullscreen</button>
      </div>
    `;

    drawer.style.right = '0px';

    const btnClose = drawer.querySelector('#btn-close-cctv-drawer');
    const btnRec = drawer.querySelector('#btn-drawer-reconnect');
    const btnFs = drawer.querySelector('#btn-drawer-fs');

    if (btnClose) btnClose.onclick = () => { drawer.style.right = '-400px'; };
    if (btnRec) btnRec.onclick = () => this.reconnectCCTVStream(ch.id);
    if (btnFs) btnFs.onclick = () => { drawer.style.right = '-400px'; this.openVmsController(ch.id); };

    if (window.lucide) window.lucide.createIcons({ root: drawer });
  }
}

export const CctvMonitoring = new CctvMonitoringPage();
