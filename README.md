# EYECO — Sistem Monitoring Aktivitas Mencurigakan Sungai

Aplikasi monitoring lingkungan (Kabupaten Bandung) berbasis web yang mendeteksi aktivitas mencurigakan di area sungai melalui kamera CCTV dengan AI, menghasilkan laporan realtime yang bisa diverifikasi dan diekspor.

## Fitur

- **AI Deteksi CCTV** — deteksi aktivitas mencurigakan via pipeline inference (ONNX / FastAPI / local Python), tracking objek, frame capture, dan auto-report
- **Monitoring realtime** — stream CCTV (RTSP → HLS via ffmpeg), status kamera, health engine
- **Laporan lingkungan** — laporan realtime, verifikasi, komentar, like, skor pelanggaran, export PDF
- **Multi-workspace** — user bergabung ke workspace, role: user / admin / superadmin, request approval
- **Manajemen akun** — register, login, forgot/reset password, change password, multi-device session, audit log
- **Notifikasi Telegram** — alert otomatis untuk deteksi skor tinggi
- **Berita & FAQ** — konten publik per workspace
- **Continual learning (AI)** — dataset pipeline, golden dataset, training job management, evaluasi model

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Backend | Node.js 20, Express 4, TypeScript |
| Database | MongoDB Atlas (Mongoose) |
| Storage | Cloudflare R2 (foto/video bukti, metadata di MongoDB) |
| CCTV | Tuya Cloud API + RTSP→HLS transcoding (ffmpeg) |
| Auth | express-session + connect-mongo, bcrypt, JWT |
| Notifikasi | Telegram Bot API |
| PDF | pdfkit |
| Frontend | SPA vanilla ES modules, Lucide icons, glassmorphism CSS |

## Struktur

```
src/
  server.ts            # Entry point & middleware
  routes/              # API routes (8 file, ±100 endpoint)
  auth/                # auth service, middleware, role guard
  database/models/     # 41 model Mongoose
  cctv/                # Tuya client, AI engine, tracking, transcoder
  services/            # R2 storage, notifikasi, AI services
  notifications/       # Telegram channel
  utils/               # crypto, password
public/
  js/pages/            # 9 halaman SPA (dashboard, laporan, cctv, profile, dll)
  views/               # 15 halaman HTML (auth, landing, workspace)
```

## Prasyarat

- Node.js 20+
- MongoDB Atlas (URI)
- Cloudflare R2 bucket
- Tuya Cloud developer account (opsional, untuk CCTV)
- ffmpeg (diinstal sistem, dipakai untuk transcode RTSP→HLS)

## Setup

```bash
npm install
cp .env.example .env   # isi konfigurasi (lihat di bawah)
npm run build
npm start              # atau: npm run dev (build + start)
```

### Variabel `.env`

| Variabel | Keterangan |
|----------|------------|
| `PORT` | Port server (default 3000) |
| `MONGODB_URI` | URI MongoDB Atlas |
| `SESSION_SECRET` | Secret session express |
| `JWT_SECRET` | Secret JWT / enkripsi data |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram (notifikasi) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Kredensial Cloudflare R2 |
| `R2_ENDPOINT` / `R2_BUCKET` / `R2_PUBLIC_URL` | Konfigurasi bucket R2 |
| `TUYA_CLIENT_ID` / `TUYA_CLIENT_SECRET` / `TUYA_API_ENDPOINT` | Kredensial Tuya Cloud (CCTV) |

## Scripts

```bash
npm run build                 # kompilasi TypeScript → dist/
npm run dev                   # build + start
npm start                     # jalankan dist/server.js
npm run repair:report-snapshots   # perbaikan snapshot laporan
```

## Deployment

VPS (Hostinger/dll) dengan Node.js 20+:

```bash
npm install --production
npm run build
# jalankan dengan process manager (pm2 / systemd)
pm2 start dist/server.js --name eyeco
```

Server stateless — semua data tersimpan di MongoDB Atlas & R2, jadi migrasi VPS cukup menyalin kode + `.env`.

## Lisensi

Hak cipta © EYECO. Dikembangkan oleh Karim & Hafiz.
