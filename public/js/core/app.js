// app.js - Orkestrator & Bootstrapper Frontend EYECO Utama
import { AppState } from './state.js';
import { Router } from './router.js';
import { EventBus } from './eventBus.js';
import { AuthService } from '../services/authService.js';
import { GlobalHeader } from '../components/Header.js';
import { GlobalCommandPalette } from '../components/CommandPalette.js';
import { NotificationCenter } from '../components/Notification.js';

// Page imports
import { Dashboard } from '../pages/dashboard.js';
import { Laporan } from '../pages/laporan.js';
import { Upload } from '../pages/upload.js';
import { Detail } from '../pages/detail.js';

class AppInitializer {
  constructor() {
    this.viewport = null;
    this.currentPageInstance = null;
    this.notificationCenter = new NotificationCenter();

    // Bind event global
    EventBus.on('routeChanged', (path) => this.handleRouteNavigation(path));
    EventBus.on('auth:unauthorized', () => {
      window.location.href = '/login';
    });
  }

  // Mulai aplikasi
  async start() {
    this.viewport = document.getElementById('app-viewport');
    if (!this.viewport) return;

    // 1. Cek sesi otentikasi user saat ini
    try {
      await AuthService.getCurrentUser();
    } catch (err) {
      console.warn('[App Init] Pengguna tidak terotentikasi, alihkan ke login.');
      window.location.href = '/login';
      return;
    }

    // 2. Inisialisasi Komponen Global
    GlobalHeader.init();
    GlobalCommandPalette.init();
    this.notificationCenter.init();

    // 3. Muat tema tersimpan dari localStorage
    const savedTheme = AppState.get('theme');
    document.body.className = savedTheme === 'dark' ? 'dark-mode' : '';

    // 4. Trigger rute saat ini
    this.handleRouteNavigation(Router.current());
  }

  // Melakukan rendering halaman dinamis ke viewport utama
  async handleRouteNavigation(path) {
    // Bersihkan timers/polling pada halaman sebelumnya
    if (this.currentPageInstance && typeof this.currentPageInstance.destroy === 'function') {
      this.currentPageInstance.destroy();
    }

    // Show loading skeleton simulation delay
    this.renderPageSkeleton();

    // Router matching
    setTimeout(async () => {
      try {
        if (path === '/dashboard') {
          this.currentPageInstance = Dashboard;
          await Dashboard.render(this.viewport);
        } else if (path === '/dashboard/laporan') {
          this.currentPageInstance = Laporan;
          await Laporan.render(this.viewport);
        } else if (path === '/dashboard/upload') {
          this.currentPageInstance = Upload;
          await Upload.render(this.viewport);
        } else if (path.startsWith('/dashboard/detections/')) {
          const id = path.split('/').pop();
          this.currentPageInstance = Detail;
          await Detail.render(this.viewport, id);
        } else {
          // Default fallback
          Router.navigate('/dashboard');
        }

        // Initialize Lucide Icons in loaded viewport page
        if (window.lucide) {
          window.lucide.createIcons();
        }
      } catch (err) {
        console.error('[Router Error] Gagal memuat halaman:', err);
        this.renderRouterError();
      }
    }, 150); // 150ms delay for micro-interactions
  }

  renderPageSkeleton() {
    this.viewport.innerHTML = `
      <div style="display:flex; flex-direction:column; gap: 24px; width:100%; max-width:1400px; margin: 0 auto;">
        <div class="glass-card skeleton-cctv" style="height: 100px; width:100%;">
          <div class="skeleton skeleton-title" style="width: 25%;"></div>
          <div class="skeleton skeleton-line-short" style="width: 50%; margin-top: 12px;"></div>
        </div>
        <div class="stats-grid">
          ${Array(4).fill(0).map(() => `
            <div class="glass-card stat-card skeleton-cctv" style="height: 120px;">
              <div class="skeleton skeleton-circle" style="width:48px; height:48px; border-radius:50%;"></div>
              <div class="skeleton skeleton-line" style="margin-top:12px; width:70%;"></div>
            </div>
          `).join('')}
        </div>
        <div class="glass-card skeleton-cctv" style="height: 400px; width: 100%;">
          <div class="skeleton skeleton-media" style="height: 250px;"></div>
          <div class="skeleton skeleton-line" style="margin-top:20px; width:40%;"></div>
          <div class="skeleton skeleton-line-short" style="margin-top:12px; width:20%;"></div>
        </div>
      </div>
    `;
  }

  renderRouterError() {
    this.viewport.innerHTML = `
      <div class="glass-card error-alert-card" style="margin: 48px auto; max-width: 600px; padding: 48px; text-align:center;">
        <i data-lucide="shield-alert" style="width: 64px; height: 64px; color: var(--danger); margin-bottom: 16px;"></i>
        <h2>Gagal Memuat Halaman</h2>
        <p style="color:var(--text-secondary); margin: 8px 0 24px 0;">Terjadi kesalahan saat memproses rute navigasi dashboard.</p>
        <button onclick="window.location.reload()" class="btn btn-primary btn-rounded">
          <i data-lucide="refresh-cw"></i> Muat Ulang Aplikasi
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }
}

// Bootstrapping
const app = new AppInitializer();
document.addEventListener('DOMContentLoaded', () => app.start());
export default app;
