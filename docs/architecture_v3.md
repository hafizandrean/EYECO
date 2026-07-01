# EYECO Incident Management & Decision Workspace - Gold Standard V3
## Architecture Design Document (ADD) - Frozen Baseline

Dokumen ini mendefinisikan arsitektur teknis dan spesifikasi sistem tingkat tinggi untuk implementasi **Incident Management & Decision Workspace** pada platform EYECO. Spesifikasi ini dirancang untuk memastikan keandalan, keamanan audit trail, konsistensi status, serta performa database dalam penanganan insiden sungai berskala enterprise.

---

## 1. Arsitektur Kode & Pemetaan Data (DTO Pattern)
Aplikasi dipisahkan secara tegas menggunakan pola empat lapis untuk menjaga kebersihan logika bisnis:

```
Request/HTTP (server.ts) ──> Controller ──> Service Layer ──> Repository Layer ──> MongoDB (Mongoose)
```

- **Data Transfer Object (DTO) / Domain Entity Mapping**:
  Layanan Repository (e.g. `IncidentRepository` / `ReportRepository`) **tidak mengembalikan objek mongoose.Document** langsung ke lapisan Service. Sebagai gantinya, data fisik di-map menjadi Plain Old JavaScript Objects (POJO) atau DTO Domain Entity. Logika bisnis di lapisan Service tidak memiliki ketergantungan terhadap method ORM/ODM (seperti `.save()`, `.populate()`, dll.).

---

## 2. Arsitektur Model Data (MongoDB Collections)

### A. Koleksi `reports`
Menyimpan informasi inti insiden dan metrik durasi SLA yang terhitung secara instan.
- `_id` (ObjectId)
- `id` (Number, Unique, Index): ID numerik increment untuk kompatibilitas frontend.
- `userId` (ObjectId, ref: 'User')
- `tenantId` (String, Index): ID penyewa/instansi (e.g. 'BBWS', 'DLH') untuk mendukung skenario *multi-tenancy*.
- `location` (String)
- `timestamp` (Date)
- `image` (String)
- `identity` (String): Keterangan pelapor.
- `sourceType` (String): e.g., "CCTV", "Citizen".
- `aiStatus` (String): e.g., "TINGGI", "SEDANG", "RENDAH", "Tidak Terindikasi".
- `aiConfidence` (Number | null)
- `adminStatus` (String): e.g., "MENUNGGU", "VALIDATED", "REJECTED".
- `status` (String): Status operasional saat ini.
- `currentAssignmentId` (ObjectId, ref: 'Assignment' | null): Pointer langsung ke penugasan aktif.
- `currentResolutionId` (ObjectId, ref: 'Resolution' | null): Pointer langsung ke resolusi aktif.
- `sla` (Subdocument):
  - **Timestamp**:
    - `detectedAt` (Date)
    - `validatedAt` (Date | null)
    - `assignedAt` (Date | null)
    - `arrivedAt` (Date | null)
    - `resolvedAt` (Date | null)
    - `closedAt` (Date | null)
  - **Metrik Durasi Terhitung (Duration Metrics)**:
    - `validationDurationMs` (Number | null): Durasi dari deteksi hingga validasi.
    - `assignmentDurationMs` (Number | null): Durasi dari validasi hingga penunjukan petugas.
    - `cleanupDurationMs` (Number | null): Durasi dari petugas tiba hingga selesai pembersihan.
    - `resolutionDurationMs` (Number | null): Durasi dari penunjukan hingga selesai pembersihan.
    - `totalDurationMs` (Number | null): Total durasi siklus hidup insiden.
- `deletedAt` (Date | null): Flag untuk soft-delete.
- `deletedById` (ObjectId, ref: 'User' | null)
- `deletedByName` (String | null)
- `deleteReason` (String | null): Alasan penghapusan untuk kebutuhan audit.
- `restoreReason` (String | null): Alasan restorasi data.
- `__v` (Number): Mongoose version key untuk *Optimistic Concurrency Control*.

