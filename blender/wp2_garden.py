# ============================================================================
# wp2_garden.py — WAYPOINT 2: THE ELYSIAN GARDEN & IONIC COLUMN (y ≈ -50).
#
# Bakst-style valley: rolling terrain bowled in by hill ridges, a lake with
# half-submerged Roman ruins, two waterfall mountains framing the canyon gate
# to the desert, instanced trees / vines / lily pads, the giant tilted Ionic
# column carrying the "Meine Projekte" engraving, and the tethered wooden boat
# with five labelled seats. Anchors: cam_wp2_projects, cam_wp2_boat_seat.
# ============================================================================
import math

from mathutils import Vector

import lib_common as L

PROJECTS = ("Meine Projekte: Im Rahmen meines Self-Publishings erscheinen "
            "regelmäßig einzelne wissenschaftliche Arbeiten auf ResearchGate. "
            "Ebenso erscheint in unregelmäßigen Abständen der Podcast "
            "Hinterstube über politische Kuriositäten und vergessene "
            "Nachrichten. Der Underground-Blog Kenopsium umfasst ein "
            "Feuilleton mit sehenswerten Inhalten in Video-, Text- und "
            "Hypertextform.")

LAKE_C = (-1.0, -53.0)
LAKE_R = (15.0, 11.0)
WATER_Z = -0.55
COL_POS = (2.5, -54.0)
BOAT_POS = (-5.2, -48.5)


# ------------------------------------------------------------- path profile --
def spine_x(y):
    if -58.0 < y < -40.0:
        return -8.5 * math.sin(math.pi * (y + 40.0) / -18.0)
    return 0.0


def spine_z(y):
    pts = [(-15.0, 0.0), (-42.0, -0.5), (-64.0, -0.5), (-78.0, -1.6),
           (-84.0, -2.2), (-101.0, -5.0)]
    if y >= pts[0][0]:
        return 0.0
    if y <= pts[-1][0]:
        return pts[-1][1]
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if y1 <= y <= y0:
            t = L.smoothstep(0.0, 1.0, (y0 - y) / (y0 - y1))
            return z0 + (z1 - z0) * t
    return 0.0


def _terrain_fn(x, y):
    base = 2.6 * L.fractal2d(x, y, scale=0.035, octaves=4, seed=2.0) + 0.8
    # bowl the garden with hill ridges / the two waterfall mountains
    for cx, cy, r, h in ((-22, -78, 18, 38), (22, -78, 18, 38),
                         (-30, -64, 16, 20), (30, -64, 16, 20),
                         (-46, -52, 20, 16), (46, -40, 18, 13),
                         (-40, -18, 15, 10), (42, -72, 16, 14),
                         (-14, -13, 10, 5), (16, -12, 10, 5)):
        base += L.gauss_bump(x, y, cx, cy, r, h)
    # flatten a travel corridor towards the path spine
    w, fall = (3.5, 3.0) if y < -78 else (4.5, 5.0)
    d = abs(x - spine_x(y))
    m = L.smoothstep(w + fall, w, d)
    z = base * (1 - m) + spine_z(y) * m
    # lake basin (suppressed near the spine so the shore path stays dry)
    rn = math.hypot((x - LAKE_C[0]) / LAKE_R[0], (y - LAKE_C[1]) / LAKE_R[1])
    z -= 1.7 * (1 - L.smoothstep(0.55, 1.05, rn)) * (1 - m)
    # sink the north edge under the atrium floor so no hills poke inside
    edge = L.smoothstep(-22.0, -14.0, y)
    z = z * (1 - edge) + (-0.7) * edge
    return z


