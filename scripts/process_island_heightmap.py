import os
import json
import base64
import numpy as np
from PIL import Image

SRC_PATH = os.path.abspath(os.path.join("mansion", "assets", "textures", "terrain", "Heightmap_08_Island.png"))
OUT_DIR = os.path.abspath(os.path.join("mansion", "assets", "textures", "terrain"))
os.makedirs(OUT_DIR, exist_ok=True)

print("--- 1. Lade Heightmap_08_Island.png ---")
raw_img = Image.open(SRC_PATH)
print(f"Original: Size={raw_img.size}, Mode={raw_img.mode}")

# 1. Auf 2048x2048 mit Lanczos-Resampling skalieren (höchste Qualität, perfekt komprimierbar)
TARGET_RES = 2048
img_2048 = raw_img.resize((TARGET_RES, TARGET_RES), Image.Resampling.LANCZOS)
arr = np.array(img_2048, dtype=np.float32)

SIZE = TARGET_RES
c = SIZE // 2
ppm = SIZE / 2000.0  # Pixel pro Meter bei 2000m (2x2 km) Weltgröße
print(f"Arbeitsauflösung: {SIZE}x{SIZE}, Pixel pro Meter: {ppm:.4f}")

# 2. Koordinaten und Abstände in Metern berechnen
y, x = np.ogrid[:SIZE, :SIZE]
xm = (x - c) / ppm
zm = (y - c) / ppm

dist_dome = np.sqrt(xm**2 + zm**2)
dist_heli = np.sqrt(xm**2 + (zm - 36.0)**2)

# 3. Flaches Fundament-Plateau für die Villa und das Helipad
CENTER_RAW = 19289.0
OCEAN_RAW = 7281.0

# Dome-Plateau: Radius 33m flach bei 0m, weicher Übergang bis 55m
dome_blend = np.clip((dist_dome - 33.0) / (55.0 - 33.0), 0.0, 1.0)
smooth_dome = dome_blend * dome_blend * (3.0 - 2.0 * dome_blend)

# Helipad-Plateau: Radius 10m flach bei 0m, weicher Übergang bis 18m
heli_blend = np.clip((dist_heli - 10.0) / (18.0 - 10.0), 0.0, 1.0)
smooth_heli = heli_blend * heli_blend * (3.0 - 2.0 * heli_blend)

# Kombinierter Maskierungsfaktor (0.0 = exakt flach auf Villa-Höhe, 1.0 = Naturlandschaft)
combined_factor = np.minimum(smooth_dome, smooth_heli)

# Natürliches Terrain mit flachem Villa- und Helipad-Plateau verschmelzen
arr_plateau = CENTER_RAW + (arr - CENTER_RAW) * combined_factor

# 4. Physische Höhen in Metern berechnen mit 50% mehr Plastizität (1.5x)
# Meeresspiegel (-47.25m), Villa-Zentrum (0.0m), Berggipfel (+60.225m), Meeresboden (-54.0m)
CENTER_RAW = 19289.0
WATERLINE_RAW = 7800.0
SHELF_RAW = 7281.0

SCALE_PLASTICITY = 1.50
PEAK_MAX_M = 40.15 * SCALE_PLASTICITY     # 60.225m
WATERLINE_M = 31.50 * SCALE_PLASTICITY   # 47.25m

heights_m = np.zeros_like(arr_plateau, dtype=np.float32)

# a) Berggipfel über Zentrum (19289 bis 25370)
mask_peak = arr_plateau >= CENTER_RAW
heights_m[mask_peak] = (arr_plateau[mask_peak] - CENTER_RAW) / (25370.0 - CENTER_RAW) * PEAK_MAX_M

# b) Land bis zur Wasserlinie (7800 bis 19289)
mask_land = np.logical_and(arr_plateau < CENTER_RAW, arr_plateau >= WATERLINE_RAW)
heights_m[mask_land] = (arr_plateau[mask_land] - CENTER_RAW) / (CENTER_RAW - WATERLINE_RAW) * WATERLINE_M

# c) Küsten-Hang unter Wasser zur Schelfkante (7281 bis 7800) -> fällt sanft ab
mask_shelf = np.logical_and(arr_plateau < WATERLINE_RAW, arr_plateau >= SHELF_RAW)
t_shelf = (WATERLINE_RAW - arr_plateau[mask_shelf]) / (WATERLINE_RAW - SHELF_RAW)
heights_m[mask_shelf] = -WATERLINE_M - t_shelf * (4.50 * SCALE_PLASTICITY)

# d) Tiefer Meeresboden & Gräben (unter 7281)
mask_deep = arr_plateau < SHELF_RAW
t_deep = (SHELF_RAW - arr_plateau[mask_deep]) / SHELF_RAW
heights_m[mask_deep] = (-WATERLINE_M - 4.50 * SCALE_PLASTICITY) - t_deep * (14.0 * SCALE_PLASTICITY)

print(f"Höhenmeter: Min={heights_m.min():.2f}m, Meeresboden={heights_m[arr_plateau <= SHELF_RAW].mean():.2f}m, Villa={heights_m[c, c]:.2f}m, Max={heights_m.max():.2f}m")

# 5. Normalisierung in Three.js-kompatibles Format [0.0, 1.0]
TERRAIN_MAX_HEIGHT = 140.0 * SCALE_PLASTICITY # 210.0
TERRAIN_CENTER_HEIGHT_NORM = (50.0 * SCALE_PLASTICITY) / TERRAIN_MAX_HEIGHT # 0.35714286
TERRAIN_OCEAN_LEVEL = -WATERLINE_M # -47.25

h_norm = (heights_m / TERRAIN_MAX_HEIGHT) + TERRAIN_CENTER_HEIGHT_NORM
h_norm = np.clip(h_norm, 0.0, 1.0)

