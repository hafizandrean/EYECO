import cv2

img_path = 'public/uploads/upload_1784622821286-83239243.jpeg'
image = cv2.imread(img_path)
h_img, w_img = image.shape[:2]

# Ultra Milk Carton on front ledge: [9.0%, 78.0%, 7.5%, 11.0%]
# Plastic Cup in garden: [16.1%, 68.0%, 8.5%, 7.5%]
boxes = [
    {"class": "food_wrapper", "conf": 0.88, "pct": [9.0, 78.0, 7.5, 11.0]},
    {"class": "food_wrapper", "conf": 0.88, "pct": [16.1, 68.0, 8.5, 7.5]}
]

for b in boxes:
    x = int((b['pct'][0] / 100) * w_img)
    y = int((b['pct'][1] / 100) * h_img)
    w = int((b['pct'][2] / 100) * w_img)
    h = int((b['pct'][3] / 100) * h_img)
    cv2.rectangle(image, (x, y), (x + w, y + h), (0, 0, 255), 4)
    cv2.putText(image, f"{b['class']} {b['conf']}", (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

out_path = 'scratch/annotated_report309_perfect.jpg'
cv2.imwrite(out_path, image)
print(f"Saved perfect annotated Report 309 image to {out_path}")
