# ============================================================================
# rework_teleport.py — IN-PLACE edit pass on blender/output/world.blend.
#
# Never rebuild the world from build_world.py (hand work lives in the .blend);
# this script only mutates the existing scene and re-exports.
#
#   1. the 680 m loop-return tunnel is deleted outright (tube, ballast, rails,
#      sleepers, neon strips and its 19 point lights + the plaza portal frame).
#      The mine shaft and its track survive untouched.
#   2. the DT1 becomes a SINGLE car: car 2 is removed and car 1 gets a second
#      driving cab at the rear (the front cab rotated 180° about the car's
#      centre, so nothing is mirrored and KONTAKT stays readable at both ends).
#      DT1_Root is also moved onto the car — wp4_metro built the geometry in
#      world space and parented it to an empty at the origin afterwards, so the
#      root used to sit 210 m from its own train and was useless as a pivot.
#   3. that one car is cloned to an open-air terminus in front of the atrium
#      (deck, ballast, rails, sleepers, buffer stops, screen wall). Both cars
#      share mesh data, so they are literally identical and nearly free.
#   4. new door choreography for both cars: pop-out + eased slide, staggered
#      per doorway, as four clips — mine_doors_open/close, plaza_doors_open/
#      close — so the two trains can be driven independently from JS.
#   5. the camera rail is cut in two: path A ends on the seat inside the mine
#      car, path B starts on the same seat inside the plaza car and walks out
#      onto the platform. cam_path.json carries `cut`, the index pair the web
#      app must jump across instead of interpolating (the teleport).
#
# Run:
#   blender -b blender/output/world.blend --python blender/rework_teleport.py \
#           -- --save --export
# ============================================================================
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import lib_common as L                      # noqa: E402
import camera_rig                           # noqa: E402
import exporter                             # noqa: E402

OUT = os.path.join(HERE, "output")

# ---------------------------------------------------------------- constants --
CAR_LEN = 18.575
CAR_W = 2.90
MINE_DATUM = -30.2                # DT1_Root z: track datum in the cavern
MINE_NOSE_Y = -200.5              # world y of the mine car's cab nose
MINE_MID_Y = MINE_NOSE_Y - CAR_LEN / 2          # -209.7875
DOOR_CENTERS = (2.9, CAR_LEN / 2, CAR_LEN - 2.9)  # metres behind the nose
DOOR_W = 1.32
SEAT_BACK = 5.0                   # seat is 5 m behind the nose …
SEAT_UP = 2.65                    # … and 2.65 m above the track datum

# plaza terminus: platform edge is y=31 facing +Y, top z=1.2 (WP1_Atrium_*)
PLAZA_Y = 32.9                    # car centreline (0.45 m gap to the edge)
PLAZA_DATUM = 1.2 - 1.25          # keeps the 0.15 m step down that the mine has
PLAZA_NOSE_X = DOOR_CENTERS[1]    # door 2 lands exactly on x = 0

MINE_REF = Vector((0.0, MINE_NOSE_Y, MINE_DATUM))
PLAZA_REF = Vector((PLAZA_NOSE_X, PLAZA_Y, PLAZA_DATUM))
# mine car space -> plaza car space: (dx, dy) -> (dy, -dx), i.e. -90° about Z,
# which turns the door side (local +X) towards the platform (world -Y).
PLACE = (Matrix.Translation(PLAZA_REF)
         @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
         @ Matrix.Translation(-MINE_REF))

CAB_PARTS = ["Front", "Windshield0", "Windshield1", "Windshield2",
             "WinFrame0", "WinFrame1", "WinFrame2", "EmergencyDoor",
             "HeadlampL0", "HeadlampR0", "MarkerL", "MarkerR",
             "HeadlightSpot", "DestBox", "DestText", "CabRoofCap",
             "CabWall", "CabWall_Win", "CabConsole"]


def _rm(obj):
    try:
        bpy.data.objects.remove(obj, do_unlink=True)
    except (ReferenceError, RuntimeError):
        pass


