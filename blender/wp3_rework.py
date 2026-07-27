# ============================================================================
# wp3_rework.py — in-place aesthetic rework of WAYPOINT 3 (Western Desert).
#
# This is an EDIT PASS on the hand-finished blender/output/world.blend, in the
# spirit of optimize_wp2_in_place.py: it never re-runs the generator
# (wp3_desert.build stays untouched), it only deletes / adds / adjusts the
# objects it is explicitly told about and leaves the rest of the scene alone.
#
#   blender.exe -b blender/output/world.blend -P blender/wp3_rework.py -- [flags]
#     --save     write world.blend back (a .blend1 backup is kept by Blender)
#     --export   write blender/output/world.glb
#     --shots    render validation stills to blender/output/wp3_shots/
#
# What it does
#   1. removes the 13 stacked-box "cliff" clusters (63 objects + 15 library
#      originals) — two of them (Cliff_8, Cliff_10) were also broken: pieces
#      buried 15 m under the terrain and floating 43 m above it
#   2. removes the 10 smooth-tube cacti (27 objects + 8 library originals)
#   3. builds Monument-Valley style buttes: fluted, stratified, with talus
#      skirts, strata banding baked into COLOR_0 so it costs nothing at runtime
#   4. builds wind-eroded boulders, ribbed saguaros (with a small generated
#      skin texture), prickly pears, sage bushes and dry grass tufts
#   5. adds a covered wagon beside the saloon and barrels/crate on the porch
#   6. sculpts gentle dunes + butte pedestals into WP3_Terrain, keeping a 7 m
#      exclusion corridor around the camera rail and the built-up areas
#   7. merges duplicate-suffixed materials (Desert_Sand.001 & co.)
#
# Camera-rail safety: every placement is checked against cam_path.json; the
# rail itself is never touched, so cam_path.json stays valid.
# ============================================================================
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Euler, Vector, noise as bnoise

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import lib_common as L                                            # noqa: E402

OUT = os.path.join(HERE, "output")
COLL_NAME = "WP3_Desert"
TAU = math.pi * 2

# camera-rail clearance: nothing new may come closer than this in XY
CLEAR = 4.0
# terrain is left untouched inside this distance of the rail
TERRAIN_CLEAR = 7.0


# --------------------------------------------------------------- infra bits --
def wp3():
    return bpy.data.collections[COLL_NAME]


