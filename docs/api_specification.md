# EYECO Incident Management V3 - API Specification
## Kontrak API & Spesifikasi Integrasi (Updated)

Dokumen ini mendefinisikan kontrak API formal antara frontend (Decision Workspace) dan backend (Core Service) EYECO. Semua API harus mematuhi standar respon dan otorisasi yang telah ditetapkan.

---

## 1. Standar Header & Metadata

Setiap request HTTP wajib menyertakan atau menghasilkan metadata penelusuran (tracing) di middleware:

- `X-Request-Id`: ID unik untuk melacak daur hidup satu HTTP request (contoh: `req_847128adbc`).
- `X-Trace-Id`: ID unik untuk melacak transaksi terdistribusi (contoh: `tr_91283adbf72381`).
- `X-Correlation-Id`: ID unik untuk melacak seluruh siklus alur insiden dari deteksi awal hingga penutupan kasus.

---

## 2. Format Respon Standar

### A. Respon Sukses (Standard Success Response)
Status HTTP: `200 OK` atau `201 Created`
```json
{
  "success": true,
  "message": "Detail pesan keberhasilan aksi.",
  "data": {},
  "meta": {
    "requestId": "req_847128adbc",
    "traceId": "tr_91283adbf72381",
    "correlationId": "corr_72849bca7e"
  }
}
```

### B. Respon Gagal (Standard Error Response)
Status HTTP: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, atau `500 Internal Server Error`
```json
{
  "success": false,
  "error": {
    "code": "KODE_ERROR_SISTEM",
    "message": "Pesan deskripsi kesalahan yang mudah dipahami oleh pengguna.",
    "details": {}
  },
  "meta": {
    "requestId": "req_847128adbc"
  }
}
```

---

## 3. Daftar Endpoint API

### A. Validasi Laporan (Verify/Validate)
Mengubah status laporan pasca deteksi awal.

- **URL**: `/api/incidents/:id/validate`
- **Method**: `POST`
- **Otorisasi**: `operator`, `admin`
- **Aturan Transisi FSM**: `NEW` ──> `UNDER_REVIEW` ──> `VALIDATED` atau `REJECTED`
- **Request Body**:
  ```json
  {
    "isValid": true,
    "notes": "Laporan tumpukan sampah plastik terkonfirmasi valid dan membutuhkan penanganan segera."
  }
  ```
- **Response Data (`data`)**:
  ```json
  {
    "incidentId": 58,
    "status": "VALIDATED",
    "validatedAt": "2026-07-01T14:55:00.000Z"
  }
  ```

---

### B. Penunjukan Petugas (Assign)
Menugaskan petugas kebersihan sungai ke lokasi insiden.

- **URL**: `/api/incidents/:id/assign`
- **Method**: `POST`
- **Otorisasi**: `operator`, `admin`
- **Aturan Transisi FSM**: `VALIDATED` ──> `ASSIGNED`
- **Request Body**:
  ```json
  {
    "officerId": "60b8d2f1f1a2c34d5e6f7a8b"
  }
  ```
- **Response Data (`data`)**:
  ```json
  {
    "incidentId": 58,
    "assignmentId": "60b8d34af1a2c34d5e6f7a8c",
    "officerName": "Andre Wijaya",
    "status": "ASSIGNED",
    "assignedAt": "2026-07-01T14:58:00.000Z"
  }
  ```

---

### C. Konfirmasi Tiba di Lokasi (Arrive)
Konfirmasi kedatangan petugas kebersihan di lapangan.

- **URL**: `/api/incidents/:id/arrive`
- **Method**: `POST`
- **Otorisasi**: `officer`, `operator`, `admin`
- **Aturan Kepemilikan (Ownership)**: Jika `officer`, ID pengguna harus cocok dengan `officerId` pada assignment aktif untuk laporan ini.
- **Aturan Transisi FSM**: `ASSIGNED` ──> `ON_SITE` ──> `IN_PROGRESS`
- **Request Body**: `{}`
- **Response Data (`data`)**:
  ```json
  {
    "incidentId": 58,
    "status": "ON_SITE",
    "arrivedAt": "2026-07-01T15:05:00.000Z"
  }
  ```

