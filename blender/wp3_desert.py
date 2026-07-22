# ============================================================================
# wp3_desert.py — WAYPOINT 3: THE WESTERN DESERT & SALOON (y ≈ -120, z ≈ -10).
#
# The canyon from the waterfall gate drops through a slot between red-rock
# walls into an arid bowl: stratified cliff modules, saguaro cacti, a water
# trough with two horses, the ÜBER MICH ranch sign, and the saloon — raised
# plank porch, false front, batwing doors (action "saloon_doors_swing"), bar
# with bottles/mirror/lamps and the open leather menu book (bio/resume pages).
# Anchor: cam_wp3_about. The slot canyon continues south to the mine portal.
# ============================================================================
import math

import lib_common as L
import wp2_garden as G

SALOON = (0.0, -127.0, -10.0)
BOOK = (-1.2, -129.15, -8.77)
FLOOR_Z = -9.7          # deck + interior floor level
WALL_H = 3.4


def spine_x(y):
    if -124.0 < y < -105.0:
        return 1.8 * math.sin(math.pi * (y + 105.0) / -19.0)
    return 0.0


def spine_z(y):
    pts = [(-101.0, -5.0), (-106.0, -6.2), (-113.0, -8.2), (-121.0, -9.7),
           (-124.0, -10.0), (-146.0, -10.0)]
    if y >= pts[0][0]:
        return -5.0
    if y <= pts[-1][0]:
        return -10.0
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if y1 <= y <= y0:
            t = L.smoothstep(0.0, 1.0, (y0 - y) / (y0 - y1))
            return z0 + (z1 - z0) * t
    return -10.0


def _terrain_fn(x, y):
    base = -8.0 + 3.0 * L.fractal2d(x, y, scale=0.021, octaves=5, seed=7.0)
    for cx, cy, r, h in ((0, -158, 30, 40),                      # mine mountain
                         (-44, -128, 24, 15), (46, -122, 22, 14),
                         (-36, -150, 24, 13), (38, -152, 22, 12),
                         (-46, -102, 17, 15), (46, -102, 17, 15),
                         (-12, -94, 9, 17), (12, -97, 9, 16),
                         (-13, -102, 8, 15), (13, -105, 8, 14)):
        base += L.gauss_bump(x, y, cx, cy, r, h)
    w, fall = (3.5, 3.0) if y > -113 or y < -137 else (6.0, 5.0)
    d = abs(x - spine_x(y))
    m = L.smoothstep(w + fall, w, d)
    z = base * (1 - m) + spine_z(y) * m
    # flat pad under the saloon
    dx = max(0.0, abs(x - SALOON[0]) - 9.0)
    dy = max(0.0, abs(y - SALOON[1]) - 9.0)
    pad = L.smoothstep(4.0, 0.5, math.hypot(dx, dy))
    z = z * (1 - pad) + -10.0 * pad
    # duck under the garden terrain in the overlap band so seams stay hidden
    if y > -102.0:
        gz = G._terrain_fn(x, y) - 0.3
        t = L.smoothstep(-102.0, -95.0, y)
        z = z * (1 - t) + gz * t
    return z