def _mats():
    return {
        # albedo is the sand end of the gradient; vertex colors darken the
        # north end towards grass (uint8 COLOR_0 cannot encode ratios > 1)
        "grass":  L.material("Garden_Grass", (0.70, 0.50, 0.30), rough=0.95),
        "stone":  L.material("Ruin_Marble", (0.78, 0.75, 0.68), rough=0.6),
        "column": L.material("Column_Stone", (0.70, 0.63, 0.52), rough=0.6),
        "bronze": L.material("Bronze_Patina", (0.35, 0.42, 0.34), rough=0.38, metal=0.9),
        "water":  L.material("Water_Lake", (0.10, 0.24, 0.24), rough=0.08,
                             metal=0.1, alpha=0.78, double_sided=True),
        "falls":  L.material("Water_Falls", (0.78, 0.87, 0.92), rough=0.25,
                             alpha=0.68, double_sided=True,
                             emit=(0.78, 0.87, 0.94), emit_str=0.4),
        "falls2": L.material("Water_Falls_Back", (0.7, 0.8, 0.86), rough=0.3,
                             alpha=0.4, double_sided=True,
                             emit=(0.7, 0.8, 0.88), emit_str=0.3),
        "foam":   L.material("Water_Foam", (0.95, 0.97, 0.98), rough=0.7,
                             alpha=0.55, double_sided=True,
                             emit=(0.95, 0.97, 1.0), emit_str=0.5),
        "mist":   L.material("Water_Mist", (0.92, 0.95, 0.97), rough=1.0,
                             alpha=0.35, double_sided=True),
        "bark":   L.material("Tree_Bark", (0.34, 0.25, 0.18), rough=0.95),
        "leaf":   L.material("Tree_Canopy", (0.22, 0.38, 0.18), rough=0.9),
        "leaf2":  L.material("Tree_Cypress", (0.16, 0.30, 0.17), rough=0.9),
        "wood":   L.material("Boat_Wood", (0.42, 0.30, 0.19), rough=0.8),
        "wood2":  L.material("Boat_Wood_Light", (0.55, 0.42, 0.28), rough=0.75),
        "rope":   L.material("Rope_Hemp", (0.55, 0.45, 0.30), rough=0.95),
        "rock":   L.material("Garden_Rock", (0.48, 0.46, 0.42), rough=0.95),
        "lily":   L.material("Lily_Pad", (0.25, 0.45, 0.22), rough=0.85,
                             double_sided=True),
    }


# ------------------------------------------------------------------ scenery --
def _terrain(coll, m, ctx):
    terr = L.heightfield("WP2_Terrain", (0, -56), (130, 92), (110, 80),
                         _terrain_fn, coll=coll, mat=m["grass"])
    L.vertex_noise(terr, 0.12, 0.10, seed=5)
    # grass in the north fading to bare sand at the canyon south end
    attr = terr.data.color_attributes["Col"]
    grass_ratio = (0.36, 0.80, 0.57)     # grass albedo / sand albedo
    for i, vt in enumerate(terr.data.vertices):
        t = L.smoothstep(-55.0, -86.0, vt.co.y)
        c = attr.data[i].color
        attr.data[i].color = (c[0] * (grass_ratio[0] + (1 - grass_ratio[0]) * t),
                              c[1] * (grass_ratio[1] + (1 - grass_ratio[1]) * t),
                              c[2] * (grass_ratio[2] + (1 - grass_ratio[2]) * t),
                              1.0)
    ctx["lightmap"].append(terr)
    lake = L.plane("WP2_Lake_Water", 36, 27, location=(*LAKE_C, WATER_Z),
                   coll=coll, mat=m["water"], nx=24, ny=18, uv_scale=0.1)
    L.set_props(lake, shader="water")


