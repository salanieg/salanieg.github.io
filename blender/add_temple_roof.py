# ============================================================================
# add_temple_roof.py — crown the brutalist atrium with a Roman temple roof:
# an entablature ring + projecting cornice, a low-pitched gabled terracotta
# roof (ridge along Y), longitudinal tile battens + ridge cap, and a triangular
# pediment (tympanum) over each short end — the entrance gate (+Y) and the arch
# (-Y) — with horizontal + raking cornices and corner acroteria.
#
# Adds only WP1_Temple_* objects to the WP1_Atrium collection; idempotent
# (re-running wipes the previous WP1_Temple_* + Temple_* materials first).
# Edits world.blend in place — never regenerates the world.
#
#   "…/blender.exe" -b blender/output/world.blend -P blender/add_temple_roof.py -- --save --export
#   …                                                                       -- --preview DIR
# ============================================================================
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.append(HERE)
import lib_common as L
OUT = os.path.join(HERE, "output")

# ---- geometry (Blender Z-up; atrium walls x=±9..10, cornice top ~12.45) -----
EAVE_X = 10.80          # eaves overhang past the wall cornice (±10.05)
EAVE_Z = 13.00          # roof springs from here (just above the wall cornice)
RIDGE_Z = 16.00         # ridge apex → ~15.5° pitch over the 10.8 m half-span
Y0, Y1 = -16.70, 17.00  # roof extent along the ridge (overhangs both gables)
PED_YN, PED_YP = -15.90, 16.20   # tympanum planes (arch end / gate end)
PED_HALF = 10.40        # pediment base half-width
ENT_Z0, ENT_Z1 = 11.80, 12.80    # entablature band
COR_Z1 = 13.02          # cornice cap top
THICK = 0.20            # roof slab thickness


def _get_mat(name, color, **kw):
    m = bpy.data.materials.get(name)
    return m if m else L.material(name, color, **kw)


def _mats():
    return {
        "concrete": _get_mat("Brutalist_Concrete", (0.58, 0.56, 0.53), rough=0.92),
        "concrete2": _get_mat("Brutalist_Concrete_Dark", (0.45, 0.44, 0.42), rough=0.95),
        "stone": _get_mat("Statue_Pedestal_Stone", (0.80, 0.74, 0.64), rough=0.42),
        "tile": L.material("Temple_Roof_Tile", (0.605, 0.300, 0.185), rough=0.70),
        "tile2": L.material("Temple_Roof_Ridge", (0.485, 0.235, 0.150), rough=0.74),
    }


