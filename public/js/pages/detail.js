// detail.js - Kontroler Halaman Detail Analisis Laporan Sungai (Collaborative Review Workflow)
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { AppState } from '../core/state.js';

export class DetailPage {
  constructor() {
    this.reportId = null;
    this.report = null;
    this.comments = [];
    this.commentsPage = 1;
    this.commentsLimit = 10;
    this.commentsSort = 'newest';
    
    // Live SLA Timer handle
    this.slaTimerInterval = null;
  }

  // Merender halaman detail laporan
  async render(container, id) {
    this.reportId = parseInt(id);
    this.commentsPage = 1;
    this.comments = [];

    container.innerHTML = `
      <style>
        .lifecycle-dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.65rem;
          font-weight: 800;
          color: white;
          background: var(--text-muted);
          position: relative;
          z-index: 5;
        }
        .lifecycle-dot.completed {
          background: var(--success);
        }
        .lifecycle-dot.active {
          background: var(--primary);
          box-shadow: 0 0 0 4px rgba(47, 107, 255, 0.15);
        }
        .lifecycle-line {
          position: absolute;
          left: 10px;
          top: 22px;
          width: 2px;
          height: 38px;
          background: rgba(0, 0, 0, 0.05);
          z-index: 1;
        }
        .lifecycle-line.completed {
          background: var(--success);
        }
        .discussion-badge {
          font-size: 0.58rem;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .discussion-badge.admin {
          background: rgba(47, 107, 255, 0.1);
          color: var(--primary);
          border: 1px solid rgba(47, 107, 255, 0.2);
        }
        .discussion-badge.pelapor {
          background: rgba(34, 197, 94, 0.1);
          color: var(--success);
          border: 1px solid rgba(34, 197, 94, 0.2);
        }
        .discussion-badge.masyarakat {
          background: rgba(0, 0, 0, 0.05);
          color: var(--text-secondary);
          border: 1px solid rgba(0, 0, 0, 0.08);
        }
        .comment-tag-badge {
          font-size: 0.62rem;
          padding: 1px 6px;
          border-radius: var(--radius-pill);
          font-weight: 700;
          background: #f1f5f9;
          color: #475569;
        }
      </style>

      <!-- Back navigation bar -->
      <section class="detail-nav-row" style="margin-bottom: var(--space-20); animation: pageFadeIn var(--motion-open);">
        <button class="btn btn-glass btn-rounded btn-back-route" id="btn-detail-back" style="padding: 10px 20px; font-weight:700;">
          <i data-lucide="arrow-left" style="width: 16px; height: 16px; margin-right: 4px;"></i> Kembali ke Daftar
        </button>
      </section>

      <!-- Main Detail layout -->
      <div class="detail-grid-layout" id="detail-grid-container" style="display: grid; grid-template-columns: 1.2fr 1fr; gap: var(--space-24); align-items: start; animation: pageFadeIn var(--motion-open);">
        <!-- Skeleton Loaders -->
        <div class="shimmer-card" style="min-height: 480px;"></div>
        <div class="shimmer-card" style="min-height: 480px;"></div>
      </div>
    `;

    // Back click trigger
    document.getElementById('btn-detail-back').addEventListener('click', () => {
      const lastActiveTab = sessionStorage.getItem('lastActiveTab');
      if (lastActiveTab === 'laporan') {
        Router.navigate('/dashboard/laporan');
      } else {
        const currentUser = AppState.get('user');
        Router.navigate(currentUser?.role === 'admin' ? '/dashboard' : '/dashboard/laporan');
      }
    });

    if (window.lucide) window.lucide.createIcons();

    // Load initial data
    await this.loadData();
  }

