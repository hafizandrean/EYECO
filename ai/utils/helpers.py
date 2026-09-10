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
    show_hud: bool = False,
    camera_label: str = "EYECO CCTV AI",
) -> np.ndarray:
    """
    Gambar bounding box berstandar profesional dan label pada gambar.
    Menggunakan palet warna berbasis kategori, background badge solid,
    corner brackets ala VMS modern, dan font adaptif.

    Args:
        image: Gambar asli (BGR, numpy array).
        detections: List deteksi [{class_id, confidence, bbox, class_name}].
        class_names: Mapping class_id -> nama class (optional).
        show_hud: Jika True, tambahkan watermark HUD status di pojok atas.
        camera_label: Label nama kamera untuk HUD.

    Returns:
        Gambar dengan annotation (numpy array).
    """
    annotated = image.copy()
    h, w = annotated.shape[:2]

    # Skala adaptif berdasarkan resolusi gambar
    scale = max(0.45, min(w, h) / 1000.0)
    font_scale = max(0.4, 0.45 * scale)
    line_thickness = max(1, int(2 * scale))
    corner_length = max(8, int(15 * scale))

    # Palet warna BGR berbasis kategori
    CATEGORY_COLORS = {
        "person": (235, 99, 37),      # Biru Cyber
        "trash": (68, 68, 239),       # Merah Bahaya
        "sampah": (68, 68, 239),      # Merah Bahaya
        "plastic": (68, 68, 239),     # Merah Bahaya
        "bottle": (68, 68, 239),      # Merah Bahaya
        "boat": (212, 182, 6),        # Cyan / Teal
        "perahu": (212, 182, 6),      # Cyan / Teal
        "car": (8, 179, 234),         # Kuning / Oranye
        "motorcycle": (8, 179, 234),  # Kuning / Oranye
    }
    DEFAULT_COLOR = (180, 163, 148)   # Slate

    trash_count = 0
    person_count = 0

    for det in detections:
        bbox = det.get("bbox", [0, 0, 0, 0])
        x1, y1, x2, y2 = map(int, bbox)
        conf = float(det.get("confidence", 0.9))
        cls_id = det.get("class_id", -1)
        raw_name = det.get("class_name") or det.get("class") or (class_names.get(cls_id) if class_names else f"class_{cls_id}")
        cls_name = str(raw_name).strip()
        cls_lower = cls_name.lower()

        # Tentukan warna
        color = DEFAULT_COLOR
        for cat, col in CATEGORY_COLORS.items():
            if cat in cls_lower:
                color = col
                break

        if "trash" in cls_lower or "sampah" in cls_lower or "plastic" in cls_lower or "bottle" in cls_lower:
            trash_count += 1
        elif "person" in cls_lower or "orang" in cls_lower:
            person_count += 1

        # 1. Bounding box border
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, line_thickness)

        # 2. Corner bracket accents (Modern Surveillance Look)
        cl = min(corner_length, (x2 - x1) // 3, (y2 - y1) // 3)
        if cl > 2:
            accent_color = (255, 255, 255)
            # Top-Left
            cv2.line(annotated, (x1, y1), (x1 + cl, y1), accent_color, line_thickness + 1)
            cv2.line(annotated, (x1, y1), (x1, y1 + cl), accent_color, line_thickness + 1)
            # Top-Right
            cv2.line(annotated, (x2, y1), (x2 - cl, y1), accent_color, line_thickness + 1)
            cv2.line(annotated, (x2, y1), (x2, y1 + cl), accent_color, line_thickness + 1)
            # Bottom-Left
            cv2.line(annotated, (x1, y2), (x1 + cl, y2), accent_color, line_thickness + 1)
            cv2.line(annotated, (x1, y2), (x1, y2 - cl), accent_color, line_thickness + 1)
            # Bottom-Right
            cv2.line(annotated, (x2, y2), (x2 - cl, y2), accent_color, line_thickness + 1)
            cv2.line(annotated, (x2, y2), (x2, y2 - cl), accent_color, line_thickness + 1)

        # 3. Label Badge
        conf_pct = f"{int(conf * 100 if conf <= 1.0 else conf)}%"
        label_text = f"{cls_name.upper()} {conf_pct}"
        (tw, th), baseline = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)

        badge_h = th + baseline + 6
        badge_y1 = max(0, y1 - badge_h)
        badge_y2 = y1 if badge_y1 > 0 else y1 + badge_h

        # Label background
        cv2.rectangle(
            annotated,
            (x1, badge_y1),
            (x1 + tw + 10, badge_y2),
            color,
            -1,
        )

        # Label text
        text_y = badge_y2 - baseline - 2 if badge_y1 > 0 else badge_y2 - 3
        cv2.putText(
            annotated,
            label_text,
            (x1 + 5, text_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

    if show_hud:
        annotated = draw_hud_watermark(
            annotated,
            camera_name=camera_label,
            total_objects=len(detections),
            trash_count=trash_count,
            person_count=person_count,
        )

    return annotated


def draw_pose_skeleton(
    image: np.ndarray,
    keypoints: list[list[float]] | np.ndarray,
    color: tuple = (0, 255, 128),
    point_color: tuple = (0, 200, 255),
    min_conf: float = 0.4,
) -> np.ndarray:
    """
    Gambar skeleton sendi manusia (Pose Estimation) dari model YOLO Pose (Adopsi File Pose Reference).

    Args:
        image: Frame gambar (BGR, numpy array).
        keypoints: List koordinat sendi [[x, y, conf], ...] atau [[x, y], ...].
        color: Warna garis tulang skeleton (BGR).
        point_color: Warna lingkaran sendi (BGR).
        min_conf: Keyakinan minimal per sendi untuk digambar.

    Returns:
        Frame gambar dengan skeleton (numpy array).
    """
    annotated = image.copy()
    h, w = annotated.shape[:2]

    # Koneksi sendi standar YOLOv8/v11 Pose
    SKELETON_PAIRS = [
        (0, 1), (0, 2), (1, 3), (2, 4),            # Facial / Head
        (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),   # Shoulders & Arms (Gerakan Tangan)
        (5, 11), (6, 12), (11, 12),                # Torso / Badan
        (11, 13), (13, 15), (12, 14), (14, 16)     # Legs / Kaki
    ]

    pts = []
    for kp in keypoints:
        if len(kp) >= 3:
            kx, ky, kc = float(kp[0]), float(kp[1]), float(kp[2])
        else:
            kx, ky, kc = float(kp[0]), float(kp[1]), 1.0

        # Normalisasi koordinat jika dalam range 0-1
        if kx <= 1.0 and ky <= 1.0:
            kx *= w
            ky *= h

        pts.append((int(kx), int(ky), kc))

    # 1. Gambar garis koneksi antar sendi
    for p1_idx, p2_idx in SKELETON_PAIRS:
        if p1_idx < len(pts) and p2_idx < len(pts):
            x1, y1, c1 = pts[p1_idx]
            x2, y2, c2 = pts[p2_idx]
            if c1 >= min_conf and c2 >= min_conf and x1 > 0 and y1 > 0 and x2 > 0 and y2 > 0:
                cv2.line(annotated, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)

    # 2. Gambar lingkaran sendi
    for px, py, pc in pts:
        if pc >= min_conf and px > 0 and py > 0:
            cv2.circle(annotated, (px, py), 4, point_color, -1, cv2.LINE_AA)
            cv2.circle(annotated, (px, py), 5, (255, 255, 255), 1, cv2.LINE_AA)

    return annotated


def generate_density_heatmap(
    image: np.ndarray,
    detections: list[dict[str, Any]],
    radius: int = 35,
    blur_kernel: int = 21,
    alpha: float = 0.35,
) -> np.ndarray:
    """
    Buat visualisasi Peta Panas (Heatmap) akumulasi kepadatan deteksi (Adopsi File Referensi 1).

    Args:
        image: Gambar dasar (BGR, numpy array).
        detections: List deteksi [{bbox: [x1, y1, x2, y2], ...}].
        radius: Jari-jari lingkaran panas per deteksi.
        blur_kernel: Ukuran kernel Gaussian blur untuk kehalusan heatmap.
        alpha: Tingkat transparansi overlay heatmap (0.0 - 1.0).

    Returns:
        Gambar hasil percampuran heatmap transparan (numpy array).
    """
    h, w = image.shape[:2]
    heatmap = np.zeros((h, w), dtype=np.float32)

    has_points = False
    for det in detections:
        bbox = det.get("bbox", [0, 0, 0, 0])
        x1, y1, x2, y2 = map(int, bbox)
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        if 0 <= cx < w and 0 <= cy < h:
            cv2.circle(heatmap, (cx, cy), radius, 1.0, -1)
            has_points = True

    if not has_points:
        return image.copy()

    # Smooth heatmap dengan Gaussian Blur
    ksize = blur_kernel if blur_kernel % 2 == 1 else blur_kernel + 1
    heat_blur = cv2.GaussianBlur(heatmap, (ksize, ksize), 0)

    # Normalize ke range 0 - 255
    heat_norm = cv2.normalize(heat_blur, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    # Apply Colormap JET (Biru -> Hijau -> Kuning -> Merah)
    heat_color = cv2.applyColorMap(heat_norm, cv2.COLORMAP_JET)

    # Blend transparan di atas frame asli
    blended = cv2.addWeighted(image, 1.0 - alpha, heat_color, alpha, 0)
    return blended


def draw_hud_watermark(
    image: np.ndarray,
    camera_name: str = "EYECO CCTV AI",
    fps: float | None = None,
    total_objects: int = 0,
    trash_count: int = 0,
    person_count: int = 0,
) -> np.ndarray:
    """
    Render live HUD chip watermark di pojok atas video / snapshot bukti.
    """
    annotated = image.copy()
    h, w = annotated.shape[:2]
    import datetime

    timestamp_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # HUD Bar Text
    hud_text = f"● LIVE | {camera_name} | {timestamp_str}"
    if fps is not None:
        hud_text += f" | {fps:.1f} FPS"
    hud_text += f" | Total: {total_objects} (Sampah: {trash_count}, Orang: {person_count})"

    font_scale = max(0.4, min(w, h) / 1600.0)
    (tw, th), baseline = cv2.getTextSize(hud_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)

    # Background banner semi-transparan
    overlay = annotated.copy()
    cv2.rectangle(overlay, (10, 10), (tw + 26, th + 24), (15, 23, 42), -1)
    cv2.addWeighted(overlay, 0.75, annotated, 0.25, 0, annotated)

    # Border tipis
    cv2.rectangle(annotated, (10, 10), (tw + 26, th + 24), (70, 85, 105), 1)

    # Teks HUD
    status_color = (68, 68, 239) if trash_count > 0 else (90, 220, 90)
    cv2.putText(
        annotated,
        hud_text,
        (18, 16 + th),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale,
        (240, 245, 250),
        1,
        cv2.LINE_AA,
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


def crop_and_save_detections(
    image: np.ndarray,
    detections: list[dict[str, Any]],
    output_dir: str | Path,
    min_conf: float = 0.75,
    prefix: str = "crop",
) -> list[str]:
    """
    Auto-crop objek deteksi berkeyakinan tinggi untuk Dataset Continual Learning (Adopsi Pose/Dataset Reference).

    Args:
        image: Frame gambar (BGR, numpy array).
        detections: List deteksi [{bbox, class, confidence}].
        output_dir: Folder tujuan penyimpanan crop.
        min_conf: Ambang batas keyakinan minimal untuk dipanen.
        prefix: Awalan nama file crop.

    Returns:
        List path file gambar hasil crop yang disimpan.
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    saved_files = []
    h, w = image.shape[:2]

    for idx, det in enumerate(detections):
        conf = float(det.get("confidence", 0.0))
        if conf < min_conf:
            continue

        bbox = det.get("bbox", [0, 0, 0, 0])
        x1, y1, x2, y2 = map(int, bbox)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        if (x2 - x1) < 15 or (y2 - y1) < 15:
            continue

        crop = image[y1:y2, x1:x2]
        cls_name = str(det.get("class", "object")).replace(" ", "_").lower()
        import time as pytime
        filename = f"{prefix}_{cls_name}_{int(pytime.time() * 1000)}_{idx}.jpg"
        target_file = str(out_path / filename)

        if cv2.imwrite(target_file, crop):
            saved_files.append(target_file)

    return saved_files


def timer_ms(start: float, end: float) -> float:
    """Hitung selisih waktu dalam milidetik."""
    return round((end - start) * 1000, 2)
