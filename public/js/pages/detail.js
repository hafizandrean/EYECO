// detail.js - Kontroler Halaman Detail Analisis Laporan Lingkungan (Collaborative Review Workflow)
import { ReportService } from '../services/reportService.js';
import { Router } from '../core/router.js';
import { Formatter } from '../utils/formatter.js';
import { EventBus } from '../core/eventBus.js';
import { AppState } from '../core/state.js';
import { MacModal } from '../utils/macModal.js';

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
    console.log('[DETAIL_FRONTEND] ===== render() dipanggil =====');
    console.log('[DETAIL_FRONTEND] raw id dari URL:', id);
    console.log('[DETAIL_FRONTEND] parsed this.reportId:', this.reportId);
    console.log('[DETAIL_FRONTEND] typeof this.reportId:', typeof this.reportId);
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
        @keyframes spin {
          to { transform: rotate(360deg); }
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
      console.log('[DETAIL_FRONTEND] ===== loadData() dimulai =====');
      console.log('[DETAIL_FRONTEND] reportId (number):', this.reportId);
      console.log('[DETAIL_FRONTEND] reportId (type):', typeof this.reportId);
      const endpoint = `/api/detections/${this.reportId}`;
      console.log('[DETAIL_FRONTEND] endpoint GET:', endpoint);

      const report = await ReportService.getReportById(this.reportId);
      if (!report || (!report.id && !report._id)) {
        throw new Error(`Data Laporan #${this.reportId} tidak dapat ditemukan.`);
      }
      this.report = report;

      console.log('[DETAIL_FRONTEND] ✅ Report berhasil dimuat:', `id=${report.id}, location=${report.location}, image=${report.image}`);

      // Check current user role
      const currentUser = AppState.get('user');
      const isAdmin = currentUser?.role === 'admin';

      // Load community signal values dari backend (report.signals)
      const reportSignals = report.signals || { active: 0, resolved: 0 };
      let signals = {
        active: typeof reportSignals.active === 'number' ? reportSignals.active : (reportSignals.active?.length || 0),
        resolved: typeof reportSignals.resolved === 'number' ? reportSignals.resolved : (reportSignals.resolved?.length || 0),
        voted: false
      };
      
      // Determine active lifecycle step index
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
      // Generate YOLO Boxes with precise image aspect ratio calibration
      let initialBoxesHtml = '';
      const boxes = (report.boundingBoxes && Array.isArray(report.boundingBoxes)) ? report.boundingBoxes : [];

      boxes.forEach(box => {
        const lbl = (box.label || '').toLowerCase();
        const trashKeywords = ['trash', 'sampah', 'plastic', 'bottle', 'bag', 'wrapper', 'pack', 'cup', 'can', 'paper', 'waste', 'litter'];
        const isTrash = trashKeywords.some(k => lbl.includes(k));

        let boxColorClass = 'yolo-default';
        if (lbl.includes('person') || lbl.includes('orang')) {
          boxColorClass = 'yolo-person';
        } else if (lbl.includes('boat') || lbl.includes('perahu')) {
          boxColorClass = 'yolo-boat';
        } else if (isTrash && report.aiStatus !== 'Tidak Terindikasi') {
          boxColorClass = 'yolo-trash';
        }

        const confVal = typeof box.confidence === 'number' ? (box.confidence > 1 ? (box.confidence / 100).toFixed(2) : box.confidence.toFixed(2)) : '0.92';

        initialBoxesHtml += `
          <div class="yolo-preview-box ${boxColorClass}" style="position: absolute; top: ${box.y}%; left: ${box.x}%; width: ${box.w}%; height: ${box.h}%;">
            <span class="yolo-preview-label">${box.label.toUpperCase()} ${confVal}</span>
          </div>
        `;
      });

      // Setup dynamic panels
      grid.innerHTML = `
        <!-- Left Side: Interactive Bounding Box Canvas & Metadata Info -->
        <main style="display: flex; flex-direction: column; gap: var(--space-20);">
          
          <!-- Image Bounding Box Canvas -->
          <div class="glass-card" style="padding: var(--space-16); border-radius: var(--radius-card); position: relative; display:flex; flex-direction:column; align-items:center;">
            <div class="image-canvas-container" style="position: relative; width: 100%; min-height: 350px; max-height: 540px; overflow: hidden; border-radius: 12px; background: rgba(15, 23, 42, 0.95); display:flex; align-items:center; justify-content:center;">
              <div id="image-box-wrapper" style="position: relative; display: inline-block; max-width: 100%; max-height: 100%;">
                <img id="detail-evidence-image" src="${report.image}" alt="Laporan Foto" style="display: block; max-width: 100%; max-height: 520px; width: auto; height: auto; transition: transform 0.25s ease;">
                <div id="yolo-boxes-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
                  ${initialBoxesHtml}
                </div>
              </div>
            </div>
            <!-- Interactive Action buttons -->
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
              ${this.canDelete(report) ? `
              <button class="btn btn-sm btn-danger btn-rounded" id="btn-delete-report" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px; background:rgba(239,68,68,0.12); color:var(--danger); border:1px solid rgba(239,68,68,0.2);">
                <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Hapus
              </button>
              ` : ''}
            </div>
          </div>

          <!-- Metadata Properties Card & 4 Scientific AI Metrics -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:8px;">
                <i data-lucide="brain-circuit" style="color: var(--primary);"></i> Status Indikasi AI v3.0
              </h3>
              <span class="badge" style="font-size:0.8rem; font-weight:800; padding:6px 12px; background: ${report.aiStatus === 'Indikasi Tinggi' ? 'var(--danger)' : (report.aiStatus === 'Indikasi Sedang' ? 'var(--warning)' : 'var(--success)')}; color: #fff;">
                ${report.aiStatus || 'Tidak Terindikasi'}
              </span>
            </div>
            
            <!-- 4 Scientific AI Metrics -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
              <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Object Conf</div>
                <strong style="font-size: 1rem; color: var(--primary); margin-top: 2px; display:block;">${typeof report.objectConfidence === 'number' ? report.objectConfidence : (report.aiConfidence || 0)}%</strong>
              </div>
              <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Scene Conf</div>
                <strong style="font-size: 1rem; color: var(--primary); margin-top: 2px; display:block;">${typeof report.sceneConfidence === 'number' ? report.sceneConfidence : 0}%</strong>
              </div>
              <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Decision Conf</div>
                <strong style="font-size: 1rem; color: var(--primary); margin-top: 2px; display:block;">${typeof report.decisionConfidence === 'number' ? report.decisionConfidence : 80}%</strong>
              </div>
              <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Violation Score</div>
                <strong style="font-size: 1rem; color: var(--danger); margin-top: 2px; display:block;">${typeof report.violationScore === 'number' ? report.violationScore : 0}/100</strong>
              </div>
            </div>

            <!-- Priority & Recommended Action -->
            <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(47, 107, 255, 0.04); padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(47, 107, 255, 0.15);">
              <div>
                <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block;">Prioritas Penanganan</span>
                <strong style="font-size:0.88rem; color: var(--text-primary);">${report.priority || 'NONE'}</strong>
              </div>
              <div style="text-align:right;">
                <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block;">Rekomendasi Aksi</span>
                <span style="font-size:0.82rem; font-weight:700; color: var(--primary);">${report.recommendedAction || 'Tidak ada tindakan otomatis'}</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-16);">
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Jenis Kamera / Sumber</div>
                <strong style="font-size: 0.9rem; color: var(--text-primary); margin-top: 2px; display:block;">${report.sourceType || 'Gambar Upload'}</strong>
              </div>
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Waktu Diunggah</div>
                <strong style="font-size: 0.85rem; color: var(--text-primary); margin-top: 2px; display:block;">${Formatter.formatDate(report.timestamp || report.createdAt)}</strong>
              </div>
            </div>

            <div style="background: rgba(0,0,0,0.02); padding: var(--space-16); border-radius: 12px;">
              <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block; margin-bottom: 4px;">Lokasi Lingkungan</span>
              <span style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); display:flex; align-items:center; gap:6px;">
                <i data-lucide="map-pin" style="color: var(--primary); width:16px; height:16px;"></i> ${report.location || report.locationName || '-'}
              </span>
            </div>

            <div style="background: rgba(0,0,0,0.02); padding: var(--space-16); border-radius: 12px;">
              <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block; margin-bottom: 4px;">Keterangan Tambahan</span>
              <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0; line-height: 1.5;">${report.additionalNotes || '-'}</p>
            </div>
          </div>

          <!-- Explainable AI Auditable Evidence Card -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: 12px; border: 1.5px solid rgba(47, 107, 255, 0.2);">
            <h4 style="font-size: 1rem; font-weight: 800; color: var(--text-primary); margin:0; display:flex; align-items:center; gap:6px;">
              <i data-lucide="shield-check" style="color: var(--success); width:18px; height:18px;"></i> Rincian Bukti & Transparansi Decision (Explainable AI)
            </h4>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${(report.evidenceItems || report.snapshot?.evidenceItems || [
                { code: 'YOLO_OBJECT', label: 'Objek sampah/manusia terdeteksi oleh YOLOv8', value: true, source: 'YOLO_OBJECT', scoreDelta: 25 },
                { code: 'TRASH_NEAR_WRIST', label: 'Kedekatan objek dengan pergelangan tangan', value: false, source: 'POSE_ESTIMATION', scoreDelta: 0 }
              ]).map(ev => `
                <div style="display:flex; align-items:center; justify-content:space-between; background: rgba(0,0,0,0.02); padding: 8px 12px; border-radius: 8px; font-size: 0.8rem;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="${ev.value ? 'check-circle' : 'minus-circle'}" style="color: ${ev.value ? 'var(--success)' : 'var(--text-muted)'}; width:16px; height:16px;"></i>
                    <span>${ev.label}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size: 0.65rem; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; font-weight:700; color: var(--text-secondary);">${ev.source}</span>
                    <strong style="color: ${ev.scoreDelta > 0 ? 'var(--danger)' : (ev.scoreDelta < 0 ? 'var(--success)' : 'var(--text-muted)')};">+${ev.scoreDelta || 0}</strong>
                  </div>
                </div>
              `).join('')}
            </div>
            <div style="background: rgba(239, 68, 68, 0.04); border-left: 3px solid var(--warning); padding: 10px 14px; border-radius: 6px; margin-top: 6px;">
              <span style="font-size: 0.7rem; font-weight: 800; color: var(--text-primary); display:block;">⚠️ Catatan Limitasi Analisis:</span>
              <p style="font-size: 0.75rem; color: var(--text-secondary); margin: 2px 0 0 0;">
                Satu foto belum cukup untuk memastikan aktivitas membuang atau melempar sampah. Verifikasi operator tetap diperlukan.
              </p>
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

          ${isAdmin && report.uploaderInfo ? `
          <!-- Uploader Info Card (Admin only) -->
          <div class="glass-card" style="padding: var(--space-20); border-radius: var(--radius-card); border: 1.5px solid rgba(47, 107, 255, 0.15); background: rgba(47, 107, 255, 0.02);">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.82rem; font-weight: 800; color: var(--text-primary); margin: 0 0 var(--space-12) 0; display:flex; align-items:center; gap:6px;">
              <i data-lucide="user" style="width: 14px; height: 14px; color: var(--primary);"></i> Informasi Pelapor
            </h4>
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width: 40px; height: 40px; border-radius: 50%; background: ${report.uploaderInfo.avatar ? 'transparent' : 'rgba(47,107,255,0.15)'}; border: 1.5px solid var(--border); overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.8rem; color:var(--primary);">
                ${report.uploaderInfo.avatar
                  ? `<img src="${report.uploaderInfo.avatar}" style="width:100%;height:100%;object-fit:cover;" alt="">`
                  : report.uploaderInfo.username.substring(0, 2).toUpperCase()}
              </div>
              <div style="flex:1; min-width:0;">
                <div style="font-size:0.82rem; font-weight:700; color:var(--text-primary);">${report.uploaderInfo.name || report.uploaderInfo.username}</div>
                <div style="font-size:0.68rem; color:var(--text-secondary);">@${report.uploaderInfo.username}</div>
                ${report.uploaderInfo.email ? `<div style="font-size:0.68rem; color:var(--text-muted);">${report.uploaderInfo.email}</div>` : ''}
                ${report.uploaderInfo.phone ? `<div style="font-size:0.68rem; color:var(--text-muted);">${report.uploaderInfo.phone}</div>` : ''}
              </div>
            </div>
          </div>
          ` : ''}

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
                  <strong style="color:var(--info);"><i data-lucide="map-pin" style="width:14px;height:14px;color:var(--info);"></i> ON SITE (ETA 5 Min)</strong>
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
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Lokasi Lingkungan Pulih (RESOLVED)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Lingkungan bersih, tumpukan plastik diangkut</span>
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

          <!-- Operator Action Panel (Government controls - Admin Only) -->
          ${isAdmin ? `
            <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16); border: 1.5px solid rgba(47,107,255,0.15); background: rgba(47, 107, 255, 0.02);">
              <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 800; color: var(--primary); margin: 0; display:flex; align-items:center; gap:8px;">
                <i data-lucide="shield" style="color: var(--primary);"></i> Operator Action Center
              </h3>

              ${report.adminStatus === 'MENUNGGU' ? `
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
                    <option value="Relawan" ${report.assignedOfficer === 'Relawan' ? 'selected' : ''}>Relawan Lingkungan Lokal</option>
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
              ` : `
              <div style="display:flex; flex-direction:column; gap:8px; padding: var(--space-16) 0;">
                <span style="font-size:0.85rem; color: var(--text-primary); font-weight:600;">
                  Status Laporan: <span style="color: ${report.adminStatus === 'VALID' ? 'var(--success)' : 'var(--warning)'};">${report.adminStatus === 'VALID' ? '✓ DIVALIDASI' : '✗ DIABAIKAN'}</span>
                </span>
                ${report.adminNotes ? `<p style="font-size:0.8rem; color: var(--text-secondary); margin:4px 0 0 0;">Catatan: ${report.adminNotes}</p>` : ''}
              </div>
              `}
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

      // Image zoom & print listeners
      const zoomBtn = document.getElementById('btn-detail-zoom');
      const wrapper = document.getElementById('image-box-wrapper');
      if (zoomBtn && wrapper) {
        let scaled = false;
        zoomBtn.onclick = () => {
          scaled = !scaled;
          wrapper.style.transform = scaled ? 'scale(1.5)' : 'scale(1)';
          wrapper.style.zIndex = scaled ? '20' : '1';
          wrapper.style.transition = 'transform 0.25s ease';
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

      // Delete report button (user can delete own report within 10 min)
      const deleteBtn = document.getElementById('btn-delete-report');
      if (deleteBtn) {
        deleteBtn.onclick = async () => {
          const confirmed = await MacModal.confirm(
            'Hapus Laporan',
            `Apakah Anda yakin ingin menghapus laporan <strong>#${this.reportId}</strong>? Tindakan ini tidak dapat dibatalkan.`,
            { iconType: 'danger', confirmText: 'Hapus', cancelText: 'Batal', confirmStyle: 'danger' }
          );
          if (!confirmed) return;
          deleteBtn.disabled = true;
          deleteBtn.innerHTML = '<span class="status-pulse-dot" style="width:8px;height:8px;background:white;border-radius:50%;display:inline-block;margin-right:6px;"></span> Menghapus...';
          try {
            const res = await fetch(`/api/detections/${this.reportId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              EventBus.emit('toast:show', { message: 'Laporan berhasil dihapus', type: 'success' });
              setTimeout(() => Router.navigate('/dashboard/laporan'), 1000);
            } else {
              EventBus.emit('toast:show', { message: data.error || 'Gagal menghapus laporan', type: 'danger' });
              deleteBtn.disabled = false;
              deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus';
              if (window.lucide) window.lucide.createIcons();
            }
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal menghapus laporan', type: 'danger' });
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px;"></i> Hapus';
            if (window.lucide) window.lucide.createIcons();
          }
        };
      }

      // Load comments
      await this.loadComments(true);

    } catch (err) {
      console.error('[DETAIL_FRONTEND] ❌ loadData() ERROR:', err.message || err);
      console.error('[DETAIL_FRONTEND] reportId:', this.reportId);
      console.error('[DETAIL_FRONTEND] error stack:', err.stack);

      // Tampilkan error asli untuk debugging
      const errorMsg = err.message || 'Unknown error';

      grid.innerHTML = `
        <div class="glass-card error-alert-card" style="grid-column: 1 / -1; padding: 32px; text-align: center;">
          <i data-lucide="alert-octagon" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 12px;"></i>
          <h3>Gagal Memuat Detail Laporan</h3>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">${errorMsg}</p>
          <p style="color: var(--text-muted); font-size: 0.75rem; background: rgba(0,0,0,0.03); padding: 8px 12px; border-radius: 6px; display: inline-block;">
            Report ID: ${this.reportId} &middot; Endpoint: <code>/api/detections/${this.reportId}</code>
          </p>
        </div>
      `;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  // Update Status Pill
  updateWorkflowStatusLabel() {
    const statusPill = document.getElementById('detail-workflow-status-pill');
    if (!statusPill) return;

    let statusText = 'MENUNGGU REVIEW';
    let badgeClass = 'bg-warning text-white';

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

  // Running SLA Timer — berhenti kalo udah diverifikasi (verifiedAt ada)
  startSLATimer() {
    if (this.slaTimerInterval) clearInterval(this.slaTimerInterval);

    const timerEl = document.getElementById('detail-sla-timer');
    const statusPill = document.getElementById('detail-workflow-status-pill');
    if (!timerEl) return;

    const rawTime = (this.report && (this.report.timestamp || this.report.createdAt || this.report.capturedAt)) || Date.now();
    const start = new Date(rawTime).getTime();
    if (isNaN(start)) {
      timerEl.innerText = '0h 0m 0s';
      return;
    }

    // Cek apakah udah diverifikasi oleh admin
    if (this.report.verifiedAt) {
      const verifiedAt = new Date(this.report.verifiedAt).getTime();
      if (isNaN(verifiedAt)) {
        this._runLiveTimer(timerEl, start);
        return;
      }
      // Hitung review duration (verifiedAt - createdAt)
      const reviewMs = verifiedAt - start;
      const reviewHours = Math.floor(reviewMs / (1000 * 60 * 60));
      const reviewMinutes = Math.floor((reviewMs % (1000 * 60 * 60)) / (1000 * 60));
      const reviewSeconds = Math.floor((reviewMs % (1000 * 60)) / 1000);
      
      timerEl.innerText = `${reviewHours}h ${reviewMinutes}m ${reviewSeconds}s`;
      timerEl.style.color = 'var(--success)';
      timerEl.style.background = 'rgba(16,185,129,0.08)';
      
      if (statusPill) {
        statusPill.innerText = 'Selesai Ditinjau';
        statusPill.className = 'badge';
        statusPill.style.background = 'var(--success)';
        statusPill.style.color = '#fff';
      }
      return;
    }

    // Belum diverifikasi — timer live
    if (statusPill) {
      statusPill.innerText = 'Menunggu Review';
      statusPill.className = 'badge';
      statusPill.style.background = 'var(--warning)';
      statusPill.style.color = '#fff';
    }
    this._runLiveTimer(timerEl, start);
  }

  _runLiveTimer(timerEl, start) {
    this.slaTimerInterval = setInterval(() => {
      const now = new Date().getTime();
      const diff = now - start;

      if (isNaN(diff) || diff < 0) {
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

    // Group: top-level vs replies
    const replyMap = {};
    const topLevelComments = [];

    this.comments.forEach(c => {
      const parentId = c.parentCommentId || null;
      if (parentId) {
        if (!replyMap[parentId]) replyMap[parentId] = [];
        replyMap[parentId].push(c);
      } else {
        topLevelComments.push(c);
      }
    });

    const sortFn = (a, b) => {
      if (a._id === pinnedCommentId) return -1;
      if (b._id === pinnedCommentId) return 1;
      return 0;
    };
    topLevelComments.sort(sortFn);
    Object.values(replyMap).forEach(replies => replies.sort(sortFn));

    const renderComment = (comment, isReply = false) => {
      const isOwner = comment.userId === currentUser?.id;
      const isAdmin = currentUser?.role === 'admin';
      const isLiked = comment.likedBy.includes(currentUser?.id);
      const isPinned = comment._id === pinnedCommentId;

      const commentItem = document.createElement('div');
      const replyIndent = isReply ? '24px' : '0px';
      const replyBg = isReply ? 'rgba(0,0,0,0.01)' : 'rgba(255, 255, 255, 0.02)';
      const replyBorder = isReply ? '1px solid rgba(0,0,0,0.04)' : 'var(--border)';
      commentItem.style.cssText = `
        display: flex;
        gap: 10px;
        padding: 10px;
        padding-left: ${isReply ? '34px' : '10px'};
        border-radius: var(--radius-button);
        background: ${isPinned ? 'rgba(47, 107, 255, 0.03)' : replyBg};
        border: 1px solid ${isPinned ? 'rgba(47, 107, 255, 0.25)' : replyBorder};
        transition: var(--motion-hover);
        flex-direction: column;
        margin-left: ${replyIndent};
        ${isReply ? 'border-left: 2px solid var(--primary);' : ''}
      `;
      
      const avatarInitials = comment.username ? comment.username.substring(0, 2).toUpperCase() : 'US';
      let commentAvatarHtml = '';
      if (comment.avatar) {
        commentAvatarHtml = `<img src="${comment.avatar}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        commentAvatarHtml = avatarInitials;
      }
      
      // Dynamic Role Badges
      let roleText = 'Masyarakat';
      let badgeClass = 'masyarakat';
      if (comment.role === 'admin') {
        roleText = 'Admin';
        badgeClass = 'admin';
      } else if (comment.username === this.report?.identity) {
        roleText = 'Pelapor';
        badgeClass = 'pelapor';
      }

      const roleBadge = `<span class="discussion-badge ${badgeClass}">${roleText}</span>`;

      // Tag category
      let categoryTagHtml = '';
      const categoryMatch = comment.text.match(/^\[(Umum|Informasi Tambahan|Koreksi|Kondisi Terbaru|Saksi)\]\s*(.*)/);
      let cleanText = comment.text;
      if (categoryMatch) {
        categoryTagHtml = `<span class="comment-tag-badge">${categoryMatch[1]}</span>`;
        cleanText = categoryMatch[2];
      }

      // Highlight mentions
      cleanText = cleanText.replace(/(@[a-zA-Z0-9_]+)/g, '<span class="mention-tag" style="color:var(--primary); font-weight:700; background:rgba(59, 130, 246, 0.12); padding:1px 4px; border-radius:3px;">$1</span>');

      // "Reply to" badge for replies
      const replyToHtml = isReply ? `<span style="font-size:0.6rem; color:var(--text-muted); margin-right:4px;"><i data-lucide="corner-down-right" style="width:10px;height:10px;display:inline-block;vertical-align:middle;"></i> Reply</span>` : '';

      commentItem.innerHTML = `
        <div style="display:flex; gap:10px; width:100%;">
          <div style="width: 28px; height: 28px; border-radius: 50%; background: ${comment.avatar ? 'transparent' : comment.role === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)'}; color: ${comment.role === 'admin' ? 'var(--primary)' : 'var(--text-secondary)'}; border: 1px solid ${comment.role === 'admin' ? 'var(--primary)' : 'var(--border)'}; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; flex-shrink: 0; overflow:hidden;">${commentAvatarHtml}</div>
          
          <div style="flex-grow:1; display:flex; flex-direction:column; gap:4px; min-width: 0;">
            <div style="display:flex; align-items:center; gap:6px;">
              ${replyToHtml}
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
          
          <button class="btn-reply-comment" data-id="${comment._id}" style="background:none; border:none; color: var(--primary); cursor:pointer; font-size:0.68rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 0;">
            <i data-lucide="corner-down-right" style="width:11px; height:11px;"></i> Reply
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

        <!-- Inline Reply Form (hidden by default) -->
        <div class="reply-form-container" data-parent-id="${comment._id}" style="display:none; padding-left:38px; margin-top:6px;">
          <form class="reply-form" style="display:flex; flex-direction:column; gap:6px;">
            <textarea class="reply-input" placeholder="Tulis balasan Anda..." style="height:48px; font-size:0.78rem; padding: 6px 10px; resize:none; border-radius:8px; border:1px solid var(--border); background:var(--surface); width:100%; box-sizing:border-box;" maxlength="500"></textarea>
            <div style="display:flex; gap:6px; justify-content:flex-end;">
              <button type="button" class="btn-reply-cancel" style="background:none; border:1px solid var(--border); border-radius:8px; padding:4px 12px; font-size:0.72rem; font-weight:600; cursor:pointer; color:var(--text-secondary);">Batal</button>
              <button type="submit" class="btn-reply-submit" style="background:var(--primary); color:#fff; border:none; border-radius:8px; padding:4px 14px; font-size:0.72rem; font-weight:700; cursor:pointer;">Kirim</button>
            </div>
          </form>
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

      // Bind reply toggle
      const replyBtn = commentItem.querySelector('.btn-reply-comment');
      const replyFormContainer = commentItem.querySelector('.reply-form-container');
      if (replyBtn && replyFormContainer) {
        replyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Hide all other reply forms first
          document.querySelectorAll('.reply-form-container').forEach(el => {
            if (el !== replyFormContainer) el.style.display = 'none';
          });
          const isVisible = replyFormContainer.style.display === 'block';
          replyFormContainer.style.display = isVisible ? 'none' : 'block';
          if (!isVisible) {
            const textarea = replyFormContainer.querySelector('.reply-input');
            if (textarea) setTimeout(() => textarea.focus(), 50);
          }
        });
      }

      // Bind reply submit
      const replyForm = commentItem.querySelector('.reply-form');
      if (replyForm) {
        replyForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const parentId = replyFormContainer.getAttribute('data-parent-id');
          const input = replyForm.querySelector('.reply-input');
          const text = input.value.trim();
          if (!text) return;

          const submitBtn = replyForm.querySelector('.btn-reply-submit');
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;"></span>';

          try {
            // Get category from parent for context
            const category = document.getElementById('comment-input-category')?.value || 'Umum';
            const formattedText = `[${category}] ${text}`;
            await ReportService.addComment(this.reportId, formattedText, parentId);
            input.value = '';
            replyFormContainer.style.display = 'none';
            EventBus.emit('toast:show', { message: 'Balasan terkirim!', type: 'success' });
            await this.loadComments(true);
          } catch (err) {
            EventBus.emit('toast:show', { message: 'Gagal mengirim balasan.', type: 'danger' });
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Kirim';
          }
        });
      }

      // Bind cancel reply
      const cancelBtn = commentItem.querySelector('.btn-reply-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          replyFormContainer.style.display = 'none';
          const input = replyForm?.querySelector('.reply-input');
          if (input) input.value = '';
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
          const confirmed = await this.showConfirmDialog({
            title: 'Hapus Komentar',
            message: 'Apakah Anda yakin ingin menghapus komentar ini? Tindakan ini tidak dapat dibatalkan.',
            confirmText: 'Hapus',
            variant: 'danger'
          });
          if (!confirmed) return;
          const commentId = deleteBtn.getAttribute('data-id');
          try {
            await ReportService.deleteComment(this.reportId, commentId);
            this.comments = this.comments.filter(c => c._id !== commentId);
            this.renderCommentsList();
          } catch (err) {}
        });
      }

      return commentItem;
    };

    // Render top-level comments with their replies
    topLevelComments.forEach(comment => {
      const commentEl = renderComment(comment, false);
      listEl.appendChild(commentEl);

      const replies = replyMap[comment._id] || [];
      replies.forEach(reply => {
        const replyEl = renderComment(reply, true);
        listEl.appendChild(replyEl);
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // macOS-style confirm dialog
  showConfirmDialog({ title, message, confirmText = 'Hapus', cancelText = 'Batal', variant = 'danger' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99999;opacity:0;transition:opacity 0.18s ease;padding:20px;';
      const iconColor = variant === 'danger' ? '#ef4444' : '#2563eb';
      const circleBg = variant === 'danger' ? 'rgba(239,68,68,0.15)' : 'rgba(37,99,235,0.12)';
      overlay.innerHTML = `<div style="background:rgba(255,255,255,0.12);backdrop-filter:blur(40px) saturate(1.4);-webkit-backdrop-filter:blur(40px) saturate(1.4);border-radius:16px;padding:28px 24px 20px;width:100%;max-width:320px;box-shadow:0 16px 64px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.08);transform:scale(0.92) translateY(12px);transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1),opacity 0.2s ease;opacity:0;text-align:center;"><div style="width:48px;height:48px;border-radius:50%;background:${circleBg};display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${variant === 'danger' ? '<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>' : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}</svg></div><div style="font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:6px;">${title}</div><div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.4;margin-bottom:20px;">${message}</div><div style="display:flex;gap:10px;"><button class="confirm-cancel" style="flex:1;padding:10px 16px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text-primary);font-size:0.82rem;font-weight:600;cursor:pointer;">${cancelText}</button><button class="confirm-ok" style="flex:1;padding:10px 16px;border-radius:10px;border:none;background:${variant === 'danger' ? '#ef4444' : '#2563eb'};color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">${confirmText}</button></div></div>`;
      document.body.appendChild(overlay);
      const dialog = overlay.firstChild;
      requestAnimationFrame(() => { overlay.style.opacity = '1'; dialog.style.opacity = '1'; dialog.style.transform = 'scale(1) translateY(0)'; });
      const close = (result) => { overlay.style.opacity = '0'; dialog.style.opacity = '0'; dialog.style.transform = 'scale(0.92) translateY(12px)'; setTimeout(() => overlay.remove(), 200); resolve(result); };
      overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
      overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      const onKey = (e) => { if (e.key === 'Escape') { window.removeEventListener('keydown', onKey); close(false); } };
      window.addEventListener('keydown', onKey);
    });
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
          await this.loadData();
        } catch (err) {
          console.error('[DETAIL_FRONTEND] verifyReport error:', err);
        }
      });
    }

    // Telegram button
    if (telegramBtn) {
      telegramBtn.addEventListener('click', async () => {
        telegramBtn.disabled = true;
        telegramBtn.innerHTML = '<span class="status-pulse-dot" style="width:8px; height:8px; background:white; border-radius:50%; display:inline-block; margin-right:6px;"></span> Mengirim...';

        const telegramUrl = `/api/v1/detections/${this.reportId}/telegram`;
        console.log('[DETAIL_FRONTEND] Telegram dispatch to:', telegramUrl);

        try {
          const res = await fetch(telegramUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          console.log('[DETAIL_FRONTEND] Telegram response status:', res.status);
          const data = await res.json();
          console.log('[DETAIL_FRONTEND] Telegram response body:', JSON.stringify(data));
          if (res.ok && data.success) {
            EventBus.emit('toast:show', { message: 'Disiarkan ke Telegram Respon Cepat!', type: 'success' });
          } else {
            throw new Error(data.error || 'Gagal mengirim Telegram');
          }
        } catch (err) {
          EventBus.emit('toast:show', { message: err.message || 'Gagal mengirim Telegram.', type: 'danger' });
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

    // Community Verification vote triggers — simpan ke backend, bukan localStorage
    const voteBtns = document.querySelectorAll('.btn-vote');
    voteBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.getAttribute('data-vote');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;"></i>';

        try {
          const res = await fetch(`/api/detections/${this.reportId}/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type })
          });
          const result = await res.json();

          if (result.success) {
            const data = result.data;
            const actCount = document.getElementById('signal-count-active');
            const resCount = document.getElementById('signal-count-resolved');
            if (actCount) actCount.innerText = `${data.active} orang`;
            if (resCount) resCount.innerText = `${data.resolved} orang`;

            // Disable all vote buttons
            voteBtns.forEach(b => {
              b.style.opacity = '0.5';
              b.style.pointerEvents = 'none';
              b.disabled = true;
              // Reset innerHTML
              const bt = b.getAttribute('data-vote');
              b.innerHTML = bt === 'active' ? 'Masih Ada' : 'Sudah Bersih';
            });

            EventBus.emit('toast:show', { message: 'Terima kasih atas kontribusi sinyal Anda!', type: 'success' });
          } else {
            EventBus.emit('toast:show', { message: result.error || 'Gagal mengirim sinyal', type: 'danger' });
            btn.disabled = false;
            btn.innerHTML = type === 'active' ? 'Masih Ada' : 'Sudah Bersih';
          }
        } catch (err) {
          EventBus.emit('toast:show', { message: 'Gagal mengirim sinyal', type: 'danger' });
          btn.disabled = false;
          btn.innerHTML = type === 'active' ? 'Masih Ada' : 'Sudah Bersih';
        }

        if (window.lucide) window.lucide.createIcons();
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
          const formattedText = `[Kondisi Terbaru] Warga menambahkan foto pengamatan terbaru dari lokasi lingkungan.`;
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

  canDelete(report) {
    // Backend already computes this; use it if present
    if (report && typeof report.canDelete === 'boolean') return report.canDelete;

    // Fallback: client-side check (only if backend flag missing)
    const currentUser = AppState.get('user');
    if (!currentUser || !report) return false;
    const uid = (currentUser._id || currentUser.id || '').toString();
    const ruid = (report.userId || '').toString();
    if (!ruid || ruid !== uid) return false;
    const createdAt = report.createdAt || report.timestamp;
    if (!createdAt) return false;
    return (Date.now() - new Date(createdAt).getTime()) < 10 * 60 * 1000;
  }

  destroy() {
    if (this.slaTimerInterval) {
      clearInterval(this.slaTimerInterval);
      this.slaTimerInterval = null;
    }
  }
}

export const Detail = new DetailPage();
