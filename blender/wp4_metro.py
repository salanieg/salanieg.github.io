# ============================================================================
# wp4_metro.py — WAYPOINT 4: THE SUBTERRANEAN METRO CAVERN (y ≈ -200, z ≈ -30).
#
# Behind the saloon a slot canyon reaches a timbered mine portal; the shaft
# spirals down along a mine-cart track into a huge cavern holding a U-Bahn
# platform: turnstile (action "turnstile_spin"), a toppled split-flap display
# board with an analog clock, and the Nuremberg DT1 two-car unit — VAG red /
# white livery matching src/simulator/TrainModel.js (18.575 m cars, 2.90 m
# wide), glowing headlamps, Doto "KONTAKT" destination sign, sliding doors
# with "doors_open"/"doors_close" actions and a benches-and-poles interior.
# A dark transit tunnel loops from the cavern back up to the atrium plaza.
# Anchors: cam_wp4_contact, cam_wp4_inside_train.
# ============================================================================
import math

import bpy
from mathutils import Vector

import lib_common as L

RAIL_HALF = 0.7175          # standard gauge
RAIL_TOP = 0.25             # railhead height above track datum
TRACK_CTRL = [
    (0.0, -138.5, -10.05), (0.0, -143.0, -10.6), (-1.8, -151.0, -14.2),
    (-2.6, -160.0, -19.4), (-1.4, -169.0, -24.2), (0.0, -178.0, -27.6),
    (0.0, -185.0, -29.4), (0.0, -191.0, -30.2), (0.0, -252.0, -30.2),
]
TRAIN_FRONT_Y = -200.5
PLATFORM_TOP = -28.95
CAR_LEN = 18.575
CAR_W = 2.90

BODY_RED = (0.545, 0.082, 0.075)
BODY_WHITE = (0.882, 0.898, 0.914)


def _mats():
    return {
        "rock":    L.material("Cavern_Rock", (0.30, 0.28, 0.27), rough=1.0,
                              double_sided=True),
        "rock_d":  L.material("Tunnel_Rock_Dark", (0.10, 0.10, 0.11), rough=1.0,
                              double_sided=True),
        "timber":  L.material("Mine_Timber", (0.35, 0.27, 0.19), rough=0.9),
        "gravel":  L.material("Track_Ballast", (0.22, 0.21, 0.20), rough=1.0),
        "steel":   L.material("Rail_Steel", (0.55, 0.55, 0.58), rough=0.35,
                              metal=1.0),
        "sleeper": L.material("Track_Sleeper", (0.25, 0.20, 0.16), rough=0.95),
        "conc":    L.material("Platform_Concrete", (0.52, 0.51, 0.50), rough=0.9),
        "conc_d":  L.material("Platform_Concrete_Dark", (0.38, 0.38, 0.37),
                              rough=0.9),
        "white":   L.material("Platform_EdgeLine", (0.85, 0.85, 0.82), rough=0.7),
        "tactile": L.material("Platform_Tactile", (0.72, 0.68, 0.40), rough=0.9),
        "red":     L.material("DT1_Body_Red", BODY_RED, rough=0.35),
        "white_b": L.material("DT1_Band_White", BODY_WHITE, rough=0.35),
        "roof":    L.material("DT1_Roof", (0.35, 0.39, 0.37), rough=0.6),
        "glass":   L.material("DT1_Glass", (0.12, 0.16, 0.20), rough=0.06,
                              metal=0.2, alpha=0.35),
        "under":   L.material("DT1_Underframe", (0.12, 0.12, 0.13), rough=0.9),
        "rubber":  L.material("DT1_Door_Rubber", (0.20, 0.21, 0.23), rough=0.9),
        "lamp":    L.material("DT1_Headlamp", (1.0, 0.95, 0.85), rough=0.3,
                              emit=(1.0, 0.92, 0.75), emit_str=18.0),
        "marker":  L.material("DT1_Marker_Red", (0.9, 0.1, 0.05), rough=0.3,
                              emit=(1.0, 0.1, 0.05), emit_str=4.0),
        "sign":    L.material("DT1_DestSign", (0.06, 0.05, 0.04), rough=0.6),
        "sign_t":  L.material("DT1_DestText", (1.0, 0.65, 0.15), rough=0.5,
                              emit=(1.0, 0.62, 0.12), emit_str=10.0),
        "seat":    L.material("DT1_Seat_Blue", (0.10, 0.15, 0.30), rough=0.8),
        "wood_i":  L.material("DT1_Interior_Wood", (0.55, 0.42, 0.25), rough=0.6),
        "beige":   L.material("DT1_Ceiling_Beige", (0.62, 0.53, 0.40), rough=0.8),
        "pole":    L.material("DT1_Handrail_Gold", (0.72, 0.6, 0.38), rough=0.35,
                              metal=1.0),
        "strip":   L.material("DT1_LightStrip", (1.0, 0.97, 0.88), rough=0.6,
                              emit=(1.0, 0.95, 0.85), emit_str=6.0),
        "board":   L.material("Board_Housing", (0.13, 0.14, 0.16), rough=0.6),
        "flap":    L.material("Board_Flap", (0.05, 0.05, 0.06), rough=0.5),
        "flap_t":  L.material("Board_Flap_Lit", (0.95, 0.93, 0.85), rough=0.6,
                              emit=(1.0, 0.97, 0.85), emit_str=3.0),
        "clock_f": L.material("Clock_Face", (0.94, 0.94, 0.90), rough=0.7,
                              emit=(1.0, 1.0, 0.95), emit_str=1.2),
        "clock_h": L.material("Clock_Hands", (0.08, 0.08, 0.08), rough=0.5),
        "clock_s": L.material("Clock_Second", (0.85, 0.1, 0.08), rough=0.5),
        "chrome":  L.material("Turnstile_Chrome", (0.75, 0.76, 0.78), rough=0.2,
                              metal=1.0),
    }


