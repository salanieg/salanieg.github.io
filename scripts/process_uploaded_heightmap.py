import os
import json
import shutil
import numpy as np
from PIL import Image

SRC_PATH = r"C:\Users\denm\.gemini\antigravity\brain\a979d5b3-34a9-4ae8-bb8f-147cec5f1ec5\.user_uploaded\media_1790547302484.png"
OUT_DIR = os.path.join("mansion", "assets", "textures", "terrain")
os.makedirs(OUT_DIR, exist_ok=True)

# 1. Rohdatei als Backup sichern
shutil.copy2(SRC_PATH, os.path.join(OUT_DIR, "heightmap_raw.png"))

# 2. Bild laden und normalisieren
img = Image.open(SRC_PATH).convert("L")
arr = np.array(img, dtype=np.float32) / 255.0

SIZE = arr.shape[0]
c = SIZE // 2
center_val = float(arr[c, c])

# 3. Flaches Fundament-Plateau fuer die Villa im Zentrum
# Villa Hof-Radius = 24.0m, Terrassen-Stufe bis 28.5m.
# Blending von 28.5m bis 46.0m in die organische Naturlandschaft
y, x = np.ogrid[:SIZE, :SIZE]
r = np.sqrt((x - c)**2 + (y - c)**2)

r_flat = 33.0
r_blend = 68.0

blend = np.clip((r - r_flat) / (r_blend - r_flat), 0.0, 1.0)
smooth_blend = blend * blend * (3.0 - 2.0 * blend)

processed = center_val + (arr - center_val) * smooth_blend

print(f"Original Center Value: {center_val:.5f}")
print(f"Processed Min: {processed.min():.5f}, Max: {processed.max():.5f}")

# 4. 8-Bit PNG & WebP exportieren
arr_8bit = np.uint8(np.clip(processed * 255.0, 0, 255))
img_8 = Image.fromarray(arr_8bit, mode='L')
img_8.save(os.path.join(OUT_DIR, "heightmap.png"))
img_8.save(os.path.join(OUT_DIR, "heightmap.webp"), quality=95)

# 5. 16-Bit PNG fuer hochpraezise Tools (Blender)
arr_16bit = np.uint16(np.clip(processed * 65535.0, 0, 65535))
img_16 = Image.fromarray(arr_16bit)
img_16.save(os.path.join(OUT_DIR, "heightmap_16bit.png"))

# 6. Float32 Binär-Array fuer 256x256 WebGL Grid (exakt 256 KB)
collision_grid_size = 256
step = SIZE // collision_grid_size
col_grid = processed[::step, ::step].astype(np.float32)
bin_path = os.path.join(OUT_DIR, "terrain_heights_256.bin")
col_grid.tofile(bin_path)
print(f"Binary height grid saved: {os.path.getsize(bin_path)} bytes")

# 7. Metadata JSON
meta = {
    "worldSize": 1024.0,
    "gridSize": 256,
    "centerHeightNorm": center_val,
    "maxHeight": 140.0,
    "oceanLevel": -31.5,
    "calderaFloorY": 0.0
}
with open(os.path.join(OUT_DIR, "terrain_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)

print("Heightmap erfolgreich verarbeitet und exportiert!")
