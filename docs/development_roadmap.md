# EYECO Incident Management V3 - Development Roadmap
## Peta Jalan Pengembangan Berbasis Sprint (Sprint 1 - 6) - Updated

Dokumen ini mendefinisikan rencana rilis fitur bertahap untuk modul Incident Management & Decision Workspace platform EYECO. Dengan membagi pekerjaan menjadi sprint, tim dapat menguji, meninjau, dan memastikan stabilitas sistem di setiap tahap sebelum melangkah ke fitur berikutnya.

---

## Ringkasan Roadmap

```
Sprint 1 ──> Sprint 2 ──> Sprint 3 ──> Sprint 4 ──> Sprint 5 ──> Sprint 6
 (Auth &      (Core FSM     (Assignment  (Resolution  (Notification (Analytics &
  Repos)      & Timeline)    & Officer)   & Approval)  WS & Telegram)  Dashboard)
```

---

## 1. Rincian Sprint

### Sprint 1: Authentication, Roles & Base Repositories
Fokus pada infrastruktur dasar, autentikasi berbasis multi-role, dan pembuatan pola repositori dasar.
- **Tujuan**: Memastikan data dasar pengguna (operator, supervisor, officer, admin) siap digunakan secara aman.
- **Pekerjaan**:
  - Penyelesaian skema dan migrasi (seeder) pengguna (`src/database/migration.ts`).
  - Pembuatan `UserRepository` dan `ReportRepository` dasar.
  - Implementasi session helper dan otorisasi dasar di `server.ts`.
- **Kriteria Penerimaan (Acceptance Criteria)**:
  - User dapat login dengan role masing-masing dan mendapatkan cookie session token.
  - API query data insiden dapat mengembalikan plain object (POJO) tanpa format Mongoose document.

---

### Sprint 2: Incident FSM, Timeline & Audit Logs
Fokus pada integrasi status transaksi, State Machine, rekam jejak aktivitas, dan pencatatan audit trail.
- **Tujuan**: Memastikan perpindahan status laporan divalidasi oleh FSM dan dicatat secara *immutable* di timeline.
- **Pekerjaan**:
  - Pembuatan modul State Machine terpusat (`src/services/StateMachine.ts`).
  - Pembuatan `TimelineRepository` dan `TimelineService`.
  - Pembuatan middleware audit log untuk merekam Request ID, Trace ID, Correlation ID, dan IP.
- **Kriteria Penerimaan**:
  - Transisi status laporan dari `NEW` ke `UNDER_REVIEW` atau `VALIDATED` terbukti divalidasi FSM.
  - Setiap perubahan status memicu pembuatan Timeline Event yang tidak dapat dihapus (*immutable*).

---

### Sprint 3: Assignment & Officer Workspace
Fokus pada penugasan petugas kebersihan sungai di lapangan.
- **Tujuan**: Memperbolehkan operator menugaskan petugas aktif ke insiden sungai tertentu.
- **Pekerjaan**:
  - Pembuatan `AssignmentRepository` dan endpoint `/api/incidents/:id/assign`.
  - Modifikasi UI detail workspace untuk memuat daftar petugas aktif (dropdown).
  - Implementasi aturan kepemilikan (ownership) di mana petugas hanya bisa memperbarui status insiden yang ditugaskan kepadanya.
- **Kriteria Penerimaan**:
  - Operator dapat memilih petugas dan mengubah status laporan menjadi `ASSIGNED`.
  - Petugas dapat mengirimkan update kedatangan (`ON_SITE` / `IN_PROGRESS`) secara sukses.

---

### Sprint 4: Resolution Workspace & Approval Workflow
Fokus pada penyelesaian laporan oleh petugas dan persetujuan dari supervisor.
- **Tujuan**: Menyediakan bukti visual (foto sesudah) pembersihan dan siklus persetujuan penutupan insiden.
- **Pekerjaan**:
  - Pembuatan `ResolutionRepository` dan endpoint `/api/incidents/:id/resolve` (unggah berkas multipart).
  - Integrasi virus scanner metadata simulasi dan penghitungan checksum SHA-256 berkas unggahan.
  - Implementasi endpoint `/api/incidents/:id/approve` untuk supervisor.
- **Kriteria Penerimaan**:
  - Petugas sukses mengunggah berkas resolusi dan status laporan bergeser ke `WAITING_APPROVAL`.
  - Supervisor dapat menyetujui (status `CLOSED`) atau menolak (kembali ke `IN_PROGRESS`) laporan tersebut.

---

### Sprint 5: Multi-Channel Notifications (Web, WS & Telegram Bot)
Fokus pada integrasi asinkronus pengiriman notifikasi instan dan eksternal.
- **Tujuan**: Mengintegrasikan notifikasi web, WebSocket/SSE, dan Telegram Bot menggunakan Transactional Outbox Pattern.
- **Pekerjaan**:
  - Pembuatan `TelegramNotificationService.ts` untuk interaksi API bot.
  - Implementasi `telegram_delivery_logs` untuk rekam jejak audit notifikasi eksternal.
  - Penyesuaian `OutboxWorker.ts` untuk memindai antrean `outbox_events` berstatus `PENDING` dan melakukan retry terjadwal ke Telegram jika terjadi timeout.
  - Implementasi endpoint `PATCH /api/system/settings/telegram` untuk toggling pengaturan.
- **Kriteria Penerimaan**:
  - Kejadian deteksi awal, penunjukan petugas, dan penutupan kasus sukses memicu pesan Telegram terformat dengan rely thread.
  - Sistem tetap berjalan lancar (tidak error) jika Telegram API mengalami kegagalan/offline karena ditangani secara asinkronus oleh Outbox Worker.

---

### Sprint 6: Analytics, Dashboard & Data Export
Fokus pada pelaporan, visualisasi data SLA, dan ekspor laporan insiden.
- **Tujuan**: Menyajikan metrik performa penanganan insiden sungai untuk pihak manajemen.
- **Pekerjaan**:
  - Implementasi query agregasi metrik SLA (durasi respon rata-rata, durasi pembersihan rata-rata).
  - Pembuatan grafik visualisasi kasus di dashboard utama.
  - Fitur ekspor laporan terperinci dalam format PDF/Excel.
- **Kriteria Penerimaan**:
  - Manajemen dapat melihat visualisasi grafis kasus per wilayah dan durasi SLA secara akurat.