def _waterfalls(coll, m):
    # Anchor heights come straight from terrain for lip/mid-ledge, while the
    # plunge base connects seamlessly down to the lake surface (WATER_Z = -0.55).
    boulder = L.rock("WP2_FallsBoulder", 0.85, (0, 0, -400), coll=coll,
                     mat=m["rock"], seed=44, rough=0.4, squash=0.65)
    boulder.hide_render = True
    boulder.hide_viewport = True

    for sx, tag in ((-1, "L"), (1, "R")):
        # Tiered cascade coordinates: Top lip -> Mid Ledge shelf -> Plunge Base at lake level
        top_x, top_y = sx * 13.5, -74.0
        mid_x, mid_y = sx * 10.0, -68.0
        base_x, base_y = sx * 7.2, -62.0

        top_z = _terrain_fn(top_x, top_y) + 1.2
        mid_z = max(_terrain_fn(mid_x, mid_y) + 0.8, WATER_Z + 5.0)
        base_z = WATER_Z - 0.2  # slightly below water line so plane submerges seamlessly
        pool_z = WATER_Z

        # 1. Upper Cascade Drop (Cliff Lip -> Mid Ledge)
        drop1 = top_z - mid_z
        h1 = drop1 + 1.0
        z1 = mid_z - 0.2 + h1 / 2
        fall_upper = L.plane(f"WP2_Waterfall_{tag}_Upper", 4.4, h1,
                             nx=8, ny=max(10, int(h1 * 2)),
                             location=((top_x + mid_x) / 2, (top_y + mid_y) / 2 + 0.6, z1),
                             rotation=(math.pi / 2 + 0.05, sx * -0.05, math.pi),
                             coll=coll, mat=m["falls"], normalized_uv=True)
        L.set_props(fall_upper, shader="waterfall")

        # 2. Lower Cascade Drop (Mid Ledge -> Lake Surface)
        drop2 = mid_z - base_z
        h2 = drop2 + 0.8
        z2 = base_z - 0.1 + h2 / 2
        fall_lower = L.plane(f"WP2_Waterfall_{tag}", 6.2, h2,
                             nx=10, ny=max(12, int(h2 * 2)),
                             location=((mid_x + base_x) / 2, (mid_y + base_y) / 2 + 0.6, z2),
                             rotation=(math.pi / 2 + 0.05, sx * -0.05, math.pi),
                             coll=coll, mat=m["falls"], normalized_uv=True)
        L.set_props(fall_lower, shader="waterfall")

        # Backing volume layer for volumetric whitewater depth
        fall_back = L.plane(f"WP2_Waterfall_{tag}_B", 6.6, h2 + 0.6,
                            nx=6, ny=8,
                            location=((mid_x + base_x) / 2 + sx * 0.3, (mid_y + base_y) / 2 + 0.3, z2),
                            rotation=(math.pi / 2 + 0.05, sx * -0.05, math.pi),
                            coll=coll, mat=m["falls2"], normalized_uv=True)
        L.set_props(fall_back, shader="waterfall")

        # 3. Secondary Ribbon Cascade (High Mountain Crevice)
        rib_top_x, rib_top_y = sx * 18.0, -80.0
        rib_base_x, rib_base_y = sx * 13.0, -74.0
        rib_top_z = _terrain_fn(rib_top_x, rib_top_y) + 0.8
        rib_base_z = max(_terrain_fn(rib_base_x, rib_base_y), WATER_Z)
        rib_h = rib_top_z - rib_base_z + 1.0
        rib_z = rib_base_z - 0.1 + rib_h / 2
        fall_ribbon = L.plane(f"WP2_Waterfall_Ribbon_{tag}", 2.8, rib_h,
                              nx=4, ny=max(8, int(rib_h * 1.5)),
                              location=((rib_top_x + rib_base_x) / 2, (rib_top_y + rib_base_y) / 2 + 0.5, rib_z),
                              rotation=(math.pi / 2 + 0.05, sx * -0.1, math.pi),
                              coll=coll, mat=m["falls2"], normalized_uv=True)
        L.set_props(fall_ribbon, shader="waterfall")

        # 4. Plunge Pool & Impact Water at Lake Surface
        pool = L.plane(f"WP2_Falls_Pool_{tag}", 11.0, 8.5,
                       location=(base_x, base_y + 0.6, pool_z + 0.01), coll=coll,
                       mat=m["water"], nx=12, ny=10, uv_scale=0.15)
        L.set_props(pool, shader="water")

        # Foam pad at main plunge base (flush with lake surface)
        foam = L.cylinder(f"WP2_Falls_Foam_{tag}", 2.8, 0.06, segs=16,
                          location=(base_x - sx * 0.6, base_y, pool_z + 0.02),
                          coll=coll, mat=m["foam"], smooth_angle=math.radians(80))
        L.set_props(foam, shader="foam")

        # Mid-ledge splash foam
        foam_mid = L.cylinder(f"WP2_Falls_Foam_Mid_{tag}", 1.8, 0.06, segs=12,
                              location=(mid_x - sx * 0.5, mid_y, mid_z + 0.02),
                              coll=coll, mat=m["foam"], smooth_angle=math.radians(80))
        L.set_props(foam_mid, shader="foam")

        # Volumetric mist clouds (base plunge and mid-ledge)
        mist = L.cylinder(f"WP2_Falls_Mist_{tag}", 3.6, 2.2, segs=14,
                          location=(base_x - sx * 0.6, base_y, pool_z + 1.1),
                          coll=coll, mat=m["mist"], smooth_angle=math.radians(80))
        L.set_props(mist, shader="mist")

        mist_mid = L.cylinder(f"WP2_Falls_Mist_Mid_{tag}", 2.2, 1.6, segs=12,
                              location=(mid_x - sx * 0.5, mid_y, mid_z + 1.0),
                              coll=coll, mat=m["mist"], smooth_angle=math.radians(80))
        L.set_props(mist_mid, shader="mist")

        # Rocks grounding the plunge, mid-ledge, and upper lip
        rock_spots = [(base_x - sx * 3.2, base_y + 0.8, 1.1),
                      (base_x + sx * 2.8, base_y + 1.6, 0.9),
                      (base_x - sx * 1.0, base_y + 3.2, 0.8),
                      (base_x + sx * 2.0, base_y - 2.2, 0.85),
                      (mid_x + sx * 0.8, mid_y - 0.8, 1.2),
                      (mid_x - sx * 1.8, mid_y + 1.2, 1.0),
                      (top_x + sx * 1.2, top_y + 0.5, 1.3)]
        for i, (rx, ry, rs) in enumerate(rock_spots):
            rz = max(_terrain_fn(rx, ry), WATER_Z) - 0.15
            L.inst(boulder, f"WP2_FallsBoulder_{tag}_{i}", (rx, ry, rz),
                   rotation=(0.12, 0.05, i * 1.3 + (0 if sx < 0 else 2.1)),
                   scale=rs, coll=coll)


