# ============================================================================
# wp4_station.py — IN-PLACE edit pass on blender/output/world.blend.
#
# Turns WP4's empty rock cavern into a built U-Bahn station in the spirit of
# Lisbon's Olaias: a coloured rhombus canopy on painted steel tubes, fat
# terracotta columns, escalators beside a stair, geometric stone wall panels.
#
#   1. the mine rails now END at the mouth of the shaft (y = -185, exactly
#      where the ballast was already cut) and turn into the balustrade of a
#      short stair that drops from the mine's upper concourse into the hall.
#   2. the station is 2.0 m lower and 4.0 m west of where it was, so the
#      shaft mouth reads as a mezzanine above the hall and the stair lands on
#      the platform instead of on the track.
#   3. the toppled split-flap board is replaced by a suspended departure board
#      whose five rows are the real links (interactive_type/link_id), framed
#      by the `contact` waypoint together with the DT1's KONTAKT sign.
#   4. the camera rail is re-authored between the shaft mouth and the seat in
#      the mine car. Only that stretch changes: everything before sample
#      START_IDX and the teleport cut at 639 are untouched.
#
# NEVER regenerate the world from build_world.py — world.blend is hand
# finished. This pass is idempotent: it deletes everything it owns first and
# every move is absolute, so running it twice is the same as running it once.
#
# Run:
#   blender -b blender/output/world.blend --python blender/wp4_station.py \
#           -- --save --export --shots
# ============================================================================
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import lib_common as L                      # noqa: E402
import exporter                             # noqa: E402

OUT = os.path.join(HERE, "output")

# ------------------------------------------------------------- the geometry --
# The station keeps the DT1's own datum arithmetic (platform top sits 1.25 m
# above the track datum, the car floor 1.10 m) — only the datum itself moves.
TRACK_X = -4.00                  # station track centreline (was 0.0)
DATUM = -32.20                   # station track datum      (was -30.2)
DROP_Z = -2.00                   # DATUM - old datum
SHIFT_X = -4.00                  # TRACK_X - old track x
PLAT_TOP = DATUM + 1.25          # -30.95
RAILHEAD = DATUM + 0.25          # -31.95
TRENCH_Z = DATUM - 0.35          # -32.55, top of the ballast trench floor
PLAT_EDGE_X = TRACK_X + 1.55     # -2.45
WEST_EDGE_X = TRACK_X - 1.55     # -5.55

HALL_X0, HALL_X1 = -11.50, 7.40
HALL_Y0, HALL_Y1 = -187.20, -226.00      # north / south inner wall faces
SOFFIT_Z = -24.30                        # structural ceiling deck
PANEL_Z = -24.90                         # the coloured canopy plane

RAIL_CUT_Y = -184.20             # mine rails stop here — the mouth of the bore
LAND_Z = -28.98                  # upper concourse floor == railhead at the cut
LAND_Y0 = -184.36                # south face of the bore's end frame
PASS_X0, PASS_X1 = -2.30, 2.70   # the lined passage through the rock
CONC_X0, CONC_X1 = -2.00, 7.40   # upper concourse box
CONC_ROOF = -26.00

STAIR_X0, STAIR_X1 = -0.10, 3.10
STAIR_OPEN_X0 = -1.60            # the north wall opens wider than the flight,
#                                  so the pier next to it stops blocking the view
N_STEPS = 11
RISE = (LAND_Z - PLAT_TOP) / N_STEPS     # 0.179
GOING = 0.315
STAIR_BOT_Y = HALL_Y0 - N_STEPS * GOING  # -190.665

ESC_X0 = 3.55                    # escalator opening in the north wall
ESC_XS = (4.60, 6.40)            # the two escalator centrelines
ESC_W = 1.25
ESC_BOT_Y = -190.90

TUNNEL_X0, TUNNEL_X1 = TRACK_X - 2.0, TRACK_X + 1.8   # -6.0 .. -2.2
TUNNEL_TOP = DATUM + 4.05        # -28.15

MINE_NOSE_Y = -200.50            # unchanged: the car keeps its y
SEAT = (TRACK_X, -205.50, DATUM + 2.65)
DOOR1_Y = MINE_NOSE_Y - 2.90     # -203.40
DOOR_FACE_X = TRACK_X + 1.45     # -2.55

CONTACT_POS = (1.50, -193.40, PLAT_TOP + 1.55)
CONTACT_LOOK = (0.55, -201.40, PLAT_TOP + 2.11)

START_IDX = 580                  # first re-authored camera sample
CUT_IDX = 639                    # the teleport cut — never moves
FRAMES = 3600
KEY_STEP = 6

# Objects this pass owns outright: wiped and rebuilt on every run. The three
# cavern shapes are wiped and NOT rebuilt — the station is a closed box now, so
# the rock shell only ever intruded (its surface cut through the hall's north
# end and read as a black slab from the top of the stair).
OWNED = ("WP4_Stn_", "WP4_Board_", "WP4_Clock_", "WP4_Platform",
         "WP4_Lamp_", "WP4_USign_", "WP4_Turnstile_", "WP4_Stalactite",
         "WP4_Stalagmite", "WP4_Cavern_Floor", "WP4_Cavern_Shell",
         "WP4_Station_Portal")

PALETTE = [
    ("Red",     (0.760, 0.115, 0.085)),
    ("Orange",  (0.930, 0.400, 0.055)),
    ("Yellow",  (0.960, 0.780, 0.090)),
    ("Blue",    (0.075, 0.235, 0.640)),
    ("Cyan",    (0.360, 0.620, 0.660)),
    ("Green",   (0.140, 0.520, 0.280)),
    ("Magenta", (0.620, 0.150, 0.430)),
    ("Bone",    (0.860, 0.855, 0.820)),
]


# --------------------------------------------------------------- utilities --
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


