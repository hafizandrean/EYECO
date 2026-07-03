// Toast.js - Komponen Notifikasi Toast Melayang
import { EventBus } from '../core/eventBus.js';

class ToastManager {
  constructor() {
    this.container = null;
    this.initContainer();

    // Subscribe ke event toast:show
    EventBus.on('toast:show', (data) => this.show(data.message, data.type));
  }

  initContainer() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  show(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} glass-card`;
    
    // Choose icon based on type using lucide
    let iconName = 'check-circle';
    if (type === 'danger') iconName = 'alert-octagon';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'info') iconName = 'info';

    toast.innerHTML = `
      <i data-lucide="${iconName}" class="toast-icon"></i>
      <span class="toast-message">${message}</span>
      <button class="toast-close">&times;</button>
    `;

    this.container.appendChild(toast);
    
    // Initialize Lucide icon
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Trigger reflow to apply slide-in animation
    toast.getBoundingClientRect();
    toast.classList.add('visible');

    // Close button handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toast));

    // Auto dismiss after 4 seconds
    setTimeout(() => {
      this.dismiss(toast);
    }, 4000);
  }

  dismiss(toast) {
    if (!toast.parentNode) return;
    toast.classList.remove('visible');
    
    // Remove from DOM after fade-out transition completes (250ms)
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }
}

export const Toast = new ToastManager();
