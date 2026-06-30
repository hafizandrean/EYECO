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

    this.indicator = this.container.querySelector('.nav-indicator');
    this.tabs = {
      dashboard: this.container.querySelector('[data-tab="dashboard"]'),
      laporan: this.container.querySelector('[data-tab="laporan"]'),
      upload: this.container.querySelector('[data-tab="upload"]')
    };

    // Bind tab clicks
    Object.keys(this.tabs).forEach(key => {
      const tab = this.tabs[key];
      if (tab) {
        tab.addEventListener('click', (e) => {
          e.preventDefault();
          const targetPath = tab.getAttribute('href');
          Router.navigate(targetPath);
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

    // Logout Button
    const logoutBtn = document.getElementById('btn-dropdown-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        AuthService.logout();
      });
    }

    // Global Search Bar
    const searchInput = document.getElementById('header-global-search');
    if (searchInput) {
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          Router.navigate(`/dashboard/laporan?location=${encodeURIComponent(query)}`);
        }
      });
    }

    // Initial Sync
    this.syncNavbarState();
    this.renderUserProfile();
  }

  // Menyelaraskan active tab dengan bubble penanda geser
  syncNavbarState() {
    const currentPath = AppState.get('activePath');
    const user = AppState.get('user');
    const isAdmin = user?.role === 'admin';
    const exportBtn = document.getElementById('btn-header-export');

    // Role Guard Tab: sembunyikan Dashboard & Laporan tab untuk non-admin
    const navCapsule = this.container.querySelector('.nav-tabs');
    if (user && !isAdmin) {
      if (this.tabs.dashboard) this.tabs.dashboard.style.display = 'none';
      if (this.tabs.laporan) this.tabs.laporan.style.display = 'none';
      if (navCapsule) navCapsule.style.border = 'none'; // Sederhanakan capsule
      if (this.indicator) this.indicator.style.display = 'none';
    } else {
      if (this.tabs.dashboard) this.tabs.dashboard.style.display = 'inline-flex';
      if (this.tabs.laporan) this.tabs.laporan.style.display = 'inline-flex';
      if (this.indicator) this.indicator.style.display = 'block';
    }

    // Export button visibility (Only on /dashboard/laporan)
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

    if (!activeKey || !this.tabs[activeKey] || (user && !isAdmin)) {
      if (this.indicator) this.indicator.style.width = '0px';
      return;
    }

    const activeTab = this.tabs[activeKey];
    activeTab.classList.add('active');

    // Geser bubble secara spring
    setTimeout(() => {
      if (this.indicator) {
        this.indicator.style.left = `${activeTab.offsetLeft}px`;
        this.indicator.style.width = `${activeTab.offsetWidth}px`;
        this.indicator.style.height = `${activeTab.offsetHeight}px`;
      }
    }, 100);
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
}
export const GlobalHeader = new HeaderComponent();
