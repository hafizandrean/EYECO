// upload.js - Kontroler Halaman Unggah Bukti Baru (Drag & Drop + AI Preview)
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';

export class UploadPage {
  constructor() {
    this.selectedFile = null;
    this.historyReports = [];
  }

  // Merender halaman form upload & riwayat
  async render(container) {
    container.innerHTML = `
      <div class="upload-container-layout">
        <!-- Left: Upload Form Card -->
        <main class="glass-card upload-card" id="upload-main-card">
          <div class="card-header-clean">
            <h2 class="section-title"><i data-lucide="upload-cloud"></i> Unggah Bukti Baru</h2>
            <p class="caption-label">Masukkan media rekaman/foto sungai untuk dipindai oleh AI</p>
          </div>

          <form id="upload-form-element" class="upload-form" enctype="multipart/form-data">
            <!-- Drag & Drop Area -->
            <div class="form-group">
              <label class="form-label">File Media (MP4/JPG/PNG) <span class="required">*</span></label>
              <div class="drag-drop-zone" id="drop-zone">
                <input type="file" id="upload-input-file" accept="image/*,video/*" required style="display: none;">
                <div class="drag-drop-content" id="drop-zone-content">
                  <i data-lucide="image" class="drag-drop-icon"></i>
                  <p class="drag-drop-text">Seret & lepas file di sini, atau <strong>Pilih File</strong></p>
                  <p class="drag-drop-subtext">Maksimal ukuran file: 10MB</p>
                </div>
                <div class="file-preview-container" id="file-preview" style="display: none;">
                  <!-- Dynamic Preview rendered here -->
                </div>
              </div>
            </div>

            <!-- Location Input -->
            <div class="form-group">
              <label class="form-label" for="input-location">Lokasi Pemantauan <span class="required">*</span></label>
              <input type="text" class="form-control input-rounded" id="input-location" placeholder="Contoh: Sungai Ciliwung Jembatan Merah" required>
            </div>

            <!-- Identity Input -->
            <div class="form-group">
              <label class="form-label" for="input-identity">Identitas Pelaku / Ciri Khusus (Opsional)</label>
              <input type="text" class="form-control input-rounded" id="input-identity" placeholder="Dapat dikosongkan jika anonim">
            </div>

            <!-- Datetime Input -->
            <div class="form-group">
              <label class="form-label" for="input-time">Waktu Rekaman <span class="required">*</span></label>
              <div class="input-btn-group">
                <input type="datetime-local" class="form-control input-rounded" id="input-time" required style="flex: 1;">
                <button type="button" class="btn btn-glass btn-rounded" id="btn-autofill-time">Waktu Saat Ini</button>
              </div>
            </div>

            <!-- Source Type Select -->
            <div class="form-group">
              <label class="form-label" for="input-source-type">Jenis Sumber Rekaman <span class="required">*</span></label>
              <select class="form-control select-rounded" id="input-source-type" required>
                <option value="Video">Video (Rekomendasi durasi AI)</option>
                <option value="Gambar" selected>Gambar (Foto Tunggal CCTV)</option>
                <option value="Live Stream">Rekaman Potongan Live Stream</option>
              </select>
            </div>

            <!-- Description Notes -->
            <div class="form-group">
              <label class="form-label" for="input-notes">Catatan Keterangan Tambahan (Opsional)</label>
              <textarea class="form-control textarea-rounded" id="input-notes" placeholder="Tambahkan deskripsi visual atau catatan lapangan tambahan..."></textarea>
            </div>

            <!-- Submit Button -->
            <button type="submit" class="btn btn-primary btn-rounded" style="width: 100%; height: 48px; margin-top: 16px;">
              <i data-lucide="cpu"></i> Mulai Analisis AI & Simpan
            </button>
          </form>

          <!-- Simulated AI Pipeline screen inside the card (Initially hidden) -->
          <div class="ai-pipeline-overlay" id="ai-pipeline-screen" style="display: none;">
            <div class="pipeline-loader">
              <div class="spinner-neon"></div>
            </div>
            <h3 class="pipeline-title" id="pipeline-status-title">Mengunggah file...</h3>
            <p class="pipeline-subtitle" id="pipeline-status-subtitle">Mengirim media ke server EYECO</p>
            <div class="pipeline-progress-bar">
              <div class="pipeline-progress-fill" id="pipeline-progress-fill" style="width: 0%;"></div>
            </div>
          </div>

          <!-- AI Results Preview screen inside the card (Initially hidden) -->
          <div class="ai-results-preview-card" id="ai-results-preview-screen" style="display: none;">
            <h3 class="section-title"><i data-lucide="sparkles" class="text-success"></i> Hasil Analisis AI YOLOv8</h3>
            <p class="caption-label" style="margin-bottom: 20px;">Laporan telah berhasil diproses oleh model deteksi sungai.</p>
            
            <div class="results-preview-layout">
              <div class="preview-media-wrapper" id="results-image-wrapper">
                <!-- Bounding boxes and image will render here -->
              </div>
              <div class="preview-data-wrapper">
                <div class="data-preview-item">
                  <span class="preview-label">Status Ancaman AI</span>
                  <span id="results-ai-status" class="badge">-</span>
                </div>
                <div class="data-preview-item">
                  <span class="preview-label">Akurasi Keyakinan AI</span>
                  <div class="confidence-bar-group">
                    <span id="results-ai-confidence-value" style="font-weight: 700;">0%</span>
                    <div class="confidence-meter-container">
                      <div class="confidence-meter-fill" id="results-ai-confidence-fill" style="width: 0%;"></div>
                    </div>
                  </div>
                </div>
                <div class="data-preview-item">
                  <span class="preview-label">Objek Terdeteksi</span>
                  <div class="detected-tags-list" id="results-detected-objects">
                    <!-- Labels -->
                  </div>
                </div>
              </div>
            </div>
            <button class="btn btn-primary btn-rounded" id="btn-close-results" style="width: 100%; margin-top: 24px;">
              <i data-lucide="check"></i> Selesai & Lihat Dashboard
            </button>
          </div>
        </main>

        <!-- Right: Upload History Card -->
        <section class="glass-card history-card" id="upload-history-card">
          <div class="card-header-clean">
            <h3 class="section-title"><i data-lucide="clock"></i> Riwayat Laporan Saya</h3>
            <p class="caption-label">Daftar laporan yang Anda unggah melalui perangkat ini</p>
          </div>

          <div class="history-list" id="history-list-container">
            <!-- Populated dynamically -->
          </div>
        </section>
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

    if (dropZone && fileInput) {
      // Click triggers file select
      dropZone.addEventListener('click', () => fileInput.click());

      // Drag and drop handlers
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'));
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
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

  handleFileSelected(file) {
    this.selectedFile = file;

    const previewContainer = document.getElementById('file-preview');
    const zoneContent = document.getElementById('drop-zone-content');

    if (!previewContainer || !zoneContent) return;

    zoneContent.style.display = 'none';
    previewContainer.style.display = 'flex';
    previewContainer.innerHTML = '';

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewContainer.innerHTML = `
          <img src="${e.target.result}" alt="Preview" class="upload-image-preview">
          <button type="button" class="btn-remove-file" id="btn-clear-file">&times;</button>
        `;
        document.getElementById('btn-clear-file').addEventListener('click', (e) => {
          e.stopPropagation();
          this.clearFileSelection();
        });
      };
      reader.readAsDataURL(file);
    } else {
      // Video or other format
      previewContainer.innerHTML = `
        <div class="file-video-preview">
          <i data-lucide="video" style="width: 48px; height: 48px; color: var(--primary);"></i>
          <span style="font-size: 0.9rem; font-weight:600; margin-top:8px; word-break:break-all;">${file.name}</span>
          <span style="font-size: 0.75rem; color:var(--text-muted);">(${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        </div>
        <button type="button" class="btn-remove-file" id="btn-clear-file">&times;</button>
      `;
      document.getElementById('btn-clear-file').addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearFileSelection();
      });
      if (window.lucide) window.lucide.createIcons();
    }
  }

  clearFileSelection() {
    this.selectedFile = null;
    const fileInput = document.getElementById('upload-input-file');
    if (fileInput) fileInput.value = '';
    
    document.getElementById('file-preview').style.display = 'none';
    document.getElementById('drop-zone-content').style.display = 'flex';
  }

  // Handle form upload with visual loading bar
  async handleSubmit(e) {
    e.preventDefault();

    if (!this.selectedFile) {
      EventBus.emit('toast:show', { message: 'Silakan pilih file media terlebih dahulu.', type: 'warning' });
      return;
    }

    const form = document.getElementById('upload-form-element');
    const pipelineScreen = document.getElementById('ai-pipeline-screen');
    const progressFill = document.getElementById('pipeline-progress-fill');
    
    const location = document.getElementById('input-location').value;
    const identity = document.getElementById('input-identity').value;
    const time = document.getElementById('input-time').value;
    const sourceType = document.getElementById('input-source-type').value;
    const notes = document.getElementById('input-notes').value;

    // Show AI Pipeline Screen overlay
    form.style.display = 'none';
    pipelineScreen.style.display = 'flex';

    const steps = [
      { title: 'Mengunggah Media...', subtitle: 'Mengirim file ke server EYECO', progress: 20 },
      { title: 'Inisialisasi Model AI...', subtitle: 'Memuat model segmentasi sungai YOLOv8', progress: 45 },
      { title: 'Menjalankan Deteksi Objek...', subtitle: 'Mencari objek manusia, sampah, dan kendaraan air', progress: 70 },
      { title: 'Evaluasi Tingkat Ancaman...', subtitle: 'Menghitung tingkat ancaman sungai', progress: 90 },
      { title: 'Menyimpan Hasil Analisis...', subtitle: 'Mendaftarkan deteksi ke database log', progress: 100 }
    ];

    // Progress bar animation loop
    for (let i = 0; i < steps.length; i++) {
      document.getElementById('pipeline-status-title').innerText = steps[i].title;
      document.getElementById('pipeline-status-subtitle').innerText = steps[i].subtitle;
      progressFill.style.width = `${steps[i].progress}%`;
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Prepare Multipart Form Data
    const formData = new FormData();
    formData.append('location', location);
    formData.append('identity', identity);
    formData.append('timestamp', new Date(time).toISOString());
    formData.append('sourceType', sourceType);
    formData.append('additionalNotes', notes);
    formData.append('file', this.selectedFile);

    try {
      const response = await ReportService.uploadReport(formData);
      
      EventBus.emit('toast:show', { message: 'Unggahan berhasil dianalisis AI & disimpan!', type: 'success' });
      
      // Render Results Page
      this.renderAIResults(response);
    } catch (err) {
      EventBus.emit('toast:show', { message: `Gagal menganalisis unggahan: ${err.message}`, type: 'danger' });
      
      // Return to form on error
      pipelineScreen.style.display = 'none';
      form.style.display = 'block';
    }
  }

  // Render AI YOLO results preview card on upload page
  renderAIResults(report) {
    const pipelineScreen = document.getElementById('ai-pipeline-screen');
    const resultsScreen = document.getElementById('ai-results-preview-screen');
    const imgWrapper = document.getElementById('results-image-wrapper');

    if (!pipelineScreen || !resultsScreen || !imgWrapper) return;

    pipelineScreen.style.display = 'none';
    resultsScreen.style.display = 'block';

    // Bounding boxes render
    let boxesHtml = '';
    if (report.boundingBoxes && report.boundingBoxes.length > 0) {
      report.boundingBoxes.forEach(box => {
        let boxColorClass = 'yolo-default';
        if (box.label === 'person') boxColorClass = 'yolo-person';
        if (box.label === 'trash') boxColorClass = 'yolo-trash';
        if (box.label === 'boat') boxColorClass = 'yolo-boat';

        boxesHtml += `
          <div class="yolo-preview-box ${boxColorClass}" style="
            top: ${box.y}%; 
            left: ${box.x}%; 
            width: ${box.w}%; 
            height: ${box.h}%;
          ">
            <span class="yolo-preview-label">${box.label} ${(box.confidence).toFixed(2)}</span>
          </div>
        `;
      });
    }

    imgWrapper.innerHTML = `
      <img src="${report.image}" alt="YOLO Hasil" class="results-preview-img">
      ${boxesHtml}
    `;

    // AI Status Badge
    const aiStatusEl = document.getElementById('results-ai-status');
    aiStatusEl.innerText = report.aiStatus;
    
    let badgeClass = 'badge-none';
    if (report.aiStatus === 'TINGGI') badgeClass = 'badge-high';
    else if (report.aiStatus === 'SEDANG') badgeClass = 'badge-medium';
    else if (report.aiStatus === 'RENDAH') badgeClass = 'badge-low';
    aiStatusEl.className = `badge ${badgeClass}`;

    // Confidence Bar
    const confVal = report.aiConfidence || 0;
    document.getElementById('results-ai-confidence-value').innerText = `${confVal}%`;
    document.getElementById('results-ai-confidence-fill').style.width = `${confVal}%`;

    // Detected objects list
    const tagsList = document.getElementById('results-detected-objects');
    tagsList.innerHTML = '';
    if (report.boundingBoxes && report.boundingBoxes.length > 0) {
      // Unique list of detected objects
      const uniqueLabels = [...new Set(report.boundingBoxes.map(b => b.label))];
      uniqueLabels.forEach(lbl => {
        tagsList.innerHTML += `<span class="detected-tag">${lbl}</span>`;
      });
    } else {
      tagsList.innerHTML = '<span class="detected-tag none">Tidak ada objek terdeteksi</span>';
    }

    // Done button redirects to dashboard or upload reload
    document.getElementById('btn-close-results').addEventListener('click', () => {
      const user = AppState.get('user');
      if (user && user.role === 'admin') {
        Router.navigate('/dashboard');
      } else {
        // Normal user just stays and reloads the uploader page to upload again
        window.location.reload();
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  async loadHistory() {
    const listContainer = document.getElementById('history-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-notifications">Memuat riwayat...</div>';

    try {
      const response = await ReportService.getFilteredReports({ limit: 20 });
      this.historyReports = response.reports || [];

      listContainer.innerHTML = '';

      if (this.historyReports.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-state-card" style="padding: 24px; text-align: center; color: var(--text-muted);">
            <i data-lucide="folder" style="width: 32px; height: 32px; margin-bottom: 8px;"></i>
            <p>Belum ada riwayat unggahan</p>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      this.historyReports.forEach(report => {
        let levelClass = 'none';
        if (report.aiStatus === 'TINGGI') levelClass = 'high';
        if (report.aiStatus === 'SEDANG') levelClass = 'medium';
        if (report.aiStatus === 'RENDAH') levelClass = 'low';

        const item = document.createElement('div');
        item.className = 'history-item glass-card';
        item.innerHTML = `
          <div class="history-thumbnail">
            <img src="${report.image}" alt="Bukti">
          </div>
          <div class="history-item-body">
            <div class="history-location">${report.location}</div>
            <div class="history-time">${Formatter.formatDate(report.timestamp)}</div>
            <div class="history-badges-row">
              <span class="badge badge-${levelClass === 'high' ? 'high' : (levelClass === 'medium' ? 'medium' : (levelClass === 'low' ? 'low' : 'none'))}">AI: ${report.aiStatus}</span>
              <span class="status-badge ${report.adminStatus === 'VALID' ? 'status-valid' : (report.adminStatus === 'DIABAIKAN' ? 'status-ignored' : 'status-pending')}">${report.adminStatus}</span>
            </div>
          </div>
        `;
        
        // Admins can click history to see detail
        if (AppState.get('user')?.role === 'admin') {
          item.addEventListener('click', () => {
            Router.navigate(`/dashboard/detections/${report.id}`);
          });
          item.style.cursor = 'pointer';
        }

        listContainer.appendChild(item);
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      listContainer.innerHTML = '<div class="empty-notifications text-danger">Gagal memuat riwayat.</div>';
    }
  }

  destroy() {
    // No polling on upload page
  }
}
export const Upload = new UploadPage();
