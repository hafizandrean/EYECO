"""
EYECO AI — Modul Deteksi YOLOv8

Modul ini menyediakan pipeline inferensi YOLOv8 untuk
mendeteksi aktivitas mencurigakan di sungai menggunakan
CCTV. Dirancang untuk dipanggil dari backend Node.js
via child_process.spawn.

Struktur:
    ai/
    ├── __init__.py          # Package init
    ├── requirements.txt     # Python dependencies
    ├── detect.py            # Entrypoint: CLI inferensi
    ├── models/              # Tempat best.pt dan model lainnya
    ├── uploads/             # Input: gambar/video dari user/CCTV
    ├── output/              # Output: hasil deteksi (annotated)
    └── utils/
        ├── __init__.py
        └── helpers.py       # Fungsi utilitas
"""

__version__ = "1.0.0"
