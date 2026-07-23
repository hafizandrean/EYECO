import cv2
import numpy as np

img_path = 'public/uploads/upload_1784622450286-660982149.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]

print(f"Report #303 Image dimensions: {width}x{height}")

# Person box from YOLO in pixels:
px1 = 0.504 * width
py1 = 0.252 * height
px2 = (0.504 + 0.347) * width
py2 = (0.252 + 0.621) * height

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (5, 5), 0)
thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3)

contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
img_area = width * height

candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    
    if (0.001 * img_area) < area < (0.15 * img_area):
        # Calculate intersection with person box
        cx1, cy1, cx2, cy2 = x, y, x + w, y + h
        ix1 = max(cx1, px1)
        iy1 = max(cy1, py1)
        ix2 = min(cx2, px2)
        iy2 = min(cy2, py2)
        
        iw = max(0, ix2 - ix1)
        ih = max(0, iy2 - iy1)
        inter_area = iw * ih
        overlap_ratio = inter_area / area if area > 0 else 0
        
        # REJECT any contour overlapping > 15% with person box!
        if overlap_ratio > 0.15:
            continue
            
        pct_x = round((x / width) * 100, 1)
        pct_y = round((y / height) * 100, 1)
        pct_w = round((w / width) * 100, 1)
        pct_h = round((h / height) * 100, 1)
        
        candidates.append({
            'pct': [pct_x, pct_y, pct_w, pct_h],
            'bbox': [x, y, w, h],
            'area': area,
            'overlap': round(overlap_ratio, 2)
        })

candidates.sort(key=lambda b: b['area'], reverse=True)
print(f"Total non-person candidates: {len(candidates)}")
for idx, b in enumerate(candidates[:5]):
    print(f"Non-Person Candidate #{idx+1}: %={b['pct']}, BBox={b['bbox']}, Overlap={b['overlap']}")