def _trees(coll, m):
    trunk = L.cylinder("WP2_Tree_Trunk", 0.22, 3.2, segs=8, radius2=0.13,
                       location=(0, 0, -400), coll=coll, mat=m["bark"])
    canopy = L.rock("WP2_Tree_Canopy", 1.7, (0, 0, -400), coll=coll,
                    mat=m["leaf"], seed=11, rough=0.3, squash=0.85)
    cyp = L.cylinder("WP2_Cypress", 0.9, 6.5, segs=10, radius2=0.05,
                     location=(0, 0, -400), coll=coll, mat=m["leaf2"],
                     smooth_angle=math.radians(50))
    for o in (trunk, canopy, cyp):
        o.hide_render = True
        o.hide_viewport = True
    spots = [(-13, -32, 9), (-19, -44, 1), (12, -36, 2), (17, -48, 3),
             (-16, -62, 4), (13, -64, 5), (-10, -21, 6), (9, -24, 7),
             (20, -60, 8), (-22, -70, 9)]
    for i, (x, y, seed) in enumerate(spots):
        z = _terrain_fn(x, y)
        if i % 3 == 2:
            L.inst(cyp, f"WP2_Cypress_{i}", (x, y, z + 3.0),
                   rotation=seed * 0.7, scale=0.85 + 0.06 * (seed % 4), coll=coll)
        else:
            s = 0.8 + 0.08 * (seed % 4)
            L.inst(trunk, f"WP2_Trunk_{i}", (x, y, z + 1.5 * s),
                   rotation=seed, scale=s, coll=coll)
            L.inst(canopy, f"WP2_Canopy_{i}", (x, y, z + 3.6 * s),
                   rotation=seed * 1.3, scale=s, coll=coll)
    # hanging vines on the atrium arch back and near the canyon gate
    vine_anchors = [((-3.2, -15.9, 8.6), 2.6), ((0.5, -15.9, 9.6), 3.4),
                    ((3.0, -15.9, 8.2), 2.2), ((-8.5, -82.5, 6.0), 3.0),
                    ((8.0, -83.0, 5.0), 2.4)]
    for i, ((x, y, z), drop) in enumerate(vine_anchors):
        pts = [(x + 0.12 * j, y + 0.22 * math.sin(j * 1.7), z - drop * j / 6)
               for j in range(7)]
        L.tube(f"WP2_Vine_{i}", pts, 0.05, segs=5, coll=coll, mat=m["leaf"],
               taper=lambda t: 1.0 - 0.55 * t)


