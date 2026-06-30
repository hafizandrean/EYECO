// detail.js - Kontroler Halaman Detail Analisis Laporan Sungai
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { AppState } from '../core/state.js';

export class DetailPage {
  constructor() {
    this.reportId = null;
    this.report = null;
    this.comments = [];
    this.commentsPage = 1;
    this.commentsLimit = 5;
    this.commentsSort = 'newest';
    this.commentsTotalPages = 1;
  }

  // Merender halaman detail laporan
  async render(container, id) {
    this.reportId = parseInt(id);
    this.commentsPage = 1;
    this.comments = [];

    container.innerHTML = `
      <!-- Back navigation bar -->
      <section class="detail-nav-row">
        <button class="btn btn-glass btn-rounded btn-back-route" id="btn-detail-back">
          <i data-lucide="arrow-left"></i> Kembali ke Daftar
        </button>
      </section>

      <!-- Main Detail grid layout -->
      <div class="detail-grid-layout" id="detail-grid-container">
        <!-- Render loading skeleton initially -->
        <div class="glass-card skeleton-detail-img"></div>
        <div class="glass-card skeleton-detail-form"></div>
      </div>
    `;

    // Back click trigger
    document.getElementById('btn-detail-back').addEventListener('click', () => {
      // If we came from Laporan page, go back to Laporan. Otherwise default to Dashboard.
      const lastActiveTab = sessionStorage.getItem('lastActiveTab');
      if (lastActiveTab === 'laporan') {
        Router.navigate('/dashboard/laporan');
      } else {
        const currentUser = AppState.get('user');
        Router.navigate(currentUser?.role === 'admin' ? '/dashboard' : '/dashboard/laporan');
      }
    });

    if (window.lucide) window.lucide.createIcons();

    // Load initial data
    await this.loadData();
  }

