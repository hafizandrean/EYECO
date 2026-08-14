// workspace-requests.js — Dedicated Workspace Join Requests Management Page (Single Source of Truth)
import { EventBus } from '../core/eventBus.js';
import { MacModal } from '../utils/macModal.js';
import { AppState } from '../core/state.js';

export class WorkspaceRequestsPage {
  constructor() {
    this.requests = [];
    this.currentFilter = 'PENDING';
  }

  async render(container) {
    container.innerHTML = `
      <div class="page-header" style="margin-bottom: var(--space-24); padding:16px 24px; border-radius:var(--radius-lg); background:rgba(255,255,255,0.6); backdrop-filter:blur(18px) saturate(1.4); border:1px solid rgba(255,255,255,0.7); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 class="section-title" style="font-size: 1.6rem; font-weight: 800; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:10px;">
            <i data-lucide="user-plus" style="color:var(--primary); width:24px; height:24px;"></i> Permintaan Akses Workspace
          </h2>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 4px 0 0 0;">
            Kelola pengajuan bergabung pengguna ke dalam instansi workspace Anda secara mandiri & transparan.
          </p>
        </div>
        <div>
          <span class="badge" id="ws-req-pending-badge" style="background: rgba(47,107,255,0.1); color: var(--primary); font-size: 0.85rem; font-weight: 800; padding: 8px 16px; border-radius: var(--radius-pill);">
            <i data-lucide="clock" style="width:14px; height:14px; margin-right:4px;"></i> 0 Permintaan Menunggu
          </span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="glass-card" style="padding: 16px 20px; margin-bottom: var(--space-20); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; gap:8px;">
          <button class="btn btn-glass btn-rounded btn-sm filter-tab-btn ${this.currentFilter === 'PENDING' ? 'active' : ''}" data-status="PENDING" style="font-weight:700;">
            Menunggu Tinjauan
          </button>
          <button class="btn btn-glass btn-rounded btn-sm filter-tab-btn ${this.currentFilter === 'APPROVED' ? 'active' : ''}" data-status="APPROVED" style="font-weight:700;">
            Disetujui
          </button>
          <button class="btn btn-glass btn-rounded btn-sm filter-tab-btn ${this.currentFilter === 'REJECTED' ? 'active' : ''}" data-status="REJECTED" style="font-weight:700;">
            Ditolak
          </button>
          <button class="btn btn-glass btn-rounded btn-sm filter-tab-btn ${this.currentFilter === 'SEMUA' ? 'active' : ''}" data-status="SEMUA" style="font-weight:700;">
            Semua Riwayat
          </button>
        </div>
        <button class="btn btn-glass btn-rounded btn-sm" id="btn-refresh-requests" style="font-size:0.78rem;">
          <i data-lucide="rotate-ccw" style="width:13px; height:13px;"></i> Refresh Data
        </button>
      </div>

      <!-- Data Table Card -->
      <div class="glass-card" style="padding: 24px;">
        <div id="ws-requests-table-container">
          <div style="text-align:center; padding: 40px; color: var(--text-muted);">
            Memuat daftar permintaan akses...
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    await this.loadRequests();
  }

  bindEvents() {
    const filterBtns = document.querySelectorAll('.filter-tab-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.getAttribute('data-status');
        await this.loadRequests();
      });
    });

    const refreshBtn = document.getElementById('btn-refresh-requests');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await this.loadRequests();
      });
    }
  }

  async loadRequests() {
    try {
      const res = await fetch(`/api/workspace/requests?status=${this.currentFilter}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memuat permintaan akses');
      }

