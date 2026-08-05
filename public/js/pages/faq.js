// faq.js — FAQ Page Logic
import { AppState } from '../core/state.js';
import { Router } from '../core/router.js';

class FAQPage {
  constructor() {
    this.faqs = [
      {
        category: 'Umum',
        questions: [
          {
            q: 'Apa itu EYECO?',
            a: 'EYECO (Environmental Yield & Ecology) adalah platform pemantauan kebersihan lingkungan berbasis AI yang memungkinkan warga melaporkan pencemaran sampah, serta membantu pemerintah dalam verifikasi dan penanganan.'
          },
          {
            q: 'Siapa yang bisa menggunakan EYECO?',
            a: 'Semua warga negara Indonesia dapat menggunakan EYECO untuk melaporkan kondisi lingkungan. Petugas pemerintah dan admin memiliki akses ke dashboard verifikasi dan manajemen kasus.'
          },
          {
            q: 'Apakah EYECO gratis?',
            a: 'Ya, EYECO gratis digunakan oleh warga untuk melaporkan. Fitur dashboard pemerintah memerlukan akun resmi yang dikelola oleh dinas terkait.'
          }
        ]
      },
      {
        category: 'Pelaporan',
        questions: [
          {
            q: 'Bagaimana cara melaporkan pencemaran sampah?',
            a: 'Buka halaman "Laporkan" di dashboard, unggah foto bukti, isi lokasi dan deskripsi singkat, lalu kirim. AI akan otomatis menganalisis foto dan menentukan tingkat prioritas.'
          },
          {
            q: 'Format foto apa yang didukung?',
            a: 'Format JPG, PNG, dan WEBP dengan ukuran maksimal 10MB. Pastikan foto jelas, tidak blur, dan menunjukkan kondisi pencemaran serta lokasi sekitarnya.'
          },
          {
            q: 'Bisakah saya melaporkan tanpa foto?',
            a: 'Tidak. Foto bukti wajib diunggah agar AI dapat mendeteksi objek dan memverifikasi kelayakan laporan. Laporan tanpa foto tidak akan diproses.'
          },
          {
            q: 'Berapa lama laporan diproses?',
            a: 'Analisis AI instan (< 5 detik). Verifikasi admin biasanya 1-3 hari kerja tergantung volume laporan dan kompleksitas kasus.'
          }
        ]
      },
      {
        category: 'Verifikasi & Status',
        questions: [
          {
            q: 'Apa arti status "Menunggu", "Valid", dan "Diabaikan"?',
            a: '"Menunggu" = laporan baru masuk, belum diverifikasi admin. "Valid" = diverifikasi benar oleh admin, diteruskan ke petugas. "Diabaikan" = tidak memenuhi kriteria atau duplikat.'
          },
          {
            q: 'Bagaimana cara mengecek status laporan saya?',
            a: 'Masuk ke dashboard → menu "Laporan Saya". Di sana terlihat daftar laporan beserta status, tanggal, dan detail verifikasi.'
          },
          {
            q: 'Laporan saya ditandai "Diabaikan". Bisa di-banding?',
            a: 'Ya. Hubungi admin melalui halaman Kontak dengan menyertakan ID laporan dan alasan keberatan. Tim akan meninjau kembali dalam 2 hari kerja.'
          }
        ]
      },
      {
        category: 'CCTV & Monitoring',
        questions: [
          {
            q: 'Apa fungsi fitur CCTV Monitoring?',
            a: 'Memantau kamera CCTV terpasang secara real-time. AI mendeteksi aktivitas mencurigakan (pembuangan sampah, orang, kendaraan) dan membuat insiden otomatis.'
          },
          {
            q: 'Kamera apa yang didukung?',
            a: 'Kamera IP yang kompatibel ONVIF / RTSP, serta kamera Tuya Smart Home yang terintegrasi via Tuya Cloud API. Konfigurasi dilakukan oleh admin di halaman CCTV.'
          },
          {
            q: 'Apakah video CCTV disimpan?',
            a: 'Video tidak disimpan permanen. Hanya cuplikan (snapshot) saat deteksi AI yang disimpan sebagai bukti laporan. Stream live hanya ditampilkan saat monitoring aktif.'
          }
        ]
      },
      {
        category: 'Akun & Keamanan',
        questions: [
          {
            q: 'Lupa password, bagaimana reset?',
            a: 'Klik "Lupa Password" di halaman login. Masukkan email/username → verifikasi nomor HP (OTP) → atur password baru. Proses 3 langkah aman dan terenkripsi.'
          },
          {
            q: 'Bisa login dari beberapa perangkat?',
            a: 'Ya. Satu akun bisa login di beberapa perangkat (HP, laptop, tablet) secara bersamaan. Sesi sebelumnya tidak terputus.'
          },
          {
            q: 'Bagaimana keamanan data saya?',
            a: 'Data terenkripsi (TLS di transit, AES-256 di R2). Password di-hash bcrypt. Akses database dibatasi IP whitelist. Audit log mencatat semua aktivitas sensitif.'
          }
        ]
      }
    ];
  }