### B. Koleksi `timeline_events`
Mencatat seluruh rekam jejak aktivitas insiden secara *immutable* (hanya tulis/append-only).
- `_id` (ObjectId)
- `reportId` (ObjectId, ref: 'Report')
- `eventVersion` (Number, default: 1): Skema versi untuk fleksibilitas modifikasi struktur metadata di masa depan.
- `type` (String): Tipe event (e.g. `DETECTION`, `VALIDATED`, `ASSIGNED`, `ARRIVED`, `RESOLVED`, `CLOSED`, `REJECTED`, `COMMENT_ADDED`, `FILE_UPLOADED`).
- `actorId` (ObjectId, ref: 'User')
- `actorName` (String): Nama aktor pada saat event dibuat (denormalisasi).
- `actorRole` (String): Peran aktor saat aksi dilakukan.
- `title` (String)
- `description` (String)
- `metadata` (Discriminated Union based on `type` & `eventVersion`):
  - Jika `type` adalah `ASSIGNED`: `{ assignmentId: ObjectId, officerId: ObjectId, officerName: string, agency: string }`
  - Jika `type` adalah `RESOLVED`: `{ resolutionId: ObjectId, notes: string }`
  - Jika `type` adalah `DETECTION`: `{ confidence: number, camera: string }`
- `requestId` (String)
- `traceId` (String)
- `correlationId` (String): Mengidentifikasi seluruh siklus alur insiden dari hulu ke hilir.
- `ipAddress` (String)
- `userAgent` (String)
- `createdAt` (Date)

### C. Koleksi `assignments`
Mencatat sejarah penugasan petugas kebersihan sungai.
- `_id` (ObjectId)
- `reportId` (ObjectId, ref: 'Report')
- `officerId` (ObjectId, ref: 'User')
- `officerName` (String)
- `agency` (String)
- `assignedById` (ObjectId, ref: 'User')
- `assignedByName` (String)
- `assignedAt` (Date)
- `endedAt` (Date | null)
- `status` (String): e.g. `'ASSIGNED'`, `'ON_SITE'`, `'IN_PROGRESS'`, `'COMPLETED'`, `'CANCELLED'`, `'REASSIGNED'`.

### D. Koleksi `resolutions`
Mencatat berkas pengajuan penutupan kasus beserta bukti foto sesudah pembersihan.
- `_id` (ObjectId)
- `reportId` (ObjectId, ref: 'Report')
- `isCleaned` (Boolean)
- `fieldNotes` (String)
- `completedAt` (Date)
- `officerId` (ObjectId, ref: 'User')
- `officerName` (String)
- `resolvedById` (ObjectId, ref: 'User')
- `resolvedByName` (String)
- `status` (String): Status resolusi (`PENDING` | `APPROVED` | `REJECTED`).
- `afterImages` (Array of Attachment):
  - `name` (String)
  - `url` (String)
  - `storageKey` (String): Key unik file di object storage (e.g., `reports/2026/07/report-58/after/1.jpg`) agar independen dari domain URL.
  - `mimeType` (String)
  - `size` (Number)
  - `sha256` (String): Checksum berkas.
  - `checksumAlgorithm` (String, default: `'SHA256'`): Mendukung pergantian algoritma checksum di masa depan (e.g. SHA512).
  - `storage` (String): `'LOCAL'` | `'S3'` | `'MINIO'`.
  - `imageWidth` (Number | null)
  - `imageHeight` (Number | null)
  - `thumbnailUrl` (String | null)
  - `virusScanStatus` (String): `'CLEAN'` | `'INFECTED'` | `'UNSCANNED'`.
- `approvedAt` (Date | null)
- `approvedById` (ObjectId, ref: 'User' | null)
- `approvedByName` (String | null)
- `approvedByRole` (String | null)

### E. Koleksi `notifications`
Mendukung notifikasi kaya metadata untuk mempermudah integrasi UI:
- `_id` (ObjectId)
- `recipientId` (ObjectId, ref: 'User')
- `reportId` (ObjectId, ref: 'Report')
- `type` (String)
- `title` (String)
- `message` (String)
- `actionUrl` (String)
- `icon` (String)
- `priority` (String): `LOW` | `MEDIUM` | `HIGH`.
- `read` (Boolean, default: false)
- `readAt` (Date | null)
- `createdAt` (Date)
- `expiresAt` (Date): TTL index MongoDB untuk menghapus notifikasi usang secara otomatis dari database.
- `deletedAt` (Date | null)

### F. Koleksi `outbox_events` (Transactional Outbox Pattern)
Menyimpan event yang siap dipublikasikan. Disimpan di database dalam transaksi yang sama dengan modifikasi data bisnis untuk menjamin pengiriman notifikasi/event 100% konsisten meskipun server mati:
- `_id` (ObjectId)
- `aggregateType` (String): e.g., "Incident"
- `aggregateId` (String): ID Laporan
- `eventType` (String): e.g., "IncidentAssignedEvent"
- `payload` (Object): Detail data event.
- `status` (String): `'PENDING'` | `'PROCESSED'` | `'FAILED'`.
- `createdAt` (Date)
- `processedAt` (Date | null)

