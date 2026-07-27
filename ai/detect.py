#!/usr/bin/env python3
"""
EYECO AI — YOLOv8 Inference Engine

Entrypoint CLI untuk menjalankan deteksi YOLOv8.
Didesain untuk dipanggil dari Node.js via child_process.spawn.

Output selalu JSON ke stdout sehingga backend Express bisa langsung parse.
Error ditulis ke stderr agar tidak mengotori stdout JSON.

Usage:
    python3 ai/detect.py /path/to/image.jpg
    python3 ai/detect.py /path/to/video.mp4 --model ai/models/best.pt --conf 0.5
    python3 ai/detect.py /path/to/image.jpg --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import warnings
from pathlib import Path
from typing import Any
import numpy as np


# ---------------------------------------------------------------------------
# JSON Output Builder
# ---------------------------------------------------------------------------

_model_instance = None
_model_class_names: dict[int, str] = {}
_coco_instance = None
_coco_class_names: dict[int, str] = {}


def make_result(
    success: bool,
    detections: list[dict[str, Any]] | None = None,
    total_detections: int = 0,
    error: str | None = None,
    **extra: Any,
) -> str:
    """Buat JSON string output sesuai format yang diminta backend.

    Format inti:
    {
      "success": true,
      "detections": [{ "class": "...", "confidence": 0.xx, "bbox": [x1,y1,x2,y2] }],
      "totalDetections": 0
    }
    """
    result: dict[str, Any] = {
        "success": success,
        "detections": detections or [],
        "totalDetections": total_detections,
    }
    if error:
        result["error"] = error
    # Extra keys (processingTimeMs, imageWidth, dll) dilempar ke output
    result.update(extra)
    return json.dumps(result, default=_json_default)


def _json_default(obj: Any) -> Any:
    """Handle numpy types untuk JSON serialization."""
    import numpy as np

    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.ndarray,)):
        return obj.tolist()
    raise TypeError(f"Type {type(obj)} not JSON serializable")


# ---------------------------------------------------------------------------
# Model Loader (singleton pattern — model dimuat sekali)
# ---------------------------------------------------------------------------

def get_model(model_path: str):
    """Muat model YOLO sekali (singleton). Panggil berkali-kali aman.

    Jika best.pt tidak ditemukan, fallback ke yolov8n.pt (pretrained COCO).
    """
    global _model_instance, _model_class_names

    if _model_instance is not None:
        return _model_instance, _model_class_names

    # Fallback: jika best.pt tidak ada, pakai yolov8n.pt
    resolved_path = model_path
    if not os.path.exists(model_path):
        warnings.warn(f"Model {model_path} tidak ditemukan. Mencoba yolov8n.pt...")
        resolved_path = "yolov8n.pt"
        print(f"[WARN] Model {model_path} tidak ditemukan, fallback ke {resolved_path}",
              file=sys.stderr)

    try:
        from ultralytics import YOLO

        _model_instance = YOLO(resolved_path)
        _model_class_names = _model_instance.names
        return _model_instance, _model_class_names

    except ImportError as e:
        print(
            make_result(
                success=False,
                error=f"Ultralytics tidak terinstall. Jalankan: "
                f"pip install -r ai/requirements.txt. Detail: {e}",
            )
        )
        sys.exit(1)
    except Exception as e:
        print(
            make_result(
                success=False,
                error=f"Gagal memuat model {model_path}: {e}",
            )
        )
        sys.exit(1)


def get_coco_model():
    """Muat COCO (yolov8n.pt) sekali (singleton)."""
    global _coco_instance, _coco_class_names

    if _coco_instance is not None:
        return _coco_instance, _coco_class_names

    try:
        from ultralytics import YOLO

        _coco_instance = YOLO("yolov8n.pt")
        _coco_class_names = _coco_instance.names
        print(f"[AI] COCO model loaded ({len(_coco_class_names)} classes)", file=sys.stderr)
        return _coco_instance, _coco_class_names
    except Exception as e:
        print(f"[WARN] Failed to load COCO model: {e}", file=sys.stderr)
        return None, {}


# ---------------------------------------------------------------------------
# COCO class filter — hanya ambil objek non-sampah yang relevan
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Image Preprocessing (CLAHE + Sharpen) untuk CCTV/image burik
# ---------------------------------------------------------------------------

def preprocess_image(source_path: str, quality_status: str = 'GOOD') -> np.ndarray | None:
    """Tingkatkan kualitas gambar burik (CCTV resolusi rendah, malam, dll).
    
    Pipeline:
    1. CLAHE (Contrast Limited Adaptive Histogram Equalization) — tarik detail
    2. Unsharp Masking — lebih kuat dari sharpen kernel biasa
    3. Denoise ringan — kurangi noise dari sharpening
    4. Upscale untuk CCTV resolusi rendah
    5. Gamma correction untuk gambar gelap
    """
    import cv2
    img = cv2.imread(source_path)
    if img is None:
        return None

    h, w = img.shape[:2]
    is_low_res = max(h, w) < 800
    
    # Konversi ke LAB untuk CLAHE di channel L (lightness)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b_ = cv2.split(lab)
    
    # CLAHE lebih agresif buat gambar burik
    clip_limit = 4.0 if quality_status in ('BLURRY', 'LOW') else 3.0
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8))
    l = clahe.apply(l)
    lab = cv2.merge([l, a, b_])
    img = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    
    # Unsharp Masking (lebih kuat dari sharpen kernel biasa)
    gaussian = cv2.GaussianBlur(img, (0, 0), 2.0)
    strength = 1.8 if quality_status in ('BLURRY', 'LOW') else 1.2
    img = cv2.addWeighted(img, 1.0 + strength, gaussian, -strength, 0)
    
    # Denoise ringan
    img = cv2.fastNlMeansDenoisingColored(img, None, 5, 5, 7, 21)
    
    # Upscale kalo resolusi terlalu kecil (CCTV 640x480 dll)
    if is_low_res:
        scale = 800.0 / max(h, w)
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    
    # Gamma correction buat gambar gelap (malam hari)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mean_brightness = np.mean(gray)
    if mean_brightness < 80:
        gamma = 0.7  # Terangin
        inv_gamma = 1.0 / gamma
        table = np.array([(i / 255.0) ** inv_gamma * 255 for i in np.arange(0, 256)]).astype("uint8")
        img = cv2.LUT(img, table)
    
    return img


# ---------------------------------------------------------------------------
# COCO class filter — ambil SEMUA class biar tiap barang ke detect
# (backend determineAiStatus yang akan pisahkan person vs trash)
# ---------------------------------------------------------------------------
def run_coco_inference(source, iou_threshold: float, coco_conf: float = 0.20) -> list[dict]:
    """Jalankan COCO untuk deteksi general.
    source bisa str (file path) atau np.ndarray (preprocessed image).
    coco_conf bisa diadaptasi: gambar blur → 0.15, normal → 0.20
    """
    detections = []
    try:
        coco, names = get_coco_model()
        if coco is None:
            return detections

        results = coco(source, conf=coco_conf, iou=iou_threshold, verbose=False)
        boxes = results[0].boxes
        if boxes is None:
            return detections

        for box, conf, cls_id in zip(boxes.xyxy.cpu().numpy(), boxes.conf.cpu().numpy(), boxes.cls.cpu().numpy().astype(int)):
            cls_name = names.get(int(cls_id), f"coco_{cls_id}")
            detections.append({
                "class": cls_name,
                "confidence": round(float(conf), 4),
                "bbox": [round(float(box[0]), 2), round(float(box[1]), 2), round(float(box[2]), 2), round(float(box[3]), 2)],
            })
    except Exception as e:
        print(f"[WARN] COCO inference failed: {e}", file=sys.stderr)

    return detections


# ---------------------------------------------------------------------------
# Validasi File Source
# ---------------------------------------------------------------------------

def validate_source(source_path: str) -> tuple[str | None, str | None]:
    """Validasi path file input. Returns (type, error)."""
    path = Path(source_path)

    if not path.exists():
        return None, f"File tidak ditemukan: {source_path}"
    if not path.is_file():
        return None, f"Path bukan file: {source_path}"

    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    video_exts = {".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".m4v"}
    ext = path.suffix.lower()

    if ext in image_exts:
        return "image", None
    if ext in video_exts:
        return "video", None
    return None, f"Format file tidak didukung: {ext}"


# ---------------------------------------------------------------------------
# Inference Functions
# ---------------------------------------------------------------------------

def hand_region_detection(img: np.ndarray, person_boxes: list, model, coco_model, class_names: dict, coco_names: dict, iou_threshold: float) -> list[dict]:
    """Deteksi objek di area tangan person (bawah 70% bbox) dengan conf rendah.
    
    Crop area bawah person (dari 30% height sampai bawah + sedikit ekstra),
    run YOLO custom model + COCO dengan conf=0.10.
    Hasil dimapping balik ke koordinat gambar asli dan di-merge ke deteksi utama.
    """
    extra_dets = []
    h, w = img.shape[:2]
    import cv2
    for pbox in person_boxes:
        x1, y1, x2, y2 = pbox
        ph = y2 - y1
        pw = x2 - x1
        if ph < 30 or pw < 20:
            continue
        
        # Hand region: bawah 70% person (dari 30% height sampai agak kebawah),
        # diperluas 25% ke samping biar nangkep tangan yang nengok ke samping
        hand_y1 = int(max(0, y1 + ph * 0.28))
        hand_y2 = int(min(h, y2 + ph * 0.15))
        hand_x1 = int(max(0, x1 - pw * 0.25))
        hand_x2 = int(min(w, x2 + pw * 0.25))
        
        if hand_x2 <= hand_x1 or hand_y2 <= hand_y1:
            continue
        
        crop = img[hand_y1:hand_y2, hand_x1:hand_x2]
        if crop.shape[0] < 20 or crop.shape[1] < 20:
            continue
        
        # ── Upscale crop tangan biar YOLO bisa liat detail ──
        # Plastik sampah di tangan cuma 10-20 pixel di resolusi rendah
        crop_h, crop_w = crop.shape[:2]
        upscale = 1.0
        if max(crop_w, crop_h) < 200:
            upscale = 200.0 / min(crop_w, crop_h)
            if upscale > 1.0:
                new_w = int(crop_w * upscale)
                new_h = int(crop_h * upscale)
                crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
        
        # Koordinat YOLO dari upscaled crop perlu di-scale balik ke processed space
        scale_back = 1.0 / upscale
        
        try:
            # Run BOTH models on hand crop with conf=0.10
            # Custom model
            results = model(crop, conf=0.10, iou=iou_threshold, verbose=False)
            boxes = results[0].boxes
            if boxes is not None:
                for box, conf, cls_id in zip(boxes.xyxy.cpu().numpy(), boxes.conf.cpu().numpy(), boxes.cls.cpu().numpy().astype(int)):
                    cls_name = class_names.get(int(cls_id), f"class_{cls_id}")
                    ox1 = round(float(box[0]) * scale_back + hand_x1, 2)
                    oy1 = round(float(box[1]) * scale_back + hand_y1, 2)
                    ox2 = round(float(box[2]) * scale_back + hand_x1, 2)
                    oy2 = round(float(box[3]) * scale_back + hand_y1, 2)
                    extra_dets.append({
                        "class": cls_name,
                        "confidence": round(float(conf), 4),
                        "bbox": [ox1, oy1, ox2, oy2],
                    })
            # COCO model
            coco_results = coco_model(crop, conf=0.10, iou=iou_threshold, verbose=False)
            coco_boxes = coco_results[0].boxes
            if coco_boxes is not None:
                for box, conf, cls_id in zip(coco_boxes.xyxy.cpu().numpy(), coco_boxes.conf.cpu().numpy(), coco_boxes.cls.cpu().numpy().astype(int)):
                    cls_name = coco_names.get(int(cls_id), f"coco_{cls_id}")
                    ox1 = round(float(box[0]) * scale_back + hand_x1, 2)
                    oy1 = round(float(box[1]) * scale_back + hand_y1, 2)
                    ox2 = round(float(box[2]) * scale_back + hand_x1, 2)
                    oy2 = round(float(box[3]) * scale_back + hand_y1, 2)
                    extra_dets.append({
                        "class": cls_name,
                        "confidence": round(float(conf), 4),
                        "bbox": [ox1, oy1, ox2, oy2],
                    })
        except Exception as e:
            print(f"[WARN] Hand region inference failed: {e}", file=sys.stderr)
    
    return extra_dets


def infer_image(
    source_path: str,
    model_path: str = "ai/models/best.pt",
    conf_threshold: float = 0.35,
    iou_threshold: float = 0.45,
) -> str:
    """Jalankan inferensi dual model dengan preprocessing CLAHE + Sharpen:
    1. COCO — deteksi objek general (person, monitor, keyboard, backpack)
    2. Custom model — deteksi sampah spesifik + person variants
    Ditambah hand region re-detection untuk tangkap objek di tangan person.

    Gambar dipreprocess dulu (CLAHE + sharpen) biar CCTV burik tetap kebaca.
    """
    start = time.time()
    import cv2

    def is_person(cls_name: str) -> bool:
        cls_lower = cls_name.lower()
        person_variants = ['person', 'people', 'sitting', 'standing', 'fall-detected', 'orang']
        return any(v in cls_lower for v in person_variants)

    try:
        # ── Blur score dari gambar asli (sebelum preprocessing) ──
        raw_img = cv2.imread(source_path)
        img_h, img_w = raw_img.shape[:2] if raw_img is not None else (640, 640)
        img_quality = 'GOOD'
        if raw_img is not None:
            gray = cv2.cvtColor(raw_img, cv2.COLOR_BGR2GRAY)
            blur_score = int(round(cv2.Laplacian(gray, cv2.CV_64F).var()))
            if blur_score < 80:
                img_quality = 'BLURRY'
            elif blur_score < 150:
                img_quality = 'LOW'
            else:
                img_quality = 'GOOD'
        else:
            blur_score = 0

        # ── Preprocess: sekali, dipake kedua model ──
        processed_img = preprocess_image(source_path, img_quality)
        if processed_img is None:
            processed_img = source_path  # fallback ke raw path

        # Catat dimensi processed (buat scale balik bbox ke ukuran asli)
        if isinstance(processed_img, np.ndarray):
            proc_h, proc_w = processed_img.shape[:2]
        else:
            proc_h, proc_w = img_h, img_w  # fallback: raw path, gak ada preprocessing

        # ── Model 1: COCO (yolov8n.pt) untuk objek general ──
        # Conf mengikuti threshold utama biar konsisten (kecil = tangkap bottle/cup/person)
        coco_conf = conf_threshold
        coco_dets = run_coco_inference(processed_img, iou_threshold, coco_conf)

        # ── Model 2: Custom (best.pt) untuk sampah spesifik ──
        custom_dets = []
        model, class_names = get_model(model_path)
        custom_results = model(processed_img, conf=conf_threshold, iou=iou_threshold, verbose=False)
        custom_boxes = custom_results[0].boxes
        if custom_boxes is not None:
            for box, conf, cls_id in zip(custom_boxes.xyxy.cpu().numpy(), custom_boxes.conf.cpu().numpy(), custom_boxes.cls.cpu().numpy().astype(int)):
                custom_dets.append({
                    "class": class_names.get(int(cls_id), f"class_{cls_id}"),
                    "confidence": round(float(conf), 4),
                    "bbox": [round(float(box[0]), 2), round(float(box[1]), 2), round(float(box[2]), 2), round(float(box[3]), 2)],
                })

        # ── Merge: COCO + Custom, deduplikasi ──
        def bbox_iou(a, b):
            ix1 = max(a[0], b[0])
            iy1 = max(a[1], b[1])
            ix2 = min(a[2], b[2])
            iy2 = min(a[3], b[3])
            iw = max(0.0, ix2 - ix1)
            ih = max(0.0, iy2 - iy1)
            inter = iw * ih
            area_a = (a[2] - a[0]) * (a[3] - a[1])
            area_b = (b[2] - b[0]) * (b[3] - b[1])
            return inter / (area_a + area_b - inter + 1e-6)

        # Gabung, urut confidence descending
        merged = coco_dets + custom_dets
        merged.sort(key=lambda d: d["confidence"], reverse=True)

        # Dedup: hapus overlap, prefer custom model (nama lebih panjang = lebih spesifik)
        final = []
        for d in merged:
            is_dup = False
            for f in final:
                if bbox_iou(d["bbox"], f["bbox"]) > 0.5:
                    # Merge: prefer nama lebih panjang (custom model)
                    if len(d["class"]) > len(f["class"]):
                        f["class"] = d["class"]
                    f["confidence"] = max(f["confidence"], d["confidence"])
                    is_dup = True
                    break
            if not is_dup:
                final.append(d)

        # ── Hand Region Re-Detection ──
        processed_np = processed_img if isinstance(processed_img, np.ndarray) else cv2.imread(source_path)
        hand_boxes = [d["bbox"] for d in final if is_person(d["class"])]
        # Get COCO model for hand region
        coco_model, coco_names = get_coco_model()
        for hdet in hand_region_detection(processed_np, hand_boxes, model, coco_model, class_names, coco_names, iou_threshold):
            is_dup = False
            for f in final:
                if bbox_iou(hdet["bbox"], f["bbox"]) > 0.4:
                    is_dup = True
                    break
            if not is_dup:
                final.append(hdet)

        # ── STEP 1: Person Aggressive NMS ──
        # Merge all overlapping person boxes (COCO person + custom person variants)
        # Person class bbox sering ganda dari dual model, merge agresif
        person_dets = [d for d in final if is_person(d["class"])]
        non_person_dets = [d for d in final if not is_person(d["class"])]
        persons_merged = []
        for d in person_dets:
            is_dup = False
            dx1, dy1, dx2, dy2 = d['bbox']
            dcx = (dx1 + dx2) / 2
            dcy = (dy1 + dy2) / 2
            darea = (dx2 - dx1) * (dy2 - dy1)
            for m in persons_merged:
                mx1, my1, mx2, my2 = m['bbox']
                # Hitung IOU
                ix1, iy1 = max(dx1, mx1), max(dy1, my1)
                ix2, iy2 = min(dx2, mx2), min(dy2, my2)
                if ix1 < ix2 and iy1 < iy2:
                    inter = (ix2 - ix1) * (iy2 - iy1)
                    marea = (mx2 - mx1) * (my2 - my1)
                    iou = inter / (darea + marea - inter + 1e-6)
                    
                    # Tambahan: Hitung rasio overlap terhadap luas kotak terkecil (handle containment)
                    min_area = min(darea, marea)
                    overlap_ratio = inter / (min_area + 1e-6)
                    
                    # Merge jika IOU > 0.15 ATAU salah satu kotak berada di dalam kotak lain (>50% overlap) ATAU center distance < 35%
                    mcx = (mx1 + mx2) / 2
                    mcy = (my1 + my2) / 2
                    mh = max(my2 - my1, dy2 - dy1)
                    center_dist = ((dcx - mcx)**2 + (dcy - mcy)**2)**0.5
                    if iou > 0.15 or overlap_ratio > 0.50 or center_dist < mh * 0.35:
                        if d['confidence'] > m['confidence']:
                            m['bbox'] = d['bbox']
                            m['confidence'] = d['confidence']
                            m['class'] = 'person'
                        is_dup = True
                        break
            if not is_dup:
                d['class'] = 'person'
                persons_merged.append(d)
        final = persons_merged + non_person_dets

        # ── STEP 2: Skip kelas yang gak relevan ──
        # User request: tanaman gak perlu di-label, fokus sampah/barang di tanah/motor
        SKIP_CLASSES = {'potted plant', 'pottedplant', 'house plant', 'tree'}
        final = [d for d in final if d["class"].lower() not in SKIP_CLASSES]

        # ── STEP 2b: FP di kepala manusia ──
        # Food wrapper / trash kecil di upper 38% person bbox = false positive (rambut/kepala)
        person_bboxes_upper = []
        for d in final:
            if is_person(d["class"]):
                x1, y1, x2, y2 = d["bbox"]
                ph = y2 - y1
                person_bboxes_upper.append((x1, y1, x2, y1 + ph * 0.38))
        if person_bboxes_upper:
            filtered_upper = []
            for d in final:
                cls_lower = d["class"].lower()
                if is_person(cls_lower):
                    filtered_upper.append(d)
                    continue
                dx = (d["bbox"][0] + d["bbox"][2]) / 2
                dy = (d["bbox"][1] + d["bbox"][3]) / 2
                is_upper_fp = False
                for ux1, uy1, ux2, uy2 in person_bboxes_upper:
                    if ux1 <= dx <= ux2 and uy1 <= dy <= uy2:
                        # Centroid ada di area kepala/rambut orang → false positive
                        print(f"[FP-FILTER] Upper body FP: {d['class']} {d['confidence']:.4f} di area kepala person", file=sys.stderr)
                        is_upper_fp = True
                        break
                if not is_upper_fp:
                    filtered_upper.append(d)
            final = filtered_upper

        # ── STEP 3: Non-Person NMS ──
        # Merge duplicate non-person (car double, dll) — IOU > 0.4
        non_person_nms = []
        for d in final:
            is_dup = False
            for m in non_person_nms:
                if bbox_iou(d["bbox"], m["bbox"]) > 0.4:
                    if d["confidence"] > m["confidence"]:
                        m["bbox"] = d["bbox"]
                        m["confidence"] = d["confidence"]
                        m["class"] = d["class"]
                    is_dup = True
                    break
            if not is_dup:
                non_person_nms.append(d)
        final = non_person_nms

        # ── STEP 4: Trash Pile False Positive Filter ──
        # Custom model best.pt punya class 'Trash pile' yang sering FP ke mobil/pohon
        # Filter ketat: spatial (bawah 50% gambar), confidence >= 0.40, gak overlap vehicle
        TRASH_PILE_MIN_CONF = 0.40
        filtered_fp = []
        for d in final:
            cls_lower = d["class"].lower()
            is_trash_pile = ('trash_pile' in cls_lower or 'trash pile' in cls_lower or d["class"] in ('Trash pile', 'Trash Pile'))
            if is_trash_pile:
                # (a) Confidence floor khusus trash_pile
                if d["confidence"] < TRASH_PILE_MIN_CONF:
                    print(f"[FP-FILTER] Trash pile conf too low: {d['confidence']:.4f} < {TRASH_PILE_MIN_CONF}", file=sys.stderr)
                    continue
                # (b) Cek centroid — trash pile harus di bawah 50% tinggi gambar
                _, y1, _, y2 = d["bbox"]
                cy = (y1 + y2) / 2
                if cy < img_h * 0.45:
                    print(f"[FP-FILTER] Trash pile di upper area (cy={cy:.0f}), skip", file=sys.stderr)
                    continue
                # (c) Cek overlap dengan vehicle (car, motorcycle)
                overlaps_vehicle = False
                for other in final:
                    if other is d:
                        continue
                    if any(v in other["class"].lower() for v in ('car', 'motorcycle', 'bicycle', 'truck', 'bus', 'train')):
                        if bbox_iou(d["bbox"], other["bbox"]) > 0.25:
                            overlaps_vehicle = True
                            print(f"[FP-FILTER] Trash pile overlap {other['class']} {other['confidence']:.4f}, skip", file=sys.stderr)
                            break
                if overlaps_vehicle:
                    continue
                # (d) Rasio aspect — trash pile normalnya lebih lebar dari tinggi
                bw = d["bbox"][2] - d["bbox"][0]
                bh = d["bbox"][3] - d["bbox"][1]
                if bh > 0 and (bw / bh) < 0.4:  # Vertikal tall → pohon/batang
                    print(f"[FP-FILTER] Trash pile aspect ratio {(bw/bh):.2f} terlalu vertikal", file=sys.stderr)
                    continue
                filtered_fp.append(d)
            else:
                filtered_fp.append(d)
        final = filtered_fp

        # ── STEP 5: Size-based Trash Classification ──
        # Bedakan tumpukan sampah (pile) vs sampah terpisah (item)
        # HANYA untuk class garbage/trash yang asalnya dari COCO (conf 0.15 bisa FP)
        # JANGAN ubah class custom model (Plastic bag, Bottle, dll)
        img_area = proc_w * proc_h
        for d in final:
            cls_lower = d["class"].lower()
            # Hanya proses kalo class dari COCO (garbage, trash) — BUKAN custom
            # Custom model punya 'Trash pile' sendiri yang udah di-filter di atas
            # Custom model juga output 'Garbage' — itu residue, kecil kemungkinan
            if cls_lower in ('garbage', 'trash'):
                bw = d["bbox"][2] - d["bbox"][0]
                bh = d["bbox"][3] - d["bbox"][1]
                bbox_area_pct = (bw * bh) / img_area * 100
                if bbox_area_pct > 12:
                    # Gede banget — mungkin false positive. Cek juga aspect ratio
                    if bbox_area_pct > 30:
                        # Terlalu gede (setengah foto) → skip, ini pasti false positive
                        print(f"[FP-FILTER] Trash too large ({bbox_area_pct:.0f}% image), removing", file=sys.stderr)
                        d["class"] = "__skip__"  # marker buat dihapus
                    else:
                        d["class"] = "trash_pile"
                else:
                    d["class"] = "trash"
        # Hapus yang di-mark __skip__
        final = [d for d in final if d.get("class") != "__skip__"]

        # ── STEP 6: Minimum Confidence Floor & Size Filter ──
        # Person: skip yang terlalu noise (< 0.35) kecuali di scene crowded (>6 person)
        # Non-person: minimum 0.40 untuk kurangi false alarm pada baju/background
        PERSON_MIN_CONF = 0.35
        NON_PERSON_MIN_CONF = 0.40
        person_count = len([d for d in final if is_person(d["class"])])
        # Kalo scene crowded (>6 person), turunin threshold biar gak kehilangan real person
        person_conf_threshold = PERSON_MIN_CONF if person_count <= 6 else 0.30
        
        filtered_final = []
        for d in final:
            x1, y1, x2, y2 = d["bbox"]
            bw_pct = (x2 - x1) / proc_w * 100
            bh_pct = (y2 - y1) / proc_h * 100
            
            if is_person(d["class"]):
                # Filter person: minimal threshold confidence DAN ukuran w >= 4%, h >= 8%
                if d["confidence"] >= person_conf_threshold and bw_pct >= 4.0 and bh_pct >= 8.0:
                    filtered_final.append(d)
            else:
                if d["confidence"] >= NON_PERSON_MIN_CONF:
                    filtered_final.append(d)
        final = filtered_final

        elapsed = round((time.time() - start) * 1000, 2)

        # Scale balik bbox dari koordinat processed ke dimensi asli (img_w, img_h)
        # karena preprocessing (upscale/resize) mengubah ukuran gambar
        scale_x = img_w / proc_w
        scale_y = img_h / proc_h
        for d in final:
            d['bbox'][0] = round(d['bbox'][0] * scale_x, 2)
            d['bbox'][1] = round(d['bbox'][1] * scale_y, 2)
            d['bbox'][2] = round(d['bbox'][2] * scale_x, 2)
            d['bbox'][3] = round(d['bbox'][3] * scale_y, 2)

        # Dimensi & blur score sudah di-capture dari awal (sebelum preprocessing)
        # img_h, img_w, blur_score, img_quality (quality_status) udah dihitung di atas

        return make_result(
            success=True,
            detections=final,
            total_detections=len(final),
            processingTimeMs=elapsed,
            imageWidth=img_w,
            imageHeight=img_h,
            blurScore=blur_score,
            qualityStatus=img_quality,
        )

    except Exception as e:
        elapsed = round((time.time() - start) * 1000, 2)
        return make_result(
            success=False,
            error=f"Error saat inferensi dual model ({elapsed}ms): {type(e).__name__}: {e}",
        )


def infer_video(
    source_path: str,
    model_path: str = "ai/models/best.pt",
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.45,
    max_frames: int = 0,
) -> str:
    """Jalankan inferensi YOLOv8 pada video."""
    import cv2

    model, class_names = get_model(model_path)
    start = time.time()

    try:
        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            return make_result(
                success=False, error=f"Gagal membuka video: {source_path}"
            )

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)

        frame_idx = 0
        all_detections = []
        frames_with_detections = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if max_frames > 0 and frame_idx >= max_frames:
                break

            raw_results = model(
                frame, conf=conf_threshold, iou=iou_threshold, verbose=False
            )

            dets = raw_results[0].boxes
            boxes_np = dets.xyxy.cpu().numpy() if dets is not None else []
            confs_np = dets.conf.cpu().numpy() if dets is not None else []
            cls_np = dets.cls.cpu().numpy().astype(int) if dets is not None else []

            for i in range(len(boxes_np)):
                x1, y1, x2, y2 = boxes_np[i].tolist()
                confidence = float(confs_np[i])
                cls_id = int(cls_np[i])
                all_detections.append(
                    {
                        "class": class_names.get(cls_id, f"class_{cls_id}"),
                        "confidence": round(confidence, 4),
                        "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                        "frame": frame_idx,
                        "timestamp_sec": round(frame_idx / fps, 2) if fps > 0 else 0,
                    }
                )
                if len(all_detections) == 1:
                    frames_with_detections += 1

            frame_idx += 1

        cap.release()
        elapsed = round((time.time() - start) * 1000, 2)

        return make_result(
            success=True,
            detections=all_detections,
            total_detections=len(all_detections),
            processingTimeMs=elapsed,
            imageWidth=width,
            imageHeight=height,
            videoMeta={
                "totalFrames": total_frames,
                "fps": fps,
                "processedFrames": frame_idx,
                "framesWithDetections": frames_with_detections,
            },
        )

    except Exception as e:
        return make_result(
            success=False,
            error=f"Error saat inferensi video: {type(e).__name__}: {e}",
        )


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="EYECO AI — YOLOv8 Inference")
    parser.add_argument("source", type=str, nargs="?", default=None,
                        help="Path ke file gambar atau video")
    parser.add_argument(
        "--model",
        type=str,
        default="ai/models/best.pt",
        help="Path ke model YOLOv8 .pt (default: ai/models/best.pt)",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.25,
        help="Confidence threshold (default: 0.25)",
    )
    parser.add_argument(
        "--iou",
        type=float,
        default=0.45,
        help="IoU threshold untuk NMS (default: 0.45)",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Max frame yang diproses untuk video (0 = semua)",
    )
    parser.add_argument(
        "--warmup",
        action="store_true",
        help="Jalankan warmup: load model + 1 prediksi dummy",
    )

    args = parser.parse_args()

    # === Mode Warmup ===
    if args.warmup:
        model, _ = get_model(args.model)
        import numpy as np
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        model(dummy, verbose=False)
        print(make_result(success=True, detections=[], total_detections=0, warmup=True))
        return

    # === Validasi Source ===
    source_type, error = validate_source(args.source)
    if error:
        print(make_result(success=False, error=error))
        sys.exit(1)

    # === Inferensi ===
    kwargs = {
        "source_path": args.source,
        "model_path": args.model,
        "conf_threshold": args.conf,
        "iou_threshold": args.iou,
    }

    if source_type == "image":
        output = infer_image(**kwargs)
    elif source_type == "video":
        output = infer_video(**kwargs, max_frames=args.max_frames)
    else:
        output = make_result(success=False, error=f"Tipe file tidak dikenal")

    print(output)


if __name__ == "__main__":
    main()
