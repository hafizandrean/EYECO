// Notification.js - Komponen Pusat Notifikasi (Bell Dropdown)
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';

export class NotificationCenter {
  constructor() {
    this.bellBtn = null;
    this.dropdown = null;
    this.badge = null;
    
    // Subscribe ke update notifications di AppState
    EventBus.on('state:notifications', ({ newValue }) => this.renderList(newValue));
    EventBus.on('state:unreadNotifications', ({ newValue }) => this.updateBadge(newValue));
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
      
      // Clear unread count when opened
      if (this.dropdown.classList.contains('active')) {
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
    
    // Initial render
    this.renderList(AppState.get('notifications') || []);
    this.updateBadge(AppState.get('unreadNotifications') || 0);
  }

  updateBadge(count) {
    if (!this.badge) return;
    if (count > 0) {
      this.badge.innerText = count;
      this.badge.classList.add('visible');
    } else {
      this.badge.classList.remove('visible');
    }
  }

  renderList(notifications) {
    const listContainer = document.getElementById('notification-list');
    if (!listContainer) return;

    if (notifications.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-notifications" style="text-align: center; padding: var(--space-24) 0; color: var(--text-muted); font-size: 0.8rem; font-weight: 500;">
          Tidak ada notifikasi baru
        </div>
      `;
      return;
    }

    listContainer.innerHTML = '';
    
    // Render up to 10 alerts
    notifications.slice(0, 10).forEach(alert => {
      const item = document.createElement('div');
      item.className = 'notification-item';

      let level = alert.level || 'info';
      if (!alert.isCustom) {
        // Fallback for default notifications (like notifications set in other components)
        if (alert.aiStatus === 'TINGGI') level = 'high';
        else if (alert.aiStatus === 'SEDANG') level = 'medium';
        else if (alert.aiStatus === 'RENDAH') level = 'low';
        else if (alert.isComment) level = 'comment';
      }

      let label = 'I';
      if (level === 'high') label = 'H';
      else if (level === 'medium') label = 'M';
      else if (level === 'low') label = 'L';
      else if (level === 'success') label = 'S';
      else if (level === 'comment') label = 'C';

      const titleText = alert.location || 'Notifikasi Baru';
      const messageText = alert.message || (alert.isComment 
        ? alert.message 
        : `Terdeteksi indikasi ${alert.aiStatus || 'Aktif'} (${alert.aiConfidence || 0}%)`);

      item.innerHTML = `
        <div class="notif-icon-wrapper ${level}" style="display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 900; font-family: 'Outfit', sans-serif; flex-shrink: 0;">
          ${label}
        </div>
        <div class="notification-item-body">
          <div class="notification-item-title">${titleText}</div>
          <div class="notification-item-text">${messageText}</div>
        </div>
        <div class="notification-item-time">
          ${Formatter.formatTime ? Formatter.formatTime(alert.timestamp) : Formatter.formatDate(alert.timestamp)}
        </div>
      `;

      item.addEventListener('click', () => {
        this.dropdown.classList.remove('active');
        Router.navigate(`/dashboard/detections/${alert.id}`);
      });

      listContainer.appendChild(item);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}
