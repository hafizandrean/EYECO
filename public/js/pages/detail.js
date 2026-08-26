// detail.js - Kontroler Halaman Detail Analisis Laporan Lingkungan (Collaborative Review Workflow)
import { API } from '../services/api.js';
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

      <!-- Back navigation bar with Report ID -->
      <section class="detail-nav-row" style="margin-bottom: var(--space-20); animation: pageFadeIn var(--motion-open); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <button class="btn btn-glass btn-rounded btn-back-route" id="btn-detail-back" style="padding: 10px 20px; font-weight:700;">
          <i data-lucide="arrow-left" style="width: 16px; height: 16px; margin-right: 4px;"></i> Kembali ke Daftar
        </button>
        <div id="detail-header-id-badge" style="font-size: 1.05rem; font-weight: 800; color: var(--primary); background: rgba(37,99,235,0.12); border: 1px solid rgba(37,99,235,0.25); padding: 8px 18px; border-radius: 20px; display: inline-flex; align-items: center; gap: 8px; font-family: monospace;">
          <i data-lucide="file-text" style="width:18px; height:18px;"></i> Identitas Laporan #${this.reportId}
        </div>
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

      console.log('[DETAIL_FRONTEND] Report berhasil dimuat:', `id=${report.id}, location=${report.location}, image=${report.image}`);

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
      const rawBoxes = (report.boundingBoxes && Array.isArray(report.boundingBoxes)) ? report.boundingBoxes : [];

      // IoU (Intersection over Union) calculation for box deduplication
      const calculateIoU = (b1, b2) => {
        const xA = Math.max(b1.x, b2.x);
        const yA = Math.max(b1.y, b2.y);
        const xB = Math.min(b1.x + b1.w, b2.x + b2.w);
        const yB = Math.min(b1.y + b1.h, b2.y + b2.h);
        const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
        const box1Area = b1.w * b1.h;
        const box2Area = b2.w * b2.h;
        const unionArea = box1Area + box2Area - interArea;
        return unionArea > 0 ? interArea / unionArea : 0;
      };

      const boxes = [];
      rawBoxes.forEach(box => {
        const isDuplicate = boxes.some(u => 
          (u.label || '').toLowerCase() === (box.label || '').toLowerCase() &&
          calculateIoU(u, box) > 0.80
        );
        if (!isDuplicate) boxes.push(box);
      });

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

        // Normalisasi koordinat ke persen (0-100) — YOLO asli kadang 0-1
        let bx = box.x, by = box.y, bw = box.w, bh = box.h;
        if (bw <= 1 && bh <= 1) { bx *= 100; by *= 100; bw *= 100; bh *= 100; }
        initialBoxesHtml += `
          <div class="yolo-preview-box ${boxColorClass}" style="position: absolute; top: ${by}%; left: ${bx}%; width: ${bw}%; height: ${bh}%;">
            <span class="yolo-preview-label">${box.label.toUpperCase()} ${confVal}</span>
          </div>
        `;
      });

      // Render media component depending on video or image source
      const isVideo = report.sourceType === 'Video' || report.createdFrom === 'VIDEO_AI';
      let mediaHtml = '';
      let downloadUrl = report.image;
      let downloadExt = 'jpg';

      if (isVideo) {
        if (report.videoPath) {
          mediaHtml = `<video id="detail-evidence-video" src="${report.videoPath}" poster="${report.image}" controls style="display: block; width: 100%; max-height: 650px; height: auto; object-fit: contain; border-radius: 8px;"></video>`;
          downloadUrl = report.videoPath;
          downloadExt = 'mp4';
        } else if (report.videoAnalysisJobId && report.shortIncidentKey) {
          const videoSrc = `/api/video-analysis/${report.videoAnalysisJobId}/incidents/${report.shortIncidentKey}/evidence?type=clip`;
          const posterSrc = `/api/video-analysis/${report.videoAnalysisJobId}/incidents/${report.shortIncidentKey}/evidence?type=raw`;
          mediaHtml = `<video id="detail-evidence-video" src="${videoSrc}" poster="${posterSrc}" controls style="display: block; width: 100%; max-height: 650px; height: auto; object-fit: contain; border-radius: 8px;"></video>`;
          downloadUrl = videoSrc;
          downloadExt = 'mp4';
        } else {
          mediaHtml = `<img id="detail-evidence-image" src="${report.image}" alt="Laporan Foto" style="display: block; width: 100%; max-height: 650px; height: auto; object-fit: contain; border-radius: 8px; transition: transform 0.25s ease;">`;
        }
      } else {
        mediaHtml = `<img id="detail-evidence-image" src="${report.image}" alt="Laporan Foto" style="display: block; width: 100%; max-height: 650px; height: auto; object-fit: contain; border-radius: 8px; transition: transform 0.25s ease;">`;
      }

      // Setup dynamic panels
      grid.innerHTML = `
        <!-- Left Side: Interactive Bounding Box Canvas & Metadata Info -->
        <main style="display: flex; flex-direction: column; gap: var(--space-20);">
          
          <!-- Image Bounding Box Canvas -->
          <div class="glass-card" style="padding: var(--space-16); border-radius: var(--radius-card); position: relative; display:flex; flex-direction:column; align-items:center;">
            <div class="image-canvas-container" style="position: relative; width: 100%; border-radius: 12px; background: rgba(15, 23, 42, 0.4); overflow: hidden; display:flex; align-items:center; justify-content:center; padding: 4px;">
              <div id="image-box-wrapper" style="position: relative; width: 100%; display: flex; justify-content: center; align-items: center;">
                ${mediaHtml}
                <div id="yolo-boxes-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
                  ${initialBoxesHtml}
                </div>
              </div>
            </div>
            <!-- Interactive Action buttons -->
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top: 12px;">
              <button class="btn btn-sm btn-glass btn-rounded" id="btn-detail-zoom" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px;">
                <i data-lucide="zoom-in" style="width:14px; height:14px;"></i> Perbesar
              </button>
              <a href="${downloadUrl}" download="EYECO_Evidence_${report.id}.${downloadExt}" class="btn btn-sm btn-glass btn-rounded" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px; text-decoration:none; color: var(--text-primary);">
                <i data-lucide="download" style="width:14px; height:14px;"></i> Unduh
              </a>
              <button class="btn btn-sm btn-glass btn-rounded" id="btn-detail-export-pdf" style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:4px; padding: 6px 12px;">
                <i data-lucide="file-text" style="width:14px; height:14px;"></i> Ekspor PDF
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
            ${(() => {
              const integrityStatus = report.aiDataIntegrityStatus || (report.activeSnapshotId ? 'VALID' : 'LEGACY');
              let headerTitle = '<i data-lucide="brain-circuit" style="color: var(--primary);"></i> Status Indikasi AI v3.0';
              if (integrityStatus === 'SNAPSHOT_MISSING') {
                headerTitle = '<i data-lucide="alert-triangle" style="color: var(--danger);"></i> Data Analisis AI Tidak Lengkap';
              } else if (integrityStatus === 'LEGACY') {
                headerTitle = '<i data-lucide="history" style="color: var(--text-muted);"></i> Hasil AI Versi Lama';
              }
              const rawStatus = (report.aiStatus || '').toUpperCase().trim();
              const isHigh = rawStatus.includes('TINGGI') || rawStatus === 'HIGH';
              const isMed = rawStatus.includes('SEDANG') || rawStatus === 'MEDIUM';
              const isLow = rawStatus.includes('RENDAH') || rawStatus === 'LOW';
              const badgeClass = isHigh ? 'high' : (isMed ? 'medium' : (isLow ? 'low' : 'none'));
              const badgeText = isHigh ? 'Tinggi' : (isMed ? 'Sedang' : (isLow ? 'Rendah' : 'Tidak Terindikasi'));
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                  <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:8px;">
                    ${headerTitle}
                    <span style="font-size:0.8rem; font-weight:800; font-family:monospace; padding:3px 10px; border-radius:12px; background:rgba(37,99,235,0.1); color:var(--primary); border:1px solid rgba(37,99,235,0.2);">#${report.id}</span>
                  </h3>
                  <span class="badge badge-${badgeClass}" style="font-size:0.85rem; font-weight:800; padding:6px 14px;">
                    ${badgeText}
                  </span>
                </div>
              `;
            })()}
            
            <!-- 4 Scientific AI Metrics -->
            ${(() => {
              const integrityStatus = report.aiDataIntegrityStatus || (report.analysisState === 'PROCESSING' ? 'PENDING' : (report.activeSnapshotId ? 'VALID' : 'LEGACY'));
              if (integrityStatus !== 'VALID') {
                let noteMsg = `Keyakinan Deteksi Legacy: ${report.aiConfidence ? report.aiConfidence + '%' : '—'} — Skor Indikasi AI: Tidak tersedia`;
                let noteStyle = 'color: var(--text-secondary); background: rgba(0,0,0,0.03); font-style: italic;';
                if (integrityStatus === 'PENDING' || report.analysisState === 'PROCESSING') {
                  noteMsg = 'Sedang diproses oleh AI Engine v3.0 — Menunggu hasil analisis keputusan (Skor: Menunggu)';
                  noteStyle = 'color: var(--primary); background: rgba(47,107,255,0.06); font-weight: 700;';
                } else if (report.analysisState === 'REANALYSIS_PENDING') {
                  noteMsg = 'Proses AI sebelumnya terhenti — Masuk antrean analisis ulang otomatis (Skor: Menunggu)';
                  noteStyle = 'color: var(--warning); background: rgba(245,158,11,0.06); font-weight: 700;';
                } else if (integrityStatus === 'SNAPSHOT_MISSING') {
                  noteMsg = 'Snapshot AI tidak berhasil dibuat — analisis ulang diperlukan (Skor: Tidak tersedia)';
                  noteStyle = 'color: var(--danger); background: rgba(239,68,68,0.06); font-weight: 700;';
                } else if (integrityStatus === 'INCONSISTENT') {
                  noteMsg = 'Data AI tidak konsisten — laporan sedang menunggu perbaikan integritas';
                  noteStyle = 'color: var(--warning); background: rgba(245,158,11,0.06); font-weight: 700;';
                }
                return `
                  <div style="${noteStyle} padding: 10px 14px; border-radius: 8px; font-size: 0.78rem; text-align: center;">
                    ${noteMsg}
                  </div>
                `;
              }

              const objVal = report.objectConfidence !== null && report.objectConfidence !== undefined ? `${report.objectConfidence}%` : '—';
              const sceneVal = report.sceneConfidence !== null && report.sceneConfidence !== undefined ? `${report.sceneConfidence}%` : '—';
              const decVal = report.decisionConfidence !== null && report.decisionConfidence !== undefined ? `${report.decisionConfidence}%` : '—';
              const scoreVal = typeof report.violationScore === 'number' ? `${report.violationScore}/100` : 'Tidak tersedia';

              return `
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                  <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                    <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Keyakinan Objek</div>
                    <strong style="font-size: 1rem; color: var(--primary); margin-top: 2px; display:block;">${objVal}</strong>
                  </div>
                  <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                    <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Keyakinan Lokasi</div>
                    <strong style="font-size: 1rem; color: var(--primary); margin-top: 2px; display:block;">${sceneVal}</strong>
                  </div>
                  <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                    <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Keyakinan Keputusan</div>
                    <strong style="font-size: 1rem; color: var(--primary); margin-top: 2px; display:block;">${decVal}</strong>
                  </div>
                  <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; text-align:center;">
                    <div style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Skor Indikasi AI</div>
                    <strong style="font-size: 1rem; color: var(--danger); margin-top: 2px; display:block;">${scoreVal}</strong>
                  </div>
                </div>
              `;
            })()}

            <!-- Priority & Recommended Action -->
            <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(47, 107, 255, 0.04); padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(47, 107, 255, 0.15);">
              <div>
                <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block;">Prioritas Penanganan</span>
                <strong style="font-size:0.88rem; color: var(--text-primary);">${(() => {
                  const prioMap = { 'NONE': 'TIDAK ADA', 'LOW': 'RENDAH', 'MEDIUM': 'SEDANG', 'HIGH': 'TINGGI', 'CRITICAL': 'KRITIS' };
                  return prioMap[report.priority] || report.priority || 'TIDAK ADA';
                })()}</strong>
              </div>
              <div style="text-align:right;">
                <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; display:block;">Rekomendasi Aksi</span>
                <span style="font-size:0.82rem; font-weight:700; color: var(--primary);">${report.recommendedAction || 'Tidak ada tindakan otomatis'}</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-16);">
              <div style="background: rgba(0,0,0,0.02); padding: var(--space-12); border-radius: 10px;">
                <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Jenis Kamera / Sumber</div>
                <strong style="font-size: 0.9rem; color: var(--text-primary); margin-top: 2px; display:block;">${(() => {
                  const srcMap = { 'AI_CCTV': 'CCTV AI', 'Otomatis': 'Otomatis', 'Gambar': 'Gambar Upload', 'Video': 'Video Upload' };
                  return srcMap[report.sourceType] || report.sourceType || 'Gambar Upload';
                })()}</strong>
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
              <i data-lucide="shield-check" style="color: var(--success); width:18px; height:18px;"></i> Rincian Bukti & Transparansi Keputusan AI
            </h4>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${(() => {
                const items = (report.evidenceItems || report.snapshot?.evidenceItems || [
                  { code: 'YOLO_OBJECT', label: 'Objek sampah/manusia terdeteksi oleh YOLOv8', value: true, source: 'YOLO_OBJECT', scoreDelta: 25 },
                  { code: 'TRASH_NEAR_WRIST', label: 'Kedekatan objek dengan pergelangan tangan', value: false, source: 'POSE_ESTIMATION', scoreDelta: 0 }
                ]);
                const srcMap = {
                                  'YOLO_OBJECT': 'DETEKSI_OBJEK_YOLO',
                                  'POSE_ESTIMATION': 'ESTIMASI_POSE',
                                  'SPATIAL_ANALYZER': 'ANALISIS_SPASIAL',
                                  'SEMANTIC_ANALYZER': 'ANALISIS_SEMANTIK',
                                  'REGION_ANALYZER': 'ANALISIS_WILAYAH'
                                };
                
                                // Sum ALL scoreDeltas (positive and negative) to show actual contribution
                                let sumDelta = 0;
                                let html = items.map(ev => {
                                  if (typeof ev.scoreDelta === 'number') sumDelta += ev.scoreDelta;
                                  const cleanSource = srcMap[ev.source] || ev.source;
                                  return `
                                    <div style="display:flex; align-items:center; justify-content:space-between; background: rgba(0,0,0,0.02); padding: 8px 12px; border-radius: 8px; font-size: 0.8rem;">
                                      <div style="display:flex; align-items:center; gap:8px;">
                                        <i data-lucide="${ev.value ? 'check-circle' : 'minus-circle'}" style="color: ${ev.value ? 'var(--success)' : 'var(--text-muted)'}; width:16px; height:16px;"></i>
                                        <span>${ev.label}</span>
                                      </div>
                                      <div style="display:flex; align-items:center; gap:6px;">
                                        <span style="font-size: 0.65rem; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; font-weight:700; color: var(--text-secondary);">${cleanSource}</span>
                                        <strong style="color: ${ev.scoreDelta > 0 ? 'var(--danger)' : (ev.scoreDelta < 0 ? 'var(--success)' : 'var(--text-muted)')};">${ev.scoreDelta >= 0 ? '+' : ''}${ev.scoreDelta || 0}</strong>
                                      </div>
                                    </div>
                                  `;
                                }).join('');

                                // Show base score if it exists
                                const baseScore = (typeof report.baseScore === 'number') ? report.baseScore : 0;
                                const calculatedTotal = baseScore + sumDelta;
                                const finalScore = typeof report.violationScore === 'number' ? report.violationScore : calculatedTotal;
                
                                if (baseScore !== 0) {
                                  html = `
                                    <div style="display:flex; align-items:center; justify-content:space-between; background: rgba(37,99,235,0.08); padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; border: 1px solid rgba(37,99,235,0.2);">
                                      <div style="display:flex; align-items:center; gap:8px;">
                                        <i data-lucide="sliders-horizontal" style="color: var(--primary); width:16px; height:16px;"></i>
                                        <span>Skor Dasar (Base Score)</span>
                                      </div>
                                      <strong style="color: var(--primary);">+${baseScore}</strong>
                                    </div>
                                  ` + html;
                                }

                                if (typeof report.violationScore === 'number' && report.violationScore !== calculatedTotal) {
                                  html += `
                                    <div style="display:flex; align-items:center; justify-content:space-between; background: rgba(239,68,68,0.08); border: 1px dashed rgba(239,68,68,0.3); padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; color: var(--text-secondary);">
                                      <div style="display:flex; align-items:center; gap:8px;">
                                        <i data-lucide="info" style="color: var(--danger); width:14px; height:14px;"></i>
                                        <span>Total dihitung: ${calculatedTotal} (Dasar ${baseScore} + Bukti ${sumDelta >= 0 ? '+' : ''}${sumDelta}) → Skor Akhir AI: ${report.violationScore}/100</span>
                                      </div>
                                      <span style="font-size:0.7rem; font-style:italic; color:var(--text-muted);">Penyesuaian model/aturan tambahan tidak ditampilkan</span>
                                    </div>
                                  `;
                                } else if (typeof report.violationScore === 'number') {
                                  html += `
                                    <div style="display:flex; align-items:center; justify-content:space-between; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; color: var(--text-secondary);">
                                      <div style="display:flex; align-items:center; gap:8px;">
                                        <i data-lucide="check-circle-2" style="color: var(--success); width:14px; height:14px;"></i>
                                        <span>Total terverifikasi: ${calculatedTotal} = Skor Akhir AI ${report.violationScore}/100</span>
                                      </div>
                                    </div>
                                  `;
                                }
                                return html;
              })()}
            </div>
            <div style="background: rgba(239, 68, 68, 0.04); border-left: 3px solid var(--warning); padding: 10px 14px; border-radius: 6px; margin-top: 6px;">
              <span style="font-size: 0.7rem; font-weight: 800; color: var(--text-primary); display:block;">Catatan Limitasi Analisis:</span>
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
              <span id="detail-workflow-status-pill" class="badge" style="font-size: 0.85rem; padding: 6px 12px; font-weight:800;">Menunggu Tinjauan</span>
              <span id="detail-sla-timer" style="font-family: monospace; font-size: 0.95rem; font-weight: 800; color: var(--danger); background: rgba(239, 68, 68, 0.05); padding: 4px 10px; border-radius: 6px;">0j 0m 0d</span>
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
                <i data-lucide="truck" style="width: 14px; height: 14px; color: var(--primary);"></i> Status Pengiriman Petugas
              </h4>
              <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px; font-size:0.78rem;">
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-secondary);">Regu Lapangan:</span>
                  <strong style="color:var(--text-primary);">Tim ${report.assignedOfficer}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:2px;">
                  <span style="color:var(--text-secondary);">Status Tugas:</span>
                  <strong style="color:var(--info);"><i data-lucide="map-pin" style="width:14px;height:14px;color:var(--info);"></i> DI LOKASI (ETA 5 Menit)</strong>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:2px;">
                  <span style="color:var(--text-secondary);">Petugas PJ:</span>
                  <strong style="color:var(--text-primary);">Petugas Andre (Pembersihan Dimulai)</strong>
                </div>
              </div>
            </div>
          ` : ''}

          <!-- 7-Stage Incident Lifecycle Card -->
          <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16);">
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display:flex; align-items:center; gap:8px;">
              <i data-lucide="git-commit" style="color: var(--primary);"></i> Siklus Insiden
            </h3>
            
            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 8px; position: relative;">
              <!-- 7 Steps -->
              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 0 ? (activeStep === 0 ? 'active' : 'completed') : ''}">1</div>
                <div class="lifecycle-line ${activeStep > 0 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Deteksi AI (BARU)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Objek tumpukan plastik dipindai model</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 1 ? (activeStep === 1 ? 'active' : 'completed') : ''}">2</div>
                <div class="lifecycle-line ${activeStep > 1 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Tinjauan Operator (SEDANG DITINJAU)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Validator memeriksa kesesuaian deteksi AI</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 2 ? (activeStep === 2 ? 'active' : 'completed') : ''}">3</div>
                <div class="lifecycle-line ${activeStep > 2 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Validasi Berhasil (TERVALIDASI)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Laporan disetujui untuk tindakan lanjutan</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 3 ? (activeStep === 3 ? 'active' : 'completed') : ''}">4</div>
                <div class="lifecycle-line ${activeStep > 3 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Petugas Ditunjuk (TERTUGAS)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Instansi dinas / regu RT ditugaskan</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 4 ? (activeStep === 4 ? 'active' : 'completed') : ''}">5</div>
                <div class="lifecycle-line ${activeStep > 4 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Pembersihan Lapangan (SEDANG BERLANGSUNG)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Regu kebersihan melakukan pengangkutan</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 5 ? (activeStep === 5 ? 'active' : 'completed') : ''}">6</div>
                <div class="lifecycle-line ${activeStep > 5 ? 'completed' : ''}"></div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Lokasi Lingkungan Pulih (SELESAI)</span>
                  <span style="font-size: 0.68rem; color: var(--text-secondary);">Lingkungan bersih, tumpukan plastik diangkut</span>
                </div>
              </div>

              <div style="display: flex; gap: 16px; position: relative;">
                <div class="lifecycle-dot ${activeStep >= 6 ? 'active' : ''}">7</div>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-primary);">Arsip Kasus Ditutup (DITUTUP)</span>
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

            </div>
          </div>

          <!-- Operator Action Panel (Government controls - Admin Only) -->
          ${isAdmin ? `
            <div class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16); border: 1.5px solid rgba(47,107,255,0.15); background: rgba(47, 107, 255, 0.02);">
              <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 800; color: var(--primary); margin: 0; display:flex; align-items:center; gap:8px;">
                <i data-lucide="shield" style="color: var(--primary);"></i> Operator Action Center
              </h3>

              ${report.adminStatus === 'MENUNGGU' ? `
                <!-- STATE 1: PENDING VALIDATION -->
                <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 12px 16px;">
                  <span style="font-size:0.82rem; font-weight:700; color: #d97706; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="clock" style="width:14px; height:14px;"></i> Status: MENUNGGU VALIDASI
                  </span>
                  <p style="font-size:0.75rem; color: var(--text-secondary); margin:4px 0 0 0;">Laporan belum divalidasi operator. Pilih keputusan di bawah ini.</p>
                </div>

                <form id="detail-verify-form" class="detail-verify-form" style="display:flex; flex-direction:column; gap:12px;">
                  <div class="form-group">
                    <label class="form-label" style="font-size:0.75rem;" for="verify-status-select">Keputusan Validasi Operator</label>
                    <select class="form-control select-rounded" id="verify-status-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;" required>
                      <option value="VALID" selected>✓ Valid (Sahkan & Otomatis Antrekan Telegram)</option>
                      <option value="TIDAK_VALID">✗ Tidak Valid (Bukan Insiden / Salah AI)</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label" style="font-size:0.75rem;" for="verify-assignment-select">Tugaskan Instansi</label>
                    <select class="form-control select-rounded" id="verify-assignment-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;">
                      <option value="">-- Belum Ditunjuk --</option>
                      <option value="BBWS">BBWS (River Authority)</option>
                      <option value="DLH">DLH (Dinas Lingkungan Hidup)</option>
                      <option value="Relawan">Relawan Lingkungan Lokal</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label" style="font-size:0.75rem;" for="verify-notes-input">Catatan Validasi & Instruksi</label>
                    <textarea class="form-control textarea-rounded" id="verify-notes-input" style="font-size:0.8rem; background:#ffffff; padding: 10px; margin-top:4px;" placeholder="Instruksi rujukan dinas sosial atau petugas RT setempat..." rows="2"></textarea>
                  </div>

                  <button type="submit" class="btn btn-primary btn-rounded" style="width: 100%; font-weight: 700; height: 38px; font-size: 0.8rem; margin-top: 4px;">
                    <i data-lucide="check-circle" style="width:14px; height:14px; margin-right:4px;"></i> Simpan & Sahkan Laporan
                  </button>
                </form>
              ` : (report.adminStatus === 'VALID' ? `
                <!-- STATE 2: VALID / DIVALIDASI (LOCKED DECISION + EDITABLE WORKFLOW + TELEGRAM STATUS) -->
                <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 12px 16px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem; font-weight:800; color: var(--success); display:flex; align-items:center; gap:6px;">
                      <i data-lucide="check-circle-2" style="width:16px; height:16px;"></i> Laporan Divalidasi
                    </span>
                    <span style="font-size:0.7rem; color: var(--text-muted);">${report.verifiedAt ? new Date(report.verifiedAt).toLocaleDateString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''}</span>
                  </div>
                  ${report.adminNotes ? `<p style="font-size:0.78rem; color: var(--text-secondary); margin:6px 0 0 0;">Catatan: ${report.adminNotes}</p>` : ''}
                </div>

                <!-- Telegram Broadcast Status Section -->
                <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; align-items:center; justify-content:space-between;">
                    <span style="font-size:0.75rem; font-weight:700; color: var(--text-muted); text-transform:uppercase;">Telegram Broadcast</span>
                    ${report.telegramStatus === 'SENT' ? `
                      <span style="font-size:0.75rem; font-weight:700; color: var(--success); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="check" style="width:13px; height:13px;"></i> Terkirim
                      </span>
                    ` : (report.telegramStatus === 'SENDING' ? `
                      <span style="font-size:0.75rem; font-weight:700; color: var(--primary); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="clock" style="width:13px; height:13px;"></i> Mengirim...
                      </span>
                    ` : ((report.telegramStatus === 'FAILED' || report.telegramStatus === 'NOT_ELIGIBLE') ? `
                      <span style="font-size:0.75rem; font-weight:700; color: var(--danger); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="alert-triangle" style="width:13px; height:13px;"></i> ${report.telegramStatus === 'NOT_ELIGIBLE' ? 'Tidak Terkirim' : 'Gagal'}
                      </span>
                    ` : `
                      <span style="font-size:0.75rem; font-weight:700; color: var(--warning); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="clock" style="width:13px; height:13px;"></i> Antrean
                      </span>
                    `))}
                  </div>

                  ${report.telegramStatus === 'SENT' ? `
                    <span style="font-size:0.75rem; color: var(--text-secondary);">Disiarkan ke Telegram channel pada ${report.telegramSentAt ? new Date(report.telegramSentAt).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : 'sekarang'}.</span>
                  ` : (report.telegramStatus === 'SENDING' ? `
                    <span style="font-size:0.75rem; color: var(--text-secondary);">Pesan sedang diproses dan dikirim oleh worker Telegram...</span>
                  ` : ((report.telegramStatus === 'FAILED' || report.telegramStatus === 'NOT_ELIGIBLE') ? `
                    <span style="font-size:0.75rem; color: var(--danger);">${report.telegramError || (report.telegramStatus === 'NOT_ELIGIBLE' ? 'Laporan belum dikirimkan ke Telegram channel.' : 'Gagal menyiarkan pesan ke Telegram channel.')}</span>
                    <button class="btn btn-soft btn-sm btn-rounded" id="btn-telegram-dispatch" style="font-size:0.75rem; color: var(--primary); margin-top:4px;">
                      <i data-lucide="rotate-cw" style="width:13px; height:13px; margin-right:4px;"></i> Coba Kirim Ulang ke Telegram
                    </button>
                  ` : `
                    <span style="font-size:0.75rem; color: var(--text-secondary);">Menunggu dikirim otomatis oleh sistem ke Telegram channel...</span>
                  `))}
                </div>

                <!-- Active Operational Workflow Controls -->
                <form id="detail-verify-form" class="detail-verify-form" style="display:flex; flex-direction:column; gap:12px; margin-top:4px;">
                  <input type="hidden" id="verify-status-select" value="VALID" />
                  
                  <div class="form-group">
                    <label class="form-label" style="font-size:0.75rem;" for="verify-assignment-select">Tugaskan Instansi / Petugas</label>
                    <select class="form-control select-rounded" id="verify-assignment-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;">
                      <option value="" ${!report.assignedOfficer ? 'selected' : ''}>-- Belum Ditunjuk --</option>
                      <option value="BBWS" ${report.assignedOfficer === 'BBWS' ? 'selected' : ''}>BBWS (River Authority)</option>
                      <option value="DLH" ${report.assignedOfficer === 'DLH' ? 'selected' : ''}>DLH (Dinas Lingkungan Hidup)</option>
                      <option value="Relawan" ${report.assignedOfficer === 'Relawan' ? 'selected' : ''}>Relawan Lingkungan Lokal</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label" style="font-size:0.75rem;" for="verify-progress-select">Alur Penanganan / Status Operasional</label>
                    <select class="form-control select-rounded" id="verify-progress-select" style="font-size:0.8rem; background:#ffffff; height:34px; margin-top:4px;">
                      <option value="PENDING" ${report.status === 'PENDING' ? 'selected' : ''}>Menunggu Aksi (Pending)</option>
                      <option value="PROSES" ${report.status === 'PROSES' ? 'selected' : ''}>Dalam Penanganan (In Progress)</option>
                      <option value="SELESAI" ${report.status === 'SELESAI' ? 'selected' : ''}>Lokasi Pulih (Resolved)</option>
                      <option value="CLOSED" ${report.status === 'CLOSED' ? 'selected' : ''}>Arsip Kasus Ditutup (Closed)</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label" style="font-size:0.75rem;" for="verify-notes-input">Update Catatan Operasional</label>
                    <textarea class="form-control textarea-rounded" id="verify-notes-input" style="font-size:0.8rem; background:#ffffff; padding: 10px; margin-top:4px;" placeholder="Update perkembangan penanganan lokasi..." rows="2">${report.adminNotes || ''}</textarea>
                  </div>

                  <button type="submit" class="btn btn-primary btn-rounded" style="width: 100%; font-weight: 700; height: 38px; font-size: 0.8rem;">
                    <i data-lucide="save" style="width:14px; height:14px; margin-right:4px;"></i> Simpan Progress Operasional
                  </button>
                </form>
              ` : `
                <!-- STATE 3: TIDAK VALID / INVALID (LOCKED DECISION) -->
                <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px 16px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem; font-weight:800; color: var(--danger); display:flex; align-items:center; gap:6px;">
                      <i data-lucide="x-circle" style="width:16px; height:16px;"></i> Laporan Tidak Valid
                    </span>
                    <span style="font-size:0.7rem; color: var(--text-muted);">${report.verifiedAt ? new Date(report.verifiedAt).toLocaleDateString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''}</span>
                  </div>
                  ${report.adminNotes ? `<p style="font-size:0.78rem; color: var(--text-secondary); margin:6px 0 0 0;">Alasan: ${report.adminNotes}</p>` : ''}
                </div>
              `)}

              <!-- Ground Truth AI Feedback Modal Button -->
              <button class="btn btn-glass btn-rounded" id="btn-ai-feedback-modal" style="width: 100%; color: var(--success); border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.04); font-size: 0.8rem; font-weight: 700; height: 38px; display:flex; align-items:center; justify-content:center; gap:6px; margin-top:4px;">
                <i data-lucide="brain-circuit" style="width:14px; height:14px; color: var(--success);"></i> Catat Umpan Balik AI (Ground Truth)
              </button>
            </div>
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
            ? `<i data-lucide="zoom-out" style="width:14px; height:14px;"></i> Perkecil` 
            : `<i data-lucide="zoom-in" style="width:14px; height:14px;"></i> Perbesar`;
          if (window.lucide) window.lucide.createIcons();
        };
      }

      // Calibrate bounding boxes for exact pixel alignment on image or video
      const calibrateBoxes = () => {
        const mediaEl = document.getElementById('detail-evidence-image') || document.getElementById('detail-evidence-video');
        const overlayEl = document.getElementById('yolo-boxes-overlay');
        if (!mediaEl || !overlayEl) return;

        const isVideoEl = mediaEl.tagName === 'VIDEO';
        const nw = isVideoEl ? mediaEl.videoWidth : mediaEl.naturalWidth;
        const nh = isVideoEl ? mediaEl.videoHeight : mediaEl.naturalHeight;
        const cw = mediaEl.clientWidth;
        const ch = mediaEl.clientHeight;
        if (!nw || !nh || !cw || !ch) return;

        const scale = Math.min(cw / nw, ch / nh);
        const rw = nw * scale;
        const rh = nh * scale;
        const offsetX = (cw - rw) / 2;
        const offsetY = (ch - rh) / 2;

        let calibratedHtml = '';
        const labelMap = {
          'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang', 'cctv persons': 'Orang',
          'bicycle': 'Sepeda', 'car': 'Mobil', 'motorcycle': 'Sepeda Motor', 'airplane': 'Pesawat', 'bus': 'Bus', 'train': 'Kereta',
          'truck': 'Truk', 'boat': 'Perahu', 'perahu': 'Perahu', 'traffic light': 'Lampu Lalu Lintas', 'fire hydrant': 'Hidran Pemadam',
          'stop sign': 'Rambu Stop', 'parking meter': 'Meteran Parkir', 'bench': 'Bangku', 'bird': 'Burung', 'cat': 'Kucing',
          'dog': 'Anjing', 'horse': 'Kuda', 'sheep': 'Domba', 'cow': 'Sapi', 'elephant': 'Gajah', 'bear': 'Beruang',
          'zebra': 'Zebra', 'giraffe': 'Jerapah', 'backpack': 'Ransel', 'umbrella': 'Payung', 'handbag': 'Tas Tangan',
          'tie': 'Dasi', 'suitcase': 'Koper', 'frisbee': 'Frisbee', 'skis': 'Ski', 'snowboard': 'Papan Seluncur Salju',
          'sports ball': 'Bola Olahraga', 'kite': 'Layang-layang', 'baseball bat': 'Pemukul Bisbol', 'baseball glove': 'Sarung Tangan Bisbol',
          'skateboard': 'Papan Seluncur', 'surfboard': 'Papan Selancar', 'tennis racket': 'Raket Tenis', 'bottle': 'Botol',
          'plastic': 'Plastik', 'wine glass': 'Gelas Anggur', 'cup': 'Cangkir', 'fork': 'Garpu', 'knife': 'Pisau',
          'spoon': 'Sendok', 'bowl': 'Mangkuk', 'banana': 'Pisang', 'apple': 'Apel', 'sandwich': 'Roti Lapis',
          'orange': 'Jeruk', 'broccoli': 'Brokoli', 'carrot': 'Wortel', 'hot dog': 'Hot Dog', 'pizza': 'Pizza',
          'donut': 'Donat', 'cake': 'Kue', 'chair': 'Kursi', 'couch': 'Sofa', 'potted plant': 'Tanaman Pot',
          'bed': 'Tempat Tidur', 'dining table': 'Meja Makan', 'toilet': 'Toilet', 'tv': 'TV', 'laptop': 'Laptop',
          'mouse': 'Mouse', 'remote': 'Remote', 'keyboard': 'Keyboard', 'cell phone': 'Ponsel', 'microwave': 'Microwave',
          'oven': 'Oven', 'toaster': 'Pemanggang Roti', 'sink': 'Wastafel', 'refrigerator': 'Kulkas', 'book': 'Buku',
          'clock': 'Jam', 'jam': 'Jam', 'vase': 'Vas', 'scissors': 'Gunting', 'teddy bear': 'Boneka Beruang',
          'hair drier': 'Pengering Rambut', 'toothbrush': 'Sikat Gigi', 'trash': 'Sampah', 'sampah': 'Sampah',
          'waste': 'Sampah', 'bag': 'Kantong', 'cardboard': 'Kardus', 'object': 'Objek'
        };
        boxes.forEach(box => {
          let boxColorClass = 'yolo-trash';
          const lbl = (box.label || '').toLowerCase();
          if (lbl.includes('person') || lbl.includes('orang')) boxColorClass = 'yolo-person';
          if (lbl.includes('trash') || lbl.includes('sampah')) boxColorClass = 'yolo-trash';
          if (lbl.includes('boat') || lbl.includes('perahu')) boxColorClass = 'yolo-boat';

          // Normalisasi koordinat ke persen (0-100) — YOLO asli kadang 0-1
          let bx = box.x, by = box.y, bw = box.w, bh = box.h;
          if (bw <= 1 && bh <= 1) { bx *= 100; by *= 100; bw *= 100; bh *= 100; }

          const confVal = typeof box.confidence === 'number' ? (box.confidence > 1 ? (box.confidence / 100).toFixed(2) : box.confidence.toFixed(2)) : '0.92';

          const leftPx = offsetX + (bx / 100) * rw;
          const topPx = offsetY + (by / 100) * rh;
          const widthPx = (bw / 100) * rw;
          const heightPx = (bh / 100) * rh;

          const indonesianLabel = labelMap[lbl] || box.label;

          calibratedHtml += `
            <div class="yolo-preview-box ${boxColorClass}" style="position: absolute; top: ${topPx}px; left: ${leftPx}px; width: ${widthPx}px; height: ${heightPx}px;">
              <span class="yolo-preview-label">${indonesianLabel.toUpperCase()} ${confVal}</span>
            </div>
          `;
        });

        overlayEl.innerHTML = calibratedHtml;
      };

      const media = document.getElementById('detail-evidence-image') || document.getElementById('detail-evidence-video');
      if (media) {
        if (media.tagName === 'VIDEO') {
          const video = media;
          if (video.readyState >= 1) calibrateBoxes();
          else video.addEventListener('loadedmetadata', calibrateBoxes);
        } else {
          const img = media;
          if (img.complete) calibrateBoxes();
          else img.addEventListener('load', calibrateBoxes);
        }
        window.addEventListener('resize', calibrateBoxes);
      }

      const exportPdfBtn = document.getElementById('btn-detail-export-pdf');
      if (exportPdfBtn) {
        exportPdfBtn.onclick = () => {
          window.open(`/api/detections/${this.reportId}/pdf`, '_blank');
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
      console.error('[DETAIL_FRONTEND] loadData() ERROR:', err.message || err);
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

    let statusText = 'MENUNGGU TINJAUAN';
    let badgeClass = 'bg-warning text-white';

    if (this.report.adminStatus === 'MENUNGGU') {
      statusText = 'SEDANG DITINJAU';
      badgeClass = 'bg-warning text-white';
    } else if (this.report.adminStatus === 'VALID') {
      statusText = 'TERVALIDASI';
      badgeClass = 'bg-success text-white';
      
      if (this.report.assignedOfficer) {
        statusText = 'DITUGASKAN';
        badgeClass = 'bg-info text-white';
      }
      if (this.report.status === 'PROSES') {
        statusText = 'SEDANG DIPROSES';
        badgeClass = 'bg-info text-white';
      }
      if (this.report.status === 'SELESAI') {
        statusText = 'SELESAI';
        badgeClass = 'bg-success text-white';
      }
      if (this.report.status === 'CLOSED') {
        statusText = 'DITUTUP';
        badgeClass = 'bg-secondary text-white';
      }
    } else if (this.report.adminStatus === 'TIDAK_VALID') {
      statusText = 'TIDAK VALID';
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
      timerEl.innerText = '0j 0m 0d';
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
      
      timerEl.innerText = `${reviewHours}j ${reviewMinutes}m ${reviewSeconds}dtk`;
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
      statusPill.innerText = 'Menunggu Tinjauan';
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
        timerEl.innerText = '0j 0m 0dtk';
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      timerEl.innerText = `${hours}j ${minutes}m ${seconds}dtk`;
    }, 1000);
  }

  renderCommentsShell() {
    const commentsSec = document.getElementById('comments-section');
    if (!commentsSec) return;

    commentsSec.innerHTML = `
      <div class="comments-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 10px;">
        <h4 class="section-title-sm" style="font-size:0.95rem; font-weight:800; display:flex; align-items:center; gap:8px; margin: 0;">
          <i data-lucide="message-square" style="width:16px; height:16px; color:var(--primary);"></i> Diskusi Komunitas (<span id="comments-total-count">0</span>)
        </h4>
        <select class="filter-control select-rounded" id="comments-sort-select" style="font-size:0.75rem; padding: 2px 8px; height: 26px; width:auto; background:var(--surface); margin:0;">
          <option value="newest">Terbaru</option>
          <option value="oldest">Terlama</option>
        </select>
      </div>

      <div class="comments-list" id="comments-list" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; padding-right: 4px;">
        <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">
          Memuat diskusi...
        </div>
      </div>

      <!-- Input Form -->
      <form id="comment-post-form" style="display:flex; flex-direction:column; gap:8px; margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 12px;">
        <div style="display: flex; gap: 8px; align-items:center; justify-content:space-between;">
          <select class="filter-control select-rounded" id="comment-input-category" style="font-size:0.72rem; padding: 2px 6px; height: 28px; width:auto; background:var(--surface);" required>
            <option value="Umum" selected>Kategori: Umum</option>
            <option value="Informasi Tambahan">Kategori: Info Tambahan</option>
            <option value="Koreksi">Kategori: Koreksi</option>
            <option value="Kondisi Terbaru">Kategori: Kondisi Terbaru</option>
            <option value="Saksi">Kategori: Saksi Mata</option>
          </select>
        </div>

        <!-- Image preview container -->
        <div id="comment-image-preview-container" style="display:none; position:relative; width:fit-content; margin-top:2px; margin-bottom:2px;">
          <img id="comment-image-preview-img" src="" alt="Preview Foto" style="max-height:100px; border-radius:10px; border:1px solid var(--border); object-fit:cover; display:block;">
          <button type="button" id="btn-remove-comment-image" title="Hapus foto" style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:#fff; border:none; border-radius:50%; width:20px; height:20px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:bold; line-height:1;">×</button>
        </div>

        <div style="position:relative; display:flex; gap:8px; align-items:flex-end;">
          <div style="position:relative; flex-grow:1;">
            <textarea class="form-control textarea-rounded" id="comment-input-text" placeholder="Berikan info atau kirim foto kondisi terbaru..." style="height:56px; font-size:0.8rem; padding: 8px 12px; padding-bottom: 20px; resize:none; background:var(--surface);"></textarea>
            <span id="comment-char-counter" style="position:absolute; right:12px; bottom:4px; font-size:0.65rem; color:var(--text-muted); pointer-events:none;">0/500</span>
          </div>

          <input type="file" id="comment-input-file" accept="image/*" style="display:none;">

          <button type="button" class="btn btn-glass btn-rounded" id="btn-attach-comment-photo" title="Lampirkan Foto" style="height:36px; width:36px; min-width:36px; padding:0; display:flex; align-items:center; justify-content:center; border-color:rgba(47,107,255,0.3); color:var(--primary);">
            <i data-lucide="image" style="width:18px; height:18px;"></i>
          </button>

          <button type="submit" class="btn btn-primary btn-rounded btn-sm" id="btn-submit-comment" style="height:36px; font-size:0.75rem; padding: 0 16px; font-weight:700; white-space:nowrap;">
            Kirim
          </button>
        </div>
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
              ${cleanText ? `<div>${cleanText}</div>` : ''}
              ${comment.image ? `
                <div style="margin-top:6px; border-radius:10px; overflow:hidden; max-width:240px; border:1px solid var(--border);" class="comment-image-wrapper">
                  <img src="${comment.image}" alt="Foto Bukti Komentar" style="width:100%; max-height:200px; object-fit:cover; display:block; cursor:pointer;" loading="lazy" onclick="window.open('${comment.image}', '_blank')">
                </div>
              ` : ''}
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

        const telegramUrl = `/api/detections/${this.reportId}/telegram`;
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
            EventBus.emit('toast:show', { message: 'Retry penyiaran Telegram berhasil diantrekan!', type: 'success' });
            await this.loadData();
          } else {
            let msg = data.message || data.error || 'Gagal mengirim Telegram';
            if (data.error === 'RETRY_NOT_ALLOWED') {
              msg = 'Telegram sudah berada dalam antrean atau telah berhasil disiarkan.';
            }
            throw new Error(msg);
          }
        } catch (err) {
          EventBus.emit('toast:show', { message: err.message || 'Gagal mengirim Telegram.', type: 'danger' });
          await this.loadData();
        } finally {
          telegramBtn.disabled = false;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    // Operator AI Feedback Modal Trigger Button
    const aiFeedbackModalBtn = document.getElementById('btn-ai-feedback-modal');
    if (aiFeedbackModalBtn) {
      aiFeedbackModalBtn.addEventListener('click', () => {
        this.openAiFeedbackModal();
      });
    }

    // Comment photo attachment handlers
    const attachPhotoBtn = document.getElementById('btn-attach-comment-photo');
    const commentFileInput = document.getElementById('comment-input-file');
    const previewContainer = document.getElementById('comment-image-preview-container');
    const previewImg = document.getElementById('comment-image-preview-img');
    const removePhotoBtn = document.getElementById('btn-remove-comment-image');

    if (attachPhotoBtn && commentFileInput) {
      attachPhotoBtn.addEventListener('click', () => commentFileInput.click());
    }

    if (commentFileInput && previewContainer && previewImg) {
      commentFileInput.addEventListener('change', () => {
        const file = commentFileInput.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewContainer.style.display = 'block';
          };
          reader.readAsDataURL(file);
        } else {
          previewContainer.style.display = 'none';
          previewImg.src = '';
        }
      });
    }

    if (removePhotoBtn && commentFileInput && previewContainer) {
      removePhotoBtn.addEventListener('click', () => {
        commentFileInput.value = '';
        previewContainer.style.display = 'none';
        previewImg.src = '';
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

    // Submit new comment with custom tags & optional photo attachment
    if (commentForm) {
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = (commentInput ? commentInput.value : '').trim();
        const categoryEl = document.getElementById('comment-input-category');
        const category = categoryEl ? categoryEl.value : 'Umum';
        const file = commentFileInput ? commentFileInput.files[0] : null;

        if (!text && !file) {
          EventBus.emit('toast:show', { message: 'Tulis komentar atau pilih foto terlebih dahulu.', type: 'danger' });
          return;
        }

        const formData = new FormData();
        const formattedText = text ? `[${category}] ${text}` : `[${category}]`;
        formData.append('text', formattedText);
        if (file) {
          formData.append('file', file);
        }

        try {
          await API.post(`/api/detections/${this.reportId}/comments`, formData);
          if (commentInput) commentInput.value = '';
          if (commentFileInput) commentFileInput.value = '';
          if (previewContainer) previewContainer.style.display = 'none';
          if (previewImg) previewImg.src = '';
          if (charCounter) charCounter.innerText = '0/500';

          EventBus.emit('toast:show', { message: 'Komentar diskusi terkirim!', type: 'success' });
          await this.loadComments(true);
        } catch (err) {
          EventBus.emit('toast:show', { message: err.message || 'Gagal mengirim komentar.', type: 'danger' });
        }
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
          const formData = new FormData();
          formData.append('file', file);
          
          await API.post(`/api/detections/${this.reportId}/upload-update`, formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          });

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

  openAiFeedbackModal() {
    const existingModal = document.getElementById('modal-ai-feedback');
    if (existingModal) existingModal.remove();

    const snapshotId = this.currentReport && (this.currentReport.activeSnapshotId || (this.currentReport.aiProjection && this.currentReport.aiProjection.activeSnapshotId)) ? (this.currentReport.activeSnapshotId || this.currentReport.aiProjection.activeSnapshotId) : '';
    if (!snapshotId) {
      EventBus.emit('toast:show', { message: 'Snapshot AI belum tersedia untuk laporan ini.', type: 'warning' });
      return;
    }

    const modalHtml = `
      <div id="modal-ai-feedback" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:9999;">
        <div style="background:#ffffff; width:90%; max-width:520px; border-radius:16px; padding:24px; box-shadow:0 20px 40px rgba(0,0,0,0.2); display:flex; flex-direction:column; gap:16px; max-height:90vh; overflow-y:auto;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:12px;">
            <h3 style="font-family:'Outfit',sans-serif; font-size:1.1rem; font-weight:800; color:#1E293B; margin:0; display:flex; align-items:center; gap:8px;">
              <i data-lucide="brain-circuit" style="color:var(--primary); width:20px; height:20px;"></i> Catat Umpan Balik AI (Ground Truth)
            </h3>
            <button id="btn-close-ai-feedback" style="background:none; border:none; cursor:pointer; font-size:1.2rem; color:#64748B;">✕</button>
          </div>

          <form id="form-ai-feedback-submit" style="display:flex; flex-direction:column; gap:14px;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:0.78rem; font-weight:700; color:#334155;">Label Keputusan Operator (Ground Truth):</label>
              <select id="feedback-label-select" class="form-control select-rounded" style="font-size:0.82rem; height:38px; background:#F8FAFC;" required>
                <option value="CONFIRMED_LITTERING">✓ Konfirmasi Membuang Sampah Sembarangan</option>
                <option value="DISPOSING_IN_BIN">✓ Objek Dibuang ke Tempat Sampah Resmi</option>
                <option value="FALSE_OBJECT_DETECTION">✗ Deteksi Objek Salah (Bukan Sampah)</option>
                <option value="IMAGE_QUALITY_TOO_LOW">⚠ Kualitas Gambar Terlalu Buruk</option>
                <option value="UNCERTAIN">❓ Ragu-ragu / Tidak Yakin</option>
                <option value="NEEDS_REVIEW">🔍 Memerlukan Peninjauan Ulang</option>
              </select>
            </div>

            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:0.78rem; font-weight:700; color:#334155;">Koreksi Tingkat Prioritas (Opsional):</label>
              <select id="feedback-priority-select" class="form-control select-rounded" style="font-size:0.82rem; height:38px; background:#F8FAFC;">
                <option value="NONE">Tidak Ada (Default)</option>
                <option value="LOW">Rendah (LOW)</option>
                <option value="MEDIUM">Sedang (MEDIUM)</option>
                <option value="HIGH">Tinggi (HIGH)</option>
                <option value="CRITICAL">Kritis (CRITICAL)</option>
              </select>
            </div>

            <div style="display:flex; flex-direction:column; gap:4px;">
              <label style="font-size:0.78rem; font-weight:700; color:#334155;">Catatan Verifikator Operator:</label>
              <textarea id="feedback-notes-input" class="form-control textarea-rounded" rows="3" style="font-size:0.82rem; padding:10px; background:#F8FAFC;" placeholder="Jelaskan alasan koreksi atau observasi detail lapangan..."></textarea>
            </div>

            <div style="display:flex; gap:10px; margin-top:8px;">
              <button type="button" id="btn-cancel-ai-feedback" class="btn btn-glass btn-rounded" style="flex:1; font-weight:700; height:40px; font-size:0.8rem;">Batal</button>
              <button type="submit" id="btn-submit-ai-feedback" class="btn btn-primary btn-rounded" style="flex:1; font-weight:700; height:40px; font-size:0.8rem;">Simpan Ground Truth</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (window.lucide) window.lucide.createIcons();

    const closeModal = () => {
      const modal = document.getElementById('modal-ai-feedback');
      if (modal) modal.remove();
    };

    document.getElementById('btn-close-ai-feedback')?.addEventListener('click', closeModal);
    document.getElementById('btn-cancel-ai-feedback')?.addEventListener('click', closeModal);

    document.getElementById('form-ai-feedback-submit')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-ai-feedback');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Menyimpan...';
      }

      const groundTruthLabel = document.getElementById('feedback-label-select').value;
      const correctedPriority = document.getElementById('feedback-priority-select').value;
      const notes = document.getElementById('feedback-notes-input').value.trim();
      const currentUser = AppState.get('user') || {};

      const idempotencyKey = `feedback-${snapshotId}-${currentUser._id || currentUser.id || 'op'}-${Date.now()}`;

      try {
        const res = await API.post(`/api/reports/${this.reportId}/ai-feedback`, {
          snapshotId,
          groundTruthLabel,
          correctedPriority,
          notes,
          idempotencyKey
        });

        EventBus.emit('toast:show', { message: 'Ground truth umpan balik AI berhasil dicatat!', type: 'success' });
        closeModal();
        await this.loadData();
      } catch (err) {
        EventBus.emit('toast:show', { message: err.message || 'Gagal menyimpan umpan balik AI', type: 'danger' });
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = 'Simpan Ground Truth';
        }
      }
    });
  }

  destroy() {
    if (this.slaTimerInterval) {
      clearInterval(this.slaTimerInterval);
      this.slaTimerInterval = null;
    }
  }
}

export const Detail = new DetailPage();