def _slope(coll, sx, mat):
    """One closed roof slab from the ridge down to an eave (side sx=±1)."""
    n = Vector((sx * 0.964, 0.0, 0.268))   # outward slope normal (X,Z)
    top = [Vector((sx * EAVE_X, Y0, EAVE_Z)), Vector((0.0, Y0, RIDGE_Z)),
           Vector((0.0, Y1, RIDGE_Z)), Vector((sx * EAVE_X, Y1, EAVE_Z))]
    bot = [p - n * THICK for p in top]
    bm = bmesh.new()
    tv = [bm.verts.new(p) for p in top]
    bv = [bm.verts.new(p) for p in bot]
    bm.faces.new(tv)
    bm.faces.new(list(reversed(bv)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((tv[i], tv[j], bv[j], bv[i]))
    L.bm_to_obj(bm, f"WP1_Temple_Slope_{'E' if sx > 0 else 'W'}", coll=coll,
                mat=mat, smooth_angle=math.radians(50), uv_scale=0.45)


def _battens(coll, mat):
    """Longitudinal tile ridges (imbrices) running down each slope."""
    n = round((Y1 - Y0) / 1.35)
    for sx in (-1, 1):
        side = 'E' if sx > 0 else 'W'
        for k in range(n):
            y = Y0 + (Y1 - Y0) * (k + 0.5) / n
            L.tube(f"WP1_Temple_Batten_{side}_{k}",
                   [(0.0, y, RIDGE_Z + 0.03), (sx * EAVE_X, y, EAVE_Z + 0.03)],
                   0.075, segs=7, coll=coll, mat=mat,
                   smooth_angle=math.radians(60), uv_scale=0.6)


def _entablature(coll, m):
    """Concrete architrave/frieze ring + projecting travertine cornice cap."""
    zc = (ENT_Z0 + ENT_Z1) / 2
    h = ENT_Z1 - ENT_Z0
    yspan = Y1 - 0.55 - (Y0 + 0.55)
    ymid = ((Y1 - 0.55) + (Y0 + 0.55)) / 2
    for sx in (-1, 1):
        L.box(f"WP1_Temple_Ent_{'E' if sx > 0 else 'W'}",
              (0.6, yspan, h), location=(sx * 10.25, ymid, zc),
              coll=coll, mat=m["concrete"], bevel=0.03)
    for sy, yv in (("S", PED_YN), ("N", PED_YP)):
        L.box(f"WP1_Temple_Ent_{sy}", (2 * 10.25 + 0.6, 0.6, h),
              location=(0.0, yv, zc), coll=coll, mat=m["concrete"], bevel=0.03)
    # projecting cornice ledge (the eave line)
    cz = (ENT_Z1 + COR_Z1) / 2
    ch = COR_Z1 - ENT_Z1
    for sx in (-1, 1):
        L.box(f"WP1_Temple_Cornice_{'E' if sx > 0 else 'W'}",
              (0.9, yspan + 0.5, ch + 0.14), location=(sx * 10.55, ymid, cz),
              coll=coll, mat=m["stone"], bevel=0.04, uv_scale=0.5)
    for sy, yv in (("S", PED_YN), ("N", PED_YP)):
        L.box(f"WP1_Temple_Cornice_{sy}", (2 * 10.55 + 0.9, 0.9, ch + 0.14),
              location=(0.0, yv, cz), coll=coll, mat=m["stone"], bevel=0.04,
              uv_scale=0.5)


def _pediment(coll, m, yc, outward, tag):
    """Triangular tympanum + horizontal & raking cornices + acroteria."""
    thick = 0.55
    apex = Vector((0.0, yc, RIDGE_Z))
    l = Vector((-PED_HALF, yc, EAVE_Z))
    r = Vector((PED_HALF, yc, EAVE_Z))
    bm = bmesh.new()
    front = [bm.verts.new(p + Vector((0, outward * thick / 2, 0))) for p in (l, r, apex)]
    back = [bm.verts.new(p - Vector((0, outward * thick / 2, 0))) for p in (l, r, apex)]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((front[i], front[j], back[j], back[i]))
    ped = L.bm_to_obj(bm, f"WP1_Temple_Tympanum_{tag}", coll=coll,
                      mat=m["concrete"], smooth_angle=math.radians(25), uv_scale=0.35)
    L.vertex_noise(ped, 0.22, 0.5, seed=40 + (1 if outward > 0 else 0))

    # cornices sit proud on the outward face
    yf = yc + outward * (thick / 2 + 0.12)
    corners = {"L": Vector((-PED_HALF - 0.15, yf, EAVE_Z)),
               "R": Vector((PED_HALF + 0.15, yf, EAVE_Z)),
               "A": Vector((0.0, yf, RIDGE_Z + 0.05))}
    L.tube(f"WP1_Temple_Geison_{tag}",
           [(-PED_HALF - 0.3, yf, EAVE_Z), (PED_HALF + 0.3, yf, EAVE_Z)],
           0.17, segs=8, coll=coll, mat=m["stone"], uv_scale=0.5)
    L.tube(f"WP1_Temple_Rake_L_{tag}", [corners["L"], corners["A"]], 0.15,
           segs=8, coll=coll, mat=m["stone"], uv_scale=0.5)
    L.tube(f"WP1_Temple_Rake_R_{tag}", [corners["R"], corners["A"]], 0.15,
           segs=8, coll=coll, mat=m["stone"], uv_scale=0.5)
    # acroteria: a stepped block finial at the apex and both eave corners
    for key, cpos in corners.items():
        base = 0.42 if key == "A" else 0.32
        L.box(f"WP1_Temple_Acro_{tag}_{key}", (base, 0.42, base * 1.3),
              location=(cpos.x, yc, cpos.z + base * 0.65 + 0.05),
              coll=coll, mat=m["stone"], bevel=0.03, uv_scale=0.6)


def _ridge_and_ties(coll, m):
    L.tube("WP1_Temple_RidgeCap", [(0, Y0, RIDGE_Z + 0.06), (0, Y1, RIDGE_Z + 0.06)],
           0.17, segs=10, coll=coll, mat=m["tile2"], uv_scale=0.6)
    # a few tie-beams read as the temple ceiling structure from inside
    for k in range(4):
        y = -11 + k * 7.4
        L.box(f"WP1_Temple_TieBeam_{k}", (2 * 9.7, 0.5, 0.55),
              location=(0.0, y, EAVE_Z - 0.05), coll=coll, mat=m["concrete2"],
              bevel=0.04)


def wipe_previous():
    for o in list(bpy.data.objects):
        if o.name.startswith("WP1_Temple_"):
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0 and me.name.startswith("WP1_Temple_"):
            bpy.data.meshes.remove(me)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("Temple_"):
            bpy.data.materials.remove(mat)
    L._mat_cache.clear()


def build():
    coll = bpy.data.collections.get("WP1_Atrium")
    if coll is None:
        raise RuntimeError("WP1_Atrium collection not found")
    wipe_previous()
    m = _mats()
    _entablature(coll, m)
    for sx in (-1, 1):
        _slope(coll, sx, m["tile"])
    _battens(coll, m["tile2"])
    _ridge_and_ties(coll, m)
    _pediment(coll, m, PED_YP, +1, "N")   # gate/entrance end
    _pediment(coll, m, PED_YN, -1, "S")   # arch end
    n = sum(1 for o in bpy.data.objects if o.name.startswith("WP1_Temple_"))
    print(f"[temple] built {n} objects; eave z={EAVE_Z} ridge z={RIDGE_Z}")


def _preview(outdir):
    os.makedirs(outdir, exist_ok=True)
    import exporter
    scn = bpy.context.scene
    scn.render.engine = exporter._pick_engine(scn)
    scn.render.resolution_x, scn.render.resolution_y = 1280, 900
    try:
        scn.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    sun = bpy.data.objects.new("TmpSun", bpy.data.lights.new("TmpSun", 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = Euler((math.radians(55), math.radians(12), math.radians(150)))
    scn.collection.objects.link(sun)
    cam_d = bpy.data.cameras.new("TmpCam")
    cam_d.clip_end = 900
    cam = bpy.data.objects.new("TmpCam", cam_d)
    scn.collection.objects.link(cam)
    scn.camera = cam

    def shot(name, loc, tgt, lens=32):
        cam_d.lens = lens
        cam.location = Vector(loc)
        d = Vector(tgt) - Vector(loc)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(outdir, name)
        bpy.ops.render.render(write_still=True)
        print("SHOT", scn.render.filepath)

    shot("temple_gable_platform", (0, 30, 11), (0, 14, 13.5), lens=42)
    shot("temple_exterior_34", (26, 30, 20), (0, 2, 12), lens=30)
    shot("temple_inside_up", (0, 4, 2.2), (0, -9, 14), lens=20)
    shot("temple_side", (30, 0, 14), (0, 0, 13), lens=34)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import exporter
    build()
    bpy.context.view_layer.update()
    if "--preview" in argv:
        _preview(argv[argv.index("--preview") + 1])
    if "--save" in argv:
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if "--export" in argv:
        exporter.export_glb(os.path.join(OUT, "world.glb"))


if __name__ == "__main__":
    main()
