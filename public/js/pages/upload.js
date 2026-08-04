// upload.js - Kontroler Halaman Unggah Bukti Baru (ChatGPT-style AI Scanner)
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';

export class UploadPage {
  constructor() {
    this.selectedFile = null;
    this.historyReports = [];
    this.isScanning = false;
    this.scanCompleted = false;
  }

  // Merender halaman form upload & riwayat
  async render(container) {
    container.innerHTML = `
      <div class="upload-container-layout" style="animation: pageFadeIn var(--motion-open);">
        <!-- Left: Upload Form -->
        <main class="upload-card" id="upload-main-card" style="padding: 0; background: transparent; border: none; box-shadow: none;">
          <div class="card-header-clean" style="margin-bottom: var(--space-24); text-align: center; background: transparent;">
            <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.8rem; font-weight: 800; color: var(--text-primary); margin: 0 0 8px 0;">Lapor Keadaan Lingkungan</h2>
            <p style="font-size: 0.92rem; color: var(--text-secondary); margin: 0 auto; max-width: 500px;">Seret media foto lingkungan untuk mendeteksi pencemaran sampah otomatis berbasis AI</p>
            <div style="height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent); margin: 20px auto 0; width: 100%;"></div>
          </div>

          <form id="upload-form-element" class="upload-form" enctype="multipart/form-data" style="display: flex; flex-direction: column; gap: var(--space-20);">
            <!-- Drag & Drop Area -->
            <div class="form-group">
              <div class="drag-drop-zone glass-card" id="drop-zone" style="min-height: 560px; border: 2px dashed rgba(47,107,255,0.25); border-radius: var(--radius-card); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden; background: rgba(255,255,255,0.45);">
                <input type="file" id="upload-input-file" accept="image/jpeg,image/jpg,image/png,video/mp4" required style="display: none;">
                
                <!-- Initial State -->
                <div class="drag-drop-content" id="drop-zone-content" style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: var(--space-24);">
                  <div style="width: 68px; height: 68px; border-radius: 50%; background: rgba(47,107,255,0.06); color: var(--primary); display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="image" style="width: 30px; height: 30px;"></i>
                  </div>
                  <p style="font-size: 1.05rem; color: var(--text-primary); font-weight: 700; margin: 8px 0 0;">Seret & lepas gambar di sini, atau klik untuk memilih</p>
                  <p style="font-size: 0.75rem; color: var(--text-secondary); margin: 0;">Mendukung format JPG, JPEG, PNG, MP4 hingga 10MB</p>
                  <div style="display:flex; gap:8px; margin-top:8px;">
                    <button type="button" class="btn btn-glass btn-rounded btn-sm" id="btn-camera-capture" style="font-size:0.82rem; padding:8px 18px; display:flex; align-items:center; gap:6px;">
                      <i data-lucide="camera" style="width:16px;height:16px;"></i> Buka Kamera
                    </button>
                    <button type="button" class="btn btn-glass btn-rounded btn-sm" id="btn-browse-files" style="font-size:0.82rem; padding:8px 18px; display:flex; align-items:center; gap:6px;">
                      <i data-lucide="folder-open" style="width:16px;height:16px;"></i> Pilih File
                    </button>
                  </div>
                </div>

                <!-- Drag Overlay State -->
                <div class="drag-overlay" id="drag-overlay" style="display: none; position: absolute; inset: 0; background: rgba(47, 107, 255, 0.1); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 10; align-items: center; justify-content: center; flex-direction: column; gap: 16px; transition: all 0.2s;">
                  <div id="drag-indicator" style="width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; transition: all 0.2s;">
                    <i data-lucide="plus" style="width: 40px; height: 40px; color: var(--success);"></i>
                  </div>
                  <p id="drag-text" style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin: 0;">Lepaskan untuk mengunggah</p>
                </div>

                <!-- Preview Area -->
                <div class="file-preview-container" id="file-preview" style="display: none; width: 100%; height: 100%; position: absolute; top: 0; left: 0; align-items: center; justify-content: center; background: #0b0f19;">
                  <!-- Dynamic Preview image and Bounding Box nodes injected here -->
                </div>
              </div>
            </div>

            <!-- Metadata Fields (shown immediately after file select) -->
            <div id="form-metadata-fields" style="display: none; flex-direction: column; gap: var(--space-16); animation: pageFadeIn 0.3s ease;">
              <!-- Location Input -->
              <div class="form-group">
                <label class="form-label" for="input-location">Lokasi Lingkungan / Sektor <span class="required">*</span></label>
                <input type="text" class="form-control input-rounded" id="input-location" placeholder="Masukkan lokasi detail lingkungan (e.g. Lingkungan Ciliwung Pintu Air Manggarai)" required>
              </div>

              <!-- Datetime Input -->
              <div class="form-group">
                <label class="form-label" for="input-time">Waktu Pengamatan <span class="required">*</span></label>
                <div class="input-btn-group">
                  <input type="datetime-local" class="form-control input-rounded" id="input-time" required style="flex: 1;">
                  <button type="button" class="btn btn-glass btn-rounded" id="btn-autofill-time">Sekarang</button>
                </div>
              </div>

              <!-- Notes Description -->
              <div class="form-group">
                <label class="form-label" for="input-notes">Deskripsi Visual Laporan (Opsional)</label>
                <textarea class="form-control textarea-rounded" id="input-notes" placeholder="Tambahkan deskripsi atau ciri-ciri khusus sampah lingkungan di lokasi..."></textarea>
              </div>

              <!-- Submit Button -->
              <button type="submit" class="btn btn-primary btn-rounded" id="btn-submit-report" style="width: 100%; height: 48px; margin-top: 8px; font-weight: 700;">
                <i data-lucide="send"></i> Kirim Laporan Resmi
              </button>
            </div>
          </form>
        </main>

        <!-- Right: Upload History Card -->
        <section class="glass-card history-card" id="upload-history-card" style="padding: var(--space-32);">
          <div style="margin-bottom: var(--space-24); display: flex; flex-direction: column; align-items: flex-start; gap: 4px;">
            <h3 class="section-title" style="margin: 0; font-size: 1.15rem; font-weight: 800;"><i data-lucide="clock" style="color: var(--primary);"></i> Riwayat Laporan Saya</h3>
            <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0; line-height: 1.4;">Pantau perkembangan penanganan insiden yang Anda laporkan</p>
          </div>

          <div class="history-list" id="history-list-container" style="display: flex; flex-direction: column; gap: var(--space-12);">
            <!-- Populated dynamically -->
          </div>
        </section>
      </div>

      <!-- Upload Processing Modal -->
      <div class="modal-overlay" id="upload-progress-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:9999; align-items:center; justify-content:center;">
        <div class="modal-content" style="background:var(--card-bg); border-radius:var(--radius-card); padding:var(--space-32); max-width:400px; width:90%; text-align:center; border:1px solid var(--border); box-shadow:var(--shadow-xl);">
          <div id="upload-modal-state">
            <!-- Processing State -->
            <div id="modal-processing">
              <div class="upload-spinner" style="width:56px; height:56px; border:4px solid var(--surface-soft); border-top-color:var(--primary); border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 20px;"></div>
              <h3 style="font-family:'Outfit',sans-serif; font-weight:700; font-size:1.2rem; margin:0 0 8px; color:var(--text-primary); text-align:center;">Memproses Laporan</h3>
              <p style="font-size:0.85rem; color:var(--text-secondary); margin:0; text-align:center;">AI sedang memverifikasi dan menyimpan laporan Anda...</p>
            </div>
            <!-- Success State -->
            <div id="modal-success" style="display:none;">
              <div style="width:56px; height:56px; border-radius:50%; background:rgba(16,185,129,0.12); display:flex; align-items:center; justify-content:center; margin:0 auto 20px;">
                <i data-lucide="check-circle" style="width:32px; height:32px; color:#10B981;"></i>
              </div>
              <h3 style="font-family:'Outfit',sans-serif; font-weight:700; font-size:1.2rem; margin:0 0 8px; color:var(--text-primary); text-align:center;">Laporan Terkirim!</h3>
              <p style="font-size:0.85rem; color:var(--text-secondary); margin:0; text-align:center;">Laporan Anda berhasil disimpan dan akan segera diproses.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.autofillCurrentTime();
    
    // Load history
    await this.loadHistory();
  }

  bindEvents() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('upload-input-file');
    const autofillBtn = document.getElementById('btn-autofill-time');
    const form = document.getElementById('upload-form-element');
    const dragOverlay = document.getElementById('drag-overlay');
    const dragIndicator = document.getElementById('drag-indicator');
    const dragText = document.getElementById('drag-text');

    // Camera capture
    const cameraBtn = document.getElementById('btn-camera-capture');
    if (cameraBtn) {
      cameraBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCamera();
      });
    }

    // Browse files
    const browseBtn = document.getElementById('btn-browse-files');
    if (browseBtn) {
      browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput?.click();
      });
    }

    if (dropZone && fileInput) {
      // Click on drop zone itself opens file picker (only if not on buttons)
      dropZone.addEventListener('click', (e) => {
        if (e.target === dropZone || e.target.closest('.drag-drop-content')) {
          if (!this.isScanning) fileInput.click();
        }
      });

      // Depth counter: dragenter/dragleave fire per child element; only reset
      // when leaving the whole zone (counter back to 0) to avoid flicker/glitch.
      let dragDepth = 0;

      // Drag and drop handlers
      dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragDepth++;
        if (!this.isScanning && dragDepth === 1) {
          dropZone.classList.add('dragover');
          // Blur effect di zone saat drag (glassmorphism) + tint
          dropZone.style.backdropFilter = 'blur(14px)';
          dropZone.style.webkitBackdropFilter = 'blur(14px)';
          dropZone.style.background = 'rgba(47,107,255,0.08)';
          if (dragOverlay) {
            dragOverlay.style.display = 'flex';
          }
        }
      });

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!this.isScanning) {
          dropZone.classList.add('dragover');
          // Check if file is supported
          const file = e.dataTransfer.files[0];
          if (file) {
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
            const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov'];
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            const isSupported = allowedTypes.includes(file.type) || allowedExts.includes(ext);

            if (dragIndicator && dragText) {
              if (isSupported) {
                dragIndicator.innerHTML = '<i data-lucide="plus" style="width: 40px; height: 40px; color: #10B981;"></i>';
                dragIndicator.style.background = 'rgba(16, 185, 129, 0.15)';
                dragText.textContent = 'Lepaskan untuk mengunggah';
                dragText.style.color = '#10B981';
              } else {
                dragIndicator.innerHTML = '<i data-lucide="minus" style="width: 40px; height: 40px; color: #EF4444;"></i>';
                dragIndicator.style.background = 'rgba(239, 68, 68, 0.15)';
                dragText.textContent = 'Format tidak didukung';
                dragText.style.color = '#EF4444';
              }
              if (window.lucide) window.lucide.createIcons();
            }
          }
        }
      });

      dropZone.addEventListener('dragleave', (e) => {
        dragDepth--;
        if (dragDepth <= 0) {
          dragDepth = 0;
          // Only reset when truly leaving the zone
          const rect = dropZone.getBoundingClientRect();
          const x = e.clientX, y = e.clientY;
          if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            this.resetDropZone(dropZone, dragOverlay);
          }
        }
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dragDepth = 0;
        this.resetDropZone(dropZone, dragOverlay);
        if (this.isScanning) return;
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          this.handleFileSelected(files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
          this.handleFileSelected(fileInput.files[0]);
        }
      });
    }

    if (autofillBtn) {
      autofillBtn.addEventListener('click', () => this.autofillCurrentTime());
    }

    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
    }
  }

  resetDropZone(dropZone, dragOverlay) {
    if (!dropZone) return;
    dropZone.classList.remove('dragover');
    // Clear blur effect
    dropZone.style.backdropFilter = '';
    dropZone.style.webkitBackdropFilter = '';
    dropZone.style.background = 'rgba(255,255,255,0.45)';
    if (dragOverlay) {
      dragOverlay.style.display = 'none';
    }
  }

  autofillCurrentTime() {
    const timeInput = document.getElementById('input-time');
    if (!timeInput) return;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    timeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  async openCamera() {
    const overlay = document.createElement('div');
    overlay.className = 'macos-modal-overlay';
    overlay.id = 'camera-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--surface);border-radius:var(--radius-xl);padding:24px;max-width:720px;width:95%;text-align:center;box-shadow:var(--shadow-xl);">
        <h3 style="font-family:'Outfit',sans-serif;font-weight:800;margin:0 0 12px;display:flex;align-items:center;gap:8px;justify-content:center;">
          <i data-lucide="scan" style="width:20px;height:20px;color:var(--primary);"></i> Live AI Detection
        </h3>
        <div style="position:relative;background:#000;border-radius:var(--radius-lg);overflow:hidden;min-height:340px;display:flex;align-items:center;justify-content:center;">
          <video id="camera-feed" autoplay playsinline style="width:100%;max-height:440px;object-fit:contain;display:block;"></video>
          <div id="camera-detection-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;align-items:center;margin-top:12px;">
          <span id="cam-live-status" style="font-size:0.75rem;font-weight:700;color:var(--success);display:flex;align-items:center;gap:6px;">
            <span id="cam-live-dot" style="width:8px;height:8px;border-radius:50%;background:#10B981;display:inline-block;"></span>
            Live Detection Aktif
          </span>
          <span id="cam-detect-count" style="font-size:0.75rem;color:var(--text-secondary);font-weight:600;">0 detected</span>
          <button type="button" class="btn btn-secondary-sheet" id="btn-cam-close" style="padding:8px 20px;font-weight:700;">
            <i data-lucide="x" style="width:16px;height:16px;"></i> Stop
          </button>
        </div>
        <div id="camera-detection-result" style="margin-top:8px;display:none;font-size:0.75rem;font-weight:600;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons();

    const video = document.getElementById('camera-feed');
    const closeBtn = document.getElementById('btn-cam-close');
    const overlayBoxes = document.getElementById('camera-detection-overlay');
    const detectCount = document.getElementById('cam-detect-count');
    const liveDot = document.getElementById('cam-live-dot');

    let stream = null;
    let detecting = false;
    let frameTimer = null;
    let totalDetected = 0;
    let lastAutoUpload = 0;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      const resultDiv = document.getElementById('camera-detection-result');
      if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.innerHTML = '<span style="color:var(--danger);">Gagal membuka kamera. Izinkan akses kamera di browser.</span>'; }
      return;
    }

    // Tunggu video benar-benar siap
    await new Promise(r => { if (video.videoWidth) r(); else video.onloadedmetadata = r; });

    // ── Live continuous detection ──
    const processFrame = async () => {
      if (detecting || !stream || !video.videoWidth) return;
      detecting = true;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const blob = await (await fetch(dataUrl)).blob();
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      try {
        const res = await fetch('/api/detect-preview', { method: 'POST', body: formData, credentials: 'include' });
        const data = await res.json();

        if (data.success) {
          if (data.boxes?.length > 0) {
            // Render bounding boxes langsung di video
            overlayBoxes.innerHTML = data.boxes.map(b => `
              <div style="position:absolute;top:${b.y}%;left:${b.x}%;width:${b.w}%;height:${b.h}%;border:2px solid ${b.label === 'person' ? '#10B981' : '#EF4444'};background:${b.label === 'person' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};border-radius:4px;display:flex;align-items:flex-end;justify-content:flex-start;">
                <span style="background:${b.label === 'person' ? '#10B981' : '#EF4444'};color:white;font-size:9px;font-weight:800;padding:1px 5px;border-radius:0 4px 0 0;">${b.label} ${b.confidence}%</span>
              </div>`).join('');

            const hasPerson = data.boxes.some(b => b.label === 'person');
            if (hasPerson) {
              totalDetected++;
              detectCount.textContent = `${totalDetected} person detected`;
              liveDot.style.background = '#EF4444';
              liveDot.style.animation = 'pulse-dot 0.6s ease-in-out infinite';

              // Auto-upload setiap 10 detik (kalo masih ada person)
              const now = Date.now();
              if (now - lastAutoUpload > 10_000) {
                lastAutoUpload = now;
                const formData2 = new FormData();
                formData2.append('file', blob, `auto_${Date.now()}.jpg`);
                formData2.append('location', 'Lokasi tidak diketahui');
                formData2.append('sourceType', 'AI_CCTV');
                formData2.append('additionalNotes', 'Auto-capture dari live AI detection');
                try {
                  const uploadRes = await fetch('/api/detections', { method: 'POST', body: formData2, credentials: 'include' });
                  if (uploadRes.ok) {
                    const newReport = await uploadRes.json();
                    // Matiin kamera + stop semua track + redirect
                    if (frameTimer) clearInterval(frameTimer);
                    detecting = false;
                    if (stream) stream.getTracks().forEach(t => t.stop());
                    overlay.remove();
                    window.location.href = `/dashboard/detections/${newReport.id}`;
                  }
                } catch (_) {}
              }
            } else {
              liveDot.style.background = '#10B981';
              liveDot.style.animation = 'pulse-dot 0.8s ease-in-out infinite';
            }
          } else {
            overlayBoxes.innerHTML = '';
            liveDot.style.background = '#10B981';
            liveDot.style.animation = 'pulse-dot 0.8s ease-in-out infinite';
          }
        }
      } catch (_) { /* skip frame on error */ }

      detecting = false;
    };

    // Mulai continuous detection setiap 3 detik
    frameTimer = setInterval(processFrame, 3000);
    // Langsung jalanin sekali pas buka
    setTimeout(processFrame, 500);

    // Stop
    const doClose = () => {
      if (frameTimer) clearInterval(frameTimer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      detecting = false;
      overlay.remove();
    };
    closeBtn?.addEventListener('click', doClose);
    overlay.addEventListener('click', e => { if (e.target === overlay) doClose(); });
  }

  injectDetectionBoxes(boxes, aiStatus, total) {
    const preview = document.getElementById('file-preview');
    if (!preview || boxes.length === 0) return;
    // Tambah overlay bounding box + status bar di preview
    const statusBar = document.createElement('div');
    statusBar.id = 'camera-ai-status-bar';
    statusBar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:6px 12px;background:rgba(0,0,0,0.7);color:white;font-size:0.72rem;font-weight:700;display:flex;justify-content:space-between;z-index:10;';
    statusBar.innerHTML = `
      <span>AI: ${aiStatus}</span>
      <span>${total} objek</span>
    `;
    preview.appendChild(statusBar);

    boxes.forEach((b) => {
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;top:${b.y}%;left:${b.x}%;width:${b.w}%;height:${b.h}%;border:2px solid ${b.label === 'person' ? '#10B981' : '#EF4444'};background:${b.label === 'person' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'};border-radius:3px;pointer-events:none;z-index:5;display:flex;align-items:flex-end;`;
      box.innerHTML = `<span style="background:${b.label === 'person' ? '#10B981' : '#EF4444'};color:white;font-size:8px;font-weight:800;padding:1px 4px;border-radius:0 3px 0 0;">${b.label} ${b.confidence}%</span>`;
      preview.appendChild(box);
    });
  }

  handleFileSelected(file) {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'video/mp4'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.mp4'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      EventBus.emit('toast:show', {
        message: 'Format file tidak didukung. Gunakan JPG, JPEG, PNG, atau MP4.',
        type: 'warning'
      });
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      EventBus.emit('toast:show', {
        message: 'Ukuran file maksimal 10MB. Pilih file yang lebih kecil.',
        type: 'warning'
      });
      return;
    }

    this.selectedFile = file;

    const previewContainer = document.getElementById('file-preview');
    const zoneContent = document.getElementById('drop-zone-content');

    if (!previewContainer || !zoneContent) return;

    zoneContent.style.display = 'none';
    previewContainer.style.display = 'flex';
    previewContainer.innerHTML = '';
    
    // Set file input files (compatibility for drag & drop)
    const fileInput = document.getElementById('upload-input-file');
    if (fileInput && fileInput.files[0] !== file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    }

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewContainer.innerHTML = `
          <img src="${e.target.result}" alt="Preview" style="width:100%; height:100%; object-fit:contain;">
          <button type="button" class="btn-remove-file" id="btn-clear-file" style="position:absolute; top:12px; right:12px; z-index:20; background:rgba(0,0,0,0.6); border:none; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer;">&times;</button>
        `;
        
        document.getElementById('btn-clear-file').addEventListener('click', (e) => {
          e.stopPropagation();
          this.clearFileSelection();
        });

        // Show metadata fields directly
        this.showMetadataFields();
      };
      reader.readAsDataURL(file);
    } else {
      // Video
      previewContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; gap: 8px;">
          <i data-lucide="video" style="width: 48px; height: 48px; color: var(--primary);"></i>
          <span style="font-size:0.85rem; font-weight:700;">${file.name}</span>
        </div>
        <button type="button" class="btn-remove-file" id="btn-clear-file" style="position:absolute; top:12px; right:12px; z-index:20; background:rgba(0,0,0,0.6); border:none; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer;">&times;</button>
      `;
      
      document.getElementById('btn-clear-file').addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearFileSelection();
      });
      if (window.lucide) window.lucide.createIcons();

      // Show metadata fields directly
      this.showMetadataFields();
    }
  }

  showMetadataFields() {
    const fieldsPanel = document.getElementById('form-metadata-fields');
    if (fieldsPanel) fieldsPanel.style.display = 'flex';
  }

  clearFileSelection() {
    this.selectedFile = null;
    this.isScanning = false;
    this.scanCompleted = false;

    const fileInput = document.getElementById('upload-input-file');
    if (fileInput) fileInput.value = '';
    
    const previewContainer = document.getElementById('file-preview');
    const zoneContent = document.getElementById('drop-zone-content');
    const fieldsPanel = document.getElementById('form-metadata-fields');

    if (previewContainer) previewContainer.style.display = 'none';
    if (zoneContent) zoneContent.style.display = 'flex';
    if (fieldsPanel) fieldsPanel.style.display = 'none';
  }

  // Handle form upload
  async handleSubmit(e) {
    e.preventDefault();

    // Guard: prevent duplicate upload while scanning or already completed
    if (this.isScanning || this.scanCompleted) {
      console.log('[UPLOAD] handleSubmit ditolak — sedang memproses atau sudah selesai.');
      return;
    }

    if (!this.selectedFile) {
      EventBus.emit('toast:show', { message: 'Silakan pilih file gambar/video terlebih dahulu.', type: 'warning' });
      return;
    }

    const btnSubmit = document.getElementById('btn-submit-report');
    const origHtml = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="status-pulse-dot" style="width:8px; height:8px; background:white; border-radius:50%; display:inline-block; margin-right:6px;"></span> Mengirim Laporan...`;

    // Show processing modal
    const modal = document.getElementById('upload-progress-modal');
    const modalProcessing = document.getElementById('modal-processing');
    const modalSuccess = document.getElementById('modal-success');
    if (modal) modal.style.display = 'flex';
    if (modalProcessing) modalProcessing.style.display = 'block';
    if (modalSuccess) modalSuccess.style.display = 'none';
    if (window.lucide) window.lucide.createIcons();

    const location = document.getElementById('input-location').value.trim();
    const time = document.getElementById('input-time').value;
    const notes = document.getElementById('input-notes').value.trim();

    // Validate required fields — do NOT re-enable btnSubmit; user must still fill and submit afresh
    if (!location) {
      EventBus.emit('toast:show', { message: 'Lokasi lingkungan wajib diisi.', type: 'warning' });
      return;
    }
    if (!time) {
      EventBus.emit('toast:show', { message: 'Waktu pengamatan wajib diisi.', type: 'warning' });
      return;
    }

    // Prepare Multipart Form Data
    const formData = new FormData();
    formData.append('location', location);
    formData.append('identity', 'Citizen');
    // Guard against invalid date input
    const parsedDate = new Date(time);
    formData.append('timestamp', isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString());
    formData.append('sourceType', this.selectedFile.type.startsWith('video/') ? 'Video' : 'Gambar');
    formData.append('additionalNotes', notes);
    formData.append('file', this.selectedFile);

    let success = false;
    try {
      const response = await ReportService.uploadReport(formData);
      
      // ===== EXTREME LOG FRONTEND =====
      console.log('=== [UPLOAD_EXTREME] Response dari server ===');
      console.log('response type:', typeof response);
      console.log('response keys:', Object.keys(response || {}));
      console.log('response.id:', response?.id, '(type:', typeof response?.id, ')');
      console.log('response._id:', response?._id, '(type:', typeof response?._id, ')');
      console.log('response.data:', response?.data);
      if (response?.data) {
        console.log('response.data.id:', response.data.id, '(type:', typeof response.data.id, ')');
        console.log('response.data._id:', response.data._id);
      }
      console.log('Full response JSON:', JSON.stringify(response, null, 2));
      
      EventBus.emit('toast:show', { message: 'Laporan berhasil divalidasi AI & disimpan!', type: 'success' });
      
      // Push notification untuk user — upload berhasil
      const user = AppState.get('user');
      if (user) {
        const notifications = AppState.get('notifications') || [];
        notifications.unshift({
          id: response?.id || response?._id || Date.now(),
          location: response?.location || 'Lokasi tidak diketahui',
          aiStatus: 'Info',
          aiConfidence: 0,
          timestamp: new Date(),
          isComment: false,
          isCustom: true,
          level: 'success',
          message: 'Laporan Anda berhasil diunggah dan sedang diproses AI.'
        });
        AppState.set('notifications', notifications);
        AppState.set('unreadNotifications', (AppState.get('unreadNotifications') || 0) + 1);
      }
      
      console.log('[UPLOAD_FRONTEND] Response dari server:', JSON.stringify(response, null, 2));
      
      // Transition modal from processing → success
      if (modalProcessing) modalProcessing.style.display = 'none';
      if (modalSuccess) {
        modalSuccess.style.display = 'block';
        // Animate success icon in
        const successIcon = modalSuccess.querySelector('i');
        if (successIcon) {
          successIcon.style.transform = 'scale(0)';
          successIcon.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
          requestAnimationFrame(() => { successIcon.style.transform = 'scale(1)'; });
        }
      }
      if (window.lucide) window.lucide.createIcons();
      
      this.isScanning = true;
      success = true;
      
      // Redirect ke detail laporan yang barusan diupload
      const reportId = response?.id || response?._id;
      setTimeout(() => {
        if (modal) modal.style.display = 'none';
        if (reportId) {
          Router.navigate(`/dashboard/detections/${reportId}`);
        } else {
          Router.navigate('/dashboard/laporan');
        }
      }, 800);
    } catch (err) {
      EventBus.emit('toast:show', { message: `Gagal mengirim laporan: ${err.message}`, type: 'danger' });
      if (modal) modal.style.display = 'none';
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = origHtml;
    } finally {
      if (!success) {
        this.isScanning = false;
      }
    }
  }

  async loadHistory() {
    const listContainer = document.getElementById('history-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-notifications" style="font-size:0.8rem; color:var(--text-secondary);">Memuat riwayat...</div>';

    try {
      const response = await ReportService.getFilteredReports({ limit: 10 });
      this.historyReports = response.reports || [];

      listContainer.innerHTML = '';

      if (this.historyReports.length === 0) {
        listContainer.innerHTML = `
          <div class="glass-card" style="padding: 24px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border);">
            <i data-lucide="folder-open" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
            <p style="font-size:0.78rem; margin:0;">Belum ada riwayat laporan warga</p>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      this.historyReports.slice(0, 6).forEach(report => {
        const aiStatus = report.aiStatus || 'Tidak Terindikasi';
        let levelClass = 'none';
        let aiBadgeColor = 'var(--text-muted)';
        let aiBadgeBg = 'var(--surface-soft)';
        const as = (aiStatus || '').toUpperCase().replace('INDIKASI ', '');
        if (as === 'TINGGI') { levelClass = 'high'; aiBadgeColor = 'var(--danger)'; aiBadgeBg = '#fef2f2'; }
        else if (as === 'SEDANG') { levelClass = 'medium'; aiBadgeColor = 'var(--warning)'; aiBadgeBg = '#fffbeb'; }
        else if (as === 'RENDAH') { levelClass = 'low'; aiBadgeColor = '#ca8a04'; aiBadgeBg = '#fefce8'; }
        else { levelClass = 'none'; aiBadgeColor = 'var(--text-muted)'; aiBadgeBg = 'var(--surface-soft)'; }

        // Replaced spreadsheet with timeline card
        const isVideoImage = report.image && report.image.endsWith('.mp4');
        const thumbnailHtml = isVideoImage
          ? `<div style="display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; background: var(--surface-soft); color: var(--text-muted);"><i data-lucide="video" style="width: 20px; height: 20px;"></i></div>`
          : `<img src="${report.image}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';"><div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: var(--surface-soft); color: var(--text-muted);"><i data-lucide="image" style="width: 20px; height: 20px;"></i></div>`;

        const card = document.createElement('div');
        card.className = 'glass-card hover-lift';
        card.style.cssText = 'padding: 12px 14px; display: flex; gap: 12px; align-items: center; cursor: pointer; border: 1px solid var(--border);';
        
        card.innerHTML = `
          <div class="history-thumbnail" style="width: 48px; height: 48px; border-radius: 8px; overflow: hidden; background: var(--surface-soft); flex-shrink: 0; position: relative; display: flex; align-items: center; justify-content: center;">
            ${thumbnailHtml}
          </div>
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;">
            <div style="font-weight: 700; font-size: 0.82rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${report.location}</div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 500;">${Formatter.formatDate(report.timestamp)}</div>
            <div style="display: flex; gap: 6px; align-items: center; margin-top: 1px;">
              <span class="badge badge-${levelClass}">${as === 'TINGGI' ? 'Tinggi' : as === 'SEDANG' ? 'Sedang' : as === 'RENDAH' ? 'Rendah' : 'Tidak Terindikasi'}</span>
              <span class="badge badge-${report.adminStatus === 'VALID' ? 'green' : (report.adminStatus === 'DIABAIKAN' ? 'red' : 'orange')}">${report.adminStatus === 'VALID' ? 'Tervalidasi' : report.adminStatus === 'DIABAIKAN' ? 'Diabaikan' : 'Menunggu'}</span>
            </div>
          </div>
          <i data-lucide="chevron-right" style="width: 14px; height: 14px; color: var(--text-muted); flex-shrink: 0;"></i>
        `;

        card.addEventListener('click', () => {
          Router.navigate(`/dashboard/detections/${report.id}`);
        });

        listContainer.appendChild(card);
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      listContainer.innerHTML = '<div class="empty-notifications text-danger">Gagal memuat riwayat.</div>';
    }
  }

  destroy() {
    // Clean states
    this.selectedFile = null;
    this.isScanning = false;
    this.scanCompleted = false;
  }
}
export const Upload = new UploadPage();