print(f"h_norm: Min={h_norm.min():.5f}, Center={h_norm[c, c]:.5f}, Max={h_norm.max():.5f}")

# 6. Float32 Binär-Array für 256x256 WebGL Grid mit Flächen-Resampling & sanfter Glättung
GRID_SIZE = 256
img_norm = Image.fromarray(h_norm)
img_grid_256 = img_norm.resize((GRID_SIZE, GRID_SIZE), Image.Resampling.LANCZOS)
col_grid = np.array(img_grid_256, dtype=np.float32)

# Sanfte Gauß-Glättung (sigma=1.0) eliminiert Polygon-Kanten und Terrassenstufen komplett
def gaussian_smooth_2d(arr, sigma=1.0):
    radius = int(np.ceil(3 * sigma))
    x = np.arange(-radius, radius + 1)
    kernel = np.exp(-0.5 * (x / sigma)**2)
    kernel /= kernel.sum()
    
    pad_h = np.pad(arr, ((0, 0), (radius, radius)), mode='edge')
    temp = np.zeros_like(arr)
    for i, w in enumerate(kernel):
        temp += w * pad_h[:, i:i+arr.shape[1]]
        
    pad_v = np.pad(temp, ((radius, radius), (0, 0)), mode='edge')
    out = np.zeros_like(arr)
    for i, w in enumerate(kernel):
        out += w * pad_v[i:i+arr.shape[0], :]
        
    return out

col_grid = gaussian_smooth_2d(col_grid, sigma=1.0)

# Villa- & Helipad-Schonbereiche auf dem 256er Grid exakt plan bei 0.00m absichern
c_grid = GRID_SIZE / 2.0
step_m = 2000.0 / GRID_SIZE
gy, gx = np.ogrid[:GRID_SIZE, :GRID_SIZE]
g_xm = (gx - c_grid + 0.5) * step_m
g_zm = (gy - c_grid + 0.5) * step_m
g_dist_dome = np.sqrt(g_xm**2 + g_zm**2)
g_dist_heli = np.sqrt(g_xm**2 + (g_zm - 36.0)**2)

center_val = float(TERRAIN_CENTER_HEIGHT_NORM)
col_grid[g_dist_dome <= 33.0] = center_val
col_grid[g_dist_heli <= 10.0] = center_val

heli_trans = np.logical_and(g_dist_heli > 10.0, g_dist_heli < 18.0)
th = (g_dist_heli[heli_trans] - 10.0) / 8.0
sth = th * th * (3.0 - 2.0 * th)
col_grid[heli_trans] = center_val + (col_grid[heli_trans] - center_val) * sth

bin_path = os.path.join(OUT_DIR, "terrain_heights_256.bin")
col_grid.tofile(bin_path)
print(f"Binärdatei exportiert (geglättet): {bin_path} ({os.path.getsize(bin_path)} Bytes)")

# 7. JavaScript Data-Array aktualisieren
b64_str = base64.b64encode(col_grid.tobytes()).decode('ascii')
js_path = os.path.abspath(os.path.join("mansion", "js", "terrain_data.js"))
with open(js_path, "w", encoding="utf-8") as f:
    f.write(f'window.TERRAIN_HEIGHTS_256 = "{b64_str}";\n')
print(f"terrain_data.js aktualisiert: {js_path}")

# 8. Komprimierte Bilddateien für Web & Tools exportieren
# a) WebP (8-Bit hochkomprimiert, ultra-schnell für Web)
arr_8bit = (np.clip(col_grid * 255.0, 0, 255)).astype(np.uint8)
img_8bit = Image.fromarray(arr_8bit, mode='L')
webp_path = os.path.join(OUT_DIR, "heightmap.webp")
img_8bit.save(webp_path, quality=90)
print(f"WebP exportiert: {webp_path} ({os.path.getsize(webp_path)} Bytes)")

# b) PNG 8-Bit Preview
png_path = os.path.join(OUT_DIR, "heightmap.png")
img_8bit.save(png_path, optimize=True)
print(f"PNG 8-Bit exportiert: {png_path} ({os.path.getsize(png_path)} Bytes)")

# c) PNG 16-Bit (komprimiert für 3D-Software wie Blender)
arr_16bit = (np.clip(col_grid * 65535.0, 0, 65535)).astype(np.uint16)
img_16bit = Image.fromarray(arr_16bit)
png16_path = os.path.join(OUT_DIR, "heightmap_16bit.png")
img_16bit.save(png16_path, optimize=True)
print(f"PNG 16-Bit exportiert: {png16_path} ({os.path.getsize(png16_path)} Bytes)")

# d) Preview-Bild
prev_img = img_8bit.resize((512, 512), Image.Resampling.LANCZOS)
prev_path = os.path.join(OUT_DIR, "terrain_preview.png")
prev_img.save(prev_path, optimize=True)
print(f"Preview exportiert: {prev_path} ({os.path.getsize(prev_path)} Bytes)")

# 9. Metadata JSON exportieren
meta = {
    "worldSize": 2000.0,
    "gridSize": GRID_SIZE,
    "centerHeightNorm": float(TERRAIN_CENTER_HEIGHT_NORM),
    "maxHeight": float(TERRAIN_MAX_HEIGHT),
    "oceanLevel": float(TERRAIN_OCEAN_LEVEL),
    "peakHeightMeters": float(heights_m.max()),
    "calderaFloorY": 0.0
}
meta_path = os.path.join(OUT_DIR, "terrain_meta.json")
with open(meta_path, "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)
print(f"Metadata exportiert: {meta_path}")

print("\n--- Heightmap erfolgreich mit 50% mehr Plastizität und Kantenglättung verarbeitet! ---")