def _mat(name, *args, **kw):
    """Reuse a material that already lives in the .blend, else make it."""
    existing = bpy.data.materials.get(name)
    if existing is not None:
        L._mat_cache[name] = existing
        return existing
    return L.material(name, *args, **kw)


def _basis(obj):
    return obj.matrix_basis.copy()


# ------------------------------------------------------------ 1. loop tunnel --
def purge_loop_tunnel():
    doomed = [o for o in bpy.data.objects
              if o.name.startswith("WP4_Loop_")
              or o.name.startswith("WP4_LoopPortal_")]
    for o in doomed:
        _rm(o)
    print(f"[teleport] removed {len(doomed)} loop-tunnel objects")


# --------------------------------------------------------- 2. single DT1 car --
def _car2_objects():
    out = []
    for o in bpy.data.objects:
        if not o.name.startswith("DT1_"):
            continue
        if o.name.startswith("DT1_Car2"):
            out.append(o)
            continue
        # the second _interior() pass duplicated the shared sources as .001
        if o.name.split(".")[-1] == "001" and o.name.startswith(
                ("DT1_Seat_", "DT1_Pole")):
            out.append(o)
    return out


def single_car():
    gone = _car2_objects()
    for o in gone:
        _rm(o)
    print(f"[teleport] removed {len(gone)} car-2 objects")

    # the gangway end is replaced by a real driving cab
    for n in ("DT1_Car1_EndWall_R", "DT1_Car1_EndWin_R", "DT1_Car1_Coupler",
              "DT1_Car1_Pole5"):          # pole 5 would stand inside that cab
        o = bpy.data.objects.get(n)
        if o:
            _rm(o)

    root = bpy.data.objects["DT1_Root"]
    coll = L.collection("WP4_Metro")
    for o in [o for o in bpy.data.objects if o.name.startswith("DT1_Car1_B_")]:
        _rm(o)                              # idempotent: drop an earlier rear cab
    flip = (Matrix.Translation((0.0, MINE_MID_Y, 0.0))
            @ Matrix.Rotation(math.pi, 4, 'Z')
            @ Matrix.Translation((0.0, -MINE_MID_Y, 0.0)))
    made = 0
    for part in CAB_PARTS:
        src = bpy.data.objects.get(f"DT1_Car1_{part}")
        if src is None:
            print(f"[teleport] !! missing cab part {part}")
            continue
        c = src.copy()                      # shares mesh / light data
        c.name = f"DT1_Car1_B_{part}"
        c.animation_data_clear()
        L.link(c, coll)
        c.parent = root
        c.matrix_parent_inverse = Matrix.Identity(4)
        c.matrix_basis = flip @ _basis(src)
        made += 1
    print(f"[teleport] added {made} rear-cab objects")


def fix_rest_poses():
    """The E-side door leaves had location.y == 0 in the .blend — 200 m off the
    car, under the atrium. Restore every leaf to its closed position."""
    fixed = []
    for di, dc in enumerate(DOOR_CENTERS):
        for tag in ("E", "W"):
            for leaf_dir, leaf_tag in ((-1, "L"), (1, "R")):
                n = f"DT1_Car1_Door{di + 1}_{tag}{leaf_tag}"
                o = bpy.data.objects.get(n)
                if o is None:
                    continue
                base = (MINE_NOSE_Y - dc + leaf_dir * DOOR_W / 4,
                        (1 if tag == "E" else -1) * (CAR_W / 2 - 0.075))
                if abs(o.location.y - base[0]) > 1e-4:
                    fixed.append(n)
                o.location.y = base[0]
                o.location.x = base[1]
    print(f"[teleport] door rest pose fixed: {fixed or 'nothing to do'}")

    # the platform "U" was buried 2 cm behind its own panel (panel spans
    # y -196.54..-196.46, viewer stands at +Y)
    u = bpy.data.objects.get("WP4_USign_U")
    if u:
        u.location.y = -196.44

    # The seat framing must be dead level and dead along the car: after the
    # teleport the plaza seat is rail-driven and looks exactly down its car, so
    # any tilt authored here would read as the camera turning while it jumps.
    seat = bpy.data.objects.get("cam_wp4_inside_train")
    if seat:
        seat.rotation_euler = L.look_at_rotation(
            seat.location, (seat.location.x, seat.location.y - 9.0,
                            seat.location.z))


