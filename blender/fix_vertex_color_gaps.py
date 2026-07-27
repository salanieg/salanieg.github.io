# ============================================================================
# fix_vertex_color_gaps.py — root-cause fix for objects rendering solid BLACK
# in Blender's viewport (Material Preview / Rendered).
#
# lib_common.enable_vertex_color() permanently wires a Color-Attribute ->
# Multiply -> Base Color chain into a material's shared node graph the first
# time vertex_noise() is called on ANY object using it. Because materials are
# cached and reused by name (WP1_Wall_* etc. all share "Brutalist_Concrete"),
# every OTHER object using that same material that lacks its own "Col"
# attribute then reads (0,0,0,0) from the Color Attribute node — multiplying
# its base colour to pure black. This is invisible on the shipped site (the
# glTF exporter only emits COLOR_0 for meshes that actually have the
# attribute, so three.js simply skips the multiply for them) but wrong in
# Blender itself, and a latent trap for any future bake/render pass.
#
# Fix: give every affected object a neutral (uniform white, i.e. no-op)
# "Col" attribute so the existing multiply reads identity for them. Scans
# ALL materials generically (not a hardcoded object list) so this also
# catches any future recurrence. Idempotent — skips objects that already
# have the attribute.
#
#   "…/blender.exe" -b blender/output/world.blend -P blender/fix_vertex_color_gaps.py -- --save --export
# ============================================================================
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.append(HERE)
OUT = os.path.join(HERE, "output")


def _vcol_wiring(mat):
    """Return the attribute name a material multiplies into Base Color, or None."""
    if not mat or not mat.use_nodes:
        return None
    nodes = mat.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return None
    attr_node = next((n for n in nodes if n.type in ('ATTRIBUTE', 'COLOR_ATTRIBUTE')), None)
    if not attr_node:
        return None
    attr_name = getattr(attr_node, 'layer_name', '') or getattr(attr_node, 'attribute_name', '')
    for link in mat.node_tree.links:
        if link.to_node != bsdf or link.to_socket.name != 'Base Color':
            continue
        src = link.from_node
        if src == attr_node:
            return attr_name
        if src.type in ('MIX', 'MIX_RGB'):
            if any(l.from_node == attr_node for l in mat.node_tree.links if l.to_node == src):
                return attr_name
    return None


def fix():
    fixed = []
    for mat in bpy.data.materials:
        attr_name = _vcol_wiring(mat)
        if not attr_name:
            continue
        for obj in bpy.data.objects:
            if obj.type != 'MESH':
                continue
            if not any(s.material and s.material.name == mat.name for s in obj.material_slots):
                continue
            me = obj.data
            if attr_name in me.color_attributes:
                continue
            attr = me.color_attributes.new(name=attr_name, type='FLOAT_COLOR', domain='POINT')
            for d in attr.data:
                d.color = (1.0, 1.0, 1.0, 1.0)
            fixed.append((obj.name, mat.name, attr_name))
    print(f"[vcol-fix] gave a neutral Col attribute to {len(fixed)} objects:")
    for name, mat_name, attr_name in fixed:
        print(f"   {name}  (material={mat_name}, attr={attr_name})")
    return fixed


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import exporter
    fix()
    bpy.context.view_layer.update()
    if "--save" in argv:
        exporter.save_blend(os.path.join(OUT, "world.blend"))
    if "--export" in argv:
        exporter.export_glb(os.path.join(OUT, "world.glb"))


if __name__ == "__main__":
    main()