def make_mat(name, color, rough=0.85, metal=0.0, alpha=1.0, double_sided=False,
             vcol=False, image=None, emit=None, emit_str=0.0):
    """Create-or-update a material by name (never spawns a .001 twin)."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    c = tuple(color) + (1.0,) if len(color) == 3 else tuple(color)
    bsdf.inputs['Base Color'].default_value = c
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit is not None:
        e = tuple(emit) + (1.0,) if len(emit) == 3 else tuple(emit)
        for nm in ("Emission Color", "Emission"):
            if nm in bsdf.inputs:
                bsdf.inputs[nm].default_value = e
                break
        bsdf.inputs['Emission Strength'].default_value = emit_str
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        for attr, val in (("blend_method", 'BLEND'),
                          ("surface_render_method", 'BLENDED')):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
    m.use_backface_culling = not double_sided
    m.diffuse_color = c

    src = None                       # what feeds Base Color
    if image is not None:
        tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE'), None)
        if tex is None:
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.location = (-620, 260)
        tex.image = image
        tex.interpolation = 'Smart'
        src = tex.outputs['Color']
    if vcol:
        # Colour-Attribute → Multiply → Base Color. Only a Blender-preview
        # nicety: three.js multiplies COLOR_0 in regardless (see PIPELINE §5).
        attr = next((n for n in nt.nodes
                     if n.type in ('ATTRIBUTE', 'COLOR_ATTRIBUTE')), None)
        if attr is None:
            attr = nt.nodes.new('ShaderNodeAttribute')
            attr.location = (-620, -40)
        attr.attribute_name = "Col"
        mix = next((n for n in nt.nodes if n.type in ('MIX', 'MIX_RGB')), None)
        if mix is None:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.location = (-320, 120)
        mix.blend_type = 'MULTIPLY'
        # ShaderNodeMix carries one A/B pair per data type — take the colour one
        for i in mix.inputs:
            if i.name == 'Factor' and i.type == 'VALUE':
                i.default_value = 1.0
        cols = [i for i in mix.inputs if i.type == 'RGBA']
        a_in, b_in = cols[0], cols[1]
        a_in.default_value = c
        if src is not None:
            nt.links.new(src, a_in)
        nt.links.new(attr.outputs['Color'], b_in)
        src = next(o for o in mix.outputs if o.type == 'RGBA')
    if src is not None:
        nt.links.new(src, bsdf.inputs['Base Color'])
    return m


def add_vcol(me, colors):
    """colors: list of (r,g,b) per vertex."""
    ca = me.color_attributes.get("Col")
    if ca is None:
        ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR',
                                     domain='POINT')
    me.color_attributes.active_color = ca
    me.color_attributes.active = ca
    if ca.domain == 'POINT':
        for i, c in enumerate(colors):
            ca.data[i].color = (c[0], c[1], c[2], 1.0)
    else:
        for lo in me.loops:
            c = colors[lo.vertex_index]
            ca.data[lo.index].color = (c[0], c[1], c[2], 1.0)


def build_mesh(name, verts, faces, coll, mat, smooth_angle=None, uv_scale=0.35,
               face_uvs=None, vcolors=None, location=(0, 0, 0),
               rotation=(0, 0, 0), recalc=True):
    """verts/faces → object, with optional explicit per-face-corner UVs."""
    bm = bmesh.new()
    bverts = [bm.verts.new(v) for v in verts]
    bm.verts.index_update()
    bfaces = []
    for f in faces:
        try:
            bfaces.append(bm.faces.new([bverts[i] for i in f]))
        except ValueError:                       # duplicate face — skip
            bfaces.append(None)
    bm.faces.index_update()
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if smooth_angle is not None:
        L._smooth_bm(bm, smooth_angle)
    if face_uvs is not None:
        uvl = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
        for fi, bf in enumerate(bfaces):
            if bf is None:
                continue
            uvs = face_uvs[fi]
            src = {vi: uvs[k] for k, vi in enumerate(faces[fi])}
            for lo in bf.loops:
                lo[uvl].uv = src[lo.vert.index]
    elif uv_scale:
        L._box_uv_bm(bm, uv_scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if vcolors is not None:
        add_vcol(me, vcolors)
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    obj.rotation_euler = Euler(rotation)
    if mat is not None:
        me.materials.append(mat)
    coll.objects.link(obj)
    return obj


def stow(obj):
    """Library original: parked far below, hidden from render and export."""
    obj.location = (obj.location.x, obj.location.y, -400.0)
    obj.hide_render = True
    obj.hide_viewport = True
    return obj


def ring(z, radii, n, cx=0.0, cy=0.0, phase=0.0):
    return [(cx + radii[i] * math.cos(phase + TAU * i / n),
             cy + radii[i] * math.sin(phase + TAU * i / n), z)
            for i in range(n)]


def band(faces, a, b, n, close=True):
    """Stitch ring a (lower) to ring b (upper); both start indices."""
    m = n if close else n - 1
    for i in range(m):
        j = (i + 1) % n
        faces.append((a + i, a + j, b + j, b + i))


# ------------------------------------------------------------ camera safety --
_PATH = None


def path_xy():
    global _PATH
    if _PATH is None:
        with open(os.path.join(OUT, "cam_path.json"), encoding="utf-8") as f:
            d = json.load(f)
        _PATH = [(s["p"][0], s["p"][1]) for s in d["samples"]
                 if -170.0 < s["p"][1] < -90.0]
    return _PATH


def rail_dist(x, y):
    return min(math.hypot(x - px, y - py) for px, py in path_xy())


def assert_clear(x, y, label, need=CLEAR):
    d = rail_dist(x, y)
    if d < need:
        raise SystemExit(f"[wp3] {label} at ({x:.1f},{y:.1f}) is {d:.1f} m from "
                         f"the camera rail (needs {need} m)")
    return d


# ---------------------------------------------------------------- terrain ----
class Terrain:
    """Ray-cast sampler over the live WP3_Terrain surface.

    The grid is NOT regular any more — 568 vertices were moved by hand around
    the mine mountain — so we shoot a ray straight down instead of indexing.
    Call rebuild() after every sculpt pass.
    """

    def __init__(self):
        self.obj = bpy.data.objects["WP3_Terrain"]
        self.me = self.obj.data
        self.rebuild()

    def rebuild(self):
        from mathutils.bvhtree import BVHTree
        mw = self.obj.matrix_world
        verts = [mw @ v.co for v in self.me.vertices]
        polys = [tuple(p.vertices) for p in self.me.polygons]
        self.bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)

    def z(self, x, y, default=-10.0):
        hit = self.bvh.ray_cast(Vector((x, y, 300.0)), Vector((0, 0, -1)))
        if hit[0] is not None:
            return hit[0].z
        hit = self.bvh.ray_cast(Vector((x, y, -300.0)), Vector((0, 0, 1)))
        return hit[0].z if hit[0] is not None else default


# ============================================================================
# 1. CLEAN-UP
# ============================================================================
REMOVE_PREFIXES = ("WP3_Cliff", "WP3_Cactus",
                   # everything this pass owns, so re-runs are idempotent
                   "WP3_Butte", "WP3_Rock", "WP3_Saguaro", "WP3_Bush",
                   "WP3_Tuft", "WP3_Pear", "WP3_Wagon", "WP3_Barrel",
                   "WP3_Crate", "WP3_Mesa")


def purge():
    doomed = [o for o in list(bpy.data.objects)
              if o.name.startswith(REMOVE_PREFIXES)]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f"[wp3] removed {len(doomed)} old objects")
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def merge_duplicate_materials():
    """Fold Foo.001 into Foo when the Principled inputs are identical."""
    def sig(m):
        nt = getattr(m, "node_tree", None)
        b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) if nt else None
        if not b:
            return None
        vals = []
        for i in b.inputs:
            try:
                v = i.default_value
                vals.append(tuple(round(x, 4) for x in v) if hasattr(v, "__len__")
                            else round(float(v), 4))
            except TypeError:
                vals.append(None)
        links = tuple(sorted((l.from_node.type, l.to_socket.name)
                             for l in nt.links))
        return (tuple(vals), links, m.use_backface_culling)

    # a ".001" whose plain name is free is just a stale name — rename it
    renamed = []
    for group in (bpy.data.materials, bpy.data.meshes):
        for d in list(group):
            base, _, tail = d.name.rpartition(".")
            if base and tail.isdigit() and group.get(base) is None:
                d.name = base
                renamed.append(base)
    if renamed:
        print(f"[wp3] renamed {len(renamed)} stale datablocks "
              f"({', '.join(renamed[:6])}{'…' if len(renamed) > 6 else ''})")

    merged = 0
    for m in list(bpy.data.materials):
        base, _, tail = m.name.rpartition(".")
        if not base or not tail.isdigit():
            continue
        keep = bpy.data.materials.get(base)
        if keep is None or keep == m or sig(keep) is None or sig(keep) != sig(m):
            continue
        for o in bpy.data.objects:
            if o.type != 'MESH':
                continue
            for slot in o.material_slots:
                if slot.material == m:
                    slot.material = keep
        for me in bpy.data.meshes:
            for i, mm in enumerate(me.materials):
                if mm == m:
                    me.materials[i] = keep
        merged += 1
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    print(f"[wp3] merged {merged} duplicate materials; "
          f"{len(bpy.data.materials)} left")


# ============================================================================
# 2. MATERIALS + the one generated texture
# ============================================================================
def cactus_skin_image():
    """Ribbed cactus skin: 7 ribs across U, areole/spine rows along V."""
    name = "WP3_Cactus_Skin"
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    W = H = 256
    img = bpy.data.images.new(name, W, H, alpha=False)
    ribs, rows = 7, 14
    px = [0.0] * (W * H * 4)
    rng = random.Random(4242)
    spines = []
    for r in range(rows):
        for k in range(ribs):
            cu = (k + 0.5) / ribs
            cv = (r + 0.5) / rows + (0.5 / rows if k % 2 else 0.0)
            spines.append((cu * W, (cv % 1.0) * H))
    for y in range(H):
        v = y / H
        for x in range(W):
            u = x / W
            crest = 0.5 + 0.5 * math.cos(TAU * ribs * u)          # 1 on the rib
            n = bnoise.noise(Vector((u * 26.0, v * 26.0, 0.5)))
            f = crest ** 1.4
            r = 0.115 + 0.185 * f + 0.02 * n
            g = 0.245 + 0.245 * f + 0.03 * n
            b = 0.115 + 0.115 * f + 0.02 * n
            # spine clusters sit on the crests
            for sx, sy in spines:
                dx = min(abs(x - sx), W - abs(x - sx))
                dy = min(abs(y - sy), H - abs(y - sy))
                d2 = dx * dx + dy * dy
                if d2 < 9.0:
                    t = 1.0 - d2 / 9.0
                    r += 0.62 * t
                    g += 0.56 * t
                    b += 0.30 * t
                elif d2 < 26.0:                                    # areole ring
                    t = (1.0 - (d2 - 9.0) / 17.0) * 0.16
                    r += 0.12 * t
                    g += 0.05 * t
            i = (y * W + x) * 4
            px[i] = min(r, 1.0)
            px[i + 1] = min(g, 1.0)
            px[i + 2] = min(b, 1.0)
            px[i + 3] = 1.0
    img.pixels.foreach_set(px)
    # Write it out and load it back as a real file image: a GENERATED image
    # that is only pack()ed renders as flat white in EEVEE and gives the glTF
    # exporter nothing to embed.
    path = os.path.join(HERE, "textures", "wp3_cactus_skin.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.file_format = 'PNG'
    img.filepath_raw = path
    img.save()
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path, check_existing=False)
    img.name = name
    img.pack()
    print(f"[wp3] generated {name} {W}x{H} → {path}")
    return img


def materials():
    # No Color-Attribute nodes here on purpose: nothing else in world.blend
    # wires them either, the exporter emits COLOR_0 from export_vertex_color=
    # 'ACTIVE' regardless, and three.js multiplies it in. wp3_shots.py adds the
    # wiring temporarily so the Blender stills show what the web will show.
    m = {}
    # sandstone: albedo carries the BRIGHT end, COLOR_0 darkens (PIPELINE §5)
    m["rock"] = make_mat("WP3_Sandstone", (0.78, 0.46, 0.30), rough=0.92)
    m["rock_d"] = make_mat("WP3_Sandstone_Shadow", (0.71, 0.41, 0.28),
                           rough=0.95)
    m["cactus"] = make_mat("WP3_Cactus_Skin", (1.0, 1.0, 1.0), rough=0.72,
                           image=cactus_skin_image())
    m["cactus_flat"] = make_mat("WP3_Cactus_Flat", (0.34, 0.48, 0.28),
                                rough=0.78)
    m["bush"] = make_mat("WP3_Sage", (0.46, 0.52, 0.32), rough=0.95)
    m["grass"] = make_mat("WP3_Dry_Grass", (0.70, 0.62, 0.35), rough=0.95,
                          double_sided=True)
    m["wood"] = bpy.data.materials.get("Weathered_Wood")
    m["wood_d"] = bpy.data.materials.get("Weathered_Wood_Dark")
    m["plank"] = bpy.data.materials.get("Saloon_Plank")
    m["canvas"] = make_mat("WP3_Wagon_Canvas", (0.71, 0.66, 0.56), rough=0.94,
                           double_sided=True)
    m["iron"] = make_mat("WP3_Iron_Dark", (0.19, 0.17, 0.16), rough=0.55,
                         metal=0.85)
    return m


# ============================================================================
# 3. ROCK ASSETS — buttes, mesas, boulders
# ============================================================================
def build_butte(name, R, H, seed, coll, mat, n=18, flutes=9, cap="mesa",
                talus=0.30, ground=None):
    """Monument-Valley butte: talus cone → fluted wall → caprock.

    Silhouette comes from three things and nothing else: a concave debris
    slope at the bottom, near-vertical fluted walls (vertical columns of
    shadow), and a slightly overhanging caprock. The horizontal strata are
    COLOR_0 bands, not geometry — that is what keeps it from reading as a
    stack of tin cans while staying at ~700 triangles.
    """
    rng = random.Random(seed)
    ph = [rng.random() * TAU for _ in range(5)]
    # lobed, decidedly non-circular footprint
    plan = [1.0
            + 0.155 * math.sin(2 * TAU * i / n + ph[0])
            + 0.105 * math.sin(3 * TAU * i / n + ph[1])
            + 0.060 * math.sin(5 * TAU * i / n + ph[2])
            for i in range(n)]
    # hard alternation, not a cosine: sandstone erodes into crisp vertical
    # columns, and crisp edges are what carries the silhouette at this poly
    # count. 1 = column face, 0 = groove.
    flute = [(1.0 if i % 2 == 0 else 0.0) * (0.82 + 0.18 * rng.random())
             + (0.18 if i % 2 else 0.0) for i in range(n)]
    lean = Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)))

    zt = talus * H                          # top of the debris slope
    zc = 0.885 * H                          # underside of the caprock
    # the web has no GI bounce, so the dark end must not go below ~0.65 or the
    # bands turn to mud instead of reading as strata
    pal = [(1.00, 0.98, 0.95), (0.76, 0.67, 0.63), (0.93, 0.88, 0.85),
           (0.66, 0.56, 0.53), (0.98, 0.95, 0.92), (0.83, 0.75, 0.71),
           (0.90, 0.85, 0.82), (0.71, 0.61, 0.58)]
    bandh = H / rng.uniform(7.0, 11.0)
    boff = rng.random() * bandh

    verts, faces, cols = [], [], []

    def push(z, rs, fl, tint, dz_wave=0.0, sink=None, ceil_z=None, gap=0.8):
        base = len(verts)
        for i in range(n):
            a = TAU * i / n
            f = 1.0 - 0.115 * fl * (1.0 - flute[i])
            rr = R * rs * plan[i] * f
            off = lean * (max(z, 0.0) / H) * R
            px, py = rr * math.cos(a) + off.x, rr * math.sin(a) + off.y
            pz = z + dz_wave * math.cos(TAU * i / n + ph[4])
            if sink is not None and ground is not None:
                pz = min(pz, ground(px, py) - sink)
            # a sunk ring must still stay under the one above it, or the skirt
            # folds through itself on a steep flank
            if ceil_z is not None:
                pz = min(pz, ceil_z[i] - gap)
            verts.append((px, py, pz))
            shade = (1.0 - 0.26 * fl * (1.0 - flute[i])
                     ) * (0.965 + 0.035 * rng.random())
            cols.append(tuple(min(c * shade, 1.0) for c in tint))
        return base

    def strata(z):
        k = int((z + boff) / bandh)
        t = pal[k % len(pal)]
        j = 0.97 + 0.03 * math.sin(k * 2.3)
        return (t[0] * j, t[1] * j, t[2] * j)

    dust = (0.93, 0.88, 0.83)
    rings = []
    # -- talus: steep debris slope. It must stay narrow — these towers stand
    #    on hill tops, and a wide cone would hang in the air over the slope.
    # `sink` pins the two lowest rings under whatever the terrain does around
    # the tower, so the skirt never hangs in the air on a hill flank. Built
    # top-down so each sunk ring can be held below the one above it.
    # Everything from the z=0 ring down is pinned *under* the live terrain, so
    # the skirt cuts into the hillside instead of hovering over it — otherwise
    # the downhill side leaves a gap you can see through into the hollow shell.
    talus, ceil_z = [], None
    for z, rs, sink, gap in ((zt, 1.02, None, 0),
                             (0.67 * zt, 1.07, None, 0),
                             (0.34 * zt, 1.14, None, 0),
                             (0.0, 1.22, 0.35, 0.0),
                             (-0.16 * H, 1.34, 1.2, 0.5),
                             (-0.55 * H, 1.46, 3.5, 0.8)):
        t = max(0.0, min(1.0, (z + 0.55 * H) / (zt + 0.55 * H)))
        tint = tuple(dust[i] * (0.78 + 0.22 * t) for i in range(3))
        base = push(z, rs, 0.45 * t, tint, sink=sink,
                    ceil_z=ceil_z if (sink is not None and gap) else None,
                    gap=gap)
        ceil_z = [verts[base + i][2] for i in range(n)]
        talus.append(base)
    rings.extend(reversed(talus))
    # -- wall: near vertical, fluted, colour-banded ---------------------------
    NW = 9
    for k in range(1, NW + 1):
        t = k / NW
        z = zt + (zc - zt) * t
        rs = 1.02 - 0.085 * t ** 1.4 + 0.012 * math.sin(t * 9.0 + ph[1])
        rings.append(push(z, rs, 1.0, strata(z)))
    # -- caprock: a slight overhang, then break away to the summit -----------
    rings.append(push(zc + 0.035 * H, 0.985, 0.85, strata(zc * 1.02)))
    if cap == "mesa":
        rings.append(push(zc + 0.085 * H, 0.905, 0.55,
                          tuple(c * 0.86 for c in strata(H))))
        rings.append(push(H, 0.80, 0.25, tuple(c * 0.78 for c in strata(H)),
                          dz_wave=H * 0.012))
    else:                                             # weathered spire
        rings.append(push(zc + 0.06 * H, 0.72, 0.6, strata(H)))
        rings.append(push(H, 0.34, 0.2, tuple(c * 0.88 for c in strata(H))))
    for a, b in zip(rings, rings[1:]):
        band(faces, a, b, n)
    if cap == "mesa":
        faces.append(tuple(range(rings[-1], rings[-1] + n)))
    else:
        tip = len(verts)
        verts.append((lean.x * R, lean.y * R, H * 1.06))
        cols.append(tuple(c * 0.9 for c in strata(H)))
        for i in range(n):
            faces.append((rings[-1] + i, rings[-1] + (i + 1) % n, tip))
    # recalc=False on purpose: the ring winding is outward by construction, and
    # recalc_face_normals' heuristic inverts the whole shell when the sunk
    # skirt self-intersects (butte 9 shipped inside-out that way once).
    return build_mesh(name, verts, faces, coll, mat,
                      smooth_angle=math.radians(21), uv_scale=0.10,
                      vcolors=cols, recalc=False)


def build_boulder(name, R, seed, coll, mat, subdiv=2, squash=0.66):
    """Wind-eroded boulder: displaced icosphere, flat-ish bottom, dusty base."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=R)
    off = Vector((seed * 3.1 % 9.0, seed * 7.7 % 9.0, seed * 1.3 % 9.0))
    for v in bm.verts:
        nz = bnoise.noise(v.co * (1.7 / R) + off)
        nz2 = bnoise.noise(v.co * (4.5 / R) + off * 1.7)
        v.co += v.co.normalized() * (nz * 0.26 + nz2 * 0.07) * R
        v.co.z *= squash
        if v.co.z < -R * 0.45:                       # sit flat, half buried
            v.co.z = -R * 0.45 - (v.co.z + R * 0.45) * 0.15
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    lo = min(v[2] for v in verts)
    hi = max(v[2] for v in verts)
    cols = []
    for v in verts:
        t = (v[2] - lo) / max(hi - lo, 1e-6)
        f = 0.58 + 0.42 * t ** 0.8                    # dark where it meets sand
        j = 0.95 + 0.05 * bnoise.noise(Vector(v) * 2.2 + off)
        cols.append((f * j, f * j * 0.985, f * j * 0.97))
    return build_mesh(name, verts, faces, coll, mat,
                      smooth_angle=math.radians(46), uv_scale=0.30,
                      vcolors=cols)