def _mats():
    return {
        "sand":     L.material("Desert_Sand", (0.70, 0.50, 0.30), rough=1.0),
        "redrock":  L.material("Red_Rock", (0.60, 0.28, 0.16), rough=0.95),
        "redrock2": L.material("Red_Rock_Dark", (0.46, 0.20, 0.12), rough=0.95),
        "wood":     L.material("Weathered_Wood", (0.45, 0.36, 0.27), rough=0.9),
        "wood_d":   L.material("Weathered_Wood_Dark", (0.32, 0.25, 0.19), rough=0.92),
        "plank":    L.material("Saloon_Plank", (0.55, 0.42, 0.28), rough=0.85),
        "bar":      L.material("Bar_Counter_Polished", (0.30, 0.16, 0.08), rough=0.25),
        "brass":    L.material("Brass_Rail", (0.75, 0.6, 0.3), rough=0.3, metal=1.0),
        "leather":  L.material("Menu_Leather", (0.30, 0.16, 0.10), rough=0.6),
        "page":     L.material("Menu_Pages", (0.92, 0.88, 0.80), rough=0.85),
        "glass_w":  L.material("Saloon_Window", (1.0, 0.8, 0.45), rough=0.4,
                               emit=(1.0, 0.75, 0.4), emit_str=2.0),
        "mirror":   L.material("Bar_Mirror", (0.85, 0.88, 0.9), rough=0.04, metal=1.0),
        "bottle_g": L.material("Bottle_Green", (0.15, 0.4, 0.2), rough=0.15,
                               alpha=0.8),
        "bottle_b": L.material("Bottle_Amber", (0.5, 0.3, 0.1), rough=0.15,
                               alpha=0.8),
        "cactus":   L.material("Cactus_Green", (0.25, 0.42, 0.24), rough=0.9),
        "water":    L.material("Water_Trough", (0.15, 0.28, 0.28), rough=0.1,
                               alpha=0.8, double_sided=True),
        "horse_a":  L.material("Horse_Bay", (0.38, 0.24, 0.16), rough=0.9),
        "horse_b":  L.material("Horse_Dun", (0.55, 0.44, 0.32), rough=0.9),
        "mane":     L.material("Horse_Mane", (0.15, 0.11, 0.09), rough=0.95),
    }


def _terrain(coll, m, ctx):
    terr = L.heightfield("WP3_Terrain", (0, -122), (130, 64), (110, 60),
                         _terrain_fn, coll=coll, mat=m["sand"])
    L.vertex_noise(terr, 0.12, 0.08, seed=13)
    ctx["lightmap"].append(terr)


def _cliffs(coll, m):
    variants = []
    for v in range(3):
        base_w = 3.2 + v * 1.1
        stack = None
        zc = 0.0
        for lay in range(4 + v):
            h = 1.1 + 0.5 * ((lay * 7 + v * 3) % 3)
            w = base_w * (1.0 - 0.09 * lay) * (1 + 0.12 * ((lay + v) % 2))
            d = base_w * (0.9 - 0.07 * lay)
            mat = m["redrock"] if (lay + v) % 2 else m["redrock2"]
            b = L.box(f"WP3_Cliff{v}_L{lay}", (w, d, h),
                      location=(0.15 * ((lay * 5 + v) % 3 - 1),
                                0.12 * ((lay * 3) % 3 - 1), -400 + zc + h / 2),
                      rotation=(0, 0, 0.09 * ((lay + v) % 5 - 2)),
                      coll=coll, mat=mat, bevel=0.06)
            b.hide_render = True
            b.hide_viewport = True
            zc += h * 0.92
            if stack is None:
                stack = []
            stack.append((b, b.location.z + 400.0))
        variants.append(stack)
    spots = [(-9, -95, 0, 0.8), (9.5, -98, 1, 0.9), (-10, -103, 2, 0.85),
             (10.5, -106, 0, 0.75), (-8, -109, 1, 0.7),
             (-26, -122, 2, 1.6), (24, -117, 0, 1.5), (-18, -136, 1, 1.3),
             (18, -140, 2, 1.4), (-34, -112, 0, 1.8), (34, -132, 1, 1.7),
             (12, -126, 2, 0.7), (-14, -120, 0, 0.6)]
    for i, (x, y, v, s) in enumerate(spots):
        z = _terrain_fn(x, y) - 0.4
        rz = i * 0.9
        for k, (b, lz) in enumerate(variants[v]):
            L.inst(b, f"WP3_Cliff_{i}_{k}", (x, y, z + lz * s),
                   rotation=(0, 0, rz + 0.09 * (k % 3)), scale=s, coll=coll)


