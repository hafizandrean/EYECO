// app.js - Orkestrator & Bootstrapper Frontend EYECO Utama
import { AppState } from './state.js';
import { Router } from './router.js';
import { EventBus } from './eventBus.js';
import { AuthService } from '../services/authService.js';
import { GlobalHeader } from '../components/Header.js';
import { NotificationCenter } from '../components/Notification.js';
import { Toast } from '../components/Toast.js';
// Page imports
import { Dashboard } from '../pages/dashboard.js';
import { Laporan } from '../pages/laporan.js';
import { Upload } from '../pages/upload.js';
import { Detail } from '../pages/detail.js';
import { Home } from '../pages/home.js';
import { Profile } from '../pages/profile.js';
import { BeritaAdmin } from '../pages/berita-admin.js';
import { CctvMonitoring } from '../pages/cctv-monitoring.js';
import { WorkspaceRequestsPage } from '../pages/workspace-requests.js';
import { FAQ } from '../pages/faq.js';

class AppInitializer {
  constructor() {
    this.viewport = null;
    this.currentPageInstance = null;
    this.notificationCenter = new NotificationCenter();
    this.toast = Toast;

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
  async handleRouteNavigation(rawPath) {
    const path = (rawPath && rawPath.length > 1 && rawPath.endsWith('/')) ? rawPath.slice(0, -1) : rawPath;

    // Bersihkan timers/polling pada halaman sebelumnya
    if (this.currentPageInstance && typeof this.currentPageInstance.destroy === 'function') {
      this.currentPageInstance.destroy();
    }

    // Scroll ke atas
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;

    // Navbar tetap tampil di Settings — tapi tab diganti search bar (lihat Header.js)
    const isSettings = path === '/dashboard/settings' || path === '/dashboard/profile';
    if (isSettings && !sessionStorage.getItem('eyeco_settings_return')) {
      const role = AppState.get('user')?.role;
      sessionStorage.setItem('eyeco_settings_return', role === 'superadmin' ? '/superadmin' : '/dashboard');
    }

    this.viewport.style.opacity = '1';
    this.viewport.style.transition = 'none';

    try {
      const user = AppState.get('user');
      const isAdmin = user?.role && ['admin', 'superadmin', 'operator', 'supervisor', 'officer'].includes(user.role);

      if (path === '/dashboard/beranda') {
        this.currentPageInstance = Home;
        try { await Home.render(this.viewport); } catch (e) { console.error('[Home Render Error]', e); }

      } else if (path === '/dashboard') {
        if (!isAdmin) {
          this.currentPageInstance = Home;
          try { await Home.render(this.viewport); } catch (e) { console.error('[Home Render Error]', e); }
        } else {
          // Admin login redirect to beranda first
          Router.navigate('/dashboard/beranda');
          return;
        }

      } else if (path === '/dashboard/cctv-monitoring') {
        this.currentPageInstance = CctvMonitoring;
        await CctvMonitoring.render(this.viewport);

      } else if (path === '/dashboard/workspace-requests') {
        const page = new WorkspaceRequestsPage();
        this.currentPageInstance = page;
        await page.render(this.viewport);

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

      } else if (path === '/dashboard/settings' || path === '/dashboard/profile') {
        this.currentPageInstance = Profile;
        await Profile.render(this.viewport);

      } else if (path === '/dashboard/berita') {
        this.currentPageInstance = BeritaAdmin;
        await BeritaAdmin.render(this.viewport);

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

      // Force reflow, lalu fade-in
      void this.viewport.offsetHeight;
      this.viewport.style.transition = 'opacity 350ms cubic-bezier(0.22, 1, 0.36, 1)';
      this.viewport.style.opacity = '1';

      setTimeout(() => {
        this.viewport.style.transition = '';
      }, 400);

    } catch (err) {
      console.error('[Router Error] Gagal memuat halaman:', err);
      this.viewport.style.opacity = '1';
      this.renderRouterError(err);
    }
  }

  renderPageSkeleton() {}

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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.start());
} else {
  app.start();
}
export default app;
