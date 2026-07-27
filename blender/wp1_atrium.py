# ============================================================================
# wp1_atrium.py — WAYPOINT 1: THE BRUTALIST ATRIUM (around world origin).
#
# Slab-rhythm concrete walls with pilaster fins and cornice, polished roman
# tile floor, long reflecting pool, monolithic arch wall (circular cut with a
# proud voussoir ring), arched quote text, droppable portrait banner
# (shape-key action "banner_drop") and the cam_wp1_home anchor.
# Travel direction is -Y; the archway at y=-15 leads to the garden.
# ============================================================================
import math

from mathutils import Vector

import lib_common as L

QUOTE = "Etwas nicht zu können, ist kein Grund es nicht zu tun."

# Footprint
HALF_W = 9.0          # inner wall distance from center (x)
WALL_Y0, WALL_Y1 = -15.0, 15.0
WALL_H = 11.6
ARCH_R = 4.3
SPRING_Z = 4.6        # arch center height


def _mats():
    return {
        "concrete":  L.material("Brutalist_Concrete", (0.58, 0.56, 0.53), rough=0.92),
        "concrete2": L.material("Brutalist_Concrete_Dark", (0.45, 0.44, 0.42), rough=0.95),
        "tile":      L.material("Roman_Tile_Polished", (0.70, 0.64, 0.55), rough=0.22),
        "tile_dark": L.material("Roman_Tile_Pool", (0.35, 0.36, 0.34), rough=0.30),
        "water":     L.material("Water_Still", (0.12, 0.22, 0.26), rough=0.06,
                                metal=0.1, alpha=0.72, double_sided=True),
        "bronze":    L.material("Bronze_Patina", (0.35, 0.42, 0.34), rough=0.38, metal=0.9),
        "cloth":     L.material("Banner_Cloth", (0.55, 0.16, 0.13), rough=0.85,
                                double_sided=True),
        "rope":      L.material("Rope_Hemp", (0.55, 0.45, 0.30), rough=0.95),
    }


def _arch_wall(coll, mat):
    """Monolithic wall with a circular archway cut; bridged boundary loops."""
    import bmesh
    y_f, y_b = WALL_Y0 + 0.75, WALL_Y0 - 0.75
    inner = []
    # up the left jamb, over the semicircle, down the right jamb
    for i in range(5):
        inner.append((-ARCH_R, SPRING_Z * i / 4))
    for i in range(1, 24):
        a = math.pi - math.pi * i / 24
        inner.append((ARCH_R * math.cos(a), SPRING_Z + ARCH_R * math.sin(a)))
    for i in range(4, -1, -1):
        inner.append((ARCH_R, SPRING_Z * i / 4))

    def outer_pt(px, pz):
        d = Vector((px, pz)) - Vector((0.0, SPRING_Z))
        if d.length < 1e-6:
            d = Vector((0.0, 1.0))
        d.normalize()
        ts = []
        if abs(d.x) > 1e-6:
            for x_edge in (-HALF_W, HALF_W):
                t = (x_edge - 0.0) / d.x
                if t > 0:
                    ts.append(t)
        if abs(d.y) > 1e-6:
            for z_edge in (0.0, WALL_H):
                t = (z_edge - SPRING_Z) / d.y
                if t > 0:
                    ts.append(t)
        t = min(ts)
        p = Vector((0.0, SPRING_Z)) + d * t
        return (max(-HALF_W, min(HALF_W, p.x)), max(0.0, min(WALL_H, p.y)))

    outer = [outer_pt(px, pz) for px, pz in inner]
    bm = bmesh.new()
    v_if = [bm.verts.new((px, y_f, pz)) for px, pz in inner]
    v_ib = [bm.verts.new((px, y_b, pz)) for px, pz in inner]
    v_of = [bm.verts.new((px, y_f, pz)) for px, pz in outer]
    v_ob = [bm.verts.new((px, y_b, pz)) for px, pz in outer]
    n = len(inner)
    for i in range(n - 1):
        bm.faces.new((v_if[i], v_if[i + 1], v_of[i + 1], v_of[i]))      # front ring
        bm.faces.new((v_ob[i], v_ob[i + 1], v_ib[i + 1], v_ib[i]))      # back ring
        bm.faces.new((v_ib[i], v_ib[i + 1], v_if[i + 1], v_if[i]))      # arch tunnel
        if (Vector(outer[i]) - Vector(outer[i + 1])).length > 1e-5:
            bm.faces.new((v_of[i], v_of[i + 1], v_ob[i + 1], v_ob[i]))  # outer skirt
    return L.bm_to_obj(bm, "WP1_Arch_Wall", coll, mat, smooth_angle=math.radians(30),
                       uv_scale=0.3)


