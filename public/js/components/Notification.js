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
        <div class="empty-notifications">
          <i data-lucide="bell-off" style="width: 24px; height: 24px; color: var(--text-muted);"></i>
          <p>Tidak ada notifikasi baru</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    listContainer.innerHTML = '';
    
    // Render up to 10 alerts
    notifications.slice(0, 10).forEach(alert => {
      const item = document.createElement('div');
      
      // Class color based on threat level
      let levelClass = 'info';
      if (alert.aiStatus === 'TINGGI') levelClass = 'high';
      if (alert.aiStatus === 'SEDANG') levelClass = 'medium';
      if (alert.aiStatus === 'RENDAH') levelClass = 'low';

      const messageText = alert.isComment 
        ? alert.message 
        : `Terdeteksi indikasi ${alert.aiStatus} (${alert.aiConfidence || 0}%)`;

      item.className = `notification-item threat-${levelClass}`;
      item.innerHTML = `
        <div class="notification-item-dot"></div>
        <div class="notification-item-body">
          <div class="notification-item-title">${alert.location}</div>
          <div class="notification-item-text">${messageText}</div>
          <div class="notification-item-time">${Formatter.formatDate(alert.timestamp)}</div>
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
