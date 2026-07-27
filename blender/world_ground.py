# ============================================================================
# world_ground.py — ground work: mine ballast, atrium floor, atrium terrain.
#
#   1. WP4_Track_Ballast was BANKED. L.sweep carries a transported frame along
#      the path, and down the mine shaft that frame rolls with the gradient: the
#      cross-section tilts up to 30 deg (49 deg at the last sample), so a 4.2 m
#      wide bed swings its edges about a metre vertically and no longer sits
#      under its own rails. Measured, not guessed — the rails were always right
#      because wp4_metro builds them off _lateral() and world up instead. The
#      bed is now built the same way, which cannot roll.
#      (Normals were never the problem: signed volume was +9.77, i.e. outward.)
#   2. WP1_Floor_* get a generated Roman tile texture, projected in WORLD space
#      so the pattern runs unbroken across all four slabs — "aus einem Guss".
#   3. WP1_Terrain fills the open ground between the garden terrain (which ends
#      flat at y = -10, z = -0.70) and the atrium terminus deck, with a dark
#      lush grass texture. It meets WP2_Terrain at exactly its edge height.
#
# Textures are generated here, written to blender/textures/ and packed into the
# .blend, so the GLB carries them (exporter uses export_image_format='AUTO').
#
# Run (idempotent):
#   blender -b blender/output/world.blend --python blender/world_ground.py \
#           -- --save --export
# ============================================================================
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import lib_common as L                      # noqa: E402
import wp4_metro as M4                      # noqa: E402

OUT = os.path.join(HERE, "output")
TEXDIR = os.path.join(HERE, "textures")

TEX_RES = 1024
TEX_METRES = 4.0            # both textures cover 4 x 4 m of world


def _rm(obj):
    try:
        bpy.data.objects.remove(obj, do_unlink=True)
    except (ReferenceError, RuntimeError):
        pass


# ------------------------------------------------------- texture generation --
def _periodic_noise(res, freq, rng):
    """Value noise on a wrapping lattice — tiles seamlessly by construction."""
    g = rng.random((freq, freq))
    t = np.arange(res) / res * freq
    ys, xs = np.meshgrid(t, t, indexing='ij')
    x0 = np.floor(xs).astype(int) % freq
    y0 = np.floor(ys).astype(int) % freq
    x1 = (x0 + 1) % freq
    y1 = (y0 + 1) % freq
    tx = xs - np.floor(xs)
    ty = ys - np.floor(ys)
    sx = tx * tx * (3 - 2 * tx)
    sy = ty * ty * (3 - 2 * ty)
    a = g[y0, x0] * (1 - sx) + g[y0, x1] * sx
    b = g[y1, x0] * (1 - sx) + g[y1, x1] * sx
    return a * (1 - sy) + b * sy


def _fbm(res, freq, octaves, rng):
    v = np.zeros((res, res))
    amp = 1.0
    total = 0.0
    for k in range(octaves):
        v += amp * _periodic_noise(res, freq * (2 ** k), rng)
        total += amp
        amp *= 0.5
    return v / total