def _ruins(coll, m):
    # Broken columns rising from the lake: each anchored to the ACTUAL
    # terrain/water floor at build time (a hardcoded guess used to sit up to
    # 2.5 m below the current terrain once the height field was tuned, which
    # buried them entirely). visible_h is how far the stump top pokes above
    # whichever is higher, the local ground or the waterline.
    stump = _fluted_shaft("WP2_Ruin_Stump", 0.55, 0.5, 2.4, coll, m["stone"])
    stump_defs = [
        # (x, y, rot_z, scale, tilt, visible_h)
        (7.5, -59.5, 0.4, 1.0, 0.08, 1.3),
        (10.5, -57.5, 1.2, 0.85, 0.12, 0.75),
        (6.0, -62.5, 2.4, 1.1, -0.1, 1.55),
        (11.5, -61.0, 0.5, 0.7, 0.2, 0.5),
    ]
    for i, (x, y, rz, s, tilt, vis) in enumerate(stump_defs):
        floor = max(_terrain_fn(x, y), WATER_Z - 0.05)
        top_z = floor + vis
        base_z = top_z - 2.4 * s
        obj = stump if i == 0 else L.inst(stump, f"WP2_Ruin_Stump_{i}",
                                          (0, 0, 0), coll=coll)
        obj.name = f"WP2_Ruin_Stump_{i}"
        obj.location = (x, y, base_z)
        obj.rotation_euler = (tilt, 0.06, rz)
        obj.scale = (s, s, s)

    fallen_z = _terrain_fn(9.0, -64.5) + 0.3
    fallen = _fluted_shaft("WP2_Ruin_Fallen", 0.5, 0.45, 4.0, coll, m["stone"])
    fallen.location = (9.0, -64.5, fallen_z)
    fallen.rotation_euler = (0, math.pi / 2 - 0.06, 0.7)

    arch_z = _terrain_fn(5.2, -60.8) - 0.1
    L.box("WP2_Ruin_Architrave", (3.2, 0.9, 0.8), location=(5.2, -60.8, arch_z),
          rotation=(0.1, 0.04, 0.9), coll=coll, mat=m["stone"], bevel=0.05)

    frag_z = _terrain_fn(12.5, -55.0) - 0.25
    arc = L.arc_points((0.0, 0.0), 1.6, 0.15, math.pi * 0.7, 10, plane='XZ')
    frag = L.sweep("WP2_Ruin_ArchFragment",
                   [(-0.3, -0.25), (0.3, -0.25), (0.3, 0.25), (-0.3, 0.25)],
                   arc, coll=coll, mat=m["stone"], smooth_angle=math.radians(15))
    frag.location = (12.5, -55.0, frag_z)
    frag.rotation_euler = (0.1, 0, -0.9)
    pad = L.cylinder("WP2_LilyPad", 0.42, 0.03, segs=9, coll=coll, mat=m["lily"],
                     location=(0, 0, -400))
    pad.hide_render = True
    pad.hide_viewport = True
    for i, (x, y) in enumerate(((3, -47), (5.5, -49), (1, -45.5), (8, -52),
                                (6.5, -57), (-1, -47.5), (10, -55), (4, -59))):
        L.inst(pad, f"WP2_LilyPad_{i}", (x, y, WATER_Z + 0.02),
               rotation=i * 0.8, scale=0.7 + (i % 3) * 0.25, coll=coll)
    stone = L.rock("WP2_Boulder", 0.8, (0, 0, -400), coll=coll, mat=m["rock"],
                   seed=3, rough=0.4, squash=0.6)
    stone.hide_render = True
    stone.hide_viewport = True
    for i, (x, y) in enumerate(((-11, -40), (-12.5, -57), (9, -41), (14, -50),
                                (-7, -70), (6, -70), (-3.5, -80), (4, -81))):
        z = _terrain_fn(x, y)
        L.inst(stone, f"WP2_Boulder_{i}", (x, y, z + 0.2), rotation=i * 1.1,
               scale=0.7 + (i % 4) * 0.3, coll=coll)


