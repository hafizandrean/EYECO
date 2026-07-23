import cv2
import numpy as np

img_path = 'public/uploads/upload_1784622821286-83239243.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]
img_area = width * height

hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
green_mask = cv2.inRange(hsv, np.array([25, 20, 20]), np.array([95, 255, 255]))
non_plant_mask = cv2.bitwise_not(green_mask)

surface_mask = np.zeros((height, width), dtype=np.uint8)
surface_mask[int(0.35 * height):int(0.98 * height), :] = 255
valid_mask = cv2.bitwise_and(non_plant_mask, surface_mask)

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
masked_gray = cv2.bitwise_and(gray, gray, mask=valid_mask)
edges = cv2.Canny(masked_gray, 30, 120)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
dilated = cv2.dilate(edges, kernel, iterations=2)
contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

px1, py1, px2, py2 = 0.504 * width, 0.252 * height, (0.504 + 0.347) * width, (0.252 + 0.621) * height

trash_candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    
    if (0.001 * img_area) < area < (0.05 * img_area) and w > 15 and h > 15 and 0.35 < aspect_ratio < 3.0:
        # Check person overlap
        ix1 = max(float(x), float(px1))
        iy1 = max(float(y), float(py1))
        ix2 = min(float(x + w), float(px2))
        iy2 = min(float(y + h), float(py2))
        iw = max(0.0, ix2 - ix1)
        ih = max(0.0, iy2 - iy1)
        inter_area = iw * ih
        
        if area > 0 and (inter_area / float(area)) > 0.15:
            continue
            
        pct_x = round((x / width) * 100, 1)
        pct_y = round((y / height) * 100, 1)
        pct_w = round((w / width) * 100, 1)
        pct_h = round((h / height) * 100, 1)
        bottom_y = pct_y + pct_h
        
        trash_candidates.append({
            'pct': [pct_x, pct_y, pct_w, pct_h],
            'bbox': [x, y, w, h],
            'area': area,
            'bottom_y': round(bottom_y, 1)
        })

# Sort by bottom_y descending (foreground ground objects first!)
trash_candidates.sort(key=lambda item: item['bottom_y'], reverse=True)
print(f"Total foreground candidates: {len(trash_candidates)}")
for idx, cand in enumerate(trash_candidates[:5]):
    print(f"Foreground Candidate #{idx+1}: %={cand['pct']}, BottomY={cand['bottom_y']}%")
