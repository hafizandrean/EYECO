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
edges = cv2.Canny(masked_gray, 50, 150)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
dilated = cv2.dilate(edges, kernel, iterations=2)
contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

px1, py1, px2, py2 = 0.504 * width, 0.252 * height, (0.504 + 0.347) * width, (0.252 + 0.621) * height

trash_candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    
    # Real trash item size: area between 0.3% and 4.0% of image area, width > 35px, height > 35px
    if (0.003 * img_area) < area < (0.04 * img_area) and w > 35 and h > 35 and 0.4 < aspect_ratio < 2.5:
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

# Sort by bottom_y descending
trash_candidates.sort(key=lambda item: item['bottom_y'], reverse=True)

# Pick distinct trash objects with NMS center distance filter >= 150px
selected_boxes = []
for cand in trash_candidates:
    cx, cy, cw, ch = cand['bbox']
    center_x = cx + cw / 2.0
    center_y = cy + ch / 2.0
    
    overlap_with_selected = False
    for sb in selected_boxes:
        sx, sy, sw, sh = sb
        scenter_x = sx + sw / 2.0
        scenter_y = sy + sh / 2.0
        dist = np.sqrt((center_x - scenter_x)**2 + (center_y - scenter_y)**2)
        
        if dist < 150.0:  # 150px minimum separation between distinct trash objects
            overlap_with_selected = True
            break
            
    if not overlap_with_selected:
        selected_boxes.append([cx, cy, cw, ch])

print(f"Clean Selected Trash Objects: {len(selected_boxes)}")
for idx, b in enumerate(selected_boxes):
    pct_x = round((b[0] / width) * 100, 1)
    pct_y = round((b[1] / height) * 100, 1)
    pct_w = round((b[2] / width) * 100, 1)
    pct_h = round((b[3] / height) * 100, 1)
    print(f"Clean Box #{idx+1}: %={[pct_x, pct_y, pct_w, pct_h]}, BBox={b}")