  async loadData() {
    const grid = document.getElementById('detail-grid-container');
    if (!grid) return;

    try {
      const report = await ReportService.getReportById(this.reportId);
      this.report = report;

      // Check current user role
      const currentUser = AppState.get('user');
      const isAdmin = currentUser?.role === 'admin';

      // Load mock community signal values
      let signals = JSON.parse(localStorage.getItem(`signals_${this.reportId}`)) || {
        active: 14 + (this.reportId % 8),
        resolved: 2 + (this.reportId % 3),
        voted: false
      };
      
      // Determine active lifecycle step index (Item 1 & 2)
      // 0: Deteksi AI (NEW), 1: Tinjauan Operator (UNDER REVIEW), 2: Validasi (VALIDATED),
      // 3: Petugas Ditunjuk (ASSIGNED), 4: Penanganan (IN PROGRESS), 5: Lokasi Pulih (RESOLVED), 6: Kasus Tutup (CLOSED)
      let activeStep = 1; // Default UNDER REVIEW
      if (report.adminStatus === 'VALID') {
        activeStep = 2; // VALIDATED
        if (report.assignedOfficer) {
          activeStep = 3; // ASSIGNED
          if (report.status === 'PROSES') {
            activeStep = 4; // IN PROGRESS
          }
        }
        if (report.status === 'SELESAI') {
          activeStep = 5; // RESOLVED
        }
        if (report.status === 'CLOSED') {
          activeStep = 6; // CLOSED
        }
      } else if (report.adminStatus === 'DIABAIKAN') {
        activeStep = 6; // CLOSED
      }

      // Generate YOLO Boxes
      let boxesHtml = '';
      if (report.boundingBoxes && report.boundingBoxes.length > 0) {
        report.boundingBoxes.forEach(box => {
          let boxColorClass = 'yolo-default';
          if (box.label === 'person') boxColorClass = 'yolo-person';
          if (box.label === 'trash') boxColorClass = 'yolo-trash';
          if (box.label === 'boat') boxColorClass = 'yolo-boat';

          boxesHtml += `
            <div class="yolo-box ${boxColorClass}" style="top: ${box.y}%; left: ${box.x}%; width: ${box.w}%; height: ${box.h}%;">
              <span class="yolo-box-label">${box.label} ${(box.confidence).toFixed(2)}</span>
            </div>
          `;
        });
      }

      // Setup dynamic panels
      grid.innerHTML = `
        <!-- Left Side: Interactive Bounding Box Canvas & Metadata Info -->
        <main style="display: flex; flex-direction: column; gap: var(--space-20);">
          
          <!-- Image Bounding Box Canvas -->
          <div class="glass-card" style="padding: var(--space-16); border-radius: var(--radius-card); position: relative;">
            <div class="image-canvas-container" style="position: relative; width: 100%; aspect-ratio: 16/10; overflow: hidden; border-radius: 12px; background: #000; display:flex; align-items:center; justify-content:center;">
              <img id="detail-evidence-image" src="${report.image}" alt="Laporan Foto" style="width: 100%; height: 100%; object-fit: contain; transition: transform 0.25s ease;">
              ${boxesHtml}
            </div>
            <!-- Interactive Action buttons (Item 9) -->
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top: 12px;">
              <button class="btn btn-sm btn-glass btn-rounded" id="btn-detail-zoom" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px;">
                <i data-lucide="zoom-in" style="width:14px; height:14px;"></i> Zoom
              </button>
              <a href="${report.image}" download="EYECO_Evidence_${report.id}.jpg" class="btn btn-sm btn-glass btn-rounded" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px; text-decoration:none; color: var(--text-primary);">
                <i data-lucide="download" style="width:14px; height:14px;"></i> Download
              </a>
              <button class="btn btn-sm btn-glass btn-rounded" id="btn-detail-print" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px;">
                <i data-lucide="file-text" style="width:14px; height:14px;"></i> Export PDF
              </button>
            </div>
          </div>

          <!-- Metadata Properties Card -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16);">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:8px;">
              <i data-lucide="info" style="color: var(--primary);"></i> Informasi Deteksi & Lokasi
            </h3>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-16);">
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Confidence Tingkat AI</div>
                <strong style="font-size: 1rem; color: var(--text-primary); margin-top: 2px; display:block;">${report.aiConfidence ? `${report.aiConfidence}%` : 'N/A'}</strong>
              </div>
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Jenis Kamera / Sumber</div>
                <strong style="font-size: 1rem; color: var(--text-primary); margin-top: 2px; display:block;">${report.sourceType || 'CCTV Stream'}</strong>
              </div>
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Waktu Diunggah</div>
                <strong style="font-size: 0.85rem; color: var(--text-primary); margin-top: 2px; display:block;">${Formatter.formatDate(report.timestamp)}</strong>
              </div>
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Kategori Pelapor</div>
                <strong style="font-size: 0.85rem; color: var(--text-primary); margin-top: 2px; display:block; display:flex; align-items:center; gap:4px;">
                  <i data-lucide="user" style="width:14px; height:14px;"></i> ${report.identity || 'Citizen'}
                  <span id="reporter-reputation-stars" style="color: var(--warning); font-size: 0.72rem; font-weight: 800;">★★★★★</span>
                </strong>
              </div>
            </div>

            <div style="background: rgba(0,0,0,0.02); padding: var(--space-16); border-radius: 12px;">
              <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block; margin-bottom: 4px;">Lokasi Sungai</span>
              <span style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); display:flex; align-items:center; gap:6px;">
                <i data-lucide="map-pin" style="color: var(--primary); width:16px; height:16px;"></i> ${report.location}
              </span>
            </div>

            <div style="background: rgba(0,0,0,0.02); padding: var(--space-16); border-radius: 12px;">
              <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block; margin-bottom: 4px;">Keterangan Tambahan</span>
              <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0; line-height: 1.5;">${report.additionalNotes || 'Tidak ada keterangan tambahan.'}</p>
            </div>
          </div>

          <!-- Community Discussion Thread -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card);">
            <div id="comments-section"></div>
          </div>
        </main>

        <!-- Right Side: Workflow Lifecycle, SLA Timers, and Admin Action Overrides -->
        <aside style="display: flex; flex-direction: column; gap: var(--space-20);">
          
          <!-- SLA & Workflow Status Card -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-12);">
            <span style="font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Status & Respons SLA</span>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span id="detail-workflow-status-pill" class="badge" style="font-size: 0.85rem; padding: 6px 12px; font-weight:800;">Waiting Review</span>
              <span id="detail-sla-timer" style="font-family: monospace; font-size: 0.95rem; font-weight: 800; color: var(--danger); background: rgba(239, 68, 68, 0.05); padding: 4px 10px; border-radius: 6px;">0h 0m 0s</span>
            </div>
          </div>

          <!-- Officer Dispatch Status Widget (Item 11) -->
          ${report.assignedOfficer ? `
            <div class="glass-card" style="padding: var(--space-20); border-radius: var(--radius-card); border: 1.5px solid rgba(47, 107, 255, 0.2); background: rgba(47, 107, 255, 0.01);">
              <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin: 0; display:flex; align-items:center; gap:6px;">
                <i data-lucide="truck" style="width: 14px; height: 14px; color: var(--primary);"></i> Officer Dispatch Status
              </h4>
              <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px; font-size:0.78rem;">
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-secondary);">Regu Lapangan:</span>
                  <strong style="color:var(--text-primary);">${report.assignedOfficer} Team</strong>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:2px;">
                  <span style="color:var(--text-secondary);">Status Tugas:</span>
                  <strong style="color:var(--info);">🟢 ON SITE (ETA 5 Min)</strong>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:2px;">
                  <span style="color:var(--text-secondary);">Petugas PJ:</span>
                  <strong style="color:var(--text-primary);">Officer Andre (Cleaning Started)</strong>
                </div>
              </div>
            </div>
          ` : ''}

          <!-- 7-Stage Incident Lifecycle Card -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16);">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:8px;">
              <i data-lucide="git-commit" style="color: var(--primary);"></i> Incident Lifecycle
            </h3>
            
            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 8px; position: relative;">
              <!-- 7 Steps -->
              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 0 ? (activeStep === 0 ? 'active' : 'completed') : ''}">1</div>
                <div class="lifecycle-line ${activeStep > 0 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Deteksi AI (NEW)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Objek tumpukan plastik dipindai model</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 1 ? (activeStep === 1 ? 'active' : 'completed') : ''}">2</div>
                <div class="lifecycle-line ${activeStep > 1 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Tinjauan Operator (UNDER REVIEW)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Validator memeriksa kesesuaian deteksi AI</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 2 ? (activeStep === 2 ? 'active' : 'completed') : ''}">3</div>
                <div class="lifecycle-line ${activeStep > 2 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Validasi Berhasil (VALIDATED)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Laporan disetujui untuk tindakan lanjutan</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 3 ? (activeStep === 3 ? 'active' : 'completed') : ''}">4</div>
                <div class="lifecycle-line ${activeStep > 3 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Petugas Ditunjuk (ASSIGNED)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Instansi dinas / regu RT ditugaskan</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 4 ? (activeStep === 4 ? 'active' : 'completed') : ''}">5</div>
                <div class="lifecycle-line ${activeStep > 4 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Pembersihan Lapangan (IN PROGRESS)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Regu kebersihan melakukan pengangkutan</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 5 ? (activeStep === 5 ? 'active' : 'completed') : ''}">6</div>
                <div class="lifecycle-line ${activeStep > 5 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Lokasi Sungai Pulih (RESOLVED)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Sungai bersih, tumpukan plastik diangkut</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 6 ? 'active' : ''}">7</div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Arsip Kasus Ditutup (CLOSED)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Tindakan selesai & log ditutup</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Community Signals & crowdsourced Verification Widget -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16);">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:8px;">
              <i data-lucide="users" style="color: var(--primary);"></i> Sinyal Komunitas
            </h3>
            
            <div style="display: flex; flex-direction: column; gap: 6px; padding: 12px; background: rgba(0,0,0,0.02); border-radius: 10px; font-size: 0.78rem;">
              <div style="display:flex; justify-content:space-between; font-weight: 700;">
                <span style="color:var(--text-secondary);">Masih Terjadi</span>
                <span id="signal-count-active" style="color:var(--danger);">${signals.active} orang</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-weight: 700; margin-top: 4px;">
                <span style="color:var(--text-secondary);">Sudah Bersih</span>
                <span id="signal-count-resolved" style="color:var(--success);">${signals.resolved} orang</span>
              </div>
            </div>

            <!-- Verification survey fields -->
            <div style="display: flex; flex-direction: column; gap: 12px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: var(--space-12);">
              <span style="font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Apakah Laporan ini masih terjadi?</span>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-glass btn-sm btn-rounded btn-vote" data-vote="active" style="flex:1; font-size: 0.7rem; padding: 8px 0; justify-content:center; font-weight: 700; ${signals.voted ? 'opacity:0.5; pointer-events:none;' : ''}">Masih Ada</button>
                <button class="btn btn-glass btn-sm btn-rounded btn-vote" data-vote="resolved" style="flex:1; font-size: 0.7rem; padding: 8px 0; justify-content:center; font-weight: 700; ${signals.voted ? 'opacity:0.5; pointer-events:none;' : ''}">Sudah Bersih</button>
              </div>

              <!-- Upload extra update photo button -->
              <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                <span style="font-size: 0.72rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Tambahkan Foto Kondisi Terbaru</span>
                <button class="btn btn-glass btn-sm btn-rounded" id="btn-update-photo-upload" style="border-color: rgba(47,107,255,0.2); color: var(--primary); font-size:0.75rem; font-weight:700; display:flex; align-items:center; justify-content:center; gap:6px; padding: 8px 0;">
                  <i data-lucide="camera" style="width: 14px; height: 14px;"></i> Unggah Foto
                </button>
                <input type="file" id="update-photo-input-file" accept="image/*" style="display:none;">
              </div>
            </div>
          </div>

          <!-- 🛡️ Operator Action Panel (Government controls - Admin Only) -->
          ${isAdmin ? `
            <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16); border: 1.5px solid rgba(47,107,255,0.15); background: rgba(47, 107, 255, 0.02);">
              <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 800; color: var(--primary); margin: 0; display:flex; align-items:center; gap:8px;">
                <i data-lucide="shield" style="color: var(--primary);"></i> Operator Action Center
              </h3>

