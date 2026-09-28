import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
import os
import json

# 1. Parameter der Insel
SIZE = 1024  # Auflösung in Pixeln (entspricht 1024x1024 Metern)
ISLAND_RADIUS = 1.0  # Begrenzung der Inselform
CRATER_RADIUS = 0.15 # Größe des Vulkankraters (~64m Radius)
OCEAN_LEVEL = 0.08   # Höhe des Wasserspiegels

# 2. 2D-Koordinatensystem erstellen (-1.2 bis 1.2 entspricht 1024 Metern => 1.0 = ~426.67m)
x = np.linspace(-1.2, 1.2, SIZE)
y = np.linspace(-1.2, 1.2, SIZE)
X, Y = np.meshgrid(x, y)
R = np.sqrt(X**2 + Y**2)  # Entfernung zum Zentrum

# 3. Grundform berechnen (geschwungener Vulkankegel)
cone = np.clip(1.0 - (R / ISLAND_RADIUS), 0, 1) ** 1.8

# 4. Caldera (Krater) in der Mitte ausheben
crater = np.clip(1.0 - (R / CRATER_RADIUS), 0, 1) ** 2
volcano_base = cone - (crater * 0.6)
volcano_base = np.clip(volcano_base, 0, 1)

# 4b. Natürliche Gebirgspässe / Canyons an allen 5 Ausgängen der Villa:
# Durchbrüche im Kraterrand, damit man zu Fuß aus allen 5 Portalen ins Umland wandern kann
pass_angles = [
    0.314159265,   # 18° (Kunst & Chillen)
    1.570796327,   # 90° (Chillen & Gaming / Süd)
    2.827433388,   # 162° (Gaming & Lager)
    -2.199114858,  # 234° / -126° (Lager & Arbeit)
    -0.942477796   # 306° / -54° (Arbeit & Kunst)
]
current_angle = np.arctan2(Y, X)
for p_ang in pass_angles:
    diff = np.abs(current_angle - p_ang)
    diff = np.where(diff > np.pi, 2 * np.pi - diff, diff)
    pass_angular = np.clip(1.0 - (diff / 0.18), 0.0, 1.0)
    pass_radial = np.clip((R - 0.06) / (CRATER_RADIUS + 0.10), 0.0, 1.0)
    pass_cut = (pass_angular ** 2) * (1.0 - (pass_radial - 0.5)**2 * 4.0) * 0.32
    volcano_base = np.clip(volcano_base - np.maximum(0.0, pass_cut), 0, 1)

# 5. Fraktales Rauschen (1/f Noise)
np.random.seed(42)
white_noise = np.random.normal(0, 1, (SIZE, SIZE))
f = np.fft.fft2(white_noise)
fshift = np.fft.fftshift(f)

fx = np.arange(-SIZE//2, SIZE//2)
fy = np.arange(-SIZE//2, SIZE//2)
FX, FY = np.meshgrid(fx, fy)
F_R = np.sqrt(FX**2 + FY**2)
F_R[SIZE//2, SIZE//2] = 1.0

alpha = 1.7
fshift = fshift / (F_R ** alpha)
f_ishift = np.fft.ifftshift(fshift)
noise = np.real(np.fft.ifft2(f_ishift))
noise = (noise - np.min(noise)) / (np.max(noise) - np.min(noise))

# 6. Rauschen und Vulkanform verschmelzen
roughness = 0.4 * cone
heightmap = volcano_base + (noise - 0.5) * roughness

# 6b. Fundament-Plateau fuer die Villa im Zentrum der Caldera:
# Villa-Radius = 24m (0.056 Einheiten). Bis 28m (0.065) absolut flach, bis 44m (0.103) sanfter Uebergang
CENTER_RADIUS = 28.0 / 426.67 # ~0.0656
BLEND_RADIUS = 44.0 / 426.67  # ~0.1031

caldera_center_val = volcano_base[SIZE//2, SIZE//2]

# Smoothstep Blending:
blend_factor = np.clip((R - CENTER_RADIUS) / (BLEND_RADIUS - CENTER_RADIUS), 0.0, 1.0)
blend_factor = blend_factor * blend_factor * (3.0 - 2.0 * blend_factor)
heightmap = caldera_center_val + (heightmap - caldera_center_val) * blend_factor

# 7. Meeresspiegel anwenden und final normalisieren
heightmap[heightmap < OCEAN_LEVEL] = OCEAN_LEVEL
heightmap_norm = (heightmap - OCEAN_LEVEL) / (np.max(heightmap) - OCEAN_LEVEL)

center_h_norm = float(heightmap_norm[SIZE//2, SIZE//2])
print(f"Normalisierter Hoehenwert im Zentrum der Villa: {center_h_norm:.5f}")

out_dir = os.path.join("mansion", "assets", "textures", "terrain")
os.makedirs(out_dir, exist_ok=True)

# 8. Export als 16-bit Graustufen-PNG (fuer Blender / hochpraezise Tools)
heightmap_16bit = np.uint16(np.clip(heightmap_norm * 65535.0, 0, 65535))
img_16 = Image.fromarray(heightmap_16bit)
img_16.save(os.path.join(out_dir, "heightmap_16bit.png"))

# 8b. Export als 8-bit Graustufen-WebP & PNG (fuer Three.js Texturen)
heightmap_8bit = np.uint8(np.clip(heightmap_norm * 255.0, 0, 255))
img_8 = Image.fromarray(heightmap_8bit, mode='L')
img_8.save(os.path.join(out_dir, "heightmap.png"))
img_8.save(os.path.join(out_dir, "heightmap.webp"), quality=95)

# 8c. Hoehendaten als Float32-Array fuer 0ms JS-Kollision
collision_grid_size = 256
step = SIZE // collision_grid_size
col_grid = heightmap_norm[::step, ::step].astype(np.float32)
col_grid.tofile(os.path.join(out_dir, "terrain_heights_256.bin"))

# Metadata JSON
meta = {
    "worldSize": 1024.0,
    "gridSize": collision_grid_size,
    "centerHeightNorm": center_h_norm,
    "maxHeight": 120.0,
    "calderaFloorY": 0.0
}
with open(os.path.join(out_dir, "terrain_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)

# 9. Farbige Vorschau
plt.figure(figsize=(10, 8))
plt.imshow(heightmap_norm, cmap='terrain')
plt.colorbar(label='Relative Hoehe')
plt.title('Vulkaninsel mit Caldera-Plateau & Sued-Pass')
plt.axis('off')
plt.savefig(os.path.join(out_dir, "terrain_preview.png"), bbox_inches='tight')
print("Terrain-Heightmap erfolgreich generiert!")