# ============================================================================
# 4. PLANTS
# ============================================================================
def _frames(path):
    """Parallel-transported (right, up) frame per point of a polyline."""
    P = [Vector(p) for p in path]
    tan = []
    for k in range(len(P)):
        if k == 0:
            t = P[1] - P[0]
        elif k == len(P) - 1:
            t = P[-1] - P[-2]
        else:
            t = P[k + 1] - P[k - 1]
        tan.append(t.normalized())
    ref = Vector((0, 0, 1))
    if abs(tan[0].dot(ref)) > 0.95:
        ref = Vector((1, 0, 0))
    up = (ref - tan[0] * tan[0].dot(ref)).normalized()
    out = []
    for t in tan:
        up = up - t * t.dot(up)
        if up.length < 1e-5:
            up = t.orthogonal()
        up.normalize()
        out.append((up.cross(t).normalized(), up))
    return out


def _smooth_path(ctrl, sub=2):
    """Chaikin-ish subdivision so elbows curve instead of kinking."""
    P = [Vector(c) for c in ctrl]
    for _ in range(sub):
        out = [P[0]]
        for a, b in zip(P, P[1:]):
            out.append(a * 0.75 + b * 0.25)
            out.append(a * 0.25 + b * 0.75)
        out.append(P[-1])
        P = out
    return P


