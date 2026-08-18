// home.js — Citizen Landing Page (Masyarakat)
// Premium, whitespace-rich, mobile-first landing page
import { AppState } from '../core/state.js';
import { Router, ScrollMemory } from '../core/router.js';
import { ReportService } from '../services/reportService.js';
import { Formatter } from '../utils/formatter.js';
import { animateCounter, createScrollObserver } from '../utils/animations.js';

class HomePage {
  constructor() {
    this.latestReports = [];
    this.newsItems = [];
  }

  async render(container) {
    const user = AppState.get('user');
    const username = user?.username || 'Masyarakat';

    container.innerHTML = `
          <div class="landing-wrapper">

            <!-- ═══ HERO SECTION (LAYER 1: THIN) ═══ -->
            <section class="landing-hero landing-layer-thin" aria-labelledby="hero-title">
              <div class="hero-inner">
                <div class="hero-grid">
                <div class="hero-main">
                  <span class="hero-badge">
                    <img src="/uploads/logo-eyeco.png" alt="" style="height:20px;width:auto;vertical-align:middle;margin-right:6px;">
                    EYECO · Pantau Lingkunganmu
                  </span>
                  <h1 id="hero-title" class="hero-title">
                    Bersama Menjaga<br>Kebersihan Lingkungan
                  </h1>
                  <p class="hero-subtitle">
                    Laporkan pencemaran sampah dengan satu klik.
                    AI mendeteksi, memverifikasi, dan meneruskan ke dinas terkait.
                  </p>
                  <div class="hero-actions">
                    <a class="hero-btn-primary" id="hero-btn-upload" href="#upload">
                      <i data-lucide="upload-cloud"></i> Laporkan Sekarang
                    </a>
                    <a class="hero-btn-secondary" id="hero-btn-reports" href="#latest-reports">
                      <i data-lucide="file-text"></i> Lihat Laporan
                    </a>
                  </div>
                </div>
                <div class="hero-visual" aria-hidden="true">
                  <div class="hero-illustration">
                    <div class="illustration-bg"></div>
                    <div class="illustration-device">
                      <div class="device-frame">
                        <div class="device-camera"></div>
                        <div class="device-screen">
                          <div class="screen-content">
                            <div class="detect-box box-1" aria-hidden="true"><span>Sampah</span></div>
                            <div class="detect-box box-2" aria-hidden="true"><span>Plastik</span></div>
                            <div class="detect-box box-3" aria-hidden="true"><span>Kertas</span></div>
                            <div class="scanline" aria-hidden="true"></div>
                          </div>
                        </div>
                        <div class="device-status">
                          <span class="status-dot"></span>
                          <span>AI Aktif</span>
                        </div>
                      </div>
                    </div>
                    <div class="illustration-accent accent-1" aria-hidden="true"></div>
                    <div class="illustration-accent accent-2" aria-hidden="true"></div>
                    <div class="illustration-accent accent-3" aria-hidden="true"></div>
                  </div>
                </div>
              </div>
              </div>
            </section>

            <!-- ═══ FEATURE MARQUEE (LAYER 2: GLASS) — moving strip ═══ -->
            <section class="landing-section landing-marquee-section landing-layer-glass" aria-label="Fitur Unggulan">
              <div class="landing-wrapper">
              <div class="marquee-track" id="feature-marquee-track">
                <span class="marquee-item">AI Detection</span>
                <span class="marquee-item">Report Transparency</span>
                <span class="marquee-item">Realtime CCTV</span>
                <span class="marquee-item">Fast Verification</span>
                <span class="marquee-item">Open Report</span>
                <span class="marquee-item">24/7 Monitoring</span>
                <span class="marquee-item">Machine Learning</span>
                <span class="marquee-item">Computer Vision</span>
              </div>
              </div>
            </section>

                        <!-- ═══ CHART STATISTICS (LAYER 3: THIN) ═══ -->
            <section class="landing-section landing-layer-thin" id="chart-section" aria-labelledby="chart-title">
              <div class="section-header">
                <span class="section-label">Statistik</span>
                <h2 id="chart-title" class="section-title">Gambaran Umum Laporan</h2>
                <p class="section-desc">Data laporan masyarakat dan status verifikasi secara real-time.</p>
              </div>
              <div class="chart-grid" id="chart-grid">
                <div class="chart-card glass-card">
                  <div class="chart-card-header">
                    <h3>Status Laporan</h3>
                    <span class="chart-period">Bulan Ini</span>
                  </div>
                  <div class="chart-bars" id="chart-bars">
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Terverifikasi</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-valid" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-valid">0</span>
                    </div>
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Menunggu</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-pending" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-pending">0</span>
                    </div>
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Tidak Valid</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-ignored" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-ignored">0</span>
                    </div>
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Total</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-total" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-total">0</span>
                    </div>
                  </div>
                </div>
                <div class="chart-card glass-card">
                  <div class="chart-card-header">
                    <h3>Deteksi AI</h3>
                    <span class="chart-period">Tingkat Keyakinan</span>
                  </div>
                  <div class="chart-bars" id="chart-bars-ai">
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Tinggi</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-ai-high" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-ai-high">0</span>
                    </div>
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Sedang</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-ai-mid" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-ai-mid">0</span>
                    </div>
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Rendah</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-ai-low" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-ai-low">0</span>
                    </div>
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">Tidak Terindikasi</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" id="chart-bar-ai-none" style="width:0%;"></div>
                      </div>
                      <span class="chart-bar-value" id="chart-val-ai-none">0</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- ═══ AI CONFIDENCE SPLIT (LAYER 4: GLASS) ═══ -->
            <section class="landing-section landing-layer-glass" id="ai-confidence" aria-labelledby="ai-confidence-title">
              <div class="section-header is-centered">
                <span class="section-label">Distribusi Status Indikasi AI</span>
                <h2 id="ai-confidence-title" class="section-title">Seberapa Yakin AI Kami?</h2>
                <p class="section-desc">AI menganalisis bukti dan memberikan indikasi awal. Laporan ditinjau dan divalidasi oleh operator sebelum ditindaklanjuti.</p>
              </div>
              <div class="confidence-split" id="confidence-split"></div>
            </section>

            <!-- ═══ ABOUT / TECH (LAYER 5: THIN) ═══ -->
            <section class="landing-section landing-layer-thin" id="about" aria-labelledby="about-title">
              <div class="section-header is-centered">
                <span class="section-label">Tentang EYECO</span>
                <h2 id="about-title" class="section-title">Platform Pemantauan Lingkungan Berbasis AI</h2>
                <p class="section-desc">EYECO adalah platform pemantauan lingkungan berbasis AI. Sistem ini mendeteksi pencemaran sampah secara otomatis, memverifikasi laporan warga, dan meneruskan ke petugas terkait.</p>
              </div>
              <div class="about-grid">
                <article class="about-card">
                  <div class="about-icon" style="background: rgba(37,99,235,0.1); color: #2563EB;">
                    <i data-lucide="brain-circuit"></i>
                  </div>
                  <h3>AI Detection</h3>
                  <p>Model YOLOv8 mendeteksi sampah di lingkungan secara real-time dari kamera CCTV dan foto warga.</p>
                </article>
                <article class="about-card">
                  <div class="about-icon" style="background: rgba(16,185,129,0.1); color: #10B981;">
                    <i data-lucide="globe"></i>
                  </div>
                  <h3>Partisipasi Warga</h3>
                  <p>Masyarakat dapat melaporkan pencemaran langsung dari HP dengan foto dan lokasi.</p>
                </article>
                <article class="about-card">
                  <div class="about-icon" style="background: rgba(139,92,246,0.1); color: #8B5CF6;">
                    <i data-lucide="clipboard-check"></i>
                  </div>
                  <h3>Verifikasi Otomatis</h3>
                  <p>AI memproses dan mengkategorikan laporan, lalu petugas menerima notifikasi instan.</p>
                </article>
              </div>
            </section>

            <!-- ═══ AI WORKFLOW TIMELINE (LAYER 6: GLASS) ═══ -->
            <section class="landing-section landing-layer-glass" id="how-it-works" aria-labelledby="steps-title">
              <div class="section-header is-centered">
                <span class="section-label">Cara Kerja</span>
                <h2 id="steps-title" class="section-title">Alur Laporan Terpadu</h2>
                <p class="section-desc">Dari foto warga hingga tindak lanjut pemerintah, semua terotomatisasi.</p>
              </div>
              <div class="steps-grid" id="workflow-steps">
                <div class="step-card">
                  <div class="step-node"><i data-lucide="camera"></i></div>
                  <span class="step-num">01</span>
                  <h3>Upload</h3>
                  <p>Warga memotret dan mengunggah bukti pencemaran.</p>
                </div>
                <div class="step-card">
                  <div class="step-node"><i data-lucide="brain-circuit"></i></div>
                  <span class="step-num">02</span>
                  <h3>AI Detection</h3>
                  <p>Model computer vision menganalisis gambar secara real-time.</p>
                </div>
                <div class="step-card">
                  <div class="step-node"><i data-lucide="clipboard-check"></i></div>
                  <span class="step-num">03</span>
                  <h3>Verification</h3>
                  <p>Skor keyakinan AI menentukan status awal laporan.</p>
                </div>
                <div class="step-card">
                  <div class="step-node"><i data-lucide="file-check"></i></div>
                  <span class="step-num">04</span>
                  <h3>Report</h3>
                  <p>Laporan tervalidasi masuk ke dashboard dinas terkait.</p>
                </div>
                <div class="step-card">
                  <div class="step-node"><i data-lucide="landmark"></i></div>
                  <span class="step-num">05</span>
                  <h3>Follow-up</h3>
                  <p>Petugas menindaklanjuti dan warga memantau progresnya.</p>
                </div>
              </div>
            </section>

            <!-- ═══ BENEFITS COMPACT (LAYER 7: THIN) ═══ -->
            <section class="landing-section landing-layer-thin" id="benefits" aria-labelledby="benefits-title">
              <div class="section-header is-centered">
                <span class="section-label">Manfaat</span>
                <h2 id="benefits-title" class="section-title">Kenapa Menggunakan EYECO?</h2>
                <p class="section-desc">Kami menggabungkan teknologi AI dengan partisipasi masyarakat untuk hasil maksimal.</p>
              </div>
              <div class="benefits-grid">
                <article class="benefit-card">
                  <h3>Cepat & Efisien</h3>
                  <p>Deteksi AI dalam hitungan detik.</p>
                </article>
                <article class="benefit-card">
                  <h3>Transparan</h3>
                  <p>Status laporan terbuka untuk publik.</p>
                </article>
                <article class="benefit-card">
                  <h3>Berbasis Web</h3>
                  <p>Bisa diakses dari browser, tanpa instalasi.</p>
                </article>
                <article class="benefit-card">
                  <h3>Kolaborasi</h3>
                  <p>Warga, kepala desa, dan akademisi.</p>
                </article>
              </div>
            </section>

            <!-- ═══ IMPACT STRIP (LAYER 8: GLASS) ═══ -->
            <section class="landing-section landing-layer-glass" id="impact" aria-labelledby="impact-title">
              <div class="section-header is-centered">
                <span class="section-label">Dampak</span>
                <h2 id="impact-title" class="section-title">EYECO dalam Angka</h2>
              </div>
              <div class="impact-strip">
                <div class="impact-item"><i data-lucide="zap"></i><strong id="impact-time">800ms</strong><span>Waktu Deteksi AI</span></div>
                <div class="impact-item"><i data-lucide="scan"></i><strong id="impact-accuracy">YOLOv8</strong><span>Model Deteksi Objek</span></div>
                <div class="impact-item"><i data-lucide="cctv"></i><strong>24/7</strong><span>Monitoring CCTV</span></div>
                <div class="impact-item"><i data-lucide="users"></i><strong id="impact-reports">0</strong><span>Laporan Diproses</span></div>
              </div>
            </section>

            <!-- ═══ LATEST REPORTS PREVIEW (LAYER 9: THIN) — compact ═══ -->
            <section class="landing-section landing-layer-thin" id="latest-reports" aria-labelledby="reports-title">
              <div class="section-header section-row-header">
                <div>
                  <span class="section-label">Laporan Terbaru</span>
                  <h2 id="reports-title" class="section-title">Aktivitas Warga</h2>
                </div>
                <a class="section-link" id="hero-btn-all-reports" href="/laporan">
                  Lihat Semua <i data-lucide="arrow-right"></i>
                </a>
              </div>
              <div class="reports-grid" id="landing-reports-grid">
                <div class="reports-skeleton">
                  <div class="skeleton-card"></div>
                  <div class="skeleton-card"></div>
                  <div class="skeleton-card"></div>
                </div>
              </div>
            </section>

            <!-- ═══ NEWS MARQUEE (LAYER 10: GLASS) ═══ -->
            <section class="landing-section landing-layer-glass" id="news" aria-labelledby="news-title">
              <div class="section-header is-centered">
                <span class="section-label">Berita & Informasi</span>
                <h2 id="news-title" class="section-title">Update Lingkungan</h2>
                <p class="section-desc">Kabar terbaru dari lingkungan sekitar.</p>
              </div>
              <div class="news-marquee">
                <div class="news-marquee-row" id="news-marquee-track"></div>
              </div>
            </section>

            <!-- ═══ CTA SECTION (LAYER 11: THIN) ═══ -->
            <section class="landing-cta landing-layer-thin" aria-labelledby="cta-title">
              <div class="cta-content">
                <h2 id="cta-title">Siap Berkontribusi?</h2>
                <p>Mulai laporkan kondisi lingkungan di sekitarmu sekarang juga. Bersama kita jaga lingkungan.</p>
                <a class="hero-btn-primary" id="cta-btn-upload" href="#upload">
                  <i data-lucide="upload-cloud"></i> Laporkan Sekarang
                </a>
              </div>
            </section>

            <!-- ═══ FOOTER (LAYER 12: GLASS) — with partner cloud ═══ -->
            <footer class="landing-footer landing-layer-glass" role="contentinfo">
              <div class="footer-content">
                <div class="footer-brand">
                  <img src="/uploads/logo-eyeco.png" alt="" style="height:24px;width:auto;">
                  <span>EYECO</span>
                </div>
                <p class="footer-desc">Sistem pemantauan kebersihan lingkungan berbasis AI untuk Indonesia yang lebih bersih.</p>

                <div class="footer-partners">
                  <span class="footer-partners-label">Dipercaya oleh</span>
                  <div class="footer-partner-cloud">
                    <span class="footer-partner-chip"><img src="/assets/partner-telkom-ind.png" alt="Telkom Indonesia" loading="lazy"> Telkom Indonesia</span>
                                        <span class="footer-partner-chip"><img src="/assets/partner-sdgs-center.png" alt="SDGs Center Telkom University" loading="lazy"> SDGs Center Telkom University</span>
                                        <span class="footer-partner-chip"><img src="/assets/partner-telkom-univ.png" alt="Telkom University" loading="lazy"> Telkom University</span>
                    
                  </div>
                </div>

                <div class="footer-links">
                  <span>© ${new Date().getFullYear()} EYECO</span>
                  <span class="footer-dot" aria-hidden="true">·</span>
                  <a href="/tentang">Tentang</a>
                  <span class="footer-dot" aria-hidden="true">·</span>
                  <a href="/kebijakan">Kebijakan Privasi</a>
                  <span class="footer-dot" aria-hidden="true">·</span>
                  <a href="/faq">FAQ</a>
                  <span class="footer-dot" aria-hidden="true">·</span>
                  <a href="/kontak">Kontak</a>
                </div>
              </div>
            </footer>

          </div>
        `;

        // Binds
        this.bindEvents();
        if (window.lucide) window.lucide.createIcons();

        // Load dynamic data
        await this.loadStats();
        await this.loadLatestReports();
        await this.loadNews();
        await this.loadChart();

        // Animate on scroll
        this.initScrollAnimation();
        this.initMarquee();

        // Restore scroll position bila kembali dari halaman lain (footer/settings)
        ScrollMemory.restore('/dashboard/beranda');
      }

