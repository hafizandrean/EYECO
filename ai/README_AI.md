# EYECO AI — Integrasi YOLOv8

Modul AI untuk deteksi aktivitas mencurigakan di sungai menggunakan **YOLOv8** (Ultralytics). Model mendeteksi objek seperti orang, sampah, perahu, dan aktivitas mencurigakan lainnya dari feed CCTV/gambar yang diupload warga.

---

## 📁 Struktur Folder

```
eyeco/
├── ai/
│   ├── __init__.py           # Package init
│   ├── detect.py             # ★ Entrypoint utama — jalankan inferensi YOLOv8
│   ├── requirements.txt      # Python dependencies
│   ├── models/
│   │   ├── .gitkeep
│   │   └── best.pt           # ← Letakkan model hasil training di sini
│   ├── uploads/              # Input gambar/video dari backend (auto)
│   │   └── .gitkeep
│   └── output/               # Output annotated images (optional)
│       └── .gitkeep
└── src/
    └── services/
        └── aiDetection.service.ts   # ★ Service TypeScript — spawn Python + parse
```

---

## 🛠️ Instalasi AI

### 1. Install Python 3.9+

Pastikan Python tersedia:

```bash
python3 --version
# Output: Python 3.9.x atau lebih baru
```

### 2. Buat Virtual Environment (recommended)

```bash
cd eyeco
python3 -m venv ai/venv
source ai/venv/bin/activate
```

> Di Windows: `ai\venv\Scripts\activate`

### 3. Install Dependencies

```bash
pip install -r ai/requirements.txt
```

Dependencies utama:
- **ultralytics** — YOLOv8 framework
- **opencv-python-headless** — image processing (server-safe, tanpa GUI)
- **numpy** — numerical computation
- **Pillow** — image utilities

> **GPU Support**: Jika punya GPU NVIDIA, install CUDA version of PyTorch:
> ```bash
> pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
> ```
> Untuk Apple Silicon (M1/M2/M3), PyTorch sudah support MPS secara otomatis.

### 4. Letakkan Model

Salin file **best.pt** hasil training ke:

```
ai/models/best.pt
```

---

## 🚀 Menjalankan detect.py Manual

```bash
# Deteksi gambar
python3 ai/detect.py path/to/image.jpg

# Deteksi dengan threshold confidence khusus
python3 ai/detect.py path/to/image.jpg --conf 0.5

# Deteksi video
python3 ai/detect.py path/to/video.mp4

# Video dengan batas frame
python3 ai/detect.py path/to/video.mp4 --max-frames 100

# Warmup (load model + dummy inference) — untuk testing
python3 ai/detect.py --warmup
```

### Contoh Output

```json
{
  "success": true,
  "detections": [
    {
      "class": "littering",
      "confidence": 0.9345,
      "bbox": [120.5, 210.3, 350.2, 480.1]
    },
    {
      "class": "person",
      "confidence": 0.8712,
      "bbox": [45.2, 100.8, 180.4, 400.6]
    }
  ],
  "totalDetections": 2,
  "processingTimeMs": 342.18,
  "imageWidth": 1280,
  "imageHeight": 720
}
```

Output selalu **JSON ke stdout** — siap dibaca oleh backend.

### Error Output

Jika terjadi error, `success: false` dan pesan error di field `error`:

```json
{
  "success": false,
  "error": "File tidak ditemukan: path/to/nonexistent.jpg",
  "detections": [],
  "totalDetections": 0
}
```

---

## 🔌 Cara Backend Memanggil Python

Backend Node.js memanggil Python melalui `child_process.spawn` yang dienkapsulasi di **`src/services/aiDetection.service.ts`**.

Flow:
1. User upload gambar/video → endpoint `POST /api/reports/detections`
2. File disimpan ke `public/uploads/`
3. Service **detectFile()** spawn Python dengan path file tsb
4. Python mengembalikan JSON via stdout
5. Service mengonversi YOLO bboxes ke format Report (persentase)
6. Hasil disimpan ke database bersama report

### Kode contoh:

```typescript
import { detectFile, warmupAI, isAiReady } from '../services/aiDetection.service';

// Warmup saat server start (dijalankan otomatis)
await warmupAI();

// Deteksi file
const result = await detectFile('/path/to/image.jpg');
// result = { status: 'TINGGI'|'SEDANG'|'RENDAH'|'Tidak Terindikasi', confidence: 93, boxes: [...] }
```

### Error Handling

- **Model gagal dimuat** → Backend tetap hidup, upload laporan tetap berfungsi. AI mengembalikan status `'Tidak Terindikasi'`.
- **File tidak valid** → Backend mengembalikan error 400 dari multer (tanpa menyentuh AI).
- **Python crash** → Service catch error dan return default safe.

---

## 🧠 Logic Status AI

| Kondisi | Status | Confidence |
|---------|--------|------------|
| Tidak ada deteksi | `Tidak Terindikasi` | `null` |
| Deteksi confidence < 45% | `RENDAH` | maxConf × 100 |
| Deteksi confidence 45-75% | `SEDANG` | maxConf × 100 |
| Deteksi ≥ 75% (≥ 2 objek) | `TINGGI` | maxConf × 100 |
| Deteksi ≥ 75% (kata kunci kritis) | `TINGGI` | maxConf × 100 |

Kata kunci kritis: `littering`, `buang sampah`, `limbah`, `illegal`, `mencurigakan`

---

## 🔄 Mengganti Model

Jika kamu melakukan training ulang dan mendapat model baru:

1. **Training ulang model** — export ke format `.pt`
2. **Ganti file**:
   ```bash
   cp /path/to/new_best.pt ai/models/best.pt
   ```
3. **Restart server** — backend akan auto-load model baru saat startup berikutnya.

Atau simpan model lama:
```bash
mv ai/models/best.pt ai/models/best_old.pt
cp /path/to/new_best.pt ai/models/best.pt
```

Untuk menggunakan model dengan nama berbeda:
```bash
# Python manual
python3 ai/detect.py image.jpg --model ai/models/model_v2.pt

# Backend — update default path di aiDetection.service.ts
# const DEFAULT_MODEL = path.join(AI_DIR, 'models', 'model_v2.pt');
```

---

## 🧪 Testing

```bash
# 1. Test Python langsung
python3 ai/detect.py test.jpg --conf 0.5

# 2. Test warmup
python3 ai/detect.py --warmup

# 3. Build TypeScript
npm run build

# 4. Start server
npm start
# Output: [AI] Model loaded successfully
```

---

## ⚠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| `ModuleNotFoundError: No module named 'ultralytics'` | Jalankan `pip install -r ai/requirements.txt` |
| `Model tidak ditemukan` | Letakkan `best.pt` di `ai/models/` |
| Python tidak ditemukan | Install Python 3.9+, atau set `PYTHON_CMD` di `.env` |
| AI selalu return `Tidak Terindikasi` | Cek confidence threshold (`--conf`), mungkin terlalu tinggi |
| "Killed" / OOM | Model terlalu besar untuk RAM. Gunakan model YOLOv8n (nano) atau batasi ukuran gambar |
| Backend crash saat startup | Cek log `[AI]` — warmup gagal tapi backend tetap jalan |
