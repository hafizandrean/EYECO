// authService.js - Otentikasi dan Pengelolaan Sesi EYECO
import { API } from './api.js';
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { EventBus } from '../core/eventBus.js';

class AuthServiceClass {
  // Ambil sesi pengguna saat ini
  async getCurrentUser() {
    try {
      const user = await API.get('/api/auth/me');
      AppState.set('user', user);
      return user;
    } catch (err) {
      AppState.set('user', null);
      throw err;
    }
  }

  // Masuk Akun
  async login(username, password) {
    try {
      const deviceId = this.getDeviceId();
      const deviceName = this.getDeviceName();
      const user = await API.post('/api/auth/login', { username, password, deviceId, deviceName });
      AppState.set('user', user);
      EventBus.emit('toast:show', { message: `Selamat datang kembali, ${user.username}!`, type: 'success' });
      Router.navigate(user.redirect || (user.role === 'admin' ? '/dashboard' : '/select-workspace'));
      return user;
    } catch (err) {
      EventBus.emit('toast:show', { message: err.message, type: 'danger' });
      throw err;
    }
  }

  // ID perangkat stabil (per browser), dipakai untuk dedupe 1 perangkat = 1 sesi
  getDeviceId() {
    const key = 'eyeco_device_id';
    let id = '';
    try { id = localStorage.getItem(key) || ''; } catch (_) {}
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(key, id); } catch (_) {}
    }
    return id;
  }

  getDeviceName() {
    const nav = navigator?.userAgent || '';
    const os = /Windows/i.test(nav) ? 'Windows' : /Macintosh|Mac OS/i.test(nav) ? 'MacOS' : /Android/i.test(nav) ? 'Android' : /Linux/i.test(nav) ? 'Linux' : /iPhone|iPad/i.test(nav) ? 'iOS' : 'Perangkat';
    const browser = /Chrome/i.test(nav) && !/Edg/i.test(nav) ? 'Chrome' : /Firefox/i.test(nav) ? 'Firefox' : /Edg/i.test(nav) ? 'Edge' : /Safari/i.test(nav) ? 'Safari' : '';
    return [os, browser].filter(Boolean).join(' ');
  }

  // Keluar Akun
  async logout() {
    try {
      await API.post('/api/auth/logout');
      AppState.reset();
      EventBus.emit('toast:show', { message: 'Berhasil keluar akun.', type: 'success' });
      window.location.href = '/login';
    } catch (err) {
      EventBus.emit('toast:show', { message: 'Gagal keluar sesi.', type: 'danger' });
    }
  }
}

export const AuthService = new AuthServiceClass();
