# ============================================================================
# dt1_rebuild.py — surgical rebuild of the DT1 body shell, doors and roof.
#
# The car in world.blend is good below the waist (bogies with air springs and
# journals, underframe gear, both driving cabs, roof equipment) — that stays.
# What was broken and is rebuilt here, all in car-local coordinates (origin =
# car centre, z = 0 at railhead, +Y towards the front cab, +X = platform side):
#
#   * ROOF — DT1_Car1_Roof was a degenerate sweep: x[-0.38 .. 0.06],
#     z[2.03 .. 4.73], i.e. a sliver rotated into the saloon. Replaced by a
#     proper parabolic shell springing from the cant rail (z 3.38) to a 3.76
#     crown, which is exactly the profile the existing roof ribs assume.
#   * DOORWAY HEADERS — the side skin simply stopped at the door head frame,
#     leaving a 1.32 x 0.21 m hole above all six doorways.
#   * DOOR LEAVES — were 37 mm recessed behind the skin, 15 mm too narrow for
#     their opening (8 mm slit at each jamb) and started 80 mm below the cabin
#     floor. Rebuilt flush with the skin, overlapping each jamb by 30 mm, and
#     sitting on the floor. Glazing, rubbing strip, rubber lip and top hanger
#     are rebuilt with them.
#   * THRESHOLDS — 60 mm below the cabin floor. Raised flush.
#   * INTERIOR LINING — ran the full length and therefore walled off every
#     doorway from inside: opening a door revealed a wall. Split into bays.
#
# Run (idempotent):
#   blender -b blender/output/world.blend --python blender/dt1_rebuild.py \
#           -- --save --export
# ============================================================================
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import lib_common as L                      # noqa: E402

OUT = os.path.join(HERE, "output")

# ------------------------------------------------------------- body geometry --
CAR_HALF_L = 9.2875           # nose to centre
SKIN_X = 1.445                # outer face of the side skin
SKIN_IN_X = 1.355             # inner face of the side skin
LINING_X = 1.330              # inner face of the saloon lining
CANT_Z = 3.380                # top of the side wall = roof springing line
CROWN_Z = 3.760               # roof crown (matches DT1_Car1_RoofRib_0)
ROOF_BASE_Z = CANT_Z - 0.035  # underside of the roof shell
FLOOR_Z = 1.200               # cabin floor surface
BAND_Z0, BAND_Z1 = 2.120, 3.020   # window band
STRIPE_Z0, STRIPE_Z1 = 2.000, 2.120

# doorways: clear opening is 1.32 m between the jamb inner faces
DOOR_CENTRES = (6.3875, 0.0, -6.3875)
CLEAR_HALF = 0.660
DOOR_TOP = 3.100
LEAF_W = 0.690                # 30 mm overlap onto each jamb
LEAF_T = 0.055
LEAF_X = SKIN_X - LEAF_T / 2  # leaf centre: outer face flush with the skin
LEAF_Z = (FLOOR_Z + DOOR_TOP) / 2
DOOR_POP = 0.075              # plug clear of the skin before sliding
DOOR_SLIDE = 0.720            # fully clears the 1.32 m opening
DOOR_END = 54                 # common last frame of every door action

# saloon bays between the doorways — they end exactly on the jamb inner faces
# (yc ± CLEAR_HALF) so no lining ever crosses an opening
BAYS = tuple(
    (a, b) for a, b in (
        (DOOR_CENTRES[0] + CLEAR_HALF, 8.838),
        (DOOR_CENTRES[1] + CLEAR_HALF, DOOR_CENTRES[0] - CLEAR_HALF),
        (DOOR_CENTRES[2] + CLEAR_HALF, DOOR_CENTRES[1] - CLEAR_HALF),
        (-8.838, DOOR_CENTRES[2] - CLEAR_HALF),
    )
)

SIDES = ((1, "E"), (-1, "W"))

# --------------------------------------------------------- z-fight hygiene --
# Two coplanar faces only shimmer when they face the SAME way and overlap in
# area — opposite-facing pairs are resolved by backface culling. Every value
# below is chosen so no such pair exists: the stripe's inner face sits between
# the lining (1.330) and the skin (1.355), its outer face is proud of
# everything, and the roof oversails the skin instead of ending flush with it.
STRIPE_X0, STRIPE_X1 = 1.3425, 1.472
ROOF_OVERHANG = 0.008
STRIPE_TUCK = 0.004        # stripe ends buried inside the door jambs

