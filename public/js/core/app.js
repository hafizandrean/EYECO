// app.js - Orkestrator & Bootstrapper Frontend EYECO Utama
import { AppState } from './state.js';
import { Router } from './router.js';
import { EventBus } from './eventBus.js';
import { AuthService } from '../services/authService.js';
import { GlobalHeader } from '../components/Header.js';
import { NotificationCenter } from '../components/Notification.js';
// Page imports
import { Dashboard } from '../pages/dashboard.js';
import { Laporan } from '../pages/laporan.js';
import { Upload } from '../pages/upload.js';
import { Detail } from '../pages/detail.js';
import { Home } from '../pages/home.js';
import { Profile } from '../pages/profile.js';
import { BeritaAdmin } from '../pages/berita-admin.js';
import { CctvMonitoring } from '../pages/cctv-monitoring.js?v=1.9.0';
import { FAQ } from '../pages/faq.js';

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

    // Scroll ke atas mkomen
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;

    // Sembunyikan navbar utama saat berada di halaman Profile (single page TikTok)
    const isProfile = path === '/dashboard/profile';
    const headerEl = document.getElementById('app-header');
    if (headerEl) {
      headerEl.style.display = isProfile ? 'none' : 'block';
      if (isProfile) document.body.classList.add('no-app-header');
      else document.body.classList.remove('no-app-header');
    }

    // Render halaman baru DI BELAKANG LAYER (opacity 0), tanpa nunggu
    // Dengan begini pas indicator slider sampe, konten udah siap
    this.viewport.style.opacity = '0';
    this.viewport.style.transition = 'none';

    try {
      const user = AppState.get('user');
      const isAdmin = user?.role === 'admin';

      if (path === '/dashboard') {
        // Non-admin users see the landing page (Beranda)
        if (!isAdmin) {
          this.currentPageInstance = Home;
          try {
            await Home.render(this.viewport);
          } catch (homeErr) {
            console.error('[Home Render Error]', homeErr);
          }
        } else {
          this.currentPageInstance = Dashboard;
          try {
            await Dashboard.render(this.viewport);
          } catch (dashErr) {
            console.error('[Dashboard Render Error]', dashErr);
          }
        }
      } else if (path === '/dashboard/cctv-monitoring') {
        this.currentPageInstance = CctvMonitoring;
        await CctvMonitoring.render(this.viewport);
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
      } else if (path === '/dashboard/profile') {
        this.currentPageInstance = Profile;
        await Profile.render(this.viewport);
      } else if (path === '/dashboard/berita') {
        this.currentPageInstance = BeritaAdmin;
        await BeritaAdmin.render(this.viewport);
      } else if (path === '/dashboard/cctv-monitoring') {
        this.currentPageInstance = CctvMonitoring;
        await CctvMonitoring.render(this.viewport);
      } else if (path === '/faq') {
        this.currentPageInstance = FAQ;
        await FAQ.render(this.viewport);
      } else {
        Router.navigate('/dashboard');
      }

      // Initialize Lucide Icons
      if (window.lucide) {
        window.lucide.createIcons();
      }

      // Force reflow, lalu fade-in — timing-nya bareng sama slide indicator
      void this.viewport.offsetHeight;
      this.viewport.style.transition = 'opacity 350ms cubic-bezier(0.22, 1, 0.36, 1)';
      this.viewport.style.opacity = '1';

      // Bersihkan inline style
      setTimeout(() => {
        this.viewport.style.transition = '';
      }, 400);
    } catch (err) {
      console.error('[Router Error] Gagal memuat halaman:', err);
      this.viewport.style.opacity = '1';
      this.renderRouterError(err);
    }
  }

  renderPageSkeleton() {
    // Tidak pakai skeleton — konten lama tetap terlihat sampai fade-out selesai
    // Lalu langsung render konten baru yang langsung fade-in
    // Ini bikin transisi mulus kayak macOS
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