def _walls(coll, m):
    n_slabs = 9
    span = WALL_Y1 - WALL_Y0
    step = span / n_slabs
    for side, sx in (("L", -1), ("R", 1)):
        for i in range(n_slabs):
            yc = WALL_Y0 + step * (i + 0.5)
            h = WALL_H + (0.55 if i % 2 else -0.25)
            jitter = 0.14 if i % 2 else -0.10
            slab = L.box(f"WP1_Wall_{side}_{i}", (0.95, step - 0.18, h),
                         location=(sx * (HALF_W + 0.45 + jitter), yc, h / 2),
                         coll=coll, mat=m["concrete"], bevel=0.03)
            L.vertex_noise(slab, 0.35, 0.5, seed=i + (10 if sx > 0 else 0))
        for i in range(4):
            yc = WALL_Y0 + span * (i + 0.5) / 4
            fin = L.box(f"WP1_Fin_{side}_{i}", (0.55, 0.55, WALL_H + 1.1),
                        location=(sx * (HALF_W - 0.15), yc, (WALL_H + 1.1) / 2),
                        coll=coll, mat=m["concrete2"], bevel=0.03)
            L.vertex_noise(fin, 0.3, 0.6, seed=20 + i)
        L.box(f"WP1_Cornice_{side}", (1.4, span + 1.0, 0.85),
              location=(sx * (HALF_W + 0.35), 0, WALL_H + 0.42),
              coll=coll, mat=m["concrete2"], bevel=0.05)


def _floor_and_pool(coll, m, ctx):
    px, py = 1.875, 10.675            # pool outer half-extents (incl. curb)
    fl_l = L.box("WP1_Floor_L", (HALF_W + 1.0 - px, 34, 0.3),
                 location=(-(px + (HALF_W + 1.0 - px) / 2), 0, -0.15),
                 coll=coll, mat=m["tile"], uv_scale=0.5)
    fl_r = L.box("WP1_Floor_R", (HALF_W + 1.0 - px, 34, 0.3),
                 location=(px + (HALF_W + 1.0 - px) / 2, 0, -0.15),
                 coll=coll, mat=m["tile"], uv_scale=0.5)
    ends = []
    for sy in (-1, 1):
        yc = sy * (py + (17.0 - py) / 2)
        ends.append(L.box(f"WP1_Floor_{'S' if sy < 0 else 'N'}",
                          (2 * px, 17.0 - py, 0.3), location=(0, yc, -0.15),
                          coll=coll, mat=m["tile"], uv_scale=0.5))
    # pool basin
    L.box("WP1_Pool_Floor", (3.4, 20.9, 0.12), location=(0, 0, -0.48),
          coll=coll, mat=m["tile_dark"], uv_scale=0.5)
    for sxc in (-1, 1):
        L.box(f"WP1_Pool_Wall_{'W' if sxc < 0 else 'E'}", (0.12, 20.9, 0.45),
              location=(sxc * 1.64, 0, -0.24), coll=coll, mat=m["tile_dark"])
        L.box(f"WP1_Pool_Curb_{'W' if sxc < 0 else 'E'}", (0.42, 21.6, 0.38),
              location=(sxc * 1.815, 0, 0.05), coll=coll, mat=m["concrete2"],
              bevel=0.04)
    for syc in (-1, 1):
        L.box(f"WP1_Pool_Wall_{'S' if syc < 0 else 'N'}", (3.3, 0.12, 0.45),
              location=(0, syc * 10.4, -0.24), coll=coll, mat=m["tile_dark"])
        L.box(f"WP1_Pool_Curb_{'S' if syc < 0 else 'N'}", (4.05, 0.42, 0.38),
              location=(0, syc * 10.46, 0.05), coll=coll, mat=m["concrete2"],
              bevel=0.04)
    water = L.plane("WP1_Pool_Water", 3.28, 20.8, location=(0, 0, -0.14),
                    coll=coll, mat=m["water"], nx=8, ny=52, uv_scale=0.25)
    L.set_props(water, shader="water")
    # approach plaza towards the loop-tunnel mouth
    plaza = L.box("WP1_Plaza", (10, 10, 0.3), location=(0, 20.5, -0.16),
                  coll=coll, mat=m["concrete"], uv_scale=0.4)
    ctx["lightmap"] += [fl_l, fl_r, *ends, plaza]


def _benches(coll, m):
    top = foot = None
    for i, (bx, by) in enumerate(((-5.2, -5.0), (-5.2, 4.0), (5.2, -4.0), (5.2, 5.0))):
        if top is None:
            top = L.box("WP1_Bench_Top", (0.7, 2.6, 0.16), location=(bx, by, 0.52),
                        coll=coll, mat=m["concrete2"], bevel=0.03)
            foot = L.box("WP1_Bench_Foot", (0.5, 2.0, 0.44),
                         location=(bx, by, 0.22), coll=coll, mat=m["concrete"])
        else:
            L.inst(top, f"WP1_Bench_Top_{i}", (bx, by, 0.52), coll=coll)
            L.inst(foot, f"WP1_Bench_Foot_{i}", (bx, by, 0.22), coll=coll)