def recentre_root():
    """Put DT1_Root on the car instead of 210 m away from it.

    wp4_metro._train() builds every part in world coordinates (the car starts
    at y = -200.5) and only afterwards parents them to an empty sitting at the
    world origin, so the root ended up 210 m off its own geometry — useless as
    a pivot and invisible in the viewport. Slide the root onto the car centre
    (keeping z on the track datum) and take the same offset back out of every
    direct child, which leaves all world positions untouched.

    Must run before the plaza clone (which inherits the fixed origin) and
    before door_actions (which then authors leaf offsets in root-local space).
    """
    root = bpy.data.objects["DT1_Root"]
    bpy.context.view_layer.update()
    if abs(root.matrix_world.translation.y - MINE_MID_Y) < 1.0:
        print("[teleport] DT1_Root already on the car — skipped")
        return
    d = Matrix.Translation((0.0, MINE_MID_Y, 0.0))
    d_inv = d.inverted()
    kids = [o for o in bpy.data.objects if o.parent is root]
    before = {o.name: o.matrix_world.translation.copy() for o in kids}
    locals_before = {o.name: o.matrix_local.copy() for o in kids}
    root.matrix_world = root.matrix_world @ d
    for o in kids:
        # world = R·P·B stays put iff (P'·B') = D⁻¹·(P·B); fold it all into the
        # basis so the children read as plain car-local coordinates
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = d_inv @ locals_before[o.name]
    bpy.context.view_layer.update()
    drift = max((before[o.name] - o.matrix_world.translation).length for o in kids)
    print(f"[teleport] DT1_Root moved onto the car "
          f"{tuple(round(v, 3) for v in root.location)}, "
          f"{len(kids)} children rebased, max drift {drift:.6f} m")


# ---------------------------------------------------------- 3. plaza clone ---
def _hierarchy(root):
    """root's descendants, parents before children."""
    out = []
    frontier = [root]
    while frontier:
        nxt = []
        for p in frontier:
            kids = [o for o in bpy.data.objects if o.parent is p]
            out.extend(kids)
            nxt.extend(kids)
        frontier = nxt
    return out


def clone_to_plaza():
    src_root = bpy.data.objects["DT1_Root"]
    L.set_props(src_root, station="mine")
    coll = L.collection("WP1_Atrium")
    for o in [o for o in bpy.data.objects if o.name.startswith("DT1_Plaza")]:
        _rm(o)                              # idempotent: re-cloning replaces

    root = L.empty("DT1_Plaza_Root", (0, 0, 0), coll=coll, size=0.5)
    # inherits the mine root's placement on its own car, so this lands on the
    # plaza car centre (0, 32.9, -0.05) rather than 200 m out in +X
    root.matrix_world = PLACE @ src_root.matrix_world
    L.set_props(root, interactive_type="train", train_type="DT1",
                station="plaza")

    remap = {src_root: root}
    for o in _hierarchy(src_root):
        c = o.copy()
        c.name = o.name.replace("DT1_", "DT1_Plaza_", 1)
        c.animation_data_clear()            # doors get their own clips below
        # a copy must never claim a camera waypoint: main.js keys anchors by
        # userData.camera_waypoint and the last node traversed wins, so one
        # stray clone silently rewrites the whole scroll->path mapping
        for key in ("camera_waypoint", "path_u", "path_frame"):
            if key in c.keys():
                del c[key]
        L.link(c, coll)
        c.parent = remap[o.parent]
        c.matrix_parent_inverse = Matrix.Identity(4)
        c.matrix_basis = _basis(o)
        remap[o] = c
    print(f"[teleport] cloned {len(remap) - 1} objects to the plaza terminus")
    return root


