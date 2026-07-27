# ============================================================================
# update_wp2_in_place.py — Modify WP2 in existing hand-finished world.blend.
#
# Loads the hand-finished world.blend (preserving WP1, WP3, WP4, actions, NLA),
# purges old WP2_Garden objects & mesh orphans, rebuilds new WP2 assets,
# saves world.blend in-place, and exports world.glb.
# ============================================================================
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
import lib_common as L
import wp2_garden
import exporter

importlib.reload(L)
importlib.reload(wp2_garden)
importlib.reload(exporter)


def main():
    blend_path = os.path.join(HERE, "output", "world.blend")
    print(f"[wp2_update_in_place] Loading scene: {blend_path}")

    # Remove objects in WP2_Garden collection
    coll = bpy.data.collections.get("WP2_Garden")
    if coll:
        print("[wp2_update_in_place] Removing existing WP2_Garden objects...")
        for obj in list(coll.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    else:
        coll = bpy.data.collections.new("WP2_Garden")
        bpy.context.scene.collection.children.link(coll)

    # Purge orphan mesh datablocks
    try:
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    except Exception as e:
        print(f"[wp2_update_in_place] orphan purge notice: {e}")

    ctx = {
        "out": os.path.join(HERE, "output"),
        "waypoints": {},
        "assets": {},
        "lightmap": [],
    }

    # Rebuild ONLY WP2 assets using updated wp2_garden module
    print("[wp2_update_in_place] Generating new WP2 Garden assets...")
    wp2_garden.build(ctx)

    # Save hand-finished world.blend in-place
    save_path = os.path.join(HERE, "output", "world.blend")
    exporter.save_blend(save_path)

    # Export world.glb directly from the updated hand-finished scene
    glb_path = os.path.join(HERE, "output", "world.glb")
    exporter.export_glb(glb_path)
    print(f"[wp2_update_in_place] Exported {glb_path}")


if __name__ == "__main__":
    main()