# ------------------------------------------------------------ ionic column --
def _fluted_shaft(name, r0, r1, height, coll, mat, segs=64, flutes=20, rings=7):
    pts, radii = [], []
    for i in range(rings):
        t = i / (rings - 1)
        pts.append((0, 0, height * t))
        radii.append(r0 + (r1 - r0) * (t ** 1.25))
    obj = L.tube(name, pts, radii, segs=segs, coll=coll, mat=mat, cap=True,
                 smooth_angle=math.radians(35))
    me = obj.data
    for vt in me.vertices:
        th = math.atan2(vt.co.y, vt.co.x)
        r = math.hypot(vt.co.x, vt.co.y)
        if r > 1e-4:
            groove = (0.5 + 0.5 * math.cos(th * flutes)) ** 0.8
            f = 1.0 - 0.055 * groove
            vt.co.x *= f
            vt.co.y *= f
    me.update()
    return obj


def _volute(name, coll, mat):
    pts = []
    turns = 2.3
    n = 44
    for i in range(n + 1):
        t = i / n
        a = turns * 2 * math.pi * t
        r = 0.95 * (1.0 - 0.86 * t) + 0.10
        pts.append((r * math.cos(a), 0.0, r * math.sin(a)))
    prof = [(-0.13, -0.42), (0.13, -0.42), (0.13, 0.42), (-0.13, 0.42)]
    obj = L.sweep(name, prof, pts, coll=coll, mat=mat,
                  smooth_angle=math.radians(40))
    return obj


