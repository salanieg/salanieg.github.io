import urllib.request
import zipfile
import io
import os
from PIL import Image

TARGET_DIR = os.path.join("mansion", "assets", "textures", "terrain")
os.makedirs(TARGET_DIR, exist_ok=True)

PACKS = [
    {
        "name": "grass",
        "url": "https://ambientcg.com/get?file=Grass001_1K-JPG.zip",
        "prefix": "Grass001_1K"
    },
    {
        "name": "rock",
        "url": "https://ambientcg.com/get?file=Rock020_1K-JPG.zip",
        "prefix": "Rock020_1K"
    },
    {
        "name": "sand",
        "url": "https://ambientcg.com/get?file=Ground054_1K-JPG.zip",
        "prefix": "Ground054_1K"
    }
]

headers = {'User-Agent': 'Mozilla/5.0'}

for pack in PACKS:
    print(f"Downloading {pack['name']} from {pack['url']}...")
    req = urllib.request.Request(pack['url'], headers=headers)
    with urllib.request.urlopen(req) as resp:
        zip_data = resp.read()
    
    with zipfile.ZipFile(io.BytesIO(zip_data)) as z:
        namelist = z.namelist()
        print(f"  Files in zip: {namelist}")
        
        # Color
        color_file = next((f for f in namelist if "Color" in f or "Diffuse" in f or "BaseColor" in f), None)
        # Normal (prefer NormalGL, fallback to NormalDX or Normal)
        normal_file = next((f for f in namelist if "NormalGL" in f), None) or next((f for f in namelist if "Normal" in f), None)
        # Roughness
        rough_file = next((f for f in namelist if "Roughness" in f), None)

        if color_file:
            img = Image.open(io.BytesIO(z.read(color_file))).convert("RGB")
            out_p = os.path.join(TARGET_DIR, f"{pack['name']}_color.webp")
            img.save(out_p, "WEBP", quality=85)
            print(f"  Saved {out_p} ({os.path.getsize(out_p)//1024} KB)")

        if normal_file:
            img = Image.open(io.BytesIO(z.read(normal_file))).convert("RGB")
            out_p = os.path.join(TARGET_DIR, f"{pack['name']}_normal.webp")
            img.save(out_p, "WEBP", quality=80)
            print(f"  Saved {out_p} ({os.path.getsize(out_p)//1024} KB)")

        if rough_file:
            img = Image.open(io.BytesIO(z.read(rough_file))).convert("L")
            out_p = os.path.join(TARGET_DIR, f"{pack['name']}_roughness.webp")
            img.save(out_p, "WEBP", quality=80)
            print(f"  Saved {out_p} ({os.path.getsize(out_p)//1024} KB)")

print("Alle Terrain-Texturen erfolgreich vorbereitet!")