def plaza_terminus():
    """Open-air stub track the plaza car stands on, plus a screen wall."""
    coll = L.collection("WP1_Atrium")
    for o in [o for o in bpy.data.objects if o.name.startswith("WP1_Terminus")]:
        _rm(o)                              # idempotent: rebuild from scratch
    d = PLAZA_DATUM
    conc = _mat("Brutalist_Concrete", (0.58, 0.56, 0.53), rough=0.92)
    conc_d = _mat("Brutalist_Concrete_Dark", (0.45, 0.44, 0.42), rough=0.95)
    gravel = _mat("Track_Ballast", (0.22, 0.21, 0.20), rough=1.0)
    steel = _mat("Rail_Steel", (0.55, 0.55, 0.58), rough=0.35, metal=1.0)

    L.box("WP1_Terminus_Deck", (34.0, 8.4, 0.6), location=(2.0, 35.0, d - 0.58),
          coll=coll, mat=conc, uv_scale=0.25)
    L.box("WP1_Terminus_Ballast", (27.4, 4.4, 0.42),
          location=(-0.5, PLAZA_Y, d - 0.07), coll=coll, mat=gravel,
          uv_scale=0.3)
    for side, tag in ((-1, "S"), (1, "N")):
        L.box(f"WP1_Terminus_Rail_{tag}", (26.4, 0.07, 0.14),
              location=(-0.5, PLAZA_Y + side * 0.7175, d + 0.18),
              coll=coll, mat=steel)
    sleeper = bpy.data.objects.get("WP4_Sleeper")
    if sleeper is not None:
        n = int(26.0 / 0.85)
        for i in range(n + 1):
            L.inst(sleeper, f"WP1_Terminus_Sleeper_{i}",
                   (-13.3 + i * 0.85, PLAZA_Y, d + 0.06),
                   rotation=(0, 0, math.pi / 2), coll=coll)
    # buffer stops closing the stub at both ends
    for tag, bx in (("E", 12.6), ("W", -13.9)):
        L.box(f"WP1_Terminus_Buffer_{tag}", (0.6, 2.4, 1.0),
              location=(bx, PLAZA_Y, d + 0.5), coll=coll, mat=conc_d)
        L.box(f"WP1_Terminus_BufferBeam_{tag}", (0.3, 2.0, 0.34),
              location=(bx - (0.45 if tag == "E" else -0.45), PLAZA_Y, d + 0.95),
              coll=coll, mat=steel)
    # screen wall so the terminus reads as built ground, not a floating slab
    L.box("WP1_Terminus_Wall", (34.0, 0.7, 5.0), location=(2.0, 38.4, d + 1.7),
          coll=coll, mat=conc, uv_scale=0.2)
    for tag, wx in (("E", 18.65), ("W", -14.65)):
        L.box(f"WP1_Terminus_WallReturn_{tag}", (0.7, 7.7, 5.0),
              location=(wx, 34.9, d + 1.7), coll=coll, mat=conc, uv_scale=0.2)
    print("[teleport] plaza terminus built")


# ------------------------------------------------------- 4. door choreography --
def door_actions():
    """Door choreography now lives with the door geometry it depends on."""
    import dt1_rebuild
    dt1_rebuild.door_actions()


