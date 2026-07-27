# ============================================================================
# camera_rig.py — the continuous camera rail through all four waypoints.
#
# One closed Catmull-Rom loop: atrium → garden → canyon → saloon interior →
# mine shaft → cavern platform → through the DT1 → transit tunnel → back to
# the atrium plaza. Products:
#   * Cam_Path_Curve      poly curve (cyclic) for editing in Blender
#   * Cam_Main            camera with baked "cam_fly_through" NLA action
#   * path_u custom prop  on every cam_wp* empty (scroll anchor, 0..1)
#   * cam_path.json       uniform samples {p, q} + waypoint anchors for R3F
# ============================================================================
import json
import math
import os

import bpy
from mathutils import Vector

import lib_common as L
import wp4_metro as M4

N_SAMPLES = 1000
FRAMES = 3600
KEY_STEP = 6


def control_points():
    pts = [
        (0.0, 28.0, 2.4),        # seam — heading -Y through the plaza gate
        (0.0, 22.0, 2.4),
        (0.0, 13.0, 2.5),
        (0.0, 3.0, 2.7),
        (0.0, -7.0, 2.8),
        (0.0, -14.8, 3.1),       # under the arch
        (0.0, -23.0, 3.4),
        (-1.0, -33.0, 3.1),
        (2.0, -40.5, 2.9),
        (2.5, -44.0, 2.7),       # cam_wp2_projects
        (0.5, -47.0, 2.3),
        (-3.5, -49.5, 1.8),
        (-7.5, -52.0, 1.8),      # skirting the boat
        (-8.2, -56.0, 1.6),
        (-6.0, -60.0, 1.5),
        (-2.0, -63.0, 1.7),
        (0.0, -68.0, 2.1),
        (0.0, -76.0, 1.0),
        (0.0, -83.0, -0.5),      # between the waterfalls
        (0.0, -88.0, -1.9),
        (0.0, -95.0, -3.2),
        (0.0, -102.0, -4.0),
        (0.0, -106.5, -4.5),     # under the ÜBER MICH sign
        (1.5, -111.0, -6.0),
        (1.0, -116.0, -7.5),
        (0.0, -119.5, -7.9),
        (0.0, -122.3, -8.0),     # porch steps
        (0.0, -124.6, -7.95),    # batwing doors
        (-0.6, -126.6, -7.9),
        (-1.2, -128.0, -7.85),   # cam_wp3_about (menu book)
        (0.6, -129.3, -7.9),
        (2.6, -130.4, -8.0),     # around the bar
        (1.2, -132.3, -8.1),     # back door
        (0.6, -135.5, -8.9),
        (0.0, -140.6, -9.3),     # mine portal
    ]
    pts += [(x, y, z + 1.85) for (x, y, z) in M4.TRACK_CTRL[1:8]]
    pts += [
        (1.8, -194.5, -27.6),
        (3.6, -196.6, -27.45),   # through the turnstile
        (3.6, -199.5, -27.4),    # cam_wp4_contact
        (2.8, -202.4, -27.45),
        (1.2, -203.5, -27.55),   # into door 1
        (0.2, -204.8, -27.55),
        (0.0, -207.0, -27.5),    # cam_wp4_inside_train
        (0.0, -209.5, -27.55),   # inside WP4 train (doors close)
        # Teleport to Atrium DT1 single car
        (-3.2, 31.0, 1.45),      # inside Atrium train (doors open)
        (-2.0, 31.0, 1.45),      # exiting door 1
        (-1.45, 31.0, 1.45),
        (-0.5, 31.0, 2.0),       # onto Atrium plaza
    ]
    return pts


def build(ctx, subset=None):
    if subset is not None and len(subset) < 4:
        print("[cam] subset build — skipping camera rail")
        return
    coll = L.collection("CAM_Rig")
    ctrl = control_points()
    dense = L.catmull_rom(ctrl, closed=True, samples_per_seg=14)
    samples, total = L.resample_arclength(dense, N_SAMPLES)
    print(f"[cam] path length {total:.0f} m, {len(ctrl)} control points")

    # editable curve object
    cd = bpy.data.curves.new("Cam_Path_Curve", type='CURVE')
    cd.dimensions = '3D'
    spline = cd.splines.new('POLY')
    step = 3
    n_curve = len(samples) // step
    spline.points.add(n_curve - 1)
    for i in range(n_curve):
        p = samples[i * step]
        spline.points[i].co = (p.x, p.y, p.z, 1.0)
    spline.use_cyclic_u = True
    curve_obj = bpy.data.objects.new("Cam_Path_Curve", cd)
    L.link(curve_obj, coll)
    L.set_props(curve_obj, path_role="camera_rail", loop=1)

    # camera with baked fly-through
    cam_data = bpy.data.cameras.new("Cam_Main")
    cam_data.lens = 24.0
    cam_data.clip_start = 0.05
    cam_data.clip_end = 600.0
    cam = bpy.data.objects.new("Cam_Main", cam_data)
    L.link(cam, coll)
    cam.rotation_mode = 'QUATERNION'
    bpy.context.scene.camera = cam

    ahead = 6
    quats = []
    prev_q = None
    for k in range(0, FRAMES + 1, KEY_STEP):
        u = (k % FRAMES) / FRAMES
        idx = int(u * N_SAMPLES) % N_SAMPLES
        p = samples[idx]
        d = (samples[(idx + ahead) % N_SAMPLES] - p)
        if d.length < 1e-6:
            d = Vector((0, -1, 0))
        q = d.normalized().to_track_quat('-Z', 'Y')
        if prev_q is not None and prev_q.dot(q) < 0:
            q.negate()
        prev_q = q.copy()
        quats.append((k + 1, p, q))

    ad = cam.animation_data_create()
    act = bpy.data.actions.new("cam_fly_through")
    ad.action = act
    for frame, p, q in quats:
        cam.location = p
        cam.rotation_quaternion = q
        cam.keyframe_insert(data_path="location", frame=frame)
        cam.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    for fc in L.action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    track = ad.nla_tracks.new()
    track.name = "cam_fly_through"
    strip = track.strips.new("cam_fly_through", 2, act)
    strip.extrapolation = 'NOTHING'
    ad.action = None
    cam.location = quats[0][1]
    cam.rotation_quaternion = quats[0][2]

    # anchor each waypoint empty to its nearest path parameter
    anchors = {}
    for name, emp in ctx["waypoints"].items():
        loc = Vector(emp.location)
        best = min(range(N_SAMPLES),
                   key=lambda i: (samples[i] - loc).length_squared)
        u = best / N_SAMPLES
        L.set_props(emp, path_u=round(u, 5), path_frame=int(u * FRAMES) + 1)
        anchors[name] = round(u, 5)
    print(f"[cam] anchors: {anchors}")

    data = {
        "fps": 30,
        "frames": FRAMES,
        "length_m": round(total, 1),
        "loop": True,
        "up": "Z",
        "note": "positions/quaternions in Blender Z-up world space "
                "(q order is [w,x,y,z]); the GLB itself is Y-up as usual",
        "waypoints": anchors,
        "samples": [
            {"p": [round(v, 3) for v in samples[i]],
             "q_wxyz": [round(v, 5) for v in (
                 (samples[(i + ahead) % N_SAMPLES] - samples[i]).normalized()
                 .to_track_quat('-Z', 'Y'))]}
            for i in range(0, N_SAMPLES, 3)
        ],
    }
    out = os.path.join(ctx["out"], "cam_path.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    print(f"[cam] wrote {out}")
