import cv2
import numpy as np

img_path = 'public/uploads/upload_1784622821286-83239243.jpeg'
image = cv2.imread(img_path)
height, width = image.shape[:2]
img_area = width * height

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (5, 5), 0)
thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3)

contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

px1, py1, px2, py2 = 0.504 * width, 0.252 * height, (0.504 + 0.347) * width, (0.252 + 0.621) * height

trash_candidates = []
for c in contours:
    x, y, w, h = cv2.boundingRect(c)
    area = w * h
    aspect_ratio = float(w) / h if h > 0 else 0
    pct_area = (area / img_area) * 100
    
    # Filter for realistic small trash item (0.2% to 3.5% of image area)
    if (0.002 * img_area) < area < (0.035 * img_area) and 0.4 < aspect_ratio < 3.0:
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
        if (0.30 * height) < cy < (0.85 * height):
            trash_candidates.append({
                'box': [float(x), float(y), float(w), float(h)],
                'pct': [round((x/width)*100,1), round((y/height)*100,1), round((w/width)*100,1), round((h/height)*100,1)],
                'area_pct': round(pct_area, 2)
            })

trash_candidates.sort(key=lambda item: item['area_pct'], reverse=True)
print(f"Total realistic trash candidates (area < 3.5%): {len(trash_candidates)}")
for idx, cand in enumerate(trash_candidates[:5]):
    print(f"Candidate #{idx+1}: %={cand['pct']}, Area%={cand['area_pct']}%")