def _door_actions_legacy():
    """Superseded by dt1_rebuild.door_actions() — kept only as the record of
    why the shut pose is in matrix_parent_inverse. Do not call: its leaf
    geometry (37 mm recessed, 1.375 m off centre) predates the shell rebuild.

    Pop the leaf 6 cm clear of the body, then slide it eased; ~1.5 s.

    Only the platform side (local +X, tag E) moves — in the mine that faces the
    cavern platform, at the plaza the -90° placement turns it onto the atrium
    platform, so one and the same channel set works for both cars.

    The closed pose lives in matrix_parent_inverse, NOT in location: Blender
    evaluates an NLA stack from the property defaults, so any frame where no
    strip is active resets an animated `location` to (0, 0, 0). That is exactly
    how the six platform-side leaves ended up 200 m off the car in the shipped
    .blend. With the rest offset in the parent inverse, "reset to default"
    means "shut", and matrix_local — what the glTF exporter writes as the node
    transform and samples for the clips — still comes out absolute.
    """
    POP = 0.062                       # plug door swings clear of the body
    SLIDE = DOOR_W / 2 + 0.06
    made = 0
    for prefix, clip in (("DT1_Car1", "mine"), ("DT1_Plaza_Car1", "plaza")):
        for di, dc in enumerate(DOOR_CENTERS):
            lead = di * 2                       # doorway 1 leads, 3 trails
            for leaf_dir, leaf_tag in ((-1, "L"), (1, "R")):
                leaf = bpy.data.objects.get(f"{prefix}_Door{di + 1}_E{leaf_tag}")
                if leaf is None:
                    continue
                leaf.animation_data_clear()
                # root-local: the root sits on the car centre (see recentre_root)
                shut = Vector((CAR_W / 2 - 0.075,
                               MINE_NOSE_Y - dc + leaf_dir * DOOR_W / 4
                               - MINE_MID_Y,
                               leaf.matrix_parent_inverse.translation.z
                               + leaf.location.z))
                leaf.matrix_parent_inverse = Matrix.Translation(shut)
                leaf.location = (0.0, 0.0, 0.0)
                slide = leaf_dir * SLIDE
                L.make_action(leaf, f"{clip}_doors_open", [
                    ("location", 0, [(1 + lead, 0.0), (10 + lead, POP),
                                     (44 + lead, POP)], 'BEZIER'),
                    ("location", 1, [(1 + lead, 0.0), (8 + lead, 0.0),
                                     (44 + lead, slide)], 'BEZIER'),
                ])
                L.make_action(leaf, f"{clip}_doors_close", [
                    ("location", 0, [(1 + lead, POP), (36 + lead, POP),
                                     (46 + lead, 0.0)], 'BEZIER'),
                    ("location", 1, [(1 + lead, slide), (38 + lead, 0.0),
                                     (46 + lead, 0.0)], 'BEZIER'),
                ])
                leaf.location = (0.0, 0.0, 0.0)
                made += 1
    print(f"[teleport] re-animated {made} door leaves (4 clips)")


# ------------------------------------------------------------ 5. camera rail --
N_A = 640                 # samples on the approach (~260 m)
N_B = 64                  # samples on the walk out of the plaza car (~7.4 m)
FRAMES = 3600
KEY_STEP = 6


def _plaza(back, lateral, up):
    """car-local (metres behind the nose, +X side offset, above datum) -> world"""
    return (PLAZA_NOSE_X - back, PLAZA_Y - lateral, PLAZA_DATUM + up)


def path_controls():
    # everything up to the cavern platform is untouched; only the boarding
    # move and the old return tunnel are re-authored.
    head = camera_rig.control_points()[:-21][:-4]
    head += [
        (2.9, -201.9, -27.42),      # alongside the cab, turning to doorway 1
        (1.9, -203.4, -27.48),      # in the doorway
        (0.6, -204.3, -27.53),
        (0.0, -204.9, -27.55),      # straighten onto the aisle …
        (0.0, -205.5, -27.55),      # … seat == cam_wp4_inside_train
    ]
    tail = [
        _plaza(SEAT_BACK, 0.0, SEAT_UP),          # teleport lands here
        _plaza(6.1, 0.0, SEAT_UP),
        _plaza(7.7, 0.02, SEAT_UP - 0.01),
        _plaza(8.75, 0.20, SEAT_UP - 0.03),       # easing onto the doorway axis
        _plaza(DOOR_CENTERS[1], 0.80, SEAT_UP - 0.05),
        _plaza(DOOR_CENTERS[1], 1.60, SEAT_UP - 0.08),   # in the doorway
        _plaza(DOOR_CENTERS[1], 2.30, SEAT_UP - 0.14),   # on the platform
        (0.0, 30.0, 2.40),                        # loop seam == head[0]
    ]
    return head, tail


def _resample(ctrl, count, include_end):
    dense = L.catmull_rom(ctrl, closed=False, samples_per_seg=14)
    cum = [0.0]
    for a, b in zip(dense, dense[1:]):
        cum.append(cum[-1] + (b - a).length)
    total = cum[-1]
    div = (count - 1) if include_end else count
    out = []
    j = 0
    for i in range(count):
        s = total * i / div
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j]
        t = (s - cum[j]) / seg if seg > 1e-9 else 0.0
        out.append(dense[j].lerp(dense[j + 1], t))
    return out, total


