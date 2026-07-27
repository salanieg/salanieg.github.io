# ============================================================================
# add_marx_engels.py — open the existing world.blend and ADD two marble
# monuments (Karl Marx, Friedrich Engels) flanking the atrium entrance gate.
# Idempotent: re-running wipes the previous WP1_Statue_* objects/materials and
# rebuilds. Never rebuilds the world; only mutates world.blend in place.
#
#   "…/blender.exe" -b blender/output/world.blend -P blender/add_marx_engels.py -- --save --export
# ============================================================================
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.append(HERE)

import lib_common as L
import statues_lib as S
OUT = os.path.join(HERE, "output")

# The entrance gate sits at y≈15.6 (piers x=±3.9, opening x=±3.25, floor top z=0).
# Place the pedestals just inside the gate, symmetric about the axis, framed by
# the opening. Front = +Y so the figures face a visitor arriving from the
# platform. Marx on the east (+X = a viewer's left as they enter), Engels west.
GATE_Y = 13.6
MARX_BASE = (2.70, GATE_Y, 0.0)
ENGELS_BASE = (-2.70, GATE_Y, 0.0)
YAW = 0.0
SCALE = 1.0


def wipe_previous():
    for o in list(bpy.data.objects):
        if o.name.startswith("WP1_Statue_"):
            bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves):
        for b in list(coll):
            if b.users == 0 and b.name.startswith("WP1_Statue_"):
                coll.remove(b)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("Statue_"):
            bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img.name.startswith("Statue_"):
            bpy.data.images.remove(img)
    L._mat_cache.clear()


def build():
    coll = bpy.data.collections.get("WP1_Atrium")
    if coll is None:
        raise RuntimeError("WP1_Atrium collection not found in world.blend")
    wipe_previous()
    mats = S.build_materials()
    S.build_pair(coll, MARX_BASE, ENGELS_BASE, mats, yaw=YAW, scale=SCALE)

    n = sum(1 for o in bpy.data.objects if o.name.startswith("WP1_Statue_"))
    tris = 0
    for o in bpy.data.objects:
        if o.name.startswith("WP1_Statue_") and o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    print(f"[statues] built {n} objects, ~{tris} tris; "
          f"Marx@{MARX_BASE} Engels@{ENGELS_BASE} yaw={YAW}")


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