def _slim(obj, angle=math.radians(1.5)):
    """Collapse the coplanar fan a converted text curve leaves behind.

    text_mesh() bakes curves at resolution_u = 5, which costs ~12 k polygons
    for one short word — all of it flat faces and near-collinear outline
    verts. Limited dissolve keeps the silhouette and drops ~85 % of it.
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_limit(bm, angle_limit=angle, verts=bm.verts[:],
                             edges=bm.edges[:], delimit={'NORMAL'})
    bm.to_mesh(me)
    bm.free()
    me.update()
    return obj


def _trim_south(obj, y_cut):
    """Delete every vertex of obj south of y_cut (world space)."""
    me = obj.data
    mw = obj.matrix_world
    bm = bmesh.new()
    bm.from_mesh(me)
    doomed = [v for v in bm.verts if (mw @ v.co).y < y_cut]
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context='VERTS')
        bm.to_mesh(me)
        me.update()
    bm.free()
    return len(doomed)


def coll():
    return L.collection("WP4_Metro")


def stair_floor(y):
    """Walking surface of the mine stair at a given y (clamped to both ends)."""
    if y >= HALL_Y0:
        return LAND_Z
    if y <= STAIR_BOT_Y:
        return PLAT_TOP
    step = int((HALL_Y0 - y) / GOING)
    return LAND_Z - min(step, N_STEPS) * RISE


# ------------------------------------------------------------- 0. the purge --
def purge():
    doomed = [o for o in bpy.data.objects if o.name.startswith(OWNED)]
    for o in doomed:
        _rm(o)
    for m in [m for m in bpy.data.materials if m.name.startswith("Stn_")]:
        L._mat_cache.pop(m.name, None)
        try:
            bpy.data.materials.remove(m)
        except (ReferenceError, RuntimeError):
            pass
    for me in [me for me in bpy.data.meshes if me.users == 0]:
        bpy.data.meshes.remove(me)
    print(f"[stn] purged {len(doomed)} objects owned by this pass")


def mats():
    m = {
        # kept from the old cavern so the mine half still matches
        "rock":     _mat("Cavern_Rock", (0.30, 0.28, 0.27), rough=1.0,
                         double_sided=True),
        "rock_d":   _mat("Tunnel_Rock_Dark", (0.10, 0.10, 0.11), rough=1.0,
                         double_sided=True),
        "steel":    _mat("Rail_Steel", (0.55, 0.55, 0.58), rough=0.35, metal=1.0),
        "gravel":   _mat("Track_Ballast", (0.22, 0.21, 0.20), rough=1.0),
        # the station proper
        "floor":    _mat("Stn_Floor_Marble", (0.545, 0.520, 0.480), rough=0.22),
        "floor_l":  _mat("Stn_Floor_Light", (0.760, 0.735, 0.690), rough=0.20),
        "screed":   _mat("Stn_Screed", (0.360, 0.350, 0.340), rough=0.85),
        "conc":     _mat("Stn_Concrete", (0.470, 0.460, 0.445), rough=0.88),
        "conc_d":   _mat("Stn_Concrete_Dark", (0.235, 0.230, 0.225), rough=0.90),
        "dark":     _mat("Stn_Steel_Dark", (0.135, 0.135, 0.150), rough=0.50,
                         metal=0.5),
        "chrome":   _mat("Stn_Chrome", (0.760, 0.770, 0.790), rough=0.18,
                         metal=1.0),
        "skirt":    _mat("Stn_Esc_Skirt", (0.330, 0.335, 0.350), rough=0.35,
                         metal=0.4),
        "column":   _mat("Stn_Column_Terracotta", (0.720, 0.320, 0.110),
                         rough=0.52),
        "column_b": _mat("Stn_Column_Band", (0.560, 0.230, 0.075), rough=0.48),
        "stone_a":  _mat("Stn_Stone_A", (0.660, 0.630, 0.580), rough=0.55),
        "stone_b":  _mat("Stn_Stone_B", (0.520, 0.500, 0.470), rough=0.60),
        "stone_c":  _mat("Stn_Stone_C", (0.790, 0.760, 0.700), rough=0.50),
        "mosaic":   _mat("Stn_Mosaic", (0.470, 0.440, 0.400), rough=0.70),
        "gold":     _mat("Stn_Trim_Yellow", (0.930, 0.740, 0.110), rough=0.45),
        "edge":     _mat("Stn_Platform_Edge", (0.870, 0.865, 0.840), rough=0.65),
        "tactile":  _mat("Stn_Tactile", (0.880, 0.720, 0.130), rough=0.80),
        "glass":    _mat("Stn_Glass", (0.66, 0.74, 0.80), rough=0.06, metal=0.0,
                         alpha=0.12, double_sided=True),
        "strip":    _mat("Stn_LightStrip", (1.0, 0.98, 0.93), rough=0.5,
                         emit=(1.0, 0.97, 0.90), emit_str=5.0),
        "strip_s":  _mat("Stn_LightStrip_Soft", (0.96, 0.97, 1.0), rough=0.5,
                         emit=(0.90, 0.94, 1.0), emit_str=2.0),
        "sign_b":   _mat("Stn_Sign_Blue", (0.045, 0.130, 0.400), rough=0.42,
                         emit=(0.08, 0.24, 0.72), emit_str=1.6),
        "sign_w":   _mat("Stn_Sign_White", (1.0, 1.0, 1.0), rough=0.40,
                         emit=(1.0, 1.0, 1.0), emit_str=2.2),
        "board":    _mat("Stn_Board_Case", (0.105, 0.110, 0.125), rough=0.55),
        "board_f":  _mat("Stn_Board_Face", (0.045, 0.048, 0.058), rough=0.45),
        "board_t":  _mat("Stn_Board_Text", (1.0, 0.72, 0.20), rough=0.45,
                         emit=(1.0, 0.68, 0.16), emit_str=6.0),
        "board_d":  _mat("Stn_Board_Dim", (0.72, 0.74, 0.78), rough=0.5,
                         emit=(0.62, 0.66, 0.72), emit_str=1.4),
        "clock_f":  _mat("Stn_Clock_Face", (0.94, 0.94, 0.90), rough=0.6,
                         emit=(1.0, 1.0, 0.95), emit_str=1.6),
        "clock_h":  _mat("Stn_Clock_Hands", (0.07, 0.07, 0.08), rough=0.5),
        "clock_s":  _mat("Stn_Clock_Second", (0.85, 0.10, 0.08), rough=0.5),
    }
    for name, rgb in PALETTE:
        m["p" + name] = _mat(f"Stn_Panel_{name}", rgb, rough=0.38,
                             emit=rgb, emit_str=0.9)
        m["t" + name] = _mat(f"Stn_Tube_{name}", rgb, rough=0.30, metal=0.15)
    return m


# ------------------------------------------------- 1. the mine track is cut --
def trim_mine_track():
    """The rails stop at the shaft mouth; nothing runs on into the station."""
    for name in ("WP4_Rail_E", "WP4_Rail_W", "WP4_Track_Ballast"):
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        n = _trim_south(o, RAIL_CUT_Y)
        print(f"[stn] {name}: trimmed {n} verts south of y={RAIL_CUT_Y}")
    gone = 0
    for o in [o for o in bpy.data.objects if o.name.startswith("WP4_Sleeper_")]:
        if o.matrix_world.translation.y < RAIL_CUT_Y:
            _rm(o)
            gone += 1
    print(f"[stn] removed {gone} mine sleepers south of the cut")


def move_train():
    """Absolute placement, so a second run is a no-op."""
    root = bpy.data.objects["DT1_Root"]
    root.location = (TRACK_X, root.location.y, DATUM)
    seat = bpy.data.objects["cam_wp4_inside_train"]
    seat.location = SEAT
    # dead level, straight down the car: the teleport hands this framing to the
    # identical seat in the plaza car, so any tilt reads as the camera turning
    # while it jumps.
    seat.rotation_euler = L.look_at_rotation(
        SEAT, (SEAT[0], SEAT[1] - 9.0, SEAT[2]))
    bpy.context.view_layer.update()
    print(f"[stn] DT1_Root -> {tuple(round(v, 2) for v in root.location)}, "
          f"seat -> {tuple(round(v, 2) for v in SEAT)}")


def station_track(m):
    """Ballast, rails and sleepers on the station's own datum."""
    c = coll()
    y0, y1 = HALL_Y0 + 0.6, HALL_Y1 - 0.6
    L.box("WP4_Stn_Ballast", (4.10, y0 - y1, 0.42),
          location=(TRACK_X, (y0 + y1) / 2, TRENCH_Z + 0.21), coll=c,
          mat=m["gravel"], uv_scale=0.3)
    for side, tag in ((-1, "W"), (1, "E")):
        L.box(f"WP4_Stn_Rail_{tag}", (0.14, y0 - y1, 0.14),
              location=(TRACK_X + side * 0.7175, (y0 + y1) / 2,
                        RAILHEAD - 0.07),
              coll=c, mat=m["steel"])
    src = bpy.data.objects.get("WP4_Sleeper")
    if src is not None:
        n = int((y0 - y1) / 0.85)
        for i in range(n + 1):
            L.inst(src, f"WP4_Stn_Sleeper_{i}",
                   (TRACK_X, y0 - i * 0.85, TRENCH_Z + 0.48), coll=c)
    # dark stubs behind both tunnel portals so the track reads as continuing
    for tag, ys in (("N", (HALL_Y0, HALL_Y0 + 7.0)),
                    ("S", (HALL_Y1 - 7.0, HALL_Y1))):
        L.box(f"WP4_Stn_TunnelStub_{tag}", (3.80, 7.0, 4.05),
              location=(TRACK_X, (ys[0] + ys[1]) / 2, TRENCH_Z + 2.02),
              coll=c, mat=m["rock_d"])