def _column(coll, m, ctx):
    # embed the plinth just under the lake floor so it plants naturally,
    # with the ornate base breaking the waterline above it (was hardcoded
    # to -2.1, ~1.2 m below the actual floor once terrain got its final
    # shape, burying the whole decorative base out of sight)
    ground = _terrain_fn(*COL_POS) - 0.35
    root = L.empty("WP2_Column_Root", (COL_POS[0], COL_POS[1], ground),
                   rotation=(0.055, -0.035, 0), coll=coll, size=0.5)
    root["interactive_type"] = "column"

    def add(obj, loc, rot=(0, 0, 0)):
        obj.parent = root
        obj.location = loc
        obj.rotation_euler = rot
        return obj

    add(L.box("WP2_Col_Plinth_A", (4.4, 4.4, 0.9), coll=coll, mat=m["column"],
              bevel=0.05), (0, 0, 0.45))
    add(L.box("WP2_Col_Plinth_B", (3.7, 3.7, 0.6), coll=coll, mat=m["column"],
              bevel=0.05), (0, 0, 1.2))
    torus_prof = [(0.24 * math.cos(a), 0.24 * math.sin(a))
                  for a in [i * math.pi / 5 for i in range(10)]]
    ring_path = L.arc_points((0, 0), 1.62, 0.0, 2 * math.pi, 26, plane='XY', y=0.0)
    add(L.sweep("WP2_Col_TorusBase", torus_prof, ring_path, coll=coll,
                mat=m["column"], closed_path=True, cap=False), (0, 0, 1.62))
    shaft = _fluted_shaft("WP2_Col_Shaft", 1.42, 1.12, 18.0, coll, m["column"])
    L.vertex_noise(shaft, 0.25, 0.4, seed=9)
    add(shaft, (0, 0, 1.8))
    ring_path2 = L.arc_points((0, 0), 1.2, 0.0, 2 * math.pi, 22, plane='XY')
    neck_prof = [(0.14 * math.cos(a), 0.14 * math.sin(a))
                 for a in [i * math.pi / 5 for i in range(10)]]
    add(L.sweep("WP2_Col_Neck", neck_prof, ring_path2, coll=coll,
                mat=m["column"], closed_path=True, cap=False), (0, 0, 19.9))
    add(L.cylinder("WP2_Col_Echinus", 1.5, 0.55, segs=28, radius2=1.15,
                   coll=coll, mat=m["column"]), (0, 0, 20.35))
    for sx, tag in ((-1, "L"), (1, "R")):
        vol = _volute(f"WP2_Col_Volute_{tag}", coll, m["column"])
        add(vol, (sx * 1.55, 0, 20.55), (0, 0, 0))
        add(L.cylinder(f"WP2_Col_VoluteEye_{tag}", 0.16, 0.9, segs=12,
                       rotation=(math.pi / 2, 0, 0), coll=coll,
                       mat=m["column"]), (sx * 1.55, 0, 20.55),
            (math.pi / 2, 0, 0))
    add(L.box("WP2_Col_Abacus", (3.5, 3.5, 0.5), coll=coll, mat=m["column"],
              bevel=0.06), (0, 0, 21.3))

    body = L.wrap_text(PROJECTS, 26)
    txt = L.text_mesh("WP2_Text_Projects", body, font="engrave", size=0.265,
                      extrude=0.03, coll=coll, mat=m["bronze"],
                      align_y='CENTER', line_gap=1.32,
                      warp=L.cyl_wrap(radius=1.315, center=(0.0, 0.0),
                                      z_base=0.0))
    add(txt, (0, 0, 10.6))
    L.set_props(txt, interactive_type="text", content="projects")

    wp = L.empty("cam_wp2_projects", (-9.0, -33.5, 7.5),
                 look_at=(-0.5, -51.0, 6.0), coll=coll,
                 props={"camera_waypoint": "projects"})
    ctx["waypoints"]["projects"] = wp