  async loadData() {
    const grid = document.getElementById('detail-grid-container');
    if (!grid) return;

    if (isNaN(this.reportId)) {
      EventBus.emit('toast:show', { message: 'ID Laporan tidak valid.', type: 'danger' });
      Router.navigate('/dashboard');
      return;
    }

    try {
      const report = await ReportService.getReportById(this.reportId);
      this.report = report;

      // Draw Page Layout
      let aiLevelClass = 'none';
      if (report.aiStatus === 'TINGGI') aiLevelClass = 'high';
      if (report.aiStatus === 'SEDANG') aiLevelClass = 'medium';
      if (report.aiStatus === 'RENDAH') aiLevelClass = 'low';

      // Admin verification badges
      let adminBadgeClass = 'status-pending';
      if (report.adminStatus === 'VALID') adminBadgeClass = 'status-valid';
      if (report.adminStatus === 'DIABAIKAN') adminBadgeClass = 'status-ignored';

      // Generate Bounding Boxes
      let boxesHtml = '';
      if (report.boundingBoxes && report.boundingBoxes.length > 0) {
        report.boundingBoxes.forEach(box => {
          let boxColorClass = 'yolo-default';
          if (box.label === 'person') boxColorClass = 'yolo-person';
          if (box.label === 'trash') boxColorClass = 'yolo-trash';
          if (box.label === 'boat') boxColorClass = 'yolo-boat';

          boxesHtml += `
            <div class="yolo-box ${boxColorClass}" style="
              top: ${box.y}%; 
              left: ${box.x}%; 
              width: ${box.w}%; 
              height: ${box.h}%;
            ">
              <span class="yolo-box-label">${box.label} ${(box.confidence).toFixed(2)}</span>
            </div>
          `;
        });
      }

      // Check current user role to render role-based sidebar
      const currentUser = AppState.get('user');
      const isAdmin = currentUser?.role === 'admin';

      let sidebarHtml = '';
      if (isAdmin) {
        sidebarHtml = `
          <!-- Right: Admin validation form & actions -->
          <aside class="glass-card detail-sidebar-card">
            <div class="card-header-clean">
              <h3 class="section-title"><i data-lucide="check-square" class="text-primary"></i> Verifikasi Keputusan</h3>
            </div>

            <div class="form-group" style="margin-bottom: 24px;">
              <label class="form-label">Status Saat Ini</label>
              <div style="margin-top: 4px;">
                <span class="status-badge ${adminBadgeClass}" id="detail-current-admin-status-pill">${report.adminStatus}</span>
              </div>
            </div>

            <form id="detail-verify-form" class="detail-verify-form">
              <div class="form-group">
                <label class="form-label" for="verify-status-select">Tentukan Validasi</label>
                <select class="form-control select-rounded" id="verify-status-select" required>
                  <option value="MENUNGGU" ${report.adminStatus === 'MENUNGGU' ? 'selected' : ''}>Menunggu (Belum Diverifikasi)</option>
                  <option value="VALID" ${report.adminStatus === 'VALID' ? 'selected' : ''}>Valid (Tindak Lanjut Laporan)</option>
                  <option value="DIABAIKAN" ${report.adminStatus === 'DIABAIKAN' ? 'selected' : ''}>Abaikan (Bukan Ancaman/Salah AI)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="verify-notes-input">Catatan Tindak Lanjut</label>
                <textarea class="form-control textarea-rounded" id="verify-notes-input" placeholder="Masukkan instruksi rujukan dinas sosial atau ketua RT setempat...">${report.adminNotes || ''}</textarea>
              </div>

              <button type="submit" class="btn btn-primary btn-rounded" style="width: 100%; margin-top: 16px;">
                <i data-lucide="save"></i> Simpan Keputusan
              </button>
            </form>

            <div class="divider-line"></div>

            <!-- Telegram broadcast simulated button -->
            <button class="btn btn-glass btn-rounded" id="btn-telegram-dispatch" style="width: 100%; color: var(--primary); border-color: rgba(59, 130, 246, 0.4); margin-bottom: 8px;">
              <i data-lucide="send"></i> Kirim ke Telegram Tim Respon
            </button>
            
            <div class="divider-line" style="margin: 12px 0;"></div>
            
            <!-- Comments Section Shell -->
            <div class="comments-section-container" id="comments-section"></div>
          </aside>
        `;
      } else {
        sidebarHtml = `
          <!-- Right: Read-only status & Comments for normal users -->
          <aside class="glass-card detail-sidebar-card">
            <div class="card-header-clean">
              <h3 class="section-title"><i data-lucide="check-square" class="text-primary"></i> Status Validasi</h3>
            </div>

            <div class="form-group">
              <label class="form-label">Status Saat Ini</label>
              <div style="margin-top: 4px;">
                <span class="status-badge ${adminBadgeClass}" id="detail-current-admin-status-pill">${report.adminStatus}</span>
              </div>
              
              <div style="margin-top: 16px; padding: 12px; border-radius: var(--radius-button); background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border);">
                <label class="form-label" style="font-size: 0.7rem; color: var(--text-muted);">Catatan Admin</label>
                <p class="description-text" style="margin-top: 4px; font-style: italic;">
                  ${report.adminNotes ? `"${report.adminNotes}"` : 'Belum ada catatan tindak lanjut dari Admin.'}
                </p>
              </div>
            </div>

            <div class="divider-line" style="margin: 12px 0;"></div>
            
            <!-- Comments Section Shell -->
            <div class="comments-section-container" id="comments-section"></div>
          </aside>
        `;
      }

      grid.innerHTML = `
        <!-- Left: Image Canvas and Metadata -->
        <main class="glass-card detail-main-card">
          <div class="image-canvas-container" id="detail-image-wrapper">
            <img src="${report.image}" alt="CCTV Capture Laporan" class="detail-main-img">
            ${boxesHtml}
            <div class="scanning-laser-line" id="scanning-laser"></div>
          </div>

          <div class="detail-info-list" style="margin-top: 24px;">
            <div class="detail-info-item">
              <span class="detail-info-label">Hasil AI Status</span>
              <span class="badge badge-${levelToBadge(aiLevelClass)}">${report.aiStatus}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Keyakinan AI</span>
              <span class="detail-info-val" style="font-weight: 700;">${report.aiConfidence ? `${report.aiConfidence}%` : 'N/A'}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Waktu Deteksi</span>
              <span class="detail-info-val">${Formatter.formatDate(report.timestamp)}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Lokasi Sungai</span>
              <span class="detail-info-val"><i data-lucide="map-pin" style="width: 14px; height: 14px; display:inline-block; color:var(--primary); margin-right:4px;"></i> ${report.location}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Ciri/Identitas</span>
              <span class="detail-info-val">${report.identity || 'Belum diketahui'}</span>
            </div>
            <div class="detail-info-item">
              <span class="detail-info-label">Jenis Pemantauan</span>
              <span class="detail-info-val">${report.sourceType || 'Gambar'}</span>
            </div>
          </div>

          <div class="detail-description-box">
            <span class="detail-info-label" style="display:block; margin-bottom: 8px;">Keterangan Tambahan</span>
            <p class="description-text">${report.additionalNotes || 'Tidak ada catatan tambahan.'}</p>
          </div>
        </main>

        ${sidebarHtml}
      `;

      // Render the comments UI skeleton
      this.renderCommentsShell();

      // Bind all form actions
      this.bindActionEvents();

      // Load first page of comments
      await this.loadComments(true);

    } catch (err) {
      grid.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 32px; text-align: center;">
          <i data-lucide="alert-octagon" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Gagal Memuat Detail Laporan</h3>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">Log deteksi sungai tidak ditemukan atau otorisasi gagal.</p>
        </div>
      `;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  renderCommentsShell() {
    const commentsSec = document.getElementById('comments-section');
    if (!commentsSec) return;

    commentsSec.innerHTML = `
      <div class="comments-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h4 class="section-title-sm" style="font-size:0.95rem; font-weight:700; display:flex; align-items:center; gap:8px;">
          <i data-lucide="message-square" style="width:16px; height:16px; color:var(--primary);"></i> Diskusi (<span id="comments-total-count">0</span>)
        </h4>
        <select class="filter-control select-rounded" id="comments-sort-select" style="font-size:0.75rem; padding: 2px 8px; height: 26px; width:auto; background:var(--surface);">
          <option value="newest">Baru</option>
          <option value="oldest">Lama</option>
          <option value="most_liked">Populer</option>
        </select>
      </div>

      <div class="comments-list" id="comments-list" style="max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; padding-right: 4px;">
        <!-- Comment item rows -->
        <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">
          Memuat diskusi...
        </div>
      </div>

      <div class="comments-pagination" id="comments-load-more-container" style="text-align: center; display: none; margin-bottom: 12px;">
        <button class="btn btn-glass btn-sm btn-rounded" id="btn-comments-load-more" style="height:26px; font-size:0.75rem; padding: 0 12px;">
          Muat Lebih Banyak
        </button>
      </div>

      <!-- Input Form -->
      <form id="comment-post-form" style="display:flex; flex-direction:column; gap:8px; margin-top: 12px;">
        <div style="position:relative;">
          <textarea class="form-control textarea-rounded" id="comment-input-text" placeholder="Tulis komentar... (gunakan @username)" style="height:62px; font-size:0.8rem; padding: 8px 12px; padding-bottom: 22px; resize:none; background:var(--surface);" required></textarea>
          <span id="comment-char-counter" style="position:absolute; right:12px; bottom:6px; font-size:0.65rem; color:var(--text-muted); pointer-events:none;">0/500</span>
        </div>
        <button type="submit" class="btn btn-primary btn-rounded btn-sm" id="btn-submit-comment" style="align-self: flex-end; height:30px; font-size:0.75rem; padding: 0 16px;">
          Kirim
        </button>
      </form>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  async loadComments(reset = false) {
    if (reset) {
      this.commentsPage = 1;
      this.comments = [];
    }

    try {
      const data = await ReportService.getComments(this.reportId, this.commentsPage, this.commentsLimit, this.commentsSort);
      
      if (reset) {
        this.comments = data.comments || [];
      } else {
        this.comments = this.comments.concat(data.comments || []);
      }
      
      this.commentsTotalPages = data.pagination.totalPages;
      
      // Update count badge
      const countEl = document.getElementById('comments-total-count');
      if (countEl) countEl.innerText = data.pagination.totalComments;

      this.renderCommentsList();
      this.updateCommentsPagination(data.pagination);
    } catch (err) {
      console.error('[Detail Page] Failed to load comments:', err);
    }
  }

  renderCommentsList() {
    const listEl = document.getElementById('comments-list');
    if (!listEl) return;

    if (this.comments.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding: 24px; color: var(--text-muted); font-size:0.8rem;">
          <i data-lucide="message-square" style="width:20px; height:20px; margin: 0 auto 8px auto; opacity: 0.5; display:block;"></i>
          Belum ada diskusi. Jadilah yang pertama berkomentar!
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const currentUser = AppState.get('user');
    
    listEl.innerHTML = '';
    this.comments.forEach(comment => {
      const isOwner = comment.userId === currentUser?.id;
      const isAdmin = currentUser?.role === 'admin';
      const isLiked = comment.likedBy.includes(currentUser?.id);

      const commentItem = document.createElement('div');
      commentItem.className = `comment-item ${comment.isDeleted ? 'comment-deleted' : ''}`;
      commentItem.style.cssText = `
        display: flex;
        gap: 10px;
        padding: 10px;
        border-radius: var(--radius-button);
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border);
        transition: var(--motion-hover);
      `;
      
      const avatarInitials = comment.username ? comment.username.substring(0, 2).toUpperCase() : 'US';
      const roleLabel = comment.role === 'admin' 
        ? `<span class="badge badge-high" style="font-size:0.58rem; padding: 1px 4px; border-radius:3px; font-weight:800; background:rgba(239, 68, 68, 0.15); color:var(--danger); border:1px solid rgba(239, 68, 68, 0.2);">ADMIN</span>` 
        : '';

      // Format text with mention highlighting
      let commentText = comment.text;
      if (comment.isDeleted) {
        commentText = `<span style="font-style: italic; color: var(--text-muted);">Komentar ini telah dihapus.</span>`;
      } else {
        // Highlight mentions (@username)
        commentText = commentText.replace(/(@[a-zA-Z0-9_]+)/g, '<span class="mention-tag" style="color:var(--primary); font-weight:700; background:rgba(59, 130, 246, 0.12); padding:1px 4px; border-radius:3px;">$1</span>');
      }

      const showDeleteBtn = !comment.isDeleted && (isOwner || isAdmin);

      commentItem.innerHTML = `
        <div class="comment-avatar" style="
          width: 28px; 
          height: 28px; 
          border-radius: 50%; 
          background: ${comment.role === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)'}; 
          color: ${comment.role === 'admin' ? 'var(--primary)' : 'var(--text-secondary)'}; 
          border: 1px solid ${comment.role === 'admin' ? 'var(--primary)' : 'var(--border)'};
          display: flex; 
          align-items: center; 
          justify-content: center; 
          font-size: 0.72rem; 
          font-weight: 700;
          flex-shrink: 0;
        ">${avatarInitials}</div>
        
        <div class="comment-content" style="flex-grow:1; display:flex; flex-direction:column; gap:4px; min-width: 0;">
          <div class="comment-user-info" style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:0.78rem; font-weight:700; color:var(--text-primary); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${comment.username || 'Pengguna'}</span>
            ${roleLabel}
            <span style="font-size:0.63rem; color:var(--text-muted); margin-left:auto; flex-shrink:0;">${Formatter.formatDate(comment.createdAt || comment.timestamp)}</span>
          </div>
          <div style="font-size:0.78rem; color:var(--text-secondary); line-height: 1.4; word-break: break-word;">
            ${commentText}
          </div>
          
          ${!comment.isDeleted ? `
          <div class="comment-actions" style="display:flex; align-items:center; gap:12px; margin-top:4px;">
            <button class="btn-like-comment" data-id="${comment._id}" style="
              background:none; 
              border:none; 
              color: ${isLiked ? 'var(--primary)' : 'var(--text-muted)'}; 
              cursor:pointer; 
              font-size:0.68rem; 
              font-weight:700; 
              display:flex; 
              align-items:center; 
              gap:4px;
              padding: 0;
              transition: color 0.2s ease;
            ">
              <i data-lucide="thumbs-up" style="width:11px; height:11px; fill: ${isLiked ? 'currentColor' : 'none'};"></i> 
              <span class="like-count-val">${comment.likedBy ? comment.likedBy.length : 0}</span>
            </button>
            
            ${showDeleteBtn ? `
            <button class="btn-delete-comment text-danger" data-id="${comment._id}" style="
              background:none; 
              border:none; 
              color: var(--danger); 
              cursor:pointer; 
              font-size:0.68rem; 
              font-weight:700;
              margin-left:auto;
              padding: 0;
            ">Hapus</button>
            ` : ''}
          </div>
          ` : ''}
        </div>
      `;

      // Bind like click
      if (!comment.isDeleted) {
        const likeBtn = commentItem.querySelector('.btn-like-comment');
        if (likeBtn) {
          likeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const commentId = likeBtn.getAttribute('data-id');
            try {
              const res = await ReportService.toggleLikeComment(this.reportId, commentId);
              
              // Find comment in state and update
              const idx = this.comments.findIndex(c => c._id === commentId);
              if (idx > -1) {
                this.comments[idx].likedBy = res.likedBy;
              }
              this.renderCommentsList();
            } catch (err) {
              // error toast handled in service
            }
          });
        }

        // Bind delete click
        const deleteBtn = commentItem.querySelector('.btn-delete-comment');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Hapus komentar ini?')) {
              const commentId = deleteBtn.getAttribute('data-id');
              try {
                await ReportService.deleteComment(this.reportId, commentId);
                // Set comment in state to deleted
                const idx = this.comments.findIndex(c => c._id === commentId);
                if (idx > -1) {
                  this.comments[idx].isDeleted = true;
                }
                this.renderCommentsList();
              } catch (err) {
                // error toast handled in service
              }
            }
          });
        }
      }

