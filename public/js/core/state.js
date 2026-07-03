// state.js - Manajemen State Terpusat untuk EYECO
import { CONFIG } from './config.js';
import { EventBus } from './eventBus.js';

class StateStore {
  constructor() {
    this.state = {
      theme: localStorage.getItem(CONFIG.THEME_KEY) || CONFIG.DEFAULT_THEME,
      user: null,
      activePath: window.location.pathname,
      isMonitoring: true,
      telegramAlerts: true,
      notifications: [],
      unreadNotifications: 0,
      toasts: [],
      lastActiveTab: sessionStorage.getItem('lastActiveTab') || 'dashboard'
    };
  }

  // Ambil data state
  get(key) {
    return this.state[key];
  }

  // Set data state dan beri tahu subscriber jika nilai berubah
  set(key, value) {
    const oldValue = this.state[key];
    if (JSON.stringify(oldValue) === JSON.stringify(value)) return; // Tidak ada perubahan

    this.state[key] = value;

    // Simpan data persistent tertentu jika berubah
    if (key === 'theme') {
      localStorage.setItem(CONFIG.THEME_KEY, value);
      document.body.className = value === 'dark' ? 'dark-mode' : '';
      EventBus.emit('themeChanged', value);
    }
    
    if (key === 'lastActiveTab') {
      sessionStorage.setItem('lastActiveTab', value);
    }

    // Emit event global bahwa key state tertentu telah diperbarui
    EventBus.emit(`state:${key}`, { newValue: value, oldValue });
  }

  // Reset state user (logout)
  reset() {
    this.set('user', null);
    this.set('notifications', []);
    this.set('unreadNotifications', 0);
  }
}

export const AppState = new StateStore();