# --------------------------------------------------------------------- boat --
def _boat(coll, m, ctx):
    import bmesh
    length, beam = 4.8, 1.75
    stations = 11
    bm = bmesh.new()
    rings = []
    for i in range(stations):
        t = i / (stations - 1)
        yl = -length / 2 + length * t
        w = max(0.09, beam / 2 * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.7)
        keel = -0.42 * math.sin(math.pi * (0.1 + 0.8 * t)) ** 0.5
        sheer = 0.36 + 0.14 * (2 * t - 1) ** 2
        sect = [(-w, sheer), (-w * 0.94, sheer - 0.1), (-w * 0.72, keel * 0.55),
                (0.0, keel), (w * 0.72, keel * 0.55), (w * 0.94, sheer - 0.1),
                (w, sheer)]
        rings.append([bm.verts.new((sx, yl, sz)) for sx, sz in sect])
    for i in range(stations - 1):
        for k in range(len(rings[0]) - 1):
            bm.faces.new((rings[i][k], rings[i][k + 1],
                          rings[i + 1][k + 1], rings[i + 1][k]))
    bm.faces.new([v for v in rings[0]])
    bm.faces.new(list(reversed(rings[-1])))
    hull = L.bm_to_obj(bm, "WP2_Boat_Hull", coll, m["wood"],
                       smooth_angle=math.radians(38))
    root = L.empty("WP2_Boat_Root", (*BOAT_POS, WATER_Z + 0.14),
                   rotation=(0.015, -0.01, -0.55), coll=coll, size=0.4)
    root["interactive_type"] = "boat"
    hull.parent = root
    hull.location = (0, 0, 0)
    # gunwale rim
    rim_pts = []
    for i in range(stations):
        t = i / (stations - 1)
        yl = -length / 2 + length * t
        w = max(0.09, beam / 2 * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.7)
        sheer = 0.36 + 0.14 * (2 * t - 1) ** 2
        rim_pts.append((w, yl, sheer))
    for i in range(stations - 2, 0, -1):
        t = i / (stations - 1)
        yl = -length / 2 + length * t
        w = max(0.09, beam / 2 * math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.7)
        sheer = 0.36 + 0.14 * (2 * t - 1) ** 2
        rim_pts.append((-w, yl, sheer))
    rim = L.tube("WP2_Boat_Gunwale", rim_pts + rim_pts[:1], 0.055, segs=6,
                 coll=coll, mat=m["wood2"], cap=False)
    rim.parent = root
    rim.location = (0, 0, 0)
    bow_post = L.cylinder("WP2_Boat_BowPost", 0.07, 0.7, segs=8, coll=coll,
                          mat=m["wood2"], radius2=0.05)
    bow_post.parent = root
    bow_post.location = (0, length / 2 - 0.28, 0.55)
    bow_post.rotation_euler = (0.35, 0, 0)

    seat_defs = [
        ("WP2_Boat_Seat_1", (0, 1.55, 0.30), "SELF-PUBLISHING", "researchgate"),
        ("WP2_Boat_Seat_2", (0, 0.78, 0.30), "PODCAST", "hinterstube"),
        ("WP2_Boat_Seat_3", (0, 0.0, 0.30), "KENOPSIUM", "kenopsium"),
        ("WP2_Boat_Seat_4", (0, -0.78, 0.30), "COMING SOON", "soon1"),
        ("WP2_Boat_Seat_5", (0, -1.56, 0.30), "COMING SOON", "soon2"),
    ]
    seat_src = None
    for name, loc, label, link_id in seat_defs:
        if seat_src is None:
            seat = seat_src = L.box(name, (1.5, 0.42, 0.09), coll=coll,
                                    mat=m["wood2"], bevel=0.015)
        else:
            seat = L.inst(seat_src, name, (0, 0, 0), coll=coll)
        seat.parent = root
        seat.location = loc
        label_mat = L.material("Label_Gold", (0.95, 0.78, 0.35), rough=0.4,
                               metal=0.6, emit=(1.0, 0.85, 0.4), emit_str=1.5)
        txt = L.text_mesh(f"{name}_Label", label, font="label", size=0.42,
                          extrude=0.035, coll=coll, mat=label_mat,
                          rotation=(math.pi / 2, 0, math.pi))
        txt.parent = seat
        txt.location = (0, 0, 1.05)
        L.set_props(txt, interactive_type="link", link_id=link_id, billboard=1)

    # rope from bow post to a collar ring around the column base
    import bpy
    bpy.context.view_layer.update()
    bow_world = root.matrix_world @ Vector((0, length / 2 - 0.25, 0.72))
    collar_z = _terrain_fn(*COL_POS) - 0.35 + 1.1   # around plinth B, above water
    collar = Vector((COL_POS[0] - 1.55, COL_POS[1] - 0.4, collar_z))
    L.tube("WP2_Boat_Rope", L.catenary(bow_world, collar, 1.1, segs=16), 0.045,
           segs=6, coll=coll, mat=m["rope"])
    ring_path = L.arc_points((COL_POS[0], COL_POS[1]), 1.62, 0, 2 * math.pi,
                             20, plane='XY', y=collar_z)
    L.sweep("WP2_Rope_Collar",
            [(0.05 * math.cos(a), 0.05 * math.sin(a))
             for a in [i * math.pi / 4 for i in range(8)]],
            ring_path, coll=coll, mat=m["rope"], closed_path=True, cap=False)

    wp = L.empty("cam_wp2_boat_seat", (-5.9, -49.9, 0.75),
                 look_at=(COL_POS[0], COL_POS[1], 15.0), coll=coll,
                 props={"camera_waypoint": "projects_boat"})
    ctx["waypoints"]["projects_boat"] = wp


def build(ctx):
    coll = L.collection("WP2_Garden")
    m = _mats()
    _terrain(coll, m, ctx)
    _waterfalls(coll, m)
    _trees(coll, m)
    _ruins(coll, m)
    _column(coll, m, ctx)
    _boat(coll, m, ctx)
