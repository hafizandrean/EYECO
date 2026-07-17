// profile.js — Halaman Profil & Pengaturan Akun
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { EventBus } from '../core/eventBus.js';

const Profile = {
  viewport: null,
  user: null,

  async render(viewport) {
    this.viewport = viewport;
    this.user = AppState.get('user');
    if (!this.user) {
      viewport.innerHTML = '<div class="empty-state"><i data-lucide="alert-circle"></i><h3>Data tidak tersedia</h3><p>Silakan login kembali.</p></div>';
      return;
    }
    this.renderProfile();
    await this.loadSessions();
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  renderProfile() {
    const u = this.user;
    const initials = u.username ? u.username.substring(0, 2).toUpperCase() : '??';
    const isDark = document.body.classList.contains('dark-mode');

    this.viewport.innerHTML = `
      <div class="profile-page-container">
        <!-- Tombol Kembali -->
        <div class="profile-back-link" style="margin-bottom: 20px;">
          <button class="btn btn-glass btn-rounded btn-back-route" id="btn-profile-back" style="padding: 10px 20px; font-weight:700;">
            <i data-lucide="arrow-left" style="width:16px;height:16px;margin-right:4px;"></i> Kembali
          </button>
        </div>

        <!-- Profile Header Card -->
        <div class="glass-card profile-header-card">
          <div class="profile-avatar-large" id="avatar-upload-trigger" style="cursor:pointer; position:relative;" title="Klik untuk ganti foto profil">
            ${u.avatar
              ? `<img src="${u.avatar}" alt="Foto Profil" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
              : `<span>${initials}</span>`
            }
            <div class="avatar-edit-badge" style="position:absolute;bottom:0;right:0;background:var(--primary);color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg-app);box-shadow:0 2px 6px rgba(0,0,0,0.15);">
              <i data-lucide="camera" style="width:14px;height:14px;"></i>
            </div>
          </div>
          <div class="profile-header-info">
            <h2>${this.escapeHtml(u.name || u.username)}</h2>
            <div class="profile-username">@${this.escapeHtml(u.username)}</div>
            <div class="profile-badges">
              <span class="badge badge-blue">${this.escapeHtml(u.role || 'USER')}</span>
              <span class="badge ${u.status === 'APPROVED' ? 'badge-green' : 'badge-orange'}"}>${this.escapeHtml(u.status || 'PENDING')}</span>
            </div>
          </div>
        </div>

        <!-- Hidden file input for avatar upload -->
        <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;">

        <!-- Avatar Upload Modal (Camera / Galeri) -->
        <div class="modal-overlay" id="modal-avatar-upload" style="display:none;">
          <div class="glass-card modal-container" style="max-width:400px;">
            <div class="modal-header">
              <h3><i data-lucide="camera"></i> Foto Profil</h3>
              <button class="btn-close-modal" id="btn-close-avatar-modal">&times;</button>
            </div>
            <div class="modal-body" style="text-align:center;">
              <div id="avatar-preview-container" style="width:160px;height:160px;border-radius:50%;margin:0 auto 20px;overflow:hidden;background:var(--bg-card);display:flex;align-items:center;justify-content:center;">
                ${u.avatar
                  ? `<img src="${u.avatar}" id="avatar-preview-img" style="width:100%;height:100%;object-fit:cover;">`
                  : `<span id="avatar-preview-initials" style="font-size:3rem;font-weight:800;color:var(--text-muted);">${initials}</span>`
                }
                <img id="avatar-preview-new" style="display:none;width:100%;height:100%;object-fit:cover;">
              </div>
              <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                <button class="btn btn-glass btn-rounded" id="btn-avatar-gallery" style="flex:1;min-width:120px;">
                  <i data-lucide="image"></i> Galeri
                </button>
                <button class="btn btn-glass btn-rounded" id="btn-avatar-camera" style="flex:1;min-width:120px;">
                  <i data-lucide="camera"></i> Kamera
                </button>
              </div>
              ${u.avatar ? `
              <button class="btn btn-glass btn-rounded" id="btn-avatar-remove" style="width:100%;margin-top:8px;color:var(--danger);border-color:rgba(239,68,68,0.2);">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus Foto
              </button>
              ` : ''}
              <button class="btn btn-primary btn-rounded" id="btn-avatar-save" style="width:100%;margin-top:16px;display:none;">
                <i data-lucide="check"></i> Simpan Foto
              </button>
              <div id="avatar-upload-status" style="margin-top:12px;font-size:0.82rem;color:var(--text-muted);display:none;"></div>
            </div>
          </div>
        </div>

        <!-- Informasi Akun Card -->
        <div class="glass-card profile-info-card">
          <h3><i data-lucide="user"></i> Informasi Akun</h3>
          <div class="profile-info-grid">
            <div class="profile-info-item">
              <span class="profile-info-label">Nama Lengkap</span>
              <span class="profile-info-value" id="p-name">${this.escapeHtml(u.name || '—')}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Username</span>
              <span class="profile-info-value">${this.escapeHtml(u.username)}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Email</span>
              <span class="profile-info-value" id="p-email">${this.escapeHtml(u.email || '—')}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Nomor Telepon</span>
              <span class="profile-info-value" id="p-phone">${this.escapeHtml(u.phone || '—')}</span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Role</span>
              <span class="profile-info-value"><span class="badge badge-blue">${this.escapeHtml(u.role || '—')}</span></span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">Status Akun</span>
              <span class="profile-info-value">
                <span class="badge ${u.status === 'APPROVED' ? 'badge-green' : 'badge-orange'}">${this.escapeHtml(u.status || '—')}</span>
                <span style="font-size:0.7rem;color:var(--text-muted);margin-left:6px;">
                  ${u.status === 'APPROVED' ? 'Akun aktif dan terverifikasi' : u.status === 'PENDING' ? 'Menunggu verifikasi admin' : 'Akun ditolak'}
                </span>
              </span>
            </div>
            <div class="profile-info-item">
              <span class="profile-info-label">ID Akun</span>
              <span class="profile-info-value mono">${this.escapeHtml(String(u.id || u._id || '—'))}</span>
            </div>
          </div>
        </div>

        <!-- Keamanan & Tindakan Card -->
        <div class="glass-card profile-security-card">
          <h3><i data-lucide="shield"></i> Keamanan & Pengaturan</h3>
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

        <!-- Riwayat Sesi Login -->
        <div class="glass-card profile-sessions-card">
          <h3><i data-lucide="monitor"></i> Sesi Login Aktif</h3>
          <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 16px 0;">
            Kelola perangkat yang terhubung ke akun Anda. Logout dari perangkat yang tidak dikenal.
          </p>
          <div id="sessions-list">
            <div style="padding: 20px; text-align: center; color: var(--text-muted);">
              <i data-lucide="loader" style="width:20px;height:20px;"></i> Memuat sesi...
            </div>
          </div>
          <div style="margin-top:12px;">
            <button class="btn btn-sm btn-glass" id="btn-logout-all-sessions" style="color:var(--danger);border-color:rgba(239,68,68,0.2);">
              <i data-lucide="log-out" style="width:14px;height:14px;"></i> Logout dari semua perangkat lain
            </button>
          </div>
        </div>
      </div>

      <!-- Modal Edit Profil -->
      <div class="modal-overlay" id="modal-edit-profile" style="display:none;">
        <div class="glass-card modal-container" style="max-width:480px;">
          <div class="modal-header">
            <h3><i data-lucide="edit"></i> Edit Profil</h3>
            <button class="btn-close-modal" id="btn-close-edit-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="form-edit-profile">
              <div class="form-group">
                <label class="form-label">Nama Lengkap</label>
                <input type="text" id="edit-name" class="filter-control input-rounded" value="${this.escapeHtml(u.name || '')}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Email</label>
                <input type="email" id="edit-email" class="filter-control input-rounded" value="${this.escapeHtml(u.email || '')}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Nomor Telepon</label>
                <input type="tel" id="edit-phone" class="filter-control input-rounded" value="${this.escapeHtml(u.phone || '')}" placeholder="08XXXXXXXXXX">
              </div>
              <div class="modal-actions-row" style="margin-top:24px;">
                <button type="button" class="btn btn-glass btn-rounded" id="btn-cancel-edit" style="flex:1;">Batal</button>
                <button type="submit" class="btn btn-primary btn-rounded" id="btn-save-edit" style="flex:1;">
                  <i data-lucide="save"></i> Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal Ganti Password -->
      <div class="modal-overlay" id="modal-change-password" style="display:none;">
        <div class="glass-card modal-container" style="max-width:480px;">
          <div class="modal-header">
            <h3><i data-lucide="key-round"></i> Ganti Password</h3>
            <button class="btn-close-modal" id="btn-close-password-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="form-change-password">
              <div class="form-group">
                <label class="form-label">Password Saat Ini</label>
                <div style="position:relative;">
                  <input type="password" id="cp-current" class="filter-control input-rounded" required autocomplete="current-password" style="padding-right:40px;">
                  <button type="button" class="toggle-password-btn" data-target="cp-current" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
                    <i data-lucide="eye" style="width:16px;height:16px;"></i>
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Password Baru</label>
                <div style="position:relative;">
                  <input type="password" id="cp-new" class="filter-control input-rounded" required minlength="6" autocomplete="new-password" style="padding-right:40px;">
                  <button type="button" class="toggle-password-btn" data-target="cp-new" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
                    <i data-lucide="eye" style="width:16px;height:16px;"></i>
                  </button>
                </div>
                <div class="password-strength" id="password-strength" style="margin-top:6px;display:flex;gap:4px;">
                  <div class="strength-bar" style="height:3px;flex:1;border-radius:2px;background:var(--border);"></div>
                  <div class="strength-bar" style="height:3px;flex:1;border-radius:2px;background:var(--border);"></div>
                  <div class="strength-bar" style="height:3px;flex:1;border-radius:2px;background:var(--border);"></div>
                </div>
                <small style="color:var(--text-muted);font-size:0.68rem;">Minimal 6 karakter, gunakan kombinasi huruf dan angka untuk keamanan lebih.</small>
              </div>
              <div class="form-group">
                <label class="form-label">Konfirmasi Password Baru</label>
                <div style="position:relative;">
                  <input type="password" id="cp-confirm" class="filter-control input-rounded" required autocomplete="new-password" style="padding-right:40px;">
                  <button type="button" class="toggle-password-btn" data-target="cp-confirm" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;">
                    <i data-lucide="eye" style="width:16px;height:16px;"></i>
                  </button>
                </div>
              </div>
              <div class="modal-actions-row" style="margin-top:24px;">
                <button type="button" class="btn btn-glass btn-rounded" id="btn-cancel-password" style="flex:1;">Batal</button>
                <button type="submit" class="btn btn-primary btn-rounded" id="btn-save-password" style="flex:1;">
                  <i data-lucide="shield"></i> Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('btn-profile-back')?.addEventListener('click', () => {
      const user = AppState.get('user');
      Router.navigate(user?.role === 'admin' ? '/dashboard' : '/dashboard');
    });

    document.getElementById('btn-change-password')?.addEventListener('click', () => {
      document.getElementById('modal-change-password').style.display = 'flex';
    });

    document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
      document.getElementById('modal-edit-profile').style.display = 'flex';
    });

    document.getElementById('btn-close-password-modal')?.addEventListener('click', () => {
      document.getElementById('modal-change-password').style.display = 'none';
    });

    document.getElementById('btn-cancel-password')?.addEventListener('click', () => {
      document.getElementById('modal-change-password').style.display = 'none';
    });

    document.getElementById('btn-close-edit-modal')?.addEventListener('click', () => {
      document.getElementById('modal-edit-profile').style.display = 'none';
    });

    document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
      document.getElementById('modal-edit-profile').style.display = 'none';
    });

    // Toggle password visibility
    document.querySelectorAll('.toggle-password-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (input) {
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          btn.innerHTML = isPassword
            ? '<i data-lucide="eye-off" style="width:16px;height:16px;"></i>'
            : '<i data-lucide="eye" style="width:16px;height:16px;"></i>';
          if (window.lucide) lucide.createIcons();
        }
      });
    });

    // Password strength indicator
    const newPw = document.getElementById('cp-new');
    if (newPw) {
      newPw.addEventListener('input', () => {
        const val = newPw.value;
        const bars = document.querySelectorAll('#password-strength .strength-bar');
        let score = 0;
        if (val.length >= 6) score++;
        if (val.length >= 10) score++;
        if (/[A-Z]/.test(val) && /[a-z]/.test(val) && /[0-9]/.test(val)) score++;
        if (/[^A-Za-z0-9]/.test(val)) score++;

        const colors = ['var(--border)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--primary)'];
        bars.forEach((bar, i) => {
          bar.style.background = i < score ? colors[score] : 'var(--border)';
        });
      });
    }

    // Submit Edit Profile
    document.getElementById('form-edit-profile')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-edit');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;"></i> Menyimpan...';
      if (window.lucide) lucide.createIcons();

      try {
        const res = await fetch('/api/auth/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: document.getElementById('edit-name').value.trim(),
            email: document.getElementById('edit-email').value.trim(),
            phone: document.getElementById('edit-phone').value.trim()
          })
        });
        const result = await res.json();
        if (result.success) {
          EventBus.emit('toast:show', { message: 'Profil berhasil diperbarui!', type: 'success' });
          document.getElementById('modal-edit-profile').style.display = 'none';
          // Update display
          document.getElementById('p-name').textContent = result.data.name || '—';
          document.getElementById('p-email').textContent = result.data.email || '—';
          document.getElementById('p-phone').textContent = result.data.phone || '—';
          // Update AppState
          const user = AppState.get('user');
          user.name = result.data.name;
          user.email = result.data.email;
          user.phone = result.data.phone;
          AppState.set('user', user);
        } else {
          EventBus.emit('toast:show', { message: result.error || 'Gagal memperbarui profil', type: 'danger' });
        }
      } catch (err) {
        EventBus.emit('toast:show', { message: 'Gagal menyimpan perubahan', type: 'danger' });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save"></i> Simpan';
        if (window.lucide) lucide.createIcons();
      }
    });

    // Submit Change Password
    document.getElementById('form-change-password')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPw = document.getElementById('cp-current').value;
      const newPw = document.getElementById('cp-new').value;
      const confirmPw = document.getElementById('cp-confirm').value;

      if (newPw !== confirmPw) {
        EventBus.emit('toast:show', { message: 'Konfirmasi password baru tidak cocok', type: 'danger' });
        return;
      }
      if (newPw.length < 6) {
        EventBus.emit('toast:show', { message: 'Password minimal 6 karakter', type: 'danger' });
        return;
      }

      const btn = document.getElementById('btn-save-password');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;"></i> Memproses...';
      if (window.lucide) lucide.createIcons();

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw, confirmPassword: confirmPw })
        });
        const result = await res.json();
        if (result.success) {
          EventBus.emit('toast:show', { message: 'Password berhasil diubah!', type: 'success' });
          document.getElementById('modal-change-password').style.display = 'none';
          document.getElementById('form-change-password').reset();
        } else {
          EventBus.emit('toast:show', { message: result.error || 'Gagal mengubah password', type: 'danger' });
        }
      } catch (err) {
        EventBus.emit('toast:show', { message: 'Gagal mengubah password', type: 'danger' });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="shield"></i> Update Password';
        if (window.lucide) lucide.createIcons();
      }
    });

    // Logout
    document.getElementById('btn-logout-profile')?.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      window.location.href = '/logout';
    });

    // Logout all other sessions
    document.getElementById('btn-logout-all-sessions')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/auth/sessions', { method: 'DELETE', credentials: 'include' });
        const result = await res.json();
        if (result.success) {
          EventBus.emit('toast:show', { message: 'Semua sesi lain telah dihapus!', type: 'success' });
          await this.loadSessions();
        }
      } catch (err) {
        EventBus.emit('toast:show', { message: 'Gagal menghapus sesi', type: 'danger' });
      }
    });

    // Avatar upload handlers
    const avatarTrigger = document.getElementById('avatar-upload-trigger');
    const fileInput = document.getElementById('avatar-file-input');
    const modal = document.getElementById('modal-avatar-upload');

    if (avatarTrigger) {
      avatarTrigger.addEventListener('click', () => {
        modal.style.display = 'flex';
      });
    }

    document.getElementById('btn-close-avatar-modal')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // Galeri: buka file picker
    document.getElementById('btn-avatar-gallery')?.addEventListener('click', () => {
      fileInput.removeAttribute('capture');
      fileInput.click();
    });

    // Kamera: buka kamera langsung
    document.getElementById('btn-avatar-camera')?.addEventListener('click', () => {
      fileInput.setAttribute('capture', 'environment');
      fileInput.click();
    });

    // Preview file yang dipilih
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
          const previewNew = document.getElementById('avatar-preview-new');
          const previewImg = document.getElementById('avatar-preview-img');
          const previewInitials = document.getElementById('avatar-preview-initials');
          if (previewNew) {
            previewNew.src = ev.target.result;
            previewNew.style.display = 'block';
          }
          if (previewImg) previewImg.style.display = 'none';
          if (previewInitials) previewInitials.style.display = 'none';

          document.getElementById('btn-avatar-save').style.display = 'block';
          document.getElementById('avatar-upload-status').style.display = 'none';
        };
        reader.readAsDataURL(file);
      });
    }

    // Upload avatar
    document.getElementById('btn-avatar-save')?.addEventListener('click', async () => {
      const file = fileInput?.files?.[0];
      if (!file) return;

      const btn = document.getElementById('btn-avatar-save');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;"></i> Mengupload...';
      if (window.lucide) lucide.createIcons();

      const status = document.getElementById('avatar-upload-status');
      status.style.display = 'block';
      status.style.color = 'var(--text-muted)';
      status.textContent = 'Mengupload...';

      try {
        const formData = new FormData();
        formData.append('avatar', file);

        const res = await fetch('/api/auth/avatar', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        const result = await res.json();

        if (result.success) {
          status.style.color = 'var(--success)';
          status.textContent = 'Foto profil berhasil disimpan!';
          btn.style.display = 'none';

          // Update avatar di seluruh halaman
          const avatarUrl = result.data.avatar;
          const user = AppState.get('user');
          user.avatar = avatarUrl;
          AppState.set('user', user);

          // Update tampilan avatar di header card
          const avatarContainer = document.querySelector('.profile-avatar-large');
          if (avatarContainer) {
            avatarContainer.innerHTML = `
              <img src="${avatarUrl}" alt="Foto Profil" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">
              <div class="avatar-edit-badge" style="position:absolute;bottom:0;right:0;background:var(--primary);color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg-app);box-shadow:0 2px 6px rgba(0,0,0,0.15);">
                <i data-lucide="camera" style="width:14px;height:14px;"></i>
              </div>
            `;
            if (window.lucide) lucide.createIcons();
          }

          // Update preview di modal
          const previewNew = document.getElementById('avatar-preview-new');
          if (previewNew) {
            previewNew.src = avatarUrl;
          }

          setTimeout(() => {
            modal.style.display = 'none';
            // Reset untuk next upload
            fileInput.value = '';
            btn.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="check"></i> Simpan Foto';
            if (window.lucide) lucide.createIcons();
            status.style.display = 'none';
          }, 1500);
        } else {
          status.style.color = 'var(--danger)';
          status.textContent = result.error || 'Gagal mengupload foto';
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="check"></i> Simpan Foto';
          if (window.lucide) lucide.createIcons();
        }
      } catch (err) {
        status.style.color = 'var(--danger)';
        const errorMsg = err instanceof Error ? err.message : 'Gagal terhubung ke server';
        status.textContent = errorMsg;
        console.error('[AVATAR UPLOAD ERROR]', err);
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check"></i> Simpan Foto';
        if (window.lucide) lucide.createIcons();
      }
    });

    // Remove avatar
    document.getElementById('btn-avatar-remove')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-avatar-remove');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;"></i> Menghapus...';
      if (window.lucide) lucide.createIcons();

      const status = document.getElementById('avatar-upload-status');
      status.style.display = 'block';
      status.style.color = 'var(--text-muted)';
      status.textContent = 'Menghapus foto...';

      try {
        const res = await fetch('/api/auth/avatar', {
          method: 'DELETE',
          credentials: 'include'
        });
        const result = await res.json();

        if (result.success) {
          status.style.color = 'var(--success)';
          status.textContent = 'Foto profil berhasil dihapus!';
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus Foto';
          if (window.lucide) lucide.createIcons();

          // Update state
          const user = AppState.get('user');
          user.avatar = '';
          AppState.set('user', user);

          // Update header avatar ke inisial
          const initials = user.username ? user.username.substring(0, 2).toUpperCase() : '??';
          const avatarContainer = document.querySelector('.profile-avatar-large');
          if (avatarContainer) {
            avatarContainer.innerHTML = `
              <span>${initials}</span>
              <div class="avatar-edit-badge" style="position:absolute;bottom:0;right:0;background:var(--primary);color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg-app);box-shadow:0 2px 6px rgba(0,0,0,0.15);">
                <i data-lucide="camera" style="width:14px;height:14px;"></i>
              </div>
            `;
            if (window.lucide) lucide.createIcons();
          }

          // Update modal preview
          const previewImg = document.getElementById('avatar-preview-img');
          const previewNew = document.getElementById('avatar-preview-new');
          const previewInitials = document.getElementById('avatar-preview-initials');
          if (previewImg) { previewImg.style.display = 'none'; previewImg.src = ''; }
          if (previewNew) { previewNew.style.display = 'none'; previewNew.src = ''; }
          if (previewInitials) {
            previewInitials.textContent = initials;
            previewInitials.style.display = 'block';
          }

          // Update state modal
          const saveBtn = document.getElementById('btn-avatar-save');
          if (saveBtn) saveBtn.style.display = 'none';
          fileInput.value = '';

          setTimeout(() => {
            modal.style.display = 'none';
            status.style.display = 'none';
          }, 1200);
        } else {
          status.style.color = 'var(--danger)';
          status.textContent = result.error || 'Gagal menghapus foto';
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus Foto';
          if (window.lucide) lucide.createIcons();
        }
      } catch (err) {
        status.style.color = 'var(--danger)';
        status.textContent = err instanceof Error ? err.message : 'Gagal terhubung ke server';
        console.error('[AVATAR REMOVE ERROR]', err);
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus Foto';
        if (window.lucide) lucide.createIcons();
      }
    });
  },

  async loadSessions() {
    const list = document.getElementById('sessions-list');
    if (!list) return;
    try {
      const res = await fetch('/api/auth/sessions', { credentials: 'include' });
      const result = await res.json();
      if (!result.success || !result.sessions) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">Tidak ada data sesi.</div>';
        return;
      }
      if (result.sessions.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">Tidak ada sesi aktif.</div>';
        return;
      }
      list.innerHTML = result.sessions.map(s => `
        <div class="session-item" style="display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid var(--border);font-size:0.82rem;">
          <div style="display:flex;align-items:center;gap:12px;">
            <i data-lucide="${s.isCurrent ? 'smartphone' : 'monitor'}" style="width:18px;height:18px;color:${s.isCurrent ? 'var(--success)' : 'var(--text-muted)'};"></i>
            <div>
              <div style="font-weight:700;color:var(--text-primary);">${s.isCurrent ? 'Perangkat Saat Ini' : s.deviceInfo || 'Perangkat Tidak Dikenal'}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);">
                ${s.ipAddress || 'IP tidak diketahui'} · ${s.lastActive ? new Date(s.lastActive).toLocaleDateString('id-ID') : '—'}
              </div>
            </div>
          </div>
          ${s.isCurrent ? '<span class="badge badge-green">Aktif</span>' : `<button class="btn btn-sm btn-glass session-logout-btn" data-session-id="${s.id}" style="color:var(--danger);font-size:0.7rem;padding:4px 10px;">Logout</button>`}
        </div>
      `).join('');
      if (window.lucide) lucide.createIcons();

      // Bind session logout buttons
      list.querySelectorAll('.session-logout-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sessionId = btn.getAttribute('data-session-id');
          try {
            const res = await fetch(`/api/auth/sessions/${sessionId}`, { method: 'DELETE', credentials: 'include' });
            const result = await res.json();
            if (result.success) {
              EventBus.emit('toast:show', { message: 'Sesi berhasil dihapus', type: 'success' });
              await this.loadSessions();
            }
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal menghapus sesi', type: 'danger' });
          }
        });
      });
    } catch (err) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">Gagal memuat sesi.</div>';
    }
  },

  destroy() {
    this.viewport = null;
  }
};

export { Profile };
