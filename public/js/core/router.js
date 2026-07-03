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

  // Kembali ke halaman sebelumnya
  back() {
    window.history.back();
  }

  // Mendapatkan path saat ini
  current() {
    return window.location.pathname;
  }

  // Logika transisi rute
  handleRouteTransition(path) {
    AppState.set('activePath', path);
    EventBus.emit('routeChanged', path);
  }

  // Helper untuk mengubah path rute menjadi nama tab navigasi
  getTabNameFromPath(path) {
    if (path === '/dashboard') return 'dashboard';
    if (path === '/dashboard/laporan') return 'laporan';
    if (path === '/dashboard/upload') return 'upload';
    if (path.startsWith('/dashboard/detections/')) return 'detail';
    return 'dashboard';
  }
}

export const Router = new ClientRouter();