def _cacti(coll, m):
    variants = []
    for v in range(3):
        h = 2.2 + v * 0.8
        trunk = L.tube(f"WP3_Cactus{v}", [(0, 0, 0), (0, 0, h * 0.55), (0, 0, h)],
                       [0.24, 0.22, 0.16], segs=10, coll=coll, mat=m["cactus"])
        trunk.location = (0, 0, -400)
        arms = []
        for side in (-1, 1) if v != 1 else (-1,):
            ah = h * (0.38 + 0.12 * v / 2)
            pts = [(0, 0, ah), (side * 0.45, 0, ah + 0.12),
                   (side * 0.62, 0, ah + 0.5), (side * 0.62, 0, ah + 1.0)]
            arm = L.tube(f"WP3_Cactus{v}_Arm{side}", pts, [0.13, 0.13, 0.12, 0.10],
                         segs=8, coll=coll, mat=m["cactus"])
            arm.location = (0, 0, -400)
            arms.append(arm)
        group = [trunk] + arms
        for o in group:
            o.hide_render = True
            o.hide_viewport = True
        variants.append(group)
    spots = [(-12, -114, 0), (14, -119, 1), (-16, -128, 2), (9, -133, 0),
             (-7, -138, 1), (20, -128, 2), (-22, -117, 1), (16, -111, 0),
             (6, -142, 2), (-13, -143, 0)]
    for i, (x, y, v) in enumerate(spots):
        z = _terrain_fn(x, y) - 0.05
        for k, part in enumerate(variants[v]):
            L.inst(part, f"WP3_Cactus_{i}_{k}", (x, y, z),
                   rotation=(0, 0, i * 1.3), scale=0.8 + (i % 3) * 0.2, coll=coll)


def _horse(coll, m, name, pos, rz, graze, body_mat):
    root = L.empty(f"{name}_Root", pos, rotation=(0, 0, rz), coll=coll, size=0.3)

    def part(obj, loc, rot=(0, 0, 0)):
        obj.parent = root
        obj.location = loc
        obj.rotation_euler = rot
        return obj

    part(L.box(f"{name}_Body", (0.62, 1.55, 0.66), coll=coll, mat=body_mat,
               bevel=0.09, bevel_segs=3, smooth_angle=math.radians(46)),
         (0, 0, 1.12))
    neck_rot = (1.02, 0, 0) if graze else (0.42, 0, 0)
    part(L.box(f"{name}_Neck", (0.26, 0.78, 0.3), coll=coll, mat=body_mat,
               bevel=0.06, smooth_angle=math.radians(46)),
         (0, 0.86, 1.28 if not graze else 1.02), neck_rot)
    head_loc = (0, 1.12, 1.62) if not graze else (0, 1.16, 0.58)
    head_rot = (0.5, 0, 0) if not graze else (1.42, 0, 0)
    part(L.box(f"{name}_Head", (0.20, 0.48, 0.22), coll=coll, mat=body_mat,
               bevel=0.05, smooth_angle=math.radians(46)), head_loc, head_rot)
    ear_loc_z = head_loc[2] + (0.16 if not graze else 0.2)
    ear_loc_y = head_loc[1] - (0.18 if not graze else 0.05)
    for sx in (-1, 1):
        part(L.cylinder(f"{name}_Ear{'L' if sx < 0 else 'R'}", 0.045, 0.16,
                        segs=6, radius2=0.01, coll=coll, mat=m["mane"]),
             (sx * 0.09, ear_loc_y, ear_loc_z), (0.3, 0, 0))
    part(L.box(f"{name}_Mane", (0.06, 0.68, 0.18), coll=coll, mat=m["mane"],
               bevel=0.02), (0, 0.74, 1.42 if not graze else 1.14), neck_rot)
    for i, (lx, ly) in enumerate(((-0.22, 0.55), (0.22, 0.55),
                                  (-0.22, -0.55), (0.22, -0.55))):
        part(L.cylinder(f"{name}_Leg{i}", 0.075, 0.85, segs=7, radius2=0.055,
                        coll=coll, mat=body_mat), (lx, ly, 0.42))
        part(L.box(f"{name}_Hoof{i}", (0.14, 0.16, 0.1), coll=coll,
                   mat=m["mane"]), (lx, ly, 0.05))
    tail_pts = [(0, -0.78, 1.25), (0, -0.95, 1.0), (0, -0.98, 0.6)]
    part(L.tube(f"{name}_Tail", tail_pts, [0.07, 0.06, 0.03], segs=6,
                coll=coll, mat=m["mane"]), (0, 0, 0))
    return root