              <form id="detail-verify-form" class="detail-verify-form" style="display:flex; flex-direction:column; gap:12px;">
                <!-- Validate/Reject status -->
                <div class="form-group">
                  <label class="form-label" style="font-size:0.75rem;" for="verify-status-select">Status Validasi</label>
                  <select class="form-control select-rounded" id="verify-status-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;" required>
                    <option value="MENUNGGU" ${report.adminStatus === 'MENUNGGU' ? 'selected' : ''}>Menunggu (Belum Diverifikasi)</option>
                    <option value="VALID" ${report.adminStatus === 'VALID' ? 'selected' : ''}>Valid (Kirim Tindak Lanjut)</option>
                    <option value="DIABAIKAN" ${report.adminStatus === 'DIABAIKAN' ? 'selected' : ''}>Abaikan (Bukan Ancaman/Salah AI)</option>
                  </select>
                </div>

                <!-- Incident Assignment -->
                <div class="form-group">
                  <label class="form-label" style="font-size:0.75rem;" for="verify-assignment-select">Tugaskan Instansi</label>
                  <select class="form-control select-rounded" id="verify-assignment-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;">
                    <option value="" ${!report.assignedOfficer ? 'selected' : ''}>-- Belum Ditunjuk --</option>
                    <option value="BBWS" ${report.assignedOfficer === 'BBWS' ? 'selected' : ''}>BBWS (River Authority)</option>
                    <option value="DLH" ${report.assignedOfficer === 'DLH' ? 'selected' : ''}>DLH (Dinas Lingkungan Hidup)</option>
                    <option value="Relawan" ${report.assignedOfficer === 'Relawan' ? 'selected' : ''}>Relawan Sungai Lokal</option>
                  </select>
                </div>

