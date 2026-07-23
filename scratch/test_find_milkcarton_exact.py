import cv2
import numpy as np

img_path = 'public/uploads/upload_1784621167740-158919581.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (5, 5), 0)
thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3)

contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
img_area = width * height

print(f"Total adaptive threshold contours: {len(contours)}")

candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    pct_x = round((x / width) * 100, 1)
    pct_y = round((y / height) * 100, 1)
    pct_w = round((w / width) * 100, 1)
    pct_h = round((h / height) * 100, 1)
    pct_area = round((area / img_area) * 100, 2)
    
    if (0.003 * img_area) < area < (0.20 * img_area) and (0.35 * height) < (y + h / 2) < (0.75 * height):
        candidates.append({
            'pct': [pct_x, pct_y, pct_w, pct_h],
            'bbox': [x, y, w, h],
            'area': area
        })

candidates.sort(key=lambda b: b['area'], reverse=True)
for idx, b in enumerate(candidates[:5]):
    print(f"Candidate #{idx+1}: %={b['pct']}, BBox={b['bbox']}")
