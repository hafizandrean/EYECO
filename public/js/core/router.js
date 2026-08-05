// router.js - Pengelola Rute Navigasi Klien EYECO
import { AppState } from './state.js';
import { EventBus } from './eventBus.js';

class ClientRouter {
  constructor() {
    // Listen to browser back/forward buttons
    window.addEventListener('popstate', () => {
      this.handleRouteTransition(window.location.pathname);
    });
  }

  // Navigasi ke path baru
  navigate(path) {
    if (window.location.pathname === path) return;
    
    // Simpan tab sebelumnya untuk transisi bubble navigasi
    const prevTab = this.getTabNameFromPath(window.location.pathname);
    AppState.set('lastActiveTab', prevTab);
    
    window.history.pushState({}, '', path);
    this.handleRouteTransition(path);
  }

  // Navigasi ke path tertentu tanpa pushState (ganti history entry)
  replace(path) {
    if (window.location.pathname === path) return;
    window.history.replaceState({}, '', path);
    this.handleRouteTransition(path);
  }

  // Kembali ke halaman terakhir yang dibuka (sebelum masuk Settings)
  backTo(path) {
    if (path && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      this.handleRouteTransition(path);
    } else if (path && window.location.pathname === path) {
      this.handleRouteTransition(path);
    } else {
      window.history.back();
    }
  }

  // Mendapatkan path saat ini
  current() {
    return window.location.pathname;
  }

  // Logika transisi rute
  handleRouteTransition(path) {
    AppState.set('activePath', path);
    // Scroll ke atas halaman setiap kali navigasi
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    EventBus.emit('routeChanged', path);
  }

  // Helper untuk mengubah path rute menjadi nama tab navigasi
  getTabNameFromPath(path) {
    if (path === '/dashboard') return 'dashboard';
    if (path === '/dashboard/laporan') return 'laporan';
    if (path === '/dashboard/upload') return 'upload';
    if (path.startsWith('/dashboard/detections/')) return 'detail';
    if (path === '/dashboard/cctv-monitoring') return 'cctv-monitoring';
    if (path === '/dashboard/settings' || path === '/dashboard/profile') return 'settings';
    if (path === '/faq') return 'faq';
    return 'dashboard';
  }
}

export const Router = new ClientRouter();