### G. Koleksi `system_audit_logs`
Mencatat aktivitas sistem di luar insiden spesifik untuk audit keamanan internal:
- `_id` (ObjectId)
- `tenantId` (String, Index)
- `actorId` (ObjectId, ref: 'User' | null)
- `actorName` (String)
- `action` (String)
- `ipAddress` (String)
- `userAgent` (String)
- `details` (Object)
- `createdAt` (Date)

### H. Koleksi `telegram_delivery_logs`
Mencatat riwayat dan status pengiriman notifikasi via Telegram Bot untuk auditibilitas:
- `_id` (ObjectId)
- `reportId` (ObjectId, ref: 'Report', Index)
- `outboxEventId` (ObjectId, ref: 'OutboxEvent', Index)
- `chatId` (String)
- `telegramMessageId` (Number | null): ID pesan unik yang dikembalikan oleh Telegram Bot API untuk mendukung thread reply.
- `deliveryStatus` (String): `'SUCCESS'` | `'FAILED'` | `'PENDING'`.
- `retryCount` (Number, default: 0)
- `errorMessage` (String | null)
- `createdAt` (Date)

---

## 3. Finite State Machine (FSM) Berbasis Konfigurasi
Sistem memvalidasi seluruh perpindahan status berdasarkan aturan transisi data konfigurasi terpusat (FSM):

```typescript
interface ITransitionRule {
  from: string;
  to: string;
  allowedRoles: string[];
}

const TRANSITION_RULES: ITransitionRule[] = [
  { from: 'NEW', to: 'UNDER_REVIEW', allowedRoles: ['operator', 'admin'] },
  { from: 'UNDER_REVIEW', to: 'VALIDATED', allowedRoles: ['operator', 'admin'] },
  { from: 'UNDER_REVIEW', to: 'REJECTED', allowedRoles: ['operator', 'admin'] },
  { from: 'VALIDATED', to: 'ASSIGNED', allowedRoles: ['operator', 'admin'] },
  { from: 'ASSIGNED', to: 'ON_SITE', allowedRoles: ['officer', 'operator', 'admin'] },
  { from: 'ASSIGNED', to: 'REASSIGNED', allowedRoles: ['operator', 'admin'] },
  { from: 'ON_SITE', to: 'IN_PROGRESS', allowedRoles: ['officer', 'operator', 'admin'] },
  { from: 'IN_PROGRESS', to: 'WAITING_APPROVAL', allowedRoles: ['officer', 'operator', 'admin'] },
  { from: 'WAITING_APPROVAL', to: 'CLOSED', allowedRoles: ['supervisor', 'admin'] },
  { from: 'WAITING_APPROVAL', to: 'IN_PROGRESS', allowedRoles: ['supervisor', 'admin'] }
];
```

---

## 4. Otorisasi Berbasis Peran & Kepemilikan (RBAC + Ownership)
Otorisasi tidak hanya membatasi aksi berdasarkan Role saja, melainkan mencakup kepemilikan objek (*Ownership*):

| Aksi | Peran Diizinkan (Role) | Aturan Kepemilikan (Ownership Rule) |
| :--- | :--- | :--- |
| **VALIDATE** | `operator`, `admin` | Tidak ada batasan kepemilikan. |
| **ASSIGN** | `operator`, `admin` | Tidak ada batasan kepemilikan. |
| **UPDATE_OFFICER** | `officer`, `operator`, `admin` | Jika `officer`, ID user login harus sama dengan `officerId` pada assignment aktif di laporan tersebut. |
| **RESOLVE** | `officer`, `admin` | Jika `officer`, ID user login harus sama dengan `officerId` pada assignment aktif di laporan tersebut. |
| **APPROVE_CLOSE** | `supervisor`, `admin` | Tidak ada batasan kepemilikan. |
| **SOFT_DELETE** | `admin` | Tidak ada batasan kepemilikan. |

---

## 5. Strategi Indexing & Optimasi Query (Sorted Compound Indexes)

