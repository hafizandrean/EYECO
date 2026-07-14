// home.js - Citizen Workspace Beranda Page (Masyarakat)
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { ReportService } from '../services/reportService.js';
import { Formatter } from '../utils/formatter.js';

export class HomePage {
  constructor() {
    this.latestReports = [];
  }

  async render(container) {
    const user = AppState.get('user');
    const username = user ? user.username : 'Masyarakat';

    container.innerHTML = `
      <div class="citizen-home-container" style="animation: pageFadeIn var(--motion-open); max-width: 900px; margin: 0 auto; padding: var(--space-24) 0; display: flex; flex-direction: column; gap: var(--space-28);">
        
        <!-- Welcome Hero Card -->
        <section class="glass-card citizen-hero-card" style="padding: var(--space-32); text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-8); background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(235, 241, 252, 0.9) 100%); border: 1px solid var(--border); box-shadow: var(--glass-shadow); position: relative; overflow: hidden; border-radius: var(--radius-card);">
          <div class="hero-decorative-water" style="position: absolute; top: 0; left: 0; width: 100%; height: 6px; background: var(--primary);"></div>
          
          <h1 style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: var(--text-primary); margin-top: 4px; margin-bottom: 0; display:flex; align-items:center; gap:8px; justify-content:center;">Selamat Datang <i data-lucide="hand" style="width:28px;height:28px;color:var(--warning);"></i></h1>
          <p style="font-size: 0.95rem; color: var(--text-secondary); max-width: 500px; line-height: 1.5; margin: 0;">Mari bantu menjaga kebersihan sungai bersama dengan memantau & melaporkan pencemaran.</p>
          
          <!-- Actions Grid -->
          <div style="display: flex; gap: 12px; margin-top: 12px; width: 100%; max-width: 480px;">
            <button class="btn btn-primary btn-rounded" id="citizen-btn-upload" style="flex:1; padding: 12px 0; justify-content: center; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;">
              <i data-lucide="upload-cloud" style="width: 18px; height: 18px;"></i> Upload Bukti
            </button>
            <button class="btn btn-glass btn-rounded" id="citizen-btn-reports" style="flex:1; padding: 12px 0; justify-content: center; border-color: rgba(47,107,255,0.25); color: var(--primary); font-weight: 700; display: inline-flex; align-items: center; gap: 8px;">
              <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Lihat Laporan
            </button>
          </div>
        </section>

        <!-- Status Sungai Hari Ini -->
        <section class="glass-card" style="padding: var(--space-20); border-radius: var(--radius-card); border: 1px solid rgba(34, 197, 94, 0.2); background: rgba(34, 197, 94, 0.02); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 0.68rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Status Sungai Hari Ini</span>
            <strong style="font-size: 1.2rem; color: var(--success); display: flex; align-items: center; gap: 6px;">
              <span class="status-pulse-dot green" style="width: 8px; height: 8px; background: var(--success); border-radius: 50%; display: inline-block;"></span>
              NORMAL
            </strong>
          </div>
          <span style="font-size: 0.82rem; color: var(--text-secondary); font-weight: 600;">Tidak ada kejadian darurat hari ini.</span>
        </section>

        <!-- Laporan Terbaru -->
        <section style="display: flex; flex-direction: column; gap: var(--space-12);">
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.2rem; font-weight: 800; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="clock" style="color: var(--primary); width:18px; height:18px;"></i> Laporan Terbaru Warga
          </h3>
          <div id="citizen-latest-reports-container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-16);">
            <div style="text-align: center; color: var(--text-secondary); padding: var(--space-24); grid-column: 1 / -1;">
              Memuat laporan terbaru...
            </div>
          </div>
        </section>

        <!-- Cara Melapor (Edukasi) -->
        <section class="glass-card" style="padding: var(--space-24); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: var(--space-16);">
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="help-circle" style="color: var(--primary); width: 18px; height: 18px;"></i> Petunjuk Melapor
          </h3>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-20);">
            <div style="display:flex; gap:12px; align-items: flex-start;">
              <span style="width: 24px; height: 24px; border-radius: 50%; background: rgba(47,107,255,0.1); color: var(--primary); display:flex; align-items:center; justify-content:center; font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">1</span>
              <div>
                <strong style="font-size:0.85rem; color:var(--text-primary); display:block; margin-bottom: 2px;">Ambil Foto Sampah</strong>
                <span style="font-size:0.75rem; color:var(--text-secondary); line-height: 1.4; display:block;">Foto kondisi sampah sungai atau pelaku yang membuang sampah secara jelas.</span>
              </div>
            </div>
            <div style="display:flex; gap:12px; align-items: flex-start;">
              <span style="width: 24px; height: 24px; border-radius: 50%; background: rgba(47,107,255,0.1); color: var(--primary); display:flex; align-items:center; justify-content:center; font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">2</span>
              <div>
                <strong style="font-size:0.85rem; color:var(--text-primary); display:block; margin-bottom: 2px;">Tunggu Pemindaian AI</strong>
                <span style="font-size:0.75rem; color:var(--text-secondary); line-height: 1.4; display:block;">Unggah foto Anda. Model AI YOLOv8 kami akan mendeteksi objek sampah otomatis.</span>
              </div>
            </div>
            <div style="display:flex; gap:12px; align-items: flex-start;">
              <span style="width: 24px; height: 24px; border-radius: 50%; background: rgba(47,107,255,0.1); color: var(--primary); display:flex; align-items:center; justify-content:center; font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">3</span>
              <div>
                <strong style="font-size:0.85rem; color:var(--text-primary); display:block; margin-bottom: 2px;">Kirim & Pantau Progres</strong>
                <span style="font-size:0.75rem; color:var(--text-secondary); line-height: 1.4; display:block;">Lengkapi lokasi laporan, kirim, dan pantau status pembersihan dinas terkait.</span>
              </div>
            </div>
          </div>
        </section>

      </div>
    `;

    this.bindEvents();
    if (window.lucide) window.lucide.createIcons();

    // Load latest 3 reports
    await this.loadLatestReports();
  }