# ------------------------------------------------------------ 2. hall shell --
def hall_shell(m):
    c = coll()
    W = HALL_X1 - HALL_X0
    LEN = HALL_Y0 - HALL_Y1
    ymid = (HALL_Y0 + HALL_Y1) / 2

    # --- floors -------------------------------------------------------------
    # east platform (the one the visitor walks) and the west service walkway
    L.box("WP4_Stn_Floor_E", (HALL_X1 - PLAT_EDGE_X, LEN, 1.10),
          location=((HALL_X1 + PLAT_EDGE_X) / 2, ymid, PLAT_TOP - 0.55),
          coll=c, mat=m["floor"], uv_scale=0.22)
    L.box("WP4_Stn_Floor_W", (WEST_EDGE_X - HALL_X0, LEN, 1.10),
          location=((WEST_EDGE_X + HALL_X0) / 2, ymid, PLAT_TOP - 0.55),
          coll=c, mat=m["floor"], uv_scale=0.22)
    L.box("WP4_Stn_Trench", (PLAT_EDGE_X - WEST_EDGE_X, LEN, 0.30),
          location=(TRACK_X, ymid, TRENCH_Z - 0.15), coll=c, mat=m["conc_d"])
    # marble inlay bands running the length of the concourse
    for i, x in enumerate((-1.30, 2.20, 5.70)):
        L.box(f"WP4_Stn_FloorInlay_{i}", (0.34, LEN, 0.02),
              location=(x, ymid, PLAT_TOP + 0.005), coll=c, mat=m["floor_l"],
              uv_scale=0.22)
    for i, x in enumerate((-1.05, 1.95, 5.45)):
        L.box(f"WP4_Stn_FloorLine_{i}", (0.07, LEN, 0.02),
              location=(x, ymid, PLAT_TOP + 0.006), coll=c, mat=m["gold"])
    # platform edge: warning line + tactile strip, both sides of the track
    L.box("WP4_Stn_EdgeLine", (0.30, LEN, 0.03),
          location=(PLAT_EDGE_X + 0.15, ymid, PLAT_TOP + 0.01), coll=c,
          mat=m["edge"])
    L.box("WP4_Stn_Tactile", (0.36, LEN, 0.035),
          location=(PLAT_EDGE_X + 0.62, ymid, PLAT_TOP + 0.012), coll=c,
          mat=m["tactile"])
    L.box("WP4_Stn_EdgeLine_W", (0.24, LEN, 0.03),
          location=(WEST_EDGE_X - 0.12, ymid, PLAT_TOP + 0.01), coll=c,
          mat=m["edge"])

    # --- long walls ---------------------------------------------------------
    for tag, x, side in (("E", HALL_X1, 1), ("W", HALL_X0, -1)):
        L.box(f"WP4_Stn_Wall_{tag}", (0.70, LEN, SOFFIT_Z - TRENCH_Z),
              location=(x + side * 0.35, ymid, (SOFFIT_Z + TRENCH_Z) / 2),
              coll=c, mat=m["conc"], uv_scale=0.20)
    # --- end walls ----------------------------------------------------------
    # south: solid but for the tunnel portal
    L.box("WP4_Stn_Wall_S_W", (TUNNEL_X0 - HALL_X0, 0.70, SOFFIT_Z - TRENCH_Z),
          location=((TUNNEL_X0 + HALL_X0) / 2, HALL_Y1 - 0.35,
                    (SOFFIT_Z + TRENCH_Z) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)
    L.box("WP4_Stn_Wall_S_E", (HALL_X1 - TUNNEL_X1, 0.70, SOFFIT_Z - TRENCH_Z),
          location=((TUNNEL_X1 + HALL_X1) / 2, HALL_Y1 - 0.35,
                    (SOFFIT_Z + TRENCH_Z) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)
    L.box("WP4_Stn_Wall_S_Lintel", (TUNNEL_X1 - TUNNEL_X0, 0.70,
                                    SOFFIT_Z - TUNNEL_TOP),
          location=((TUNNEL_X0 + TUNNEL_X1) / 2, HALL_Y1 - 0.35,
                    (SOFFIT_Z + TUNNEL_TOP) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)
    # north: solid up to the concourse floor, then stair + escalator openings
    L.box("WP4_Stn_Wall_N_W", (TUNNEL_X0 - HALL_X0, 0.70, SOFFIT_Z - TRENCH_Z),
          location=((TUNNEL_X0 + HALL_X0) / 2, HALL_Y0 + 0.35,
                    (SOFFIT_Z + TRENCH_Z) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)
    L.box("WP4_Stn_Wall_N_Lintel", (TUNNEL_X1 - TUNNEL_X0, 0.70,
                                    SOFFIT_Z - TUNNEL_TOP),
          location=((TUNNEL_X0 + TUNNEL_X1) / 2, HALL_Y0 + 0.35,
                    (SOFFIT_Z + TUNNEL_TOP) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)
    L.box("WP4_Stn_Wall_N_Podium", (HALL_X1 - TUNNEL_X1, 0.70, LAND_Z - TRENCH_Z),
          location=((TUNNEL_X1 + HALL_X1) / 2, HALL_Y0 + 0.35,
                    (LAND_Z + TRENCH_Z) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)
    # piers between the three openings, and the lintel over them
    for tag, x0, x1 in (("A", TUNNEL_X1, STAIR_OPEN_X0), ("B", STAIR_X1, ESC_X0)):
        if x1 - x0 <= 0.01:
            continue
        L.box(f"WP4_Stn_Wall_N_Pier{tag}", (x1 - x0, 0.70, CONC_ROOF - LAND_Z),
              location=((x0 + x1) / 2, HALL_Y0 + 0.35,
                        (CONC_ROOF + LAND_Z) / 2), coll=c, mat=m["conc"],
              uv_scale=0.20)
    L.box("WP4_Stn_Wall_N_Head", (HALL_X1 - TUNNEL_X1, 0.70,
                                  SOFFIT_Z - CONC_ROOF),
          location=((TUNNEL_X1 + HALL_X1) / 2, HALL_Y0 + 0.35,
                    (SOFFIT_Z + CONC_ROOF) / 2), coll=c, mat=m["conc"],
          uv_scale=0.20)

    # --- ceiling deck -------------------------------------------------------
    L.box("WP4_Stn_Soffit", (W + 1.4, LEN + 1.4, 0.40),
          location=((HALL_X0 + HALL_X1) / 2, ymid, SOFFIT_Z + 0.20),
          coll=c, mat=m["conc_d"], uv_scale=0.18)


# ------------------------------------------------ 3. the mine → hall stitch --
def concourse(m):
    """Upper concourse at the shaft mouth, the stair, and the escalator pair."""
    c = coll()
    cx = (CONC_X0 + CONC_X1) / 2
    cw = CONC_X1 - CONC_X0
    c_len = LAND_Y0 - HALL_Y0                 # 2.84 m, north → south
    c_mid = (LAND_Y0 + HALL_Y0) / 2

    # --- the bore's end frame ----------------------------------------------
    # the mine tube is a 3.3 m circular bore and the passage behind it is
    # rectangular, so the annulus between them has to be closed or the visitor
    # sees straight through into the shell's carved hole.
    fy = RAIL_CUT_Y - 0.14        # 0.30 thick, so it overlaps the tube's last
    for tag, z in (("T", CONC_ROOF + 2.1), ("B", LAND_Z - 2.1)):   # ring
        L.box(f"WP4_Stn_BoreFrame_{tag}", (9.4, 0.30, 4.2),
              location=(0.20, fy, z), coll=c, mat=m["rock_d"])
    for side, tag, x0, x1 in ((-1, "W", -4.50, PASS_X0), (1, "E", PASS_X1, 4.90)):
        L.box(f"WP4_Stn_BoreFrame_{tag}", (x1 - x0, 0.30, CONC_ROOF - LAND_Z),
              location=((x0 + x1) / 2, fy, (CONC_ROOF + LAND_Z) / 2), coll=c,
              mat=m["rock_d"])
    # blunt end plates so the cut rails are not open tubes
    for side in (-1, 1):
        L.box(f"WP4_Stn_RailEnd{'W' if side < 0 else 'E'}",
              (0.22, 0.14, 0.30), location=(side * 0.7175, RAIL_CUT_Y + 0.07,
                                            LAND_Z - 0.10), coll=c,
              mat=m["dark"])

    # There is deliberately no separate lined passage: the bore frame already
    # closes the annulus and the concourse's own roof and flanks close the
    # rest, so a second set of walls only boxed the visitor in and hid the
    # escalator heads at the very moment the hall should open up.

    # --- concourse slab (a podium: solid down to the hall floor) -----------
    L.box("WP4_Stn_Concourse", (cw, c_len, LAND_Z - PLAT_TOP),
          location=(cx, c_mid, (LAND_Z + PLAT_TOP) / 2),
          coll=c, mat=m["conc"], uv_scale=0.22)
    L.box("WP4_Stn_Concourse_Floor", (cw, c_len, 0.05),
          location=(cx, c_mid, LAND_Z - 0.025), coll=c,
          mat=m["floor"], uv_scale=0.22)
    # the concourse is wider than the passage: close the flanks and the roof
    for side, tag, x0, x1 in ((-1, "W", CONC_X0, PASS_X0 - 0.45),
                              (1, "E", PASS_X1 + 0.45, CONC_X1)):
        if x1 - x0 <= 0.05:
            continue
        L.box(f"WP4_Stn_Concourse_Back{tag}",
              (x1 - x0, 0.50, CONC_ROOF - LAND_Z),
              location=((x0 + x1) / 2, LAND_Y0 - 0.25,
                        (CONC_ROOF + LAND_Z) / 2), coll=c, mat=m["conc"],
              uv_scale=0.20)
    L.box("WP4_Stn_Concourse_Roof", (cw + 0.6, c_len, 0.40),
          location=(cx, c_mid, CONC_ROOF + 0.20), coll=c,
          mat=m["conc_d"], uv_scale=0.20)
    for side, tag, x in ((1, "E", CONC_X1 + 0.25), (-1, "W", CONC_X0 - 0.25)):
        L.box(f"WP4_Stn_Concourse_Side{tag}", (0.50, c_len,
                                               CONC_ROOF - LAND_Z),
              location=(x, c_mid, (CONC_ROOF + LAND_Z) / 2), coll=c,
              mat=m["conc"], uv_scale=0.20)

    # --- the stair ----------------------------------------------------------
    sw = STAIR_X1 - STAIR_X0
    sx = (STAIR_X0 + STAIR_X1) / 2
    for k in range(N_STEPS):
        y_top = HALL_Y0 - k * GOING
        z_top = LAND_Z - k * RISE
        L.box(f"WP4_Stn_Step_{k}", (sw, GOING, 0.06),
              location=(sx, y_top - GOING / 2, z_top - 0.03), coll=c,
              mat=m["floor_l"], uv_scale=0.4)
        L.box(f"WP4_Stn_Riser_{k}", (sw, 0.05, RISE),
              location=(sx, y_top - GOING, z_top - RISE / 2), coll=c,
              mat=m["conc_d"])
        L.box(f"WP4_Stn_Nosing_{k}", (sw, 0.05, 0.02),
              location=(sx, y_top - GOING + 0.025, z_top - 0.005), coll=c,
              mat=m["gold"])
    # the raking soffit under the flight — this is the cantilevered black
    # slab that gives the photo its floating stairs
    run = N_STEPS * GOING
    drop = N_STEPS * RISE
    L.sweep("WP4_Stn_Stair_Soffit",
            [(-0.30, -sw / 2), (-0.30, sw / 2), (0.0, sw / 2), (0.0, -sw / 2)],
            [(sx, HALL_Y0 + 0.1, LAND_Z - 0.10),
             (sx, HALL_Y0 - run, LAND_Z - drop - 0.10),
             (sx, HALL_Y0 - run - 0.4, LAND_Z - drop - 0.10)],
            coll=c, mat=m["dark"], smooth_angle=math.radians(35))
    for side in (-1, 1):
        L.sweep(f"WP4_Stn_Stringer{'L' if side < 0 else 'R'}",
                [(-0.30, -0.06), (-0.30, 0.06), (0.05, 0.06), (0.05, -0.06)],
                [(sx + side * (sw / 2 + 0.06), HALL_Y0 + 0.1, LAND_Z),
                 (sx + side * (sw / 2 + 0.06), HALL_Y0 - run,
                  LAND_Z - drop),
                 (sx + side * (sw / 2 + 0.06), HALL_Y0 - run - 0.4,
                  LAND_Z - drop)],
                coll=c, mat=m["dark"], smooth_angle=math.radians(35))

    # --- the rails become the balustrade ------------------------------------
    # they leave the mine at railhead height, rise over the concourse and ride
    # the pitch of the stair down into the hall
    hr = 0.95
    for side, tag in ((-1, "W"), (1, "E")):
        x_rail = side * 0.7175
        x_bal = STAIR_X0 - 0.06 if side < 0 else STAIR_X1 + 0.06
        pts = [
            (x_rail, RAIL_CUT_Y + 0.55, LAND_Z),
            (x_rail, RAIL_CUT_Y - 0.05, LAND_Z + 0.02),
            (x_rail + (x_bal - x_rail) * 0.18, RAIL_CUT_Y - 0.75, LAND_Z + 0.48),
            (x_rail + (x_bal - x_rail) * 0.55, RAIL_CUT_Y - 1.45, LAND_Z + hr),
            (x_bal, HALL_Y0 + 0.30, LAND_Z + hr),
            (x_bal, HALL_Y0 - 0.30, LAND_Z + hr - 0.30 / GOING * RISE),
            (x_bal, HALL_Y0 - run + 0.30,
             LAND_Z - drop + hr + 0.30 / GOING * RISE),
            (x_bal, HALL_Y0 - run - 0.10, PLAT_TOP + hr),
            (x_bal, HALL_Y0 - run - 0.75, PLAT_TOP + hr),
            (x_bal, HALL_Y0 - run - 1.05, PLAT_TOP + hr - 0.35),
        ]
        dense = L.catmull_rom(pts, closed=False, samples_per_seg=5)
        L.sweep(f"WP4_Stn_RailToStair_{tag}",
                [(-0.07, -0.035), (-0.07, 0.035), (0.07, 0.035), (0.07, -0.035)],
                dense, coll=c, mat=m["steel"], smooth_angle=math.radians(30))
        # posts carrying it down to the stringer / concourse floor
        for i in range(3, len(dense) - 3, 4):
            p = dense[i]
            base = stair_floor(p.y) if p.y < HALL_Y0 else LAND_Z
            if p.z - base < 0.25:
                continue
            L.cylinder(f"WP4_Stn_BalPost_{tag}_{i}", 0.028, p.z - base - 0.07,
                       segs=6, location=(p.x, p.y, (p.z + base) / 2 - 0.035),
                       coll=c, mat=m["dark"])

    # --- escalator pair, riding beside the stair ----------------------------
    esc_run = HALL_Y0 - ESC_BOT_Y
    esc_drop = LAND_Z - PLAT_TOP
    step_src = None
    for ei, ex in enumerate(ESC_XS):
        path = [(ex, HALL_Y0 + 0.55, LAND_Z - 0.55),
                (ex, HALL_Y0, LAND_Z - 0.55),
                (ex, ESC_BOT_Y, PLAT_TOP - 0.55),
                (ex, ESC_BOT_Y - 0.55, PLAT_TOP - 0.55)]
        L.sweep(f"WP4_Stn_Esc{ei}_Truss",
                [(-0.55, -ESC_W / 2), (-0.55, ESC_W / 2),
                 (0.55, ESC_W / 2), (0.55, -ESC_W / 2)],
                path, coll=c, mat=m["conc_d"], smooth_angle=math.radians(35))
        # treads: cleated plates standing proud of the truss, with a dark gap
        # between them — flush plates read as a plain ramp, not an escalator
        n_tread = 20
        for k in range(n_tread):
            t = (k + 0.5) / n_tread
            y = HALL_Y0 - esc_run * t
            z = LAND_Z - esc_drop * t
            loc = (ex, y, z + 0.045)
            if step_src is None:
                step_src = L.box("WP4_Stn_EscStepSrc",
                                 (ESC_W - 0.12, 0.155, 0.09), location=loc,
                                 coll=c, mat=m["chrome"])
                step_src.name = f"WP4_Stn_Esc{ei}_Step_{k}"
            else:
                L.inst(step_src, f"WP4_Stn_Esc{ei}_Step_{k}", loc, coll=c)
        # comb plates at both ends
        for tag, y, z in (("T", HALL_Y0 - 0.18, LAND_Z + 0.03),
                          ("B", ESC_BOT_Y + 0.18, PLAT_TOP + 0.03)):
            L.box(f"WP4_Stn_Esc{ei}_Comb{tag}", (ESC_W - 0.06, 0.42, 0.05),
                  location=(ex, y, z), coll=c, mat=m["gold"])
        for side in (-1, 1):
            L.sweep(f"WP4_Stn_Esc{ei}_Skirt{'L' if side < 0 else 'R'}",
                    [(-0.30, -0.06), (-0.30, 0.06), (0.10, 0.06), (0.10, -0.06)],
                    [(ex + side * (ESC_W / 2 + 0.04), HALL_Y0 + 0.35, LAND_Z),
                     (ex + side * (ESC_W / 2 + 0.04), ESC_BOT_Y - 0.35,
                      PLAT_TOP)],
                    coll=c, mat=m["skirt"], smooth_angle=math.radians(35))
            L.sweep(f"WP4_Stn_Esc{ei}_Lamp{'L' if side < 0 else 'R'}",
                    [(0.12, -0.03), (0.12, 0.03), (0.19, 0.03), (0.19, -0.03)],
                    [(ex + side * (ESC_W / 2 + 0.02), HALL_Y0 + 0.20, LAND_Z),
                     (ex + side * (ESC_W / 2 + 0.02), ESC_BOT_Y - 0.20,
                      PLAT_TOP)],
                    coll=c, mat=m["strip"], smooth_angle=math.radians(35))
            L.sweep(f"WP4_Stn_Esc{ei}_Bal{'L' if side < 0 else 'R'}",
                    [(0.22, -0.035), (0.22, 0.035), (0.92, 0.035),
                     (0.92, -0.035)],
                    [(ex + side * (ESC_W / 2 + 0.05), HALL_Y0 + 0.35, LAND_Z),
                     (ex + side * (ESC_W / 2 + 0.05), ESC_BOT_Y - 0.35,
                      PLAT_TOP)],
                    coll=c, mat=m["glass"], smooth_angle=math.radians(35))
            L.sweep(f"WP4_Stn_Esc{ei}_Hand{'L' if side < 0 else 'R'}",
                    [(0.92, -0.075), (1.06, -0.075), (1.06, 0.075),
                     (0.92, 0.075)],
                    [(ex + side * (ESC_W / 2 + 0.05), HALL_Y0 + 0.55, LAND_Z),
                     (ex + side * (ESC_W / 2 + 0.05), ESC_BOT_Y - 0.55,
                      PLAT_TOP)],
                    coll=c, mat=m["dark"], smooth_angle=math.radians(35))
    # a strip of light washing the escalator throat
    L.box("WP4_Stn_Esc_Light", (ESC_XS[1] - ESC_XS[0] + ESC_W, 0.16, 0.06),
          location=((ESC_XS[0] + ESC_XS[1]) / 2, HALL_Y0 - 0.55,
                    CONC_ROOF - 0.06), coll=c, mat=m["strip"])


# ------------------------------------------------------------- 4. the roof --
def canopy(m):
    """The hero: a diagonal lattice of coloured rhombus panels on painted tubes."""
    c = coll()
    rng = random.Random(7)
    keys = ["p" + n for n, _ in PALETTE]
    srcs = {}
    S = 3.00                              # lattice spacing
    # Two diamond lattices offset by S/2 tile the plane exactly, so the panels
    # are cut slightly OVER size: tilted panels then overlap at the seams
    # instead of opening gaps that show the black soffit at grazing angles.
    D = 3.30
    for k in keys:                        # one source mesh per colour
        bm = bmesh.new()
        # wound so the normal points DOWN — these are single-sided and the
        # visitor only ever looks up at them
        for co in ((-D / 2, 0, 0), (0, D / 2, 0), (D / 2, 0, 0), (0, -D / 2, 0)):
            bm.verts.new(co)
        bm.verts.ensure_lookup_table()
        bm.faces.new(list(bm.verts))
        src = L.bm_to_obj(bm, f"WP4_Stn_PanelSrc_{k[1:]}", c, m[k],
                          uv_scale=0.3, recalc=False)
        src.hide_render = True
        src.hide_viewport = True
        srcs[k] = src

    x0, x1 = HALL_X0 + 0.2, HALL_X1 - 0.2
    y0, y1 = HALL_Y0 - 0.4, HALL_Y1 + 0.4
    nx = int((x1 - x0) / S)
    ny = int((y0 - y1) / S)
    n = 0
    for gi in range(2):                   # two interleaved lattices
        off = 0.0 if gi == 0 else S / 2
        for i in range(nx + 1):
            for j in range(ny + 1):
                x = x0 + off + i * S
                y = y0 - off - j * S
                if x > x1 or y < y1:
                    continue
                k = keys[rng.randrange(len(keys))]
                L.inst(srcs[k], f"WP4_Stn_Panel_{gi}_{i}_{j}",
                       (x, y, PANEL_Z + rng.uniform(-0.09, 0.09)),
                       rotation=(rng.uniform(-0.055, 0.055),
                                 rng.uniform(-0.055, 0.055), 0.0),
                       coll=c)
                n += 1
    print(f"[stn] canopy: {n} panels")

    # light bars in the lattice gaps
    bar = None
    b = 0
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = x0 + S / 4 + i * S
            y = y0 - S / 4 - j * S
            if x > x1 or y < y1 or (i + j) % 2:
                continue
            if bar is None:
                bar = L.box("WP4_Stn_CanopyBarSrc", (0.90, 0.09, 0.05),
                            location=(x, y, PANEL_Z + 0.30), coll=c,
                            mat=m["strip"])
                bar.name = f"WP4_Stn_CanopyBar_{b}"
                src = bar
            else:
                L.inst(src, f"WP4_Stn_CanopyBar_{b}", (x, y, PANEL_Z + 0.30),
                       coll=c)
            b += 1
    print(f"[stn] canopy: {b} light bars")

    # painted tubes crossing the hall under the canopy
    tube_keys = ["tMagenta", "tYellow", "tBlue", "tGreen", "tRed", "tOrange"]
    runs = [
        ((-11.0, -188.5, -25.55), (7.0, -196.0, -25.90)),
        ((7.0, -190.0, -25.80), (-11.0, -199.0, -25.50)),
        ((-11.0, -201.0, -25.60), (7.0, -209.5, -25.85)),
        ((7.0, -203.0, -25.85), (-11.0, -211.5, -25.55)),
        ((-11.0, -214.0, -25.55), (7.0, -222.0, -25.85)),
        ((7.0, -216.0, -25.85), (-11.0, -224.0, -25.55)),
        ((-9.0, -189.0, -25.35), (-9.0, -224.0, -25.35)),
        ((5.2, -189.0, -25.35), (5.2, -224.0, -25.35)),
    ]
    for i, (a, b2) in enumerate(runs):
        L.tube(f"WP4_Stn_Tube_{i}", [a, b2], 0.115, segs=7, coll=c,
               mat=m[tube_keys[i % len(tube_keys)]],
               smooth_angle=math.radians(60))
    # short struts from the tubes down onto the column heads
    for i, (x, y) in enumerate(((5.40, -194.5), (5.40, -204.5), (5.40, -215.5),
                                (-8.80, -196.0), (-8.80, -209.0))):
        for s in (-1, 1):
            L.tube(f"WP4_Stn_Strut_{i}_{s}",
                   [(x, y, PANEL_Z - 0.55),
                    (x + s * 1.9, y + s * 1.4, PANEL_Z - 0.05)],
                   0.075, segs=6, coll=c,
                   mat=m[tube_keys[(i + (s > 0)) % len(tube_keys)]],
                   smooth_angle=math.radians(60))


def columns(m):
    c = coll()
    spec = ((5.40, -194.5, 1.45), (5.40, -204.5, 1.45), (5.40, -215.5, 1.15),
            (-8.80, -196.0, 1.25), (-8.80, -209.0, 1.25))
    rivet = None
    for i, (x, y, r) in enumerate(spec):
        h = PANEL_Z - 0.30 - PLAT_TOP
        L.cylinder(f"WP4_Stn_Column_{i}", r, h, segs=18,
                   location=(x, y, PLAT_TOP + h / 2), coll=c, mat=m["column"],
                   smooth_angle=math.radians(35), uv_scale=0.25)
        L.cylinder(f"WP4_Stn_ColBase_{i}", r + 0.10, 0.28, segs=18,
                   location=(x, y, PLAT_TOP + 0.14), coll=c, mat=m["conc_d"])
        L.cylinder(f"WP4_Stn_ColCap_{i}", r + 0.14, 0.32, segs=18,
                   location=(x, y, PLAT_TOP + h - 0.16), coll=c,
                   mat=m["column_b"])
        for bi, t in enumerate((0.24, 0.50, 0.76)):
            z = PLAT_TOP + h * t
            L.cylinder(f"WP4_Stn_ColBand_{i}_{bi}", r + 0.055, 0.22, segs=18,
                       location=(x, y, z), coll=c, mat=m["column_b"])
            if i > 2:            # rivets only where the visitor gets close
                continue
            for k in range(14):
                a = 2 * math.pi * k / 14
                if rivet is None:
                    rivet = L.sphere("WP4_Stn_RivetSrc", 0.045, coll=c,
                                     mat=m["column_b"], u=6, v=4)
                    rivet.hide_render = True
                    rivet.hide_viewport = True
                L.inst(rivet, f"WP4_Stn_Rivet_{i}_{bi}_{k}",
                       (x + (r + 0.06) * math.cos(a),
                        y + (r + 0.06) * math.sin(a), z), coll=c)


# --------------------------------------------------------- 5. wall surfaces --
def wall_art(m):
    """Geometric stone panelling, the station name band and the U signs."""
    c = coll()
    rng = random.Random(19)
    tones = (m["stone_a"], m["stone_b"], m["stone_c"], m["mosaic"])

    def panel_wall(tag, x, facing, y_from, y_to, z0, z1, cell=1.9):
        """A grid of slightly proud stone plates with yellow joint lines."""
        n_y = max(1, int(abs(y_to - y_from) / cell))
        n_z = max(1, int((z1 - z0) / cell))
        cy = (y_to - y_from) / n_y
        cz = (z1 - z0) / n_z
        srcs = {}
        idx = 0
        for j in range(n_y):
            for k in range(n_z):
                y = y_from + cy * (j + 0.5)
                z = z0 + cz * (k + 0.5)
                t = rng.randrange(len(tones))
                key = (t, round(cy, 3), round(cz, 3))
                loc = (x + facing * 0.035, y, z)
                if key not in srcs:
                    o = L.box(f"WP4_Stn_WallPlate_{tag}_{idx}",
                              (0.07, abs(cy) - 0.10, cz - 0.10),
                              location=loc, coll=c, mat=tones[t], uv_scale=0.3)
                    srcs[key] = o
                else:
                    L.inst(srcs[key], f"WP4_Stn_WallPlate_{tag}_{idx}", loc,
                           coll=c)
                idx += 1
        # joint lines
        for j in range(1, n_y):
            L.box(f"WP4_Stn_WallJoint_{tag}_y{j}", (0.05, 0.05, z1 - z0),
                  location=(x + facing * 0.055, y_from + cy * j, (z0 + z1) / 2),
                  coll=c, mat=m["gold"])
        for k in range(1, n_z):
            L.box(f"WP4_Stn_WallJoint_{tag}_z{k}",
                  (0.05, abs(y_to - y_from), 0.05),
                  location=(x + facing * 0.055, (y_from + y_to) / 2,
                            z0 + cz * k), coll=c, mat=m["gold"])
        return idx

    n = panel_wall("E", HALL_X1, -1, HALL_Y0 - 0.4, HALL_Y1 + 0.4,
                   PLAT_TOP + 0.1, SOFFIT_Z - 0.5)
    n += panel_wall("W", HALL_X0, 1, HALL_Y0 - 0.4, HALL_Y1 + 0.4,
                    PLAT_TOP + 0.1, SOFFIT_Z - 0.5)
    print(f"[stn] wall plates: {n}")

    # the north wall's head band — this is what the visitor faces when they
    # look back up at the stair from the platform
    idx = 0
    for i in range(8):
        x = TUNNEL_X1 + 0.35 + i * 1.22
        if x > HALL_X1 - 0.3:
            break
        tone = tones[(i * 3 + 1) % len(tones)]
        L.box(f"WP4_Stn_HeadPlate_{idx}", (1.10, 0.07, SOFFIT_Z - CONC_ROOF - 0.3),
              location=(x, HALL_Y0 - 0.035,
                        (SOFFIT_Z + CONC_ROOF) / 2 - 0.05), coll=c, mat=tone,
              uv_scale=0.3)
        idx += 1
    L.box("WP4_Stn_HeadTrim", (HALL_X1 - TUNNEL_X1, 0.09, 0.09),
          location=((TUNNEL_X1 + HALL_X1) / 2, HALL_Y0 - 0.05, CONC_ROOF + 0.10),
          coll=c, mat=m["gold"])

    # station name band along the east wall, Nuremberg style
    for i, y in enumerate((-194.0, -203.0, -212.0, -221.0)):
        L.box(f"WP4_Stn_NameBand_{i}", (0.10, 4.60, 0.90),
              location=(HALL_X1 - 0.14, y, PLAT_TOP + 2.75), coll=c,
              mat=m["sign_b"])
        t = L.text_mesh(f"WP4_Stn_NameText_{i}", "KONTAKT", font="label",
                        size=0.44, extrude=0.02, coll=c, mat=m["sign_w"],
                        rotation=(math.pi / 2, 0, -math.pi / 2))
        t.location = (HALL_X1 - 0.21, y, PLAT_TOP + 2.72)
        _slim(t)
    # platform furniture against the east wall
    seat_src = leg_src = bin_src = None
    for bi, by in enumerate((-198.6, -207.4, -216.2)):
        loc = (HALL_X1 - 0.95, by, PLAT_TOP + 0.44)
        if seat_src is None:
            seat_src = L.box("WP4_Stn_BenchSeat", (0.62, 2.20, 0.09),
                             location=loc, coll=c, mat=m["column"], bevel=0.02)
            seat_src.name = f"WP4_Stn_Bench_{bi}"
            back_src = L.box("WP4_Stn_BenchBack", (0.09, 2.20, 0.42),
                             location=(HALL_X1 - 0.66, by, PLAT_TOP + 0.68),
                             coll=c, mat=m["column"], bevel=0.02)
            back_src.name = f"WP4_Stn_BenchBack_{bi}"
            leg_src = L.box("WP4_Stn_BenchLeg", (0.55, 0.08, 0.40),
                            location=(HALL_X1 - 0.95, by - 0.9,
                                      PLAT_TOP + 0.20), coll=c, mat=m["dark"])
            leg_src.name = f"WP4_Stn_BenchLeg_{bi}_0"
            L.inst(leg_src, f"WP4_Stn_BenchLeg_{bi}_1",
                   (HALL_X1 - 0.95, by + 0.9, PLAT_TOP + 0.20), coll=c)
        else:
            L.inst(seat_src, f"WP4_Stn_Bench_{bi}", loc, coll=c)
            L.inst(back_src, f"WP4_Stn_BenchBack_{bi}",
                   (HALL_X1 - 0.66, by, PLAT_TOP + 0.68), coll=c)
            for k, dy in enumerate((-0.9, 0.9)):
                L.inst(leg_src, f"WP4_Stn_BenchLeg_{bi}_{k}",
                       (HALL_X1 - 0.95, by + dy, PLAT_TOP + 0.20), coll=c)
        loc_b = (HALL_X1 - 1.05, by + 1.75, PLAT_TOP + 0.42)
        if bin_src is None:
            bin_src = L.cylinder("WP4_Stn_Bin", 0.24, 0.84, segs=12,
                                 location=loc_b, coll=c, mat=m["dark"])
            bin_src.name = f"WP4_Stn_Bin_{bi}"
        else:
            L.inst(bin_src, f"WP4_Stn_Bin_{bi}", loc_b, coll=c)

    # the U on a pole where the stair lands
    L.cylinder("WP4_Stn_USign_Pole", 0.05, 2.60, segs=8,
               location=(3.90, -191.60, PLAT_TOP + 1.30), coll=c,
               mat=m["conc_d"])
    for s, tag in ((-1, "S"), (1, "N")):
        # s = +1 is the north face — its front normal has to point +Y, which
        # a text mesh only does after the extra Z half turn.
        L.box(f"WP4_Stn_USign_Panel_{tag}", (0.78, 0.06, 0.78),
              location=(3.90, -191.60 + s * 0.04, PLAT_TOP + 2.95), coll=c,
              mat=m["sign_b"])
        u = L.text_mesh(f"WP4_Stn_USign_U_{tag}", "U", font="label", size=0.54,
                        extrude=0.02, coll=c, mat=m["sign_w"],
                        rotation=(math.pi / 2, 0, math.pi if s > 0 else 0))
        u.location = (3.90, -191.60 + s * 0.09, PLAT_TOP + 2.78)
        _slim(u)


def fare_gates(m):
    """Two gates where the stair lands; the rotor keeps the turnstile_spin clip."""
    c = coll()
    gx, gy = 1.50, -191.60
    for side in (-1, 1):
        L.box(f"WP4_Stn_Gate_Body{side}", (0.34, 1.30, 1.00),
              location=(gx + side * 0.72, gy, PLAT_TOP + 0.50), coll=c,
              mat=m["dark"], bevel=0.04)
        L.box(f"WP4_Stn_Gate_Cap{side}", (0.40, 1.36, 0.05),
              location=(gx + side * 0.72, gy, PLAT_TOP + 1.02), coll=c,
              mat=m["chrome"])
        L.box(f"WP4_Stn_Gate_Lamp{side}", (0.05, 0.55, 0.05),
              location=(gx + side * 0.54, gy, PLAT_TOP + 0.92), coll=c,
              mat=m["strip_s"])
    rotor = L.cylinder("WP4_Turnstile_Rotor", 0.05, 1.05, segs=10,
                       location=(gx, gy, PLAT_TOP + 0.52), coll=c,
                       mat=m["chrome"])
    for k in range(3):
        ang = k * 2 * math.pi / 3
        for zi, zh in enumerate((0.30, 0.48, 0.66)):
            arm = L.cylinder(f"WP4_Turnstile_Arm{k}_{zi}", 0.022, 0.58, segs=7,
                             coll=c, mat=m["chrome"])
            arm.parent = rotor
            arm.location = (0.28 * math.cos(ang), 0.28 * math.sin(ang),
                            zh - 0.52)
            arm.rotation_euler = (0, math.pi / 2, ang)
    L.make_action(rotor, "turnstile_spin",
                  [("rotation_euler", 2, [(1, 0.0), (36, 2 * math.pi / 3)],
                    'BEZIER')])
    L.set_props(rotor, interactive_type="gate")


# ------------------------------------------------------- 6. the contact board --
BOARD_ROWS = [
    ("U1", "Yellow",  "E-MAIL SCHREIBEN",  "jetzt",   "contact"),
    ("U2", "Red",     "RESEARCHGATE",      "2 min",   "researchgate"),
    ("U3", "Blue",    "HINTERSTUBE",       "5 min",   "hinterstube"),
    ("U4", "Green",   "KENOPSIUM",         "8 min",   "kenopsium"),
    ("U5", "Magenta", "MEHR — BALD",       "--",      "soon1"),
]


def board(m):
    """A suspended departure board whose rows are the real links."""
    c = coll()
    # Placed off the `contact` framing, not by eye: from cam_wp4_contact the
    # whole board sits between 3° and 34° left of the view axis, opposite the
    # DT1's nose at 34° right, with ~5° of margin to the frame edge at the
    # web camera's 85° horizontal field.
    BX, BY, BZ = 2.90, -200.20, PLAT_TOP + 3.25     # centre of the face
    W, H, D = 3.80, 2.35, 0.22
    root = L.empty("WP4_Board_Root", (BX, BY, BZ), coll=c, size=0.4,
                   rotation=(0, 0, math.pi))
    # rotation pi so the face (local -Y) looks towards +Y, i.e. at a visitor
    # coming down the stair

    def part(obj, loc, rot=(0, 0, 0)):
        obj.parent = root
        obj.location = loc
        obj.rotation_euler = rot
        return obj

    part(L.box("WP4_Board_Case", (W, D, H), coll=c, mat=m["board"], bevel=0.03),
         (0, 0, 0))
    part(L.box("WP4_Board_Face", (W - 0.14, 0.04, H - 0.14), coll=c,
               mat=m["board_f"]), (0, -D / 2 - 0.01, 0))
    for sx in (-1, 1):
        part(L.box(f"WP4_Board_Rib{'L' if sx < 0 else 'R'}",
                   (0.08, D + 0.06, H), coll=c, mat=m["chrome"]),
             (sx * (W / 2 - 0.02), 0, 0))
    # hanger rods up to the canopy
    for sx in (-1, 1):
        part(L.cylinder(f"WP4_Board_Rod{'L' if sx < 0 else 'R'}", 0.035,
                        PANEL_Z - 0.35 - (BZ + H / 2), segs=8, coll=c,
                        mat=m["dark"]),
             (sx * 1.25, 0, H / 2 + (PANEL_Z - 0.35 - (BZ + H / 2)) / 2))
    # header
    part(L.box("WP4_Board_Header", (W - 0.14, 0.05, 0.40), coll=c,
               mat=m["sign_b"]), (0, -D / 2 - 0.03, H / 2 - 0.30))
    ht = L.text_mesh("WP4_Board_HeaderText", "ABFAHRT", font="label",
                     size=0.21, extrude=0.012, coll=c, mat=m["sign_w"],
                     rotation=(math.pi / 2, 0, 0))
    _slim(part(ht, (0.30, -D / 2 - 0.07, H / 2 - 0.30)))
    ut = L.text_mesh("WP4_Board_HeaderU", "U", font="label", size=0.26,
                     extrude=0.012, coll=c, mat=m["sign_w"],
                     rotation=(math.pi / 2, 0, 0))
    _slim(part(ut, (W / 2 - 0.30, -D / 2 - 0.07, H / 2 - 0.30)))

    row_h = 0.34
    y_top = H / 2 - 0.60
    for i, (line, colour, dest, when, link) in enumerate(BOARD_ROWS):
        z = y_top - i * row_h - row_h / 2
        plate = part(L.box(f"WP4_Board_Row{i}", (W - 0.22, 0.035, row_h - 0.045),
                           coll=c, mat=m["board_f"]), (0, -D / 2 - 0.045, z))
        L.set_props(plate, interactive_type="link", link_id=link)
        part(L.box(f"WP4_Board_Badge{i}", (0.40, 0.03, row_h - 0.10), coll=c,
                   mat=m["p" + colour]), (-W / 2 + 0.34, -D / 2 - 0.065, z))
        bt = L.text_mesh(f"WP4_Board_BadgeText{i}", line, font="label",
                         size=0.155, extrude=0.008, coll=c, mat=m["board_f"],
                         rotation=(math.pi / 2, 0, 0))
        _slim(part(bt, (-W / 2 + 0.34, -D / 2 - 0.085, z)))
        dt = L.text_mesh(f"WP4_Board_DestText{i}", dest, font="matrix",
                         size=0.185, extrude=0.008, coll=c, mat=m["board_t"],
                         align_x='LEFT', rotation=(math.pi / 2, 0, 0))
        _slim(part(dt, (-W / 2 + 0.64, -D / 2 - 0.075, z)))
        wt = L.text_mesh(f"WP4_Board_WhenText{i}", when, font="matrix",
                         size=0.165, extrude=0.008, coll=c, mat=m["board_d"],
                         align_x='RIGHT', rotation=(math.pi / 2, 0, 0))
        _slim(part(wt, (W / 2 - 0.20, -D / 2 - 0.075, z)))

    # the back of the case is seen down the whole platform, so it gets the
    # station's own name rather than a blank slab
    part(L.box("WP4_Board_BackBand", (W - 0.14, 0.05, 0.55), coll=c,
               mat=m["sign_b"]), (0, D / 2 + 0.03, 0.15))
    bt = L.text_mesh("WP4_Board_BackText", "KONTAKT", font="label", size=0.32,
                     extrude=0.012, coll=c, mat=m["sign_w"],
                     rotation=(math.pi / 2, 0, math.pi))
    _slim(part(bt, (0, D / 2 + 0.07, 0.15)))

    # --- the analog clock, hung off the board's east rib --------------------
    # Sizes are load-bearing: interactions.js re-pivots the three hands with
    # hardcoded lengths (0.09 / 0.13 / 0.15) and face offsets, so the face
    # radius and the hand boxes must stay exactly as they are here.
    clock = part(L.cylinder("WP4_Clock_Body", 0.42, 0.12, segs=20, coll=c,
                            mat=m["dark"]),
                 (W / 2 + 0.52, 0, 0.30), (math.pi / 2, 0, 0))
    face = L.cylinder("WP4_Clock_Face", 0.36, 0.02, segs=20, coll=c,
                      mat=m["clock_f"])
    face.parent = clock
    face.location = (0, 0, 0.065)      # +Z is the viewer's side of the body
    tick = L.box("WP4_Clock_Tick", (0.025, 0.07, 0.012), coll=c,
                 mat=m["clock_h"])
    tick.hide_render = True
    tick.hide_viewport = True
    for h in range(12):
        a = h * math.pi / 6
        t = L.inst(tick, f"WP4_Clock_Tick_{h}", (0, 0, 0), coll=c)
        t.parent = face
        t.location = (0.29 * math.sin(a), 0.29 * math.cos(a), 0.02)
        t.rotation_euler = (0, 0, -a)
    for name, size, z, mat in (
            ("WP4_Clock_Hour", (0.035, 0.18, 0.014), 0.035, m["clock_h"]),
            ("WP4_Clock_Minute", (0.028, 0.26, 0.012), 0.050, m["clock_h"]),
            ("WP4_Clock_Second", (0.012, 0.30, 0.010), 0.065, m["clock_s"])):
        hand = L.box(name, size, coll=c, mat=mat)
        hand.parent = face
        hand.location = (0, 0, z)
        L.set_props(hand, interactive_type="clock_hand")


# ---------------------------------------------------------------- 7. lights --
def lighting(m):
    """Six lamps for the whole hall — the runtime pool tops out around nine."""
    c = coll()
    spec = [
        ("WP4_Stn_Lamp_North", (1.20, -191.00, PANEL_Z - 1.10),
         620.0, (0.98, 0.94, 0.86), 34.0, 26.0),
        ("WP4_Stn_Lamp_Mid", (0.60, -202.00, PANEL_Z - 1.10),
         620.0, (0.96, 0.94, 0.90), 34.0, 28.0),
        ("WP4_Stn_Lamp_South", (0.00, -215.00, PANEL_Z - 1.10),
         520.0, (0.94, 0.94, 0.94), 28.0, 26.0),
        ("WP4_Stn_Lamp_Board", (2.90, -199.00, PLAT_TOP + 4.30),
         190.0, (1.00, 0.92, 0.78), 12.0, 10.0),
        # the mine concourse: without this the visitor walks out of the shaft
        # into a black box and only sees the hall through the doorway
        ("WP4_Stn_Lamp_Concourse", (1.40, -185.60, CONC_ROOF - 0.55),
         170.0, (1.00, 0.94, 0.84), 11.0, 10.0),
    ]
    for name, loc, energy, col, wi, wd in spec:
        li = bpy.data.lights.new(name, type='POINT')
        li.energy = energy
        li.color = col
        lo = bpy.data.objects.new(name, li)
        lo.location = loc
        L.link(lo, c)
        L.set_props(lo, web_intensity=wi, web_distance=wd, web_decay=1.6)
    # the two fills sky_and_light.py owns move with the hall
    for name, loc, wi, wd in (
            ("WP4_Fill_Vault", (-1.0, -203.0, PANEL_Z - 3.4), 24.0, 44.0),
            ("WP4_Fill_Rim", (-8.5, -200.0, PLAT_TOP + 3.0), 12.0, 24.0)):
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        o.location = loc
        L.set_props(o, web_intensity=wi, web_distance=wd)


# ----------------------------------------------------------- 8. camera rail --
def _path_controls(samples):
    """Control points for the re-authored stretch, in camera-eye space."""
    EYE = 1.60
    g0, g1 = samples[START_IDX - 2], samples[START_IDX - 1]
    head = samples[START_IDX]
    pts = [tuple(g0), tuple(g1), tuple(head)]
    pts += [
        (0.06, -184.90, LAND_Z + EYE + 0.06),      # onto the concourse slab
        (0.30, -185.90, LAND_Z + EYE),
        (0.95, -186.70, LAND_Z + EYE),             # swinging onto the stair
        (1.42, HALL_Y0 - 0.10, LAND_Z + EYE),      # the top nosing
        (1.50, HALL_Y0 - 1.30, stair_floor(HALL_Y0 - 1.30) + EYE),
        (1.50, HALL_Y0 - 2.60, stair_floor(HALL_Y0 - 2.60) + EYE),
        (1.50, STAIR_BOT_Y - 0.35, PLAT_TOP + EYE),
        (1.50, -191.60, PLAT_TOP + 1.56),          # through the fare gate
        (1.50, CONTACT_POS[1], PLAT_TOP + 1.55),   # cam_wp4_contact
        (1.35, -196.60, PLAT_TOP + 1.55),
        (1.00, -199.60, PLAT_TOP + 1.55),
        (0.30, -201.60, PLAT_TOP + 1.54),          # turning towards door 1
        (-0.95, -202.90, PLAT_TOP + 1.52),
        (-2.30, DOOR1_Y - 0.15, PLAT_TOP + 1.48),  # in the doorway
        (-3.40, -204.40, SEAT[2] - 0.02),
        (-3.95, -205.10, SEAT[2]),
        SEAT,
    ]
    return pts


def _quats(samples, ahead=6):
    """Track quats from the forward tangent, sign-continuous for clean slerps."""
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


def _settle(quats, axis, count):
    """Ease the last `count` quats onto an exact look direction."""
    target = Vector(axis).normalized().to_track_quat('-Z', 'Y')
    n = len(quats)
    for k in range(count):
        i = n - 1 - k
        w = L.smoothstep(0.0, 1.0, 1.0 - k / count)
        t = target.copy()
        if quats[i].dot(t) < 0:
            t.negate()
        quats[i] = quats[i].slerp(t, w)
    return quats


def camera_rail():
    """Re-author samples START_IDX..CUT_IDX; everything else is left alone."""
    src = os.path.join(OUT, "cam_path.json")
    with open(src, encoding="utf-8") as fh:
        data = json.load(fh)
    samples = [Vector(s["p"]) for s in data["samples"]]
    quats = [s["q_wxyz"] for s in data["samples"]]
    n = len(samples)
    assert data["cut"] == CUT_IDX, f"unexpected cut {data['cut']}"

    ctrl = _path_controls(samples)
    SPS = 14
    dense = L.catmull_rom(ctrl, closed=False, samples_per_seg=SPS)
    dense = dense[2 * SPS:]              # drop the two tangent ghosts
    count = CUT_IDX - START_IDX + 1
    cum = [0.0]
    for a, b in zip(dense, dense[1:]):
        cum.append(cum[-1] + (b - a).length)
    total = cum[-1]
    new = []
    j = 0
    for i in range(count):
        s = total * i / (count - 1)
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j]
        t = (s - cum[j]) / seg if seg > 1e-9 else 0.0
        new.append(dense[j].lerp(dense[j + 1], t))
    step = total / (count - 1)
    print(f"[cam] re-authored {count} samples over {total:.1f} m "
          f"({step:.3f} m/sample)")

    for i, p in enumerate(new):
        samples[START_IDX + i] = p

    # quats: recompute path A from a little before the edit so the look-ahead
    # never straddles the old and the new geometry, then settle onto the car
    # axis for the seat — the teleport hands that framing to the plaza car.
    qa = _quats(samples[:CUT_IDX + 1])
    _settle(qa, (0, -1, 0), 7)
    for i in range(START_IDX - 10, CUT_IDX + 1):
        q = qa[i]
        quats[i] = [round(q.w, 5), round(q.x, 5), round(q.y, 5), round(q.z, 5)]

    # --- anchors ------------------------------------------------------------
    contact = bpy.data.objects["cam_wp4_contact"]
    contact.location = CONTACT_POS
    contact.rotation_euler = L.look_at_rotation(CONTACT_POS, CONTACT_LOOK)
    bpy.context.view_layer.update()
    anchors = dict(data["waypoints"])
    for emp in bpy.data.objects:
        wp = emp.get("camera_waypoint")
        if not wp:
            continue
        loc = Vector(emp.matrix_world.translation)
        rng = range(n) if wp not in ("contact", "contact_inside") \
            else range(START_IDX, CUT_IDX + 1)
        best = min(rng, key=lambda i: (samples[i] - loc).length_squared)
        u = best / n
        L.set_props(emp, path_u=round(u, 5), path_frame=int(u * FRAMES) + 1)
        anchors[wp] = round(u, 5)
    print(f"[cam] anchors: {anchors}")
    assert anchors["contact_inside"] == round(CUT_IDX / n, 5), \
        "the seat must stay on the teleport cut"

    # --- the editable curve -------------------------------------------------
    old = bpy.data.objects.get("Cam_Path_Curve")
    props = {k: old[k] for k in old.keys()} if old else {}
    if old:
        cd_old = old.data
        _rm(old)
        try:
            bpy.data.curves.remove(cd_old)
        except (ReferenceError, RuntimeError):
            pass
    cd = bpy.data.curves.new("Cam_Path_Curve", type='CURVE')
    cd.dimensions = '3D'
    for part in (samples[:CUT_IDX + 1], samples[CUT_IDX + 1:]):
        sp = cd.splines.new('POLY')
        stp = max(1, len(part) // 200)
        pts = part[::stp]
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            sp.points[i].co = (p.x, p.y, p.z, 1.0)
    curve_obj = bpy.data.objects.new("Cam_Path_Curve", cd)
    L.link(curve_obj, L.collection("CAM_Rig"))
    L.set_props(curve_obj, **(props or {"path_role": "camera_rail", "loop": 1,
                                        "teleport_cut": CUT_IDX}))

    # --- rebake Cam_Main ----------------------------------------------------
    import mathutils
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
        cam.rotation_quaternion = mathutils.Quaternion(quats[idx])
        cam.keyframe_insert(data_path="location", frame=k + 1)
        cam.keyframe_insert(data_path="rotation_quaternion", frame=k + 1)
        if first is None:
            first = (samples[idx].copy(),
                     mathutils.Quaternion(quats[idx]).copy())
    for fc in L.action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    track = ad.nla_tracks.new()
    track.name = "cam_fly_through"
    strip = track.strips.new("cam_fly_through", 2, act)
    strip.extrapolation = 'NOTHING'
    ad.action = None
    cam.location, cam.rotation_quaternion = first

    seg = [(samples[i + 1] - samples[i]).length
           for i in range(n - 1) if i != CUT_IDX]
    data["waypoints"] = anchors
    data["length_m"] = round(sum(seg), 1)
    data["samples"] = [{"p": [round(v, 3) for v in samples[i]],
                        "q_wxyz": quats[i]} for i in range(n)]
    with open(src, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    print(f"[cam] wrote cam_path.json (segment min {min(seg):.3f} "
          f"max {max(seg):.3f} m)")
    return anchors


# ---------------------------------------------------------------- 9. hygiene --
def hygiene():
    """Findings from the audit of world.blend that are safe to fix here."""
    # 1. instancing sources left visible 400 m under the garden — they export
    #    and drag the shadow box down with them.
    for name in ("WP2_Cypress", "WP2_Tree_Canopy"):
        o = bpy.data.objects.get(name)
        if o and o.matrix_world.translation.z < -100 and not o.hide_render:
            o.hide_render = True
            o.hide_viewport = True
            print(f"[hyg] hid stray instancing source {name}")
    # 2. a stale .001 duplicate sitting inside its own original
    dup = bpy.data.objects.get("WP2_FallsBoulder_L_0.001")
    if dup:
        _rm(dup)
        print("[hyg] removed WP2_FallsBoulder_L_0.001")
    # 3. the KONTAKT destination sign is 12 672 polygons of flat letter face,
    #    on a 58 cm sign, shared by four nodes. Limited dissolve keeps the
    #    silhouette exactly and gives the biggest single win in the file.
    done = set()
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.name.startswith("DT1_") \
                or "DestText" not in o.name:
            continue
        if o.data.name in done:
            continue
        before = len(o.data.polygons)
        _slim(o, math.radians(1.0))
        done.add(o.data.name)
        print(f"[hyg] {o.name}: {before} -> {len(o.data.polygons)} polys")
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name == "WP3_Text_UeberMich":
            before = len(o.data.polygons)
            _slim(o, math.radians(1.0))
            print(f"[hyg] {o.name}: {before} -> {len(o.data.polygons)} polys")


# ------------------------------------------------------------------- shots --
def shots(outdir, tag="v1"):
    os.makedirs(outdir, exist_ok=True)
    scn = bpy.context.scene
    engines = [e.identifier for e in
               scn.render.bl_rna.properties['engine'].enum_items]
    scn.render.engine = ('BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines
                         else 'BLENDER_EEVEE')
    scn.render.resolution_x = 1280
    scn.render.resolution_y = 720
    if hasattr(scn, "eevee"):
        for attr, val in (("taa_render_samples", 24), ("use_raytracing", False)):
            if hasattr(scn.eevee, attr):
                setattr(scn.eevee, attr, val)
    cavern = bpy.data.worlds.get("Sky_WP4_Cavern")
    keep_world = scn.world
    if cavern:
        scn.world = cavern
    cd = bpy.data.cameras.new("ShotCam")
    cd.sensor_fit = 'HORIZONTAL'
    cd.sensor_width = 36.0
    cd.lens = 19.5                    # == the web camera's 55 deg vertical @16:9
    cd.clip_start = 0.05
    cd.clip_end = 600
    cam = bpy.data.objects.new("ShotCam", cd)
    scn.collection.objects.link(cam)
    old_cam = scn.camera
    scn.camera = cam

    with open(os.path.join(OUT, "cam_path.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    import mathutils
    S = data["samples"]

    def at(i):
        q = mathutils.Quaternion(S[i]["q_wxyz"])
        return Vector(S[i]["p"]), q.to_euler()

    named = [
        ("a_shaft", at(572)),
        ("b_mouth", at(580)),
        ("c_landing", at(584)),
        ("d_stairtop", at(588)),
        ("e_stair", at(593)),
        ("f_stairfoot", at(599)),
        ("h_walk", at(610)),
        ("i_turn", at(624)),
        ("j_door", at(634)),
    ]
    emp = bpy.data.objects["cam_wp4_contact"]
    named.append(("g_contact_pose",
                  (emp.location.copy(), emp.rotation_euler.copy())))
    for name, eye, tgt in (
            ("w_hall", (6.5, -189.0, -25.6), (-3.0, -208.0, -30.0)),
            ("x_across", (-9.5, -196.0, -28.4), (5.0, -200.0, -29.6)),
            ("y_board", (0.9, -197.4, -29.2), (2.9, -200.2, -27.7)),
            ("z_south", (2.0, -218.0, -29.4), (0.0, -196.0, -28.6)),
            ("s_stairback", (2.2, -196.0, -29.4), (1.4, -187.5, -27.6)),
            ("t_escalator", (2.8, -194.5, -29.4), (5.5, -188.5, -28.2)),
            ("u_canopy", (0.9, -202.0, -29.4), (0.5, -208.0, -25.0)),
            ("v_railend", (0.0, -181.5, -27.6), (0.4, -186.5, -28.6))):
        named.append((name, (eye, L.look_at_rotation(eye, tgt))))
    for name, (loc, rot) in named:
        cam.location = loc
        cam.rotation_euler = rot
        scn.render.filepath = os.path.join(outdir, f"{tag}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("[shot]", scn.render.filepath)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)
    scn.camera = old_cam
    scn.world = keep_world


# ------------------------------------------------------------------- driver --
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    L._mat_cache.clear()
    purge()
    m = mats()
    trim_mine_track()
    move_train()
    station_track(m)
    hall_shell(m)
    concourse(m)
    canopy(m)
    columns(m)
    wall_art(m)
    fare_gates(m)
    board(m)
    lighting(m)
    hygiene()
    camera_rail()

    bpy.context.scene.frame_set(1)
    n_tri = 0
    for o in bpy.data.objects:
        if o.type == 'MESH' and not o.hide_render:
            o.data.calc_loop_triangles()
            n_tri += len(o.data.loop_triangles)
    print(f"[stn] scene now: {len(bpy.data.objects)} objects, ~{n_tri} triangles")

    if "--save" in argv:
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if "--export" in argv:
        exporter.export_glb(os.path.join(OUT, "world.glb"))
    if "--shots" in argv:
        tag = argv[argv.index("--shots") + 1] if len(argv) > argv.index("--shots") + 1 \
            and not argv[argv.index("--shots") + 1].startswith("--") else "v1"
        shots(os.path.join(OUT, "wp4_shots"), tag)


if __name__ == "__main__":
    main()
