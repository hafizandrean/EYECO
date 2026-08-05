// Header.js - Pengelola Header Melayang Premium EYECO
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { AuthService } from '../services/authService.js';
import { ReportService } from '../services/reportService.js';
import { EventBus } from '../core/eventBus.js';

export class HeaderComponent {
  constructor() {
    this.container = null;
    this.indicator = null;
    this.tabs = {};
    
    // Subscribe ke route dan updates user
    EventBus.on('state:activePath', () => this.syncNavbarState());
    EventBus.on('state:user', () => this.renderUserProfile());
  }

  init() {
    this.container = document.getElementById('app-header');
    if (!this.container) return;

    this.tabs = {
      dashboard: this.container.querySelector('[data-tab="dashboard"]'),
      laporan: this.container.querySelector('[data-tab="laporan"]'),
      upload: this.container.querySelector('[data-tab="upload"]'),
      berita: this.container.querySelector('[data-tab="berita"]'),
      'cctv-monitoring': this.container.querySelector('[data-tab="cctv-monitoring"]')
    };
    this.indicator = document.getElementById('nav-indicator');
    this.indicatorInitialized = false;

    // Bind tab clicks — animasi dulu, baru navigasi
    Object.keys(this.tabs).forEach(key => {
      const tab = this.tabs[key];
      if (tab) {
        tab.addEventListener('click', (e) => {
          e.preventDefault(); // tahan navigasi
          const targetHref = tab.getAttribute('href');
          if (!targetHref || targetHref === window.location.pathname) return;

          // Animasi indicator slide + bouncing ke tab target
          this.moveIndicator(tab, true);

          // Tunggu animasi selesai, baru navigate via SPA Router (instant, tanpa full reload)
          setTimeout(() => {
            Router.navigate(targetHref);
          }, 480); // 420ms slide + 60ms buffer
        });
      }
    });

    // Export Button (Conditional)
    const exportBtn = document.getElementById('btn-header-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        ReportService.exportCSV();
      });
    }

    // Profile Dropdown Toggle
    const profileTrigger = document.getElementById('profile-trigger');
    const profileDropdown = document.getElementById('profile-dropdown');
    if (profileTrigger && profileDropdown) {
      profileTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('active');
      });
      document.addEventListener('click', () => {
        profileDropdown.classList.remove('active');
      });
    }

    // Logout Button — use /logout route (server clears cookie, redirects to /login)
    const logoutBtn = document.getElementById('btn-dropdown-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          // Best-effort API logout (kills session record)
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (_) {}
        window.location.href = '/logout';
      });
    }

    // Initial Sync
    this.syncNavbarState(true); // initial = tanpa animasi indicator
    this.renderUserProfile();
  }

  // Menyelaraskan active tab dengan bubble penanda geser
  syncNavbarState(initial = false) {
    // Use the real browser URL as the source of truth (full-page Express routing)
    const currentPath = window.location.pathname || AppState.get('activePath');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';
    const exportBtn = document.getElementById('btn-header-export');

    // Role Guard Tab: Rename first tab dynamically based on role (Dashboard vs Beranda)
    if (this.tabs.dashboard) {
      if (isAdmin) {
        this.tabs.dashboard.innerHTML = '<i data-lucide="layout-dashboard"></i> <span class="nav-text">Dasbor</span>';
      } else {
        this.tabs.dashboard.innerHTML = '<i data-lucide="home"></i> <span class="nav-text">Beranda</span>';
      }
      this.tabs.dashboard.style.display = 'inline-flex';
    }
    if (this.tabs.laporan) this.tabs.laporan.style.display = 'inline-flex';
    if (this.tabs.upload) this.tabs.upload.style.display = 'inline-flex';
    
    // Berita tab: only for admin
    if (this.tabs.berita) {
      this.tabs.berita.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    // CCTV Monitoring tab: only for admin
    if (this.tabs['cctv-monitoring']) {
      this.tabs['cctv-monitoring'].style.display = isAdmin ? 'inline-flex' : 'none';
    }

    // Export button visibility (Only on /dashboard/laporan for admins)
    if (exportBtn) {
      if (currentPath === '/dashboard/laporan' && isAdmin) {
        exportBtn.classList.add('visible');
      } else {
        exportBtn.classList.remove('visible');
      }
    }

    // Settings page: hide nav tabs, show search bar in navbar
    const isSettings = currentPath === '/dashboard/settings' || currentPath === '/dashboard/profile';
    const navTabs = document.getElementById('nav-tabs');
    const navSearch = document.getElementById('nav-search');
    if (navTabs) navTabs.style.display = isSettings ? 'none' : '';
    if (navSearch) navSearch.style.display = isSettings ? 'block' : 'none';

    let activeKey = null;
    if (currentPath === '/dashboard') activeKey = 'dashboard';
    else if (currentPath === '/dashboard/laporan') activeKey = 'laporan';
    else if (currentPath === '/dashboard/upload') activeKey = 'upload';
    else if (currentPath === '/dashboard/berita') activeKey = 'berita';
    else if (currentPath === '/dashboard/cctv-monitoring') activeKey = 'cctv-monitoring';
    
    // Matikan semua kelas aktif
    Object.keys(this.tabs).forEach(key => {
      if (this.tabs[key]) {
        this.tabs[key].classList.remove('active');
      }
    });

    if (!activeKey || !this.tabs[activeKey]) {
      if (this.indicator) {
        this.indicator.style.width = '0';
        this.indicator.style.transform = 'translateX(0)';
      }
      return;
    }

    const activeTab = this.tabs[activeKey];
    activeTab.classList.add('active');

    // Pindahkan indicator ke tab aktif
    this.moveIndicator(activeTab, !initial);

    if (window.lucide) window.lucide.createIcons();
  }

  // Render info user login di dropdown profile
  renderUserProfile() {
    const user = AppState.get('user');
    const avatar = document.getElementById('profile-avatar-display');
    const dropdownName = document.getElementById('dropdown-username');
    const dropdownRole = document.getElementById('dropdown-role');

    if (!user) return;

    // Set Avatar — foto profil jika ada, inisial jika tidak
    if (avatar) {
      if (user.avatar) {
        avatar.innerHTML = `<img src="${user.avatar}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        avatar.innerHTML = '';
        avatar.textContent = user.username.substring(0, 2).toUpperCase();
      }
    }
    
    if (dropdownName) dropdownName.innerText = user.username;
    if (dropdownRole) dropdownRole.innerText = user.role.toUpperCase();
  }

  // Helper: derive tab name from a URL path
  getTabFromPath(path) {
    if (path === '/dashboard') return 'dashboard';
    if (path === '/dashboard/laporan') return 'laporan';
    if (path === '/dashboard/upload') return 'upload';
    if (path.startsWith('/dashboard/detections/')) return 'detail';
    if (path === '/dashboard/cctv-monitoring') return 'cctv-monitoring';
    return 'dashboard';
  }

  // Pindahkan indikator sliding ke tab target
  moveIndicator(tab, animate = true) {
    if (!this.indicator || !tab) return;
    const parent = tab.closest('.nav-tabs');
    if (!parent) return;
    
    // Hitung posisi/lebar tab di dalam parent
    const tabRect = tab.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const left = tabRect.left - parentRect.left;
    
    if (animate) {
      this.indicator.style.transition = 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), width 420ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    } else {
      // Pertama kali inisialisasi — tanpa animasi
      this.indicator.style.transition = 'none';
    }
    
    this.indicator.style.width = `${tabRect.width}px`;
    this.indicator.style.transform = `translateX(${left}px)`;
    
    if (!animate) {
      // Force reflow, baru aktifkan transisi untuk berikutnya
      void this.indicator.offsetHeight;
      this.indicator.style.transition = 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), width 420ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    }
  }
}
export const GlobalHeader = new HeaderComponent();
