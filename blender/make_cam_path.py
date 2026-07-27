# ============================================================================
# make_cam_path.py — regenerate cam_path.json FROM the rail that actually sits
# in world.blend.
#
# rework_teleport.camera_rail() rebuilds the rail from its own control points;
# on the hand-finished world.blend that no longer reproduces the curve in the
# file (the anchors come out several percent off). The curve object is the
# authority, so this script seeds the very same resample / quaternion / settle
# pipeline with Cam_Path_Curve's two splines instead.
#
# STRICTLY READ-ONLY — never saves the .blend and never touches the scene.
#
#   "…/blender.exe" -b blender/output/world.blend -P blender/make_cam_path.py
# ============================================================================
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                    # noqa: E402
from mathutils import Vector                  # noqa: E402

import rework_teleport as RT                  # noqa: E402

OUT = os.path.join(HERE, "output")
FRAMES = 3600


def spline_points(obj, spline):
    mw = obj.matrix_world
    return [mw @ Vector(p.co[:3]) for p in spline.points]


def main():
    obj = bpy.data.objects["Cam_Path_Curve"]
    splines = obj.data.splines
    if len(splines) != 2:
        raise SystemExit(f"expected 2 splines (A + B), found {len(splines)}")
    head = spline_points(obj, splines[0])
    tail = spline_points(obj, splines[1])
    print(f"[cam] curve in .blend: A={len(head)} pts, B={len(tail)} pts")

    sa, len_a = RT._resample(head, RT.N_A, include_end=True)
    sb, len_b = RT._resample(tail, RT.N_B, include_end=False)
    qa, qb = RT._quats(sa), RT._quats(sb)
    RT._settle(qa, (0, -1, 0), 7, at_end=True)     # mine car runs -Y
    RT._settle(qb, (-1, 0, 0), 7, at_end=False)    # plaza car runs -X
    if qb[-1].dot(qa[0]) < 0:                      # keep the loop seam smooth
        for q in qb:
            q.negate()

    samples, quats = sa + sb, qa + qb
    n = len(samples)
    cut = RT.N_A - 1
    print(f"[cam] path A {len_a:.0f} m / {RT.N_A}, "
          f"path B {len_b:.1f} m / {RT.N_B}, cut {cut}, total {n}")

    anchors, drift = {}, {}
    for emp in bpy.data.objects:
        wp = emp.get("camera_waypoint")
        if not wp:
            continue
        loc = Vector(emp.matrix_world.translation)
        best = min(range(n), key=lambda i: (samples[i] - loc).length_squared)
        u = round(best / n, 5)
        anchors[wp] = u
        stored = emp.get("path_u")
        if stored is not None and abs(stored - u) > 1e-4:
            drift[wp] = (round(stored, 5), u)
    print(f"[cam] anchors: {anchors}")
    if drift:
        print(f"[cam] !! differ from the path_u baked into the GLB: {drift}")
    else:
        print("[cam] anchors match the path_u baked into the GLB exactly")

    data = {
        "fps": 30,
        "frames": FRAMES,
        "length_m": round(len_a + len_b, 1),
        "loop": True,
        "up": "Z",
        "note": "positions/quaternions in Blender Z-up world space "
                "(q order is [w,x,y,z]); the GLB itself is Y-up as usual",
        "waypoints": anchors,
        "cut": cut,
        "teleport": {"u_in": round(cut / n, 6),
                     "u_out": round((cut + 1) / n, 6),
                     "from": "mine", "to": "plaza"},
        "samples": [{"p": [round(v, 3) for v in samples[i]],
                     "q_wxyz": [round(v, 5) for v in quats[i]]}
                    for i in range(n)],
    }
    path = os.path.join(OUT, "cam_path.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    print(f"[cam] wrote {path} ({n} samples, cut {cut}) — .blend untouched")


main()
