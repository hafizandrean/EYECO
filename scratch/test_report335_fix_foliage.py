import cv2
import numpy as np

img_path = 'public/uploads/upload_1784624558950-597302506.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]
img_area = width * height

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (5, 5), 0)
thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3)

contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

px1, py1, px2, py2 = 0.074 * width, 0.789 * height, (0.074 + 0.513) * width, (0.789 + 0.211) * height
hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

print(f"Total adaptive threshold contours: {len(contours)}")

candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    pct_area = (area / img_area) * 100
    
    # Filter for small package (0.3% to 15% of image area, distinct shape)
    if (0.003 * img_area) < area < (0.15 * img_area) and 0.4 < aspect_ratio < 3.0:
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
            
        cy = y + h / 2
        if (0.30 * height) < cy < (0.80 * height):
            # Check if region is predominantly plant foliage (mean H in 35-85 with S > 80)
            roi_hsv = hsv[y:y+h, x:x+w]
            mean_h = np.mean(roi_hsv[:, :, 0])
            mean_s = np.mean(roi_hsv[:, :, 1])
            
            if 35 <= mean_h <= 85 and mean_s > 90:
                continue  # Skip pure plant leaf cluster
                
            pct_x = round((x / width) * 100, 1)
            pct_y = round((y / height) * 100, 1)
            pct_w = round((w / width) * 100, 1)
            pct_h = round((h / height) * 100, 1)
            
            candidates.append({
                'pct': [pct_x, pct_y, pct_w, pct_h],
                'bbox': [x, y, w, h],
                'area_pct': round(pct_area, 2),
                'mean_h': round(mean_h, 1),
                'mean_s': round(mean_s, 1)
            })

candidates.sort(key=lambda b: b['area_pct'], reverse=True)
print(f"Filtered non-plant trash candidates: {len(candidates)}")
for idx, c in enumerate(candidates[:5]):
    print(f"Candidate #{idx+1}: %={c['pct']}, BBox={c['bbox']}, Area%={c['area_pct']}%, H={c['mean_h']}, S={c['mean_s']}")