| Koleksi | Field Indeks | Jenis Indeks | Alasan Penggunaan |
| :--- | :--- | :--- | :--- |
| `reports` | `id` | Single, Unique | Mempercepat pencarian data tunggal berdasarkan ID eksternal. |
| `reports` | `status`, `timestamp` | Compound | Mempercepat query antrean laporan aktif (Incident Queue). |
| `timeline_events` | `reportId`, `createdAt` | Compound (Sorting Desc) | Mempercepat penyajian urutan kronologis timeline terbaru (`createdAt: -1`). |
| `assignments` | `reportId`, `endedAt` | Compound | Mempercepat pencarian tugas penugasan aktif (`endedAt: null`). |
| `notifications` | `recipientId`, `read`, `createdAt` | Compound (Sorting Desc) | Mempercepat pembacaan notifikasi unread di lonceng notifikasi header secara kronologis. |
| `notifications` | `expiresAt` | TTL Index | Menghapus notifikasi secara otomatis saat kedaluwarsa. |
| `telegram_delivery_logs` | `reportId`, `outboxEventId` | Compound | Mempercepat audit log pengiriman per kejadian insiden. |

---

## 6. Penanganan Transaksi & Transactional Outbox Pattern
Setiap aksi penulisan data yang memengaruhi lebih dari satu koleksi wajib dibungkus dalam **MongoDB Session Transaction**:
1. Mulai sesi transaksi.
2. Lakukan update status `Report` (dan periksa optimistic versioning `__v`).
3. Buat/Update rekaman `Assignment` atau `Resolution`.
4. Tambahkan immutable `TimelineEvent`.
5. Hubungkan `currentAssignmentId` or `currentResolutionId` baru ke model `Report`.
6. Simpan event ke koleksi `outbox_events` berstatus `'PENDING'`.
7. Commit transaksi. Jika gagal di tengah jalan, jalankan *rollback*.
8. **Outbox Worker Process** (asinkronus) memindai koleksi `outbox_events` berstatus `'PENDING'`, memicu Domain Event untuk memperbarui status notifikasi/WebSocket ke frontend dan mengirim notifikasi Telegram (jika aktif), lalu memperbarui status outbox menjadi `'PROCESSED'`.

---

## 7. Struktur Penyimpanan File
Berkas terunggah disimpan di folder dengan pengelompokan yang rapi dan aman:
```text
public/uploads/reports/[tahun]/[bulan]/report-[id]/
├── before/               <-- Foto awal AI / Pelapor
├── after/                <-- Foto pembersihan dari lapangan
└── docs/                 <-- Lampiran administrasi/surat tugas
```
Setiap berkas dihitung nilai SHA-256 checksum-nya untuk keperluan verifikasi integritas data audit.

---

## 8. Multi Channel Notification Architecture

EYECO mendukung pengiriman notifikasi melalui beberapa saluran (channel) secara asinkronus tanpa mencampuri logika bisnis utama di Incident Service.

```
                    Domain Event
                          │
                          ▼
                Notification Dispatcher
         ┌──────────────┬───────────────┬──────────────┐
         ▼              ▼               ▼
   Web Notification   Telegram Bot   Future (Email/WA)
```

### A. Notification Channel Enum
```typescript
enum NotificationChannel {
  WEB = 'WEB',
  TELEGRAM = 'TELEGRAM',
  EMAIL = 'EMAIL',
  WHATSAPP = 'WHATSAPP'
}
```

### B. Telegram Configuration
Pengaturan notifikasi Telegram disimpan di database (koleksi konfigurasi sistem) dan dikontrol melalui dashboard operator:
```json
{
  "telegram": {
    "enabled": true,
    "chatId": "-100123456789",
    "parseMode": "HTML",
    "notifyOn": {
      "detection": true,
      "validated": true,
      "assigned": true,
      "resolved": true,
      "closed": true
    }
  }
}
```

### C. Alur Pengiriman melalui Outbox Worker
1. Transaksi bisnis menyisipkan event berstatus `'PENDING'` ke `outbox_events`.
2. Outbox Worker memindai event `'PENDING'`.
3. Worker memverifikasi apakah `telegram.enabled` bernilai `true` dan tipe event terdaftar pada `notifyOn`.
4. Jika ya, Worker memanggil `TelegramNotificationService` secara asinkronus.
5. Jika Telegram Bot API sukses mengirim pesan, detail message ID disimpan ke `telegram_delivery_logs` berstatus `'SUCCESS'`.
6. Jika Telegram API down atau timeout, Worker memperbarui status log menjadi `'FAILED'`, merekam error message, dan melakukan retry secara terjadwal tanpa mengganggu penyimpanan laporan utama.
