from PIL import Image
import os

images = [
    r"C:\Users\mpari\.gemini\antigravity\brain\e88b016b-1d32-4580-8ed6-b5fe8ecb728f\media__1777606797221.png",
    r"C:\Users\mpari\.gemini\antigravity\brain\e88b016b-1d32-4580-8ed6-b5fe8ecb728f\media__1777606881294.png"
]

for img_path in images:
    if os.path.exists(img_path):
        with Image.open(img_path) as img:
            print(f"{os.path.basename(img_path)}: {img.size}")
    else:
        print(f"{img_path} not found")
