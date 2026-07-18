// berita-admin.js — Manajemen Berita untuk Admin
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { EventBus } from '../core/eventBus.js';

class BeritaAdminPage {
  constructor() {
    this.news = [];
    this.editingId = null;
  }

  async render(container) {
    container.innerHTML = `
      <div style="max-width:1000px;margin:0 auto;padding:24px 0;">
        <div class="section-row-header" style="margin-bottom:24px;">
          <div>
            <h2 style="font-family:'Outfit',sans-serif;font-size:1.4rem;font-weight:800;color:#0F172A;margin:0;">
              <i data-lucide="newspaper" style="width:22px;height:22px;color:#2563EB;vertical-align:middle;margin-right:8px;"></i>
              Manajemen Berita
            </h2>
            <p style="font-size:0.85rem;color:#64748B;margin:4px 0 0;">Kelola berita dan informasi untuk landing page.</p>
          </div>
          <button class="btn-primary btn-sm" id="btn-news-create">
            <i data-lucide="plus"></i> Buat Berita Baru
          </button>
        </div>

        <!-- News List -->
        <div class="glass-card" style="border-radius:16px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead>
              <tr style="background:rgba(37,99,235,0.03);">
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Judul</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Kategori</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Status</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Penulis</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Tgl Dibuat</th>
                <th style="padding:12px 20px;text-align:right;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Aksi</th>
              </tr>
            </thead>
            <tbody id="news-admin-table">
              <tr><td colspan="6" style="padding:40px;text-align:center;color:#94A3B8;">
                <i data-lucide="loader" class="spin"></i> Memuat data...
              </td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal Create / Edit -->
      <div class="modal-overlay" id="modal-news-form" style="display:none;">
        <div class="modal" style="max-width:560px;">
          <div class="modal-header">
            <h2 style="font-size:1.2rem;font-weight:700;font-family:'Outfit',sans-serif;">
              <i data-lucide="newspaper" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"></i>
              <span id="modal-news-title">Buat Berita Baru</span>
            </h2>
            <button class="close-btn" id="modal-news-close"><i data-lucide="x"></i></button>
          </div>
          <form id="form-news" style="padding:20px 24px;display:flex;flex-direction:column;gap:14px;">
            <input type="hidden" id="news-id">
            <div class="form-group" style="margin:0;">
              <label>Judul Berita <span style="color:var(--error)">*</span></label>
              <input type="text" id="news-title" class="input-control" required placeholder="Contoh: Program Kerja Bakti Sungai 2026">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group" style="margin:0;">
                <label>Kategori</label>
                <select id="news-category" class="input-control">
                  <option value="Informasi">Informasi</option>
                  <option value="Tips">Tips</option>
                  <option value="Pengumuman">Pengumuman</option>
                  <option value="Berita">Berita</option>
                </select>
              </div>
              <div class="form-group" style="margin:0;">
                <label>Status</label>
                <select id="news-status" class="input-control">
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin:0;">
              <label>Ringkasan <span style="color:var(--error)">*</span></label>
              <textarea id="news-summary" class="input-control" rows="2" required placeholder="Ringkasan singkat berita..."></textarea>
            </div>
            <div class="form-group" style="margin:0;">
              <label>Konten <span style="color:var(--error)">*</span></label>
              <textarea id="news-content" class="input-control" rows="5" required placeholder="Isi berita lengkap..."></textarea>
            </div>
            <div class="form-group" style="margin:0;">
              <label>Thumbnail Gambar</label>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input type="file" id="news-thumbnail-file" class="input-control" accept="image/jpeg,image/png,image/webp" style="flex:1;padding:8px 12px;">
                <button type="button" class="btn btn-glass btn-sm" id="btn-news-upload-thumb" style="white-space:nowrap;">
                  <i data-lucide="upload" style="width:14px;height:14px;"></i> Upload
                </button>
              </div>
              <div id="news-thumbnail-preview" style="margin-top:8px;display:none;">
                <img src="" alt="preview" style="max-width:200px;max-height:100px;border-radius:8px;object-fit:cover;">
                <button type="button" id="btn-news-thumb-remove" style="background:none;border:none;color:var(--error);font-size:0.75rem;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;">
                  <i data-lucide="x" style="width:12px;height:12px;"></i> Hapus
                </button>
              </div>
              <input type="hidden" id="news-thumbnail" value="">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px;">
              <button type="button" class="btn btn-glass" id="btn-news-cancel">Batal</button>
              <button type="submit" class="btn-primary" id="btn-news-submit">
                <i data-lucide="save"></i> <span id="btn-news-text">Simpan Berita</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindEvents();
    await this.loadNews();
  }

  bindEvents() {
    document.getElementById('btn-news-create')?.addEventListener('click', () => this.openForm());
    document.getElementById('btn-news-cancel')?.addEventListener('click', () => this.closeForm());
    document.getElementById('modal-news-close')?.addEventListener('click', () => this.closeForm());
    document.getElementById('form-news')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveNews();
    });
    // Upload thumbnail
    document.getElementById('btn-news-upload-thumb')?.addEventListener('click', () => this.uploadThumbnail());
    document.getElementById('btn-news-thumb-remove')?.addEventListener('click', () => this.removeThumbnail());
    // Close modal on overlay click
    document.getElementById('modal-news-form')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeForm();
    });
  }

  async loadNews() {
    const tbody = document.getElementById('news-admin-table');
    if (!tbody) return;
    try {
      const res = await fetch('/api/news/list', { credentials: 'include' });
      const data = await res.json();
      this.news = data.news || [];
      tbody.innerHTML = '';

      if (this.news.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:#94A3B8;">
          <i data-lucide="newspaper" style="width:32px;height:32px;opacity:0.3;margin-bottom:8px;display:block;margin-inline:auto;"></i>
          Belum ada berita. Klik "Buat Berita Baru" untuk memulai.
        </td></tr>`;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      this.news.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.transition = 'background 0.15s';
        tr.innerHTML = `
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);font-weight:600;color:#0F172A;">${item.title}</td>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);">
            <span style="font-size:0.72rem;background:rgba(37,99,235,0.06);color:#2563EB;padding:2px 10px;border-radius:20px;font-weight:600;">${item.category}</span>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);">
            <span style="font-size:0.72rem;font-weight:700;padding:2px 10px;border-radius:20px;${
              item.status === 'published' 
                ? 'background:rgba(16,185,129,0.08);color:#10B981;' 
                : 'background:rgba(245,158,11,0.08);color:#F59E0B;'
            }">${item.status === 'published' ? 'Published' : 'Draft'}</span>
          </td>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);color:#64748B;">${item.author}</td>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);color:#94A3B8;font-size:0.8rem;">${new Date(item.createdAt).toLocaleDateString('id-ID')}</td>
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);text-align:right;">
            <div class="action-row" style="display:flex;gap:6px;justify-content:flex-end;">
              <button class="btn-icon btn-news-edit" data-id="${item._id}" title="Edit">
                <i data-lucide="pencil" style="width:14px;height:14px;"></i>
              </button>
              <button class="btn-icon btn-news-delete" data-id="${item._id}" title="Hapus" style="color:var(--error);">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind edit/delete buttons
      document.querySelectorAll('.btn-news-edit').forEach(btn => {
        btn.addEventListener('click', () => this.openForm(btn.getAttribute('data-id')));
      });
      document.querySelectorAll('.btn-news-delete').forEach(btn => {
        btn.addEventListener('click', () => this.deleteNews(btn.getAttribute('data-id')));
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--error);">Gagal memuat berita.</td></tr>`;
    }
  }

  async openForm(id = null) {
    this.editingId = id;
    document.getElementById('modal-news-title').textContent = id ? 'Edit Berita' : 'Buat Berita Baru';
    document.getElementById('btn-news-text').textContent = id ? 'Update Berita' : 'Simpan Berita';
    document.getElementById('modal-news-form').style.display = 'flex';

    document.getElementById('news-id').value = '';
    document.getElementById('news-title').value = '';
    document.getElementById('news-category').value = 'Informasi';
    document.getElementById('news-status').value = 'published';
    document.getElementById('news-summary').value = '';
    document.getElementById('news-content').value = '';
    document.getElementById('news-thumbnail').value = '';

    // Reset thumbnail preview
    const preview = document.getElementById('news-thumbnail-preview');
    if (preview) preview.style.display = 'none';

    if (id) {
      try {
        const res = await fetch(`/api/news/${id}`, { credentials: 'include' });
        const data = await res.json();
        if (data.news) {
          document.getElementById('news-id').value = data.news._id;
          document.getElementById('news-title').value = data.news.title;
          document.getElementById('news-category').value = data.news.category;
          document.getElementById('news-status').value = data.news.status;
          document.getElementById('news-summary').value = data.news.summary;
          document.getElementById('news-content').value = data.news.content;
          document.getElementById('news-thumbnail').value = data.news.thumbnail || '';
          // Show thumbnail preview jika ada
          if (data.news.thumbnail) {
            const preview = document.getElementById('news-thumbnail-preview');
            const img = preview?.querySelector('img');
            if (preview && img) {
              img.src = data.news.thumbnail;
              preview.style.display = 'block';
            }
          }
        }
      } catch (_) {
        EventBus.emit('toast:show', { message: 'Gagal memuat data berita', type: 'danger' });
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  closeForm() {
    document.getElementById('modal-news-form').style.display = 'none';
    this.editingId = null;
  }

  async saveNews() {
    const id = document.getElementById('news-id').value;
    const data = {
      title: document.getElementById('news-title').value,
      category: document.getElementById('news-category').value,
      status: document.getElementById('news-status').value,
      summary: document.getElementById('news-summary').value,
      content: document.getElementById('news-content').value,
      thumbnail: document.getElementById('news-thumbnail').value,
    };

    try {
      const url = id ? `/api/news/${id}` : '/api/news/create';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.success) {
        EventBus.emit('toast:show', { message: `Berita berhasil ${id ? 'diupdate' : 'dibuat'}.`, type: 'success' });
        this.closeForm();
        await this.loadNews();
      } else {
        EventBus.emit('toast:show', { message: result.error || 'Gagal menyimpan berita', type: 'danger' });
      }
    } catch (_) {
      EventBus.emit('toast:show', { message: 'Gagal terhubung ke server.', type: 'danger' });
    }
  }

  async deleteNews(id) {
    if (!confirm('Hapus berita ini? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      const res = await fetch(`/api/news/${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        EventBus.emit('toast:show', { message: 'Berita berhasil dihapus.', type: 'success' });
        await this.loadNews();
      } else {
        EventBus.emit('toast:show', { message: data.error || 'Gagal menghapus', type: 'danger' });
      }
    } catch (_) {
      EventBus.emit('toast:show', { message: 'Gagal terhubung ke server.', type: 'danger' });
    }
  }

  async uploadThumbnail() {
    const fileInput = document.getElementById('news-thumbnail-file');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      EventBus.emit('toast:show', { message: 'Pilih file gambar terlebih dahulu.', type: 'warning' });
      return;
    }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    try {
      const res = await fetch('/api/news/upload-thumbnail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('news-thumbnail').value = data.url;
        const preview = document.getElementById('news-thumbnail-preview');
        const img = preview?.querySelector('img');
        if (preview && img) {
          img.src = data.url;
          preview.style.display = 'block';
        }
        EventBus.emit('toast:show', { message: 'Thumbnail berhasil diupload.', type: 'success' });
      } else {
        EventBus.emit('toast:show', { message: data.error || 'Gagal upload.', type: 'danger' });
      }
    } catch (_) {
      EventBus.emit('toast:show', { message: 'Gagal terhubung ke server.', type: 'danger' });
    }
  }

  removeThumbnail() {
    document.getElementById('news-thumbnail').value = '';
    document.getElementById('news-thumbnail-file').value = '';
    const preview = document.getElementById('news-thumbnail-preview');
    if (preview) preview.style.display = 'none';
  }

  destroy() {}
}

export const BeritaAdmin = new BeritaAdminPage();