def _trough_and_horses(coll, m):
    tx, ty = 7.0, -120.5
    tz = _terrain_fn(tx, ty)
    for sx in (-1, 1):
        L.box(f"WP3_Trough_Side{'W' if sx < 0 else 'E'}", (0.08, 2.2, 0.5),
              location=(tx + sx * 0.45, ty, tz + 0.45), coll=coll, mat=m["wood_d"])
    for sy in (-1, 1):
        L.box(f"WP3_Trough_End{'S' if sy < 0 else 'N'}", (0.98, 0.08, 0.5),
              location=(tx, ty + sy * 1.06, tz + 0.45), coll=coll, mat=m["wood_d"])
    L.box("WP3_Trough_Bottom", (0.95, 2.2, 0.08), location=(tx, ty, tz + 0.24),
          coll=coll, mat=m["wood_d"])
    for sy in (-1, 1):
        L.box(f"WP3_Trough_Leg{'S' if sy < 0 else 'N'}", (1.1, 0.12, 0.28),
              location=(tx, ty + sy * 0.8, tz + 0.14), coll=coll, mat=m["wood"])
    w = L.plane("WP3_Trough_Water", 0.84, 2.05, location=(tx, ty, tz + 0.58),
                coll=coll, mat=m["water"], nx=2, ny=4)
    L.set_props(w, shader="water")
    _horse(coll, m, "WP3_Horse_A", (tx + 1.3, ty + 0.4, tz), math.pi / 2 + 0.2,
           True, m["horse_a"])
    _horse(coll, m, "WP3_Horse_B", (tx + 2.8, ty - 2.2, tz - 0.05), -0.6,
           False, m["horse_b"])


def _ranch_sign(coll, m):
    sy = -106.5
    sz = _terrain_fn(0.0, sy)
    for sx in (-1, 1):
        L.box(f"WP3_Sign_Post{'W' if sx < 0 else 'E'}", (0.22, 0.22, 4.4),
              location=(sx * 2.4, sy, sz + 2.2), coll=coll, mat=m["wood_d"],
              rotation=(0, sx * 0.03, 0), bevel=0.02)
    L.box("WP3_Sign_Beam", (5.6, 0.26, 0.3), location=(0, sy, sz + 4.35),
          coll=coll, mat=m["wood"], rotation=(0, 0.02, 0), bevel=0.02)
    for sx in (-1, 1):
        L.tube(f"WP3_Sign_Rope{'W' if sx < 0 else 'E'}",
               [(sx * 1.5, sy, sz + 4.2), (sx * 1.42, sy, sz + 3.75)],
               0.03, segs=5, coll=coll, mat=m["wood_d"])
    plank_mat = L.material("Sign_Plank_Light", (0.62, 0.50, 0.35), rough=0.85)
    plank = L.box("WP3_Sign_Plank", (4.3, 0.12, 1.0),
                  location=(0, sy, sz + 3.35), coll=coll, mat=plank_mat,
                  rotation=(0, 0, 0.015), bevel=0.02)
    L.vertex_noise(plank, 0.2, 1.2, seed=17)
    txt_mat = L.material("Sign_Text_Dark", (0.07, 0.05, 0.04), rough=0.9)
    txt = L.text_mesh("WP3_Text_UeberMich", "ÜBER MICH", font="western",
                      size=0.56, extrude=0.05, coll=coll, mat=txt_mat,
                      rotation=(math.pi / 2, 0, math.pi),
                      location=(0, sy - 0.12, sz + 3.14))
    L.set_props(txt, interactive_type="text", content="about_title")


