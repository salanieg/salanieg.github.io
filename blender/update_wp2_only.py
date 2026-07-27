# ============================================================================
# update_wp2_only.py — In-place update of WP2 Garden in existing world.blend.
#
# Loads the existing hand-finished world.blend (preserving WP1, WP3, WP4),
# replaces ONLY the objects in WP2_Garden with the optimized WP2 assets,
# saves world.blend in-place, and exports world.glb.
# ============================================================================
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
import lib_common
import wp2_garden
import exporter

importlib.reload(lib_common)
importlib.reload(wp2_garden)
importlib.reload(exporter)


def main():
    blend_path = os.path.join(HERE, "output", "world.blend")
    print(f"[wp2_update] Loading existing scene: {blend_path}")

    # Clear only existing WP2_Garden collection objects
    coll = bpy.data.collections.get("WP2_Garden")
    if coll:
        print("[wp2_update] Clearing previous WP2_Garden collection objects...")
        for obj in list(coll.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    else:
        coll = bpy.data.collections.new("WP2_Garden")
        bpy.context.scene.collection.children.link(coll)

    ctx = {
        "out": os.path.join(HERE, "output"),
        "waypoints": {},
        "assets": {},
        "lightmap": [],
    }

    # Rebuild only WP2
    print("[wp2_update] Generating optimized WP2 Garden assets...")
    wp2_garden.build(ctx)

    # Save world.blend in-place
    save_path = os.path.join(HERE, "output", "world.blend")
    exporter.save_blend(save_path)

    # Export world.glb
    glb_path = os.path.join(HERE, "output", "world.glb")
    exporter.export_glb(glb_path)
    print(f"[wp2_update] Exported {glb_path}")


if __name__ == "__main__":
    main()