def build_saguaro(name, H, seed, coll, mat, arms=2, n=14, ribs=7):
    rng = random.Random(seed)
    pts, faces, uvs, cols = [], [], [], []
    R = 0.22 + 0.05 * rng.random()

    def tube(path, radii, tint_fn, close_top=True, v0=0.0):
        frames = _frames(path)
        rings, acc = [], v0
        for k, (c, r) in enumerate(zip(path, radii)):
            if k:
                acc += (Vector(path[k]) - Vector(path[k - 1])).length
            right, up = frames[k]
            tint = tint_fn(k / max(1, len(path) - 1))
            base = len(pts)
            for i in range(n):
                a = TAU * i / n
                rr = r * (1.0 if i % 2 == 0 else 0.78)   # rib crest / groove
                pts.append(tuple(Vector(c) + right * (rr * math.cos(a))
                                 + up * (rr * math.sin(a))))
                uvs.append((i / n, acc))
                shade = 1.0 if i % 2 == 0 else 0.72
                cols.append(tuple(min(c2 * shade, 1.0) for c2 in tint))
            rings.append(base)
        for a, b in zip(rings, rings[1:]):
            band(faces, a, b, n)
        if close_top:
            tan = (Vector(path[-1]) - Vector(path[-2])).normalized()
            tip = len(pts)
            pts.append(tuple(Vector(path[-1]) + tan * radii[-1] * 0.9))
            uvs.append((0.5, acc + radii[-1]))
            cols.append(tint_fn(1.0))
            for i in range(n):
                faces.append((rings[-1] + i, rings[-1] + (i + 1) % n, tip))
        return rings

    def trunk_tint(t):
        g = 0.74 + 0.26 * t
        return (g * 0.94, min(g, 1.0), g * 0.90)

    # trunk: slightly swollen at the base, gentle lean, rounded crown
    lean = rng.uniform(-0.045, 0.045)
    steps = 10
    path, radii = [], []
    for k in range(steps):
        t = k / (steps - 1)
        z = t * H
        path.append((lean * z * z / H, lean * 0.4 * z, z))
        radii.append(R * (1.07 - 0.11 * t - 0.34 * max(0.0, t - 0.88) / 0.12))
    tube(path, radii, trunk_tint)

    # arms: out of the trunk, elbow, then straight up alongside it
    for s in range(arms):
        yaw = rng.uniform(0, TAU) + s * TAU / max(arms, 1)
        d = Vector((math.cos(yaw), math.sin(yaw), 0))
        zb = H * rng.uniform(0.30, 0.46)
        alen = H * rng.uniform(0.24, 0.38)
        ar = R * 0.66
        reach = R + ar * (1.5 + 0.9 * rng.random())
        ctrl = [Vector((0, 0, zb)),
                Vector((0, 0, zb + 0.04)) + d * (R * 0.8),
                Vector((0, 0, zb + 0.16)) + d * reach * 0.75,
                Vector((0, 0, zb + 0.62)) + d * reach,
                Vector((0, 0, zb + 0.62 + alen * 0.5)) + d * reach,
                Vector((0, 0, zb + 0.62 + alen)) + d * reach]
        apath = _smooth_path(ctrl, sub=1)
        m = len(apath)
        aradii = [ar * (1.12 - 0.10 * (k / (m - 1))
                        - 0.30 * max(0.0, k / (m - 1) - 0.9) / 0.1)
                  for k in range(m)]
        tube(apath, aradii, trunk_tint)

    face_uvs = [[uvs[i] for i in f] for f in faces]
    # fix the wrap seam so the texture does not run backwards on one column
    for fi, f in enumerate(faces):
        us = [u for u, _ in face_uvs[fi]]
        if max(us) - min(us) > 0.5:
            face_uvs[fi] = [(u + 1.0 if u < 0.5 else u, v)
                            for u, v in face_uvs[fi]]
    return build_mesh(name, pts, faces, coll, mat,
                      smooth_angle=math.radians(30), face_uvs=face_uvs,
                      vcolors=cols)


def build_pear(name, seed, coll, mat):
    """Prickly pear: a clump of flattened pads."""
    rng = random.Random(seed)
    verts, faces, cols = [], [], []

    def pad(center, yaw, pitch, size):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        for v in bm.verts:
            v.co.x *= size * 0.62
            v.co.y *= size * 0.12
            v.co.z *= size
            v.co.z += size * 0.15 * math.sin(v.co.x * 3.0)
        mat_r = (Euler((0, pitch, yaw)).to_matrix())
        base = len(verts)
        for v in bm.verts:
            p = mat_r @ v.co + Vector(center)
            verts.append(tuple(p))
            t = 0.72 + 0.28 * min(1.0, max(0.0, (v.co.z / size + 1) * 0.5))
            cols.append((t * 0.95, t, t * 0.9))
        for f in bm.faces:
            faces.append(tuple(base + v.index for v in f.verts))
        bm.free()

    n_pads = rng.randint(4, 6)
    for k in range(n_pads):
        yaw = rng.uniform(0, TAU)
        h = 0.30 + 0.30 * k / max(1, n_pads - 1)
        size = rng.uniform(0.34, 0.52)
        pad((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), h + size * 0.7),
            yaw, rng.uniform(-0.35, 0.35), size)
    return build_mesh(name, verts, faces, coll, mat,
                      smooth_angle=math.radians(50), uv_scale=0.4, vcolors=cols)


