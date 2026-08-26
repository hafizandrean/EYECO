// Notification.js - Komponen Pusat Notifikasi (Bell Dropdown)
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { API } from '../services/api.js';

export class NotificationCenter {
  constructor() {
    this.bellBtn = null;
    this.dropdown = null;
    this.badge = null;
    this.workspaceRequests = [];
    this.dbNotifications = [];
    
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
        this.fetchDBNotifications();
        // Clear badge count when opening dropdown
        this.clearBadge();
        // Mark all as read on backend
        API.patch('/api/notifications/read-all').catch(() => {});
        // Reset AppState unread count
        AppState.set('unreadNotifications', 0);
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
    this.fetchDBNotifications();
  }

  async fetchWorkspaceRequests() {
    const user = AppState.get('user');
    if (user && user.role === 'admin') {
      try {
        const res = await API.get('/api/workspaces/requests');
        if (res.success) {
          this.workspaceRequests = res.requests;
        }
      } catch (err) {
        console.error('Failed to fetch workspace requests', err);
      }
    }
    this.renderList();
  }

  async fetchDBNotifications() {
    try {
      const res = await API.get('/api/notifications');
      if (res.success) {
        this.dbNotifications = res.notifications || [];
        this.renderList();
      }
    } catch (err) {
      console.error('Failed to fetch DB notifications', err);
    }
  }

  clearBadge() {
    if (!this.badge) return;
    this.badge.innerText = '';
    this.badge.classList.remove('visible');
    this.badge.classList.remove('show');
  }

  async handleRequestAction(reqId, action) {
    try {
      const res = await API.post(`/api/workspaces/requests/${reqId}/${action}`);
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
      this.badge.classList.add('show');
    } else {
      this.badge.classList.remove('visible');
      this.badge.classList.remove('show');
    }
  }

