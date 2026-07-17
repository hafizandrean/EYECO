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


# ---------------------------------------------------------------------------
# JSON Output Helpers
# ---------------------------------------------------------------------------

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

_model_instance = None
_model_class_names: dict[int, str] = {}


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
    elif ext in video_exts:
        return "video", None
    else:
        return None, f"Format file tidak didukung: {ext}"


# ---------------------------------------------------------------------------
# Inference Functions
# ---------------------------------------------------------------------------

def infer_image(
    source_path: str,
    model_path: str = "ai/models/best.pt",
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.45,
) -> str:
    """Jalankan inferensi YOLOv8 pada satu gambar."""
    import cv2

    model, class_names = get_model(model_path)
    start = time.time()

    try:
        # Baca gambar untuk dapatkan dimensi
        image = cv2.imread(source_path)
        if image is None:
            return make_result(
                success=False, error=f"Gagal membaca gambar: {source_path}"
            )

        height, width = image.shape[:2]

        # Inferensi
        raw_results = model(
            source_path,
            conf=conf_threshold,
            iou=iou_threshold,
            verbose=False,
        )

        # Parse hasil
        dets = raw_results[0].boxes
        boxes_np = dets.xyxy.cpu().numpy() if dets is not None else []
        confs_np = dets.conf.cpu().numpy() if dets is not None else []
        cls_np = dets.cls.cpu().numpy().astype(int) if dets is not None else []

        detections = []
        for i in range(len(boxes_np)):
            x1, y1, x2, y2 = boxes_np[i].tolist()
            confidence = float(confs_np[i])
            cls_id = int(cls_np[i])
            detections.append(
                {
                    "class": class_names.get(cls_id, f"class_{cls_id}"),
                    "confidence": round(confidence, 4),
                    "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                }
            )

        elapsed = round((time.time() - start) * 1000, 2)

        return make_result(
            success=True,
            detections=detections,
            total_detections=len(detections),
            processingTimeMs=elapsed,
            imageWidth=width,
            imageHeight=height,
        )

    except Exception as e:
        return make_result(
            success=False,
            error=f"Error saat inferensi: {type(e).__name__}: {e}",
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

            if len(boxes_np) > 0:
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
                "fps": round(fps, 2) if fps else 0,
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

def main():
    parser = argparse.ArgumentParser(
        description="EYECO AI — YOLOv8 Detection Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Contoh:
  python3 ai/detect.py image.jpg
  python3 ai/detect.py video.mp4 --model ai/models/best.pt --conf 0.5
  python3 ai/detect.py image.jpg --verbose
        """,
    )

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