# ------------------------------------------------------------- driving cab --
MASK_BACK_Y = 8.838        # where the side skin stops
MASK_SIDE_Y = 9.050        # end of the straight side, start of the chamfer
NOSE_Y = 9.344             # foremost point
NOSE_FLAT_HX = 1.100       # half width of the flat front
MASK_Z0, MASK_Z1 = 1.100, CANT_Z
MASK_T = 0.100             # mask wall thickness
RAKE = 0.100               # top of the mask leans this far back
WS_Z0, WS_Z1 = 2.160, 3.050    # windscreen aperture
WS_INNER_HX = 0.460            # flanking the emergency door
BAND_HOLE_Y = 8.708            # window band stops here; skin resumes at 8.838


def _rm(obj):
    try:
        bpy.data.objects.remove(obj, do_unlink=True)
    except (ReferenceError, RuntimeError):
        pass


def _purge(*prefixes):
    doomed = [o for o in bpy.data.objects if o.name.startswith(prefixes)]
    for o in doomed:
        _rm(o)
    return len(doomed)


def _mat_of(obj_name, fallback=None):
    """Reuse the material an existing part already carries — the .blend has
    suffixed duplicates (DT1_Body_Red.002 …), so never look them up by base
    name."""
    o = bpy.data.objects.get(obj_name)
    if o is not None and o.type == 'MESH' and o.data.materials:
        return o.data.materials[0]
    return fallback


def _attach(obj, root, coll):
    """Park a freshly built object in the car's frame; its location is already
    car-local, so the parent inverse stays identity."""
    if obj.name not in coll.objects:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        coll.objects.link(obj)
    obj.parent = root
    obj.matrix_parent_inverse = Matrix.Identity(4)
    return obj


def _prism(name, profile, y0, y1, coll, mat, smooth_angle=None):
    """Solid swept from a closed XZ polygon along Y — deterministic, unlike
    L.sweep, whose transported frames are what flipped the old roof inside."""
    bm = bmesh.new()
    rings = []
    for y in (y0, y1):
        rings.append([bm.verts.new((x, y, z)) for x, z in profile])
    bm.verts.ensure_lookup_table()
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.bm_to_obj(bm, name, coll, mat, smooth_angle, 0.3, (0, 0, 0))


# ------------------------------------------------------------------- 1. roof --
ROOF_HX = SKIN_X + ROOF_OVERHANG


def _roof_z(x):
    """Parabolic crown; matches RoofRib_0/55/110 to within 5 mm.

    The 8 mm oversail is not decoration: ending the roof flush with the skin
    put its flank in the same plane as E_Upper, facing the same way, over the
    full length of the car — a textbook z-fight.
    """
    t = min(1.0, abs(x) / ROOF_HX)
    return CANT_Z + (CROWN_Z - CANT_Z) * (1.0 - t * t)


def rebuild_roof(root, coll):
    # exact names only — a "DT1_Car1_Roof" prefix would also swallow the ribs
    # and the HVAC units, which are fine and must survive
    mat = _mat_of("DT1_Car1_RoofRib_0") or _mat_of("DT1_Car1_Underframe")
    n = 0
    for nm in ("DT1_Car1_Roof", "DT1_Car1_CabRoofCap", "DT1_Car1_B_CabRoofCap"):
        o = bpy.data.objects.get(nm)
        if o is not None:
            _rm(o)
            n += 1
    steps = 20
    prof = [(-ROOF_HX + 2 * ROOF_HX * i / steps, 0.0) for i in range(steps + 1)]
    prof = [(x, _roof_z(x)) for x, _ in prof]
    prof += [(ROOF_HX, ROOF_BASE_Z), (-ROOF_HX, ROOF_BASE_Z)]
    roof = _prism("DT1_Car1_Roof", prof, -CAR_HALF_L, CAR_HALF_L, coll, mat,
                  smooth_angle=math.radians(40))
    _attach(roof, root, coll)
    L.set_props(roof, part="roof")
    print(f"[dt1] roof rebuilt (removed {n} old roof objects), "
          f"crown z={_roof_z(0):.3f}, springing z={_roof_z(SKIN_X):.3f}")
    return roof


def restore_roof_ribs(root, coll):
    """The ribs were authored for the intended crown; re-seat them on it."""
    moved = 0
    for o in bpy.data.objects:
        if not o.name.startswith("DT1_Car1_RoofRib_"):
            continue
        x = o.location.x
        o.location.z = _roof_z(x) + 0.012
        moved += 1
    print(f"[dt1] re-seated {moved} roof ribs on the new crown")