  bindEvents() {
    // Jika belum login (landing publik / user kosong), CTA → /login (redirect balik setelah login)
    const user = AppState.get('user');
    const requireAuth = (e, path) => {
      e.preventDefault();
      if (!user) {
        sessionStorage.setItem('eyeco_return_to', path);
        window.location.href = '/login';
        return;
      }
      Router.navigate(path);
    };

    document.getElementById('hero-btn-upload')?.addEventListener('click', (e) => requireAuth(e, '/dashboard/upload'));
    document.getElementById('hero-btn-reports')?.addEventListener('click', (e) => requireAuth(e, '/dashboard/laporan'));
    document.getElementById('hero-btn-all-reports')?.addEventListener('click', (e) => requireAuth(e, '/dashboard/laporan'));
    document.getElementById('cta-btn-upload')?.addEventListener('click', (e) => requireAuth(e, '/dashboard/upload'));

    // Footer links (full page loads) — simpan posisi scroll sebelum pindah
    document.querySelectorAll('.footer-links a, .footer-partner-cloud a').forEach((a) => {
      a.addEventListener('click', () => {
        ScrollMemory.save('/dashboard/beranda');
      });
    });
  }

  async loadStats() {
    try {
      const res = await fetch('/api/stats', { credentials: 'include' });
      const data = await res.json();
      if (data) {
        const totalEl = document.getElementById('hero-stat-reports');
        const validEl = document.getElementById('hero-stat-valid');
        const pendingEl = document.getElementById('hero-stat-pending');
        // Laporan Terkini = laporan MENUNGGU ATAU dalam 7 hari terakhir
        if (totalEl) {
          totalEl.textContent = '0';
          animateCounter(totalEl, data.recent ?? data.pending ?? data.total ?? 0, 1400);
        }
        if (validEl) {
          validEl.textContent = '0';
          animateCounter(validEl, data.valid ?? 0, 1400);
        }
        if (pendingEl) {
          pendingEl.textContent = '0';
          animateCounter(pendingEl, data.pending ?? 0, 1400);
        }
        const myReportsEl = document.getElementById('hero-stat-myreports');
        if (myReportsEl) {
          myReportsEl.textContent = '0';
          animateCounter(myReportsEl, data.myReports ?? 0, 1400);
        }
      }
    } catch (_) {}
  }