# ------------------------------------------------------------------- track --
def _track_samples():
    return L.catmull_rom(TRACK_CTRL, closed=False, samples_per_seg=10)


def _lateral(a, b):
    t = (b - a)
    t.z = 0
    if t.length < 1e-6:
        t = Vector((0, -1, 0))
    t.normalize()
    return Vector((-t.y, t.x, 0))


def _track(coll, m):
    pts = _track_samples()
    # sweep frames put u on the transported normal (≈ vertical for a mostly
    # horizontal path) and v on the binormal (lateral) — profiles are (up, side)
    bed_prof = [(0.0, -2.1), (0.0, 2.1), (0.42, 1.6), (0.42, -1.6)]
    ballast_pts = [p for p in pts if p.y >= -185.0]
    L.sweep("WP4_Track_Ballast", bed_prof, [(p.x, p.y, p.z - 0.28) for p in ballast_pts],
            coll=coll, mat=m["gravel"], smooth_angle=math.radians(50))
    for side, tag in ((-1, "W"), (1, "E")):
        rail_pts = []
        for i, p in enumerate(pts):
            a = pts[max(i - 1, 0)]
            b = pts[min(i + 1, len(pts) - 1)]
            lat = _lateral(a, b)
            rail_pts.append(p + lat * (side * RAIL_HALF)
                            + Vector((0, 0, RAIL_TOP - 0.07)))
        L.sweep(f"WP4_Rail_{tag}",
                [(-0.07, -0.035), (-0.07, 0.035), (0.07, 0.035), (0.07, -0.035)],
                rail_pts, coll=coll, mat=m["steel"],
                smooth_angle=math.radians(30))
    sleeper = L.box("WP4_Sleeper", (2.1, 0.24, 0.12), location=(0, 0, -400),
                    coll=coll, mat=m["sleeper"])
    sleeper.hide_render = True
    sleeper.hide_viewport = True
    dense, total = L.resample_arclength(pts, int(sum(
        (b - a).length for a, b in zip(pts, pts[1:])) / 0.85))
    for i, p in enumerate(dense):
        a = dense[max(i - 1, 0)]
        b = dense[min(i + 1, len(dense) - 1)]
        ang = math.atan2((b - a).y, (b - a).x) + math.pi / 2
        L.inst(sleeper, f"WP4_Sleeper_{i}", (p.x, p.y, p.z + 0.06),
               rotation=(0, 0, ang), coll=coll)


