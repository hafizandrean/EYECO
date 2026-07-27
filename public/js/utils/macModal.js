/**
 * macOS-Style Modal Dialogs for EYECO
 * Glassmorphism, blur backdrop, clean animations.
 */

export const MacModal = {
  /**
   * Show a confirm/cancel dialog ala macOS.
   * @param {string} title — Bold title
   * @param {string} desc — Description text
   * @param {string} iconType — 'danger' | 'warning' | 'success'
   * @param {string} confirmText — Label for confirm button
   * @param {string} cancelText — Label for cancel button
   * @param {'danger' | 'primary'} confirmStyle — Button style
   * @returns {Promise<boolean>} — true if confirmed, false if cancelled
   */
  confirm(title, desc, { iconType = 'warning', confirmText = 'Hapus', cancelText = 'Batal', confirmStyle = 'danger' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'macos-modal-overlay';
      overlay.innerHTML = `
        <div class="macos-modal">
          <div class="macos-modal-icon ${iconType}">
            <i data-lucide="${iconType === 'danger' ? 'alert-triangle' : iconType === 'warning' ? 'alert-circle' : 'check-circle'}" style="width:28px;height:28px;"></i>
          </div>
          <div class="macos-modal-title">${title}</div>
          <div class="macos-modal-desc">${desc}</div>
          <div class="macos-modal-actions">
            <button class="btn btn-secondary-sheet" id="mac-modal-cancel">${cancelText}</button>
            <button class="btn btn-${confirmStyle === 'danger' ? 'danger' : 'primary'}-sheet" id="mac-modal-confirm">${confirmText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      if (window.lucide) window.lucide.createIcons();

      const cleanup = () => {
        overlay.removeEventListener('click', handleOverlay);
        overlay.remove();
      };
      const handleOverlay = (e) => {
        if (e.target === overlay) { cleanup(); resolve(false); }
      };
      overlay.addEventListener('click', handleOverlay);

      overlay.querySelector('#mac-modal-cancel').addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
      overlay.querySelector('#mac-modal-confirm').addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      // Close on Escape
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          cleanup();
          resolve(false);
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);
    });
  },

  /**
   * Show a prompt with textarea input (for verification notes).
   * @param {string} title
   * @param {string} desc
   * @param {string} placeholder
   * @param {string} confirmText
   * @returns {Promise<string|null>} — notes string, or null if cancelled
   */
  prompt(title, desc, { placeholder = 'Catatan (opsional)...', confirmText = 'Simpan', iconType = 'warning' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'macos-modal-overlay';
      overlay.innerHTML = `
        <div class="macos-modal">
          <div class="macos-modal-icon ${iconType}">
            <i data-lucide="${iconType === 'danger' ? 'alert-triangle' : 'edit-3'}" style="width:28px;height:28px;"></i>
          </div>
          <div class="macos-modal-title">${title}</div>
          <div class="macos-modal-desc">${desc}</div>
          <textarea id="mac-modal-textarea" placeholder="${placeholder}"></textarea>
          <div class="macos-modal-actions">
            <button class="btn btn-secondary-sheet" id="mac-modal-cancel">Batal</button>
            <button class="btn btn-primary-sheet" id="mac-modal-confirm">${confirmText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      if (window.lucide) window.lucide.createIcons();

      const cleanup = () => {
        overlay.removeEventListener('click', handleOverlay);
        overlay.remove();
      };
      const handleOverlay = (e) => {
        if (e.target === overlay) { cleanup(); resolve(null); }
      };
      overlay.addEventListener('click', handleOverlay);

      overlay.querySelector('#mac-modal-cancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      overlay.querySelector('#mac-modal-confirm').addEventListener('click', () => {
        const val = overlay.querySelector('#mac-modal-textarea').value.trim();
        cleanup();
        resolve(val);
      });

      const escHandler = (e) => {
        if (e.key === 'Escape') {
          cleanup();
          resolve(null);
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);

      // Auto-focus textarea
      setTimeout(() => overlay.querySelector('#mac-modal-textarea').focus(), 100);
    });
  }
};
