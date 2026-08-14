// router.js - Pengelola Rute Navigasi Klien EYECO
import { AppState } from './state.js';
import { EventBus } from './eventBus.js';

// Scroll position memory per path (sessionStorage)
const ScrollMemory = {
  save(path) {
    if (!path) return;
    const key = 'eyeco_scroll_' + path.replace(/[^a-z0-9]/gi, '_');
    sessionStorage.setItem(key, String(window.scrollY));
  },
  restore(path) {
    if (!path) return;
    const key = 'eyeco_scroll_' + path.replace(/[^a-z0-9]/gi, '_');
    const y = sessionStorage.getItem(key);
    if (y !== null) {
      window.scrollTo({ top: parseInt(y, 10), behavior: 'instant' });
    }
  }
};

class ClientRouter {
  constructor() {
    // Listen to browser back/forward buttons
    window.addEventListener('popstate', () => {
      this.handleRouteTransition(window.location.pathname, { restoreScroll: true });
    });
  }

  // Navigasi ke path baru
  navigate(path) {
    if (window.location.pathname === path) return;
    
    // Simpan posisi scroll halaman saat ini sebelum pindah
    ScrollMemory.save(window.location.pathname);

    // Ingat halaman asal saat masuk Settings (untuk tombol kembali)
    const from = window.location.pathname;
    const toSettings = path === '/dashboard/settings' || path === '/dashboard/profile';
    if (toSettings && from !== '/dashboard/settings') {
      sessionStorage.setItem('eyeco_settings_return', from);
    }

    // Simpan tab sebelumnya untuk transisi bubble navigasi
    const prevTab = this.getTabNameFromPath(from);
    AppState.set('lastActiveTab', prevTab);
    
    window.history.pushState({}, '', path);
    this.handleRouteTransition(path);
  }

  // Navigasi ke path tertentu tanpa pushState (ganti history entry)
  replace(path) {
    if (window.location.pathname === path) return;
    ScrollMemory.save(window.location.pathname);
    window.history.replaceState({}, '', path);
    this.handleRouteTransition(path);
  }

  // Kembali ke halaman terakhir yang dibuka (sebelum masuk Settings)
  backTo(path) {
    if (path && window.location.pathname !== path) {
      ScrollMemory.save(window.location.pathname);
      window.history.pushState({}, '', path);
      this.handleRouteTransition(path, { restoreScroll: true });
    } else if (path && window.location.pathname === path) {
      this.handleRouteTransition(path, { restoreScroll: true });
    } else {
      window.history.back();
    }
  }

  // Mendapatkan path saat ini
  current() {
    return window.location.pathname;
  }

  // Logika transisi rute
  handleRouteTransition(path, opts = {}) {
    AppState.set('activePath', path);
    // Scroll ke atas halaman setiap kali navigasi, kecuali meminta restore
    if (!opts.restoreScroll) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
    EventBus.emit('routeChanged', path);
    if (opts.restoreScroll) ScrollMemory.restore(path);
  }

  // Helper untuk mengubah path rute menjadi nama tab navigasi
  getTabNameFromPath(rawPath) {
    const path = (rawPath && rawPath.length > 1 && rawPath.endsWith('/')) ? rawPath.slice(0, -1) : rawPath;
    if (path === '/dashboard') return 'dashboard';
    if (path === '/dashboard/laporan') return 'laporan';
    if (path === '/dashboard/upload') return 'upload';
    if (path.startsWith('/dashboard/detections/')) return 'detail';
    if (path === '/dashboard/cctv-monitoring') return 'cctv-monitoring';
    if (path === '/dashboard/workspace-requests') return 'workspace-requests';
    if (path === '/dashboard/settings' || path === '/dashboard/profile') return 'settings';
    if (path === '/faq') return 'faq';
    return 'dashboard';
  }
}

export const Router = new ClientRouter();
export { ScrollMemory };