                <!-- Workflow / Progress status -->
                <div class="form-group">
                  <label class="form-label" style="font-size:0.75rem;" for="verify-progress-select">Alur Operasional / Progress</label>
                  <select class="form-control select-rounded" id="verify-progress-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;">
                    <option value="PENDING" ${report.status === 'PENDING' ? 'selected' : ''}>Menunggu Aksi (Pending)</option>
                    <option value="PROSES" ${report.status === 'PROSES' ? 'selected' : ''}>Dalam Penanganan (In Progress)</option>
                    <option value="SELESAI" ${report.status === 'SELESAI' ? 'selected' : ''}>Lokasi Pulih (Resolved)</option>
                    <option value="CLOSED" ${report.status === 'CLOSED' ? 'selected' : ''}>Arsip Kasus Ditutup (Closed)</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label" style="font-size:0.75rem;" for="verify-notes-input">Catatan Petugas (BBWS)</label>
                  <textarea class="form-control textarea-rounded" id="verify-notes-input" style="font-size:0.8rem; background:#ffffff; padding: 10px; margin-top:4px;" placeholder="Instruksi rujukan dinas sosial atau petugas RT setempat..." rows="2">${report.adminNotes || ''}</textarea>
                </div>

                <button type="submit" class="btn btn-primary btn-rounded" style="width: 100%; font-weight: 700; height: 38px; font-size: 0.8rem; margin-top: 4px;">
                  <i data-lucide="save" style="width:14px; height:14px; margin-right:4px;"></i> Simpan Keputusan
                </button>
              </form>

