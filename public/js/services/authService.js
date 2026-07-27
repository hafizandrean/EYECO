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
      const user = await API.post('/api/auth/login', { username, password });
      AppState.set('user', user);
      EventBus.emit('toast:show', { message: `Selamat datang kembali, ${user.username}!`, type: 'success' });
      Router.navigate(user.redirect || (user.role === 'admin' ? '/dashboard' : '/select-workspace'));
      return user;
    } catch (err) {
      EventBus.emit('toast:show', { message: err.message, type: 'danger' });
      throw err;
    }
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
