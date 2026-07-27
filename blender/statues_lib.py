# ============================================================================
# statues_lib.py  —  NEW, self-contained builder for two marble monuments:
#   Karl Marx  (right hand laid on his heart)   and
#   Friedrich Engels  (arms folded across the chest)
# standing full-figure on Roman pedestals.
#
# Written from scratch for this task; it deliberately does NOT use any of the
# older statue scripts. It only borrows the generic mesh/UV/material plumbing
# from lib_common (bm_to_obj, tube, material, collection, link).
#
# Everything is baked into world-space vertices (object origin stays at 0), so
# the glTF export needs no "apply modifiers" pass. Front of every figure = +Y.
# ============================================================================
import math
import os

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise

import lib_common as L

REPO = L.REPO
TEX_DIR = os.path.join(REPO, "blender", "textures")


# --------------------------------------------------------------- transforms --
def make_T(base=(0, 0, 0), scale=1.0, yaw=0.0):
    """World placement: local(feet at z0, front +Y) -> world."""
    R = Matrix.Rotation(yaw, 3, 'Z')
    b = Vector(base)

    def T(p):
        return R @ (Vector(p) * scale) + b
    return T


def _finish(bm, name, coll, mat, smooth_angle=math.radians(38), uv_scale=1.2):
    return L.bm_to_obj(bm, name, coll=coll, mat=mat, smooth_angle=smooth_angle,
                       uv_scale=uv_scale, location=(0, 0, 0))


# ------------------------------------------------------------------ marble ---
def _fbm_grid(w, h, cells, octaves, seed):
    """Tileable value-noise turbulence in [0,1] as a (h,w) numpy array."""
    import numpy as np
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, norm = 1.0, 0.0
    yy = (np.arange(h) + 0.5) / h
    xx = (np.arange(w) + 0.5) / w
    gx, gy = np.meshgrid(xx, yy)
    for o in range(octaves):
        c = cells * (2 ** o)
        grid = rng.random((c, c), np.float32)
        fx = gx * c
        fy = gy * c
        x0 = np.floor(fx).astype(int) % c
        y0 = np.floor(fy).astype(int) % c
        x1 = (x0 + 1) % c
        y1 = (y0 + 1) % c
        tx = fx - np.floor(fx)
        ty = fy - np.floor(fy)
        sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
        sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
        v00 = grid[y0, x0]; v10 = grid[y0, x1]
        v01 = grid[y1, x0]; v11 = grid[y1, x1]
        top = v00 * (1 - sx) + v10 * sx
        bot = v01 * (1 - sx) + v11 * sx
        acc += amp * (top * (1 - sy) + bot * sy)
        norm += amp
        amp *= 0.5
    return acc / norm


def make_stone_texture(name, size=1024, seed=7, kind="marble"):
    """Procedural marble / travertine PNG -> packed bpy image."""
    import numpy as np
    if not os.path.isdir(TEX_DIR):
        os.makedirs(TEX_DIR, exist_ok=True)
    img_path = os.path.join(TEX_DIR, name + ".png")

    turb = _fbm_grid(size, size, cells=4, octaves=6, seed=seed)
    turb2 = _fbm_grid(size, size, cells=9, octaves=5, seed=seed + 100)
    xx = np.linspace(0, 1, size, endpoint=False)[None, :].repeat(size, 0)
    yy = np.linspace(0, 1, size, endpoint=False)[:, None].repeat(size, 1)

    if kind == "marble":
        base = np.array([0.910, 0.905, 0.888])
        vein = np.array([0.585, 0.575, 0.560])
        vein2 = np.array([0.72, 0.705, 0.685])
        # two crossing families of thin, mostly-directional veins
        a = np.sin((xx * 3.0 + yy * 0.8 + turb * 1.35) * math.pi * 2.0)
        v = np.clip(1.0 - np.abs(a), 0, 1) ** 7
        b = np.sin((xx * 1.1 - yy * 4.2 + turb2 * 1.05) * math.pi * 2.0)
        v2 = np.clip(1.0 - np.abs(b), 0, 1) ** 11
        grain = (turb2 - 0.5) * 0.04
    else:  # travertine / warm limestone for the pedestals
        base = np.array([0.795, 0.740, 0.640])
        vein = np.array([0.595, 0.530, 0.430])
        vein2 = np.array([0.700, 0.640, 0.545])
        a = np.sin((yy * 3.4 + turb * 1.6) * math.pi * 2.0)   # horizontal beds
        v = np.clip(1.0 - np.abs(a), 0, 1) ** 4
        b = np.sin((xx * 5.5 + turb2 * 4.0) * math.pi * 2.0)
        v2 = np.clip(1.0 - np.abs(b), 0, 1) ** 8
        grain = (turb2 - 0.5) * 0.08

    col = base[None, None, :] * (1.0 + grain[..., None])
    col = col * (1 - v[..., None]) + vein[None, None, :] * v[..., None]
    col = col * (1 - 0.5 * v2[..., None]) + vein2[None, None, :] * (0.5 * v2[..., None])
    col = np.clip(col, 0, 1)

    rgba = np.ones((size, size, 4), np.float32)
    rgba[..., :3] = col

    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.pixels = rgba.reshape(-1).tolist()
    img.file_format = 'PNG'
    img.filepath_raw = img_path
    try:
        img.save()
    except Exception:
        pass
    img.pack()
    return img


