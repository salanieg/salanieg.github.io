# ============================================================================
# exporter.py — GLB export tuned for three.js / R3F + validation renders.
#
# Export contract:
#   * custom properties  -> glTF "extras"        (export_extras)
#   * empties            -> plain nodes
#   * NLA tracks         -> named animations     (banner_drop, doors_open, ...)
#   * shape keys         -> morph targets
#   * punctual lights    -> KHR_lights_punctual
# No modifiers are used anywhere, so export_apply stays off and morphs survive.
# ============================================================================
import math
import os

import bpy


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"[export] saved {path}")


def export_glb(path):
    op_props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    want = dict(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_cameras=True,
        export_lights=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_morph=True,
        export_morph_normal=False,
        export_skins=False,
        export_attributes=True,
        # materials don't reference the Col attribute, so the default
        # 'MATERIAL' mode would silently drop all vertex tints
        export_vertex_color='ACTIVE',
        use_visible=True,
        export_image_format='AUTO',
    )
    kwargs = {k: v for k, v in want.items() if k in op_props}
    bpy.ops.export_scene.gltf(**kwargs)
    size = os.path.getsize(path) / 1e6
    print(f"[export] wrote {path} ({size:.1f} MB)")


def _pick_engine(scn):
    engines = [e.identifier for e in
               scn.render.bl_rna.properties['engine'].enum_items]
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        if eng in engines:
            return eng
    return engines[0]


def render_previews(ctx, outdir):
    os.makedirs(outdir, exist_ok=True)
    scn = bpy.context.scene
    scn.render.engine = _pick_engine(scn)
    scn.render.resolution_x = 1024
    scn.render.resolution_y = 576
    if hasattr(scn, "eevee"):
        for attr, val in (("taa_render_samples", 24), ("use_raytracing", False)):
            if hasattr(scn.eevee, attr):
                setattr(scn.eevee, attr, val)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 24
    cam_data.clip_end = 600
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam

    shots = []
    for name, emp in ctx["waypoints"].items():
        shots.append((f"wp_{name}", emp.location.copy(), emp.rotation_euler.copy()))
    from lib_common import look_at_rotation
    shots.append(("overview_east", (95, -90, 60), look_at_rotation((95, -90, 60), (0, -110, -8))))
    shots.append(("overview_north", (35, 70, 40), look_at_rotation((35, 70, 40), (0, -40, 0))))

    for name, loc, rot in shots:
        cam.location = loc
        cam.rotation_euler = rot
        scn.render.filepath = os.path.join(outdir, name + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"[preview] {scn.render.filepath}")

    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