      listEl.appendChild(commentItem);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  updateCommentsPagination(pagination) {
    const loadMoreContainer = document.getElementById('comments-load-more-container');
    if (!loadMoreContainer) return;

    if (pagination.hasNext) {
      loadMoreContainer.style.display = 'block';
    } else {
      loadMoreContainer.style.display = 'none';
    }
  }

  bindActionEvents() {
    const form = document.getElementById('detail-verify-form');
    const telegramBtn = document.getElementById('btn-telegram-dispatch');
    const statusSelect = document.getElementById('verify-status-select');
    const notesInput = document.getElementById('verify-notes-input');

    // Comment elements
    const commentInput = document.getElementById('comment-input-text');
    const charCounter = document.getElementById('comment-char-counter');
    const commentForm = document.getElementById('comment-post-form');
    const sortSelect = document.getElementById('comments-sort-select');
    const loadMoreBtn = document.getElementById('btn-comments-load-more');

    // Form verification decision
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newStatus = statusSelect.value;
        const notes = notesInput.value;

        try {
          const updated = await ReportService.verifyReport(this.reportId, newStatus, notes);
          
          // Update status pill visual
          const statusPill = document.getElementById('detail-current-admin-status-pill');
          if (statusPill) {
            statusPill.innerText = updated.adminStatus;
            
            let adminBadgeClass = 'status-pending';
            if (updated.adminStatus === 'VALID') adminBadgeClass = 'status-valid';
            if (updated.adminStatus === 'DIABAIKAN') adminBadgeClass = 'status-ignored';
            statusPill.className = `status-badge ${adminBadgeClass}`;
          }
        } catch (err) {
          // Error notification handled inside service layer
        }
      });
    }

    if (telegramBtn) {
      telegramBtn.addEventListener('click', async () => {
        telegramBtn.disabled = true;
        telegramBtn.innerHTML = '<span class="spinner-neon" style="width:14px; height:14px; border-width:2px; display:inline-block; margin-right:8px;"></span> Mengirim...';
        
        try {
          // Simulated network delay
          await new Promise(resolve => setTimeout(resolve, 1500));
          EventBus.emit('toast:show', { message: 'Laporan berhasil disiarkan ke Telegram Respon Cepat!', type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengirim pesan Telegram.', type: 'danger' });
        } finally {
          telegramBtn.disabled = false;
          telegramBtn.innerHTML = '<i data-lucide="send"></i> Kirim ke Telegram Tim Respon';
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    // Characters counter validation
    if (commentInput && charCounter) {
      commentInput.addEventListener('input', () => {
        const len = commentInput.value.length;
        charCounter.innerText = `${len}/500`;
        if (len > 500) {
          charCounter.style.color = 'var(--danger)';
          charCounter.style.fontWeight = '700';
        } else {
          charCounter.style.color = 'var(--text-muted)';
          charCounter.style.fontWeight = '400';
        }
      });
    }

    // Submit new comment
    if (commentForm && commentInput) {
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = commentInput.value.trim();
        if (!text) return;
        
        if (text.length < 2 || text.length > 500) {
          EventBus.emit('toast:show', { message: 'Komentar harus terdiri dari 2 hingga 500 karakter.', type: 'danger' });
          return;
        }

        try {
          await ReportService.addComment(this.reportId, text);
          
          // Reset elements
          commentInput.value = '';
          charCounter.innerText = '0/500';
          charCounter.style.color = 'var(--text-muted)';
          
          EventBus.emit('toast:show', { message: 'Komentar terkirim!', type: 'success' });

          // Reload comments list
          await this.loadComments(true);
        } catch (err) {
          // error toast handled in service
        }
      });
    }

    // Sort trigger
    if (sortSelect) {
      sortSelect.addEventListener('change', async () => {
        this.commentsSort = sortSelect.value;
        await this.loadComments(true);
      });
    }

    // Load more trigger
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        if (this.commentsPage < this.commentsTotalPages) {
          this.commentsPage++;
          await this.loadComments(false);
        }
      });
    }
  }

  destroy() {
    // No polling on detail page
  }
}

// Helpers
function levelToBadge(level) {
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  if (level === 'low') return 'low';
  return 'none';
}

export const Detail = new DetailPage();