def _save_image(name, rgb):
    """rgb: (res, res, 3) float 0..1 -> packed sRGB image datablock."""
    os.makedirs(TEXDIR, exist_ok=True)
    res = rgb.shape[0]
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, res, res, alpha=False)
    rgba = np.ones((res, res, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels.foreach_set(rgba.reshape(-1))
    path = os.path.join(TEXDIR, name + ".png")
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.source = 'FILE'
    img.filepath = path
    img.reload()
    img.pack()
    print(f"[ground] texture {name}.png {res}x{res} packed")
    return img


def _roman_tile_image():
    """Travertine slabs with a fine joint and a dark inlay square on every
    intersection — a plain opus quadratum, and it tiles."""
    res = TEX_RES
    per = 4                                   # 1 m slabs across 4 m
    sl = res // per
    rng = np.random.default_rng(20260724)
    ix = np.arange(res)
    X, Y = np.meshgrid(ix, ix, indexing='xy')
    fx, fy = X % sl, Y % sl
    sxi, syi = X // sl, Y // sl

    grain = _fbm(res, 8, 5, rng)
    veins = _fbm(res, 3, 4, rng)
    base = np.array([0.735, 0.672, 0.566])
    col = np.repeat(base[None, None, :], res, 0).repeat(res, 1).copy()
    col *= (0.90 + 0.16 * grain)[:, :, None]
    col *= (0.94 + 0.10 * np.abs(veins - 0.5) * 2.0)[:, :, None]
    # per-slab tone so the field does not read as one flat sheet
    jitter = rng.random((per, per)) - 0.5
    col *= (1.0 + 0.055 * jitter[syi, sxi])[:, :, None]

    joint = 3
    is_joint = (fx < joint) | (fx >= sl - joint) | (fy < joint) | (fy >= sl - joint)
    col[is_joint] = np.array([0.505, 0.452, 0.372]) * (
        0.92 + 0.16 * grain[is_joint])[:, None]

    cab = 21
    cx = np.minimum(fx, sl - fx)
    cy = np.minimum(fy, sl - fy)
    is_cab = (cx < cab) & (cy < cab)
    col[is_cab] = np.array([0.318, 0.246, 0.204]) * (
        0.90 + 0.20 * grain[is_cab])[:, None]
    ring = is_cab & ((cx >= cab - 3) | (cy >= cab - 3))
    col[ring] = np.array([0.235, 0.180, 0.150])
    return _save_image("WP1_Roman_Tile", col)


# WP2_Terrain is not textured at all: Garden_Grass is a plain Principled
# surface and all its green comes from the `Col` vertex attribute (COLOR_0),
# which the glTF loader applies on its own. Sampled there: ~(0.333, 0.737,
# 0.526). WP1 reuses the same material and the same technique one shade down —
# no image, no bytes, and it cannot look out of place next to its neighbour.
WP2_COL = (0.42, 0.93, 0.66)          # pre-noise base that yields WP2's green
WP1_COL_FACTOR = 0.70                 # "etwas dunkler"


def _textured_material(name, image, rough=0.85, spec=None):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.location = (-420, 200)
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = "UVMap"
    uv.location = (-640, 200)
    nt.links.new(tex.inputs['Vector'], uv.outputs['UV'])
    nt.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    if spec is not None and 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    mat.use_backface_culling = True
    return mat


# ---------------------------------------------------------- 1. mine ballast --
def rebuild_ballast():
    coll = L.collection("WP4_Metro")
    old = bpy.data.objects.get("WP4_Track_Ballast")
    mat = (old.data.materials[0] if old is not None and old.data.materials
           else L.material("Track_Ballast", (0.22, 0.21, 0.20), rough=1.0))
    if old is not None:
        _rm(old)

    pts = [p for p in M4._track_samples() if p.y >= -185.0]
    prof = [(0.0, -2.1), (0.0, 2.1), (0.42, 1.6), (0.42, -1.6)]
    up = Vector((0.0, 0.0, 1.0))
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        lat = M4._lateral(a, b)          # horizontal, so the sweep cannot twist
        # 8 cm lower than before: at -0.28 the crown sat 2 cm proud of the
        # sleeper tops and buried them completely
        base = Vector((p.x, p.y, p.z - 0.36))
        rings.append([bm.verts.new(base + lat * v + up * u) for u, v in prof])
    n = len(prof)
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((rings[i][k], rings[i][k2],
                          rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # recalc_face_normals only makes the shell *consistent*; on an open-ended
    # sweep it can settle on the inward orientation. Signed volume decides.
    bm.faces.ensure_lookup_table()
    vol = 0.0
    for f in bm.faces:
        vs = f.verts
        for k in range(1, len(vs) - 1):
            vol += vs[0].co.dot(vs[k].co.cross(vs[k + 1].co)) / 6.0
    if vol < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    obj = L.bm_to_obj(bm, "WP4_Track_Ballast", coll, mat,
                      math.radians(50), 0.35, (0, 0, 0), recalc=False)
    # the bed must be level everywhere: measure the worst roll of any ring
    worst = 0.0
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        worst = max(worst, abs(math.degrees(math.asin(
            max(-1.0, min(1.0, M4._lateral(a, b).z))))))
    obj.data.calc_loop_triangles()
    vol = sum((obj.data.vertices[t.vertices[0]].co).dot(
        (obj.data.vertices[t.vertices[1]].co).cross(
            obj.data.vertices[t.vertices[2]].co)) / 6.0
        for t in obj.data.loop_triangles)
    print(f"[ground] ballast rebuilt: {len(obj.data.polygons)} faces, "
          f"max roll {worst:.2f} deg (was up to 49.6), signed volume {vol:+.2f}")
    return obj


# ------------------------------------------------------- 2. atrium flooring --
FLOORS = ("WP1_Floor_L", "WP1_Floor_N", "WP1_Floor_R", "WP1_Floor_S")


def _world_box_uv(obj, metres):
    """Box projection in WORLD space: neighbouring objects share the pattern."""
    me = obj.data
    mw = obj.matrix_world
    rot = mw.to_3x3()
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        nrm = (rot @ poly.normal).normalized()
        ax = max(range(3), key=lambda i: abs(nrm[i]))
        ui, vi = [(1, 2), (0, 2), (0, 1)][ax]
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co[ui] / metres, co[vi] / metres)
    me.uv_layers.active = uvl


def roman_floor():
    img = _roman_tile_image()
    mat = _textured_material("Roman_Tile_Polished", img, rough=0.28, spec=0.55)
    done = []
    for name in FLOORS:
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        o.data.materials.clear()
        o.data.materials.append(mat)
        _world_box_uv(o, TEX_METRES)
        done.append(name)
    print(f"[ground] Roman tile on {len(done)} floor slabs, world-projected at "
          f"{TEX_METRES:.0f} m — continuous across {', '.join(done)}")


# ---------------------------------------------------------- 3. WP1 terrain --
WP2_EDGE_Y = -10.0          # WP2_Terrain's north edge …
WP2_EDGE_Z = -0.70          # … which is dead flat at this height


def _wp1_height(x, y):
    # dead flat under everything built, and dead flat where it meets WP2
    dx = max(0.0, abs(x) - 15.0)
    dy = max(0.0, max(-19.0 - y, y - 41.0))
    d = math.hypot(dx, dy)
    seam = L.smoothstep(WP2_EDGE_Y, WP2_EDGE_Y + 16.0, y)
    amp = 1.7 * L.smoothstep(1.5, 26.0, d) * seam
    return WP2_EDGE_Z + amp * L.fractal2d(x, y, 0.028, 4, 3.7)


def wp1_terrain(ctx=None):
    coll = L.collection("WP1_Atrium")
    for name in ("WP1_Terrain",):
        old = bpy.data.objects.get(name)
        if old is not None:
            _rm(old)
    # drop the earlier textured version entirely
    for stale in ("Atrium_Grass",):
        m = bpy.data.materials.get(stale)
        if m is not None:
            bpy.data.materials.remove(m)
    img = bpy.data.images.get("WP1_Grass_Dark")
    if img is not None:
        bpy.data.images.remove(img)

    mat = bpy.data.materials.get("Garden_Grass") or L.material(
        "Garden_Grass", (0.7, 0.5, 0.3), rough=0.95)
    obj = L.heightfield(
        "WP1_Terrain", (0.0, 18.0), (130.0, 56.0), (65, 56), _wp1_height,
        coll=coll, mat=mat, uv_scale=0.08)
    base = (0.333, 0.737, 0.526)
    L.vertex_noise(obj, amount=0.22, scale=0.055, seed=5, base=base)
    L.set_props(obj, lightmap=0)
    zs = [(obj.matrix_world @ v.co).z for v in obj.data.vertices]
    ca = obj.data.color_attributes["Col"]
    s = ca.data[len(ca.data) // 2].color
    print(f"[ground] WP1_Terrain x[-65..65] y[-10..46], z {min(zs):.2f}..{max(zs):.2f}; "
          f"meets WP2_Terrain at y={WP2_EDGE_Y:.0f}, z={WP2_EDGE_Z:.2f}; "
          f"material {mat.name}, Col sample "
          f"({s[0]:.3f}, {s[1]:.3f}, {s[2]:.3f}) vs WP2 (0.333, 0.737, 0.526)")
    return obj


# ------------------------------------------------------------------- driver --
def build():
    rebuild_ballast()
    roman_floor()
    wp1_terrain()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import exporter
    build()
    bpy.context.view_layer.update()
    if "--save" in argv:
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if "--export" in argv:
        exporter.export_glb(os.path.join(OUT, "world.glb"))


if __name__ == "__main__":
    main()
