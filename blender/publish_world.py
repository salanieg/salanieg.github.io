# ============================================================================
# publish_world.py — turn the finished world.blend into the shipped assets.
#
# READ-ONLY with respect to the .blend: it exports the GLB and regenerates
# cam_path.json, but NEVER calls save_blend. world.blend is hand-finished and
# must stay exactly as it is on disk.
#
# Exports the GLB only. cam_path.json is NOT written here: regenerating it with
# rework_teleport.camera_rail() rebuilds the rail from its own control points,
# which no longer reproduces the hand-finished curve (anchors came out up to
# 0.028 u adrift from the path_u baked into the GLB). Use make_cam_path.py,
# which seeds the same maths with Cam_Path_Curve itself:
#
#   "…/blender.exe" -b blender/output/world.blend -P blender/publish_world.py
#   "…/blender.exe" -b blender/output/world.blend -P blender/make_cam_path.py
#   npx @gltf-transform/cli meshopt blender/output/world.glb \
#       assets/world/world.glb --level medium
#   cp blender/output/cam_path.json assets/world/cam_path.json
# ============================================================================
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                   # noqa: E402
import exporter                              # noqa: E402

OUT = os.path.join(HERE, "output")


def main():
    # what the .blend currently claims, so we can prove the JSON agrees
    before = {o["camera_waypoint"]: round(o.get("path_u", -1), 5)
              for o in bpy.data.objects if "camera_waypoint" in o.keys()}
    print(f"[publish] path_u stored in the .blend: {before}")

    # GLB straight from the untouched scene
    exporter.export_glb(os.path.join(OUT, "world.glb"))
    print("[publish] .blend NOT saved (by design) — "
          "now run make_cam_path.py for cam_path.json")


main()
