// home.js — Citizen Landing Page (Masyarakat)
// Premium, whitespace-rich, mobile-first landing page
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';
import { ReportService } from '../services/reportService.js';
import { Formatter } from '../utils/formatter.js';

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
        
        <!-- ═══ HERO SECTION ═══ -->
        <section class="landing-hero">
          <div class="hero-content">
            <span class="hero-badge"><i data-lucide="waves"></i> EYECO — Pantau Sungaimu</span>
            <h1 class="hero-title">Bersama Menjaga<br/>Kebersihan Sungai</h1>
            <p class="hero-subtitle">Laporkan pencemaran sampah di sungai dengan satu klik. 
            AI kami akan mendeteksi, memverifikasi, dan meneruskan laporan ke dinas terkait.</p>
            <div class="hero-actions">
              <a class="hero-btn-primary" id="hero-btn-upload">
                <i data-lucide="upload-cloud"></i> Laporkan Sekarang
              </a>
              <a class="hero-btn-secondary" id="hero-btn-reports">
                <i data-lucide="file-text"></i> Lihat Laporan
              </a>
            </div>
            <div class="hero-stats">
              <div class="hero-stat">
                <span class="hero-stat-value" id="hero-stat-reports">0</span>
                <span class="hero-stat-label">Laporan Terkini</span>
              </div>
              <div class="hero-stat-divider"></div>
              <div class="hero-stat">
                <span class="hero-stat-value" id="hero-stat-valid">0</span>
                <span class="hero-stat-label">Terverifikasi</span>
              </div>
              <div class="hero-stat-divider"></div>
              <div class="hero-stat">
                <span class="hero-stat-value">32</span>
                <span class="hero-stat-label">Titik Pantau</span>
              </div>
            </div>
          </div>
          <div class="hero-visual">
            <div class="hero-graphic">
              <div class="hero-graphic-blob"></div>
              <div class="hero-graphic-blob blob2"></div>
              <div class="hero-graphic-card card1">
                <i data-lucide="camera"></i>
                <span>AI Detection</span>
              </div>
              <div class="hero-graphic-card card2">
                <i data-lucide="map-pin"></i>
                <span>Real-time</span>
              </div>
              <div class="hero-graphic-card card3">
                <i data-lucide="shield"></i>
                <span>Verified</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══ ABOUT SECTION ═══ -->
        <section class="landing-section" id="about">
          <div class="section-label">Tentang EYECO</div>
          <h2 class="section-title">Platform Pemantauan Sungai<br/>Berbasis AI</h2>
          <p class="section-desc">EYECO adalah sistem pemantauan kualitas sungai yang menggunakan kecerdasan buatan 
          untuk mendeteksi pencemaran sampah secara otomatis. Warga dapat melapor, dan AI kami memverifikasi 
          serta meneruskan ke petugas terkait.</p>
          <div class="about-grid">
            <div class="about-card">
              <div class="about-icon" style="background: rgba(37,99,235,0.1); color: #2563EB;">
                <i data-lucide="brain-circuit"></i>
              </div>
              <h3>AI Detection</h3>
              <p>Model YOLOv8 mendeteksi sampah di sungai secara real-time dari kamera CCTV dan foto warga.</p>
            </div>
            <div class="about-card">
              <div class="about-icon" style="background: rgba(16,185,129,0.1); color: #10B981;">
                <i data-lucide="globe"></i>
              </div>
              <h3>Partisipasi Warga</h3>
              <p>Masyarakat dapat melaporkan pencemaran langsung dari HP dengan foto dan lokasi.</p>
            </div>
            <div class="about-card">
              <div class="about-icon" style="background: rgba(139,92,246,0.1); color: #8B5CF6;">
                <i data-lucide="clipboard-check"></i>
              </div>
              <h3>Verifikasi Otomatis</h3>
              <p>AI memproses dan mengkategorikan laporan, lalu petugas menerima notifikasi instan.</p>
            </div>
          </div>
        </section>

        <!-- ═══ HOW IT WORKS ═══ -->
        <section class="landing-section landing-steps" id="how-it-works">
          <div class="section-label">Cara Kerja</div>
          <h2 class="section-title">Laporkan dalam 3 Langkah</h2>
          <p class="section-desc">Cukup foto, upload, dan kami yang urus sisanya.</p>
          <div class="steps-grid">
            <div class="step-card">
              <div class="step-number">1</div>
              <div class="step-icon"><i data-lucide="camera"></i></div>
              <h3>Ambil Foto</h3>
              <p>Foto kondisi sungai atau sampah yang mencurigakan menggunakan HP kamu.</p>
            </div>
            <div class="step-connector">
              <i data-lucide="arrow-right"></i>
            </div>
            <div class="step-card">
              <div class="step-number">2</div>
              <div class="step-icon"><i data-lucide="upload-cloud"></i></div>
              <h3>Upload & Deteksi</h3>
              <p>Unggah foto, AI kami akan mendeteksi dan menganalisis objek sampah secara otomatis.</p>
            </div>
            <div class="step-connector">
              <i data-lucide="arrow-right"></i>
            </div>
            <div class="step-card">
              <div class="step-number">3</div>
              <div class="step-icon"><i data-lucide="check-circle"></i></div>
              <h3>Pantau Progres</h3>
              <p>Laporan diverifikasi dan diteruskan ke dinas terkait. Pantau status secara real-time.</p>
            </div>
          </div>
        </section>

        <!-- ═══ BENEFITS ═══ -->
        <section class="landing-section" id="benefits">
          <div class="section-label">Manfaat</div>
          <h2 class="section-title">Kenapa Menggunakan EYECO?</h2>
          <p class="section-desc">Kami menggabungkan teknologi AI dengan partisipasi masyarakat untuk hasil maksimal.</p>
          <div class="benefits-grid">
            <div class="benefit-card">
              <i data-lucide="zap" class="benefit-icon" style="color: #F59E0B;"></i>
              <h3>Cepat & Efisien</h3>
              <p>Deteksi AI dalam hitungan detik. Tidak perlu menunggu verifikasi manual yang lama.</p>
            </div>
            <div class="benefit-card">
              <i data-lucide="shield" class="benefit-icon" style="color: #10B981;"></i>
              <h3>Transparan</h3>
              <p>Setiap laporan memiliki status yang bisa dipantau oleh masyarakat secara terbuka.</p>
            </div>
            <div class="benefit-card">
              <i data-lucide="smartphone" class="benefit-icon" style="color: #2563EB;"></i>
              <h3>Mudah Digunakan</h3>
              <p>Cukup dari HP, tanpa perlu instalasi aplikasi tambahan. Siapa pun bisa melapor.</p>
            </div>
            <div class="benefit-card">
              <i data-lucide="users" class="benefit-icon" style="color: #8B5CF6;"></i>
              <h3>Kolaborasi</h3>
              <p>Warga, pemerintah, dan akademisi dapat berkolaborasi menjaga kebersihan sungai.</p>
            </div>
          </div>
        </section>

        <!-- ═══ LATEST REPORTS PREVIEW ═══ -->
        <section class="landing-section" id="latest-reports">
          <div class="section-row-header">
            <div>
              <div class="section-label">Laporan Terbaru</div>
              <h2 class="section-title">Aktivitas Warga</h2>
            </div>
            <a class="section-link" id="hero-btn-all-reports">
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

        <!-- ═══ NEWS SECTION ═══ -->
        <section class="landing-section" id="news">
          <div class="section-row-header">
            <div>
              <div class="section-label">Berita & Informasi</div>
              <h2 class="section-title">Update Lingkungan</h2>
            </div>
          </div>
          <div class="news-grid" id="landing-news-grid">
            <div class="reports-skeleton">
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
            </div>
          </div>
        </section>

        <!-- ═══ FAQ ═══ -->
        <section class="landing-section" id="faq">
          <div class="section-label">FAQ</div>
          <h2 class="section-title">Pertanyaan Umum</h2>
          <p class="section-desc">Temukan jawaban untuk pertanyaan yang sering diajukan.</p>
          <div class="faq-list">
            <div class="faq-item">
              <button class="faq-question">
                <span>Apa itu EYECO?</span>
                <i data-lucide="chevron-down" class="faq-chevron"></i>
              </button>
              <div class="faq-answer">
                <p>EYECO adalah sistem pemantauan sungai berbasis AI yang memungkinkan masyarakat melaporkan pencemaran sampah. Laporan akan diverifikasi oleh AI dan diteruskan ke dinas terkait.</p>
              </div>
            </div>
            <div class="faq-item">
              <button class="faq-question">
                <span>Bagaimana cara melaporkan?</span>
                <i data-lucide="chevron-down" class="faq-chevron"></i>
              </button>
              <div class="faq-answer">
                <p>Cukup klik "Laporkan Sekarang", upload foto sungai atau sampah, isi lokasi, dan kirim. AI kami akan memproses laporan secara otomatis.</p>
              </div>
            </div>
            <div class="faq-item">
              <button class="faq-question">
                <span>Apakah data saya aman?</span>
                <i data-lucide="chevron-down" class="faq-chevron"></i>
              </button>
              <div class="faq-answer">
                <p>Ya, data Anda dilindungi dengan enkripsi dan hanya digunakan untuk keperluan pelaporan. Identitas Anda bersifat opsional.</p>
              </div>
            </div>
            <div class="faq-item">
              <button class="faq-question">
                <span>Berapa lama proses verifikasi?</span>
                <i data-lucide="chevron-down" class="faq-chevron"></i>
              </button>
              <div class="faq-answer">
                <p>Verifikasi AI berlangsung dalam hitungan detik. Setelah itu, admin akan memvalidasi laporan dalam waktu 1x24 jam.</p>
              </div>
            </div>
            <div class="faq-item">
              <button class="faq-question">
                <span>Siapa yang bisa menggunakan EYECO?</span>
                <i data-lucide="chevron-down" class="faq-chevron"></i>
              </button>
              <div class="faq-answer">
                <p>Semua warga Indonesia dapat menggunakan EYECO. Cukup daftar dengan email atau username.</p>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══ CTA SECTION ═══ -->
        <section class="landing-cta">
          <div class="cta-content">
            <h2>Siap Berkontribusi?</h2>
            <p>Mulai laporkan kondisi sungai di sekitarmu sekarang juga. Bersama kita jaga lingkungan.</p>
            <a class="hero-btn-primary" id="cta-btn-upload">
              <i data-lucide="upload-cloud"></i> Laporkan Sekarang
            </a>
          </div>
        </section>

        <!-- ═══ FOOTER ═══ -->
        <footer class="landing-footer">
          <div class="footer-brand">
            <i data-lucide="waves"></i>
            <span>EYECO</span>
          </div>
          <p class="footer-desc">Sistem pemantauan kebersihan sungai berbasis AI untuk Indonesia yang lebih bersih.</p>
          <div class="footer-links">
            <span>© ${new Date().getFullYear()} EYECO</span>
            <span class="footer-dot">·</span>
            <a href="/tentang">Tentang</a>
            <span class="footer-dot">·</span>
            <a href="/kebijakan">Kebijakan Privasi</a>
            <span class="footer-dot">·</span>
            <a href="/kontak">Kontak</a>
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

    // Init FAQ accordion
    this.initFAQ();

    // Animate on scroll
    this.initScrollAnimation();
  }

  bindEvents() {
    // Hero CTA buttons
    document.getElementById('hero-btn-upload')?.addEventListener('click', (e) => {
      e.preventDefault();
      Router.navigate('/dashboard/upload');
    });
    document.getElementById('hero-btn-reports')?.addEventListener('click', (e) => {
      e.preventDefault();
      Router.navigate('/dashboard/laporan');
    });
    document.getElementById('hero-btn-all-reports')?.addEventListener('click', (e) => {
      e.preventDefault();
      Router.navigate('/dashboard/laporan');
    });
    document.getElementById('cta-btn-upload')?.addEventListener('click', (e) => {
      e.preventDefault();
      Router.navigate('/dashboard/upload');
    });
  }

  async loadStats() {
    try {
      const res = await fetch('/api/stats/summary', { credentials: 'include' });
      const data = await res.json();
      if (data) {
        const totalEl = document.getElementById('hero-stat-reports');
        const validEl = document.getElementById('hero-stat-valid');
        if (totalEl) totalEl.textContent = data.totalReports ?? data.total ?? '0';
        if (validEl) validEl.textContent = data.validReports ?? data.valid ?? '0';
      }
    } catch (_) {}
  }

  async loadLatestReports() {
    const container = document.getElementById('landing-reports-grid');
    if (!container) return;

    try {
      const response = await ReportService.getFilteredReports({ limit: 3 });
      this.latestReports = response.reports || [];
      container.innerHTML = '';

      if (this.latestReports.length === 0) {
        container.innerHTML = `
          <div class="reports-empty">
            <i data-lucide="inbox"></i>
            <p>Belum ada laporan warga. Jadilah yang pertama!</p>
          </div>
        `;
        return;
      }

      this.latestReports.forEach((report, i) => {
        const card = document.createElement('div');
        card.className = 'report-card';
        card.style.animationDelay = `${i * 0.1}s`;
        card.innerHTML = `
          <div class="report-card-img">
            <img src="${report.image}" alt="Bukti" loading="lazy" onerror="this.style.display='none'">
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
    const container = document.getElementById('landing-news-grid');
    if (!container) return;

    try {
      // Get workspaceId from AppState
      const user = AppState.get('user');
      const wsId = user?.workspaceId || 3;
      const res = await fetch(`/api/news/public/${wsId}`);
      const data = await res.json();
      const news = data.news || [];
      container.innerHTML = '';

      if (news.length === 0) {
        container.innerHTML = `
          <div class="reports-empty" style="grid-column:1/-1;">
            <i data-lucide="newspaper"></i>
            <p>Belum ada berita. Admin akan menambahkan informasi terbaru di sini.</p>
          </div>
        `;
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

      news.slice(0, 6).forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'news-card';
        card.style.animationDelay = `${i * 0.1}s`;
        card.innerHTML = `
          <div class="news-img" style="background: ${gradients[i % gradients.length]};">
            <i data-lucide="${icons[i % icons.length]}"></i>
          </div>
          <div class="news-body">
            <span class="news-tag">${item.category || 'Informasi'}</span>
            <h3>${item.title}</h3>
            <p>${item.summary}</p>
          </div>
        `;
        container.appendChild(card);
      });

      if (window.lucide) window.lucide.createIcons();
    } catch (_) {
      container.innerHTML = `
        <div class="reports-empty" style="grid-column:1/-1;">
          <i data-lucide="alert-circle"></i>
          <p>Gagal memuat berita.</p>
        </div>
      `;
    }
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
    // Cleanup
  }
}

export const Home = new HomePage();
