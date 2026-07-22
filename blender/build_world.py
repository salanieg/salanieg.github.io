# ============================================================================
# build_world.py — one-shot generator for the portfolio world.
#
#   blender -b --factory-startup -P blender/build_world.py -- \
#       --export --previews --save-blend [--only wp1,wp2] [--out blender/output]
#
# Builds collections WP1_Atrium / WP2_Garden / WP3_Desert / WP4_Metro plus the
# camera rail, then (optionally) exports world.glb + cam_path.json, renders
# per-waypoint validation stills and saves world.blend.
# ============================================================================
import argparse
import importlib
import os
import sys

import bpy

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import lib_common as L                                    # noqa: E402
for _m in ("lib_common",):
    importlib.reload(sys.modules[_m])


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(SCRIPT_DIR, "output"))
    ap.add_argument("--only", default="wp1,wp2,wp3,wp4")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--previews", action="store_true")
    ap.add_argument("--save-blend", action="store_true")
    ap.add_argument("--no-cam", action="store_true")
    return ap.parse_args(argv)


def setup_world():
    scn = bpy.context.scene
    world = bpy.data.worlds.new("World")
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    try:
        sky = nt.nodes.new("ShaderNodeTexSky")
        for attr, val in (("sun_elevation", 0.42), ("sun_rotation", 2.4),
                          ("sun_intensity", 0.6), ("altitude", 300.0)):
            if hasattr(sky, attr):
                setattr(sky, attr, val)
        nt.links.new(sky.outputs[0], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.22
    except RuntimeError:
        bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1.0)
        bg.inputs["Strength"].default_value = 0.3

    sun = bpy.data.lights.new("SUN_Key", type='SUN')
    sun.energy = 2.2
    sun.angle = 0.06
    sun_obj = bpy.data.objects.new("SUN_Key", sun)
    sun_obj.rotation_euler = (0.9, 0.15, 0.5)
    L.link(sun_obj)

    vs = scn.view_settings
    vs.exposure = -0.35
    try:
        vs.look = 'AgX - Punchy'
    except TypeError:
        pass


def stats():
    deps = bpy.context.evaluated_depsgraph_get()
    tris = 0
    meshes = 0
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and not obj.hide_render:
            meshes += 1
            me = obj.evaluated_get(deps).data
            tris += sum(len(p.vertices) - 2 for p in me.polygons)
    print(f"[world] {meshes} visible meshes, ~{tris:,} tris, "
          f"{len(bpy.data.materials)} materials, {len(bpy.data.actions)} actions")


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    L.clean_scene()
    setup_world()

    ctx = {
        "out": args.out,
        "waypoints": {},   # name -> empty object (camera anchors)
        "assets": {},      # shared instancing sources
        "lightmap": [],    # stationary meshes that get a Lightmap UV channel
    }

    wanted = [w.strip() for w in args.only.split(",") if w.strip()]
    modules = {"wp1": "wp1_atrium", "wp2": "wp2_garden",
               "wp3": "wp3_desert", "wp4": "wp4_metro"}
    for key in ("wp1", "wp2", "wp3", "wp4"):
        if key not in wanted:
            continue
        mod = importlib.import_module(modules[key])
        importlib.reload(mod)
        print(f"[world] building {modules[key]} ...")
        mod.build(ctx)

    if not args.no_cam:
        import camera_rig
        importlib.reload(camera_rig)
        camera_rig.build(ctx, subset=wanted)

    L.add_lightmap_uv(ctx["lightmap"])
    bpy.context.view_layer.update()
    stats()

    import exporter
    importlib.reload(exporter)
    if args.save_blend:
        exporter.save_blend(os.path.join(args.out, "world.blend"))
    if args.export:
        exporter.export_glb(os.path.join(args.out, "world.glb"))
    if args.previews:
        exporter.render_previews(ctx, os.path.join(args.out, "previews"))
    print("[world] done")


if __name__ == "__main__":
    main()
