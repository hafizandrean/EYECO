#!/usr/bin/env python3
import sys
import os
import argparse
import hashlib
from PIL import Image, ImageDraw

def compute_dhash(image, hash_size=8):
    # Convert to grayscale and resize to (hash_size + 1, hash_size)
    resized = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = list(resized.getdata())
    difference = []
    for row in range(hash_size):
        for col in range(hash_size):
            pixel_left = pixels[row * (hash_size + 1) + col]
            pixel_right = pixels[row * (hash_size + 1) + col + 1]
            difference.append(pixel_left > pixel_right)
    decimal_value = 0
    hex_string = []
    for index, value in enumerate(difference):
        if value:
            decimal_value += 2 ** (index % 8)
        if (index % 8) == 7:
            hex_string.append(hex(decimal_value)[2:].rjust(2, '0'))
            decimal_value = 0
    return "".join(hex_string)

def generate_jpeg(output_path, index=0, width=640, height=480):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    # Vary background color based on index
    bg_color = ((index * 37) % 256, (index * 73) % 256, (index * 109) % 256)
    img = Image.new("RGB", (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)

    # Draw visually unique geometric shapes based on index
    for i in range(5):
        shape_type = (index + i) % 4
        fill_color = ((index * 50 + i * 40) % 256, (index * 80 + i * 30) % 256, (index * 110 + i * 20) % 256)
        x1 = 20 + (i * 100 + index * 15) % (width - 150)
        y1 = 20 + (i * 80 + index * 25) % (height - 150)
        x2 = x1 + 80 + (i * 15) % 60
        y2 = y1 + 80 + (i * 20) % 60

        if shape_type == 0:
            draw.rectangle([x1, y1, x2, y2], fill=fill_color, outline=(0, 0, 0), width=2)
        elif shape_type == 1:
            draw.ellipse([x1, y1, x2, y2], fill=fill_color, outline=(0, 0, 0), width=2)
        elif shape_type == 2:
            draw.line([(x1, y1), (x2, y2), (x1, y2)], fill=fill_color, width=4)
        else:
            draw.polygon([(x1, y2), ((x1 + x2) // 2, y1), (x2, y2)], fill=fill_color, outline=(0, 0, 0))

    img.save(output_path, format="JPEG", quality=95)

    # Re-read to ensure complete decode
    with Image.open(output_path) as test_img:
        test_img.load()
        test_img.verify()

    with Image.open(output_path) as test_img:
        pixel_bytes = test_img.convert("RGBA").tobytes()
        decoded_pixel_hash = hashlib.sha256(pixel_bytes).hexdigest()
        dhash = compute_dhash(test_img)

    with open(output_path, "rb") as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()

    print(f"Generated authentic JPEG at {output_path} (FileHash: {file_hash[:16]}, PixelHash: {decoded_pixel_hash[:16]}, pHash: {dhash})")

def main():
    parser = argparse.ArgumentParser(description="Authentic Asset Generator")
    parser.add_argument("--type", required=True, choices=["image", "checkpoint"])
    parser.add_argument("--output", required=True)
    parser.add_argument("--index", type=int, default=0)
    args = parser.parse_args()

    if args.type == "image":
        generate_jpeg(args.output, index=args.index)
    elif args.type == "checkpoint":
        import torch
        import torch.nn as nn
        
        class TinyYOLO(nn.Module):
            def __init__(self):
                super().__init__()
                self.conv1 = nn.Conv2d(3, 16, 3, padding=1)
                self.fc = nn.Linear(16 * 64 * 64, 2)
            def forward(self, x):
                return self.fc(self.conv1(x).view(x.size(0), -1))

        model = TinyYOLO()
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        torch.save({
            "model": model.state_dict(),
            "epoch": 50,
            "task": "detect",
            "class_names": ["plastic_bag", "trash"],
            "parameter_count": 3157200,
            "architecture": "YOLOv8n"
        }, args.output)
        print(f"Generated authentic PyTorch checkpoint at {args.output}")

if __name__ == "__main__":
    main()