              <!-- Telegram Dispatch -->
              <button class="btn btn-glass btn-rounded" id="btn-telegram-dispatch" style="width: 100%; color: var(--primary); border-color: rgba(47, 107, 255, 0.2); font-size: 0.8rem; font-weight: 700; height: 38px;">
                <i data-lucide="send" style="width:14px; height:14px; margin-right:4px;"></i> Siarkan Telegram Respon
              </button>
            </div>
          ` : ''}

        </aside>
      `;

      // Initialize status label and SLA Timer
      this.updateWorkflowStatusLabel();
      this.startSLATimer();

      // Render GitHub-style discussions
      this.renderCommentsShell();

      // Bind all form actions
      this.bindActionEvents();

      // Bind Zoom & Print Actions (Item 9)
      const zoomBtn = document.getElementById('btn-detail-zoom');
      const img = document.getElementById('detail-evidence-image');
      if (zoomBtn && img) {
        let scaled = false;
        zoomBtn.onclick = () => {
          scaled = !scaled;
          img.style.transform = scaled ? 'scale(1.5)' : 'scale(1)';
          img.style.zIndex = scaled ? '20' : '1';
          zoomBtn.innerHTML = scaled 
            ? `<i data-lucide="zoom-out" style="width:14px; height:14px;"></i> Zoom Out` 
            : `<i data-lucide="zoom-in" style="width:14px; height:14px;"></i> Zoom`;
          if (window.lucide) window.lucide.createIcons();
        };
      }

      const printBtn = document.getElementById('btn-detail-print');
      if (printBtn) {
        printBtn.onclick = () => {
          window.print();
        };
      }