def _quats(samples, ahead=6):
    """Track quats from the forward tangent, kept inside this path (never
    wrapping across the teleport) and sign-continuous for clean slerps.

    The look-ahead shortens towards the end instead of reaching backwards — a
    backwards chord across the door-entry curve would swing the last frames of
    the boarding move by ~25°.
    """
    n = len(samples)
    out = []
    prev = None
    for i in range(n):
        if i + 1 < n:
            d = samples[min(i + ahead, n - 1)] - samples[i]
        else:
            d = samples[i] - samples[i - 1]
        if d.length < 1e-6:
            d = Vector((0, -1, 0))
        q = d.normalized().to_track_quat('-Z', 'Y')
        if prev is not None and prev.dot(q) < 0:
            q.negate()
        prev = q.copy()
        out.append(q)
    return out


def _settle(quats, axis, count, at_end):
    """Ease the quats at one end of a path onto an exact look direction.

    The boarding move ends with a 4 cm Catmull-Rom overshoot beside the aisle,
    which over a 0.4 m sample chord reads as a 5.5° yaw towards the doors — and
    that is precisely the framing the teleport hands over. Both seats must look
    exactly along their own car, so the last couple of metres settle onto the
    car axis (and the plaza side starts from it).
    """
    target = Vector(axis).normalized().to_track_quat('-Z', 'Y')
    n = len(quats)
    for k in range(count):
        i = (n - 1 - k) if at_end else k
        w = L.smoothstep(0.0, 1.0, 1.0 - k / count)     # 1 at the very end
        t = target.copy()
        if quats[i].dot(t) < 0:
            t.negate()
        quats[i] = quats[i].slerp(t, w)
    return quats


