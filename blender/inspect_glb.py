# Standalone GLB sanity check (plain Python, no Blender needed):
#   python blender/inspect_glb.py blender/output/world.glb
import json
import struct
import sys


def main(path):
    with open(path, "rb") as fh:
        magic, version, _length = struct.unpack("<III", fh.read(12))
        assert magic == 0x46546C67, "not a GLB"
        chunk_len, chunk_type = struct.unpack("<II", fh.read(8))
        gltf = json.loads(fh.read(chunk_len))

    print(f"generator : {gltf.get('asset', {}).get('generator', '?')}")
    print(f"meshes    : {len(gltf.get('meshes', []))}")
    print(f"nodes     : {len(gltf.get('nodes', []))}")
    print(f"materials : {len(gltf.get('materials', []))}")
    print(f"cameras   : {len(gltf.get('cameras', []))}")
    lights = gltf.get("extensions", {}).get("KHR_lights_punctual", {})
    print(f"lights    : {len(lights.get('lights', []))}")
    anims = gltf.get("animations", [])
    print(f"animations: {len(anims)} -> {[a.get('name') for a in anims]}")
    n_extras = [n["name"] for n in gltf.get("nodes", []) if "extras" in n]
    print(f"nodes with extras: {len(n_extras)}")
    for name in n_extras[:24]:
        node = next(n for n in gltf["nodes"] if n["name"] == name)
        print(f"   {name}: {node['extras']}")
    morphs = [m.get("name") for m in gltf.get("meshes", [])
              if any("targets" in p for p in m.get("primitives", []))]
    print(f"morph meshes: {morphs}")
    cams = [n["name"] for n in gltf.get("nodes", []) if "camera" in n]
    print(f"camera nodes: {cams}")


if __name__ == "__main__":
    main(sys.argv[1])