def _shaft_and_cavern(coll, m, ctx):
    # the tube starts behind the timber portal (an entry collar bridges the
    # gap) and pushes through the carved cavern-wall opening at the bottom
    pts = [p for p in _track_samples() if -184.2 < p.y < -143.5]
    shaft_pts = [Vector((p.x, p.y, p.z + 1.9)) for p in pts]
    L.tube("WP4_Mine_Shaft", shaft_pts, 3.3, segs=10, coll=coll,
           mat=m["rock_d"], cap=False, smooth_angle=math.radians(80))
    # entry collar: timber-lined box tunnel from the portal to the tube mouth
    for side in (-1, 1):
        L.box(f"WP4_EntryCollar_Wall{side}", (0.5, 4.6, 4.2),
              location=(side * 2.0, -142.6, -8.2), coll=coll, mat=m["rock_d"])
    L.box("WP4_EntryCollar_Roof", (4.5, 4.6, 0.5),
          location=(0, -142.6, -6.3), coll=coll, mat=m["rock_d"])
    L.box("WP4_EntryCollar_Floor", (4.5, 4.6, 0.4),
          location=(0, -142.6, -10.7), coll=coll, mat=m["rock_d"])
    # timber support frames along the shaft
    post = L.box("WP4_ShaftPost", (0.24, 0.24, 3.4), location=(0, 0, -400),
                 coll=coll, mat=m["timber"])
    lintel = L.box("WP4_ShaftLintel", (3.4, 0.26, 0.28), location=(0, 0, -400),
                   coll=coll, mat=m["timber"])
    post.hide_render = True
    post.hide_viewport = True
    lintel.hide_render = True
    lintel.hide_viewport = True
    lantern_glow = L.material("Lantern_Glow", (1.0, 0.75, 0.4), rough=0.4,
                              emit=(1.0, 0.66, 0.3), emit_str=7.0)
    lantern_body = L.material("Lantern_Body", (0.15, 0.13, 0.11), rough=0.6,
                              metal=0.6)
    for li, i in enumerate(range(2, len(pts) - 4, 7)):
        p = pts[i]
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        lat = _lateral(a, b)
        ang = math.atan2(lat.y, lat.x)
        for side in (-1, 1):
            q = p + lat * (side * 1.55)
            L.inst(post, f"WP4_ShaftPost_{i}_{side}", (q.x, q.y, p.z + 1.7),
                   rotation=(0, 0, ang), coll=coll)
        L.inst(lintel, f"WP4_ShaftLintel_{i}", (p.x, p.y, p.z + 3.35),
               rotation=(0, 0, ang), coll=coll)
        # swaying lantern hooked under the lintel (JS animates the pivot)
        hook = p + lat * ((1.0 if li % 2 else -1.0))
        pivot = L.empty(f"WP4_Lantern_{li}", (hook.x, hook.y, p.z + 3.2),
                        coll=coll, size=0.2, props={"sway": 1})
        chain = L.cylinder(f"WP4_Lantern_{li}_Chain", 0.012, 0.28, segs=5,
                           coll=coll, mat=lantern_body)
        chain.parent = pivot
        chain.location = (0, 0, -0.14)
        body = L.cylinder(f"WP4_Lantern_{li}_Body", 0.075, 0.2, segs=8,
                          radius2=0.055, coll=coll, mat=lantern_body)
        body.parent = pivot
        body.location = (0, 0, -0.38)
        glow = L.sphere(f"WP4_Lantern_{li}_Glow", 0.05, coll=coll,
                        mat=lantern_glow, u=8, v=6)
        glow.parent = pivot
        glow.location = (0, 0, -0.38)
    cavern = L.rock("WP4_Cavern_Shell", 37.0, (0, -214.0, -14.0), coll=coll,
                    mat=m["rock"], seed=6, rough=0.28, subdiv=3, squash=0.55)
    # carve the station portal where the shaft meets the shell
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(cavern.data)
    hole_local = Vector((0, -187.0, -27.5)) - Vector(cavern.location)
    doomed = [f for f in bm.faces
              if (f.calc_center_median() - hole_local).length < 8.5]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(cavern.data)
    bm.free()
    ring_path = L.arc_points((0.0, -27.4), 4.1, 0.0, 2 * math.pi, 18,
                             plane='XZ', y=-187.2)[:-1]
    L.sweep("WP4_Station_Portal", [(-0.45, -0.4), (0.45, -0.4),
                                   (0.45, 0.4), (-0.45, 0.4)],
            ring_path, coll=coll, mat=m["conc"], closed_path=True, cap=False,
            smooth_angle=math.radians(30))
    floor = L.heightfield(
        "WP4_Cavern_Floor", (0, -216), (95, 80), (46, 40),
        lambda x, y: -30.6 + 0.8 * L.fractal2d(x, y, 0.05, 3, 21.0)
        * L.smoothstep(4.0, 12.0, abs(x))
        + 0.5 * L.smoothstep(26.0, 40.0, math.hypot(x, y + 216)),
        coll=coll, mat=m["rock"], uv_scale=0.12)
    ctx["lightmap"].append(floor)
    stal = L.rock("WP4_Stalactite", 1.0, (0, 0, -400), coll=coll, mat=m["rock"],
                  seed=8, rough=0.3, squash=3.2, subdiv=2)
    stal.hide_render = True
    stal.hide_viewport = True
    spots = [(-14, -198, -6), (10, -192, -5), (-8, -226, -3), (16, -224, -5),
             (-18, -212, -4), (7, -237, -6), (-3, -190, -8), (20, -207, -7),
             (-12, -238, -5), (13, -213, -2)]
    for i, (x, y, zt) in enumerate(spots):
        L.inst(stal, f"WP4_Stalactite_{i}", (x, y, zt),
               rotation=(math.pi, 0, i * 0.9), scale=0.6 + (i % 3) * 0.35,
               coll=coll)
    for i, (x, y) in enumerate(((-16, -206), (12, -230), (-10, -195),
                                (18, -216))):
        L.inst(stal, f"WP4_Stalagmite_{i}", (x, y, -31.0),
               rotation=(0, 0, i * 1.4), scale=0.5 + (i % 2) * 0.3, coll=coll)


def _portal(coll, m):
    py = -140.6
    for k, off in enumerate((0.0, -1.1)):
        for side in (-1, 1):
            L.box(f"WP4_Portal_Post_{k}_{side}", (0.3, 0.3, 3.6),
                  location=(side * 1.75, py + off, -10.0 + 1.5), coll=coll,
                  mat=m["timber"], rotation=(0, side * 0.05, 0))
        L.box(f"WP4_Portal_Lintel_{k}", (4.1, 0.34, 0.34),
              location=(0, py + off, -10.0 + 3.3), coll=coll, mat=m["timber"])
    L.box("WP4_Portal_Sign", (2.2, 0.1, 0.5), location=(0, py + 0.25, -6.35),
          coll=coll, mat=m["timber"], rotation=(0.1, 0, 0))
    for i, (x, z) in enumerate(((-2.7, -9.8), (2.7, -9.7))):
        L.inst(_boulder(coll, m), f"WP4_Portal_Rock_{i}",
               (x, py + 0.4, z), rotation=i * 1.2, scale=0.9 + i * 0.3,
               coll=coll)


_boulder_src = None


def _boulder(coll, m):
    global _boulder_src
    if _boulder_src is None:
        _boulder_src = L.rock("WP4_Boulder", 0.9, (0, 0, -400), coll=coll,
                              mat=m["rock"], seed=4, rough=0.4, squash=0.8)
        _boulder_src.hide_render = True
        _boulder_src.hide_viewport = True
    return _boulder_src