def camera_rail():
    coll = L.collection("CAM_Rig")
    head, tail = path_controls()
    sa, len_a = _resample(head, N_A, include_end=True)
    sb, len_b = _resample(tail, N_B, include_end=False)
    samples = sa + sb
    qa, qb = _quats(sa), _quats(sb)
    # car axes in Blender world space: the mine car runs -Y, the plaza car -X
    _settle(qa, (0, -1, 0), 7, at_end=True)
    _settle(qb, (-1, 0, 0), 7, at_end=False)
    if qb[-1].dot(qa[0]) < 0:      # keep the loop seam (B -> A) sign-continuous
        for q in qb:
            q.negate()
    quats = qa + qb
    n = len(samples)
    cut = N_A - 1
    print(f"[cam] path A {len_a:.0f} m / {N_A} samples, "
          f"path B {len_b:.1f} m / {N_B} samples, cut at {cut}")

    # ---- editable curve (two open splines so the cut stays visible) ---------
    old = bpy.data.objects.get("Cam_Path_Curve")
    if old:
        cd_old = old.data
        _rm(old)
        try:
            bpy.data.curves.remove(cd_old)
        except (ReferenceError, RuntimeError):
            pass
    cd = bpy.data.curves.new("Cam_Path_Curve", type='CURVE')
    cd.dimensions = '3D'
    for part in (sa, sb):
        sp = cd.splines.new('POLY')
        step = max(1, len(part) // 200)
        pts = part[::step]
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            sp.points[i].co = (p.x, p.y, p.z, 1.0)
    curve_obj = bpy.data.objects.new("Cam_Path_Curve", cd)
    L.link(curve_obj, coll)
    L.set_props(curve_obj, path_role="camera_rail", loop=1, teleport_cut=cut)

    # ---- rebake Cam_Main ---------------------------------------------------
    cam = bpy.data.objects["Cam_Main"]
    ad = cam.animation_data or cam.animation_data_create()
    for tr in list(ad.nla_tracks):
        for st in list(tr.strips):
            if st.action:
                try:
                    bpy.data.actions.remove(st.action)
                except (ReferenceError, RuntimeError):
                    pass
        ad.nla_tracks.remove(tr)
    cam.rotation_mode = 'QUATERNION'
    act = bpy.data.actions.new("cam_fly_through")
    ad.action = act
    try:
        if hasattr(ad, "action_slot") and ad.action_slot is None and act.slots:
            ad.action_slot = act.slots[0]
    except (AttributeError, TypeError):
        pass
    first = None
    for k in range(0, FRAMES + 1, KEY_STEP):
        idx = int((k % FRAMES) / FRAMES * n) % n
        cam.location = samples[idx]
        cam.rotation_quaternion = quats[idx]
        cam.keyframe_insert(data_path="location", frame=k + 1)
        cam.keyframe_insert(data_path="rotation_quaternion", frame=k + 1)
        if first is None:
            first = (samples[idx].copy(), quats[idx].copy())
    for fc in L.action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    track = ad.nla_tracks.new()
    track.name = "cam_fly_through"
    strip = track.strips.new("cam_fly_through", 2, act)
    strip.extrapolation = 'NOTHING'
    ad.action = None
    cam.location, cam.rotation_quaternion = first

    # ---- anchors on the cam_wp* empties ------------------------------------
    anchors = {}
    for emp in bpy.data.objects:
        wp = emp.get("camera_waypoint")
        if not wp:
            continue
        loc = Vector(emp.matrix_world.translation)
        best = min(range(n), key=lambda i: (samples[i] - loc).length_squared)
        u = best / n
        L.set_props(emp, path_u=round(u, 5), path_frame=int(u * FRAMES) + 1)
        anchors[wp] = round(u, 5)
    print(f"[cam] anchors: {anchors}")

    data = {
        "fps": 30,
        "frames": FRAMES,
        "length_m": round(len_a + len_b, 1),
        "loop": True,
        "up": "Z",
        "note": "positions/quaternions in Blender Z-up world space "
                "(q order is [w,x,y,z]); the GLB itself is Y-up as usual",
        "waypoints": anchors,
        # the visitor never rides between these two samples — the camera is
        # teleported from the mine car's seat to the identical plaza car seat.
        # Never interpolate across it.
        "cut": cut,
        "teleport": {"u_in": round(cut / n, 6),
                     "u_out": round((cut + 1) / n, 6),
                     "from": "mine", "to": "plaza"},
        "samples": [{"p": [round(v, 3) for v in samples[i]],
                     "q_wxyz": [round(v, 5) for v in quats[i]]}
                    for i in range(n)],
    }
    with open(os.path.join(OUT, "cam_path.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    print(f"[cam] wrote cam_path.json ({n} samples, cut {cut})")
    return anchors


# ------------------------------------------------------------------- driver --
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    purge_loop_tunnel()
    single_car()
    fix_rest_poses()
    recentre_root()
    clone_to_plaza()
    plaza_terminus()
    door_actions()
    anchors = camera_rail()

    bpy.context.scene.frame_set(1)
    n_tri = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            n_tri += len(o.data.loop_triangles)
    print(f"[teleport] scene now: {len(bpy.data.objects)} objects, "
          f"~{n_tri} triangles")
    print(f"[teleport] anchors {anchors}")

    if "--save" in argv:
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if "--export" in argv:
        exporter.export_glb(os.path.join(OUT, "world.glb"))
    if "--previews" in argv:
        ctx = {"waypoints": {o["camera_waypoint"]: o for o in bpy.data.objects
                             if o.get("camera_waypoint")}}
        ctx["waypoints"]["plaza_seat"] = L.empty(
            "_preview_plaza_seat", _plaza(SEAT_BACK, 0.0, SEAT_UP),
            look_at=_plaza(SEAT_BACK + 9.0, 0.0, SEAT_UP - 0.3))
        ctx["waypoints"]["plaza_door"] = L.empty(
            "_preview_plaza_door", _plaza(DOOR_CENTERS[1], 2.0, SEAT_UP - 0.1),
            look_at=(0.0, 18.0, 2.0))
        exporter.render_previews(ctx, os.path.join(OUT, "previews"))
        for n in ("_preview_plaza_seat", "_preview_plaza_door"):
            _rm(bpy.data.objects[n])


if __name__ == "__main__":
    main()