def _entrance(coll, m):
    for sx in (-1, 1):
        p = L.box(f"WP1_Gate_Pier_{'W' if sx < 0 else 'E'}", (1.3, 1.3, 7.6),
                  location=(sx * 3.9, 15.6, 3.8), coll=coll, mat=m["concrete"],
                  bevel=0.04)
        L.vertex_noise(p, 0.3, 0.5, seed=31 + sx)
    L.box("WP1_Gate_Lintel", (9.4, 1.7, 1.7), location=(0, 15.6, 8.4),
          coll=coll, mat=m["concrete2"], bevel=0.05)


def _voussoirs(coll, m):
    mid_r = ARCH_R + 0.62
    path = L.arc_points((0.0, SPRING_Z), mid_r, 0.0, math.pi, 13,
                        plane='XZ', y=WALL_Y0 + 0.9)
    prof = [(-0.62, -0.55), (0.62, -0.55), (0.62, 0.55), (-0.62, 0.55)]
    ring = L.sweep("WP1_Arch_Voussoirs", prof, path, coll=coll, mat=m["concrete2"],
                   smooth_angle=math.radians(10))
    L.vertex_noise(ring, 0.3, 0.7, seed=7)
    L.box("WP1_Architrave", (2 * HALF_W + 1.2, 1.9, 1.05),
          location=(0, WALL_Y0, WALL_H + 0.5), coll=coll, mat=m["concrete"],
          bevel=0.05)


def _quote(coll, m):
    L.text_mesh("WP1_Text_Quote", QUOTE, font="quote", size=0.62, extrude=0.06,
                coll=coll, mat=m["bronze"], align_y='BOTTOM_BASELINE',
                warp=L.arch_warp(radius=ARCH_R + 1.55, y_plane=WALL_Y0 + 0.82,
                                 z_center=SPRING_Z))


def _banner(coll, m):
    import bpy
    w, h = 6.6, 9.6
    y_pos, z_top = WALL_Y0 + 1.9, 10.9
    banner = L.plane("WP1_Banner", w, h, nx=16, ny=26, coll=coll, mat=m["cloth"],
                     location=(0, y_pos, z_top - h / 2),
                     rotation=(-math.pi / 2, 0, 0), uv_scale=None)
    me = banner.data
    # normalized 0..1 UVs for the portrait+text texture
    uvl = me.uv_layers.new(name="UVMap") if not me.uv_layers else me.uv_layers[0]
    for poly in me.polygons:
        for li in poly.loop_indices:
            vco = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (vco.x / w + 0.5, 0.5 - vco.y / h)
    # gentle cloth billow baked into the base shape (local +z faces the viewer)
    from mathutils import noise as mnoise
    for vt in me.vertices:
        edge_hold = L.smoothstep(0.0, 0.35, abs(vt.co.y / h + 0.5))
        vt.co.z += 0.16 * edge_hold * mnoise.noise(Vector((vt.co.x * 0.9,
                                                           vt.co.y * 0.6, 0.5)))
    me.update()
    banner.shape_key_add(name="Basis")
    rolled = banner.shape_key_add(name="Rolled")
    top = -h / 2  # local -y edge hangs at the rod after the -90° X rotation
    for i, vt in enumerate(me.vertices):
        co = rolled.data[i].co
        co.y = top + (co.y - top) * 0.045
        co.x *= 0.92
        co.z += 0.1
    L.make_action(banner.data.shape_keys, "banner_drop",
                  [('key_blocks["Rolled"].value', None,
                    [(1, 1.0), (61, 0.0)], None)])
    banner.data.shape_keys.key_blocks["Rolled"].value = 0.0
    L.set_props(banner, interactive_type="banner", texture_slot="portrait")
    rod = L.cylinder("WP1_Banner_Rod", 0.07, w + 0.6, segs=10,
                     location=(0, y_pos, z_top + 0.06),
                     rotation=(0, math.pi / 2, 0), coll=coll, mat=m["bronze"])
    for sx in (-1, 1):
        L.tube(f"WP1_Banner_Rope_{'W' if sx < 0 else 'E'}",
               [(sx * (w / 2 + 0.2), y_pos, z_top + 0.02),
                (sx * (w / 2 + 0.28), WALL_Y0 + 1.0, WALL_H + 0.15)],
               0.028, segs=6, coll=coll, mat=m["rope"])
    return banner


def build(ctx):
    coll = L.collection("WP1_Atrium")
    m = _mats()
    _floor_and_pool(coll, m, ctx)
    _walls(coll, m)
    wall = _arch_wall(coll, m["concrete"])
    L.vertex_noise(wall, 0.35, 0.45, seed=3)
    ctx["lightmap"].append(wall)
    _voussoirs(coll, m)
    _quote(coll, m)
    _banner(coll, m)
    _benches(coll, m)
    _entrance(coll, m)

    # Place identical single DT1 subway car on the Atrium plaza
    import wp4_metro
    dt1_mats = wp4_metro._mats()
    wp4_metro.build_single_dt1_car(coll, dt1_mats, "DT1_Atrium_Car1", y0=38.0, x_off=-3.2)

    wp = L.empty("cam_wp1_home", (0, 8.5, 2.6), look_at=(0, -15, 4.8),
                 coll=coll, props={"camera_waypoint": "home"})
    ctx["waypoints"]["home"] = wp