# ---------------------------------------------------------------- platform --
def _platform(coll, m, ctx):
    x0, x1 = 1.55, 6.2
    y0, y1 = -217.0, -195.5
    cx, w = (x0 + x1) / 2, (x1 - x0)
    slab = L.box("WP4_Platform", (w, y1 - y0, 1.5),
                 location=(cx, (y0 + y1) / 2, PLATFORM_TOP - 0.75), coll=coll,
                 mat=m["conc"], uv_scale=0.3)
    ctx["lightmap"].append(slab)
    L.box("WP4_Platform_Edge", (0.3, y1 - y0, 0.06),
          location=(x0 + 0.15, (y0 + y1) / 2, PLATFORM_TOP + 0.03),
          coll=coll, mat=m["white"])
    L.box("WP4_Platform_Tactile", (0.35, y1 - y0, 0.05),
          location=(x0 + 0.62, (y0 + y1) / 2, PLATFORM_TOP + 0.03),
          coll=coll, mat=m["tactile"])
    lamp_head_mat = L.material("Station_Lamp", (1.0, 0.98, 0.9), rough=0.5,
                               emit=(0.95, 0.98, 1.0), emit_str=3.0)
    for i, ly in enumerate((-199.5, -206.5, -213.5)):
        L.cylinder(f"WP4_Lamp_Pole{i}", 0.06, 3.2, segs=8,
                   location=(x1 - 0.7, ly, PLATFORM_TOP + 1.6), coll=coll,
                   mat=m["conc_d"])
        L.box(f"WP4_Lamp_Head{i}", (0.5, 1.1, 0.12),
              location=(x1 - 0.7, ly, PLATFORM_TOP + 3.25), coll=coll,
              mat=lamp_head_mat)
        li = bpy.data.lights.new(f"WP4_Lamp_Light{i}", type='POINT')
        li.energy = 320.0
        li.color = (0.85, 0.9, 1.0)
        lo = bpy.data.objects.new(f"WP4_Lamp_Light{i}", li)
        lo.location = (x1 - 0.7, ly, PLATFORM_TOP + 3.0)
        L.link(lo, coll)
    # U sign on a pole (Nuremberg style: white U on blue)
    L.cylinder("WP4_USign_Pole", 0.05, 2.6, segs=8,
               location=(x1 - 0.5, -196.5, PLATFORM_TOP + 1.3), coll=coll,
               mat=m["conc_d"])
    L.box("WP4_USign_Panel", (0.75, 0.08, 0.75),
          location=(x1 - 0.5, -196.5, PLATFORM_TOP + 2.9), coll=coll,
          mat=L.material("USign_Blue", (0.05, 0.15, 0.45), rough=0.4,
                         emit=(0.1, 0.3, 0.9), emit_str=2.0))
    utxt = L.text_mesh("WP4_USign_U", "U", font="label", size=0.52,
                       extrude=0.03, coll=coll,
                       mat=L.material("USign_White", (1, 1, 1), rough=0.4,
                                      emit=(1, 1, 1), emit_str=3.0),
                       rotation=(math.pi / 2, 0, math.pi))
    utxt.location = (x1 - 0.5, -196.56, PLATFORM_TOP + 2.72)


def _turnstile(coll, m, ctx):
    tx, ty, tz = 3.6, -196.6, PLATFORM_TOP
    for side in (-1, 1):
        L.box(f"WP4_Turnstile_Pillar{side}", (0.18, 0.55, 1.15),
              location=(tx + side * 0.62, ty, tz + 0.575), coll=coll,
              mat=m["conc_d"])
        L.box(f"WP4_Turnstile_Cap{side}", (0.22, 0.6, 0.08),
              location=(tx + side * 0.62, ty, tz + 1.18), coll=coll,
              mat=m["chrome"])
    rotor = L.cylinder("WP4_Turnstile_Rotor", 0.05, 1.2, segs=10,
                       location=(tx, ty, tz + 0.6), coll=coll, mat=m["chrome"])
    for k in range(3):
        ang = k * 2 * math.pi / 3
        for zi, zh in enumerate((0.32, 0.5, 0.68)):
            arm = L.cylinder(f"WP4_Turnstile_Arm{k}_{zi}", 0.024, 0.62, segs=7,
                             rotation=(0, math.pi / 2, ang), coll=coll,
                             mat=m["chrome"])
            arm.parent = rotor
            arm.location = (0.30 * math.cos(ang), 0.30 * math.sin(ang),
                            zh - 0.6)
            arm.rotation_euler = (0, math.pi / 2, ang)
    L.make_action(rotor, "turnstile_spin",
                  [("rotation_euler", 2, [(1, 0.0), (36, 2 * math.pi / 3)],
                    'BEZIER')])
    L.set_props(rotor, interactive_type="gate")
    ctx.setdefault("extras", {})["turnstile"] = rotor