def _saloon_shell(coll, m, ctx):
    cx, cy, gz = SALOON
    fw_y = cy + 2.4            # front wall
    bw_y = cy - 5.2            # back wall
    # raised plank deck + steps
    deck = []
    for i in range(21):
        px = -4.9 + i * 0.49
        d = L.box(f"WP3_Deck_Plank{i}", (0.45, 2.5, 0.1),
                  location=(px, fw_y + 1.35, FLOOR_Z - 0.05
                            + 0.012 * ((i * 3) % 3 - 1)),
                  coll=coll, mat=m["plank"], bevel=0.012)
        deck.append(d)
    for s in range(2):
        L.box(f"WP3_Deck_Step{s}", (2.2, 0.4, 0.1),
              location=(0, fw_y + 2.75 + s * 0.4, FLOOR_Z - 0.16 - s * 0.11),
              coll=coll, mat=m["plank"])
    for i, px in enumerate((-4.4, -1.5, 1.5, 4.4)):
        L.cylinder(f"WP3_Porch_Post{i}", 0.1, 2.75, segs=10,
                   location=(px, fw_y + 2.35, FLOOR_Z + 1.38), coll=coll,
                   mat=m["wood_d"])
        L.box(f"WP3_Porch_Cap{i}", (0.26, 0.26, 0.1),
              location=(px, fw_y + 2.35, FLOOR_Z + 2.8), coll=coll, mat=m["wood_d"])
    roof = L.box("WP3_Porch_Roof", (10.6, 3.2, 0.12),
                 location=(0, fw_y + 1.15, FLOOR_Z + 3.25),
                 rotation=(0.2, 0, 0), coll=coll, mat=m["wood_d"])
    L.box("WP3_Porch_Fascia", (10.6, 0.08, 0.5),
          location=(0, fw_y + 2.62, FLOOR_Z + 2.98), coll=coll, mat=m["wood"])
    # side rails between porch posts
    for sx in (-1, 1):
        L.box(f"WP3_Porch_Rail{'W' if sx < 0 else 'E'}", (0.08, 2.3, 0.08),
              location=(sx * 4.85, fw_y + 1.3, FLOOR_Z + 0.95), coll=coll,
              mat=m["wood"])
        for k in range(3):
            L.box(f"WP3_Porch_Baluster{'W' if sx < 0 else 'E'}{k}",
                  (0.06, 0.06, 0.9),
                  location=(sx * 4.85, fw_y + 0.55 + k * 0.75, FLOOR_Z + 0.5),
                  coll=coll, mat=m["wood"])
    # walls (front wall = false front with doorway gap)
    door_w, door_h = 1.7, 2.5
    front_h = 5.6
    L.box("WP3_Wall_Front_L", ((9.6 - door_w) / 2, 0.18, front_h),
          location=(-(door_w / 2 + (9.6 - door_w) / 4), fw_y, gz + front_h / 2),
          coll=coll, mat=m["plank"])
    L.box("WP3_Wall_Front_R", ((9.6 - door_w) / 2, 0.18, front_h),
          location=(door_w / 2 + (9.6 - door_w) / 4, fw_y, gz + front_h / 2),
          coll=coll, mat=m["plank"])
    L.box("WP3_Wall_Front_Top", (door_w, 0.18, front_h - door_h - 0.3),
          location=(0, fw_y, gz + door_h + 0.3 + (front_h - door_h - 0.3) / 2),
          coll=coll, mat=m["plank"])
    # false-front parapet steps
    L.box("WP3_Parapet_Mid", (5.4, 0.22, 0.5), location=(0, fw_y, gz + front_h + 0.22),
          coll=coll, mat=m["plank"])
    L.box("WP3_Parapet_Top", (2.6, 0.22, 0.4), location=(0, fw_y, gz + front_h + 0.62),
          coll=coll, mat=m["plank"])
    # horizontal siding strips, segmented around the doorway and windows
    for k in range(9):
        z = gz + 0.45 + k * 0.6
        if z > gz + door_h:
            segs = [(-4.81, 4.81)]
        elif gz + 1.1 < z < gz + 2.7:      # window band
            segs = [(-4.81, -3.85), (-2.15, -1.0), (1.0, 2.15), (3.85, 4.81)]
        else:
            segs = [(-4.81, -1.0), (1.0, 4.81)]
        for si, (a, b) in enumerate(segs):
            L.box(f"WP3_Siding{k}_{si}", (b - a, 0.05, 0.09),
                  location=((a + b) / 2, fw_y + 0.1, z), coll=coll,
                  mat=m["wood_d"])
    # back wall with rear doorway (x = 1.2)
    bd_w, bd_h, bd_x = 1.4, 2.5, 1.2
    L.box("WP3_Wall_Back_L", ((bd_x - bd_w / 2) + 4.8, 0.18, WALL_H),
          location=(-4.8 + ((bd_x - bd_w / 2) + 4.8) / 2, bw_y, gz + WALL_H / 2),
          coll=coll, mat=m["plank"])
    L.box("WP3_Wall_Back_R", (4.8 - (bd_x + bd_w / 2), 0.18, WALL_H),
          location=(bd_x + bd_w / 2 + (4.8 - (bd_x + bd_w / 2)) / 2, bw_y,
                    gz + WALL_H / 2),
          coll=coll, mat=m["plank"])
    L.box("WP3_Wall_Back_Top", (bd_w, 0.18, WALL_H - bd_h),
          location=(bd_x, bw_y, gz + bd_h + (WALL_H - bd_h) / 2),
          coll=coll, mat=m["plank"])
    for sx in (-1, 1):
        L.box(f"WP3_Wall_Side{'W' if sx < 0 else 'E'}", (0.18, 7.6, WALL_H),
              location=(sx * 4.8, cy - 1.4, gz + WALL_H / 2), coll=coll,
              mat=m["plank"])
    L.box("WP3_Roof_Main", (10.0, 8.2, 0.14),
          location=(0, cy - 1.5, gz + WALL_H + 0.32), rotation=(0.08, 0, 0),
          coll=coll, mat=m["wood_d"])
    floor = L.box("WP3_Saloon_Floor", (9.6, 7.8, 0.12),
                  location=(0, cy - 1.4, FLOOR_Z - 0.06), coll=coll,
                  mat=m["plank"], uv_scale=0.5)
    ctx["lightmap"] += [floor]
    # front windows
    for sx in (-1, 1):
        L.box(f"WP3_Window_Frame{'W' if sx < 0 else 'E'}", (1.3, 0.1, 1.5),
              location=(sx * 3.0, fw_y + 0.06, gz + 1.9), coll=coll,
              mat=m["wood_d"])
        L.plane(f"WP3_Window_Glass{'W' if sx < 0 else 'E'}", 1.05, 1.25,
                location=(sx * 3.0, fw_y + 0.12, gz + 1.9),
                rotation=(math.pi / 2, 0, math.pi), coll=coll, mat=m["glass_w"])
    txt = L.text_mesh("WP3_Text_Saloon", "SALOON", font="western", size=0.72,
                      extrude=0.06, coll=coll, mat=m["wood_d"],
                      rotation=(math.pi / 2, 0, math.pi),
                      location=(0, fw_y - 0.14, gz + 4.6))
    L.vertex_noise(txt, 0.2, 2.0, seed=23)
    # batwing doors, origin on the hinge edge
    import bmesh
    for sx, tag in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.78, 0.06, 1.15), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(sx * -0.39, 0, 0), verts=bm.verts)
        leaf = L.bm_to_obj(bm, f"WP3_Batwing_{tag}", coll, m["wood_d"])
        leaf.location = (sx * 0.82, fw_y, FLOOR_Z + 1.32)
        swing = [(1, 0.0), (18, sx * 0.85), (42, sx * -0.28), (66, sx * 0.34),
                 (88, sx * -0.1), (110, 0.0)]
        L.make_action(leaf, "saloon_doors_swing",
                      [("rotation_euler", 2, swing, None)])
    return deck