def build_bush(name, R, seed, coll, mat):
    """Sage / creosote clump — squashed noisy blob, light at the tips."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=R)
    off = Vector((seed * 2.3 % 8, seed * 5.9 % 8, seed * 0.7 % 8))
    for v in bm.verts:
        nz = bnoise.noise(v.co * (4.0 / R) + off)
        v.co += v.co.normalized() * nz * 0.42 * R
        v.co.z *= 0.66
        v.co.z += R * 0.30
        if v.co.z < 0.02:
            v.co.z = 0.02
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(x.index for x in f.verts) for f in bm.faces]
    bm.free()
    hi = max(v[2] for v in verts)
    cols = []
    for v in verts:
        t = v[2] / max(hi, 1e-6)
        f = 0.52 + 0.48 * t
        j = 0.92 + 0.08 * bnoise.noise(Vector(v) * 6.0 + off)
        cols.append((f * j * 0.96, f * j, f * j * 0.82))
    return build_mesh(name, verts, faces, coll, mat,
                      smooth_angle=math.radians(60), uv_scale=0.5, vcolors=cols)


def build_tuft(name, seed, coll, mat):
    """Dry grass tuft: a handful of double-sided blades."""
    rng = random.Random(seed)
    verts, faces, cols = [], [], []
    for k in range(7):
        a = TAU * k / 7 + rng.uniform(-0.3, 0.3)
        lean = rng.uniform(0.18, 0.5)
        h = rng.uniform(0.30, 0.55)
        w = 0.035
        dx, dy = math.cos(a), math.sin(a)
        base = len(verts)
        verts += [(-dy * w, dx * w, 0.0), (dy * w, -dx * w, 0.0),
                  (dx * lean * 0.45, dy * lean * 0.45, h * 0.62),
                  (dx * lean, dy * lean, h)]
        faces.append((base, base + 1, base + 2))
        faces.append((base + 1, base + 3, base + 2))
        for t in (0.0, 0.0, 0.62, 1.0):
            f = 0.62 + 0.38 * t
            cols.append((f, f * 0.95, f * 0.72))
    return build_mesh(name, verts, faces, coll, mat, smooth_angle=None,
                      uv_scale=0.5, vcolors=cols, recalc=False)


# ============================================================================
# 5. PROPS — covered wagon, barrels, crate
# ============================================================================
def build_wheel(name, R, coll, m, spokes=10, seg=14):
    verts, faces = [], []
    w = 0.055
    ro, ri = R, R * 0.86
    for z in (-w, w):
        for r in (ro, ri):
            base = len(verts)
            for i in range(seg):
                a = TAU * i / seg
                verts.append((r * math.cos(a), r * math.sin(a), z))
    o0, i0, o1, i1 = 0, seg, seg * 2, seg * 3
    band(faces, o0, o1, seg)           # outer tread
    band(faces, i1, i0, seg)           # inner face
    band(faces, i0, o0, seg)           # side A
    band(faces, o1, i1, seg)           # side B
    hub = len(verts)
    for z in (-0.075, 0.075):
        for i in range(8):
            a = TAU * i / 8
            verts.append((0.09 * math.cos(a), 0.09 * math.sin(a), z))
    band(faces, hub, hub + 8, 8)
    faces.append(tuple(range(hub + 8, hub + 16)))
    faces.append(tuple(reversed(range(hub, hub + 8))))
    rim = build_mesh(name, verts, faces, coll, m["wood"],
                     smooth_angle=math.radians(35), uv_scale=0.5)
    # spokes as one extra mesh piece merged in
    sv, sf = [], []
    for k in range(spokes):
        a = TAU * k / spokes
        ca, sa = math.cos(a), math.sin(a)
        px, py = -sa, ca
        base = len(sv)
        for r, hw in ((0.085, 0.030), (ri, 0.022)):
            for dz in (-0.028, 0.028):
                sv.append((ca * r + px * hw, sa * r + py * hw, dz))
                sv.append((ca * r - px * hw, sa * r - py * hw, dz))
        sf += [(base, base + 1, base + 3, base + 2),
               (base + 4, base + 6, base + 7, base + 5),
               (base, base + 2, base + 6, base + 4),
               (base + 1, base + 5, base + 7, base + 3),
               (base, base + 4, base + 5, base + 1),
               (base + 2, base + 3, base + 7, base + 6)]
    sp = build_mesh(name + "_Spokes", sv, sf, coll, m["wood_d"], uv_scale=0.5)
    return rim, sp


def build_wagon(coll, m, loc, yaw, terrain):
    """Planenwagen — bed, bows, sagging canvas, four spoked wheels, tongue."""
    root = bpy.data.objects.new("WP3_Wagon_Root", None)
    root.empty_display_size = 0.4
    root.location = loc
    root.rotation_euler = Euler((0, 0, yaw))
    coll.objects.link(root)
    parts = []

    BW, BL = 1.30, 3.30                       # bed width / length
    bed_z = 0.95
    # ---- bed box (floor, two sides, two ends, top rails) -------------------
    def plank(name, size, at, mat, bevel=0.01):
        o = L.box(name, size, location=at, coll=coll, mat=mat, bevel=bevel,
                  uv_scale=0.6)
        parts.append(o)
        return o

    plank("WP3_Wagon_Floor", (BW, BL, 0.09), (0, 0, bed_z), m["plank"])
    for sx in (-1, 1):
        plank(f"WP3_Wagon_Side{'L' if sx < 0 else 'R'}",
              (0.07, BL, 0.52), (sx * BW / 2, 0, bed_z + 0.28), m["wood"])
    for sy in (-1, 1):
        plank(f"WP3_Wagon_End{'S' if sy < 0 else 'N'}",
              (BW, 0.07, 0.52), (0, sy * BL / 2, bed_z + 0.28), m["wood"])
    for sx in (-1, 1):
        plank(f"WP3_Wagon_Rail{'L' if sx < 0 else 'R'}",
              (0.12, BL + 0.1, 0.06), (sx * BW / 2, 0, bed_z + 0.57), m["wood_d"])
    plank("WP3_Wagon_Bolster_F", (BW + 0.5, 0.16, 0.14), (0, BL * 0.32, bed_z - 0.10),
          m["wood_d"])
    plank("WP3_Wagon_Bolster_R", (BW + 0.5, 0.16, 0.14), (0, -BL * 0.32, bed_z - 0.10),
          m["wood_d"])
    plank("WP3_Wagon_Seat", (BW - 0.16, 0.30, 0.08), (0, BL * 0.40, bed_z + 0.62),
          m["wood_d"])
    plank("WP3_Wagon_SeatBack", (BW - 0.16, 0.07, 0.26), (0, BL * 0.53, bed_z + 0.78),
          m["wood_d"])

    # ---- canvas: half tube with a sag between the bows ---------------------
    nb, na = 9, 12                             # length steps, arc steps
    verts, faces = [], []
    hw, hh = BW / 2 + 0.17, 0.92                # laps over the side rails
    z0 = bed_z + 0.46
    for k in range(nb):
        t = k / (nb - 1)
        y = (t - 0.5) * (BL + 0.12)
        sag = 1.0 - 0.055 * (0.5 + 0.5 * math.cos(TAU * (nb - 1) / 2 * t))
        pinch = 1.0 - 0.12 * (2 * abs(t - 0.5)) ** 3
        for i in range(na + 1):
            a = math.pi * i / na
            verts.append((-math.cos(a) * hw * pinch, y,
                          z0 + math.sin(a) * hh * sag * pinch))
    for k in range(nb - 1):
        for i in range(na):
            a = k * (na + 1) + i
            b = a + na + 1
            faces.append((a, a + 1, b + 1, b))
    canvas = build_mesh("WP3_Wagon_Canvas", verts, faces, coll, m["canvas"],
                        smooth_angle=math.radians(50), uv_scale=0.55,
                        recalc=False)
    parts.append(canvas)
    # end hoops so the openings read as fabric over ribs
    for sy in (-1, 1):
        y = sy * (BL + 0.12) / 2
        pts = [(-math.cos(math.pi * i / 10) * hw * 0.885, y,
                z0 + math.sin(math.pi * i / 10) * hh * 0.885) for i in range(11)]
        parts.append(L.tube(f"WP3_Wagon_Hoop{'N' if sy > 0 else 'S'}", pts,
                            0.035, segs=5, coll=coll, mat=m["wood_d"]))

    # ---- running gear ------------------------------------------------------
    rim_big, spk_big = build_wheel("WP3_Wagon_WheelSrcR", 0.72, coll, m)
    rim_sml, spk_sml = build_wheel("WP3_Wagon_WheelSrcF", 0.50, coll, m)
    for src in (rim_big, spk_big, rim_sml, spk_sml):
        stow(src)
    for sx in (-1, 1):
        for sy, (rim, spk, R) in ((-1, (rim_big, spk_big, 0.72)),
                                  (1, (rim_sml, spk_sml, 0.50))):
            tag = f"{'L' if sx < 0 else 'R'}{'R' if sy < 0 else 'F'}"
            at = (sx * (BW / 2 + 0.14), sy * BL * 0.32, R)
            for src, nm in ((rim, "Rim"), (spk, "Spokes")):
                o = src.copy()
                o.name = f"WP3_Wagon_Wheel{tag}_{nm}"
                o.hide_render = o.hide_viewport = False
                o.location = at
                o.rotation_euler = Euler((0, math.pi / 2, 0))
                coll.objects.link(o)
                parts.append(o)
    for sy in (-1, 1):
        parts.append(L.cylinder(f"WP3_Wagon_Axle{'F' if sy > 0 else 'R'}", 0.055,
                                BW + 0.34, segs=8,
                                location=(0, sy * BL * 0.32, 0.72 if sy < 0 else 0.50),
                                rotation=(0, math.pi / 2, 0), coll=coll,
                                mat=m["iron"], uv_scale=0.5))
    parts.append(L.box("WP3_Wagon_Tongue", (0.10, 2.10, 0.09),
                       location=(0, BL * 0.32 + 1.15, 0.44),
                       rotation=(-0.12, 0, 0), coll=coll, mat=m["wood_d"],
                       bevel=0.01, uv_scale=0.6))
    parts.append(L.box("WP3_Wagon_Yoke", (0.72, 0.08, 0.07),
                       location=(0, BL * 0.32 + 2.05, 0.30), coll=coll,
                       mat=m["wood_d"], bevel=0.01, uv_scale=0.6))

    for o in parts:
        # every part is modelled in the root's local frame, so the parent
        # inverse must stay identity (matrix_world is stale in background mode
        # anyway — deriving it from there would silently cancel the transform)
        o.parent = root
    root.location = (loc[0], loc[1], terrain.z(loc[0], loc[1]) - 0.05)
    return root


def build_barrel(name, coll, m, R=0.30, H=0.86):
    verts, faces, cols = [], [], []
    n = 12
    prof = [(0.00, 0.84), (0.10, 0.94), (0.34, 1.00), (0.62, 1.00),
            (0.90, 0.93), (1.00, 0.84)]
    rings = []
    for t, k in prof:
        base = len(verts)
        for i in range(n):
            a = TAU * i / n
            verts.append((R * k * math.cos(a), R * k * math.sin(a), t * H))
            shade = 0.80 + 0.20 * (0.5 + 0.5 * math.cos(2 * a))
            cols.append((shade, shade * 0.97, shade * 0.94))
        rings.append(base)
    for a, b in zip(rings, rings[1:]):
        band(faces, a, b, n)
    faces.append(tuple(range(rings[-1], rings[-1] + n)))
    faces.append(tuple(reversed(range(rings[0], rings[0] + n))))
    body = build_mesh(name, verts, faces, coll, m["wood"],
                      smooth_angle=math.radians(38), uv_scale=0.7, vcolors=cols)
    hv, hf = [], []
    for zc, k in ((0.16, 0.965), (0.50, 1.012), (0.84, 0.955)):
        for dz in (-0.035, 0.035):
            base = len(hv)
            for i in range(n):
                a = TAU * i / n
                r = R * k * 1.02
                hv.append((r * math.cos(a), r * math.sin(a), zc * H + dz))
        band(hf, base - n, base, n)
    hoops = build_mesh(name + "_Hoops", hv, hf, coll, m["iron"], uv_scale=0.7)
    return body, hoops


def build_crate(name, coll, m, s=0.55):
    o = L.box(name, (s, s * 0.8, s * 0.72), coll=coll, mat=m["plank"],
              bevel=0.015, uv_scale=0.8)
    return o


# ============================================================================
# 6. TERRAIN SCULPT
# ============================================================================
PROTECT = [(0.0, -127.0, 15.0),      # saloon, deck, trough, horses
           (0.0, -106.5, 7.0),       # ÜBER MICH sign
           (0.0, -141.0, 11.0)]      # mine portal / track


def _handmade_mask(me):
    """Cells (4 m) that contain vertices sculpted by hand — keep hands off.

    Latched into a scene property the first time: after our own sculpt the
    heights no longer match the generator, so re-deriving it on a second run
    would flag our own dunes as hand work and freeze them in place.
    """
    import wp3_desert as W
    scn = bpy.context.scene
    if "wp3_hand_cells" in scn.keys():
        cells = {tuple(c) for c in json.loads(scn["wp3_hand_cells"])}
        print(f"[wp3] reusing {len(cells)} latched hand-sculpted terrain cells")
        return cells
    cells = set()
    for v in me.vertices:
        if abs(v.co.z - W._terrain_fn(v.co.x, v.co.y)) > 0.35:
            cells.add((int(v.co.x // 4), int(v.co.y // 4)))
    scn["wp3_hand_cells"] = json.dumps(sorted(cells))
    print(f"[wp3] latched {len(cells)} hand-sculpted terrain cells")
    return cells


def sculpt_terrain(terrain, mounds):
    """Absolute, not incremental: every vertex we own is rebuilt from the
    generator height + our displacement, so re-running is a no-op."""
    import wp3_desert as W
    me = terrain.me
    hand = _handmade_mask(me)
    edits = 0
    for v in me.vertices:
        x, y = v.co.x, v.co.y
        z = W._terrain_fn(x, y)
        if y > -104.0 or y < -148.0 or abs(x) > 56.0:
            continue                                  # blend bands / seams
        ci, cj = int(x // 4), int(y // 4)
        if any((ci + a, cj + b) in hand
               for a in (-1, 0, 1) for b in (-1, 0, 1)):
            continue                                  # hand-sculpted region
        w = 1.0
        w = min(w, L.smoothstep(TERRAIN_CLEAR, TERRAIN_CLEAR + 4.5,
                                rail_dist(x, y)))
        for px, py, pr in PROTECT:
            w = min(w, L.smoothstep(pr, pr + 5.0, math.hypot(x - px, y - py)))
        if w <= 0.001:
            continue
        d = 0.0
        # low dunes + wind ripples, rotated ~30° off the valley axis
        u = x * 0.866 + y * 0.5
        d += 0.34 * math.sin(u / 8.5) * math.cos((y * 0.866 - x * 0.5) / 21.0)
        d += 0.11 * math.sin(u / 2.7 + 1.3)
        d += 0.55 * bnoise.noise(Vector((x * 0.035, y * 0.035, 3.1)))
        # pedestals so the new rock towers grow out of the ground
        for mx, my, mr, mh in mounds:
            dist = math.hypot(x - mx, y - my)
            d += mh * math.exp(-(dist / mr) ** 2 * 1.4)
        v.co.z = z + d * w
        edits += 1
    me.update()
    print(f"[wp3] sculpted {edits} terrain vertices")

    ca = me.color_attributes.get("Col")
    if ca is not None and ca.domain == 'POINT':
        # Sand on the flats, exposed red rock where the ground gets steep —
        # COLOR_0 can only darken (PIPELINE §5), and that is exactly what
        # turns the pale gauss-bump hills into weathered mesa flanks.
        rock = (0.95, 0.77, 0.65)
        # rebuilt from wp3_desert's own vertex_noise(0.12, 0.08, seed=13) so a
        # second run does not multiply the tint into the ground twice
        noff = Vector((13 * 3.7 % 11, 13 * 9.1 % 11, 0.618 * 13 % 11))
        for i, v in enumerate(me.vertices):
            if not (-152.0 < v.co.y < -100.0):
                continue
            base = 1.0 - 0.12 * (0.5 + 0.5 * bnoise.noise(v.co * 0.08 + noff))
            steep = L.smoothstep(0.26, 0.70, 1.0 - abs(v.normal.z))
            # low frequency only: the grid is ~1.2 m, anything finer speckles
            n1 = bnoise.noise(Vector((v.co.x * 0.035, v.co.y * 0.035, 7.7)))
            n2 = bnoise.noise(Vector((v.co.x * 0.075, v.co.y * 0.075, 2.2)))
            f = base * (1.0 + 0.06 * n1 + 0.02 * n2)
            ca.data[i].color = tuple(
                min(f * (1.0 + (rock[k] - 1.0) * steep * (0.85 + 0.15 * n2)),
                    1.0) for k in range(3)) + (1.0,)
        print("[wp3] re-tinted terrain COLOR_0 (slope-blended rock)")


# ============================================================================
# 7. LAYOUT
# ============================================================================
# (x, y, R, H, seed, kind, yaw)  — kind: mesa | spire
BUTTES = [
    (-16.5, -110.0, 7.0, 19.0, 11, "mesa", 0.4),     # gate wall, visitor left
    (18.0, -112.5, 8.0, 22.0, 23, "mesa", 1.9),      # gate wall, visitor right
    (-30.0, -124.5, 11.0, 26.0, 31, "mesa", 0.9),
    (33.0, -127.0, 10.0, 24.0, 47, "mesa", 2.6),
    (-25.5, -140.0, 7.0, 15.0, 53, "spire", 1.4),
    (25.0, -142.0, 6.0, 13.0, 61, "spire", 0.2),
    (-45.0, -116.0, 13.0, 30.0, 71, "mesa", 2.1),
    (46.0, -134.0, 12.0, 27.0, 83, "mesa", 0.6),
    (-19.0, -150.0, 9.0, 17.0, 97, "mesa", 1.1),     # on the ridge, far south
    (17.0, -151.5, 8.0, 15.0, 103, "mesa", 2.4),
]

BOULDERS = [
    (-9.6, -112.5, 1.5, 0), (-11.8, -116.0, 0.9, 1), (-7.2, -117.6, 0.6, 2),
    (11.0, -108.5, 1.2, 3), (12.4, -118.6, 1.8, 4), (9.4, -121.4, 0.7, 5),
    (-19.5, -119.5, 2.2, 6), (-16.0, -131.0, 1.4, 7), (-12.5, -134.5, 0.8, 8),
    (18.0, -131.5, 1.9, 9), (14.5, -136.5, 1.0, 10), (20.5, -122.0, 1.3, 11),
    (-6.6, -136.5, 0.6, 12), (7.4, -136.0, 0.8, 13), (-8.0, -143.0, 1.1, 14),
    (8.6, -144.0, 1.5, 15),
    # small stuff near the saloon so the foreground is not bald sand
    (-5.6, -119.8, 0.45, 16), (6.2, -117.2, 0.55, 17), (-7.4, -121.5, 0.35, 18),
    (7.6, -131.5, 0.50, 19), (-5.0, -133.5, 0.40, 20),
]

SAGUAROS = [
    (-10.5, -114.5, 3.9), (13.2, -116.0, 4.6), (-17.5, -127.5, 5.2),
    (10.6, -132.5, 3.4), (-8.4, -139.5, 4.1), (19.0, -126.0, 4.8),
    (-21.0, -117.0, 3.6), (16.5, -110.0, 4.2), (-13.0, -144.0, 3.8),
    (12.0, -142.5, 4.4), (-30.0, -131.0, 5.0), (26.0, -134.5, 4.5),
]

PEARS = [(-6.9, -119.0), (8.2, -114.5), (-12.2, -124.5), (11.8, -128.0),
         (-9.0, -132.0), (6.4, -139.0), (-18.0, -113.0), (17.5, -120.0)]


def slope(terrain, x, y, d=1.6):
    """Max height difference over `d` metres — plants hate cliffs."""
    z = terrain.z(x, y)
    return max(abs(terrain.z(x + dx, y + dy) - z)
               for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d))) / d


def settle(terrain, x, y, limit=0.42, radius=7.0):
    """Nudge a plant to the flattest spot within `radius` if it sits on a slope."""
    if slope(terrain, x, y) <= limit:
        return x, y
    best, bs = (x, y), slope(terrain, x, y)
    for k in range(48):
        a = TAU * k * 0.618
        r = radius * ((k + 1) / 48) ** 0.5
        nx, ny = x + r * math.cos(a), y + r * math.sin(a)
        if rail_dist(nx, ny) < CLEAR:
            continue
        s = slope(terrain, nx, ny)
        if s < bs:
            best, bs = (nx, ny), s
            if s <= limit:
                break
    return best


def scatter(rng, n, ylo, yhi, terrain, keep=4.6, existing=None):
    out = []
    tries = 0
    existing = list(existing or [])
    while len(out) < n and tries < n * 60:
        tries += 1
        x = rng.uniform(-38, 38)
        y = rng.uniform(ylo, yhi)
        if rail_dist(x, y) < keep:
            continue
        # scrub may grow right up to the buildings — only the footprints are
        # off limits, not the whole terrain-protection disc
        if any(math.hypot(x - px, y - py) < pr * 0.55 for px, py, pr in PROTECT):
            continue
        if any(math.hypot(x - ox, y - oy) < 2.0 for ox, oy in existing + out):
            continue
        z = terrain.z(x, y)
        if z > 12.0 or slope(terrain, x, y) > 0.75:   # bare, steep hillsides
            continue
        out.append((x, y))
    return out


# ============================================================================
def main(argv):
    save = "--save" in argv
    export = "--export" in argv
    shots = "--shots" in argv

    coll = wp3()
    purge()
    m = materials()
    terrain = Terrain()

    # --- terrain first, so everything can be seated on the final surface ----
    mounds = [(x, y, R * 1.45, 0.9 + H * 0.035) for x, y, R, H, *_ in BUTTES]
    sculpt_terrain(terrain, mounds)
    terrain.rebuild()

    # --- rock formations ----------------------------------------------------
    for k, (x, y, R, H, seed, kind, yaw) in enumerate(BUTTES):
        # 1.35 R is where the talus cone meets the sand
        d = assert_clear(x, y, f"butte {k}", need=1.35 * R + 3.5)
        z = terrain.z(x, y) + 0.4
        ca, sa = math.cos(yaw), math.sin(yaw)

        def ground(lx, ly, x=x, y=y, z=z, ca=ca, sa=sa):
            return terrain.z(x + lx * ca - ly * sa, y + lx * sa + ly * ca) - z

        o = build_butte(f"WP3_Butte_{k}", R, H, seed, coll,
                        m["rock"] if k % 2 == 0 else m["rock_d"],
                        n=22 if R > 9 else 18,
                        flutes=11 if R > 9 else 9,
                        cap=kind, ground=ground)
        o.location = (x, y, z)
        o.rotation_euler = Euler((0, 0, yaw))
        print(f"    butte {k}: z={z:6.2f} rail={d:5.1f} m")

    src_rocks = [build_boulder(f"WP3_RockSrc_{i}", 1.0, 100 + i * 7, coll,
                               m["rock"] if i != 1 else m["rock_d"],
                               subdiv=2, squash=(0.70, 0.82, 0.62)[i])
                 for i in range(3)]
    for o in src_rocks:
        stow(o)
    for i, (x, y, s, seed) in enumerate(BOULDERS):
        assert_clear(x, y, f"boulder {i}", need=CLEAR + s)
        src = src_rocks[seed % 3]
        rng = random.Random(seed)
        o = L.inst(src, f"WP3_Rock_{i}", (x, y, terrain.z(x, y) - 0.22 * s),
                   rotation=(rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14),
                             rng.uniform(0, TAU)),
                   scale=(s, s * rng.uniform(0.82, 1.1), s * rng.uniform(0.7, 1.0)),
                   coll=coll)
        o.hide_render = o.hide_viewport = False

    # --- plants -------------------------------------------------------------
    src_sag = [build_saguaro(f"WP3_SaguaroSrc_{i}", 1.0, 200 + i * 13, coll,
                             m["cactus"], arms=(2, 1, 3, 2)[i])
               for i in range(4)]
    for o in src_sag:
        stow(o)
    for i, (x, y, h) in enumerate(SAGUAROS):
        x, y = settle(terrain, x, y, limit=0.38)
        assert_clear(x, y, f"saguaro {i}", need=CLEAR)
        rng = random.Random(300 + i)
        o = L.inst(src_sag[i % 4], f"WP3_Saguaro_{i}",
                   (x, y, terrain.z(x, y) - 0.12),
                   rotation=(0, 0, rng.uniform(0, TAU)),
                   scale=(h * rng.uniform(0.95, 1.05), h, h), coll=coll)
        o.hide_render = o.hide_viewport = False

    src_pear = build_pear("WP3_PearSrc", 900, coll, m["cactus_flat"])
    stow(src_pear)
    for i, (x, y) in enumerate(PEARS):
        x, y = settle(terrain, x, y, limit=0.45)
        assert_clear(x, y, f"pear {i}", need=CLEAR)
        rng = random.Random(400 + i)
        o = L.inst(src_pear, f"WP3_Pear_{i}", (x, y, terrain.z(x, y) - 0.08),
                   rotation=(0, 0, rng.uniform(0, TAU)),
                   scale=rng.uniform(0.85, 1.35), coll=coll)
        o.hide_render = o.hide_viewport = False

    src_bush = [build_bush(f"WP3_BushSrc_{i}", 0.62, 500 + i * 9, coll, m["bush"])
                for i in range(2)]
    src_tuft = build_tuft("WP3_TuftSrc", 600, coll, m["grass"])
    for o in src_bush + [src_tuft]:
        stow(o)
    rng = random.Random(7)
    taken = [(x, y) for x, y, *_ in BUTTES] + [(x, y) for x, y, *_ in BOULDERS]
    for i, (x, y) in enumerate(scatter(rng, 46, -147, -105, terrain,
                                       keep=4.2, existing=taken)):
        o = L.inst(src_bush[i % 2], f"WP3_Bush_{i}", (x, y, terrain.z(x, y) - 0.10),
                   rotation=(0, 0, rng.uniform(0, TAU)),
                   scale=(rng.uniform(0.7, 1.6), rng.uniform(0.7, 1.6),
                          rng.uniform(0.6, 1.2)), coll=coll)
        o.hide_render = o.hide_viewport = False
    for i, (x, y) in enumerate(scatter(rng, 36, -147, -105, terrain,
                                       keep=4.2, existing=taken)):
        o = L.inst(src_tuft, f"WP3_Tuft_{i}", (x, y, terrain.z(x, y) - 0.03),
                   rotation=(0, 0, rng.uniform(0, TAU)),
                   scale=rng.uniform(0.75, 1.5), coll=coll)
        o.hide_render = o.hide_viewport = False

    # --- props --------------------------------------------------------------
    # "rechts neben dem Saloon": the visitor travels −Y, so their right is −X.
    wagon_at = (-9.4, -125.4)
    assert_clear(*wagon_at, "wagon", need=6.0)
    build_wagon(coll, m, (wagon_at[0], wagon_at[1], 0.0), math.radians(-104.0),
                terrain)

    body, hoops = build_barrel("WP3_BarrelSrc", coll, m)
    crate = build_crate("WP3_CrateSrc", coll, m)
    for o in (body, hoops, crate):
        stow(o)
    DECK_Z = -9.70
    barrels = [                     # x, y, z, tilt, yaw, scale
        (-3.95, -123.35, DECK_Z, 0.0, 0.4, 1.00),
        (-4.30, -124.10, DECK_Z, 0.0, 1.9, 0.92),
        (3.85, -123.55, DECK_Z, 0.0, 2.7, 1.05),
        (5.75, -121.35, None, math.pi / 2, 0.9, 0.95),      # lying in the sand
        (-6.25, -122.05, None, 0.0, 2.2, 0.88),
    ]
    for i, (x, y, z, tilt, yaw, s) in enumerate(barrels):
        zz = z if z is not None else terrain.z(x, y) + (0.30 * s if tilt else 0.0)
        assert_clear(x, y, f"barrel {i}", need=3.2)
        for src, tag in ((body, ""), (hoops, "_Hoops")):
            o = L.inst(src, f"WP3_Barrel_{i}{tag}", (x, y, zz),
                       rotation=(tilt, 0, yaw), scale=s, coll=coll)
            o.hide_render = o.hide_viewport = False
    for i, (x, y, yaw, s) in enumerate(((-5.45, -122.75, 0.5, 1.0),
                                        (4.9, -122.35, 2.3, 0.8))):
        o = L.inst(crate, f"WP3_Crate_{i}", (x, y, terrain.z(x, y) + 0.20 * s),
                   rotation=(0, 0, yaw), scale=s, coll=coll)
        o.hide_render = o.hide_viewport = False

    merge_duplicate_materials()

    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
               for o in coll.all_objects
               if o.type == 'MESH' and not o.hide_render)
    print(f"[wp3] WP3 now {len(coll.all_objects)} objects, {tris} visible tris")

    if save:
        import exporter
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if export:
        import exporter
        exporter.export_glb(os.path.join(OUT, "world.glb"))
    if shots:
        import wp3_shots
        wp3_shots.render_all(os.path.join(OUT, "wp3_shots"))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