def _display_board(coll, m):
    root = L.empty("WP4_Board_Root", (8.0, -206.5, -29.9),
                   rotation=(1.18, 0.1, 0.9), coll=coll, size=0.4)

    def part(obj, loc, rot=(0, 0, 0)):
        obj.parent = root
        obj.location = loc
        obj.rotation_euler = rot
        return obj

    body = part(L.box("WP4_Board_Body", (3.4, 0.28, 2.3), coll=coll,
                      mat=m["board"], bevel=0.03), (0, 0, 0))
    L.set_props(body, interactive_type="board", content="departures")
    for sx in (-1, 1):
        part(L.box(f"WP4_Board_Frame{'L' if sx < 0 else 'R'}",
                   (0.12, 0.34, 2.3), coll=coll, mat=m["conc_d"]),
             (sx * 1.72, 0, 0))
    part(L.box("WP4_Board_FrameT", (3.6, 0.34, 0.12), coll=coll,
               mat=m["conc_d"]), (0, 0, 1.2))
    part(L.box("WP4_Board_FrameB", (3.6, 0.34, 0.12), coll=coll,
               mat=m["conc_d"]), (0, 0, -1.2))
    flap = L.box("WP4_Board_FlapCell", (0.17, 0.03, 0.13),
                 location=(0, 0, -400), coll=coll, mat=m["flap"])
    flap.hide_render = True
    flap.hide_viewport = True
    lit = L.box("WP4_Board_FlapLit", (0.17, 0.03, 0.13), location=(0, 0, -401),
                coll=coll, mat=m["flap_t"])
    lit.hide_render = True
    lit.hide_viewport = True
    import random
    rng = random.Random(42)
    for row in range(5):
        for col in range(14):
            src = lit if rng.random() < 0.32 else flap
            cell = L.inst(src, f"WP4_Board_Cell_{row}_{col}", (0, 0, 0),
                          coll=coll)
            cell.parent = root
            cell.location = (-1.35 + col * 0.205, -0.165,
                             0.82 - row * 0.35)
    # analog clock on the top corner
    clock = part(L.cylinder("WP4_Clock_Body", 0.42, 0.1, segs=20, coll=coll,
                            mat=m["conc_d"]), (1.15, -0.1, 1.65),
                 (math.pi / 2, 0, 0))
    face = L.cylinder("WP4_Clock_Face", 0.36, 0.02, segs=20, coll=coll,
                      mat=m["clock_f"])
    face.parent = clock
    face.location = (0, 0, 0.055)
    tick = L.box("WP4_Clock_Tick", (0.025, 0.07, 0.012), location=(0, 0, -400),
                 coll=coll, mat=m["clock_h"])
    tick.hide_render = True
    tick.hide_viewport = True
    for h in range(12):
        a = h * math.pi / 6
        t = L.inst(tick, f"WP4_Clock_Tick_{h}", (0, 0, 0), coll=coll)
        t.parent = face
        t.location = (0.29 * math.sin(a), 0.29 * math.cos(a), 0.02)
        t.rotation_euler = (0, 0, -a)
    hour = L.box("WP4_Clock_Hour", (0.035, 0.18, 0.014), coll=coll,
                 mat=m["clock_h"])
    hour.parent = face
    hour.location = (0.06, 0.05, 0.035)
    hour.rotation_euler = (0, 0, -2.1)
    minute = L.box("WP4_Clock_Minute", (0.028, 0.26, 0.012), coll=coll,
                   mat=m["clock_h"])
    minute.parent = face
    minute.location = (-0.04, 0.08, 0.05)
    minute.rotation_euler = (0, 0, 0.5)
    sec = L.box("WP4_Clock_Second", (0.012, 0.3, 0.01), coll=coll,
                mat=m["clock_s"])
    sec.parent = face
    sec.location = (0.03, -0.07, 0.065)
    sec.rotation_euler = (0, 0, 2.6)
    for hand in (hour, minute, sec):
        L.set_props(hand, interactive_type="clock_hand")


