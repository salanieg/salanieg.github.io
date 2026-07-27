import os, sys, math
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)
import lib_common as L
import statues_lib as S
import add_marx_engels as A
import exporter

OUTDIR = None
for i, a in enumerate(sys.argv):
    if a == "--out":
        OUTDIR = sys.argv[i + 1]
OUTDIR = OUTDIR or os.path.join(HERE, "output", "previews")
os.makedirs(OUTDIR, exist_ok=True)

A.build()   # builds into WP1_Atrium, no save
scn = bpy.context.scene
scn.render.engine = exporter._pick_engine(scn)
scn.render.resolution_x = 1280
scn.render.resolution_y = 900
try:
    scn.view_settings.view_transform = 'AgX'
except Exception:
    pass

cam_data = bpy.data.cameras.new("ChkCam")
cam_data.lens = 30
cam_data.clip_end = 800
cam = bpy.data.objects.new("ChkCam", cam_data)
scn.collection.objects.link(cam)
scn.camera = cam


def shot(name, loc, tgt, lens=30):
    cam_data.lens = lens
    cam.location = Vector(loc)
    d = Vector(tgt) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scn.render.filepath = os.path.join(OUTDIR, name)
    bpy.ops.render.render(write_still=True)
    print("SHOT", scn.render.filepath)


# from the platform, looking -Y into the atrium through the gate (sees fronts)
shot("chk_from_platform", (0.0, 25.0, 3.4), (0.0, 6.0, 2.2), lens=34)
# from inside the atrium, looking back +Y at the gate (sees fronts, framed)
shot("chk_from_atrium", (0.0, 8.0, 2.7), (0.0, 16.0, 2.2), lens=30)
# 3/4 close on the pair from inside
shot("chk_pair_34", (5.6, 8.6, 3.0), (0.0, 14.0, 2.3), lens=40)
print("DONE")
