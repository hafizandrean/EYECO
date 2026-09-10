#!/usr/bin/env python3
"""
EYECO AI — Model Training Script (Colab and Local GPU)
Berdasarkan Roboflow and Ultralytics Pipeline (Adopsi File Referensi Training Notebook).

Usage:
    python scripts/train_on_colab_roboflow.py --api-key YOUR_KEY --workspace YOUR_WS --project YOUR_PROJ --version 1 --epochs 60
"""

import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="Train custom YOLO model for EYECO using Roboflow/local dataset")
    parser.add_argument("--api-key", help="Roboflow API Key")
    parser.add_argument("--workspace", help="Roboflow Workspace name")
    parser.add_argument("--project", help="Roboflow Project name")
    parser.add_argument("--version", type=int, default=1, help="Roboflow Dataset Version")
    parser.add_argument("--data", help="Local path to data.yaml")
    parser.add_argument("--model", default="yolov8n.pt", help="Base pretrained model: yolov8n.pt, yolov8s.pt, yolo11n.pt, etc.")
    parser.add_argument("--epochs", type=int, default=60, help="Number of training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Image resolution")
    parser.add_argument("--device", default="0", help="GPU device ID (0) or cpu")
    parser.add_argument("--output", default="ai/models/best.pt", help="Destination path for best.pt")

    args = parser.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("[ERROR] Ultralytics belum terpasang. Jalankan: pip install ultralytics roboflow", file=sys.stderr)
        sys.exit(1)

    data_yaml_path = args.data

    if args.api_key and args.workspace and args.project:
        try:
            from roboflow import Roboflow
            print(f"[AI] Mengunduh dataset {args.workspace}/{args.project} (v{args.version}) dari Roboflow...")
            rf = Roboflow(api_key=args.api_key)
            proj = rf.workspace(args.workspace).project(args.project)
            dataset = proj.version(args.version).download("yolov8")
            data_yaml_path = f"{dataset.location}/data.yaml"
            print(f"[AI] Dataset siap di: {data_yaml_path}")
        except Exception as e:
            print(f"[ERROR] Gagal mengunduh dataset Roboflow: {e}", file=sys.stderr)
            sys.exit(1)

    if not data_yaml_path or not os.path.exists(data_yaml_path):
        print(f"[ERROR] File data.yaml tidak ditemukan: {data_yaml_path}", file=sys.stderr)
        sys.exit(1)

    print("\n==========================================")
    print("  🚀 MEMULAI PELATIHAN MODEL YOLO EYECO")
    print(f"  Model Base : {args.model}")
    print(f"  Dataset    : {data_yaml_path}")
    print(f"  Epochs     : {args.epochs}")
    print(f"  Batch Size : {args.batch}")
    print(f"  Device     : {args.device}")
    print("==========================================\n")

    model = YOLO(args.model)
    results = model.train(
        data=data_yaml_path,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project="eyeco_training",
        name="train_run",
        plots=True,
    )

    print("\n[AI] Menjalankan validasi mAP...")
    metrics = model.val()
    print(f"[AI] Hasil Validasi mAP: {metrics}")

    best_weight_source = "eyeco_training/train_run/weights/best.pt"
    if os.path.exists(best_weight_source):
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        import shutil
        shutil.copy2(best_weight_source, args.output)
        print(f"\n✅ Model terbaik berhasil disimpan ke: {args.output}")
        print("Model siap digunakan langsung oleh EYECO Backend!")
    else:
        print(f"[WARN] File bobot tidak ditemukan di {best_weight_source}")

if __name__ == "__main__":
    main()
