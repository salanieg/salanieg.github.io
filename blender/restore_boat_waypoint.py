# ============================================================================
# restore_boat_waypoint.py — re-add the `cam_wp2_boat_seat` anchor (waypoint
# `projects_boat`) that a prior hand-edit dropped from world.blend. Without it
# ScrollRig's `projects_boat` stop has an undefined u → sToU() returns NaN
# across the projects→about scroll span → sample() throws → the page freezes
# at "Projekte". The boat + its clickable project links still exist; only the
# camera anchor was lost.
#
# path_u is recomputed against the CURRENT rail (cam_path.json) — the metro
# rework re-parametrised u, so the old value from git history is stale.
#
#   "…/blender.exe" -b blender/output/world.blend -P blender/restore_boat_waypoint.py -- --save --export
# ============================================================================
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.append(HERE)
import lib_common as L
OUT = os.path.join(HERE, "output")

# authoritative values from wp2_garden.py (the original generator)
POS = (-5.9, -49.9, 0.75)
COL_POS = (2.5, -54.0)
LOOK_AT = (COL_POS[0], COL_POS[1], 15.0)


def _nearest_u(pos):
    with open(os.path.join(OUT, "cam_path.json"), encoding="utf-8") as fh:
        cp = json.load(fh)
    samples = cp["samples"]
    best_i, best_d = 0, 1e18
    for i, s in enumerate(samples):
        p = s["p"]
        d = (p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2 + (p[2] - pos[2]) ** 2
        if d < best_d:
            best_d, best_i = d, i
    return best_i / len(samples), best_i, len(samples), best_d ** 0.5, cp.get("frames", 3600)


def build():
    coll = bpy.data.collections.get("WP2_Garden") or bpy.context.scene.collection
    old = bpy.data.objects.get("cam_wp2_boat_seat")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

    path_u, idx, n, dist, frames = _nearest_u(POS)
    path_frame = round(path_u * frames)
    wp = L.empty("cam_wp2_boat_seat", POS, look_at=LOOK_AT, coll=coll,
                 props={"camera_waypoint": "projects_boat",
                        "path_u": round(path_u, 5), "path_frame": path_frame})
    print(f"[boat] cam_wp2_boat_seat -> u={path_u:.5f} frame={path_frame} "
          f"(nearest sample {idx}/{n}, {dist:.2f} m off rail), coll={coll.name}")

    # sanity: all six waypoints present again
    wps = sorted(o.get("camera_waypoint") for o in bpy.data.objects
                 if o.get("camera_waypoint"))
    print(f"[boat] camera_waypoints now: {wps}")


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