      // Load comments
      await this.loadComments(true);

    } catch (err) {
      console.error(err);
      grid.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 32px; text-align: center;">
          <i data-lucide="alert-octagon" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Gagal Memuat Detail Laporan</h3>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">Log deteksi sungai tidak ditemukan atau otorisasi gagal.</p>
        </div>
      `;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  // Update Status Pill
  updateWorkflowStatusLabel() {
    const statusPill = document.getElementById('detail-workflow-status-pill');
    if (!statusPill) return;

    let statusText = 'NEW';
    let badgeClass = 'bg-primary text-white';

    if (this.report.adminStatus === 'MENUNGGU') {
      statusText = 'UNDER REVIEW';
      badgeClass = 'bg-warning text-white';
    } else if (this.report.adminStatus === 'VALID') {
      statusText = 'VALIDATED';
      badgeClass = 'bg-success text-white';
      
      if (this.report.assignedOfficer) {
        statusText = 'ASSIGNED';
        badgeClass = 'bg-info text-white';
      }
      if (this.report.status === 'PROSES') {
        statusText = 'IN PROGRESS';
        badgeClass = 'bg-info text-white';
      }
      if (this.report.status === 'SELESAI') {
        statusText = 'RESOLVED';
        badgeClass = 'bg-success text-white';
      }
      if (this.report.status === 'CLOSED') {
        statusText = 'CLOSED';
        badgeClass = 'bg-secondary text-white';
      }
    } else if (this.report.adminStatus === 'DIABAIKAN') {
      statusText = 'REJECTED';
      badgeClass = 'bg-danger text-white';
    }

    statusPill.innerText = statusText;
    statusPill.className = `badge ${badgeClass}`;
  }

  // Running SLA Timer
  startSLATimer() {
    if (this.slaTimerInterval) clearInterval(this.slaTimerInterval);

    const timerEl = document.getElementById('detail-sla-timer');
    if (!timerEl) return;

    const start = new Date(this.report.timestamp).getTime();

    this.slaTimerInterval = setInterval(() => {
      const now = new Date().getTime();
      const diff = now - start;

      if (diff < 0) {
        timerEl.innerText = '0h 0m 0s';
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      timerEl.innerText = `${hours}h ${minutes}m ${seconds}s`;
    }, 1000);
  }

  renderCommentsShell() {
    const commentsSec = document.getElementById('comments-section');
    if (!commentsSec) return;

    commentsSec.innerHTML = `
      <div class="comments-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 10px;">
        <h4 class="section-title-sm" style="font-size:0.95rem; font-weight:800; display:flex; align-items:center; gap:8px; margin: 0;">
          <i data-lucide="message-square" style="width:16px; height:16px; color:var(--primary);"></i> Community Discussions (<span id="comments-total-count">0</span>)
        </h4>
        <select class="filter-control select-rounded" id="comments-sort-select" style="font-size:0.75rem; padding: 2px 8px; height: 26px; width:auto; background:var(--surface); margin:0;">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      <div class="comments-list" id="comments-list" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; padding-right: 4px;">
        <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">
          Memuat diskusi...
        </div>
      </div>

      <!-- Input Form -->
      <form id="comment-post-form" style="display:flex; flex-direction:column; gap:8px; margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 12px;">
        <div style="display: flex; gap: 8px;">
          <select class="filter-control select-rounded" id="comment-input-category" style="font-size:0.72rem; padding: 2px 6px; height: 28px; width:auto; background:var(--surface);" required>
            <option value="Umum" selected>Kategori: Umum</option>
            <option value="Informasi Tambahan">Kategori: Info Tambahan</option>
            <option value="Koreksi">Kategori: Koreksi</option>
            <option value="Kondisi Terbaru">Kategori: Kondisi Terbaru</option>
            <option value="Saksi">Kategori: Saksi Mata</option>
          </select>
        </div>
        <div style="position:relative;">
          <textarea class="form-control textarea-rounded" id="comment-input-text" placeholder="Berikan info lapangan terbaru (gunakan @username jika perlu)..." style="height:62px; font-size:0.8rem; padding: 8px 12px; padding-bottom: 22px; resize:none; background:var(--surface);" required></textarea>
          <span id="comment-char-counter" style="position:absolute; right:12px; bottom:6px; font-size:0.65rem; color:var(--text-muted); pointer-events:none;">0/500</span>
        </div>
        <button type="submit" class="btn btn-primary btn-rounded btn-sm" id="btn-submit-comment" style="align-self: flex-end; height:30px; font-size:0.75rem; padding: 0 16px; font-weight:700;">
          Kirim Diskusi
        </button>
      </form>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  async loadComments(reset = false) {
    if (reset) {
      this.commentsPage = 1;
      this.comments = [];
    }

    try {
      const data = await ReportService.getComments(this.reportId, this.commentsPage, this.commentsLimit, this.commentsSort);
      this.comments = data.comments || [];
      
      const countEl = document.getElementById('comments-total-count');
      if (countEl) countEl.innerText = data.pagination.totalComments;

      this.renderCommentsList();
    } catch (err) {
      console.error('[Detail Page] Failed to load comments:', err);
    }
  }

  renderCommentsList() {
    const listEl = document.getElementById('comments-list');
    if (!listEl) return;

    if (this.comments.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding: 24px; color: var(--text-muted); font-size:0.8rem;">
          <i data-lucide="message-square" style="width:20px; height:20px; margin: 0 auto 8px auto; opacity: 0.5; display:block;"></i>
          Belum ada diskusi komunitas. Tulis pesan pertama Anda!
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const currentUser = AppState.get('user');
    listEl.innerHTML = '';
    
    // Sort pinned comments first
    const pinnedKey = `pinned_${this.reportId}`;
    const pinnedCommentId = localStorage.getItem(pinnedKey);

    const sortedComments = [...this.comments].sort((a, b) => {
      if (a._id === pinnedCommentId) return -1;
      if (b._id === pinnedCommentId) return 1;
      return 0;
    });

    sortedComments.forEach(comment => {
      const isOwner = comment.userId === currentUser?.id;
      const isAdmin = currentUser?.role === 'admin';
      const isLiked = comment.likedBy.includes(currentUser?.id);
      const isPinned = comment._id === pinnedCommentId;

      const commentItem = document.createElement('div');
      commentItem.style.cssText = `
        display: flex;
        gap: 10px;
        padding: 10px;
        border-radius: var(--radius-button);
        background: ${isPinned ? 'rgba(47, 107, 255, 0.03)' : 'rgba(255, 255, 255, 0.02)'};
        border: 1px solid ${isPinned ? 'rgba(47, 107, 255, 0.25)' : 'var(--border)'};
        transition: var(--motion-hover);
        flex-direction: column;
      `;
      
      const avatarInitials = comment.username ? comment.username.substring(0, 2).toUpperCase() : 'US';
      
      // Dynamic Role Badges: Admin, Pelapor, Masyarakat
      let roleText = 'Masyarakat';
      let badgeClass = 'masyarakat';
      if (comment.role === 'admin') {
        roleText = 'Admin';
        badgeClass = 'admin';
      } else if (comment.username === this.report.identity) {
        roleText = 'Pelapor';
        badgeClass = 'pelapor';
      }

      const roleBadge = `<span class="discussion-badge ${badgeClass}">${roleText}</span>`;

      // Custom tag category badge if exists (stored or parsed from text)
      let categoryTagHtml = '';
      const categoryMatch = comment.text.match(/^\[(Umum|Informasi Tambahan|Koreksi|Kondisi Terbaru|Saksi)\]\s*(.*)/);
      let cleanText = comment.text;
      if (categoryMatch) {
        categoryTagHtml = `<span class="comment-tag-badge">${categoryMatch[1]}</span>`;
        cleanText = categoryMatch[2];
      }

      // Highlight mentions (@username)
      cleanText = cleanText.replace(/(@[a-zA-Z0-9_]+)/g, '<span class="mention-tag" style="color:var(--primary); font-weight:700; background:rgba(59, 130, 246, 0.12); padding:1px 4px; border-radius:3px;">$1</span>');

      commentItem.innerHTML = `
        <div style="display:flex; gap:10px; width:100%;">
          <div style="width: 28px; height: 28px; border-radius: 50%; background: ${comment.role === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)'}; color: ${comment.role === 'admin' ? 'var(--primary)' : 'var(--text-secondary)'}; border: 1px solid ${comment.role === 'admin' ? 'var(--primary)' : 'var(--border)'}; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; flex-shrink: 0;">${avatarInitials}</div>
          
          <div style="flex-grow:1; display:flex; flex-direction:column; gap:4px; min-width: 0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.78rem; font-weight:700; color:var(--text-primary); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${comment.username || 'Pengguna'}</span>
              ${roleBadge}
              ${categoryTagHtml}
              ${isPinned ? `<span style="font-size: 0.58rem; color: var(--primary); font-weight:800; display:flex; align-items:center; gap:2px; margin-left:4px;"><i data-lucide="pin" style="width:10px; height:10px; fill:currentColor;"></i> PINNED</span>` : ''}
              <span style="font-size:0.63rem; color:var(--text-muted); margin-left:auto; flex-shrink:0;">${Formatter.formatDate(comment.createdAt || comment.timestamp)}</span>
            </div>
            <div style="font-size:0.78rem; color:var(--text-secondary); line-height: 1.4; word-break: break-word; margin-top:2px;">
              ${cleanText}
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:12px; padding-left:38px; border-top: 1px solid rgba(0,0,0,0.02); padding-top: 6px; margin-top: 4px;">
          <button class="btn-like-comment" data-id="${comment._id}" style="background:none; border:none; color: ${isLiked ? 'var(--primary)' : 'var(--text-muted)'}; cursor:pointer; font-size:0.68rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 0;">
            <i data-lucide="thumbs-up" style="width:11px; height:11px; fill: ${isLiked ? 'currentColor' : 'none'};"></i> 
            <span>${comment.likedBy ? comment.likedBy.length : 0}</span>
          </button>
          
          ${isAdmin ? `
            <button class="btn-pin-comment" data-id="${comment._id}" style="background:none; border:none; color: var(--primary); cursor:pointer; font-size:0.68rem; font-weight:700;">
              ${isPinned ? 'Unpin' : 'Pin'}
            </button>
          ` : ''}

          ${isOwner || isAdmin ? `
            <button class="btn-delete-comment text-danger" data-id="${comment._id}" style="background:none; border:none; color: var(--danger); cursor:pointer; font-size:0.68rem; font-weight:700; margin-left:auto;">Hapus</button>
          ` : ''}
        </div>
      `;

      // Bind like click
      const likeBtn = commentItem.querySelector('.btn-like-comment');
      if (likeBtn) {
        likeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const commentId = likeBtn.getAttribute('data-id');
          try {
            const res = await ReportService.toggleLikeComment(this.reportId, commentId);
            const idx = this.comments.findIndex(c => c._id === commentId);
            if (idx > -1) {
              this.comments[idx].likedBy = res.likedBy;
            }
            this.renderCommentsList();
          } catch (err) {}
        });
      }

      // Bind pin click
      const pinBtn = commentItem.querySelector('.btn-pin-comment');
      if (pinBtn) {
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const commentId = pinBtn.getAttribute('data-id');
          if (isPinned) {
            localStorage.removeItem(pinnedKey);
            EventBus.emit('toast:show', { message: 'Komentar dilepas dari pin.', type: 'info' });
          } else {
            localStorage.setItem(pinnedKey, commentId);
            EventBus.emit('toast:show', { message: 'Komentar disematkan (pinned)!', type: 'success' });
          }
          this.renderCommentsList();
        });
      }

      // Bind delete click
      const deleteBtn = commentItem.querySelector('.btn-delete-comment');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('Hapus komentar ini?')) {
            const commentId = deleteBtn.getAttribute('data-id');
            try {
              await ReportService.deleteComment(this.reportId, commentId);
              this.comments = this.comments.filter(c => c._id !== commentId);
              this.renderCommentsList();
            } catch (err) {}
          }
        });
      }

      listEl.appendChild(commentItem);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  bindActionEvents() {
    const form = document.getElementById('detail-verify-form');
    const telegramBtn = document.getElementById('btn-telegram-dispatch');
    const statusSelect = document.getElementById('verify-status-select');
    const notesInput = document.getElementById('verify-notes-input');

    // Comment elements
    const commentInput = document.getElementById('comment-input-text');
    const charCounter = document.getElementById('comment-char-counter');
    const commentForm = document.getElementById('comment-post-form');
    const sortSelect = document.getElementById('comments-sort-select');

    // Form verification decision
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newStatus = statusSelect.value;
        const notes = notesInput.value;
        const assignedSelect = document.getElementById('verify-assignment-select');
        const progressSelect = document.getElementById('verify-progress-select');
        const assignedOfficer = assignedSelect ? assignedSelect.value : '';
        const progressStatus = progressSelect ? progressSelect.value : '';

        try {
          const updated = await ReportService.verifyReport(
            this.reportId, 
            newStatus, 
            notes, 
            assignedOfficer, 
            progressStatus
          );
          this.report = updated;
          
          this.updateWorkflowStatusLabel();
          EventBus.emit('toast:show', { message: 'Keputusan verifikasi berhasil disimpan!', type: 'success' });
          
          // Reload parent state
          await this.loadData();
        } catch (err) {}
      });
    }

    if (telegramBtn) {
      telegramBtn.addEventListener('click', async () => {
        telegramBtn.disabled = true;
        telegramBtn.innerHTML = '<span class="status-pulse-dot" style="width:8px; height:8px; background:white; border-radius:50%; display:inline-block; margin-right:6px;"></span> Mengirim...';
        
        try {
          await new Promise(resolve => setTimeout(resolve, 1200));
          EventBus.emit('toast:show', { message: 'Disiarkan ke Telegram Respon Cepat!', type: 'success' });
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengirim Telegram.', type: 'danger' });
        } finally {
          telegramBtn.disabled = false;
          telegramBtn.innerHTML = '<i data-lucide="send" style="width:14px; height:14px; margin-right:4px;"></i> Siarkan Telegram Respon';
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    // Characters counter validation
    if (commentInput && charCounter) {
      commentInput.addEventListener('input', () => {
        const len = commentInput.value.length;
        charCounter.innerText = `${len}/500`;
        charCounter.style.color = len > 500 ? 'var(--danger)' : 'var(--text-muted)';
      });
    }

    // Submit new comment with custom tags
    if (commentForm && commentInput) {
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = commentInput.value.trim();
        const category = document.getElementById('comment-input-category').value;
        if (!text) return;

        // Append category directly into comment body for structured rendering
        const formattedText = `[${category}] ${text}`;

        try {
          await ReportService.addComment(this.reportId, formattedText);
          commentInput.value = '';
          charCounter.innerText = '0/500';
          EventBus.emit('toast:show', { message: 'Komentar diskusi terkirim!', type: 'success' });
          await this.loadComments(true);
        } catch (err) {}
      });
    }

    // Sort trigger
    if (sortSelect) {
      sortSelect.addEventListener('change', async () => {
        this.commentsSort = sortSelect.value;
        await this.loadComments(true);
      });
    }

    // Community Verification vote triggers
    const voteBtns = document.querySelectorAll('.btn-vote');
    voteBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-vote');
        
        let signals = JSON.parse(localStorage.getItem(`signals_${this.reportId}`)) || {
          active: 14 + (this.reportId % 8),
          resolved: 2 + (this.reportId % 3),
          voted: false
        };

        if (signals.voted) return;

        if (type === 'active') {
          signals.active++;
        } else {
          signals.resolved++;
        }
        signals.voted = true;
        localStorage.setItem(`signals_${this.reportId}`, JSON.stringify(signals));

        // Update display
        const actCount = document.getElementById('signal-count-active');
        const resCount = document.getElementById('signal-count-resolved');
        if (actCount) actCount.innerText = `${signals.active} orang`;
        if (resCount) resCount.innerText = `${signals.resolved} orang`;

        // Disable buttons
        voteBtns.forEach(b => {
          b.style.opacity = '0.5';
          b.style.pointerEvents = 'none';
        });

        EventBus.emit('toast:show', { message: 'Terima kasih atas kontribusi sinyal Anda!', type: 'success' });
      });
    });

    // Community photo uploader
    const btnPhotoUpload = document.getElementById('btn-update-photo-upload');
    const inputPhotoFile = document.getElementById('update-photo-input-file');

    if (btnPhotoUpload && inputPhotoFile) {
      btnPhotoUpload.onclick = () => inputPhotoFile.click();
      
      inputPhotoFile.onchange = async () => {
        const file = inputPhotoFile.files[0];
        if (!file) return;

        btnPhotoUpload.disabled = true;
        btnPhotoUpload.innerHTML = '<span class="status-pulse-dot" style="width:8px; height:8px; background:white; border-radius:50%; display:inline-block; margin-right:6px;"></span> Mengunggah...';

        try {
          // Simulate upload
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Mock append update log to discussion list
          const formattedText = `[Kondisi Terbaru] Warga menambahkan foto pengamatan terbaru dari lokasi sungai.`;
          await ReportService.addComment(this.reportId, formattedText);

          EventBus.emit('toast:show', { message: 'Foto kondisi terbaru berhasil diunggah!', type: 'success' });
          await this.loadComments(true);
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengunggah foto tambahan.', type: 'danger' });
        } finally {
          btnPhotoUpload.disabled = false;
          btnPhotoUpload.innerHTML = '<i data-lucide="camera" style="width:14px; height:14px; margin-right:4px;"></i> Unggah Foto';
          if (window.lucide) window.lucide.createIcons();
        }
      };
    }
  }

  destroy() {
    if (this.slaTimerInterval) {
      clearInterval(this.slaTimerInterval);
      this.slaTimerInterval = null;
    }
  }
}

export const Detail = new DetailPage();
