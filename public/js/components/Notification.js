// Notification.js - Komponen Pusat Notifikasi (Bell Dropdown)
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import api from '../services/api.js';

export class NotificationCenter {
  constructor() {
    this.bellBtn = null;
    this.dropdown = null;
    this.badge = null;
    this.workspaceRequests = [];
    
    // Subscribe ke update notifications di AppState
    EventBus.on('state:notifications', ({ newValue }) => this.renderList());
  }

  // Bind to DOM elements
  init() {
    this.bellBtn = document.getElementById('btn-bell');
    this.dropdown = document.getElementById('notification-dropdown');
    this.badge = document.getElementById('bell-badge');

    if (!this.bellBtn || !this.dropdown) return;

    // Toggle dropdown
    this.bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dropdown.classList.toggle('active');
      if (this.dropdown.classList.contains('active')) {
        this.fetchWorkspaceRequests();
      }
    });

    // Close when clicking outside
    document.addEventListener('click', () => {
      if (this.dropdown) {
        this.dropdown.classList.remove('active');
      }
    });

    this.dropdown.addEventListener('click', (e) => e.stopPropagation());
    
    // Initial fetch
    this.fetchWorkspaceRequests();
  }

  async fetchWorkspaceRequests() {
    const user = AppState.get('user');
    if (user && user.role === 'admin') {
      try {
        const res = await api.get('/workspaces/requests');
        if (res.success) {
          this.workspaceRequests = res.requests;
        }
      } catch (err) {
        console.error('Failed to fetch workspace requests', err);
      }
    }
    this.renderList();
  }

  async handleRequestAction(reqId, action) {
    try {
      const res = await api.post(`/workspaces/requests/${reqId}/${action}`);
      if (res.success) {
        alert(`Request berhasil di${action === 'approve' ? 'setujui' : 'tolak'}`);
        await this.fetchWorkspaceRequests();
      } else {
        alert(res.error || 'Gagal memproses request');
      }
    } catch (err) {
      alert('Terjadi kesalahan jaringan');
    }
  }

  updateBadge(count) {
    if (!this.badge) return;
    if (count > 0) {
      this.badge.innerText = count;
      this.badge.classList.add('visible');
      this.badge.classList.add('show'); // Added .show per new CSS
    } else {
      this.badge.classList.remove('visible');
      this.badge.classList.remove('show');
    }
  }

  renderList() {
    const listContainer = document.getElementById('notification-list');
    if (!listContainer) return;

    const baseNotifications = AppState.get('notifications') || [];
    
    // Combine requests and notifications
    const allItems = [
      ...this.workspaceRequests.map(req => ({ type: 'workspace_request', data: req })),
      ...baseNotifications.map(notif => ({ type: 'alert', data: notif }))
    ];

    this.updateBadge(this.workspaceRequests.length + (AppState.get('unreadNotifications') || 0));

    if (allItems.length === 0) {
      listContainer.innerHTML = `
        <div class="notif-empty">
          <i data-lucide="bell-off"></i>
          <p>Tidak ada notifikasi baru</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    listContainer.innerHTML = '';
    
    // Render up to 15 items
    allItems.slice(0, 15).forEach(item => {
      const el = document.createElement('div');
      el.className = 'notif-item';

      if (item.type === 'workspace_request') {
        const req = item.data;
        el.innerHTML = `
          <div class="notif-icon" style="background: rgba(16,185,129,0.1); color: var(--success);">
            <i data-lucide="user-plus"></i>
          </div>
          <div class="notif-content">
            <div class="notif-title">Permintaan Akses Workspace</div>
            <div class="notif-desc"><strong>${req.userName}</strong> (${req.userEmail}) ingin bergabung ke workspace ini.</div>
            <div class="notif-actions">
              <button class="notif-btn-accept" data-id="${req._id || req.id}" data-action="approve">Terima</button>
              <button class="notif-btn-decline" data-id="${req._id || req.id}" data-action="reject">Tolak</button>
            </div>
            <div class="notif-time">${Formatter.formatDate(req.createdAt)}</div>
          </div>
        `;
        
        // Add event listeners to buttons
        setTimeout(() => {
          const acceptBtn = el.querySelector('.notif-btn-accept');
          const declineBtn = el.querySelector('.notif-btn-decline');
          if (acceptBtn) acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); this.handleRequestAction(acceptBtn.dataset.id, 'approve'); });
          if (declineBtn) declineBtn.addEventListener('click', (e) => { e.stopPropagation(); this.handleRequestAction(declineBtn.dataset.id, 'reject'); });
        }, 0);
        
      } else {
        const alert = item.data;
        let level = alert.level || 'info';
        if (!alert.isCustom) {
          if (alert.aiStatus === 'TINGGI') level = 'high';
          else if (alert.aiStatus === 'SEDANG') level = 'medium';
          else if (alert.aiStatus === 'RENDAH') level = 'low';
          else if (alert.isComment) level = 'comment';
        }

        let icon = 'info';
        let bgStyle = '';
        if (level === 'high') { icon = 'alert-triangle'; bgStyle = 'background: rgba(239,68,68,0.1); color: var(--error);'; }
        else if (level === 'medium') { icon = 'alert-circle'; bgStyle = 'background: rgba(245,158,11,0.1); color: var(--warning);'; }
        else if (level === 'low') icon = 'eye';
        else if (level === 'success') { icon = 'shield-check'; bgStyle = 'background: rgba(16,185,129,0.1); color: var(--success);'; }
        else if (level === 'comment') icon = 'message-square';
        else icon = 'video';

        const titleText = alert.location || 'Notifikasi Baru';
        const messageText = alert.message || (alert.isComment 
          ? alert.message 
          : `Terdeteksi indikasi ${alert.aiStatus || 'Aktif'} (${alert.aiConfidence || 0}%)`);

        el.innerHTML = `
          <div class="notif-icon" style="${bgStyle}">
            <i data-lucide="${icon}"></i>
          </div>
          <div class="notif-content">
            <div class="notif-title">${titleText}</div>
            <div class="notif-desc">${messageText}</div>
            <div class="notif-time">${Formatter.formatTime ? Formatter.formatTime(alert.timestamp) : Formatter.formatDate(alert.timestamp)}</div>
          </div>
        `;

        el.addEventListener('click', () => {
          this.dropdown.classList.remove('active');
          Router.navigate(`/dashboard/detections/${alert.id}`);
        });
      }

      listContainer.appendChild(el);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}
