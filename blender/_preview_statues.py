import sys, os, math
import bpy
from mathutils import Vector, Euler

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__))))
import lib_common as L
import importlib
import statues_lib
importlib.reload(statues_lib)
S = statues_lib

OUT = sys.argv[-1] if sys.argv[-1].endswith(os.sep) or ":" in sys.argv[-1] else None
OUTDIR = None
for i, a in enumerate(sys.argv):
    if a == "--out":
        OUTDIR = sys.argv[i + 1]
OUTDIR = OUTDIR or os.path.join(os.path.dirname(os.path.abspath(__file__)), "output", "previews")
os.makedirs(OUTDIR, exist_ok=True)

# ---- fresh scene ----
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
coll = bpy.context.scene.collection

# ground
grd_mat = L.material("Grd", (0.20, 0.20, 0.22), rough=0.9)
g = L.box("Ground", (30, 30, 0.4), location=(0, 0, -0.2), mat=grd_mat)

mats = S.build_materials()
WEST = (-1.55, 0.0, 0.0)
EAST = (1.55, 0.0, 0.0)
S.build_pair(coll, WEST, EAST, mats, yaw=0.0, scale=1.0)

# ---- lighting ----
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN'))
sun.data.energy = 4.0
sun.rotation_euler = Euler((math.radians(52), math.radians(8), math.radians(150)))
coll.objects.link(sun)
fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", 'AREA'))
fill.data.energy = 900.0
fill.data.size = 8.0
fill.location = (5, 8, 5)
coll.objects.link(fill)

world = bpy.data.worlds.new("W")
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.10, 0.11, 0.13, 1.0)
bg.inputs[1].default_value = 0.6
scn.world = world

# ---- render settings ----
for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        scn.render.engine = eng
        break
    except TypeError:
        continue
scn.render.resolution_x = 900
scn.render.resolution_y = 1300
scn.render.film_transparent = False
try:
    scn.view_settings.view_transform = 'AgX'
except Exception:
    pass

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
coll.objects.link(cam)
scn.camera = cam
cam_data.lens = 55


def look(cam, loc, tgt):
    cam.location = Vector(loc)
    d = Vector(tgt) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(name, loc, tgt):
    look(cam, loc, tgt)
    scn.render.filepath = os.path.join(OUTDIR, name)
    bpy.ops.render.render(write_still=True)
    print("WROTE", scn.render.filepath + ".png")


# both, front (full figures + pedestals)
render("statues_front", (0.0, 9.5, 3.0), (0.0, 0.0, 2.5))
# Marx full 3/4
render("statue_marx_34", (-2.9, 6.4, 3.1), (WEST[0], 0.0, 2.55))
# Marx side
render("statue_marx_side", (-6.0, 0.6, 3.0), (WEST[0], 0.0, 2.5))
# Marx head close-up
render("statue_marx_head", (-1.7, 3.2, 3.9), (WEST[0], 0.05, 3.55))
# Engels full 3/4
render("statue_engels_34", (2.9, 6.4, 3.1), (EAST[0], 0.0, 2.55))
# Engels side
render("statue_engels_side", (6.0, 0.6, 3.0), (EAST[0], 0.0, 2.5))
# Engels head close-up
render("statue_engels_head", (1.7, 3.2, 3.9), (EAST[0], 0.05, 3.55))
print("DONE")
