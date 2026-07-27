# ============================================================================
# optimize_wp2_in_place.py — In-place direct update of WP2 Garden in world.blend
# ============================================================================
import os
import sys
import math
import random
import bpy
import bmesh
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import exporter

def get_or_create_collection(name):
    coll = bpy.data.collections.get(name)
    if not coll:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll

def get_or_create_material(name, color=(0.5, 0.5, 0.5, 1.0), roughness=0.7, metallic=0.0):
    mat = bpy.data.materials.get(name)
    if not mat:
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs['Base Color'].default_value = color
            bsdf.inputs['Roughness'].default_value = roughness
            bsdf.inputs['Metallic'].default_value = metallic
    return mat

def add_vcol(mesh, color_fn):
    if "Col" in mesh.color_attributes:
        ca = mesh.color_attributes["Col"]
    elif "COLOR_0" in mesh.color_attributes:
        ca = mesh.color_attributes["COLOR_0"]
    else:
        ca = mesh.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
    
    mesh.color_attributes.active = ca
    if ca.domain == 'POINT':
        for i, vert in enumerate(mesh.vertices):
            col = color_fn(vert.co, vert.normal)
            ca.data[i].color = (col[0], col[1], col[2], 1.0)
    elif ca.domain == 'CORNER':
        for loop in mesh.loops:
            vert = mesh.vertices[loop.vertex_index]
            col = color_fn(vert.co, vert.normal)
            ca.data[loop.index].color = (col[0], col[1], col[2], 1.0)