  renderList() {
      const listContainer = document.getElementById('notification-list');
      if (!listContainer) return;

      const baseNotifications = AppState.get('notifications') || [];
    
      // Convert DB notifications to the alert format used in the UI
      const dbNotifItems = this.dbNotifications.map(n => ({
        type: 'db_notification',
        data: this.mapDBNotificationToAlert(n),
      }));

      const appStateItems = baseNotifications.map(notif => ({ type: 'alert', data: notif }));
      const requestItems = this.workspaceRequests.map(req => ({ type: 'workspace_request', data: req }));

      // Combine and sort newest first
      const allItems = [...appStateItems, ...dbNotifItems, ...requestItems];
      allItems.sort((a, b) => {
        const aTime = a.data.createdAt || a.data.timestamp || 0;
        const bTime = b.data.createdAt || b.data.timestamp || 0;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      // Badge count = unread DB notifs + unread AppState + workspace requests
      const unreadDb = this.dbNotifications.filter(n => !n.read).length;
      const unreadApp = AppState.get('unreadNotifications') || 0;
      this.updateBadge(this.workspaceRequests.length + unreadDb + unreadApp);

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
        el.style.position = 'relative';
        el.style.overflow = 'hidden';
        el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        el.dataset.notifId = item.data._id || item.data.id || '';
        el.dataset.notifType = item.type;

        if (item.type === 'workspace_request') {
          const req = item.data;
          el.innerHTML = `
            <div class="notif-item-content" style="display:flex; gap:10px; width:100%; transition: transform 0.3s ease;">
              <div class="notif-icon" style="background: rgba(16,185,129,0.1); color: var(--success);">
                <i data-lucide="user-plus"></i>
              </div>
              <div class="notif-content" style="flex:1; min-width:0;">
                <div class="notif-title">Permintaan Akses Workspace</div>
                <div class="notif-desc"><strong>${req.userName}</strong> (${req.userEmail}) ingin bergabung ke workspace ini.</div>
                <div class="notif-actions">
                  <button class="notif-btn-accept" data-id="${req._id || req.id}" data-action="approve">Terima</button>
                  <button class="notif-btn-decline" data-id="${req._id || req.id}" data-action="reject">Tolak</button>
                </div>
                <div class="notif-time">${Formatter.formatDate(req.createdAt)}</div>
              </div>
            </div>
            <div class="notif-delete-actions" style="position:absolute; right:0; top:0; bottom:0; display:flex; align-items:center; justify-content:center; background:var(--danger); padding:0 16px; color:white; transform:translateX(100%); transition:transform 0.3s ease;">
              <button class="notif-delete-btn" data-id="${req._id || req.id}" style="background:none; border:none; color:white; font-size:0.75rem; font-weight:700; cursor:pointer; padding:8px; display:flex; align-items:center; gap:4px;">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus
              </button>
            </div>
          `;
        
          setTimeout(() => {
            const acceptBtn = el.querySelector('.notif-btn-accept');
            const declineBtn = el.querySelector('.notif-btn-decline');
            const deleteBtn = el.querySelector('.notif-delete-btn');
            if (acceptBtn) acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); this.handleRequestAction(acceptBtn.dataset.id, 'approve'); });
            if (declineBtn) declineBtn.addEventListener('click', (e) => { e.stopPropagation(); this.handleRequestAction(declineBtn.dataset.id, 'reject'); });
            if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteNotification(el, item.data._id || item.data.id, 'workspace_request'); });
          }, 0);
        
        } else {
          const alert = item.data;
          let level = alert.level || 'info';
          let icon = 'info';
          let bgStyle = '';

          // Determine level and icon from notification type
          if (alert.type === 'COMMENT' || alert.isComment) {
            level = 'comment';
            icon = 'message-square';
            bgStyle = 'background: rgba(37,99,235,0.1); color: #2563EB;';
          } else if (alert.type === 'VALIDATION') {
            level = 'success';
            icon = 'shield-check';
            bgStyle = 'background: rgba(16,185,129,0.1); color: var(--success);';
          } else if (alert.type === 'NEWS') {
            level = 'info';
            icon = 'newspaper';
            bgStyle = 'background: rgba(139,92,246,0.1); color: #8B5CF6;';
          } else if (!alert.isCustom) {
            // Legacy AI detection notifications
            if (alert.aiStatus === 'TINGGI') { level = 'high'; icon = 'alert-triangle'; bgStyle = 'background: rgba(239,68,68,0.1); color: var(--error);'; }
            else if (alert.aiStatus === 'SEDANG') { level = 'medium'; icon = 'alert-circle'; bgStyle = 'background: rgba(245,158,11,0.1); color: var(--warning);'; }
            else if (alert.aiStatus === 'RENDAH') { level = 'low'; icon = 'eye'; }
            else { icon = 'video'; }
          } else {
            // Custom notifications (upload success, etc.)
            if (level === 'success') { icon = 'shield-check'; bgStyle = 'background: rgba(16,185,129,0.1); color: var(--success);'; }
            else if (level === 'high') { icon = 'alert-triangle'; bgStyle = 'background: rgba(239,68,68,0.1); color: var(--error);'; }
          }

          const titleText = alert.title || alert.location || 'Notifikasi Baru';
          const messageText = alert.message || (alert.isComment
            ? alert.message
            : `Terdeteksi indikasi ${alert.aiStatus || 'Aktif'} (${alert.aiConfidence || 0}%)`);

          el.innerHTML = `
            <div class="notif-item-content" style="display:flex; gap:10px; width:100%; transition: transform 0.3s ease;">
              <div class="notif-icon" style="${bgStyle}">
                <i data-lucide="${icon}"></i>
              </div>
              <div class="notif-content" style="flex:1; min-width:0;">
                <div class="notif-title" style="${!alert.read && alert._id ? 'font-weight:800;' : ''}">${titleText}</div>
                <div class="notif-desc">${messageText}</div>
                <div class="notif-time">${Formatter.formatTime ? Formatter.formatTime(alert.timestamp || alert.createdAt) : Formatter.formatDate(alert.timestamp || alert.createdAt)}</div>
              </div>
            </div>
            <div class="notif-delete-actions" style="position:absolute; right:0; top:0; bottom:0; display:flex; align-items:center; justify-content:center; background:var(--danger); padding:0 16px; color:white; transform:translateX(100%); transition:transform 0.3s ease;">
              <button class="notif-delete-btn" data-id="${alert._id || alert.id}" style="background:none; border:none; color:white; font-size:0.75rem; font-weight:700; cursor:pointer; padding:8px; display:flex; align-items:center; gap:4px;">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus
              </button>
            </div>
          `;

          // Add click handler for the content (navigate)
          const contentEl = el.querySelector('.notif-item-content');
          contentEl.addEventListener('click', () => {
            this.dropdown.classList.remove('active');
            // Mark as read if DB notification
            if (alert._id && !alert.read) {
              API.patch(`/api/notifications/${alert._id}/read`).catch(() => {});
            }
            Router.navigate(alert.actionUrl || `/dashboard/detections/${alert.id || alert.reportId}`);
          });

          // Add delete handler
          const deleteBtn = el.querySelector('.notif-delete-btn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => { 
              e.stopPropagation(); 
              this.deleteNotification(el, alert._id || alert.id, item.type === 'db_notification' ? 'db' : 'appstate');
            });
          }
        }

        // Add swipe-to-delete touch handlers
        this.addSwipeToDelete(el);

        listContainer.appendChild(el);
      });

      if (window.lucide) {
        window.lucide.createIcons();
      }
    }

    addSwipeToDelete(el) {
      let startX = 0;
      let currentX = 0;
      let isDragging = false;
      const contentEl = el.querySelector('.notif-item-content');
      const deleteActionsEl = el.querySelector('.notif-delete-actions');
      const threshold = 80; // px to trigger delete

      const handleTouchStart = (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
        contentEl.style.transition = 'none';
      };

      const handleTouchMove = (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        const deltaX = startX - currentX;
      
        if (deltaX > 0) {
          // Swipe left - reveal delete
          const translateX = Math.min(deltaX, 120);
          contentEl.style.transform = `translateX(-${translateX}px)`;
          deleteActionsEl.style.transform = `translateX(calc(-100% + ${translateX}px))`;
        }
      };

      const handleTouchEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        const deltaX = startX - currentX;
        contentEl.style.transition = 'transform 0.3s ease';
        deleteActionsEl.style.transition = 'transform 0.3s ease';
      
        if (deltaX > threshold) {
          // Trigger delete
          this.deleteNotification(el, el.dataset.notifId, el.dataset.notifType);
        } else {
          // Snap back
          contentEl.style.transform = 'translateX(0)';
          deleteActionsEl.style.transform = 'translateX(100%)';
        }
      };

      contentEl.addEventListener('touchstart', handleTouchStart, { passive: true });
      contentEl.addEventListener('touchmove', handleTouchMove, { passive: true });
      contentEl.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    async deleteNotification(el, notifId, type) {
      if (!notifId) return;
    
      try {
        // Animate out
        el.style.transform = 'translateX(-100%)';
        el.style.opacity = '0';
      
        if (type === 'db' || type === 'db_notification') {
          await API.request(`/api/notifications/${notifId}`, { method: 'DELETE' });
          // Remove from local array
          this.dbNotifications = this.dbNotifications.filter(n => n._id !== notifId);
        } else if (type === 'appstate' || type === 'alert') {
          const notifs = AppState.get('notifications') || [];
          const idx = notifs.findIndex(n => (n._id || n.id) === notifId);
          if (idx >= 0) {
            notifs.splice(idx, 1);
            AppState.set('notifications', notifs);
          }
        } else if (type === 'workspace_request') {
          // For workspace requests, we don't delete from server, just hide
          this.workspaceRequests = this.workspaceRequests.filter(r => (r._id || r.id) !== notifId);
        }
      
        // Wait for animation then remove
        setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
          this.renderList(); // Re-render to update badge
        }, 300);
      
        EventBus.emit('toast:show', { message: 'Notifikasi dihapus', type: 'success' });
      } catch (err) {
        console.error('Delete notification failed:', err);
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
        EventBus.emit('toast:show', { message: 'Gagal menghapus notifikasi', type: 'danger' });
      }
    }

  mapDBNotificationToAlert(n) {
    return {
      _id: n._id,
      id: n.reportId,
      reportId: n.reportId,
      type: n.type,
      title: n.title,
      message: n.message,
      actionUrl: n.actionUrl,
      icon: n.icon,
      level: n.priority === 'HIGH' ? 'high' : n.priority === 'MEDIUM' ? 'medium' : 'info',
      timestamp: n.createdAt,
      createdAt: n.createdAt,
      read: n.read,
      isCustom: true,
    };
  }
}