def _saloon_interior(coll, m, ctx):
    cx, cy, gz = SALOON
    bar_y = cy - 2.4
    top = L.box("WP3_Bar_Top", (5.4, 0.8, 0.09), location=(-1.2, bar_y, gz + 1.18),
                coll=coll, mat=m["bar"], bevel=0.025)
    ctx["lightmap"].append(top)
    L.box("WP3_Bar_Front", (5.2, 0.1, 1.1), location=(-1.2, bar_y + 0.32, gz + 0.58),
          coll=coll, mat=m["wood_d"])
    for k in range(3):
        L.box(f"WP3_Bar_Panel{k}", (1.35, 0.05, 0.7),
              location=(-2.7 + k * 1.55, bar_y + 0.38, gz + 0.58), coll=coll,
              mat=m["plank"])
    L.tube("WP3_Bar_FootRail", [(-3.7, bar_y + 0.55, gz + 0.18),
                                (1.4, bar_y + 0.55, gz + 0.18)],
           0.04, segs=8, coll=coll, mat=m["brass"])
    # back bar: shelves, mirror, bottles
    shelf_y = cy - 4.9
    L.box("WP3_BackBar_Cabinet", (4.6, 0.5, 1.0), location=(-1.2, shelf_y, gz + 0.5),
          coll=coll, mat=m["wood_d"])
    for k in range(2):
        L.box(f"WP3_BackBar_Shelf{k}", (4.4, 0.35, 0.05),
              location=(-1.2, shelf_y, gz + 1.35 + k * 0.55), coll=coll,
              mat=m["wood_d"])
    L.plane("WP3_Bar_Mirror", 3.6, 1.4, location=(-1.2, shelf_y - 0.12, gz + 1.95),
            rotation=(math.pi / 2, 0, 0), coll=coll, mat=m["mirror"])
    bot = None
    for i in range(12):
        x = -3.2 + (i % 6) * 0.8
        z = gz + 1.42 + (i // 6) * 0.55
        if bot is None:
            bot = L.tube("WP3_Bottle", [(0, 0, 0), (0, 0, 0.2), (0, 0, 0.25),
                                        (0, 0, 0.36)],
                         [0.055, 0.055, 0.021, 0.019], segs=9, coll=coll,
                         mat=m["bottle_g"])
            bot.location = (x, shelf_y, z)
        else:
            b = L.inst(bot, f"WP3_Bottle_{i}", (x, shelf_y, z),
                       rotation=i * 0.7, coll=coll)
            if i % 2 == 1 and len(b.material_slots):
                b.material_slots[0].link = 'OBJECT'
                b.material_slots[0].material = m["bottle_b"]
    # stools
    stool = None
    for i, sxp in enumerate((-3.0, -1.2, 0.6)):
        if stool is None:
            stool = L.cylinder("WP3_Stool_Seat", 0.24, 0.07, segs=12,
                               location=(sxp, bar_y + 1.1, gz + 0.72), coll=coll,
                               mat=m["leather"])
            L.cylinder("WP3_Stool_Pole", 0.05, 0.7, segs=8,
                       location=(sxp, bar_y + 1.1, gz + 0.35), coll=coll,
                       mat=m["wood_d"])
            L.cylinder("WP3_Stool_Base", 0.2, 0.05, segs=10,
                       location=(sxp, bar_y + 1.1, gz + 0.03), coll=coll,
                       mat=m["wood_d"])
        else:
            L.inst(stool, f"WP3_Stool_Seat_{i}", (sxp, bar_y + 1.1, gz + 0.72),
                   coll=coll)
            L.cylinder(f"WP3_Stool_Pole_{i}", 0.05, 0.7, segs=8,
                       location=(sxp, bar_y + 1.1, gz + 0.35), coll=coll,
                       mat=m["wood_d"])
            L.cylinder(f"WP3_Stool_Base_{i}", 0.2, 0.05, segs=10,
                       location=(sxp, bar_y + 1.1, gz + 0.03), coll=coll,
                       mat=m["wood_d"])
    # hanging lamps
    for i, lx in enumerate((-2.4, 1.0)):
        L.tube(f"WP3_Lamp_Cord{i}", [(lx, bar_y, gz + WALL_H),
                                     (lx, bar_y, gz + 2.6)], 0.015, segs=5,
               coll=coll, mat=m["wood_d"])
        L.cylinder(f"WP3_Lamp_Shade{i}", 0.3, 0.22, segs=12, radius2=0.08,
                   location=(lx, bar_y, gz + 2.5), coll=coll, mat=m["brass"])
        bulb = L.sphere(f"WP3_Lamp_Bulb{i}", 0.07, (lx, bar_y, gz + 2.42),
                        coll=coll,
                        mat=L.material("Lamp_Glow", (1, 0.85, 0.6), rough=0.5,
                                       emit=(1.0, 0.8, 0.5), emit_str=8.0))
    import bpy
    for i, lx in enumerate((-2.4, 1.0)):
        li = bpy.data.lights.new(f"WP3_Lamp_Light{i}", type='POINT')
        li.energy = 60.0
        li.color = (1.0, 0.75, 0.45)
        lo = bpy.data.objects.new(f"WP3_Lamp_Light{i}", li)
        lo.location = (lx, bar_y, gz + 2.3)
        L.link(lo, coll)


def _menu_book(coll, m, ctx):
    bx, by, bz = BOOK
    root = L.empty("WP3_MenuBook_Root", (bx, by, bz), rotation=(0, 0, 0.35),
                   coll=coll, size=0.2)

    def part(obj, loc, rot=(0, 0, 0)):
        obj.parent = root
        obj.location = loc
        obj.rotation_euler = rot
        return obj

    part(L.box("WP3_MenuBook_Cover", (0.66, 0.48, 0.025), coll=coll,
               mat=m["leather"], bevel=0.008), (0, 0, 0.012))
    part(L.box("WP3_MenuBook_Spine", (0.05, 0.48, 0.045), coll=coll,
               mat=m["leather"]), (0, 0, 0.03))
    for sx, tag, page in ((-1, "L", "bio"), (1, "R", "resume")):
        part(L.box(f"WP3_MenuBook_Stack_{tag}", (0.29, 0.44, 0.02), coll=coll,
                   mat=m["page"]), (sx * 0.16, 0, 0.035))
        pg = L.plane(f"WP3_MenuBook_Page_{tag}", 0.30, 0.45, nx=4, ny=2,
                     coll=coll, mat=m["page"], uv_scale=None)
        me = pg.data
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vco = me.vertices[me.loops[li].vertex_index].co
                uvl.data[li].uv = (vco.x / 0.30 + 0.5, vco.y / 0.45 + 0.5)
        part(pg, (sx * 0.155, 0, 0.048), (0, sx * -0.12, 0))
        L.set_props(pg, interactive_type="page", page=page)
    wp = L.empty("cam_wp3_about", (bx + 0.05, by + 1.05, bz + 0.72),
                 look_at=(bx, by, bz), coll=coll,
                 props={"camera_waypoint": "about"})
    ctx["waypoints"]["about"] = wp


def build(ctx):
    coll = L.collection("WP3_Desert")
    m = _mats()
    _terrain(coll, m, ctx)
    _cliffs(coll, m)
    _cacti(coll, m)
    _trough_and_horses(coll, m)
    _ranch_sign(coll, m)
    _saloon_shell(coll, m, ctx)
    _saloon_interior(coll, m, ctx)
    _menu_book(coll, m, ctx)