def stone_material(name, image, rough=0.36):
    # NB: no Bump/Normal wiring — glTF cannot carry a procedural bump, and the
    # exporter would otherwise bake the (high-contrast) albedo image into a
    # bogus normalTexture, which shows up as black speckles under lighting in
    # three.js. The veining lives in the albedo only.
    if name in L._mat_cache:
        return L._mat_cache[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.5
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.location = (-520, 60)
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.diffuse_color = (0.85, 0.84, 0.82, 1.0)
    L._mat_cache[name] = mat
    return mat


# -------------------------------------------------------------- primitives ---
def loft(name, sections, T, coll, mat, n=52, close_bottom=True, close_top=False,
         uv_scale=1.2, smooth_angle=math.radians(40)):
    """Bridge a stack of elliptical rings."""
    bm = bmesh.new()
    rings = []
    for s in sections:
        z = s["z"]; rx = s["rx"]; ry = s["ry"]
        xo = s.get("xo", 0.0); yo = s.get("yo", 0.0)
        fold = s.get("fold", 0.0); foldk = s.get("foldk", 9); ph = s.get("phase", 0.0)
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            f = 1.0 + fold * math.cos(foldk * a + ph)
            x = xo + rx * f * math.cos(a)
            y = yo + ry * f * math.sin(a)
            ring.append(bm.verts.new(T((x, y, z))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if close_bottom:
        bm.faces.new(list(reversed(rings[0])))
    if close_top:
        bm.faces.new(rings[-1])
    return _finish(bm, name, coll, mat, smooth_angle, uv_scale)


def blob(name, center, size, T, coll, mat, seed=0, rough=0.28, subdiv=3,
         bias=(0, 0, 0), mask=None, uv_scale=1.4, smooth_angle=math.radians(55)):
    """Displaced icosphere shaped into an ellipsoid; organic hair/beard mass."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    sx, sy, sz = size
    off = Vector((seed * 12.99 % 7.0, seed * 78.23 % 7.0, seed * 0.37 % 7.0))
    drop = []
    for vt in bm.verts:
        d = vt.co.copy()
        mm = 1.0
        if mask is not None:
            mm = mask(d)
            if mm <= 0.0:
                drop.append(vt)
                continue
        nz = noise.noise(d * 2.3 + off)
        r = 1.0 + rough * nz
        p = Vector((d.x * sx, d.y * sy, d.z * sz)) * r
        p += Vector(bias) * (0.5 + 0.5 * d.z)
        vt.co = Vector(T((center[0] + p.x, center[1] + p.y, center[2] + p.z)))
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
    return _finish(bm, name, coll, mat, smooth_angle, uv_scale)


def head(name, center, T, coll, mat, uv_scale=1.3):
    """Ovoid skull with a tapered jaw and a slight chin."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=30, v_segments=24, radius=1.0)
    cx, cy, cz = center
    for vt in bm.verts:
        d = vt.co.copy()
        p = Vector((d.x * 0.104, d.y * 0.120, d.z * 0.138))
        t = max(0.0, -d.z)                       # lower half factor
        p.x *= (1.0 - 0.30 * t)                  # jaw narrows
        p.y *= (1.0 - 0.08 * t)
        if d.z < -0.15 and d.y > 0.2:            # chin pushes forward
            p.y += 0.024 * (-d.z)
        vt.co = Vector(T((cx + p.x, cy + p.y, cz + p.z)))
    return _finish(bm, name, coll, mat, math.radians(60), uv_scale)


def arm(name, pts, radii, T, coll, mat, hand_size=(0.055, 0.05, 0.06),
        uv_scale=1.3):
    """Sweep a sleeve along the arm polyline, cap with a hand blob."""
    wpts = [T(p) for p in pts]
    L.tube(name, wpts, list(radii), segs=12, coll=coll, mat=mat,
           smooth_angle=math.radians(55), uv_scale=uv_scale)
    blob(name + "_Hand", pts[-1], hand_size, T, coll, mat, seed=3,
         rough=0.12, subdiv=2, uv_scale=uv_scale)


def _roughen(obj, amp, freq, seed=0):
    """Add carved-hair noise to an existing mesh (world-space verts)."""
    me = obj.data
    off = Vector((seed * 3.1 % 9, seed * 7.7 % 9, seed * 1.9 % 9))
    for vt in me.vertices:
        p = vt.co
        vt.co = p + Vector((noise.noise(p * freq + off),
                            noise.noise(p * freq + off + Vector((5, 0, 0))),
                            noise.noise(p * freq + off + Vector((0, 5, 0))))) * amp
    me.update()


# ---------------------------------------------------------------- pedestal ---
def build_pedestal(coll, base, mats, name, label, yaw=0.0):
    """Roman pedestal: plinth + base moldings + die + cornice + top slab.
    Returns (top_z, parts). top_z = world Z where the figure's feet stand."""
    x0, y0, z0 = base
    stone = mats["stone"]
    dark = mats["ink"]
    parts = []

    def slab(nm, w, d, h, zc, bevel=0.02, mat=stone):
        o = L.box(nm, (w, d, h), location=(x0, y0, zc), coll=coll, mat=mat,
                  bevel=bevel, uv_scale=0.7)
        if abs(yaw) > 1e-6:
            o.rotation_euler = Euler((0, 0, yaw))
        parts.append(o)
        return o

    z = z0
    slab(name + "_Plinth",    1.34, 1.16, 0.24, z + 0.12, bevel=0.015)   # 0.00-0.24
    slab(name + "_BaseTorus", 1.14, 0.98, 0.14, z + 0.31, bevel=0.05)    # 0.24-0.38
    slab(name + "_BaseFil",   1.00, 0.86, 0.07, z + 0.415)               # 0.38-0.45
    slab(name + "_Die",       0.92, 0.78, 0.86, z + 0.88, bevel=0.012)   # 0.45-1.31
    slab(name + "_NeckMold",  1.00, 0.86, 0.07, z + 1.345)               # 1.31-1.38
    slab(name + "_Cornice",   1.18, 1.02, 0.16, z + 1.46, bevel=0.05)    # 1.38-1.54
    slab(name + "_Top",       0.96, 0.82, 0.06, z + 1.57)                # 1.54-1.60
    top_z = z + 1.60

    # engraved name on the front (+Y) face of the die. Rotation Z=pi so the
    # text reads correctly for a viewer standing at +Y (lib_common gotcha).
    off = 0.395
    txt = L.text_mesh(name + "_Label", label, font="quote", size=0.115,
                      extrude=0.014, coll=coll, mat=dark, align_x='CENTER',
                      align_y='CENTER',
                      location=(x0 + off * math.sin(yaw), y0 + off * math.cos(yaw),
                                z + 0.95),
                      rotation=(math.pi / 2, 0, math.pi + yaw))
    parts.append(txt)
    return top_z, parts


# ------------------------------------------------------------------ figure ---
def _coat_sections():
    #  z,     rx,    ry,    yo,     fold,  foldk
    return [
        dict(z=1.660, rx=0.115, ry=0.100, yo=0.000, fold=0.000, foldk=8),  # collar
        dict(z=1.600, rx=0.238, ry=0.172, yo=0.000, fold=0.015, foldk=7),  # shoulders
        dict(z=1.500, rx=0.232, ry=0.180, yo=0.015, fold=0.018, foldk=8),
        dict(z=1.380, rx=0.216, ry=0.176, yo=0.020, fold=0.020, foldk=9),  # chest
        dict(z=1.160, rx=0.188, ry=0.158, yo=0.005, fold=0.025, foldk=10),  # waist
        dict(z=0.960, rx=0.216, ry=0.180, yo=-0.010, fold=0.030, foldk=10),  # hips
        dict(z=0.740, rx=0.250, ry=0.206, yo=-0.018, fold=0.038, foldk=11),
        dict(z=0.600, rx=0.278, ry=0.230, yo=-0.018, fold=0.042, foldk=12),
        dict(z=0.520, rx=0.288, ry=0.238, yo=-0.014, fold=0.042, foldk=12),  # hem
        dict(z=0.485, rx=0.235, ry=0.195, yo=-0.010, fold=0.020, foldk=12),  # tuck
    ]


def _leg(coll, mat, T, x, name):
    pts = [(x, 0.02, 0.53), (x, 0.03, 0.28), (x, 0.05, 0.11)]
    r = [0.086, 0.073, 0.064]
    L.tube(name + "_Shin", [T(p) for p in pts], r, segs=10, coll=coll, mat=mat,
           smooth_angle=math.radians(50), uv_scale=1.2)
    blob(name + "_Shoe", (x, 0.150, 0.048), (0.076, 0.150, 0.056), T, coll, mat,
         seed=int(abs(x) * 97) + 1, rough=0.05, subdiv=2, uv_scale=1.3)


def build_figure(coll, kind, T, mats, prefix):
    """kind in {'marx','engels'}. Front = +Y."""
    marble = mats["marble"]
    P = kind == "marx"

    # ---- coat + torso -----------------------------------------------------
    loft(prefix + "_Coat", _coat_sections(), T, coll, marble, n=56,
         close_bottom=True, close_top=True, uv_scale=1.15)
    _leg(coll, marble, T, -0.105, prefix + "_LegL")
    _leg(coll, marble, T, 0.105, prefix + "_LegR")
    L.tube(prefix + "_Neck", [T((0, 0.01, 1.58)), T((0, 0.02, 1.82))],
           [0.084, 0.070], segs=12, coll=coll, mat=marble,
           smooth_angle=math.radians(55), uv_scale=1.3)

    # ---- shoulders (deltoids) fill the coat->arm join ---------------------
    for sx in (-1, 1):
        blob(prefix + f"_Shoulder_{sx}", (sx * 0.188, 0.000, 1.570),
             (0.118, 0.158, 0.132), T, coll, marble, seed=61 + sx,
             rough=0.04, subdiv=2, uv_scale=1.3)

    # ---- head + face ------------------------------------------------------
    hc = (0.0, 0.020, 1.965)
    head(prefix + "_Head", hc, T, coll, marble)
    blob(prefix + "_Nose", (0.0, 0.150, 1.945), (0.026, 0.050, 0.058), T, coll,
         marble, seed=8, rough=0.05, subdiv=2, uv_scale=1.4)
    blob(prefix + "_Brow", (0.0, 0.130, 2.005), (0.088, 0.026, 0.018), T, coll,
         marble, seed=9, rough=0.05, subdiv=2, uv_scale=1.4)

    # ---- hair + beard (identity) -----------------------------------------
    if P:  # ---- MARX: leonine swept mane + big full rounded beard ----
        # solid hair mass sitting on crown+back (bare forehead in front)
        blob(prefix + "_Hair", (0.0, -0.058, 2.070), (0.188, 0.178, 0.152), T,
             coll, marble, seed=21, rough=0.34, subdiv=4, uv_scale=1.6)
        blob(prefix + "_HairBack", (0.0, -0.150, 1.995), (0.140, 0.120, 0.140), T,
             coll, marble, seed=24, rough=0.34, subdiv=3, uv_scale=1.6)
        for sx in (-1, 1):
            blob(prefix + f"_Sideburn_{sx}", (sx * 0.108, 0.050, 1.895),
                 (0.046, 0.072, 0.105), T, coll, marble, seed=27 + sx,
                 rough=0.26, subdiv=2, uv_scale=1.5)
        beard = [
            dict(z=1.870, rx=0.135, ry=0.120, yo=0.075),
            dict(z=1.790, rx=0.165, ry=0.155, yo=0.115),
            dict(z=1.690, rx=0.172, ry=0.168, yo=0.130),   # fullest
            dict(z=1.585, rx=0.155, ry=0.160, yo=0.120),
            dict(z=1.495, rx=0.120, ry=0.135, yo=0.100),
            dict(z=1.425, rx=0.072, ry=0.090, yo=0.078),   # rounded end
        ]
        b = loft(prefix + "_Beard", beard, T, coll, marble, n=44,
                 close_bottom=True, close_top=True, uv_scale=1.5,
                 smooth_angle=math.radians(50))
        _roughen(b, 0.018, 3.2, seed=31)
        blob(prefix + "_Mustache", (0.0, 0.150, 1.878), (0.095, 0.050, 0.032),
             T, coll, marble, seed=33, rough=0.10, subdiv=2, uv_scale=1.5)
    else:  # ---- ENGELS: neat receding hair + long pointed beard ----
        # smaller hair mass set high and back -> balding, high forehead
        blob(prefix + "_Hair", (0.0, -0.080, 2.080), (0.158, 0.150, 0.115), T,
             coll, marble, seed=41, rough=0.22, subdiv=4, uv_scale=1.6)
        blob(prefix + "_HairBack", (0.0, -0.150, 2.010), (0.118, 0.104, 0.110), T,
             coll, marble, seed=44, rough=0.22, subdiv=3, uv_scale=1.6)
        for sx in (-1, 1):
            blob(prefix + f"_Sideburn_{sx}", (sx * 0.102, 0.040, 1.885),
                 (0.038, 0.060, 0.090), T, coll, marble, seed=47 + sx,
                 rough=0.20, subdiv=2, uv_scale=1.5)
        beard = [
            dict(z=1.865, rx=0.100, ry=0.085, yo=0.085),
            dict(z=1.780, rx=0.122, ry=0.115, yo=0.120),
            dict(z=1.660, rx=0.105, ry=0.115, yo=0.122),
            dict(z=1.550, rx=0.078, ry=0.095, yo=0.108),
            dict(z=1.455, rx=0.050, ry=0.062, yo=0.090),
            dict(z=1.385, rx=0.022, ry=0.030, yo=0.070),   # point
        ]
        b = loft(prefix + "_Beard", beard, T, coll, marble, n=44,
                 close_bottom=True, close_top=True, uv_scale=1.5,
                 smooth_angle=math.radians(50))
        _roughen(b, 0.013, 4.0, seed=51)
        blob(prefix + "_Mustache", (0.0, 0.155, 1.888), (0.092, 0.052, 0.034),
             T, coll, marble, seed=53, rough=0.12, subdiv=2, uv_scale=1.5)

    # ---- arms + hands -----------------------------------------------------
    if P:  # MARX: right hand on heart, left hand hanging at the side
        arm(prefix + "_ArmR",
            [(-0.200, 0.020, 1.575), (-0.205, 0.145, 1.330),
             (-0.045, 0.195, 1.350), (0.050, 0.205, 1.360)],
            [0.078, 0.062, 0.052, 0.045], T, coll, marble,
            hand_size=(0.062, 0.036, 0.078))
        arm(prefix + "_ArmL",
            [(0.205, 0.000, 1.575), (0.236, 0.030, 1.270),
             (0.238, 0.050, 1.020), (0.232, 0.070, 0.895)],
            [0.078, 0.062, 0.052, 0.046], T, coll, marble,
            hand_size=(0.052, 0.058, 0.064))
    else:  # ENGELS: arms folded across the chest
        arm(prefix + "_ArmR",
            [(-0.200, 0.020, 1.575), (-0.248, 0.060, 1.300),
             (0.020, 0.235, 1.360), (0.165, 0.212, 1.355)],
            [0.078, 0.064, 0.056, 0.048], T, coll, marble,
            hand_size=(0.058, 0.052, 0.050))
        arm(prefix + "_ArmL",
            [(0.200, 0.020, 1.575), (0.248, 0.060, 1.300),
             (-0.020, 0.256, 1.305), (-0.165, 0.234, 1.310)],
            [0.078, 0.064, 0.056, 0.048], T, coll, marble,
            hand_size=(0.058, 0.052, 0.050))


# ------------------------------------------------------------------- build ---
def build_materials():
    marble_img = make_stone_texture("Statue_Marble", 1024, seed=11, kind="marble")
    stone_img = make_stone_texture("Statue_Travertine", 1024, seed=23, kind="stone")
    return {
        "marble": stone_material("Statue_Marble_White", marble_img, rough=0.33),
        "stone":  stone_material("Statue_Pedestal_Stone", stone_img, rough=0.42),
        "ink":    L.material("Statue_Inscription", (0.10, 0.09, 0.085), rough=0.5),
        "marble_img": marble_img,
        "stone_img": stone_img,
    }


def build_one(coll, kind, base, mats, yaw=0.0, scale=1.0):
    label = "KARL MARX" if kind == "marx" else "FRIEDRICH ENGELS"
    name = "WP1_Statue_Marx" if kind == "marx" else "WP1_Statue_Engels"
    top_z, _ = build_pedestal(coll, base, mats, name + "_Ped", label, yaw=yaw)
    Tf = make_T((base[0], base[1], top_z), scale=scale, yaw=yaw)
    build_figure(coll, kind, Tf, mats, name)


def build_pair(coll, marx_base, engels_base, mats, yaw=0.0, scale=1.0):
    build_one(coll, "marx", marx_base, mats, yaw=yaw, scale=scale)
    build_one(coll, "engels", engels_base, mats, yaw=yaw, scale=scale)