      this.requests = data.requests || [];
      this.renderTable();
      this.updateNavbarBadge();
    } catch (err) {
      console.error('[WS_REQUESTS] loadRequests failed:', err);
      const container = document.getElementById('ws-requests-table-container');
      if (container) {
        container.innerHTML = `
          <div style="text-align:center; padding: 32px; color: var(--danger);">
            <i data-lucide="alert-circle" style="width:36px; height:36px; margin-bottom:8px;"></i>
            <p style="font-weight:700;">${err.message}</p>
          </div>
        `;
      }
    }
    if (window.lucide) window.lucide.createIcons();
  }

  async updateNavbarBadge() {
    try {
      const res = await fetch('/api/workspace/requests/count', { credentials: 'include' });
      const data = await res.json();
      const count = data.count || 0;
      
      const badgeEl = document.getElementById('ws-req-pending-badge');
      if (badgeEl) {
        badgeEl.innerHTML = `<i data-lucide="clock" style="width:14px; height:14px; margin-right:4px;"></i> ${count} Permintaan Menunggu`;
      }

      // Update navbar badge if element exists
      const navBadge = document.getElementById('nav-workspace-req-count');
      if (navBadge) {
        navBadge.innerText = count > 0 ? count : '';
        navBadge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    } catch (_) {}
  }

  renderTable() {
    const container = document.getElementById('ws-requests-table-container');
    if (!container) return;

    if (this.requests.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 48px; color: var(--text-muted);">
          <i data-lucide="inbox" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
          <h4 style="font-weight:700; color:var(--text-primary);">Tidak Ada Permintaan Akses</h4>
          <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:4px;">
            Tidak ditemukan pengajuan bergabung untuk kriteria status "${this.currentFilter}".
          </p>
        </div>
      `;
      return;
    }

    let rowsHtml = '';
    this.requests.forEach(reqItem => {
      const dateStr = reqItem.createdAt ? new Date(reqItem.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
      
      let statusBadge = '<span class="badge bg-warning text-white">MENUNGGU</span>';
      if (reqItem.status === 'APPROVED') {
        statusBadge = '<span class="badge bg-success text-white">DISETUJUI</span>';
      } else if (reqItem.status === 'REJECTED') {
        statusBadge = '<span class="badge bg-danger text-white">DITOLAK</span>';
      }

      let actionsHtml = '';
      if (reqItem.status === 'PENDING') {
        actionsHtml = `
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <button class="btn btn-soft btn-sm btn-approve-req" data-id="${reqItem._id || reqItem.id}" style="color: var(--success); background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); font-weight:700; height:32px; padding:0 12px;">
              <i data-lucide="check" style="width:14px; height:14px;"></i> Terima
            </button>
            <button class="btn btn-soft btn-sm btn-reject-req" data-id="${reqItem._id || reqItem.id}" style="color: var(--danger); background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); font-weight:700; height:32px; padding:0 12px;">
              <i data-lucide="x" style="width:14px; height:14px;"></i> Tolak
            </button>
          </div>
        `;
      } else {
        const deciderText = reqItem.deciderName || 'Admin';
        const reasonText = reqItem.rejectionReasonCode ? `<div style="font-size:0.72rem; color:var(--danger); margin-top:2px;">Alasan: <strong>${reqItem.rejectionReasonCode}</strong> ${reqItem.rejectionNote ? `(${reqItem.rejectionNote})` : ''}</div>` : '';
        actionsHtml = `
          <div style="font-size:0.75rem; color:var(--text-secondary); text-align:right;">
            <span>Diputuskan oleh: <strong>${deciderText}</strong></span>
            ${reasonText}
          </div>
        `;
      }

      rowsHtml += `
        <div class="card-table-row glass-card" style="padding:14px 18px; margin-bottom:10px; display:grid; grid-template-columns: 180px 1fr 120px 120px 220px; align-items:center; gap:16px;">
          <div>
            <div style="font-size:0.75rem; font-weight:800; color:var(--text-secondary); text-transform:uppercase;">Waktu Pengajuan</div>
            <div style="font-size:0.82rem; font-weight:700; color:var(--text-primary); margin-top:2px;">${dateStr}</div>
          </div>
          <div>
            <div style="font-size:0.9rem; font-weight:800; color:var(--text-primary);">${reqItem.userName}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">Email: ${reqItem.userEmail} &middot; Telp: ${reqItem.userPhone}</div>
          </div>
          <div>
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary); text-transform:uppercase;">Peran</div>
            <span class="badge" style="background:rgba(0,0,0,0.05); color:var(--text-primary); font-size:0.72rem; font-weight:700; text-transform:uppercase;">${reqItem.userRole}</span>
          </div>
          <div>
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary); text-transform:uppercase; margin-bottom:2px;">Status</div>
            ${statusBadge}
          </div>
          <div>
            ${actionsHtml}
          </div>
        </div>
      `;
    });

    container.innerHTML = rowsHtml;
    this.bindRowEvents();
  }

  bindRowEvents() {
    const approveBtns = document.querySelectorAll('.btn-approve-req');
    approveBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const confirmed = await MacModal.confirm(
          'Setujui Akses Workspace',
          `Pengguna ini akan diberikan akses penuh sebagai anggota di workspace Anda. Lanjutkan?`,
          { iconType: 'info', confirmText: 'Ya, Setujui', confirmStyle: 'primary' }
        );
        if (!confirmed) return;
        await this.decideRequest(id, 'APPROVED');
      });
    });

    const rejectBtns = document.querySelectorAll('.btn-reject-req');
    rejectBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        this.openRejectionModal(id);
      });
    });
  }

  openRejectionModal(requestId) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'mac-modal-overlay active';
    modalOverlay.style.zIndex = '99999';

    modalOverlay.innerHTML = `
      <div class="mac-modal-window" style="max-width: 480px; width:90%;">
        <div class="mac-modal-header">
          <div class="mac-modal-title" style="color:var(--danger); font-weight:800;">
            <i data-lucide="x-circle" style="width:18px; height:18px;"></i> Penolakan Akses Workspace
          </div>
          <button class="mac-modal-close" id="btn-close-rej-modal">&times;</button>
        </div>
        <div class="mac-modal-body" style="padding: 20px;">
          <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">
            Pilih alasan penolakan untuk disimpan pada catatan keputusan dan diinformasikan kepada pengguna:
          </p>

          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="rejReason" value="Tidak dikenal" checked style="accent-color:var(--danger);">
              <strong>Tidak dikenal</strong> — Pengguna tidak terdaftar dalam database instansi
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="rejReason" value="Luar wilayah" style="accent-color:var(--danger);">
              <strong>Luar wilayah</strong> — Alamat domisili pengguna di luar cakupan kerja
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="rejReason" value="Data tidak sesuai" style="accent-color:var(--danger);">
              <strong>Data tidak sesuai</strong> — Identitas akun/email tidak valid
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="rejReason" value="Duplikat" style="accent-color:var(--danger);">
              <strong>Duplikat</strong> — Pengguna sudah memiliki akun aktif lain
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
              <input type="radio" name="rejReason" value="Lainnya" style="accent-color:var(--danger);">
              <strong>Lainnya</strong> — Alasan khusus operasional
            </label>
          </div>

          <div class="form-group">
            <label class="form-label" style="font-size:0.78rem;">Catatan Tambahan (Opsional)</label>
            <textarea id="rej-note-input" class="form-control textarea-rounded" style="font-size:0.8rem; height:60px;" placeholder="Tulis rujukan atau keterangan detail jika diperlukan..."></textarea>
          </div>
        </div>
        <div class="mac-modal-footer" style="padding: 14px 20px; display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-glass btn-rounded btn-sm" id="btn-cancel-rej">Batal</button>
          <button class="btn btn-primary btn-rounded btn-sm" id="btn-confirm-rej" style="background:var(--danger); border-color:var(--danger);">
            Konfirmasi Penolakan
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modalOverlay);
    if (window.lucide) window.lucide.createIcons();

    const closeModal = () => {
      if (document.body.contains(modalOverlay)) {
        document.body.removeChild(modalOverlay);
      }
    };

    document.getElementById('btn-close-rej-modal').onclick = closeModal;
    document.getElementById('btn-cancel-rej').onclick = closeModal;

    document.getElementById('btn-confirm-rej').onclick = async () => {
      const selectedRadio = modalOverlay.querySelector('input[name="rejReason"]:checked');
      const rejectionReasonCode = selectedRadio ? selectedRadio.value : 'Lainnya';
      const rejectionNote = document.getElementById('rej-note-input').value.trim();

      closeModal();
      await this.decideRequest(requestId, 'REJECTED', rejectionReasonCode, rejectionNote);
    };
  }

  async decideRequest(requestId, action, rejectionReasonCode = null, rejectionNote = null) {
    try {
      const res = await fetch(`/api/workspace/requests/${requestId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action,
          rejectionReasonCode,
          rejectionNote
        })
      });

      const data = await res.json();
      if (!res.ok) {
        // Handle atomic conflict 409
        if (res.status === 409) {
          EventBus.emit('toast:show', { message: data.message || 'Permintaan akses ini sudah diputuskan sebelumnya.', type: 'danger' });
          await this.loadRequests();
          return;
        }
        throw new Error(data.error || data.message || 'Gagal memproses keputusan');
      }

      EventBus.emit('toast:show', {
        message: action === 'APPROVED' ? 'Permintaan akses berhasil disetujui!' : 'Permintaan akses berhasil ditolak.',
        type: action === 'APPROVED' ? 'success' : 'info'
      });

      await this.loadRequests();
    } catch (err) {
      console.error('[WS_REQUESTS] decideRequest failed:', err);
      EventBus.emit('toast:show', { message: err.message || 'Terjadi kesalahan sistem', type: 'danger' });
    }
  }
}