# -------------------------------------------------------------- 2. door bays --
def rebuild_headers(root, coll):
    """Close the hole between the door head and the cant rail."""
    n = _purge("DT1_Car1_E_Header_", "DT1_Car1_W_Header_")
    red = _mat_of("DT1_Car1_E_Lower_0")
    white = _mat_of("DT1_Car1_E_Stripe_0")
    made = 0
    for side, tag in SIDES:
        for i, yc in enumerate(DOOR_CENTRES):
            h = L.box(f"DT1_Car1_{tag}_Header_{i}",
                      (SKIN_X - SKIN_IN_X, CLEAR_HALF * 2, CANT_Z - DOOR_TOP),
                      location=(side * (SKIN_X + SKIN_IN_X) / 2, yc,
                                (DOOR_TOP + CANT_Z) / 2),
                      coll=coll, mat=red)
            _attach(h, root, coll)
            made += 1
    print(f"[dt1] {made} doorway headers (replaced {n}); "
          f"closed z {DOOR_TOP:.2f}..{CANT_Z:.2f} over every doorway")


def rebuild_corners(root, coll):
    """Patch the window band where it stops short of the cab.

    The glazed band ends at |y| = 8.708 but the skin panels run to 8.838, so
    each of the four corners had a 130 x 900 mm hole between the stripe and the
    upper panel. The full-height corner panels this function used to build are
    gone: the new cab mask starts at 8.838 and covers that job itself.
    """
    n = _purge("DT1_Car1_E_Corner_", "DT1_Car1_W_Corner_",
               "DT1_Car1_E_BandFill_", "DT1_Car1_W_BandFill_")
    red = _mat_of("DT1_Car1_E_Lower_0")
    made = 0
    for side, tag in SIDES:
        for end, sgn in (("F", 1), ("R", -1)):
            # starts just above the lower panel: overlapping it would put two
            # same-facing skin planes on top of each other at x = 1.355/1.445
            z0 = 2.062
            f = L.box(f"DT1_Car1_{tag}_BandFill_{end}",
                      (SKIN_X - SKIN_IN_X, MASK_BACK_Y - BAND_HOLE_Y,
                       BAND_Z1 - z0),
                      location=(side * (SKIN_X + SKIN_IN_X) / 2,
                                sgn * (BAND_HOLE_Y + MASK_BACK_Y) / 2,
                                (z0 + BAND_Z1) / 2),
                      coll=coll, mat=red)
            _attach(f, root, coll)
            made += 1
    print(f"[dt1] {made} window-band corner fills (replaced {n}); "
          f"closed y {BAND_HOLE_Y:.3f}..{MASK_BACK_Y:.3f}, z "
          f"{STRIPE_Z0:.2f}..{BAND_Z1:.2f}")


def rebuild_stripes(root, coll):
    """Rebuild the white band so nothing is coplanar with the red skin.

    The shipped stripes spanned exactly the same y as the panels they sat on,
    so their end faces shared a plane and a facing direction with the panel end
    faces — a 90 x 60 mm shimmering patch at every bay end. They now tuck 4 mm
    into the door jambs (solid there, so the ends are hidden) and their inner
    face sits between the lining and the skin, level with neither.
    """
    n = _purge("DT1_Car1_E_Stripe_", "DT1_Car1_W_Stripe_")
    white = _mat_of("DT1_Car1_E_Stripe_0") or _mat_of("DT1_Car1_Door1_EL_Stripe")
    made = 0
    for side, tag in SIDES:
        for i, (y0, y1) in enumerate(BAYS):
            # every end is extended: at a doorway it disappears into the jamb,
            # at the car end it butts the nose stripe with an opposing normal
            a, b = y0 - STRIPE_TUCK, y1 + STRIPE_TUCK
            s = L.box(f"DT1_Car1_{tag}_Stripe_{i}",
                      (STRIPE_X1 - STRIPE_X0, b - a, STRIPE_Z1 - STRIPE_Z0),
                      location=(side * (STRIPE_X0 + STRIPE_X1) / 2,
                                (a + b) / 2, (STRIPE_Z0 + STRIPE_Z1) / 2),
                      coll=coll, mat=white)
            _attach(s, root, coll)
            made += 1
    print(f"[dt1] {made} body stripes rebuilt (replaced {n}); "
          f"x {STRIPE_X0:.4f}..{STRIPE_X1:.3f}, ends tucked {STRIPE_TUCK * 1000:.0f} mm")


# ------------------------------------------------------------- driving cab --
def _nose_ring(z, inset=0.0, back=MASK_BACK_Y):
    """Plan outline of the cab mask at height z: straight sides, one chamfer
    per side, flat front. The top leans back by RAKE."""
    t = (z - MASK_Z0) / (MASK_Z1 - MASK_Z0)
    dy = -RAKE * t
    hw = SKIN_X - inset
    fy = NOSE_Y - inset + dy
    sy = MASK_SIDE_Y - inset * 0.5 + dy
    fx = NOSE_FLAT_HX - inset * 0.5
    return [(-hw, back), (-hw, sy), (-fx, fy),
            (fx, fy), (hw, sy), (hw, back)]


