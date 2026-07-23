import cv2
import numpy as np

img_path = 'public/uploads/upload_1784624558950-597302506.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]
img_area = width * height

hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
# Foliage mask: H 25-95, S 25-255, V 25-255
green_mask = cv2.inRange(hsv, np.array([25, 20, 20]), np.array([95, 255, 255]))
non_plant_mask = cv2.bitwise_not(green_mask)

surface_mask = np.zeros((height, width), dtype=np.uint8)
surface_mask[int(0.25 * height):int(0.98 * height), :] = 255
valid_mask = cv2.bitwise_and(non_plant_mask, surface_mask)

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
masked_gray = cv2.bitwise_and(gray, gray, mask=valid_mask)

# Test Canny with lower threshold 20, 80 OR otsu / adaptive:
edges = cv2.Canny(masked_gray, 25, 90)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
dilated = cv2.dilate(edges, kernel, iterations=2)

contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

px1, py1, px2, py2 = 0.074 * width, 0.789 * height, (0.074 + 0.513) * width, (0.789 + 0.211) * height

print(f"Report 335 total raw contours: {len(contours)}")

candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    pct_area = (area / img_area) * 100
    
    if (0.002 * img_area) < area < (0.15 * img_area) and w > 25 and h > 25 and 0.4 < aspect_ratio < 3.0:
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
        
        candidates.append({
            'pct': [pct_x, pct_y, pct_w, pct_h],
            'bbox': [x, y, w, h],
            'area_pct': round(pct_area, 2)
        })

candidates.sort(key=lambda b: b['area_pct'], reverse=True)
for idx, c in enumerate(candidates[:5]):
    print(f"Candidate #{idx+1}: %={c['pct']}, BBox={c['bbox']}, Area%={c['area_pct']}%")
