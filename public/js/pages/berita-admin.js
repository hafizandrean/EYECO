// berita-admin.js — Manajemen Berita untuk Admin
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { EventBus } from '../core/eventBus.js';

class BeritaAdminPage {
  constructor() {
    this.news = [];
    this.editingId = null;
    this.uploadedImages = [];
    this.selectedThumbnail = '';
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

        <div class="glass-card" style="border-radius:16px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead>
              <tr style="background:rgba(37,99,235,0.03);">
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Judul</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Kategori</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Status</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Preview</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Penulis</th>
                <th style="padding:12px 20px;text-align:left;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Tgl Dibuat</th>
                <th style="padding:12px 20px;text-align:right;font-weight:700;color:#64748B;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid rgba(0,0,0,0.06);">Aksi</th>
              </tr>
            </thead>
            <tbody id="news-admin-table">
              <tr><td colspan="7" style="padding:40px;text-align:center;color:#94A3B8;">
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
              <input type="text" id="news-title" class="input-control" required placeholder="Contoh: Program Kerja Bakti Lingkungan 2026">
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
              <label>
                Gambar <span style="font-weight:400;color:#94A3B8;font-size:0.78rem;">(maks 3, auto-upload setelah pilih file)</span>
              </label>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input type="file" id="news-image-files" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple
                  style="flex:1;padding:8px 12px;font-size:0.82rem;">
                <span id="news-image-counter" style="font-size:0.78rem;color:#94A3B8;"></span>
              </div>
              <!-- Preview gallery -->
              <div id="news-image-previews" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;"></div>
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

      <!-- Preview Modal -->
      <div class="modal-overlay" id="modal-news-preview" style="display:none;z-index:10001;">
        <div class="modal" style="max-width:700px;padding:0;border-radius:20px;overflow:hidden;">
          <div class="modal-header" style="padding:12px 18px;">
            <h2 style="font-size:1rem;font-weight:700;font-family:'Outfit',sans-serif;">
              <i data-lucide="eye" style="width:16px;height:16px;vertical-align:middle;margin-right:6px;color:#2563EB;"></i>
              Preview Berita
            </h2>
            <button class="close-btn" id="preview-close"><i data-lucide="x"></i></button>
          </div>
          <div id="preview-content" style="padding:0 24px 24px;max-height:75vh;overflow-y:auto;"></div>
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

    // Auto-upload on file select — triggers immediately after user picks file(s)
    document.getElementById('news-image-files')?.addEventListener('change', (e) => {
      this.uploadSelectedFiles(e.target);
    });

    document.getElementById('modal-news-form')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeForm();
    });

    // Close preview
    document.getElementById('preview-close')?.addEventListener('click', () => {
      document.getElementById('modal-news-preview').style.display = 'none';
    });
    document.getElementById('modal-news-preview')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('modal-news-preview').style.display = 'none';
      }
    });
  }

  uploadSelectedFiles(input) {
    const files = input?.files;
    if (!files || files.length === 0) { input.value = ''; return; }

    const remaining = 3 - this.uploadedImages.length;
    if (files.length > remaining) {
      EventBus.emit('toast:show', { message: `Maksimal 3 gambar. Masih bisa upload ${remaining} lagi.`, type: 'warning' });
      input.value = '';
      return;
    }

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    fetch('/api/news/upload-images', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        data.urls.forEach(url => {
          this.uploadedImages.push(url);
          if (!this.selectedThumbnail) {
            this.selectedThumbnail = url;
          }
        });
        this.renderImagePreviews();
        EventBus.emit('toast:show', { message: `${data.urls.length} gambar berhasil diupload.`, type: 'success' });
      } else {
        EventBus.emit('toast:show', { message: data.error || 'Gagal upload.', type: 'danger' });
      }
    })
    .catch(() => {
      EventBus.emit('toast:show', { message: 'Gagal terhubung ke server.', type: 'danger' });
    })
    .finally(() => {
      input.value = ''; // reset so the same file(s) can be picked again
    });
  }

  renderImagePreviews() {
    const container = document.getElementById('news-image-previews');
    if (!container) return;

    const counter = document.getElementById('news-image-counter');
    if (counter) {
      counter.textContent = `${this.uploadedImages.length}/3`;
    }

    if (this.uploadedImages.length === 0) {
      container.innerHTML = '';
      document.getElementById('news-thumbnail').value = '';
      return;
    }

    container.innerHTML = this.uploadedImages.map(url => `
      <div class="news-img-preview ${this.selectedThumbnail === url ? 'is-thumbnail' : ''}"
           data-url="${url}"
           style="position:relative;width:100px;height:80px;border-radius:8px;overflow:hidden;border:2px solid ${this.selectedThumbnail === url ? '#2563EB' : 'rgba(0,0,0,0.06)'};cursor:pointer;transition:border 0.2s;">
        <img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">
        ${this.selectedThumbnail === url ? '<span style="position:absolute;top:4px;left:4px;background:#2563EB;color:#fff;font-size:0.6rem;font-weight:700;padding:1px 6px;border-radius:4px;">Thumbnail</span>' : ''}
        <button type="button" class="news-img-remove" data-url="${url}"
          style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(239,68,68,0.9);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;">&times;</button>
      </div>
    `).join('');

    container.querySelectorAll('.news-img-preview').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.news-img-remove')) return;
        this.selectedThumbnail = el.dataset.url;
        document.getElementById('news-thumbnail').value = this.selectedThumbnail;
        this.renderImagePreviews();
      });
    });

    container.querySelectorAll('.news-img-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        this.uploadedImages = this.uploadedImages.filter(u => u !== url);
        if (this.selectedThumbnail === url) {
          this.selectedThumbnail = this.uploadedImages[0] || '';
        }
        document.getElementById('news-thumbnail').value = this.selectedThumbnail;
        this.renderImagePreviews();
      });
    });

    document.getElementById('news-thumbnail').value = this.selectedThumbnail;
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
        tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:#94A3B8;">
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
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);font-weight:600;color:#0F172A;">
            <span style="display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;">${item.title}</span>
          </td>
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
          <td style="padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.04);">
            <button class="btn-icon btn-news-preview" data-id="${item._id}" title="Preview" style="color:#2563EB;">
              <i data-lucide="eye" style="width:14px;height:14px;"></i>
            </button>
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

      document.querySelectorAll('.btn-news-edit').forEach(btn => {
        btn.addEventListener('click', () => this.openForm(btn.getAttribute('data-id')));
      });
      document.querySelectorAll('.btn-news-delete').forEach(btn => {
        btn.addEventListener('click', () => this.deleteNews(btn.getAttribute('data-id')));
      });
      document.querySelectorAll('.btn-news-preview').forEach(btn => {
        btn.addEventListener('click', () => this.previewNews(btn.getAttribute('data-id')));
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      console.error('[BeritaAdmin] loadNews error:', err);
      tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--error);">Gagal memuat berita.</td></tr>`;
    }
  }

  async previewNews(id) {
    try {
      const item = this.news.find(n => n._id === id);
      if (!item) {
        const res = await fetch(`/api/news/${id}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.news) { EventBus.emit('toast:show', { message: 'Berita tidak ditemukan', type: 'danger' }); return; }
        this._renderPreviewModal(data.news);
      } else {
        this._renderPreviewModal(item);
      }
    } catch (_) {
      EventBus.emit('toast:show', { message: 'Gagal memuat preview', type: 'danger' });
    }
  }

  _renderPreviewModal(item) {
    const container = document.getElementById('preview-content');
    if (!container) return;

    const hasGallery = Array.isArray(item.images) && item.images.length > 0;
    const mainImage = item.thumbnail || (hasGallery ? item.images[0] : null);

    container.innerHTML = `
      <style>
        .preview-heading { font-family:'Outfit',sans-serif; font-size:1.6rem; font-weight:800; color:#0F172A; margin:20px 0 8px; line-height:1.3; }
        .preview-meta { display:flex; gap:12px; align-items:center; font-size:0.82rem; color:#64748B; margin-bottom:16px; flex-wrap:wrap; }
        .preview-meta .tag { background:rgba(37,99,235,0.08); color:#2563EB; padding:2px 10px; border-radius:20px; font-weight:600; font-size:0.72rem; }
        .preview-summary { background:#F8FAFC; padding:14px 18px; border-radius:12px; font-size:0.9rem; color:#475569; margin-bottom:16px; border-left:3px solid #2563EB; }
        .preview-gallery { margin-bottom:16px; }
        .preview-gallery .main { width:100%; border-radius:12px; overflow:hidden; margin-bottom:8px; }
        .preview-gallery .main img { width:100%; max-height:360px; object-fit:cover; display:block; }
        .preview-gallery .thumbs { display:flex; gap:6px; }
        .preview-gallery .thumbs img { width:64px; height:48px; object-fit:cover; border-radius:6px; cursor:pointer; opacity:0.6; transition:opacity 0.2s; }
        .preview-gallery .thumbs img.active { opacity:1; box-shadow:0 0 0 2px #2563EB; }
        .preview-body { font-size:0.92rem; line-height:1.8; color:#334155; }
        .preview-body p { margin-bottom:1.2em; text-align:justify; }
        .preview-placeholder { background:#F1F5F9; border-radius:12px; padding:32px; text-align:center; color:#94A3B8; margin:12px 0; font-size:0.85rem; }
      </style>

      <h1 class="preview-heading">${item.title}</h1>
      <div class="preview-meta">
        <span class="tag">${item.category || 'Informasi'}</span>
        <span>${item.author || 'Anonim'}</span>
        <span>${new Date(item.createdAt).toLocaleDateString('id-ID', { year:'numeric', month:'long', day:'numeric' })}</span>
        ${item.status === 'draft' ? '<span style="color:#F59E0B;font-weight:700;font-size:0.72rem;background:rgba(245,158,11,0.08);padding:2px 10px;border-radius:20px;">DRAFT</span>' : ''}
      </div>

      ${item.summary ? `<div class="preview-summary">${item.summary}</div>` : ''}

      ${mainImage ? `
        <div class="preview-gallery" id="preview-gallery-slot">
          <div class="main">
            <img id="preview-main-img" src="${mainImage}" alt="">
          </div>
          ${hasGallery && item.images.length > 1 ? `
          <div class="thumbs">
            ${item.images.map((img, i) => `
              <img src="${img}" class="${img === mainImage ? 'active' : ''}"
                   data-src="${img}" onclick="
                document.getElementById('preview-main-img').src=this.dataset.src;
                document.querySelectorAll('#preview-gallery-slot .thumbs img').forEach(x=>x.classList.remove('active'));
                this.classList.add('active');
              ">
            `).join('')}
          </div>` : ''}
        </div>
      ` : '<div class="preview-placeholder"><i data-lucide="image" style="width:32px;height:32px;opacity:0.3;display:block;margin:0 auto 8px;"></i>Tidak ada gambar</div>'}

      <div class="preview-body">
        ${item.content.split(/\n\n+/).map(p => p.trim()).filter(Boolean).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    document.getElementById('modal-news-preview').style.display = 'flex';
  }

  async openForm(id = null) {
    this.editingId = id;
    this.uploadedImages = [];
    this.selectedThumbnail = '';
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
    document.getElementById('news-image-files').value = '';
    this.renderImagePreviews();

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
          this.uploadedImages = Array.isArray(data.news.images) ? [...data.news.images] : [];
          this.selectedThumbnail = data.news.thumbnail || (this.uploadedImages[0] || '');
          document.getElementById('news-thumbnail').value = this.selectedThumbnail;
          this.renderImagePreviews();
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
    this.uploadedImages = [];
    this.selectedThumbnail = '';
  }

  async saveNews() {
    const id = document.getElementById('news-id').value;
    const data = {
      title: document.getElementById('news-title').value,
      category: document.getElementById('news-category').value,
      status: document.getElementById('news-status').value,
      summary: document.getElementById('news-summary').value,
      content: document.getElementById('news-content').value,
      thumbnail: this.selectedThumbnail,
      images: this.uploadedImages,
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

  destroy() {}
}

export const BeritaAdmin = new BeritaAdminPage();