# ------------------------------------------------------------------- train --
def _car_shell(coll, m, car, y0, is_cab_front):
    """One DT1 car; origin convention: world coords, car spans y0 .. y0-CAR_LEN,
    +Y = towards the platform entrance (front cab looks +Y). Track datum z."""
    z_floor = 1.1
    z_win0, z_win1 = 2.12, 3.02
    z_top = 3.38
    half_w = CAR_W / 2
    name = f"DT1_Car{car}"
    door_centers = [2.9, CAR_LEN / 2, CAR_LEN - 2.9]
    door_w = 1.32

    # underframe + floor
    L.box(f"{name}_Underframe", (CAR_W - 0.35, CAR_LEN - 0.5, 0.38),
          location=(0, y0 - CAR_LEN / 2, 0.86), coll=coll, mat=m["under"])
    L.box(f"{name}_Floor", (CAR_W - 0.16, CAR_LEN - 0.2, 0.1),
          location=(0, y0 - CAR_LEN / 2, z_floor + 0.05), coll=coll,
          mat=m["under"])
    # side walls: panels between doorways, lower band / window band / upper band
    spans = []
    cursor = 0.35
    for dc in door_centers:
        spans.append((cursor, dc - door_w / 2))
        cursor = dc + door_w / 2
    spans.append((cursor, CAR_LEN - 0.35))
    for side, tag in ((-1, "W"), (1, "E")):
        for si, (a, b) in enumerate(spans):
            ln = b - a
            yc = y0 - (a + b) / 2
            L.box(f"{name}_{tag}_Lower{si}", (0.09, ln, z_win0 - z_floor - 0.12),
                  location=(side * (half_w - 0.05), yc,
                            (z_floor + z_win0 - 0.12) / 2 + 0.06),
                  coll=coll, mat=m["red"])
            L.box(f"{name}_{tag}_Stripe{si}", (0.12, ln, 0.12),
                  location=(side * (half_w - 0.038), yc, z_win0 - 0.06),
                  coll=coll, mat=m["white_b"])
            L.box(f"{name}_{tag}_Upper{si}", (0.09, ln, z_top - z_win1),
                  location=(side * (half_w - 0.05), yc,
                            (z_win1 + z_top) / 2),
                  coll=coll, mat=m["red"])
            L.plane(f"{name}_{tag}_Glass{si}", ln - 0.24, z_win1 - z_win0,
                    location=(side * (half_w - 0.10), yc,
                              (z_win0 + z_win1) / 2),
                    rotation=(math.pi / 2, 0, math.pi / 2 + (0 if side > 0
                                                             else math.pi)),
                    coll=coll, mat=m["glass"])
            n_pillars = max(0, int(ln / 1.7))
            for pk in range(n_pillars):
                py = a + (b - a) * (pk + 1) / (n_pillars + 1)
                L.box(f"{name}_{tag}_Pillar{si}_{pk}", (0.08, 0.14,
                                                        z_win1 - z_win0),
                      location=(side * (half_w - 0.06), y0 - py,
                                (z_win0 + z_win1) / 2),
                      coll=coll, mat=m["red"])
    # roof
    arc = [(-half_w + 0.12, 0.0)]
    for i in range(9):
        a = math.pi * i / 8
        arc.append((-math.cos(a) * (half_w - 0.12), 0.38 * math.sin(a)))
    arc.append((half_w - 0.12, 0.0))
    roof_prof = arc + [(half_w - 0.12, -0.06), (-half_w + 0.12, -0.06)]
    L.sweep(f"{name}_Roof", roof_prof,
            [(0, y0 - 0.3, z_top), (0, y0 - CAR_LEN + 0.3, z_top)],
            coll=coll, mat=m["roof"], smooth_angle=math.radians(35))
    for vi, vy in enumerate((4.5, 9.3, 14.0)):
        L.box(f"{name}_RoofVent{vi}", (1.1, 1.8, 0.16),
              location=(0, y0 - vy, z_top + 0.42), coll=coll, mat=m["roof"])
    # end walls
    if is_cab_front:
        _cab_front(coll, m, name, y0)
    else:
        L.box(f"{name}_EndWall_F", (CAR_W - 0.2, 0.1, z_top - z_floor),
              location=(0, y0 - 0.15, (z_floor + z_top) / 2), coll=coll,
              mat=m["red"])
    L.box(f"{name}_EndWall_R", (CAR_W - 0.2, 0.1, z_top - z_floor),
          location=(0, y0 - CAR_LEN + 0.15, (z_floor + z_top) / 2), coll=coll,
          mat=m["red"])
    L.plane(f"{name}_EndWin_R", 0.9, 0.8,
            location=(0, y0 - CAR_LEN + 0.09, 2.5),
            rotation=(math.pi / 2, 0, 0), coll=coll, mat=m["glass"])
    # doors (platform side +X animated; -X side static closed)
    for side, tag in ((1, "E"), (-1, "W")):
        for di, dc in enumerate(door_centers):
            for leaf_dir, leaf_tag in ((-1, "L"), (1, "R")):
                leaf = L.box(f"{name}_Door{di + 1}_{tag}{leaf_tag}",
                             (0.07, door_w / 2 - 0.02, z_top - z_floor - 0.16),
                             coll=coll, mat=m["red"], bevel=0.012)
                base_y = y0 - dc + leaf_dir * door_w / 4
                leaf.location = (side * (half_w - 0.075), base_y,
                                 (z_floor + z_top) / 2 - 0.02)
                rub = L.box(f"{name}_Door{di + 1}_{tag}{leaf_tag}_Rub",
                            (0.075, 0.035, z_top - z_floor - 0.2),
                            coll=coll, mat=m["rubber"])
                rub.parent = leaf
                rub.location = (0, -leaf_dir * (door_w / 4 - 0.01), 0)
                gl = L.plane(f"{name}_Door{di + 1}_{tag}{leaf_tag}_Win",
                             0.38, 0.62,
                             rotation=(math.pi / 2, 0,
                                       side * math.pi / 2),
                             coll=coll, mat=m["glass"])
                gl.parent = leaf
                gl.location = (side * 0.045, 0, 0.55)
                if side > 0:
                    slide = leaf_dir * (door_w / 2 + 0.06)
                    L.make_action(leaf, "doors_open",
                                  [("location", 1,
                                    [(1, base_y), (34, base_y + slide)], None)])
                    L.make_action(leaf, "doors_close",
                                  [("location", 1,
                                    [(1, base_y + slide), (34, base_y)], None)])
                    leaf.location.y = base_y
    # bogies
    for bi, by in enumerate((3.1, CAR_LEN - 3.1)):
        L.box(f"{name}_Bogie{bi}", (2.0, 2.7, 0.5),
              location=(0, y0 - by, 0.5), coll=coll, mat=m["under"])
        for wx in (-1, 1):
            for wy in (-0.85, 0.85):
                L.cylinder(f"{name}_Wheel{bi}_{wx}_{int(wy * 100)}", 0.38, 0.14,
                           segs=14, rotation=(0, math.pi / 2, 0),
                           location=(wx * RAIL_HALF, y0 - by + wy, 0.38),
                           coll=coll, mat=m["under"])
    L.box(f"{name}_Coupler", (0.3, 0.5, 0.25),
          location=(0, y0 - CAR_LEN - 0.02, 0.72), coll=coll, mat=m["under"])
    return name


