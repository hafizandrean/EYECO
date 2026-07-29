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
  confirm(titleOrObj, desc, options = {}) {
    let title = titleOrObj;
    let message = desc;
    let opt = options;

    if (typeof titleOrObj === 'object' && titleOrObj !== null) {
      title = titleOrObj.title || 'Konfirmasi';
      message = titleOrObj.message || titleOrObj.desc || '';
      opt = titleOrObj;
    }

    const iconType = opt.iconType || opt.type || 'warning';
    const confirmText = opt.confirmText || 'Confirm';
    const cancelText = opt.cancelText || 'Cancel';
    const confirmStyle = opt.confirmStyle || (iconType === 'danger' ? 'danger' : 'primary');

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'macos-modal-overlay';
      overlay.innerHTML = `
        <div class="macos-modal">
          <div class="macos-modal-icon ${iconType}">
            <i data-lucide="${iconType === 'danger' ? 'alert-triangle' : iconType === 'warning' ? 'alert-circle' : 'check-circle'}" style="width:28px;height:28px;"></i>
          </div>
          <div class="macos-modal-title">${title}</div>
          <div class="macos-modal-desc">${message}</div>
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
   * @param {string|object} titleOrObj
   * @param {string} desc
   * @param {object} options
   * @returns {Promise<string|null>} — notes string, or null if cancelled
   */
  prompt(titleOrObj, desc, options = {}) {
    let title = titleOrObj;
    let message = desc;
    let opt = options;

    if (typeof titleOrObj === 'object' && titleOrObj !== null) {
      title = titleOrObj.title || 'Input';
      message = titleOrObj.message || titleOrObj.desc || '';
      opt = titleOrObj;
    }

    const placeholder = opt.placeholder || 'Catatan (opsional)...';
    const confirmText = opt.confirmText || 'Simpan';
    const iconType = opt.iconType || opt.type || 'warning';

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'macos-modal-overlay';
      overlay.innerHTML = `
        <div class="macos-modal">
          <div class="macos-modal-icon ${iconType}">
            <i data-lucide="${iconType === 'danger' ? 'alert-triangle' : 'edit-3'}" style="width:28px;height:28px;"></i>
          </div>
          <div class="macos-modal-title">${title}</div>
          <div class="macos-modal-desc">${message}</div>
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
  },

  /**
   * Show a non-dismissible macOS-style progress overlay with spinner + message.
   * @param {string} title — Bold title
   * @param {string} message — Status description
   * @returns {{ close: () => void, setMessage: (msg: string) => void }}
   */
  progress(title, message = '') {
    const overlay = document.createElement('div');
    overlay.className = 'macos-modal-overlay';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.innerHTML = `
      <div class="macos-modal" style="text-align:center;gap:12px;cursor:default;">
        <div class="macos-spinner" style="width:36px;height:36px;border:3px solid rgba(37,99,235,0.15);border-top:3px solid #2563eb;border-radius:50%;animation:macSpin 0.8s linear infinite;margin:8px auto;"></div>
        <div class="macos-modal-title">${title}</div>
        <div class="macos-modal-desc" id="mac-progress-msg">${message}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons();

    // Prevent dismiss on backdrop click / escape
    overlay.onclick = (e) => { if (e.target === overlay) return; };
    document.addEventListener('keydown', _ignoreEsc);

    function _ignoreEsc(e) {
      if (e.key === 'Escape') e.stopImmediatePropagation();
    }

    return {
      close() {
        document.removeEventListener('keydown', _ignoreEsc);
        overlay.remove();
      },
      setMessage(msg) {
        const el = overlay.querySelector('#mac-progress-msg');
        if (el) el.textContent = msg;
      }
    };
  }
};