def _loft(name, ring_lo, ring_hi, z_lo, z_hi, coll, mat, smooth=None):
    """Closed solid between two plan outlines at two heights."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z_lo)) for x, y in ring_lo]
    hi = [bm.verts.new((x, y, z_hi)) for x, y in ring_hi]
    bm.verts.ensure_lookup_table()
    n = len(ring_lo)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(tuple(reversed(lo)))
    bm.faces.new(tuple(hi))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.bm_to_obj(bm, name, coll, mat, smooth, 0.3, (0, 0, 0))


def rebuild_cab(root, coll):
    """Replace the flat slab nose with a shaped mask that has a real
    windscreen aperture, and put something in the cab to look at.

    The old front was a rectangular box 55 mm narrower than the body, with the
    windscreens laid flat on its outside face — hence the boxy silhouette, the
    step at the body joint and the panes that appeared to float.
    """
    # NB: exact-ish prefixes only. "DT1_Car1_Cab" would also swallow
    # CabPartition_F/R and CabPartitionWin_F/R, which are pre-existing parts
    # this rebuild must keep — deleting them opened the cab to the saloon.
    n = _purge("DT1_Car1_Front", "DT1_Car1_B_Front",
               "DT1_Car1_WinFrame", "DT1_Car1_B_WinFrame",
               "DT1_Car1_Windshield", "DT1_Car1_B_Windshield",
               "DT1_Car1_Mask", "DT1_Car1_B_Mask",
               "DT1_Car1_CabDesk", "DT1_Car1_B_CabDesk",
               "DT1_Car1_CabSeat", "DT1_Car1_B_CabSeat")
    red = _mat_of("DT1_Car1_E_Lower_0")
    white = _mat_of("DT1_Car1_E_Stripe_0")
    glass = _mat_of("DT1_Car1_E_Glass_0_0")
    dark = _mat_of("DT1_Car1_Underframe")
    seat = _mat_of("DT1_Car1_Ceiling") or dark

    made = []
    for end, sgn in (("", 1), ("B_", -1)):
        p = f"DT1_Car1_{end}"

        def ring(z, inset=0.0, back=MASK_BACK_Y):
            return [(x, sgn * y) for x, y in _nose_ring(z, inset, back)]

        # lower band, upper band
        made.append(_loft(f"{p}Mask_Lower", ring(MASK_Z0), ring(WS_Z0),
                          MASK_Z0, WS_Z0, coll, red, math.radians(35)))
        made.append(_loft(f"{p}Mask_Upper", ring(WS_Z1), ring(MASK_Z1),
                          WS_Z1, MASK_Z1, coll, red, math.radians(35)))
        # pillars through the glazed band: the two chamfers plus the posts
        # flanking the emergency door
        for lo_z, hi_z in ((WS_Z0, WS_Z1),):
            rl, rh = ring(lo_z), ring(hi_z)
            for a, b, nm in ((0, 2, "A_L"), (3, 5, "A_R")):
                made.append(_loft(f"{p}Mask_Pillar{nm}",
                                  rl[a:b + 1] + [(rl[b][0] - 0.0001, rl[b][1])],
                                  rh[a:b + 1] + [(rh[b][0] - 0.0001, rh[b][1])],
                                  lo_z, hi_z, coll, red))
            for sx in (-1, 1):
                fy_lo = ring(lo_z)[2][1]
                fy_hi = ring(hi_z)[2][1]
                w = 0.09
                made.append(_loft(
                    f"{p}Mask_PostC{'L' if sx < 0 else 'R'}",
                    [(sx * (WS_INNER_HX - w), fy_lo - sgn * MASK_T),
                     (sx * WS_INNER_HX, fy_lo - sgn * MASK_T),
                     (sx * WS_INNER_HX, fy_lo), (sx * (WS_INNER_HX - w), fy_lo)],
                    [(sx * (WS_INNER_HX - w), fy_hi - sgn * MASK_T),
                     (sx * WS_INNER_HX, fy_hi - sgn * MASK_T),
                     (sx * WS_INNER_HX, fy_hi), (sx * (WS_INNER_HX - w), fy_hi)],
                    lo_z, hi_z, coll, red))
        # glazing, recessed into the aperture — three panes now that the
        # emergency door no longer fills the centre
        for x0, x1, nm in ((-NOSE_FLAT_HX, -WS_INNER_HX, "L"),
                           (-WS_INNER_HX + 0.09, WS_INNER_HX - 0.09, "C"),
                           (WS_INNER_HX, NOSE_FLAT_HX, "R")):
            fy = (_nose_ring((WS_Z0 + WS_Z1) / 2)[2][1]) - 0.035
            g = L.plane(f"{p}Windshield{nm}", abs(x1 - x0), WS_Z1 - WS_Z0,
                        rotation=(math.pi / 2, 0.0, 0.0 if sgn > 0 else math.pi),
                        coll=coll, mat=glass)
            g.location = ((x0 + x1) / 2, sgn * fy, (WS_Z0 + WS_Z1) / 2)
            made.append(g)
        # white band wrapped around the nose (encloses the mask in that slice,
        # so no face of either ends up coplanar with the other)
        # starts 4 mm ahead of the mask's own back face, butting the body
        # stripe with an opposing normal instead of sharing the mask's plane
        made.append(_loft(f"{p}Mask_Stripe",
                          ring(STRIPE_Z0, -0.027, MASK_BACK_Y + STRIPE_TUCK),
                          ring(STRIPE_Z1, -0.027, MASK_BACK_Y + STRIPE_TUCK),
                          STRIPE_Z0, STRIPE_Z1, coll, white))
        # cab interior: desk across the front and a driver's seat
        deskY = sgn * (MASK_SIDE_Y - 0.30)
        d = L.box(f"{p}CabDesk", (1.90, 0.42, 0.10),
                  location=(0.0, deskY, 2.02), coll=coll, mat=dark)
        made.append(d)
        made.append(L.box(f"{p}CabDeskFront", (1.90, 0.06, 0.62),
                          location=(0.0, deskY - sgn * 0.20, 1.72),
                          coll=coll, mat=dark))
        made.append(L.box(f"{p}CabSeat", (0.46, 0.46, 0.10),
                          location=(-0.52, deskY - sgn * 0.62, 1.66),
                          coll=coll, mat=seat))
        made.append(L.box(f"{p}CabSeatBack", (0.46, 0.09, 0.56),
                          location=(-0.52, deskY - sgn * 0.83, 1.95),
                          coll=coll, mat=seat))
    for o in made:
        _attach(o, root, coll)
    print(f"[dt1] cab masks rebuilt: {len(made)} objects (replaced {n}); "
          f"nose {NOSE_Y:.3f}, flat front {2 * NOSE_FLAT_HX:.2f} m, "
          f"rake {RAKE * 1000:.0f} mm, windscreen z {WS_Z0:.2f}..{WS_Z1:.2f}")


def fix_signs():
    """Restore the destination signs to the orientation that actually reads.

    A four-variant test rendered at the real sign position, viewed from the
    platform side, settles it: (pi/2, 0, pi) reads KONTAKT, (pi/2, 0, 0) is
    mirrored and the -pi/2 pair is upside down. That is the orientation the
    scene shipped with — an earlier "fix" here swapped the two cabs on the
    strength of an isolated test whose camera sat on the wrong side. This
    function now only guarantees the pair stays correct across re-runs.
    """
    for name, rot in (("DT1_Car1_DestText", (math.pi / 2, 0.0, math.pi)),
                      ("DT1_Car1_B_DestText", (math.pi / 2, 0.0, 0.0))):
        o = bpy.data.objects.get(name)
        if o is not None:
            o.rotation_euler = rot
    print("[dt1] destination signs: front (pi/2,0,pi), rear (pi/2,0,0)")


def fix_thresholds():
    """Sill plates sat 60 mm below the cabin floor."""
    fixed = 0
    for o in bpy.data.objects:
        if "_Threshold_" not in o.name or not o.name.startswith("DT1_Car1"):
            continue
        h = o.dimensions.z
        o.location.z = FLOOR_Z - h / 2
        fixed += 1
    print(f"[dt1] {fixed} thresholds raised flush with the floor (z={FLOOR_Z})")


def rebuild_lining(root, coll):
    """Lining per bay, and stopping at the window band.

    It used to run the full length (walling off every doorway) AND the full
    height up to z 3.33 — so it also sat right behind the side glazing, which
    is half the reason the windows read as solid panels.
    """
    n = _purge("DT1_Car1_IntWall_", "DT1_Car1_Liner",
               "DT1_Car1_E_Lining_", "DT1_Car1_W_Lining_")
    wood = _mat_of("DT1_Car1_Ceiling") or _mat_of("DT1_Car1_E_Lower_0")
    made = 0
    for side, tag in SIDES:
        for i, (y0, y1) in enumerate(BAYS):
            for part, (z0, z1) in (("", (FLOOR_Z, BAND_Z0)),
                                   ("Top", (BAND_Z1, CANT_Z - 0.05))):
                w = L.box(f"DT1_Car1_{tag}_Lining_{part}{i}",
                          (SKIN_IN_X - LINING_X, y1 - y0, z1 - z0),
                          location=(side * (SKIN_IN_X + LINING_X) / 2,
                                    (y0 + y1) / 2, (z0 + z1) / 2),
                          coll=coll, mat=wood)
                _attach(w, root, coll)
                made += 1
    print(f"[dt1] saloon lining: {made} panels (replaced {n}); "
          f"clear of the doorways and of the window band "
          f"{BAND_Z0:.2f}..{BAND_Z1:.2f}")


def rebuild_windows(root, coll):
    """Turn the side 'window frames' into actual frames.

    Each DT1_Car1_*_WinFrame_* was a solid slab filling the whole window
    opening with the glass pane buried inside it, so every side window was in
    effect a painted panel. Spans are read back off the existing objects so the
    window layout is preserved exactly.
    """
    spans = {}
    for o in bpy.data.objects:
        if "_WinFrame_" not in o.name or not o.name.startswith("DT1_Car1"):
            continue
        m = root.matrix_world.inverted() @ o.matrix_world
        cs = [m @ Vector(c) for c in o.bound_box]
        spans[o.name] = (min(c.y for c in cs), max(c.y for c in cs),
                         min(c.z for c in cs), max(c.z for c in cs))
    if not spans:
        print("[dt1] !! no side window frames found")
        return
    red = _mat_of("DT1_Car1_E_Lower_0")
    glass = _mat_of("DT1_Car1_E_Glass_0_0")
    # the pane is shared by doors and body: make it read from both sides,
    # otherwise it vanishes when you look out from the saloon
    if glass is not None:
        glass.use_backface_culling = False

    # 36 mm, not 30: a 30 mm border puts the lower rail's top face on z 2.120
    # — the same plane and the same facing as the stripe's top — and the upper
    # rail's underside on z 3.020, level with E_Upper's underside. 36 mm clears
    # both by 6 mm.
    BORDER = 0.036
    fx0, fx1 = SKIN_IN_X - 0.010, SKIN_X + 0.010      # 1.345 .. 1.455
    n = _purge("DT1_Car1_E_WinFrame_", "DT1_Car1_W_WinFrame_",
               "DT1_Car1_E_Glass_", "DT1_Car1_W_Glass_")
    made = 0
    for name, (y0, y1, z0, z1) in sorted(spans.items()):
        side = 1 if "_E_" in name else -1
        yc, zc = (y0 + y1) / 2, (z0 + z1) / 2
        hw, hh = (y1 - y0) / 2, (z1 - z0) / 2
        bm = bmesh.new()
        # picture-frame layout: the rails run only BETWEEN the stiles. Rails
        # spanning the full width would overlap the stiles in all four corners,
        # and there their outer faces coincide — a z-fight inside one mesh.
        for sz in (-1, 1):
            _bm_box(bm, (0, 0, sz * (hh - BORDER / 2)),
                    (fx1 - fx0, 2 * (hw - BORDER), BORDER))
        for sy in (-1, 1):
            _bm_box(bm, (0, sy * (hw - BORDER / 2), 0),
                    (fx1 - fx0, BORDER, 2 * hh))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        fr = L.bm_to_obj(bm, name, coll, red, None, 0.3, (0, 0, 0))
        fr.location = (side * (fx0 + fx1) / 2, yc, zc)
        _attach(fr, root, coll)
        g = L.plane(name.replace("_WinFrame_", "_Glass_"),
                    2 * (hw - BORDER), 2 * (hh - BORDER),
                    rotation=(math.pi / 2, 0.0, side * math.pi / 2),
                    coll=coll, mat=glass)
        g.location = (side * 1.370, yc, zc)
        _attach(g, root, coll)
        made += 2
    print(f"[dt1] {made // 2} side windows rebuilt as frames + glazing "
          f"(replaced {n}); {BORDER * 1000:.0f} mm border, glass double-sided")


def strip_cab_clutter():
    """Remove the emergency doors and the cab partitions.

    Both were solid panels sitting across sightlines: the emergency door filled
    the centre of the windscreen and the partition sealed the cab off from the
    saloon. With them gone the front glazing needs a centre pane, which
    rebuild_cab() now adds.
    """
    n = _purge("DT1_Car1_EmergencyDoor", "DT1_Car1_B_EmergencyDoor",
               "DT1_Car1_CabPartition", "DT1_Car1_B_CabPartition")
    print(f"[dt1] removed {n} emergency-door / cab-partition objects")


# ------------------------------------------------------------------ 3. doors --
def _bm_box(bm, centre, size):
    res = bmesh.ops.create_cube(bm, size=1.0)
    vs = res['verts']
    bmesh.ops.scale(bm, vec=size, verts=vs)
    bmesh.ops.translate(bm, vec=centre, verts=vs)


# leaf in its own frame: origin at the leaf centre, aperture cut for glazing
LEAF_HW = LEAF_W / 2
LEAF_HH = (DOOR_TOP - FLOOR_Z) / 2
APER_HY = 0.245                     # half width of the window aperture
APER_Z0, APER_Z1 = 0.02, 0.78       # aperture in leaf-local z


def _leaf_mesh(name, coll, mat):
    """Door leaf as a real frame — bottom rail, two stiles, top rail — so the
    glazing is a hole you can see through instead of a pane laid on a slab."""
    bm = bmesh.new()
    # rails run between the stiles, not across them — overlapping boxes put
    # coincident faces inside a single mesh (same defect as the side windows)
    _bm_box(bm, (0.0, 0.0, (-LEAF_HH + APER_Z0) / 2),
            (LEAF_T, 2 * APER_HY, LEAF_HH + APER_Z0))
    _bm_box(bm, (0.0, 0.0, (APER_Z1 + LEAF_HH) / 2),
            (LEAF_T, 2 * APER_HY, LEAF_HH - APER_Z1))
    for sy in (-1, 1):
        _bm_box(bm, (0.0, sy * (APER_HY + LEAF_HW) / 2, 0.0),
                (LEAF_T, LEAF_HW - APER_HY, 2 * LEAF_HH))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.bm_to_obj(bm, name, coll, mat, None, 0.3, (0, 0, 0))


def rebuild_doors(root, coll):
    red = _mat_of("DT1_Car1_E_Lower_0")
    white = _mat_of("DT1_Car1_E_Stripe_0")
    glass = _mat_of("DT1_Car1_E_Glass_0_0")
    rubber = _mat_of("DT1_Car1_Door1_EL_Rub") or red
    metal = _mat_of("DT1_Car1_Underframe")
    n = _purge("DT1_Car1_Door")
    made = 0
    for side, tag in SIDES:
        for di, yc in enumerate(DOOR_CENTRES):
            for d, lt in ((-1, "L"), (1, "R")):
                base = f"DT1_Car1_Door{di + 1}_{tag}{lt}"
                leaf = _leaf_mesh(base, coll, red)
                leaf.location = (side * LEAF_X, yc + d * LEAF_W / 2, LEAF_Z)
                _attach(leaf, root, coll)
                L.set_props(leaf, interactive_type="door", door_side=tag)

                def kid(obj):
                    obj.parent = leaf
                    obj.matrix_parent_inverse = Matrix.Identity(4)
                    if obj.name not in coll.objects:
                        for c in list(obj.users_collection):
                            c.objects.unlink(obj)
                        coll.objects.link(obj)
                    return obj

                # rubber lip on the meeting edge
                rub = L.box(f"{base}_Rub", (LEAF_T + 0.008, 0.032,
                                            DOOR_TOP - FLOOR_Z - 0.01),
                            coll=coll, mat=rubber)
                kid(rub).location = (0.0, -d * (LEAF_W / 2 - 0.016), 0.0)
                # white band carried across the leaf
                # 6 mm short of the leaf edges: equal width would put the
                # stripe's end faces in the leaf's own planes
                st = L.box(f"{base}_Stripe", (LEAF_T + 0.012, LEAF_W - 0.006,
                                              STRIPE_Z1 - STRIPE_Z0),
                           coll=coll, mat=white)
                kid(st).location = (0.0, 0.0,
                                    (STRIPE_Z0 + STRIPE_Z1) / 2 - LEAF_Z)
                # glazing sits inside the aperture, not on top of the leaf
                wz = (APER_Z0 + APER_Z1) / 2
                gl = L.plane(f"{base}_Win", 2 * APER_HY, APER_Z1 - APER_Z0,
                             rotation=(math.pi / 2, 0.0, side * math.pi / 2),
                             coll=coll, mat=glass)
                kid(gl).location = (side * 0.004, 0.0, wz)
                # hanger reaching the runner rail above the doorway
                hg = L.box(f"{base}_Roller", (0.045, 0.130, 0.170),
                           coll=coll, mat=metal)
                kid(hg).location = (0.0, 0.0, 3.180 - LEAF_Z)
                made += 1
    print(f"[dt1] {made} door leaves rebuilt (replaced {n} objects): "
          f"flush at x={SKIN_X:.3f}, z {FLOOR_Z:.2f}..{DOOR_TOP:.2f}, "
          f"{LEAF_W:.3f} m wide on a {CLEAR_HALF * 2:.3f} m opening")


def door_actions():
    """Plug out, then slide, eased; doorways staggered. Four clips.

    The shut pose lives in matrix_parent_inverse, never in `location`: Blender
    evaluates the NLA stack from the property defaults, so any frame with no
    active strip resets an animated location to (0, 0, 0). See PIPELINE.md §2.
    """
    made = 0
    for prefix, clip in (("DT1_Car1", "mine"), ("DT1_Plaza_Car1", "plaza")):
        for di, yc in enumerate(DOOR_CENTRES):
            lead = di * 2
            for d, lt in ((-1, "L"), (1, "R")):
                leaf = bpy.data.objects.get(f"{prefix}_Door{di + 1}_E{lt}")
                if leaf is None:
                    continue
                leaf.animation_data_clear()
                shut = Vector((LEAF_X, yc + d * LEAF_W / 2, LEAF_Z))
                leaf.matrix_parent_inverse = Matrix.Translation(shut)
                leaf.location = (0.0, 0.0, 0.0)
                slide = d * DOOR_SLIDE
                # Every leaf is keyed over the SAME frame range 1..DOOR_END and
                # holds its end value there. The per-doorway stagger lives in
                # the keyframe times, never in the strip offset: strips of
                # different length merge into one glTF clip, and any leaf whose
                # strip has not started (or has already ended) falls back to its
                # rest pose — door 1 used to snap shut mid-clip while doors 2
                # and 3 were still travelling, and on closing doors 2 and 3
                # popped open a frame late.
                L.make_action(leaf, f"{clip}_doors_open", [
                    ("location", 0, [(1, 0.0), (2 + lead, 0.0),
                                     (11 + lead, DOOR_POP),
                                     (DOOR_END, DOOR_POP)], 'BEZIER'),
                    ("location", 1, [(1, 0.0), (9 + lead, 0.0),
                                     (45 + lead, slide),
                                     (DOOR_END, slide)], 'BEZIER'),
                ])
                L.make_action(leaf, f"{clip}_doors_close", [
                    ("location", 0, [(1, DOOR_POP), (36 + lead, DOOR_POP),
                                     (46 + lead, 0.0),
                                     (DOOR_END, 0.0)], 'BEZIER'),
                    ("location", 1, [(1, slide), (2 + lead, slide),
                                     (39 + lead, 0.0),
                                     (DOOR_END, 0.0)], 'BEZIER'),
                ])
                leaf.location = (0.0, 0.0, 0.0)
                made += 1
    print(f"[dt1] re-animated {made} door leaves (4 clips)")


# ------------------------------------------------------------------- driver --
CANONICAL_WAYPOINTS = {
    "cam_wp1_home", "cam_wp2_projects", "cam_wp2_boat_seat",
    "cam_wp3_about", "cam_wp4_contact", "cam_wp4_inside_train",
}


def dedupe_waypoints():
    """Exactly one empty may carry each camera_waypoint.

    The scene had picked up five extra objects tagged contact_inside — strays
    near the origin plus one parented to DT1_Root (which the plaza clone then
    duplicated). main.js builds its anchor table with a traverse and lets the
    last node win, so the rig was reading path_u 0.107 instead of 0.908 and the
    camera ran backwards through the whole world from s = 0.80 on.
    """
    doomed = [o for o in bpy.data.objects
              if o.get("camera_waypoint") and o.name not in CANONICAL_WAYPOINTS]
    for o in doomed:
        _rm(o)
    kept = {o.name: o.get("path_u") for o in bpy.data.objects
            if o.get("camera_waypoint")}
    print(f"[dt1] removed {len(doomed)} stray waypoint markers; anchors now {kept}")


def rebuild():
    dedupe_waypoints()
    root = bpy.data.objects["DT1_Root"]
    coll = L.collection("WP4_Metro")
    rebuild_roof(root, coll)
    restore_roof_ribs(root, coll)
    rebuild_headers(root, coll)
    rebuild_corners(root, coll)
    rebuild_stripes(root, coll)
    strip_cab_clutter()
    rebuild_cab(root, coll)
    fix_signs()
    fix_thresholds()
    rebuild_lining(root, coll)
    rebuild_windows(root, coll)
    rebuild_doors(root, coll)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import rework_teleport as RT
    import exporter

    rebuild()
    RT.clone_to_plaza()          # the plaza car is a copy — re-clone it
    door_actions()
    bpy.context.scene.frame_set(1)

    n_tri = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            n_tri += len(o.data.loop_triangles)
    print(f"[dt1] scene now: {len(bpy.data.objects)} objects, ~{n_tri} triangles")

    if "--save" in argv:
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if "--export" in argv:
        exporter.export_glb(os.path.join(OUT, "world.glb"))


if __name__ == "__main__":
    main()