def _cab_front(coll, m, name, y0):
    z_floor, z_top = 1.1, 3.38
    half_w = CAR_W / 2
    # front mask: slight rake, three window panes over a red face
    L.box(f"{name}_Front", (CAR_W - 0.14, 0.16, z_top - z_floor),
          location=(0, y0 - 0.08, (z_floor + z_top) / 2),
          rotation=(-0.05, 0, 0), coll=coll, mat=m["red"])
    for wi, wx in enumerate((-0.95, 0.0, 0.95)):
        proud = 0.055 if wi == 1 else 0.015
        L.plane(f"{name}_Windshield{wi}", 0.72, 0.85,
                location=(wx, y0 + proud, 2.62), rotation=(math.pi / 2 - 0.05,
                                                           0, math.pi),
                coll=coll, mat=m["glass"])
        L.box(f"{name}_WinFrame{wi}", (0.8, 0.03, 0.93),
              location=(wx, y0 - 0.005 + proud - 0.015, 2.62),
              rotation=(-0.05, 0, 0), coll=coll, mat=m["rubber"])
    # emergency door outline; its window is the proud center windshield pane
    L.box(f"{name}_EmergencyDoor", (0.88, 0.04, 1.95),
          location=(0, y0 + 0.02, 2.12), rotation=(-0.05, 0, 0), coll=coll,
          mat=m["red"])
    # headlamps + red markers
    for sx in (-1, 1):
        for li, lz in enumerate((1.62,)):
            L.cylinder(f"{name}_Headlamp{'L' if sx < 0 else 'R'}{li}",
                       0.11, 0.1, segs=12, rotation=(math.pi / 2, 0, 0),
                       location=(sx * 0.95, y0 + 0.06, lz), coll=coll,
                       mat=m["lamp"])
        L.cylinder(f"{name}_Marker{'L' if sx < 0 else 'R'}", 0.07, 0.08,
                   segs=10, rotation=(math.pi / 2, 0, 0),
                   location=(sx * 0.95, y0 + 0.05, 1.32), coll=coll,
                   mat=m["marker"])
    spot = bpy.data.lights.new(f"{name}_HeadlightSpot", type='SPOT')
    spot.energy = 900.0
    spot.color = (1.0, 0.93, 0.8)
    spot.spot_size = 1.0
    lo = bpy.data.objects.new(f"{name}_HeadlightSpot", spot)
    lo.location = (0, y0 + 0.2, 1.7)
    lo.rotation_euler = (math.pi / 2 + 0.08, 0, math.pi)
    L.link(lo, L.collection("WP4_Metro"))
    # destination sign
    L.box(f"{name}_DestBox", (1.05, 0.14, 0.3),
          location=(0, y0 - 0.02, 3.16), coll=coll, mat=m["sign"])
    txt = L.text_mesh(f"{name}_DestText", "KONTAKT", font="matrix", size=0.17,
                      extrude=0.015, coll=coll, mat=m["sign_t"],
                      rotation=(math.pi / 2, 0, math.pi))
    txt.location = (0, y0 + 0.055, 3.10)
    L.set_props(txt, interactive_type="link", link_id="contact")
    # roof cap over the cab
    L.box(f"{name}_CabRoofCap", (CAR_W - 0.3, 0.9, 0.16),
          location=(0, y0 - 0.45, z_top + 0.1), coll=coll, mat=m["roof"])


def _interior(coll, m, car, y0):
    name = f"DT1_Car{car}"
    z_floor = 1.2
    half_w = CAR_W / 2
    bench_spans = [(4.0, 7.6), (10.4, 14.2)]
    seat_src = back_src = None
    for side in (-1, 1):
        for si, (a, b) in enumerate(bench_spans):
            ln = b - a
            yc = y0 - (a + b) / 2
            if seat_src is None:
                seat_src = L.box("DT1_Seat_Pad", (0.46, ln, 0.1),
                                 location=(side * (half_w - 0.34), yc,
                                           z_floor + 0.42),
                                 coll=coll, mat=m["seat"], bevel=0.02)
                back_src = L.box("DT1_Seat_Back", (0.09, ln, 0.5),
                                 location=(side * (half_w - 0.13), yc,
                                           z_floor + 0.78),
                                 rotation=(0, side * -0.12, 0),
                                 coll=coll, mat=m["seat"], bevel=0.02)
                L.box("DT1_Seat_Base", (0.4, ln, 0.4),
                      location=(side * (half_w - 0.34), yc, z_floor + 0.2),
                      coll=coll, mat=m["wood_i"])
            else:
                L.inst(seat_src, f"{name}_Seat{side}_{si}",
                       (side * (half_w - 0.34), yc, z_floor + 0.42), coll=coll)
                L.inst(back_src, f"{name}_SeatBack{side}_{si}",
                       (side * (half_w - 0.13), yc, z_floor + 0.78),
                       rotation=(0, side * -0.12, 0), coll=coll)
                L.box(f"{name}_SeatBase{side}_{si}", (0.4, ln, 0.4),
                      location=(side * (half_w - 0.34), yc, z_floor + 0.2),
                      coll=coll, mat=m["wood_i"])
    # interior liner below the window band hides the hollow shell look
    for side in (-1, 1):
        L.box(f"{name}_Liner{side}", (0.05, CAR_LEN - 0.9, 0.95),
              location=(side * (half_w - 0.16), y0 - CAR_LEN / 2,
                        z_floor + 0.475 + 0.1),
              coll=coll, mat=m["wood_i"])
    pole_src = None
    for pi, py in enumerate((3.6, 8.2, 9.6, 13.4, 15.2, 16.8)):
        loc = ((-1) ** pi * 0.55, y0 - py, 2.25)
        if pole_src is None:
            pole_src = L.cylinder("DT1_Pole", 0.024, 2.15, segs=8,
                                  location=loc, coll=coll, mat=m["pole"])
        else:
            L.inst(pole_src, f"{name}_Pole{pi}", loc, coll=coll)
    L.box(f"{name}_Ceiling", (CAR_W - 0.5, CAR_LEN - 0.8, 0.05),
          location=(0, y0 - CAR_LEN / 2, 3.32), coll=coll, mat=m["beige"])
    for si, sx in enumerate((-0.6, 0.6)):
        L.box(f"{name}_LightStrip{si}", (0.16, CAR_LEN - 2.0, 0.04),
              location=(sx, y0 - CAR_LEN / 2, 3.30), coll=coll, mat=m["strip"])
    # driver cab partition (front car only)
    if car == 1:
        L.box(f"{name}_CabWall", (CAR_W - 0.2, 0.08, 2.28),
              location=(0, y0 - 2.1, 2.24), coll=coll, mat=m["wood_i"])
        L.plane(f"{name}_CabWall_Win", 0.7, 0.7,
                location=(0.5, y0 - 2.06, 2.6), rotation=(math.pi / 2, 0, 0),
                coll=coll, mat=m["glass"])
        L.box(f"{name}_CabConsole", (1.6, 0.6, 0.5),
              location=(0, y0 - 1.1, 1.85), coll=coll, mat=m["under"])


