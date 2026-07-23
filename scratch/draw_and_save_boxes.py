import cv2

img_path = 'public/uploads/upload_1784621167740-158919581.jpeg'
image = cv2.imread(img_path)
h_img, w_img = image.shape[:2]

box_pct = [27.5, 40.5, 24.5, 9.8]
x = int((box_pct[0] / 100) * w_img)
y = int((box_pct[1] / 100) * h_img)
w = int((box_pct[2] / 100) * w_img)
h = int((box_pct[3] / 100) * h_img)

cv2.rectangle(image, (x, y), (x + w, y + h), (0, 0, 255), 4)
cv2.putText(image, "FOOD_WRAPPER 0.88", (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

out_path = 'scratch/annotated_milkbox_tight_full.jpg'
cv2.imwrite(out_path, image)
print(f"Saved tight full annotated image to {out_path} with box: x={x}, y={y}, w={w}, h={h}")
