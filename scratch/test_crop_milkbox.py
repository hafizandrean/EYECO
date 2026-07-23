import cv2
import numpy as np

img_path = 'public/uploads/upload_1784621167740-158919581.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]

print(f"Image dimensions: {width}x{height}")

# Convert to HSV & LAB
hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

# Green foliage mask
green_mask = cv2.inRange(hsv, np.array([25, 30, 30]), np.array([95, 255, 255]))
non_plant = cv2.bitwise_and(gray, gray, mask=cv2.bitwise_not(green_mask))

# Find edge/contrast regions
edges = cv2.Canny(non_plant, 50, 150)
contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

img_area = width * height
found_boxes = []

for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    
    # Filter reasonable object size
    if (0.005 * img_area) < area < (0.15 * img_area) and 0.5 < aspect_ratio < 2.5:
        # Check text/edge density inside box
        roi_edges = edges[y:y+h, x:x+w]
        edge_density = np.sum(roi_edges > 0) / area if area > 0 else 0
        
        # Milk box has high internal edge density (due to brand text/logos) and is not at extreme top/bottom
        pct_x = round((x / width) * 100, 1)
        pct_y = round((y / height) * 100, 1)
        pct_w = round((w / width) * 100, 1)
        pct_h = round((h / height) * 100, 1)
        
        found_boxes.append({
            'pct': [pct_x, pct_y, pct_w, pct_h],
            'bbox': [x, y, w, h],
            'edge_density': round(edge_density, 3),
            'area': area
        })

# Sort by edge density (printed package text has high edge density!)
found_boxes.sort(key=lambda b: b['edge_density'], reverse=True)

for idx, b in enumerate(found_boxes[:5]):
    print(f"Candidate #{idx+1}: Box % = {b['pct']}, Edge Density = {b['edge_density']}, BBox = {b['bbox']}")