  bindEvents() {
    const btnUpload = document.getElementById('citizen-btn-upload');
    const btnReports = document.getElementById('citizen-btn-reports');

    if (btnUpload) {
      btnUpload.onclick = () => Router.navigate('/dashboard/upload');
    }
    if (btnReports) {
      btnReports.onclick = () => Router.navigate('/dashboard/laporan');
    }
  }

  async loadLatestReports() {
    const container = document.getElementById('citizen-latest-reports-container');
    if (!container) return;

    try {
      const response = await ReportService.getFilteredReports({ limit: 3 });
      this.latestReports = response.reports || [];

      container.innerHTML = '';

      if (this.latestReports.length === 0) {
        container.innerHTML = `
          <div class="glass-card" style="padding: var(--space-24); text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">
            Tidak ada laporan warga saat ini.
          </div>
        `;
        return;
      }

      this.latestReports.forEach(report => {
        const card = document.createElement('div');
        card.className = 'glass-card hover-lift';
        card.style.cssText = 'padding: 12px; display: flex; flex-direction: column; gap: var(--space-12); cursor: pointer; border: 1px solid var(--border); background: #ffffff;';
        
        card.innerHTML = `
          <div style="width: 100%; aspect-ratio: 16/10; border-radius: 8px; overflow: hidden; background: #000; position: relative;">
            <img src="${report.image}" alt="Bukti" style="width: 100%; height: 100%; object-fit: cover;">
            <span class="badge ${report.adminStatus === 'VALID' ? 'bg-success text-white' : 'bg-warning text-white'}" style="position: absolute; bottom: 8px; right: 8px; font-size: 0.65rem;">
              ${report.adminStatus === 'VALID' ? 'Diverifikasi' : 'Ditinjau'}
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; padding: 0 4px;">
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.9rem; font-weight: 700; color: var(--text-primary); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${report.location}
            </h4>
            <div style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600;">
              ${Formatter.formatDate(report.timestamp)}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span style="font-size:0.68rem; font-weight: 800; color: var(--text-secondary);">AI Confidence</span>
              <strong style="font-size: 0.78rem; color: var(--primary);">${report.aiConfidence}%</strong>
            </div>
          </div>
        `;

        card.addEventListener('click', () => {
          Router.navigate(`/dashboard/detections/${report.id}`);
        });

        container.appendChild(card);
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      container.innerHTML = `<div style="text-align: center; color: var(--danger); padding: var(--space-24); grid-column: 1 / -1;">Gagal memuat laporan terbaru.</div>`;
    }
  }

  destroy() {
    // Clean state
  }
}

export const Home = new HomePage();