def fix_normals(mesh):
    """Recalculates all face normals outward using bmesh."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

def unlink_and_remove_objects(pattern, coll):
    to_remove = [o for o in coll.objects if pattern(o.name)]
    for o in to_remove:
        bpy.data.objects.remove(o, do_unlink=True)

# ----------------------------------------------------------------------------
# 1. CYPRESS TREE GENERATOR (PROPER OUTWARD NORMALS & LUSH VOLUME)
# ----------------------------------------------------------------------------
def build_cypress_mesh():
    mesh_name = "WP2_Cypress_MasterMesh"
    if mesh_name in bpy.data.meshes:
        bpy.data.meshes.remove(bpy.data.meshes[mesh_name])
    
    mesh = bpy.data.meshes.new(mesh_name)
    verts = []
    faces = []
    
    trunk_sides = 8
    trunk_r = 0.22
    
    # Extended trunk going down to z = -3.5 to embed into slopes
    for i in range(trunk_sides):
        ang = i * 2 * math.pi / trunk_sides
        verts.append((math.cos(ang)*trunk_r*1.1, math.sin(ang)*trunk_r*1.1, -3.5))
        verts.append((math.cos(ang)*trunk_r*0.8, math.sin(ang)*trunk_r*0.8, 3.5))
    
    for i in range(trunk_sides):
        n = (i + 1) % trunk_sides
        # Counter-clockwise winding for outward normals
        faces.append((i*2, i*2+1, n*2+1, n*2))
        
    tiers = [
        (0.8, 4.5, 1.45, 1.18, 1),
        (3.6, 7.2, 1.35, 1.00, 2),
        (6.2, 9.8, 1.15, 0.80, 3),
        (8.8, 12.0, 0.90, 0.55, 4),
        (11.0, 13.8, 0.58, 0.30, 5),
        (13.0, 14.8, 0.30, 0.02, 6),
    ]
    
    sides = 12
    for t_idx, (z_b, z_t, r_max, r_top, seed) in enumerate(tiers):
        random.seed(seed)
        h_mid = z_b + (z_t - z_b) * 0.45
        t_base = len(verts)
        
        for i in range(sides):
            a = i * 2 * math.pi / sides + random.uniform(-0.08, 0.08)
            r = r_max * 0.65 + random.uniform(-0.08, 0.08)
            verts.append((math.cos(a)*r, math.sin(a)*r, z_b))
            
        for i in range(sides):
            a = i * 2 * math.pi / sides + random.uniform(-0.08, 0.08)
            r = r_max + random.uniform(-0.12, 0.12)
            verts.append((math.cos(a)*r, math.sin(a)*r, h_mid))
            
        for i in range(sides):
            a = i * 2 * math.pi / sides + random.uniform(-0.08, 0.08)
            r = r_top + random.uniform(-0.06, 0.06)
            verts.append((math.cos(a)*r, math.sin(a)*r, z_t))
            
        if t_idx == len(tiers) - 1:
            tip_idx = len(verts)
            verts.append((0.0, 0.0, z_t + 0.6))
        
        # Winding order for outward normals: (b0, b1, m1, m0)
        for i in range(sides):
            n = (i + 1) % sides
            b0, b1 = t_base + i, t_base + n
            m0, m1 = t_base + sides + i, t_base + sides + n
            faces.append((b0, b1, m1, m0))
            
        for i in range(sides):
            n = (i + 1) % sides
            m0, m1 = t_base + sides + i, t_base + sides + n
            u0, u1 = t_base + sides*2 + i, t_base + sides*2 + n
            faces.append((m0, m1, u1, u0))
            
        # Bottom cap closure
        for i in range(sides):
            n = (i + 1) % sides
            b0, b1 = t_base + i, t_base + n
            faces.append((b0, t_base + sides*2 + i, b1))
            
        if t_idx == len(tiers) - 1:
            for i in range(sides):
                n = (i + 1) % sides
                u0, u1 = t_base + sides*2 + i, t_base + sides*2 + n
                faces.append((u0, u1, tip_idx))

    mesh.from_pydata(verts, [], faces)
    fix_normals(mesh)
    
    mat_cypress = get_or_create_material("Tree_Cypress", color=(0.08, 0.22, 0.15, 1.0), roughness=0.85)
    mat_bark = get_or_create_material("Tree_Bark", color=(0.28, 0.22, 0.18, 1.0), roughness=0.9)
    
    mesh.materials.append(mat_cypress)
    mesh.materials.append(mat_bark)
    
    for poly in mesh.polygons:
        if poly.index < trunk_sides:
            poly.material_index = 1
        else:
            poly.material_index = 0
            
    def vcol_cypress(co, norm):
        z = max(0.0, co.z)
        norm_z = max(0.0, norm.z)
        height_t = min(1.0, z / 15.0)
        shadow = 0.30 + 0.60 * height_t + 0.30 * norm_z
        return (0.08 * shadow, (0.22 + 0.15 * height_t) * shadow, (0.15 + 0.08 * height_t) * shadow)
        
    add_vcol(mesh, vcol_cypress)
    return mesh

# ----------------------------------------------------------------------------
# 2. DECIDUOUS TREE GENERATOR
# ----------------------------------------------------------------------------
def build_deciduous_mesh():
    mesh_name = "WP2_Deciduous_MasterMesh"
    if mesh_name in bpy.data.meshes:
        bpy.data.meshes.remove(bpy.data.meshes[mesh_name])
        
    mesh = bpy.data.meshes.new(mesh_name)
    verts = []
    faces = []
    
    trunk_sides = 8
    for i in range(trunk_sides):
        a = i * 2 * math.pi / trunk_sides
        verts.append((math.cos(a)*0.40, math.sin(a)*0.40, -3.5))
    for i in range(trunk_sides):
        a = i * 2 * math.pi / trunk_sides
        verts.append((math.cos(a)*0.28 + 0.1, math.sin(a)*0.28, 2.2))
        
    for i in range(trunk_sides):
        n = (i + 1) % trunk_sides
        faces.append((i, i+trunk_sides, n+trunk_sides, n))
        
    lobes = [
        (0.2, 0.0, 4.2, 2.2, 10),
        (-1.2, 0.8, 3.8, 1.8, 11),
        (1.4, -0.6, 3.9, 1.9, 12),
        (0.6, 1.2, 4.8, 1.7, 13),
        (-0.5, -1.1, 4.5, 1.8, 14),
    ]
    
    for cx, cy, cz, r, seed in lobes:
        random.seed(seed)
        l_base = len(verts)
        sub_v = []
        sub_v.append((cx, cy, cz + r * 1.15))
        for i in range(5):
            a = i * 2 * math.pi / 5 + random.uniform(-0.1, 0.1)
            zr = cz + r * 0.5 + random.uniform(-0.15, 0.15)
            rr = r * 0.85 + random.uniform(-0.15, 0.15)
            sub_v.append((cx + math.cos(a)*rr, cy + math.sin(a)*rr, zr))
        for i in range(5):
            a = i * 2 * math.pi / 5 + math.pi/5 + random.uniform(-0.1, 0.1)
            zr = cz + random.uniform(-0.2, 0.2)
            rr = r * 1.05 + random.uniform(-0.2, 0.2)
            sub_v.append((cx + math.cos(a)*rr, cy + math.sin(a)*rr, zr))
        for i in range(5):
            a = i * 2 * math.pi / 5 + random.uniform(-0.1, 0.1)
            zr = cz - r * 0.5 + random.uniform(-0.15, 0.15)
            rr = r * 0.75 + random.uniform(-0.15, 0.15)
            sub_v.append((cx + math.cos(a)*rr, cy + math.sin(a)*rr, zr))
        sub_v.append((cx, cy, cz - r * 0.9))
        
        verts.extend(sub_v)
        
        for i in range(5):
            n = (i + 1) % 5
            faces.append((l_base, l_base + 1 + n, l_base + 1 + i))
        for i in range(5):
            n = (i + 1) % 5
            u0, u1 = l_base + 1 + i, l_base + 1 + n
            m0, m1 = l_base + 6 + i, l_base + 6 + n
            faces.append((u0, u1, m0))
            faces.append((u1, m1, m0))
        for i in range(5):
            n = (i + 1) % 5
            m0, m1 = l_base + 6 + i, l_base + 6 + n
            b0, b1 = l_base + 11 + i, l_base + 11 + n
            faces.append((m0, m1, b0))
            faces.append((m1, b1, b0))
        bot_idx = l_base + 16
        for i in range(5):
            n = (i + 1) % 5
            faces.append((l_base + 11 + i, l_base + 11 + n, bot_idx))

    mesh.from_pydata(verts, [], faces)
    fix_normals(mesh)
    
    mat_canopy = get_or_create_material("Tree_Canopy", color=(0.14, 0.33, 0.20, 1.0), roughness=0.8)
    mat_bark = get_or_create_material("Tree_Bark", color=(0.28, 0.22, 0.18, 1.0), roughness=0.9)
    
    mesh.materials.append(mat_canopy)
    mesh.materials.append(mat_bark)
    
    for poly in mesh.polygons:
        if poly.index < trunk_sides:
            poly.material_index = 1
        else:
            poly.material_index = 0
            
    def vcol_tree(co, norm):
        z = max(0.0, co.z)
        nz = max(0.0, norm.z)
        shadow = 0.3 + 0.5 * (z / 6.0) + 0.35 * nz
        return (0.14 * shadow, 0.36 * shadow, 0.22 * shadow)
        
    add_vcol(mesh, vcol_tree)
    return mesh

# ----------------------------------------------------------------------------
# 3. GIANT STONE AMPHORA WITH CASCADING LEAVES
# ----------------------------------------------------------------------------
def build_amphora_mesh():
    mesh_name = "WP2_Amphora_MasterMesh"
    if mesh_name in bpy.data.meshes:
        bpy.data.meshes.remove(bpy.data.meshes[mesh_name])
        
    mesh = bpy.data.meshes.new(mesh_name)
    verts = []
    faces = []
    
    profile = [
        (0.70, 0.00), (0.70, 0.25), (0.42, 0.30), (0.50, 0.55), (0.38, 0.65),
        (0.75, 1.15), (0.95, 1.65), (0.68, 2.10), (0.72, 2.45), (0.82, 2.65), (0.60, 2.58)
    ]
    
    segments = 16
    for r, z in profile:
        for s in range(segments):
            a = s * 2 * math.pi / segments
            verts.append((math.cos(a)*r, math.sin(a)*r, z))
            
    for p_idx in range(len(profile) - 1):
        r0 = p_idx * segments
        r1 = (p_idx + 1) * segments
        for s in range(segments):
            n = (s + 1) % segments
            v0, v1 = r0 + s, r0 + n
            v2, v3 = r1 + s, r1 + n
            faces.append((v0, v2, v3, v1))
            
    for h_side in [-1.0, 1.0]:
        h_base = len(verts)
        h_pts = [
            (h_side * 0.90, 0.0, 1.55, 0.08),
            (h_side * 1.18, 0.0, 1.85, 0.07),
            (h_side * 1.25, 0.0, 2.25, 0.07),
            (h_side * 1.05, 0.0, 2.55, 0.08),
            (h_side * 0.80, 0.0, 2.62, 0.08),
        ]
        for hx, hy, hz, hr in h_pts:
            verts.append((hx - hr, hy - hr, hz))
            verts.append((hx + hr, hy - hr, hz))
            verts.append((hx + hr, hy + hr, hz))
            verts.append((hx - hr, hy + hr, hz))
            
        for i in range(len(h_pts) - 1):
            s0 = h_base + i * 4
            s1 = h_base + (i + 1) * 4
            for c in range(4):
                cn = (c + 1) % 4
                faces.append((s0 + c, s1 + c, s1 + cn, s0 + cn))
                
    urn_polys_count = len(faces)
    
    num_leaf_clusters = 18
    for l_idx in range(num_leaf_clusters):
        angle = l_idx * 2 * math.pi / num_leaf_clusters + random.uniform(-0.1, 0.1)
        dir_x, dir_y = math.cos(angle), math.sin(angle)
        
        leaf_len = random.uniform(1.8, 2.4)
        leaf_w = random.uniform(0.12, 0.20)
        
        leaf_base_v = len(verts)
        steps = 7
        for st in range(steps):
            t = st / (steps - 1)
            r_curr = 0.68 + 0.42 * math.sin(t * math.pi * 0.75) + 0.15 * (t ** 1.5)
            z_curr = 2.58 - t * leaf_len
            wave = math.sin(t * 8.0 + l_idx) * 0.04
            w_curr = leaf_w * (1.0 - (t ** 1.8) * 0.85)
            
            px = dir_x * r_curr + dir_y * wave
            py = dir_y * r_curr - dir_x * wave
            pz = z_curr
            tx, ty = -dir_y * w_curr, dir_x * w_curr
            
            verts.append((px - tx, py - ty, pz))
            verts.append((px + tx, py + ty, pz))
            
        for st in range(steps - 1):
            v0 = leaf_base_v + st * 2
            v1 = leaf_base_v + st * 2 + 1
            v2 = leaf_base_v + (st + 1) * 2
            v3 = leaf_base_v + (st + 1) * 2 + 1
            faces.append((v0, v2, v3, v1))

    mesh.from_pydata(verts, [], faces)
    fix_normals(mesh)
    
    mat_stone = get_or_create_material("Ruin_Marble", color=(0.82, 0.80, 0.76, 1.0), roughness=0.55)
    mat_leaf = get_or_create_material("Amphora_Leaves", color=(0.12, 0.42, 0.28, 1.0), roughness=0.7)
    
    mesh.materials.append(mat_stone)
    mesh.materials.append(mat_leaf)
    
    for poly in mesh.polygons:
        if poly.index < urn_polys_count:
            poly.material_index = 0
        else:
            poly.material_index = 1
            
    def vcol_amphora(co, norm):
        if co.z > 2.5 or (co.z < 2.5 and math.sqrt(co.x**2 + co.y**2) > 0.85):
            tip_t = max(0.0, min(1.0, (2.6 - co.z) / 2.2))
            shadow = 0.35 + 0.65 * norm.z if norm.z > 0 else 0.4
            return ((0.10 + 0.05 * tip_t) * shadow, (0.45 + 0.20 * tip_t) * shadow, (0.28 + 0.12 * tip_t) * shadow)
        else:
            shadow = 0.6 + 0.4 * max(0.0, norm.z)
            return (0.80 * shadow, 0.78 * shadow, 0.74 * shadow)
            
    add_vcol(mesh, vcol_amphora)
    return mesh

# ----------------------------------------------------------------------------
# 4. WATERFALL OVERHAUL
# ----------------------------------------------------------------------------
def overhaul_waterfalls(coll):
    def create_fall_mesh(name, start_pt, mid_pt, end_pt, width_start, width_end):
        mesh = bpy.data.meshes.new(name)
        verts = []
        faces = []
        uvs = []
        steps_v = 12
        steps_u = 6
        
        for sv in range(steps_v):
            tv = sv / (steps_v - 1)
            px = (1-tv)**2 * start_pt[0] + 2*(1-tv)*tv * mid_pt[0] + tv**2 * end_pt[0]
            py = (1-tv)**2 * start_pt[1] + 2*(1-tv)*tv * mid_pt[1] + tv**2 * end_pt[1]
            pz = (1-tv)**2 * start_pt[2] + 2*(1-tv)*tv * mid_pt[2] + tv**2 * end_pt[2]
            w_curr = width_start + (width_end - width_start) * tv
            
            dx = end_pt[0] - start_pt[0]
            dy = end_pt[1] - start_pt[1]
            length_xy = math.sqrt(dx*dx + dy*dy) + 1e-5
            nx, ny = -dy / length_xy, dx / length_xy
            
            for su in range(steps_u):
                tu = su / (steps_u - 1)
                offset = (tu - 0.5) * w_curr
                vx = px + nx * offset
                vy = py + ny * offset
                vz = pz + math.sin(tv * math.pi) * 0.35
                verts.append((vx, vy, vz))
                uvs.append((tu, tv))
                
        for sv in range(steps_v - 1):
            row0 = sv * steps_u
            row1 = (sv + 1) * steps_u
            for su in range(steps_u - 1):
                v0 = row0 + su
                v1 = row0 + su + 1
                v2 = row1 + su
                v3 = row1 + su + 1
                faces.append((v0, v2, v3, v1))
                
        mesh.from_pydata(verts, [], faces)
        fix_normals(mesh)
        
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for loop_idx in poly.loop_indices:
                v_idx = mesh.loops[loop_idx].vertex_index
                uv_layer.data[loop_idx].uv = uvs[v_idx]
                
        mat_fall = get_or_create_material("Water_Falls", color=(0.2, 0.7, 0.8, 0.7), roughness=0.1)
        mesh.materials.append(mat_fall)
        return mesh

    falls_data = [
        ("WP2_Waterfall_L_Upper", (-18.5, -65.0, 26.0), (-16.5, -63.5, 19.0), (-15.2, -61.0, 13.5), 3.8, 4.5),
        ("WP2_Waterfall_L",       (-15.2, -61.0, 13.5), (-14.5, -57.5, 7.0),  (-13.8, -54.0, 0.23), 4.5, 5.5),
        ("WP2_Waterfall_R_Upper", (20.5, -64.5, 26.0),  (18.5, -62.8, 19.0), (16.8, -60.2, 13.5), 3.8, 4.5),
        ("WP2_Waterfall_R",       (16.8, -60.2, 13.5),  (14.2, -56.5, 7.0),  (11.5, -53.2, 0.23), 4.5, 5.5),
    ]
    
    for obj_name, p0, p1, p2, w0, w1 in falls_data:
        obj = bpy.data.objects.get(obj_name)
        mesh = create_fall_mesh(obj_name, p0, p1, p2, w0, w1)
        if not obj:
            obj = bpy.data.objects.new(obj_name, mesh)
            coll.objects.link(obj)
        else:
            obj.data = mesh
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        obj["shader"] = "waterfall"

    def create_foam_mesh(name, radius):
        mesh = bpy.data.meshes.new(name)
        verts = []
        faces = []
        uvs = []
        verts.append((0.0, 0.0, 0.0))
        uvs.append((0.5, 0.5))
        rings = 4
        segments = 12
        for r_idx in range(1, rings + 1):
            r_ratio = r_idx / rings
            r_curr = radius * r_ratio
            for s in range(segments):
                a = s * 2 * math.pi / segments
                u = 0.5 + 0.5 * r_ratio * math.cos(a)
                v = 0.5 + 0.5 * r_ratio * math.sin(a)
                verts.append((math.cos(a)*r_curr, math.sin(a)*r_curr, 0.0))
                uvs.append((u, v))
                
        for s in range(segments):
            n = (s + 1) % segments
            faces.append((0, 1 + n, 1 + s))
            
        for r_idx in range(1, rings):
            r0_base = 1 + (r_idx - 1) * segments
            r1_base = 1 + r_idx * segments
            for s in range(segments):
                n = (s + 1) % segments
                v0, v1 = r0_base + s, r0_base + n
                v2, v3 = r1_base + s, r1_base + n
                faces.append((v0, v2, v3, v1))
                
        mesh.from_pydata(verts, [], faces)
        fix_normals(mesh)
        
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for loop_idx in poly.loop_indices:
                v_idx = mesh.loops[loop_idx].vertex_index
                uv_layer.data[loop_idx].uv = uvs[v_idx]
                
        mat_foam = get_or_create_material("Water_Foam", color=(0.9, 0.95, 1.0, 0.9), roughness=0.2)
        mesh.materials.append(mat_foam)
        return mesh

    foam_data = [
        ("WP2_Falls_Foam_Mid_L", (-15.2, -61.0, 13.52), 4.2),
        ("WP2_Falls_Foam_L",     (-13.8, -54.0, 0.28),  5.5),
        ("WP2_Falls_Foam_Mid_R", (16.8, -60.2, 13.52),  4.2),
        ("WP2_Falls_Foam_R",     (11.5, -53.2, 0.28),   5.5),
    ]
    
    for obj_name, loc, r in foam_data:
        obj = bpy.data.objects.get(obj_name)
        mesh = create_foam_mesh(obj_name, r)
        if not obj:
            obj = bpy.data.objects.new(obj_name, mesh)
            coll.objects.link(obj)
        else:
            obj.data = mesh
        obj.location = loc
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        obj["shader"] = "foam"

    mist_data = [
        ("WP2_Falls_Mist_Mid_L", (-15.2, -60.5, 14.0), 5.0),
        ("WP2_Falls_Mist_L",     (-13.5, -53.5, 0.65), 6.5),
        ("WP2_Falls_Mist_Mid_R", (16.8, -59.8, 14.0), 5.0),
        ("WP2_Falls_Mist_R",     (11.2, -52.8, 0.65), 6.5),
    ]
    for obj_name, loc, r in mist_data:
        obj = bpy.data.objects.get(obj_name)
        mesh = create_foam_mesh(obj_name, r)
        if not obj:
            obj = bpy.data.objects.new(obj_name, mesh)
            coll.objects.link(obj)
        else:
            obj.data = mesh
        obj.location = loc
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        obj["shader"] = "mist"

    boulder_positions = {
        "WP2_FallsBoulder_L_0": (-18.2, -62.0, 11.0),
        "WP2_FallsBoulder_L_1": (-19.0, -58.0, 7.5),
        "WP2_FallsBoulder_L_2": (-16.5, -56.0, 0.5),
        "WP2_FallsBoulder_R_0": (20.5, -62.0, 11.0),
        "WP2_FallsBoulder_R_1": (17.5, -58.0, 7.5),
        "WP2_FallsBoulder_R_2": (14.5, -56.0, 0.5),
    }
    for b_name, b_loc in boulder_positions.items():
        b_obj = bpy.data.objects.get(b_name)
        if b_obj:
            b_obj.location = b_loc

# ----------------------------------------------------------------------------
# MAIN EXECUTOR
# ----------------------------------------------------------------------------
def main():
    print("[optimize_wp2] Starting direct in-place update of WP2 Garden in world.blend...")
    coll = get_or_create_collection("WP2_Garden")
    
    mesh_cypress = build_cypress_mesh()
    mesh_tree = build_deciduous_mesh()
    mesh_amphora = build_amphora_mesh()
    
    master_cypress_obj = bpy.data.objects.get("WP2_Cypress")
    if not master_cypress_obj:
        master_cypress_obj = bpy.data.objects.new("WP2_Cypress", mesh_cypress)
        coll.objects.link(master_cypress_obj)
    else:
        master_cypress_obj.data = mesh_cypress
    master_cypress_obj.location = (0, 0, -400)
    
    master_tree_obj = bpy.data.objects.get("WP2_Tree_Canopy")
    if not master_tree_obj:
        master_tree_obj = bpy.data.objects.new("WP2_Tree_Canopy", mesh_tree)
        coll.objects.link(master_tree_obj)
    else:
        master_tree_obj.data = mesh_tree
    master_tree_obj.location = (0, 0, -400)
    
    overhaul_waterfalls(coll)
    
    unlink_and_remove_objects(lambda n: n.startswith("WP2_Cypress_") or n.startswith("WP2_Trunk_") or n.startswith("WP2_Amphora_") or n.startswith("WP2_Deciduous_"), coll)
    
    # ------------------------------------------------------------------------
    # OPTIMIZED CYPRESS CLUSTERING & SIZING (BÖCKLIN STYLE GROVES)
    # ------------------------------------------------------------------------
    cypress_placements = [
        # Cluster A: Behind Ionic Column & Ruin Terrace (X: +10 to +25, Y: -32 to -48)
        (13.5, -34.0, 3.2, 1.4, 1.8),
        (16.5, -37.5, 4.8, 1.6, 2.1), # Towering hero cypress
        (20.0, -41.0, 7.0, 1.5, 1.9),
        (24.5, -46.0, 9.5, 1.7, 2.2), # Towering hero cypress
        (18.0, -52.0, 11.0, 1.4, 1.7),
        
        # Cluster B: Left Waterfall Cliff Wall (X: -17 to -26, Y: -52 to -68)
        (-18.5, -53.0, 8.0, 1.4, 1.7),
        (-21.5, -57.0, 14.5, 1.6, 2.1), # Towering hero cypress
        (-25.5, -63.0, 20.0, 1.8, 2.4), # Towering hero cypress
        (-19.0, -67.0, 24.0, 1.5, 1.9),
        
        # Cluster C: Right Waterfall Cliff Wall (X: +18 to +26, Y: -54 to -68)
        (19.5, -55.0, 11.5, 1.4, 1.7),
        (22.5, -59.0, 16.5, 1.6, 2.1), # Towering hero cypress
        (26.0, -65.0, 22.0, 1.7, 2.3), # Towering hero cypress
        
        # Cluster D: Sky-high Backdrop Ridge (Y: -68 to -75, Z: 26 to 30)
        (-12.5, -69.0, 27.0, 1.8, 2.4), # Towering backdrop
        (-5.0,  -71.0, 28.5, 1.9, 2.5), # Towering backdrop
        (5.0,   -71.0, 28.5, 1.9, 2.5), # Towering backdrop
        (12.5,  -69.0, 27.0, 1.8, 2.4), # Towering backdrop
        
        # Cluster E: Left Lake Shore Framing (X: -15 to -22, Y: -30 to -48)
        (-15.5, -31.0, 2.8, 1.3, 1.6),
        (-18.5, -37.0, 4.0, 1.5, 1.8),
        (-21.5, -44.0, 5.8, 1.6, 2.0),
        (-17.0, -49.0, 4.8, 1.4, 1.7),
        
        # Foreground framing at valley entry (X: -14 and +14, Y: -20 to -25)
        (-14.0, -21.0, 3.5, 1.3, 1.6),
        (14.5,  -23.0, 3.2, 1.3, 1.6),
    ]
    
    print(f"[optimize_wp2] Spawning {len(cypress_placements)} Italian Cypress trees with fixed normals...")
    for idx, (cx, cy, cz, s_xy, s_z) in enumerate(cypress_placements, 1):
        obj_name = f"WP2_Cypress_{idx}"
        obj = bpy.data.objects.new(obj_name, mesh_cypress)
        obj.location = (cx, cy, cz)
        obj.rotation_euler = (0, 0, random.uniform(0, math.pi*2))
        obj.scale = (s_xy, s_xy, s_z)
        coll.objects.link(obj)
        
    # ------------------------------------------------------------------------
    # DECIDUOUS TREE PLACEMENTS & SIZES
    # ------------------------------------------------------------------------
    deciduous_placements = [
        (-16.0, -28.0, 2.5, 1.3),
        (-21.0, -36.0, 3.5, 1.5),
        (15.0,  -30.0, 2.8, 1.4),
        (22.0,  -36.0, 4.5, 1.6),
        (-24.0, -52.0, 8.0, 1.5),
        (25.0,  -52.0, 9.0, 1.5),
        (-8.5,  -66.0, 22.0, 1.7),
        (8.5,   -66.0, 22.0, 1.7),
    ]
    
    print(f"[optimize_wp2] Spawning {len(deciduous_placements)} Deciduous trees with fixed normals...")
    for idx, (cx, cy, cz, scale) in enumerate(deciduous_placements, 1):
        obj_name = f"WP2_Deciduous_{idx}"
        obj = bpy.data.objects.new(obj_name, mesh_tree)
        obj.location = (cx, cy, cz)
        obj.rotation_euler = (0, 0, random.uniform(0, math.pi*2))
        obj.scale = (scale, scale, scale)
        coll.objects.link(obj)

    # ------------------------------------------------------------------------
    # GIANT STONE AMPHORAS
    # ------------------------------------------------------------------------
    amphora_placements = [
        ("WP2_Amphora_Ruin",    (4.8, -36.0, 1.8),  (0.0, 0.0, 0.4), 1.35),
        ("WP2_Amphora_Falls_L", (-11.2, -54.5, 0.4), (0.0, 0.05, -0.8), 1.45),
        ("WP2_Amphora_Shore",   (-8.5, -44.0, 0.4), (0.0, -0.05, 0.8), 1.25),
        ("WP2_Amphora_Cliff_R", (14.5, -48.0, 3.2), (0.0, 0.0, -1.2), 1.40),
    ]
    
    print(f"[optimize_wp2] Spawning {len(amphora_placements)} Giant Stone Amphoras...")
    for name, loc, rot, scale in amphora_placements:
        obj = bpy.data.objects.new(name, mesh_amphora)
        obj.location = loc
        obj.rotation_euler = rot
        obj.scale = (scale, scale, scale)
        coll.objects.link(obj)

    blend_path = os.path.join(HERE, "output", "world.blend")
    print(f"[optimize_wp2] Saving updated scene to {blend_path}...")
    exporter.save_blend(blend_path)

    glb_path = os.path.join(HERE, "output", "world.glb")
    print(f"[optimize_wp2] Exporting updated world.glb to {glb_path}...")
    exporter.export_glb(glb_path)
    print("[optimize_wp2] WP2 optimization complete successfully!")

if __name__ == "__main__":
    main()