---

### D. Pengajuan Resolusi/Penyelesaian (Resolve)
Mengirimkan bukti hasil pembersihan sampah sungai berupa foto dan laporan tertulis.

- **URL**: `/api/incidents/:id/resolve`
- **Method**: `POST`
- **Otorisasi**: `officer`, `admin`
- **Aturan Kepemilikan (Ownership)**: Jika `officer`, ID pengguna harus cocok dengan `officerId` pada assignment aktif untuk laporan ini.
- **Aturan Transisi FSM**: `IN_PROGRESS` ──> `WAITING_APPROVAL`
- **Content-Type**: `multipart/form-data`
- **Request Body**:
  - `fieldNotes` (String): Deskripsi pengerjaan di lapangan.
  - `afterImages` (Files): Berkas foto kondisi setelah dibersihkan (minimal 1 foto).
- **Response Data (`data`)**:
  ```json
  {
    "incidentId": 58,
    "resolutionId": "60b8d52af1a2c34d5e6f7a8d",
    "status": "WAITING_APPROVAL",
    "completedAt": "2026-07-01T15:45:00.000Z"
  }
  ```

---

### E. Persetujuan Penyelesaian (Approve/Close)
Menutup laporan secara permanen atau menolaknya kembali ke lapangan.

- **URL**: `/api/incidents/:id/approve`
- **Method**: `POST`
- **Otorisasi**: `supervisor`, `admin`
- **Aturan Transisi FSM**:
  - Jika disetujui: `WAITING_APPROVAL` ──> `CLOSED`
  - Jika ditolak: `WAITING_APPROVAL` ──> `IN_PROGRESS`
- **Request Body**:
  ```json
  {
    "isApproved": true,
    "notes": "Pembersihan selesai dengan sangat bersih dan sesuai standar operasional."
  }
  ```
- **Response Data (`data`)**:
  ```json
  {
    "incidentId": 58,
    "status": "CLOSED",
    "approvedAt": "2026-07-01T16:00:00.000Z"
  }
  ```

---

### F. Riwayat Timeline Insiden (Get Timeline)
Mengambil seluruh kronologi aktivitas yang terjadi pada insiden secara urut waktu terbalik (descending).

- **URL**: `/api/incidents/:id/timeline`
- **Method**: `GET`
- **Otorisasi**: `admin`, `operator`, `supervisor`, `officer`
- **Response Data (`data`)**:
  ```json
  [
    {
      "eventId": "60b8d601f1a2c34d5e6f7a8e",
      "type": "CLOSED",
      "actorName": "Budi Santoso",
      "actorRole": "supervisor",
      "title": "Kasus Ditutup",
      "description": "Laporan telah disetujui dan ditutup. Catatan: Pembersihan selesai dengan sangat bersih.",
      "createdAt": "2026-07-01T16:00:00.000Z"
    },
    {
      "eventId": "60b8d52af1a2c34d5e6f7a8d",
      "type": "RESOLVED",
      "actorName": "Andre Wijaya",
      "actorRole": "officer",
      "title": "Resolusi Diajukan",
      "description": "Petugas mengajukan penyelesaian dengan catatan: Semua sampah plastik diangkat.",
      "createdAt": "2026-07-01T15:45:00.000Z"
    }
  ]
  ```

---

### G. Perbarui Pengaturan Telegram (Update Telegram Configuration)
Mengubah toggle aktif/nonaktif bot Telegram atau memodifikasi ID Chat target pengiriman notifikasi dari dashboard secara dinamis.

- **URL**: `/api/system/settings/telegram`
- **Method**: `PATCH`
- **Otorisasi**: `admin`, `operator`
- **Request Body**:
  ```json
  {
    "enabled": true,
    "chatId": "-100123456789",
    "notifyOn": {
      "detection": true,
      "validated": true,
      "assigned": true,
      "resolved": true,
      "closed": true
    }
  }
  ```
- **Response Data (`data`)**:
  ```json
  {
    "enabled": true,
    "chatId": "-100123456789",
    "updatedAt": "2026-07-01T15:00:00.000Z"
  }
  ```