  async render(container) {
    container.innerHTML = `
      <div class="page-container">
        <div class="landing-bg" id="landing-bg"><!-- Background handled by body CSS --></div>
        <div class="faq-wrapper animate-fade-up">
          <nav class="landing-nav" style="position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(255,255,255,0.8); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(0,0,0,0.06); padding: 16px 60px;">
            <a href="javascript:void(0)" id="faq-back-btn" style="display:flex;align-items:center;gap:6px;color:var(--text-secondary);text-decoration:none;font-weight:600;font-size:0.95rem;margin-right:auto;"><i data-lucide="arrow-left" style="width:18px;height:18px;"></i> Kembali</a>
            <div class="nav-menu" style="display:flex;align-items:center;gap:24px;">
              <button class="btn-icon-toggle" id="v2-theme-toggle" aria-label="Toggle Dark Mode"><i data-lucide="moon"></i></button>
            </div>
          </nav>
          <section class="section-glass" style="margin-top: 80px; text-align: center; min-height: calc(100vh - 80px); display: flex; flex-direction: column; justify-content: center; padding: 80px 60px;">
            <h1 class="v2-headline" style="font-size: 3.5rem;">Pertanyaan<br>Yang Sering Diajukan</h1>
            <p class="v2-subhead" style="max-width: 700px; margin: 0 auto;">Temukan jawaban cepat untuk pertanyaan umum tentang EYECO, pelaporan, verifikasi, dan penggunaan platform.</p>
          </section>
          <div class="section-separator"></div>
          <section class="section-glass" style="padding: 80px 60px;">
            <div style="max-width: 800px; margin: 0 auto;">
              <div class="faq-list" id="faq-list"></div>
            </div>
          </section>
          <div class="section-separator"></div>
          <section class="section-solid" style="text-align: center; padding: 60px;">
            <h2 style="font-size: 2rem; font-weight: 800; margin-bottom: 16px;">Masih Punya Pertanyaan?</h2>
            <p style="color: var(--text-muted); margin-bottom: 24px; font-size: 1.1rem;">Tim kami siap membantu. Hubungi kami melalui halaman kontak atau kirim email langsung.</p>
            <a href="/kontak" class="premium-cta"><i data-lucide="mail"></i> Hubungi Kami</a>
          </section>
          <footer style="text-align: center; padding: 40px 60px; border-top: 1px solid rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 16px;">
              <a href="/faq" style="color: var(--text-muted); text-decoration: none;">FAQ</a>
              <a href="/tentang" style="color: var(--text-muted); text-decoration: none;">Tentang</a>
              <a href="/kontak" style="color: var(--text-muted); text-decoration: none;">Kontak</a>
            </div>
            <p style="color: var(--text-gray); font-size: 0.9rem;">© 2025 EYECO. All rights reserved.</p>
          </footer>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderFAQs();
    if (window.lucide) window.lucide.createIcons();
  }

  bindEvents() {
    // Kembali ke halaman sebelumnya
    const backBtn = document.getElementById('faq-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else window.location.href = '/';
      });
    }

    const themeBtn = document.getElementById('v2-theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        AppState.set('theme', isDark ? 'dark' : 'light');
        const icon = isDark ? 'sun' : 'moon';
        themeBtn.innerHTML = `<i data-lucide="${icon}"></i>`;
        if (window.lucide) window.lucide.createIcons();
      });
      const isDark = document.body.classList.contains('dark-mode');
      themeBtn.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
    }
  }

  renderFAQs() {
    const container = document.getElementById('faq-list');
    if (!container) return;

    container.innerHTML = this.faqs.map((cat, ci) => `
      <div class="faq-category" style="margin-bottom: 48px;">
        <h3 style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid var(--primary); display: inline-block;">${cat.category}</h3>
        <div class="faq-items">
          ${cat.questions.map((q, qi) => `
            <details class="faq-item" style="background: rgba(255,255,255,0.5); border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; margin-bottom: 12px; overflow: hidden;" open="${ci === 0 && qi === 0}">
              <summary style="padding: 18px 24px; cursor: pointer; font-weight: 600; font-size: 1rem; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center; list-style: none;">
                ${q.q}
                <i data-lucide="chevron-down" style="width: 20px; height: 20px; color: var(--text-muted); flex-shrink: 0; transition: transform 0.2s;"></i>
              </summary>
              <div style="padding: 0 24px 20px; color: var(--text-secondary); line-height: 1.7; font-size: 0.95rem;">${q.a}</div>
            </details>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Animate chevron on details open/close
    container.querySelectorAll('details.faq-item').forEach(details => {
      const summary = details.querySelector('summary');
      const icon = summary?.querySelector('[data-lucide="chevron-down"]');
      if (icon) {
        details.addEventListener('toggle', () => {
          icon.style.transform = details.open ? 'rotate(180deg)' : 'rotate(0deg)';
        });
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }
}

export const FAQ = new FAQPage();