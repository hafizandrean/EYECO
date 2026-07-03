// Modal.js - Pembungkus & Kontrol Modal Fleksibel EYECO
export const Modal = {
  // Buka modal berdasarkan ID modal
  open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      // Autofocus input utama jika ada di dalam modal
      const autoFocusInput = modal.querySelector('[autofocus]');
      if (autoFocusInput) {
        setTimeout(() => autoFocusInput.focus(), 50);
      }
    }
  },

  // Tutup modal berdasarkan ID modal
  close(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  },

  // Menutup modal aktif saat ini
  closeActive() {
    const activeModals = document.querySelectorAll('.modal.active');
    activeModals.forEach(modal => modal.classList.remove('active'));
  }
};

// Bind esc key to close all modals automatically
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    Modal.closeActive();
  }
});
