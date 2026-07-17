"""
EYECO AI — Utility Functions

Berisi helper untuk encoding gambar, drawing bounding box,
dan validasi file input.
"""

from __future__ import annotations

import base64
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class DetectionResult:
    """Hasil deteksi terstruktur untuk dikembalikan ke Node.js."""

    success: bool = True
    error: str | None = None
    source: str = ""
    source_type: str = ""  # "image" | "video"
    detections: list[dict[str, Any]] = field(default_factory=list)
    total_detections: int = 0
    processing_time_ms: float = 0.0
    image_width: int = 0
    image_height: int = 0
    output_path: str | None = None

    def to_json(self) -> str:
        """Serialize ke JSON string menggunakan orjson jika tersedia, fallback ke json."""
        try:
            import orjson

            return orjson.dumps(
                asdict(self),
                option=orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_APPEND_NEWLINE,
            ).decode("utf-8")
        except ImportError:
            import json

            class NumpyEncoder(json.JSONEncoder):
                def default(self, obj: Any) -> Any:
                    if isinstance(obj, (np.integer,)):
                        return int(obj)
                    if isinstance(obj, (np.floating,)):
                        return float(obj)
                    if isinstance(obj, (np.ndarray,)):
                        return obj.tolist()
                    return super().default(obj)

            return json.dumps(asdict(self), cls=NumpyEncoder) + "\n"


# ---------------------------------------------------------------------------
# Image / Video Utilities
# ---------------------------------------------------------------------------

def encode_image_base64(image: np.ndarray, format: str = ".jpg") -> str:
    """
    Encode OpenCV image (numpy array) ke base64 string.

    Args:
        image: HxWxC numpy array (BGR format dari OpenCV).
        format: Ekstensi file untuk format encoding (default .jpg).

    Returns:
        Base64 string dari gambar.
    """
    success, buffer = cv2.imencode(format, image)
    if not success:
        raise ValueError("Gagal encode gambar ke format buffer.")
    return base64.b64encode(buffer).decode("utf-8")


def draw_detections(
    image: np.ndarray,
    detections: list[dict[str, Any]],
    class_names: dict[int, str] | None = None,
) -> np.ndarray:
    """
    Gambar bounding box dan label pada gambar.

    Args:
        image: Gambar asli (BGR, numpy array).
        detections: List deteksi [{class_id, confidence, bbox, class_name}].
        class_names: Mapping class_id -> nama class (optional).

    Returns:
        Gambar dengan annotation (numpy array).
    """
    colors = [
        (37, 99, 235),   # Biru
        (239, 68, 68),   # Merah
        (34, 197, 94),   # Hijau
        (234, 179, 8),   # Kuning
        (168, 85, 247),  # Ungu
        (249, 115, 22),  # Oranye
        (20, 184, 166),  # Teal
        (236, 72, 153),  # Pink
    ]

    annotated = image.copy()

    for i, det in enumerate(detections):
        x1, y1, x2, y2 = det["bbox"]
        conf = det["confidence"]
        cls_id = det.get("class_id", -1)
        cls_name = det.get("class_name", class_names.get(cls_id, f"class_{cls_id}") if class_names else f"class_{cls_id}")

        color = colors[cls_id % len(colors)]

        # Bounding box
        cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)

        # Label background
        label = f"{cls_name} {conf:.2f}"
        (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
        cv2.rectangle(
            annotated,
            (int(x1), int(y1) - label_h - 8),
            (int(x1) + label_w + 12, int(y1)),
            color,
            -1,
        )

        # Label text
        cv2.putText(
            annotated,
            label,
            (int(x1) + 6, int(y1) - 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            2,
        )

    return annotated


def validate_source(source_path: str) -> tuple[str | None, str | None]:
    """
    Validasi path file input untuk inferensi.

    Args:
        source_path: Path ke file gambar atau video.

    Returns:
        Tuple (source_type, error_message).
        source_type: "image" | "video" | None
        error_message: None jika valid, string error jika tidak.
    """
    path = Path(source_path)

    if not path.exists():
        return None, f"File tidak ditemukan: {source_path}"

    if not path.is_file():
        return None, f"Path bukan file: {source_path}"

    # Ekstensi gambar yang didukung
    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    # Ekstensi video yang didukung
    video_exts = {".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".m4v"}

    ext = path.suffix.lower()

    if ext in image_exts:
        return "image", None
    elif ext in video_exts:
        return "video", None
    else:
        return None, f"Format file tidak didukung: {ext}. Gunakan {image_exts | video_exts}"


def ensure_dir(path: str | Path) -> Path:
    """Pastikan direktori exist, buat jika belum."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def timer_ms(start: float, end: float) -> float:
    """Hitung selisih waktu dalam milidetik."""
    return round((end - start) * 1000, 2)
