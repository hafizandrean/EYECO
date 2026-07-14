// profile.js — Halaman Profil User
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';

const Profile = {
  viewport: null,

  // State
  user: null,
  isLoading: false,

  async render(viewport) {
    this.viewport = viewport;
    this.user = AppState.get('user');
    if (!this.user) {
      viewport.innerHTML = '<div class="empty-state"><i data-lucide="alert-circle"></i><h3>Data tidak tersedia</h3><p>Silakan login kembali.</p></div>';
      return;
    }
    this.renderProfile();
  },

  renderProfile() {
    const u = this.user;
    const initials = u.username ? u.username.substring(0, 2).toUpperCase() : '??';
    this.viewport.innerHTML = `
      <div class="profile-page-container">
        <!-- Profile Header Card -->
        <div class="glass-card profile-header-card">
          <div class="profile-avatar-large">
            <span>${initials}</span>
          </div>
          <div class="profile-header-info">
            <h2>${this.escapeHtml(u.name || u.username)}</h2>
            <div class="profile-username">@${this.escapeHtml(u.username)}</div>
            <div class="profile-badges">
              <span class="badge badge-blue">${this.escapeHtml(u.role || 'USER')}</span>
              <span class="badge ${u.status === 'APPROVED' ? 'badge-green' : 'badge-orange'}">${this.escapeHtml(u.status || 'PENDING')}</span>
            </div>
          </div>
        </div>

        <!-- Account Info Card -->
        <div class="glass-card profile-info-card">
          <h3><i data-lucide="user"></i> Informasi Akun</h3>
          <div class="profile-info-grid">
            <div class="profile-info-item">
              <span class="profile-info-label">Nama Lengkap</span>
              <span class="profile-info-value">${this.escapeHtml(u.name || '—')}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Username</span>
              <span class="profile-info-value">${this.escapeHtml(u.username)}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Email</span>
              <span class="profile-info-value">${this.escapeHtml(u.email || '—')}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Role</span>
              <span class="profile-info-value"><span class="badge badge-blue">${this.escapeHtml(u.role || '—')}</span></span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Status Akun</span>
              <span class="profile-info-value"><span class="badge ${u.status === 'APPROVED' ? 'badge-green' : 'badge-orange'}">${this.escapeHtml(u.status || '—')}</span></span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">ID Akun</span>
              <span class="profile-info-value mono">${this.escapeHtml(u.id || u._id || '—')}</span>
            </div>
          </div>
        </div>

        <!-- Security Card -->
        <div class="glass-card profile-security-card">
          <h3><i data-lucide="shield"></i> Keamanan</h3>
          <div class="profile-security-actions">
            <button class="btn-outline" id="btn-edit-profile">
              <i data-lucide="edit"></i> Edit Profil
            </button>
            <button class="btn-outline" id="btn-change-password">
              <i data-lucide="key-round"></i> Ganti Password
            </button>
            <button class="btn-danger" id="btn-logout-profile">
              <i data-lucide="log-out"></i> Keluar
            </button>
          </div>
        </div>

        <div class="profile-back-link">
          <a href="/dashboard" class="btn-ghost btn"><i data-lucide="arrow-left"></i> Kembali ke Beranda</a>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    // Bind events
    document.getElementById('btn-change-password')?.addEventListener('click', () => {
      alert('Fitur ganti password akan tersedia segera.');
    });
    document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
      alert('Fitur edit profil akan tersedia segera.');
    });
    document.getElementById('btn-logout-profile')?.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      window.location.href = '/logout';
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  destroy() {
    this.viewport = null;
  }
};

export { Profile };