  async loadLatestReports() {
    const container = document.getElementById('landing-reports-grid');
    if (!container) return;

    const user = AppState.get('user');

    try {
      const response = await ReportService.getFilteredReports({}, 1, 6);
      this.latestReports = response.reports || [];
      container.innerHTML = '';

      if (this.latestReports.length === 0) {
        container.innerHTML = `
          <div class="reports-empty" style="grid-column:1/-1;">
            <i data-lucide="inbox"></i>
            <p>Belum ada laporan warga. Jadilah yang pertama!</p>
          </div>
        `;
        return;
      }

      this.latestReports.forEach((report, i) => {
        const isVideoImage = report.image && report.image.endsWith('.mp4');
        const imgHtml = isVideoImage
          ? `<div style="display:flex; width:100%; height:100%; align-items:center; justify-content:center; background:var(--surface-soft); color:var(--text-muted);"><i data-lucide="video" style="width:28px; height:28px;"></i></div>`
          : `<img src="${report.image}" alt="Bukti" loading="lazy" onerror="this.style.display='none'">`;

        const card = document.createElement('div');
        card.className = 'report-card';
        card.style.animationDelay = `${i * 0.1}s`;
        card.innerHTML = `
          <div class="report-card-img">
            ${imgHtml}
            <span class="report-card-badge ${report.adminStatus === 'VALID' ? 'badge-green' : 'badge-orange'}">
              ${report.adminStatus === 'VALID' ? 'Terverifikasi' : 'Ditinjau'}
            </span>
          </div>
          <div class="report-card-body">
            <div class="report-card-location">
              <i data-lucide="map-pin"></i>
              <span>${report.location || 'Lokasi tidak tersedia'}</span>
            </div>
            <div class="report-card-meta">
              <span>${Formatter.formatDate(report.timestamp)}</span>
              ${report.aiConfidence ? `<span class="report-card-conf">AI ${report.aiConfidence}%</span>` : ''}
            </div>
          </div>
        `;
        card.addEventListener('click', () => {
          if (!user) {
            sessionStorage.setItem('eyeco_return_to', '/dashboard/detections/' + report.id);
            window.location.href = '/login';
            return;
          }
          Router.navigate(`/dashboard/detections/${report.id}`);
        });
        container.appendChild(card);
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (_) {
      container.innerHTML = `
        <div class="reports-empty">
          <i data-lucide="alert-circle"></i>
          <p>Gagal memuat laporan.</p>
        </div>
      `;
    }
  }

  async loadNews() {
    const track = document.getElementById('news-marquee-track');
    if (!track) return;

    try {
      const user = AppState.get('user');
      const wsId = user?.workspaceId || 3;
      const res = await fetch(`/api/news/public/${wsId}`);
      const data = await res.json();
      const news = data.news || [];
      track.innerHTML = '';

      if (news.length === 0) {
        track.innerHTML = `<div class="reports-empty" style="width:100%;">
          <i data-lucide="newspaper"></i>
          <p>Belum ada berita. Admin akan menambahkan informasi terbaru di sini.</p>
        </div>`;
        return;
      }

      const gradients = [
        'linear-gradient(135deg, #2563EB, #4F46E5)',
        'linear-gradient(135deg, #10B981, #059669)',
        'linear-gradient(135deg, #F59E0B, #D97706)',
        'linear-gradient(135deg, #EC4899, #8B5CF6)',
        'linear-gradient(135deg, #06B6D4, #3B82F6)',
      ];

      const icons = ['droplets', 'recycle', 'megaphone', 'leaf', 'globe'];

      const sorted = [...news].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      sorted.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'news-mcard';
        card.dataset.slug = item.slug || '';
        const fallbackIcon = icons[i % icons.length];
        const fallbackBg = gradients[i % gradients.length];
        const thumbHtml = item.thumbnail
          ? `<img src="${item.thumbnail}" alt="${item.title}" loading="lazy" onerror="this.onerror=null;this.parentElement.style.background='${fallbackBg}';this.parentElement.style.display='flex';this.parentElement.style.alignItems='center';this.parentElement.style.justifyContent='center';this.outerHTML='<i data-lucide=\\'${fallbackIcon}\\'></i>';if(window.lucide)window.lucide.createIcons();">`
          : `<i data-lucide="${fallbackIcon}"></i>`;
        const thumbBg = item.thumbnail
          ? 'background:#0F172A;'
          : `background: ${fallbackBg};display:flex;align-items:center;justify-content:center;`;
        card.innerHTML = `
          <div class="news-mcard-img" style="${thumbBg}">
            ${thumbHtml}
          </div>
          <div class="news-mcard-body">
            <span class="news-mcard-tag">${item.category || 'Informasi'}</span>
            <h3>${item.title}</h3>
            <p>${item.summary || ''}</p>
          </div>
        `;
        track.appendChild(card);
      });

      // Delegated click — works on clones too; skip if user was dragging
      track.addEventListener('click', (e) => {
        if (this._marqueeDragDistance && this._marqueeDragDistance > 5) return;
        const card = e.target.closest('.news-mcard');
        if (card && card.dataset.slug) {
          window.location.href = '/berita/' + card.dataset.slug;
        }
      });

      this.initMarqueeInfinite(track);
      if (window.lucide) window.lucide.createIcons();
    } catch (_) {
      track.innerHTML = `<div class="reports-empty" style="width:100%;">
        <i data-lucide="alert-circle"></i>
        <p>Gagal memuat berita.</p>
      </div>`;
    }
  }

  initMarqueeInfinite(track) {
    if (track.dataset.marqueeInit) return; // guard: no double-init on re-render
    track.dataset.marqueeInit = '1';
    // Duplicate all tiles for seamless infinite loop
    const tiles = Array.from(track.children);
    if (tiles.length === 0) return;

    // Duplikat tile (kecuali empty state)
    tiles.forEach(tile => {
      const clone = tile.cloneNode(true);
      clone.classList.add('clone');
      track.appendChild(clone);
    });

    let speed = 0.6; // px per frame (~36px/s at 60fps)
    let pos = 0;
    let isPaused = false;
    let isDragging = false;
    let startX = 0;
    let dragStartPos = 0;
    let rafId = null;
    let totalWidth = 0;

    function calcTotalWidth() {
      totalWidth = 0;
      for (let i = 0; i < tiles.length; i++) {
        totalWidth += tiles[i].offsetWidth + 20; // 20 = gap
      }
    }

    calcTotalWidth();
    // Recalc on resize
    const resizeHandler = () => calcTotalWidth();
    window.addEventListener('resize', resizeHandler);

    // ── Animation Loop ──
    function animate() {
      if (!isPaused && !isDragging && totalWidth > 0) {
        pos -= speed;
        // Reset seamless: ketika udah scroll sejauh setengah (satu set tile)
        if (Math.abs(pos) >= totalWidth) {
          pos += totalWidth;
        }
        track.style.transform = `translateX(${pos}px)`;
      }
      rafId = requestAnimationFrame(animate);
    }
    rafId = requestAnimationFrame(animate);

    // ── Hover pause ──
    track.addEventListener('mouseenter', () => { isPaused = true; });
    track.addEventListener('mouseleave', () => {
      if (!isDragging) isPaused = false;
      track.classList.remove('dragging');
    });

    // ── Manual Drag ──
    const onStart = (clientX) => {
      isDragging = true;
      startX = clientX;
      dragStartPos = pos;
      this._marqueeDragDistance = 0;
      track.classList.add('dragging');
      track.style.cursor = 'grabbing';
    };

    const onMove = (clientX) => {
      if (!isDragging) return;
      const delta = (clientX - startX) * 1.5;
      pos = dragStartPos + delta;
      this._marqueeDragDistance = Math.abs(clientX - startX);
      track.style.transform = `translateX(${pos}px)`;
    };

    const onEnd = () => {
      isDragging = false;
      track.classList.remove('dragging');
      track.style.cursor = '';
    };

    // ── Manual Drag (Pointer Events: mouse, touch, pen — 1 API, window listeners) ──
    // Drag target = the visual wrapper (covers full section height), not just track
    const dragTarget = document.querySelector('.news-marquee');
    dragTarget.addEventListener('pointerdown', (e) => onStart(e.clientX));
    window.addEventListener('pointermove', (e) => onMove(e.clientX));
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);

    // Fallback: plain mouse drag for older engines
    dragTarget.addEventListener('mousedown', (e) => onStart(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    // Trackpad 2-finger horizontal swipe / shift+wheel
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // let vertical scroll through
      e.preventDefault();
      pos -= e.deltaX;
      track.style.transform = `translateX(${pos}px)`;
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    dragTarget.addEventListener('wheel', onWheel, { passive: false });

    // Cleanup on destroy
    this._marqueeCleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      dragTarget.removeEventListener('wheel', onWheel);
    };
  }

  initMarquee() {
    // Duplicate track content for seamless infinite loop (translateX -50%)
    const track = document.getElementById('feature-marquee-track');
    if (!track || track.dataset.duplicated) return;
    track.dataset.duplicated = '1';
    const items = Array.from(track.children);
    if (items.length === 0) return;
    items.forEach(item => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
  }

  initFAQ() {
    document.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item.classList.contains('open');
        // Close all
        document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
      });
    });
  }

  async loadChart() {
    try {
      const res = await fetch('/api/stats', { credentials: 'include' });
      const data = await res.json();
      if (!data) return;

      const total = data.total || 0;
      const valid = data.valid || 0;
      const pending = data.pending || 0;
      const ignored = data.cancelled || 0;
      const max = Math.max(total, 1);

      const aiHigh = data.tinggi || 0;
      const aiMid = data.sedang || 0;
      const aiLow = data.rendah || 0;
      const aiNone = data.tidakTerindikasi || 0;
      const aiMax = Math.max(aiHigh + aiMid + aiLow + aiNone, 1);

      this.chartData = { valid, pending, ignored, total, aiHigh, aiMid, aiLow, aiNone, max, aiMax };

      // Akurasi Model = data AI dari SELURUH workspace (bukan hanya workspace ini)
      try {
        const gRes = await fetch('/api/stats/global', { credentials: 'include' });
        const gData = await gRes.json();
        if (gData) {
          this._renderConfidenceSplit(gData.tinggi || 0, gData.sedang || 0, gData.rendah || 0, gData.tidakTerindikasi || 0);
        }
      } catch (_) {}
      const impactReports = document.getElementById('impact-reports');
      if (impactReports) impactReports.textContent = total.toLocaleString('id-ID');

      // Set angka awal = 0
      document.getElementById('chart-val-valid').textContent = '0';
      document.getElementById('chart-val-pending').textContent = '0';
      document.getElementById('chart-val-ignored').textContent = '0';
      document.getElementById('chart-val-total').textContent = '0';
      document.getElementById('chart-val-ai-high').textContent = '0';
      document.getElementById('chart-val-ai-mid').textContent = '0';
      document.getElementById('chart-val-ai-low').textContent = '0';
      document.getElementById('chart-val-ai-none').textContent = '0';

      ['chart-bar-valid','chart-bar-pending','chart-bar-ignored','chart-bar-total',
       'chart-bar-ai-high','chart-bar-ai-mid','chart-bar-ai-low','chart-bar-ai-none'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.width = '0%';
      });

      // Observer: animasi jalan saat discroll ke viewport
      createScrollObserver('#chart-section', () => {
        this.animateBar('chart-bar-valid', valid, max);
        this.animateBar('chart-bar-pending', pending, max);
        this.animateBar('chart-bar-ignored', ignored, max);
        this.animateBar('chart-bar-total', total, max);
        this.animateBar('chart-bar-ai-high', aiHigh, aiMax);
        this.animateBar('chart-bar-ai-mid', aiMid, aiMax);
        this.animateBar('chart-bar-ai-low', aiLow, aiMax);
        this.animateBar('chart-bar-ai-none', aiNone, aiMax);
        animateCounter(document.getElementById('chart-val-valid'), valid, 1000);
        animateCounter(document.getElementById('chart-val-pending'), pending, 1000);
        animateCounter(document.getElementById('chart-val-ignored'), ignored, 1000);
        animateCounter(document.getElementById('chart-val-total'), total, 1000);
        animateCounter(document.getElementById('chart-val-ai-high'), aiHigh, 1000);
        animateCounter(document.getElementById('chart-val-ai-mid'), aiMid, 1000);
        animateCounter(document.getElementById('chart-val-ai-low'), aiLow, 1000);
        animateCounter(document.getElementById('chart-val-ai-none'), aiNone, 1000);
      });
    } catch (_) {}
  }

  animateBar(id, value, max) {
    const el = document.getElementById(id);
    if (el) {
      const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
      requestAnimationFrame(() => {
        el.style.transition = 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        el.style.width = `${pct}%`;
      });
    }
  }

  _renderConfidenceSplit(high, mid, low, none) {
    const holder = document.getElementById('confidence-split');
    if (!holder) return;
    const total = Math.max(high + mid + low + none, 1);
    const pct = (v) => Math.round((v / total) * 100);
    const bands = [
      { label: 'Tinggi', val: high, pct: pct(high), color: '#EF4444' },
      { label: 'Sedang', val: mid, pct: pct(mid), color: '#F59E0B' },
      { label: 'Rendah', val: low, pct: pct(low), color: '#3B82F6' },
      { label: 'Tidak Terindikasi', val: none, pct: pct(none), color: '#94A3B8' },
    ];
    // Single stacked bar = share of each band, distinct from the chart bars above
    holder.innerHTML = `
      <div class="conf-split-bar">
        ${bands.map(b => `<span style="width:${b.pct}%;background:${b.color};" title="${b.label} ${b.pct}%"></span>`).join('')}
      </div>
      <div class="conf-split-legend">
        ${bands.map(b => `
          <div class="conf-split-item">
            <span class="dot" style="background:${b.color};"></span>
            <strong>${b.pct}%</strong>
            <span>${b.label}</span>
            <small>${b.val} laporan</small>
          </div>
        `).join('')}
      </div>
    `;
  }

  setBar(id, value, max) {
    const el = document.getElementById(id);
    if (el) {
      const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
      el.style.width = `${pct}%`;
    }
  }

  initScrollAnimation() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.landing-section, .landing-cta').forEach(el => {
      el.classList.add('animate-on-scroll');
      observer.observe(el);
    });
  }

  destroy() {
    if (typeof this._marqueeCleanup === 'function') {
      this._marqueeCleanup();
    }
  }
}

export const Home = new HomePage();