def _train(coll, m, ctx):
    datum = -30.2
    root = L.empty("DT1_Root", (0, 0, datum), coll=coll, size=0.5)
    L.set_props(root, interactive_type="train", train_type="DT1")
    prev = set(bpy.data.objects)
    _car_shell(coll, m, 1, TRAIN_FRONT_Y, True)
    _interior(coll, m, 1, TRAIN_FRONT_Y)
    _car_shell(coll, m, 2, TRAIN_FRONT_Y - CAR_LEN - 0.45, False)
    _interior(coll, m, 2, TRAIN_FRONT_Y - CAR_LEN - 0.45)
    for obj in set(bpy.data.objects) - prev:
        if obj.parent is None and obj.type in ('MESH', 'LIGHT'):
            obj.parent = root
    wp = L.empty("cam_wp4_contact", (3.4, -196.2, -27.3),
                 look_at=(0, TRAIN_FRONT_Y, -27.9), coll=coll,
                 props={"camera_waypoint": "contact"})
    ctx["waypoints"]["contact"] = wp
    wp2 = L.empty("cam_wp4_inside_train", (0, -205.5, -27.55),
                  look_at=(0, -215.0, -27.9), coll=coll,
                  props={"camera_waypoint": "contact_inside"})
    ctx["waypoints"]["contact_inside"] = wp2


# ------------------------------------------------------------- loop tunnel --
TUNNEL_CTRL = [
    (0.0, -240.0, -30.2), (0.0, -252.0, -29.8), (14.0, -262.0, -28.0),
    (34.0, -264.0, -26.0), (52.0, -256.0, -23.0), (64.0, -240.0, -20.0),
    (72.0, -218.0, -17.5), (76.0, -192.0, -16.0), (76.0, -164.0, -16.5),
    (74.0, -136.0, -17.5), (70.0, -108.0, -18.0), (64.0, -80.0, -18.0),
    (56.0, -54.0, -16.0), (46.0, -30.0, -12.0), (34.0, -8.0, -7.0),
    (22.0, 10.0, -2.0), (12.0, 24.0, 0.9), (5.0, 32.0, 2.0), (0.0, 35.5, 2.25),
]


def _loop_tunnel(coll, m):
    pts = L.catmull_rom(TUNNEL_CTRL, closed=False, samples_per_seg=6)
    L.tube("WP4_Loop_Tunnel", pts, 3.5, segs=10, coll=coll, mat=m["rock_d"],
           cap=False, smooth_angle=math.radians(80),
           taper=lambda t: 1.0 - 0.28 * L.smoothstep(0.85, 1.0, t))
    # exit portal onto the atrium plaza
    for side in (-1, 1):
        L.box(f"WP4_LoopPortal_Pier{side}", (1.0, 1.0, 4.6),
              location=(side * 2.6, 36.5, 2.3 - 0.3), coll=coll,
              mat=L.material("Brutalist_Concrete_Dark", (0.45, 0.44, 0.42),
                             rough=0.95))
    L.box("WP4_LoopPortal_Lintel", (7.2, 1.2, 1.2),
          location=(0, 36.5, 4.8), coll=coll,
          mat=L.material("Brutalist_Concrete", (0.58, 0.56, 0.53), rough=0.92))
    L.box("WP4_LoopPortal_Slab", (9.0, 14.0, 0.3), location=(0, 32.0, -0.17),
          coll=coll, mat=L.material("Brutalist_Concrete", (0.58, 0.56, 0.53),
                                    rough=0.92))


def build(ctx):
    coll = L.collection("WP4_Metro")
    m = _mats()
    _portal(coll, m)
    _track(coll, m)
    _shaft_and_cavern(coll, m, ctx)
    _platform(coll, m, ctx)
    _turnstile(coll, m, ctx)
    _display_board(coll, m)
    _train(coll, m, ctx)
    _loop_tunnel(coll, m)
