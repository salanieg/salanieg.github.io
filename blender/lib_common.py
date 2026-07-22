# ============================================================================
# lib_common.py — shared toolkit for the portfolio-world generator.
#
# Everything is built with bmesh in local/world space (no modifiers left on
# objects), so the glTF export needs no "apply modifiers" pass and shape keys /
# NLA actions survive untouched. Target: Blender 5.2 LTS, headless-safe.
# ============================================================================
import math
import os
import textwrap

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector, noise

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Repo fonts (already shipped with the website) → thematic roles.
FONT_FILES = {
    "quote":    os.path.join(REPO, "src", "assets", "Jost-Regular.ttf"),
    "engrave":  os.path.join(REPO, "src", "assets", "Geist-Regular.ttf"),
    "label":    os.path.join(REPO, "fonts", "Anybody", "Anybody-Black.ttf"),
    "western":  os.path.join(REPO, "fonts", "Syne", "Syne-ExtraBold.ttf"),
    "graffiti": os.path.join(REPO, "src", "assets", "DonGraffiti.ttf"),
    "matrix":   os.path.join(REPO, "src", "assets", "Doto-Bold.ttf"),
}
_font_cache = {}
_mat_cache = {}


# ---------------------------------------------------------------- scene/coll --
def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block_list in (bpy.data.meshes, bpy.data.materials, bpy.data.curves,
                       bpy.data.actions, bpy.data.images, bpy.data.fonts):
        for block in list(block_list):
            if block.users == 0:
                block_list.remove(block)
    scn = bpy.context.scene
    scn.render.fps = 30
    scn.frame_start = 1
    scn.frame_end = 3600
    scn.unit_settings.system = 'METRIC'
    scn.unit_settings.scale_length = 1.0


def collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def set_props(obj, **props):
    for k, v in props.items():
        obj[k] = v
    return obj


# ------------------------------------------------------------------- shading --
def _smooth_bm(bm, angle):
    """Mark faces smooth and edges sharper than `angle` (radians) as sharp."""
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
            continue
        try:
            if e.calc_face_angle() > angle:
                e.smooth = False
        except ValueError:
            e.smooth = False


def _box_uv_bm(bm, scale=0.35):
    """World-position box projection so every material tiles sensibly."""
    uv_layer = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_i, v_i = [(1, 2), (0, 2), (0, 1)][ax]
        for lo in f.loops:
            co = lo.vert.co
            lo[uv_layer].uv = (co[u_i] * scale, co[v_i] * scale)


def bm_to_obj(bm, name, coll=None, mat=None, smooth_angle=None, uv_scale=0.35,
              location=(0, 0, 0), rotation=(0, 0, 0), recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if smooth_angle is not None:
        _smooth_bm(bm, smooth_angle)
    if uv_scale:
        _box_uv_bm(bm, uv_scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    obj.rotation_euler = Euler(rotation)
    if mat is not None:
        me.materials.append(mat)
    link(obj, coll)
    return obj


# ---------------------------------------------------------------- primitives --
def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0), coll=None, mat=None,
        bevel=0.0, bevel_segs=2, smooth_angle=None, uv_scale=0.35):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=bevel_segs,
                        profile=0.7, affect='EDGES')
    return bm_to_obj(bm, name, coll, mat, smooth_angle, uv_scale, location, rotation)


def cylinder(name, radius, depth, segs=16, location=(0, 0, 0), rotation=(0, 0, 0),
             coll=None, mat=None, radius2=None, cap=True, smooth_angle=math.radians(40),
             uv_scale=0.35):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                          radius1=radius, radius2=radius if radius2 is None else radius2,
                          depth=depth)
    return bm_to_obj(bm, name, coll, mat, smooth_angle, uv_scale, location, rotation)


def sphere(name, radius, location=(0, 0, 0), coll=None, mat=None, u=16, v=10,
           smooth_angle=math.radians(70), uv_scale=0.35):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    return bm_to_obj(bm, name, coll, mat, smooth_angle, uv_scale, location)


