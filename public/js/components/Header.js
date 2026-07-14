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
      upload: this.container.querySelector('[data-tab="upload"]')
    };

    // Bind tab clicks — use natural <a href> navigation (Express serves each route)
    Object.keys(this.tabs).forEach(key => {
      const tab = this.tabs[key];
      if (tab) {
        // No preventDefault — let the browser follow the href naturally.
        // The SPA router still handles in-page popstate events for the back button.
        tab.addEventListener('click', () => {
          const targetPath = tab.getAttribute('href');
          AppState.set('lastActiveTab', this.getTabFromPath(window.location.pathname));
          // Allow natural navigation — do NOT call Router.navigate()
        });
      }
    });

    // Theme Toggle
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const currentTheme = AppState.get('theme');
        AppState.set('theme', currentTheme === 'dark' ? 'light' : 'dark');
        this.updateThemeButton();
      });
      this.updateThemeButton();
    }

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

    // Global Search Bar
    const searchInput = document.getElementById('header-global-search');
    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          // Real navigation to laporan route with search param
          window.location.href = `/dashboard/laporan?location=${encodeURIComponent(query)}`;
        }
      });
    }

    // Initial Sync
    this.syncNavbarState();
    this.renderUserProfile();
  }

  // Menyelaraskan active tab dengan bubble penanda geser
  syncNavbarState() {
    // Use the real browser URL as the source of truth (full-page Express routing)
    const currentPath = window.location.pathname || AppState.get('activePath');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';
    const exportBtn = document.getElementById('btn-header-export');

    // Role Guard Tab: Rename first tab dynamically based on role (Dashboard vs Beranda)
    if (this.tabs.dashboard) {
      if (isAdmin) {
        this.tabs.dashboard.innerHTML = '<i data-lucide="layout-dashboard"></i> Dashboard';
      } else {
        this.tabs.dashboard.innerHTML = '<i data-lucide="home"></i> Beranda';
      }
      this.tabs.dashboard.style.display = 'inline-flex';
    }
    if (this.tabs.laporan) this.tabs.laporan.style.display = 'inline-flex';
    if (this.tabs.upload) this.tabs.upload.style.display = 'inline-flex';

    // Export button visibility (Only on /dashboard/laporan for admins)
    if (exportBtn) {
      if (currentPath === '/dashboard/laporan' && isAdmin) {
        exportBtn.classList.add('visible');
      } else {
        exportBtn.classList.remove('visible');
      }
    }

    let activeKey = null;
    if (currentPath === '/dashboard') activeKey = 'dashboard';
    else if (currentPath === '/dashboard/laporan') activeKey = 'laporan';
    else if (currentPath === '/dashboard/upload') activeKey = 'upload';
    
    // Matikan semua kelas aktif
    Object.keys(this.tabs).forEach(key => {
      if (this.tabs[key]) {
        this.tabs[key].classList.remove('active');
      }
    });

    if (!activeKey || !this.tabs[activeKey]) {
      return;
    }

    const activeTab = this.tabs[activeKey];
    activeTab.classList.add('active');

    if (window.lucide) window.lucide.createIcons();
  }

  // Render info user login di dropdown profile
  renderUserProfile() {
    const user = AppState.get('user');
    const avatar = document.getElementById('profile-avatar-display');
    const dropdownName = document.getElementById('dropdown-username');
    const dropdownRole = document.getElementById('dropdown-role');

    if (!user) return;

    // Set Avatar initials (ambil 2 huruf username)
    if (avatar) {
      avatar.innerText = user.username.substring(0, 2).toUpperCase();
    }
    
    if (dropdownName) dropdownName.innerText = user.username;
    if (dropdownRole) dropdownRole.innerText = user.role.toUpperCase();
  }

  updateThemeButton() {
    const themeBtn = document.getElementById('btn-theme');
    if (!themeBtn) return;
    const theme = AppState.get('theme');
    themeBtn.innerHTML = theme === 'dark' ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
    if (window.lucide) window.lucide.createIcons();
  }

  // Helper: derive tab name from a URL path
  getTabFromPath(path) {
    if (path === '/dashboard') return 'dashboard';
    if (path === '/dashboard/laporan') return 'laporan';
    if (path === '/dashboard/upload') return 'upload';
    if (path.startsWith('/dashboard/detections/')) return 'detail';
    return 'dashboard';
  }
}
export const GlobalHeader = new HeaderComponent();
