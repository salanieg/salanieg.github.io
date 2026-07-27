# ============================================================================
# wp3_shots.py — validation stills for the Western Desert.
#
# Approximates the *web* look (fx.js desert ambience: warm sand background,
# sun from the north-east, ACES-ish exposure) rather than the .blend's own
# sky, so the framing decisions match what the visitor actually sees.
# Imported by wp3_rework.py --shots, or run standalone:
#   blender.exe -b blender/output/world.blend -P blender/wp3_shots.py
# ============================================================================
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")

# camera along the rail: (name, path y, lens) — position/aim taken from
# cam_path.json so the shot really is what the ride shows
RAIL_SHOTS = [(-104.0, 26), (-112.0, 26), (-118.0, 30), (-122.5, 30),
              (-131.5, 30), (-137.0, 28)]

FREE_SHOTS = [
    ("k_wagon", (-4.0, -119.0, -7.4), (-9.6, -126.0, -9.0), 34),
    ("l_porch", (2.6, -118.6, -8.2), (-2.0, -123.6, -9.0), 32),
    ("m_bowl", (0.0, -106.0, 4.0), (0.0, -130.0, -8.0), 22),
    ("n_east", (58.0, -108.0, 16.0), (0.0, -130.0, -4.0), 35),
    ("o_west", (-58.0, -146.0, 18.0), (0.0, -122.0, -4.0), 35),
    ("p_top", (2.0, -126.0, 52.0), (0.0, -126.0, -8.0), 28),
    ("q_cactus", (-2.0, -117.0, -5.6), (-9.0, -122.0, -6.4), 40),
    ("r_south", (1.0, -139.0, -7.6), (0.0, -124.0, -4.0), 26),
    ("s_gate", (0.5, -100.0, -2.6), (0.5, -116.0, -1.0), 24),
    ("t_butte1", (2.0, -128.0, -4.0), (15.6, -113.0, 4.0), 34),
    ("u_butte2", (-2.0, -134.0, -4.0), (-27.0, -124.0, 6.0), 34),
    ("v_pear", (-4.4, -117.6, -6.4), (-6.9, -119.0, -7.0), 45),
]


def _rail_poses():
    with open(os.path.join(OUT, "cam_path.json"), encoding="utf-8") as f:
        d = json.load(f)
    pts = [s["p"] for s in d["samples"]]
    out = []
    for y, lens in RAIL_SHOTS:
        best = min(range(len(pts) - 2),
                   key=lambda i: abs(pts[i][1] - y) if pts[i][1] < -90 else 1e9)
        p = Vector(pts[best])
        q = Vector(pts[min(best + 3, len(pts) - 1)])
        out.append((f"rail_{abs(int(y))}", tuple(p), tuple(q + (q - p) * 6.0),
                    lens))
    return out


def _preview_vertex_colours():
    """PREVIEW ONLY — wire Col → multiply → Base Color.

    world.blend deliberately ships plain Principled materials; three.js
    multiplies COLOR_0 in by itself, but Blender does not, so without this the
    stills hide every strata band and rock tint. Never saved.
    """
    # every mesh needs a Col, or the shared materials read (0,0,0,0) and go
    # black — the exact trap fix_vertex_color_gaps.py documents
    neutral = 0
    for me in bpy.data.meshes:
        if me.users and "Col" not in me.color_attributes:
            ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR',
                                         domain='POINT')
            for d in ca.data:
                d.color = (1.0, 1.0, 1.0, 1.0)
            neutral += 1
    print(f"[shot] neutral Col given to {neutral} meshes")

    done = set()
    for o in bpy.data.objects:
        if o.type != 'MESH' or "Col" not in o.data.color_attributes:
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in done or not m.node_tree:
                continue
            done.add(m.name)
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is None or any(n.type in ('ATTRIBUTE', 'COLOR_ATTRIBUTE')
                                   for n in nt.nodes):
                continue
            attr = nt.nodes.new('ShaderNodeAttribute')
            attr.attribute_name = "Col"
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            for i in mix.inputs:
                if i.name == 'Factor' and i.type == 'VALUE':
                    i.default_value = 1.0
            cols = [i for i in mix.inputs if i.type == 'RGBA']
            src = next((l.from_socket for l in nt.links
                        if l.to_node == bsdf and l.to_socket.name == 'Base Color'),
                       None)
            if src is not None:
                nt.links.new(src, cols[0])
            else:
                cols[0].default_value = bsdf.inputs['Base Color'].default_value
            nt.links.new(attr.outputs['Color'], cols[1])
            nt.links.new(next(o2 for o2 in mix.outputs if o2.type == 'RGBA'),
                         bsdf.inputs['Base Color'])
    print(f"[shot] preview vertex-colour wiring on {len(done)} materials")


def _light():
    scn = bpy.context.scene
    world = scn.world
    if world and world.node_tree:
        bg = world.node_tree.nodes.get("Background")
        if bg:
            bg.inputs[0].default_value = (0.55, 0.60, 0.72, 1.0)
            bg.inputs[1].default_value = 0.30
            for l in list(world.node_tree.links):
                if l.to_node == bg and l.to_socket.name == 'Color':
                    world.node_tree.links.remove(l)
    sun = bpy.data.objects.get("SUN_Key")
    if sun:
        # fx.js puts the web sun at three.js (45, 85, -140) → Blender (45,140,85)
        sun.data.energy = 2.7
        sun.data.color = (1.0, 0.95, 0.87)
        d = Vector((0, 0, 0)) - Vector((45.0, 140.0, 85.0))
        sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sun.data.use_shadow = False        # the web rig casts no shadows either
    if hasattr(scn, "eevee") and hasattr(scn.eevee, "use_shadows"):
        scn.eevee.use_shadows = False
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Punchy'
        scn.view_settings.exposure = -0.55
    except (AttributeError, TypeError):
        pass


def render_all(outdir=None, tag=""):
    outdir = outdir or os.path.join(OUT, "wp3_shots")
    os.makedirs(outdir, exist_ok=True)
    scn = bpy.context.scene
    engines = [e.identifier for e in scn.render.bl_rna.properties['engine'].enum_items]
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        if eng in engines:
            scn.render.engine = eng
            break
    scn.render.resolution_x = 1000
    scn.render.resolution_y = 620
    scn.render.resolution_percentage = 100
    if hasattr(scn, "eevee"):
        for attr, val in (("taa_render_samples", 24), ("use_raytracing", False)):
            if hasattr(scn.eevee, attr):
                setattr(scn.eevee, attr, val)
    _light()
    _preview_vertex_colours()

    cam_data = bpy.data.cameras.new("WP3ShotCam")
    cam_data.clip_end = 900
    cam = bpy.data.objects.new("WP3ShotCam", cam_data)
    scn.collection.objects.link(cam)
    old_cam, scn.camera = scn.camera, cam

    for name, loc, tgt, lens in _rail_poses() + FREE_SHOTS:
        cam_data.lens = lens
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(outdir, f"{tag}{name}.png")
        bpy.ops.render.render(write_still=True)
        print("[shot]", scn.render.filepath)

    scn.camera = old_cam
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    render_all(tag=(argv[0] + "_") if argv else "")