def rock(name, radius, location=(0, 0, 0), coll=None, mat=None, seed=0,
         rough=0.35, subdiv=2, squash=0.7):
    """Displaced icosphere; the universal boulder/stalactite base."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    off = Vector((seed * 12.9898 % 7.0, seed * 78.233 % 7.0, seed * 0.5))
    for vt in bm.verts:
        n = noise.noise(vt.co * (1.8 / radius) + off)
        vt.co += vt.co.normalized() * n * rough * radius
        vt.co.z *= squash
    return bm_to_obj(bm, name, coll, mat, math.radians(50), 0.35, location)


def plane(name, w, h, location=(0, 0, 0), rotation=(0, 0, 0), coll=None, mat=None,
          uv_scale=0.35, nx=1, ny=1, normalized_uv=False):
    bm = bmesh.new()
    xs = [-w / 2 + w * i / nx for i in range(nx + 1)]
    ys = [-h / 2 + h * j / ny for j in range(ny + 1)]
    grid = [[bm.verts.new((x, y, 0)) for x in xs] for y in ys]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    if normalized_uv:
        bm.faces.ensure_lookup_table()
        uv_layer = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
        for j in range(ny):
            for i in range(nx):
                f = bm.faces[j * nx + i]
                f.loops[0][uv_layer].uv = (i / nx, 1.0 - j / ny)
                f.loops[1][uv_layer].uv = ((i + 1) / nx, 1.0 - j / ny)
                f.loops[2][uv_layer].uv = ((i + 1) / nx, 1.0 - (j + 1) / ny)
                f.loops[3][uv_layer].uv = (i / nx, 1.0 - (j + 1) / ny)
        return bm_to_obj(bm, name, coll, mat, None, uv_scale=0, location=location,
                         rotation=rotation, recalc=False)
    return bm_to_obj(bm, name, coll, mat, None, uv_scale, location, rotation,
                     recalc=False)


def heightfield(name, center, size, res, fn, coll=None, mat=None, uv_scale=0.08,
                smooth=True):
    """Terrain grid in world space; fn(x, y) -> z."""
    cx, cy = center
    w, h = size
    nx, ny = res
    bm = bmesh.new()
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = cx - w / 2 + w * i / nx
            y = cy - h / 2 + h * j / ny
            row.append(bm.verts.new((x, y, fn(x, y))))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    ang = math.radians(80) if smooth else None
    return bm_to_obj(bm, name, coll, mat, ang, uv_scale, recalc=False)


# ------------------------------------------------------------------- sweeps --
def _pt_frames(points):
    """Parallel-transport frames along a polyline: [(p, normal, binormal), ...]."""
    pts = [Vector(p) for p in points]
    tangents = []
    for i in range(len(pts)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized())
    up = Vector((0, 0, 1))
    if abs(tangents[0].dot(up)) > 0.95:
        up = Vector((1, 0, 0))
    n = (up - tangents[0] * up.dot(tangents[0])).normalized()
    frames = []
    for i, t in enumerate(tangents):
        n = (n - t * n.dot(t))
        n = n.normalized() if n.length > 1e-6 else Vector((1, 0, 0))
        frames.append((pts[i], n, t.cross(n)))
    return frames


def tube(name, points, radius, segs=8, coll=None, mat=None, cap=True,
         smooth_angle=math.radians(60), uv_scale=0.35, taper=None):
    """Sweep a circle along a polyline. `radius` may be scalar or per-point list."""
    frames = _pt_frames(points)
    n_pts = len(frames)
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * n_pts
    if taper:
        radii = [radii[i] * taper(i / (n_pts - 1)) for i in range(n_pts)]
    bm = bmesh.new()
    rings = []
    for (p, n, b), r in zip(frames, radii):
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ring.append(bm.verts.new(p + n * (math.cos(a) * r) + b * (math.sin(a) * r)))
        rings.append(ring)
    for i in range(n_pts - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm_to_obj(bm, name, coll, mat, smooth_angle, uv_scale)


def sweep(name, profile, points, coll=None, mat=None, closed_path=False,
          cap=True, smooth_angle=math.radians(40), uv_scale=0.35):
    """Sweep a closed 2D profile [(u, v), ...] along a 3D polyline.

    u maps to the transported normal, v to the binormal.
    """
    frames = _pt_frames(points)
    bm = bmesh.new()
    rings = []
    for p, n, b in frames:
        rings.append([bm.verts.new(p + n * u + b * v) for u, v in profile])
    count = len(profile)
    n_rings = len(rings)
    seg_pairs = [(i, i + 1) for i in range(n_rings - 1)]
    if closed_path:
        seg_pairs.append((n_rings - 1, 0))
    for i, i2 in seg_pairs:
        for k in range(count):
            k2 = (k + 1) % count
            bm.faces.new((rings[i][k], rings[i][k2], rings[i2][k2], rings[i2][k]))
    if cap and not closed_path:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm_to_obj(bm, name, coll, mat, smooth_angle, uv_scale)


def arc_points(center, radius, a0, a1, segs, plane='XZ', y=0.0):
    """Arc polyline; plane 'XZ' (vertical, facing Y) or 'XY' (ground)."""
    pts = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        if plane == 'XZ':
            pts.append((center[0] + radius * math.cos(a), y,
                        center[1] + radius * math.sin(a)))
        else:
            pts.append((center[0] + radius * math.cos(a),
                        center[1] + radius * math.sin(a), y))
    return pts


def catenary(p0, p1, sag, segs=12):
    """Rope hang between two points with the given midpoint sag."""
    p0, p1 = Vector(p0), Vector(p1)
    pts = []
    for i in range(segs + 1):
        t = i / segs
        p = p0.lerp(p1, t)
        p.z -= sag * math.sin(math.pi * t) ** 1.6
        pts.append(p)
    return pts


# ---------------------------------------------------------------- materials --
def _set_input(node, names, value):
    for nm in names:
        if nm in node.inputs:
            node.inputs[nm].default_value = value
            return True
    return False


def material(name, color, rough=0.8, metal=0.0, emit=None, emit_str=0.0,
             alpha=1.0, double_sided=False):
    if name in _mat_cache:
        return _mat_cache[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = tuple(color) + (1.0,) if len(color) == 3 else tuple(color)
    _set_input(bsdf, ["Base Color"], c)
    _set_input(bsdf, ["Roughness"], rough)
    _set_input(bsdf, ["Metallic"], metal)
    if emit is not None:
        e = tuple(emit) + (1.0,) if len(emit) == 3 else tuple(emit)
        _set_input(bsdf, ["Emission Color", "Emission"], e)
        _set_input(bsdf, ["Emission Strength"], emit_str)
    if alpha < 1.0:
        _set_input(bsdf, ["Alpha"], alpha)
        for attr, val in (("blend_method", 'BLEND'),
                          ("surface_render_method", 'BLENDED')):
            try:
                setattr(mat, attr, val)
            except (AttributeError, TypeError):
                pass
    mat.use_backface_culling = not double_sided
    mat.diffuse_color = c  # solid-mode preview
    _mat_cache[name] = mat
    return mat


def vertex_noise(obj, amount=0.25, scale=0.35, seed=0, base=(1, 1, 1)):
    """Bake mild per-vertex tint variation (exports as COLOR_0)."""
    me = obj.data
    attr = me.color_attributes.get("Col") or me.color_attributes.new(
        name="Col", type='FLOAT_COLOR', domain='POINT')
    off = Vector((seed * 3.7 % 11, seed * 9.1 % 11, 0.618 * seed % 11))
    mw = obj.matrix_world
    for i, vt in enumerate(me.vertices):
        n = noise.noise((mw @ vt.co) * scale + off)          # -1..1
        f = 1.0 - amount * (0.5 + 0.5 * n)
        attr.data[i].color = (base[0] * f, base[1] * f, base[2] * f, 1.0)


# --------------------------------------------------------------------- text --
def _font(key):
    if key in _font_cache:
        return _font_cache[key]
    path = FONT_FILES.get(key)
    fnt = None
    if path and os.path.exists(path):
        try:
            fnt = bpy.data.fonts.load(path)
        except RuntimeError:
            fnt = None
    _font_cache[key] = fnt
    return fnt


def wrap_text(body, width):
    return "\n".join(textwrap.fill(p, width) for p in body.split("\n"))


def text_mesh(name, body, font="quote", size=1.0, extrude=0.04, coll=None,
              mat=None, align_x='CENTER', align_y='CENTER', warp=None,
              location=(0, 0, 0), rotation=(0, 0, 0), line_gap=1.0):
    """Create text, convert to mesh (headless-safe), optionally warp vertices."""
    fc = bpy.data.curves.new(name + "_fc", type='FONT')
    fc.body = body
    fc.size = size
    fc.extrude = extrude
    fc.align_x = align_x
    fc.align_y = align_y
    fc.space_line = line_gap
    fc.resolution_u = 5
    fnt = _font(font)
    if fnt is not None:
        fc.font = fnt
    tmp = bpy.data.objects.new(name + "_tmp", fc)
    bpy.context.scene.collection.objects.link(tmp)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(deps))
    me.name = name
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(fc)
    if warp is not None:
        for vt in me.vertices:
            vt.co = warp(vt.co)
        me.update()
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    obj.rotation_euler = Euler(rotation)
    if mat is not None:
        me.materials.append(mat)
    link(obj, coll)
    return obj


def arch_warp(radius, y_plane=0.0, z_center=0.0):
    """Bend flat text (local XY, +Z out) over a vertical arch facing +Y.

    Baseline follows the arc, letters point radially out; reads left-to-right
    for a viewer standing at +Y looking towards -Y.
    """
    def fn(v):
        theta = math.pi / 2 + v.x / radius
        r = radius + v.y
        return Vector((r * math.cos(theta), y_plane + v.z, z_center + r * math.sin(theta)))
    return fn


def cyl_wrap(radius, center=(0.0, 0.0), z_base=0.0, theta0=math.pi / 2):
    """Wrap flat text around a vertical cylinder, facing outward at theta0.

    theta0 = pi/2 puts the text on the +Y side (readable from +Y looking -Y).
    """
    cx, cy = center
    def fn(v):
        theta = theta0 + v.x / radius
        r = radius + v.z
        return Vector((cx + r * math.cos(theta), cy + r * math.sin(theta), z_base + v.y))
    return fn


# ------------------------------------------------------- empties / instances --
def look_at_rotation(origin, target):
    d = Vector(target) - Vector(origin)
    return d.to_track_quat('-Z', 'Y').to_euler()


def empty(name, location, look_at=None, rotation=None, coll=None, size=1.0,
          props=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'ARROWS'
    obj.empty_display_size = size
    obj.location = location
    if look_at is not None:
        obj.rotation_euler = look_at_rotation(location, look_at)
    elif rotation is not None:
        obj.rotation_euler = Euler(rotation)
    link(obj, coll)
    if props:
        set_props(obj, **props)
    return obj


def inst(src, name, location, rotation=(0, 0, 0), scale=1.0, coll=None):
    """Linked-data duplicate (Alt+D equivalent) → one glTF mesh, many nodes.

    NB: export with `gltf-transform draco`, not `meshopt`/`quantize` — the
    latter was found to corrupt translation+scale on instanced nodes sharing
    a mesh (see blender/PIPELINE.md §5). Draco compresses this shared-mesh
    pattern correctly.
    """
    obj = src.copy()
    obj.name = name
    obj.hide_render = False
    obj.hide_viewport = False
    obj.location = location
    obj.rotation_euler = Euler(rotation if isinstance(rotation, (tuple, list))
                               else (0, 0, rotation))
    s = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
    obj.scale = s
    link(obj, coll)
    return obj


def hide_asset(obj):
    """Keep library originals out of render + export (instances still export)."""
    obj.location = (obj.location.x, obj.location.y, obj.location.z - 500.0)
    obj.hide_render = True
    obj.hide_viewport = True


# ---------------------------------------------------------------- animation --
def action_fcurves(act):
    """Blender 5.x slotted actions: fcurves live under layer→strip→channelbag."""
    if hasattr(act, "fcurves"):
        yield from act.fcurves
        return
    for lay in act.layers:
        for strip in lay.strips:
            for cb in strip.channelbags:
                yield from cb.fcurves


def make_action(id_block, name, channels, frame_range=None):
    """channels: [(data_path, index, [(frame, value), ...], interp), ...]

    Creates the action on id_block, keys it, pushes it to an NLA track with the
    same name (glTF 'NLA Tracks' mode merges equally named tracks into one clip)
    and clears the active action again.
    """
    ad = id_block.animation_data or id_block.animation_data_create()
    act = bpy.data.actions.new(name)
    ad.action = act
    try:  # slotted actions (4.4+): make sure a slot is bound
        if hasattr(ad, "action_slot") and ad.action_slot is None and act.slots:
            ad.action_slot = act.slots[0]
    except (AttributeError, TypeError):
        pass
    for data_path, index, keys, interp in channels:
        for frame, value in keys:
            _assign_path(id_block, data_path, index, value)
            id_block.keyframe_insert(data_path=data_path,
                                     index=index if index is not None else -1,
                                     frame=frame)
    interp_by_path = {c[0]: (c[3] or 'BEZIER') for c in channels}
    for fc in action_fcurves(act):
        mode = interp_by_path.get(fc.data_path, 'BEZIER')
        for kp in fc.keyframe_points:
            kp.interpolation = mode
    # rest pose = first key
    for data_path, index, keys, interp in channels:
        _assign_path(id_block, data_path, index, keys[0][1])
    track = ad.nla_tracks.new()
    track.name = name
    start = int(frame_range[0]) if frame_range else int(act.frame_range[0])
    # start at frame 2 with no extrapolation so frame 1 shows the rest pose
    strip = track.strips.new(name, start + 1, act)
    strip.name = name
    strip.extrapolation = 'NOTHING'
    ad.action = None
    return act


def _assign_path(id_block, data_path, index, value):
    """Covers the paths used here: location / rotation_euler / scale (indexed)
    and shape-key paths like key_blocks["Rolled"].value (index None)."""
    if index is not None and "." not in data_path:
        getattr(id_block, data_path)[index] = value
        return
    head, _, tail = data_path.rpartition(".")
    target = id_block.path_resolve(head) if head else id_block
    setattr(target, tail, value)


# ---------------------------------------------------------------------- UVs --
def add_lightmap_uv(objs):
    """Second UV channel for baking; smart-projected, non-overlapping."""
    prev_active = bpy.context.view_layer.objects.active
    for obj in objs:
        if obj.type != 'MESH':
            continue
        me = obj.data
        if "Lightmap" not in me.uv_layers:
            me.uv_layers.new(name="Lightmap")
        me.uv_layers.active = me.uv_layers["Lightmap"]
        try:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(66),
                                     island_margin=0.02)
            bpy.ops.object.mode_set(mode='OBJECT')
        except RuntimeError:
            try:
                bpy.ops.object.mode_set(mode='OBJECT')
            except RuntimeError:
                pass
        me.uv_layers.active = me.uv_layers["UVMap"]
        set_props(obj, lightmap=1)
    if prev_active:
        bpy.context.view_layer.objects.active = prev_active


# ------------------------------------------------------------------ splines --
def catmull_rom(points, closed=False, samples_per_seg=8):
    """Centripetal-ish Catmull-Rom through the control points."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    out = []
    seg_count = n if closed else n - 1
    for i in range(seg_count):
        p0 = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        p1 = pts[i % n]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if closed else pts[min(i + 2, n - 1)]
        for k in range(samples_per_seg):
            t = k / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(
                0.5 * ((2 * p1) + (-p0 + p2) * t
                       + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                       + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(pts[-1].copy())
    else:
        out.append(out[0].copy())
    return out


def resample_arclength(pts, count):
    """Uniform-speed resampling of a polyline (first == last for loops)."""
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + (b - a).length)
    total = cum[-1]
    out = []
    j = 0
    for i in range(count):
        s = total * i / count
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j]
        t = (s - cum[j]) / seg if seg > 1e-9 else 0.0
        out.append(pts[j].lerp(pts[j + 1], t))
    return out, total


# ------------------------------------------------------------------- helpers --
def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def fractal2d(x, y, scale=0.02, octaves=4, seed=0.0):
    v, amp, freq, total = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        v += amp * noise.noise(Vector((x * scale * freq + seed * 13.1,
                                       y * scale * freq + seed * 7.7, seed)))
        total += amp
        amp *= 0.5
        freq *= 2.1
    return v / total


def gauss_bump(x, y, cx, cy, radius, height):
    d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (radius * radius)
    return height * math.exp(-d2 * 2.2)
