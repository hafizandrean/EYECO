import cv2
import numpy as np

img_path = 'public/uploads/upload_1784622821286-83239243.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]
img_area = width * height

# 1. Convert to HSV
hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

# 2. Mask out green foliage (H: 25 to 95)
green_mask = cv2.inRange(hsv, np.array([25, 25, 25]), np.array([95, 255, 255]))
non_plant_mask = cv2.bitwise_not(green_mask)

# 3. Mask out top canopy background (y < 40% of height)
surface_mask = np.zeros((height, width), dtype=np.uint8)
surface_mask[int(0.40 * height):int(0.95 * height), :] = 255

valid_mask = cv2.bitwise_and(non_plant_mask, surface_mask)

# 4. Convert non-plant surface to gray and detect bright/distinct packages
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
masked_gray = cv2.bitwise_and(gray, gray, mask=valid_mask)

# Edge detection on non-plant ground surfaces
edges = cv2.Canny(masked_gray, 50, 150)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
dilated = cv2.dilate(edges, kernel, iterations=2)

contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

px1, py1, px2, py2 = 0.504 * width, 0.252 * height, (0.504 + 0.347) * width, (0.252 + 0.621) * height

print(f"Total raw contours: {len(contours)}")

candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    pct_area = (area / img_area) * 100
    
    # Trash size: 0.15% to 4.0% of image area, height > 20px, width > 20px
    if (0.0015 * img_area) < area < (0.04 * img_area) and w > 20 and h > 20 and 0.4 < aspect_ratio < 2.8:
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
            
        # Check average brightness/saturation of candidate region
        roi_hsv = hsv[y:y+h, x:x+w]
        avg_sat = np.mean(roi_hsv[:, :, 1])
        avg_val = np.mean(roi_hsv[:, :, 2])
        
        pct_x = round((x / width) * 100, 1)
        pct_y = round((y / height) * 100, 1)
        pct_w = round((w / width) * 100, 1)
        pct_h = round((h / height) * 100, 1)
        
        candidates.append({
            'pct': [pct_x, pct_y, pct_w, pct_h],
            'bbox': [x, y, w, h],
            'area_pct': round(pct_area, 2),
            'sat': round(avg_sat, 1),
            'val': round(avg_val, 1)
        })

candidates.sort(key=lambda b: b['area_pct'], reverse=True)
for idx, c in enumerate(candidates[:10]):
    print(f"Filtered Candidate #{idx+1}: %={c['pct']}, BBox={c['bbox']}, Sat={c['sat']}, Val={c['val']}")
