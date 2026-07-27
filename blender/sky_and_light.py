# ============================================================================
# sky_and_light.py — atmosphere pass for world.blend (WP1 … WP4).
#
# This is a *targeted edit pass*, never a rebuild: it only touches worlds,
# lights and the SKY_Bake helper scene. No geometry, no camera rail, no
# collection membership of any existing object is modified, so world.blend
# stays the hand-finished file it is.
#
# What it owns
# ------------
#   * four World datablocks — `Sky_WP1_Atrium`, `Sky_WP2_Garden`,
#     `Sky_WP3_Desert`, `Sky_WP4_Cavern` — each a real Nishita sky + procedural
#     cloud/haze node graph. They are the single source of truth for the web
#     sky: edit the Sky Texture node in Blender, re-run `--render`, done.
#   * the `SKY_Bake` scene: one equirectangular Cycles camera, no geometry.
#     Renders each world to `assets/world/sky/sky_wp{n}.jpg` in exactly the
#     orientation three.js' `equirectUv()` expects (see `_aim_equirect_cam`).
#   * `assets/world/sky_rig.json` — per zone: sun direction (derived from the
#     Sky Texture itself, so lamp and painted sun can never disagree), sun and
#     hemisphere colours sampled *out of the rendered panorama*, fog colour,
#     density and exposure. src/world/fx.js consumes it verbatim.
#   * the punctual lights already in the scene: retuned for mood, and each one
#     tagged with `web_intensity` / `web_distance` / `web_decay` custom props
#     that ride along in the glTF extras — three.js no longer guesses.
#
# Usage
# -----
#   blender -b blender/output/world.blend -P blender/sky_and_light.py -- --build
#   blender -b blender/output/world.blend -P blender/sky_and_light.py -- --render
#   (no flag = both; --build saves the .blend, --render never does)
# ============================================================================
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "output")
SKY_DIR = os.path.join(ROOT, "assets", "world", "sky")
RIG_JSON = os.path.join(ROOT, "assets", "world", "sky_rig.json")
BLEND = os.path.join(OUT, "world.blend")

PANO_W, PANO_H = 2048, 1024

# ------------------------------------------------------------- the one sun --
# There is exactly one sun for the whole world, and every zone bakes its sky
# with it. Two reasons, both hard:
#
#   * The runtime draws ONE static shadow map for the whole world (rendered
#     once, never again — see PIPELINE.md §4.2). A per-zone sun direction would
#     mean shadows pointing one way and the light coming from another.
#   * The angle is dictated by geometry, not taste. Every facade on this rail
#     faces +Y, and the WP3 bowl is ringed by 40 m buttes — ray-casting the sun
#     from the saloon, the porch and the bowl floor says anything below ~27 deg
#     elevation, or more than ~10 deg off +Y, leaves the hero waypoint in the
#     shadow of its own rim. This pair clears every waypoint that was measured.
#
# The four zones stay distinct through atmosphere (air / dust / ozone), cloud
# palette, sun *colour and level*, fog and exposure — none of which move a
# shadow. Re-run the ray-cast sweep before touching these two numbers.
SUN_ELEVATION = 30.0
SUN_ROTATION = -9.0        # azimuth from +Y towards +X

# ---------------------------------------------------------------- zone specs --
# `u` is the path parameter the zone is centred on (PIPELINE.md §2). The web
# side cross-fades between neighbouring zones over the `fade` window, which is
# always placed where the geometry hides the change (gate, canyon, mine mouth).
ZONES = [
    dict(
        key="wp1", world="Sky_WP1_Atrium", label="Atrium — klarer Vormittag",
        # high, hard, cool: brutalist concrete wants a crisp thin blue, so the
        # least dust and the most ozone of the four
        sun_size=2.2, sun_intensity=1.0,
        sun_color="#fff3e2",
        air=1.0, dust=0.30, ozone=1.9, altitude=180.0, ground_albedo=0.24,
        strength=1.0, auto_target=0.80, exposure_bias=0.0,
        haze_color=(0.68, 0.78, 0.90), haze_low=-0.22, haze_high=0.42,
        clouds=dict(scale=0.85, detail=9.0, rough=0.52, distort=0.12,
                    cov_lo=0.555, cov_hi=0.66, opacity=0.95,
                    lit=(1.0, 0.99, 0.97), shadow=(0.70, 0.76, 0.86),
                    lit_gain=11.0, shadow_gain=5.0,
                    offset=(11.0, 4.0)),
        # high thin streaks: stretched along Y, barely any distortion
        cirrus=dict(scale=(3.1, 0.55, 1.0), detail=6.0, rough=0.66, distort=0.20,
                    cov_lo=0.54, cov_hi=0.66, opacity=0.45,
                    lit=(1.0, 1.0, 1.0), shadow=(0.90, 0.93, 0.97),
                    lit_gain=9.5, shadow_gain=6.5,
                    offset=(3.0, 21.0)),
        # web rig
        # key : ambient ratio is what decides whether a zone reads as modelled
        # or as a flat wash. The atrium interior gets no sun at all (its own
        # roof shades it) and leans on the point fills in the .blend, so its
        # ambient stays the highest of the four.
        exposure=1.00, fog_density=0.0040, hemi=0.58, sun_energy=1.45,
        fill_energy=0.32,
        sky_brightness=1.00,
    ),
    dict(
        key="wp2", world="Sky_WP2_Garden", label="Elysischer Garten — weicher Nachmittag",
        # lower, softer, hazier: elysian light, big lazy cumulus
        sun_size=3.0, sun_intensity=1.0,
        sun_color="#ffeed2",
        air=1.45, dust=1.40, ozone=0.9, altitude=90.0, ground_albedo=0.30,
        strength=1.05, auto_target=0.82, exposure_bias=0.0,
        haze_color=(0.86, 0.88, 0.83), haze_low=-0.20, haze_high=0.50,
        clouds=dict(scale=0.62, detail=10.0, rough=0.56, distort=0.18,
                    cov_lo=0.495, cov_hi=0.63, opacity=0.97,
                    lit=(1.0, 0.98, 0.93), shadow=(0.66, 0.70, 0.80),
                    lit_gain=13.0, shadow_gain=5.0,
                    offset=(27.0, 13.0)),
        cirrus=dict(scale=(2.6, 0.5, 1.0), detail=5.0, rough=0.66, distort=0.2,
                    cov_lo=0.56, cov_hi=0.68, opacity=0.34,
                    lit=(1.0, 0.99, 0.96), shadow=(0.88, 0.90, 0.93),
                    lit_gain=11.0, shadow_gain=7.5,
                    offset=(15.0, 33.0)),
        exposure=1.02, fog_density=0.0052, hemi=0.60, sun_energy=1.60,
        fill_energy=0.42,
        sky_brightness=1.00,
    ),
    dict(
        key="wp3", world="Sky_WP3_Desert", label="Westernwüste — goldene Stunde",
        # low and warm: monument valley an hour before sunset
        # the sun cannot go low here (see SUN_ELEVATION), so the warmth comes
        # from a thick dusty atmosphere instead: heavy aerosol, little ozone
        sun_size=3.4, sun_intensity=1.15,
        sun_color="#ffd9a4",
        air=1.9, dust=5.0, ozone=0.35, altitude=1400.0, ground_albedo=0.45,
        strength=1.15, auto_target=0.86, exposure_bias=0.0,
        haze_color=(0.95, 0.72, 0.48), haze_low=-0.24, haze_high=0.34,
        clouds=dict(scale=0.68, detail=10.0, rough=0.58, distort=0.22,
                    cov_lo=0.505, cov_hi=0.635, opacity=0.97,
                    lit=(1.0, 0.82, 0.60), shadow=(0.46, 0.42, 0.50),
                    lit_gain=9.0, shadow_gain=2.6,
                    offset=(41.0, 8.0)),
        cirrus=dict(scale=(2.2, 0.45, 1.0), detail=6.0, rough=0.66, distort=0.25,
                    cov_lo=0.50, cov_hi=0.63, opacity=0.55,
                    lit=(1.0, 0.74, 0.50), shadow=(0.70, 0.56, 0.55),
                    lit_gain=10.0, shadow_gain=3.4,
                    offset=(7.0, 47.0)),
        # golden hour lives on contrast: the lowest ambient and the hardest
        # key of the four, or the whole bowl turns into one flat tan wash
        exposure=1.06, fog_density=0.0068, hemi=0.40, sun_energy=2.05,
        fill_energy=0.34,
        sky_brightness=1.00,
    ),
    dict(
        key="wp4", world="Sky_WP4_Cavern", label="Metro-Kaverne — Untertage",
        # no sky at all: what little "background" shows through the rock is
        # cold stone above and the warm spill of the platform lights below
        cavern=dict(
            stops=[(0.00, (0.055, 0.031, 0.020)),
                   (0.34, (0.022, 0.020, 0.024)),
                   (0.55, (0.011, 0.013, 0.019)),
                   (0.78, (0.014, 0.019, 0.030)),
                   (1.00, (0.026, 0.034, 0.052))],
            grain=0.35),
        sun_color="#8fa6c8",
        # auto_target is *linear* luminance, so 0.012 lands near 0.10 on the
        # sRGB display side — underground has to stay underground
        strength=1.0, auto_target=0.012, exposure_bias=0.0,
        exposure=1.10, fog_density=0.0150, hemi=0.14, sun_energy=0.03,
        fill_energy=0.02,
        sky_brightness=1.00,
    ),
]


# ------------------------------------------------------------------ helpers --
def _clear(nt):
    for n in list(nt.nodes):
        nt.nodes.remove(n)


def _n(nt, idname, x, y, **kw):
    node = nt.nodes.new(idname)
    node.location = (x, y)
    for k, v in kw.items():
        setattr(node, k, v)
    return node


def _set(node, key, value):
    node.inputs[key].default_value = value


def _ramp(node, stops):
    """stops: [(pos, (r,g,b)) | (pos, float)] — rebuilt from scratch."""
    el = node.color_ramp.elements
    while len(el) > 2:
        el.remove(el[-1])
    for i, (pos, col) in enumerate(stops):
        e = el[i] if i < len(el) else el.new(pos)
        e.position = pos
        e.color = (col + (1.0,)) if isinstance(col, tuple) else (col, col, col, 1.0)


def _cloud_layer(nt, x, y, gen, sepz, spec, sky_in):
    """Project the view direction onto a flat cloud deck and mix it over
    `sky_in`.

    The deck coordinate is the view ray hitting a plane: (X, Y) / Z. That is
    what makes clouds bunch up towards the horizon like real ones, but it also
    goes to infinity there — a plain divide turns the last few degrees of sky
    into high-frequency mush. So the radius is squashed through
    r' = R*r/(R+r), which maps the whole dome into a finite disc of radius R
    and leaves a clean, converging horizon band."""
    RMAX = 7.0

    vxy = _n(nt, 'ShaderNodeCombineXYZ', x, y + 420)
    nt.links.new(sepz.outputs['X'], vxy.inputs['X'])
    nt.links.new(sepz.outputs['Y'], vxy.inputs['Y'])
    ln = _n(nt, 'ShaderNodeVectorMath', x + 180, y + 420, operation='LENGTH')
    nt.links.new(vxy.outputs[0], ln.inputs[0])

    m = _n(nt, 'ShaderNodeMath', x, y + 240, operation='MAXIMUM')
    nt.links.new(sepz.outputs['Z'], m.inputs[0])
    _set(m, 1, 0.03)

    r = _n(nt, 'ShaderNodeMath', x + 180, y + 240, operation='DIVIDE')
    nt.links.new(ln.outputs['Value'], r.inputs[0])
    nt.links.new(m.outputs[0], r.inputs[1])

    num = _n(nt, 'ShaderNodeMath', x + 340, y + 320, operation='MULTIPLY')
    nt.links.new(r.outputs[0], num.inputs[0])
    _set(num, 1, RMAX)
    den = _n(nt, 'ShaderNodeMath', x + 340, y + 160, operation='ADD')
    nt.links.new(r.outputs[0], den.inputs[0])
    _set(den, 1, RMAX)
    rc = _n(nt, 'ShaderNodeMath', x + 500, y + 240, operation='DIVIDE')
    nt.links.new(num.outputs[0], rc.inputs[0])
    nt.links.new(den.outputs[0], rc.inputs[1])

    lsafe = _n(nt, 'ShaderNodeMath', x + 340, y + 480, operation='MAXIMUM')
    nt.links.new(ln.outputs['Value'], lsafe.inputs[0])
    _set(lsafe, 1, 1e-4)
    k = _n(nt, 'ShaderNodeMath', x + 660, y + 380, operation='DIVIDE')
    nt.links.new(rc.outputs[0], k.inputs[0])
    nt.links.new(lsafe.outputs[0], k.inputs[1])

    comb = _n(nt, 'ShaderNodeVectorMath', x + 660, y + 200, operation='SCALE')
    nt.links.new(vxy.outputs[0], comb.inputs[0])
    nt.links.new(k.outputs[0], comb.inputs['Scale'])

    mapn = _n(nt, 'ShaderNodeMapping', x + 840, y + 260)
    nt.links.new(comb.outputs[0], mapn.inputs['Vector'])
    _set(mapn, 'Location', (spec["offset"][0], spec["offset"][1], 0.0))
    s = spec["scale"]
    _set(mapn, 'Scale', tuple(s) if isinstance(s, (tuple, list)) else (s, s, s))

    noise = _n(nt, 'ShaderNodeTexNoise', x + 1040, y + 260)
    nt.links.new(mapn.outputs[0], noise.inputs['Vector'])
    _set(noise, 'Scale', 1.0)
    _set(noise, 'Detail', spec["detail"])
    _set(noise, 'Roughness', spec["rough"])
    _set(noise, 'Distortion', spec["distort"])

    mask = _n(nt, 'ShaderNodeValToRGB', x + 1240, y + 380)
    nt.links.new(noise.outputs['Fac'], mask.inputs['Fac'])
    _ramp(mask, [(spec["cov_lo"], 0.0), (spec["cov_hi"], 1.0)])

    # the compressed deck still crowds at the very rim — feather the last
    # couple of degrees so the band ends in haze instead of a hard edge
    hfade = _n(nt, 'ShaderNodeMapRange', x + 1240, y + 60)
    nt.links.new(sepz.outputs['Z'], hfade.inputs['Value'])
    _set(hfade, 'From Min', 0.004)
    _set(hfade, 'From Max', 0.055)
    _set(hfade, 'To Min', 0.0)
    _set(hfade, 'To Max', 1.0)
    hfade.clamp = True

    a1 = _n(nt, 'ShaderNodeMath', x + 1440, y + 220, operation='MULTIPLY')
    nt.links.new(mask.outputs['Color'], a1.inputs[0])
    nt.links.new(hfade.outputs['Result'], a1.inputs[1])
    a2 = _n(nt, 'ShaderNodeMath', x + 1600, y + 220, operation='MULTIPLY')
    nt.links.new(a1.outputs[0], a2.inputs[0])
    _set(a2, 1, spec["opacity"])

    # Cloud body shading: the denser the core, the brighter the lit top.
    # The gains matter more than the hues — the sky around them is physical
    # radiance in the 2..10 range, so an albedo-valued cloud colour mixed in
    # raw comes out as dark smoke. Sunlit tops are the brightest thing in a
    # real sky short of the sun itself, hence lit_gain > the sky.
    litr = _n(nt, 'ShaderNodeValToRGB', x + 1240, y - 260)
    nt.links.new(noise.outputs['Fac'], litr.inputs['Fac'])
    _ramp(litr, [(spec["cov_lo"] + 0.02, 0.0), (spec["cov_hi"] + 0.14, 1.0)])
    body = _n(nt, 'ShaderNodeMixRGB', x + 1440, y - 260)
    body.blend_type = 'MIX'
    nt.links.new(litr.outputs['Color'], body.inputs['Fac'])
    g_lo, g_hi = spec["shadow_gain"], spec["lit_gain"]
    _set(body, 'Color1', tuple(c * g_lo for c in spec["shadow"]) + (1.0,))
    _set(body, 'Color2', tuple(c * g_hi for c in spec["lit"]) + (1.0,))

    out = _n(nt, 'ShaderNodeMixRGB', x + 1800, y + 40)
    out.blend_type = 'MIX'
    nt.links.new(a2.outputs[0], out.inputs['Fac'])
    nt.links.new(sky_in, out.inputs['Color1'])
    nt.links.new(body.outputs['Color'], out.inputs['Color2'])
    return out.outputs['Color']


def build_sky_world(spec):
    name = spec["world"]
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    # only one world can be assigned to a scene at a time, so without a fake
    # user Blender drops the other three on save and --render finds nothing
    w.use_fake_user = True
    w.use_nodes = True
    nt = w.node_tree
    _clear(nt)

    out = _n(nt, 'ShaderNodeOutputWorld', 4200, 0)
    bg = _n(nt, 'ShaderNodeBackground', 3980, 0)
    _set(bg, 'Strength', spec["strength"])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

    gen = _n(nt, 'ShaderNodeTexCoord', -400, 0)
    sep = _n(nt, 'ShaderNodeSeparateXYZ', -200, 0)
    nt.links.new(gen.outputs['Generated'], sep.inputs['Vector'])

    if spec.get("cavern"):
        cav = spec["cavern"]
        t = _n(nt, 'ShaderNodeMapRange', 20, 0)
        nt.links.new(sep.outputs['Z'], t.inputs['Value'])
        _set(t, 'From Min', -1.0)
        _set(t, 'From Max', 1.0)
        t.clamp = True
        ramp = _n(nt, 'ShaderNodeValToRGB', 220, 0)
        nt.links.new(t.outputs['Result'], ramp.inputs['Fac'])
        _ramp(ramp, cav["stops"])
        # a little rock-coloured grain so the void is not a dead gradient
        noise = _n(nt, 'ShaderNodeTexNoise', 220, -320)
        nt.links.new(gen.outputs['Generated'], noise.inputs['Vector'])
        _set(noise, 'Scale', 3.5)
        _set(noise, 'Detail', 6.0)
        _set(noise, 'Roughness', 0.6)
        grain = _n(nt, 'ShaderNodeMixRGB', 620, -60, blend_type='MULTIPLY')
        _set(grain, 'Fac', cav["grain"])
        nt.links.new(ramp.outputs['Color'], grain.inputs['Color1'])
        nt.links.new(noise.outputs['Fac'], grain.inputs['Color2'])
        add = _n(nt, 'ShaderNodeMixRGB', 820, 0, blend_type='ADD')
        _set(add, 'Fac', 1.0)
        nt.links.new(grain.outputs['Color'], add.inputs['Color1'])
        nt.links.new(ramp.outputs['Color'], add.inputs['Color2'])
        nt.links.new(add.outputs['Color'], bg.inputs['Color'])
        _stamp(w, spec)
        return w

    sky = _n(nt, 'ShaderNodeTexSky', 20, 320)
    # 4.x called the physical model NISHITA; 5.x split it into
    # SINGLE_/MULTIPLE_SCATTERING. Pick whichever this build offers.
    kinds = [e.identifier for e in sky.bl_rna.properties['sky_type'].enum_items]
    for want in ('MULTIPLE_SCATTERING', 'NISHITA', 'SINGLE_SCATTERING', 'HOSEK_WILKIE'):
        if want in kinds:
            sky.sky_type = want
            break
    for attr, val in (
        ("sun_disc", True),
        ("sun_size", math.radians(spec["sun_size"])),
        ("sun_intensity", spec["sun_intensity"]),
        ("sun_elevation", math.radians(SUN_ELEVATION)),
        ("sun_rotation", math.radians(SUN_ROTATION)),
        ("altitude", spec["altitude"]),
        ("air_density", spec["air"]),
        # 4.x: dust_density — 5.x renamed it aerosol_density
        ("aerosol_density", spec["dust"]),
        ("dust_density", spec["dust"]),
        ("ozone_density", spec["ozone"]),
        ("ground_albedo", spec["ground_albedo"]),
    ):
        if hasattr(sky, attr):
            setattr(sky, attr, val)

    # horizon haze: thickens the bottom of the dome so distant geometry has
    # something to dissolve into (fx.js matches the fog colour to it)
    hz = _n(nt, 'ShaderNodeMapRange', 20, -80)
    nt.links.new(sep.outputs['Z'], hz.inputs['Value'])
    _set(hz, 'From Min', spec["haze_low"])
    _set(hz, 'From Max', spec["haze_high"])
    _set(hz, 'To Min', 1.0)
    _set(hz, 'To Max', 0.0)
    hz.clamp = True
    hzp = _n(nt, 'ShaderNodeMath', 220, -80, operation='POWER')
    nt.links.new(hz.outputs['Result'], hzp.inputs[0])
    _set(hzp, 1, 1.7)
    hzmix = _n(nt, 'ShaderNodeMixRGB', 420, 160, blend_type='MIX')
    nt.links.new(hzp.outputs[0], hzmix.inputs['Fac'])
    nt.links.new(sky.outputs['Color'], hzmix.inputs['Color1'])
    _set(hzmix, 'Color2', spec["haze_color"] + (1.0,))

    col = hzmix.outputs['Color']
    col = _cloud_layer(nt, 700, 700, gen, sep, spec["cirrus"], col)
    col = _cloud_layer(nt, 700, -700, gen, sep, spec["clouds"], col)
    nt.links.new(col, bg.inputs['Color'])
    _stamp(w, spec)
    return w


def _stamp(w, spec):
    """Park the web-side rig numbers on the World datablock itself, so the
    whole atmosphere of a zone is editable in one place in Blender."""
    for k in ("key", "label", "exposure", "fog_density", "hemi",
              "sun_energy", "sky_brightness"):
        w[k] = spec[k]
    w["sun_elevation_deg"] = SUN_ELEVATION
    w["sun_rotation_deg"] = SUN_ROTATION


# ------------------------------------------------------------------- lights --
# (name, energy, colour, radius, web_intensity, web_distance, web_decay)
# web_* travel in the glTF extras; fx.js applies them verbatim instead of
# guessing a single number for every point light in the scene.
LIGHT_TUNING = {
    "SUN_Key":                     dict(energy=3.1, color=(1.0, 0.955, 0.90), angle=1.6),
    # Daylight lamps on an open plaza: present, but they must not out-shine the
    # sun. See the note on NEW_FILLS about the indoor/outdoor balance.
    "WP1_Atrium_Station_Light_0":  dict(energy=180.0, color=(0.86, 0.91, 1.0), radius=0.35,
                                        web=(10.0, 22.0, 1.6)),
    "WP1_Atrium_Station_Light_1":  dict(energy=180.0, color=(0.86, 0.91, 1.0), radius=0.35,
                                        web=(10.0, 22.0, 1.6)),
    "WP1_Atrium_Station_Light_2":  dict(energy=180.0, color=(0.86, 0.91, 1.0), radius=0.35,
                                        web=(10.0, 22.0, 1.6)),
    "WP1_Atrium_Station_Light_3":  dict(energy=180.0, color=(0.86, 0.91, 1.0), radius=0.35,
                                        web=(10.0, 22.0, 1.6)),
    "WP3_Lamp_Light0":             dict(energy=110.0, color=(1.0, 0.70, 0.38), radius=0.18,
                                        web=(11.0, 13.0, 1.8)),
    "WP3_Lamp_Light1":             dict(energy=110.0, color=(1.0, 0.70, 0.38), radius=0.18,
                                        web=(11.0, 13.0, 1.8)),
    "WP4_Lamp_Light0":             dict(energy=340.0, color=(0.80, 0.88, 1.0), radius=0.30,
                                        web=(20.0, 20.0, 1.7)),
    "WP4_Lamp_Light1":             dict(energy=340.0, color=(0.80, 0.88, 1.0), radius=0.30,
                                        web=(20.0, 20.0, 1.7)),
    "WP4_Lamp_Light2":             dict(energy=340.0, color=(0.80, 0.88, 1.0), radius=0.30,
                                        web=(20.0, 20.0, 1.7)),
    "DT1_Car1_HeadlightSpot":      dict(energy=1400.0, color=(1.0, 0.94, 0.84),
                                        web=(70.0, 60.0, 1.4)),
    "DT1_Plaza_Car1_HeadlightSpot": dict(energy=1400.0, color=(1.0, 0.94, 0.84),
                                         web=(70.0, 60.0, 1.4)),
}

# Fills that did not exist before. Point lights only — they export as
# KHR_lights_punctual and read identically in EEVEE and three.js.
#   name, collection, location, energy, colour, radius, web(intensity, dist, decay)
NEW_FILLS = [
    # Atrium (hall is x +-10, y +-15, ceiling 11.8): the nave was a grey box, so
    # it gets two cool skylight washes under the coffers plus warm bounces off
    # the side walls.
    #
    # Keep these *below* the daylight outside. A roofed hall lit brighter than
    # the sunlit plaza reads as wrong immediately, and point lights cast no
    # shadows, so anything strong in here also leaks straight through the walls
    # and washes the facade. Measured budget (irradiance at the surface, atrium
    # zone): sunlit facade ~2.6, plaza floor ~1.6, shaded exterior wall ~0.3 —
    # the interior belongs near the bottom of that range, not above it.
    ("WP1_Fill_Nave_N", "WP1_Atrium", (0.0, -6.0, 9.0), 200.0, (0.80, 0.87, 1.0), 2.4,
     (8.0, 26.0, 1.5)),
    ("WP1_Fill_Nave_S", "WP1_Atrium", (0.0, 8.0, 9.0), 200.0, (0.80, 0.87, 1.0), 2.4,
     (8.0, 26.0, 1.5)),
    ("WP1_Fill_Bounce_W", "WP1_Atrium", (-7.0, 1.0, 2.4), 80.0, (1.0, 0.88, 0.72), 2.0,
     (3.5, 15.0, 1.8)),
    ("WP1_Fill_Bounce_E", "WP1_Atrium", (7.0, 1.0, 2.4), 80.0, (1.0, 0.88, 0.72), 2.0,
     (3.5, 15.0, 1.8)),
    # the gate the statues flank — reads as backlight when you look out. Short
    # range on purpose: at 20 m it reached out past the facade and lit it.
    ("WP1_Fill_Gate", "WP1_Atrium", (0.0, 15.6, 6.4), 150.0, (0.92, 0.94, 1.0), 2.0,
     (6.0, 13.0, 1.6)),
    # garden: warm kicker up the column shaft, cool fill over the lake so the
    # boat stop is modelled instead of flat ambient
    ("WP2_Fill_Column", "WP2_Garden", (5.5, -54.0, 4.0), 300.0, (1.0, 0.90, 0.72), 2.6,
     (11.0, 24.0, 1.6)),
    ("WP2_Fill_Lake", "WP2_Garden", (-8.0, -58.0, 6.0), 240.0, (0.78, 0.92, 0.95), 3.0,
     (9.0, 26.0, 1.6)),
    # saloon interior (bar top -8.82, lamps -7.58): key on the book, warm
    # bounce into the back bar, cool daylight spill from the batwing doors
    ("WP3_Fill_Book", "WP3_Desert", (-1.2, -130.2, -7.3), 90.0, (1.0, 0.86, 0.64), 0.9,
     (7.5, 8.0, 1.9)),
    ("WP3_Fill_BackBar", "WP3_Desert", (0.0, -131.6, -8.2), 70.0, (1.0, 0.74, 0.46), 1.2,
     (5.5, 9.0, 1.9)),
    # the rail walks straight through the batwing doors, so this one sits well
    # off to the side of the opening rather than in it
    ("WP3_Fill_Door", "WP3_Desert", (3.3, -126.3, -7.4), 120.0, (0.96, 0.86, 0.74), 1.4,
     (8.0, 11.0, 1.8)),
    # cavern (floor -30, platform -29): a cold bounce off the vault and a rim
    # from the far side of the track
    ("WP4_Fill_Vault", "WP4_Metro", (0.0, -206.0, -14.0), 600.0, (0.62, 0.74, 0.95), 4.0,
     (26.0, 40.0, 1.5)),
    ("WP4_Fill_Rim", "WP4_Metro", (-5.0, -210.0, -25.5), 240.0, (0.86, 0.90, 1.0), 2.2,
     (13.0, 24.0, 1.7)),
]


def aim_sun_key():
    """Point the scene's own sun lamp along the atrium sky's sun so EEVEE
    previews and the browser agree about where the light comes from. (The
    exported directional light is switched off in fx.js — the web sun is
    keyed per zone from sky_rig.json — but the previews are how the .blend
    gets judged in Blender, and they must not lie.)"""
    from mathutils import Vector
    obj = bpy.data.objects.get("SUN_Key")
    if obj is None:
        return
    v = Vector(sun_vector())
    # a sun lamp shines along its local -Z, so aim local +Z at the sun
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = v.to_track_quat('Z', 'Y')
    print(f"[sky] SUN_Key aimed at {tuple(round(c, 3) for c in v)}")


def tune_lights():
    touched = []
    for obj in bpy.data.objects:
        if obj.type != 'LIGHT':
            continue
        t = LIGHT_TUNING.get(obj.name)
        if not t:
            continue
        d = obj.data
        d.energy = t["energy"]
        d.color = t["color"]
        if "angle" in t and hasattr(d, "angle"):
            d.angle = math.radians(t["angle"])
        if "radius" in t and hasattr(d, "shadow_soft_size"):
            d.shadow_soft_size = t["radius"]
        if "web" in t:
            obj["web_intensity"], obj["web_distance"], obj["web_decay"] = t["web"]
        touched.append(obj.name)
    return touched


def add_fills():
    made = []
    for name, coll_name, loc, energy, color, radius, web in NEW_FILLS:
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            print(f"[sky] !! collection {coll_name} missing, skipping {name}")
            continue
        obj = bpy.data.objects.get(name)
        if obj is None:
            data = bpy.data.lights.new(name, type='POINT')
            obj = bpy.data.objects.new(name, data)
            coll.objects.link(obj)
            made.append(name)
        d = obj.data
        d.type = 'POINT'
        d.energy = energy
        d.color = color
        d.shadow_soft_size = radius
        if hasattr(d, "use_shadow"):
            d.use_shadow = False          # fills must not carve extra shadows
        obj.location = loc
        obj["web_intensity"], obj["web_distance"], obj["web_decay"] = web
        obj["fill_light"] = 1
    return made


def assert_clear_of_rail(names, min_dist=1.4):
    """Lights are invisible, but a lamp sitting inside the camera makes a
    blown-out frame — keep them off the rail like every other prop."""
    path = os.path.join(OUT, "cam_path.json")
    if not os.path.exists(path):
        print("[sky] no cam_path.json — skipping rail check")
        return
    with open(path, "r", encoding="utf-8") as fh:
        samples = [s["p"] for s in json.load(fh)["samples"]]
    # a just-created object still has an identity matrix_world until the
    # depsgraph catches up, which silently turns this check into a no-op
    bpy.context.view_layer.update()
    bad = []
    for name in names:
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        p = obj.matrix_world.translation
        d = min(math.dist(p, s) for s in samples)
        if d < min_dist:
            bad.append((name, round(d, 2)))
    if bad:
        raise SystemExit(f"[sky] lights too close to the camera rail: {bad}")
    print(f"[sky] rail clearance ok for {len(names)} lights")


# -------------------------------------------------------------- sky baking --
def sun_vector():
    """Blender-space unit vector towards the world's one sun.

    Measured, not assumed: `sun_rotation` on the Sky Texture is an azimuth
    from **+Y towards +X** (rot 0 = +Y, rot 90 = +X), and the node's own
    `sun_direction` property never updates, so it cannot be read back. Verified
    by locating the rendered sun disc for known angles."""
    el = math.radians(SUN_ELEVATION)
    rot = math.radians(SUN_ROTATION)
    return (math.cos(el) * math.sin(rot),
            math.cos(el) * math.cos(rot),
            math.sin(el))


def _aim_equirect_cam(cam):
    """three.js `equirectUv()` reads u = atan2(z, x)/2pi + 0.5, i.e. the image
    centre is +X(three) and u grows towards +Z(three) = -Y(blender).

    Measured for this camera pose: u=0.00 -> -X, 0.25 -> +Y, 0.50 -> +X,
    0.75 -> -Y, and image row 0 is the nadir — exactly three's convention.
    Get this wrong and the painted sun sits 90 deg away from the key light."""
    cam.rotation_euler = (math.radians(90.0), 0.0, math.radians(-90.0))
    cam.location = (0.0, 0.0, 0.0)


def get_bake_scene():
    scn = bpy.data.scenes.get("SKY_Bake")
    if scn is None:
        scn = bpy.data.scenes.new("SKY_Bake")
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 24
    scn.cycles.use_denoising = False
    scn.cycles.max_bounces = 0
    scn.render.resolution_x = PANO_W
    scn.render.resolution_y = PANO_H
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'JPEG'
    scn.render.image_settings.quality = 92
    scn.render.film_transparent = False
    # Standard, not AgX: AgX desaturates exactly the bright saturated tones a
    # sky is made of, and the low-poly world wants a graphic, saturated dome.
    # The sun disc is meant to clip to white — that is what reads as a sun.
    scn.view_settings.view_transform = 'Standard'
    scn.view_settings.look = 'None'
    scn.view_settings.gamma = 1.0

    cam = bpy.data.objects.get("SKY_Bake_Cam")
    if cam is None:
        data = bpy.data.cameras.new("SKY_Bake_Cam")
        cam = bpy.data.objects.new("SKY_Bake_Cam", data)
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    cam.data.type = 'PANO'
    # 4.x renamed the panorama enum; 5.x keeps both spellings around
    for attr, val in (("panorama_type", 'EQUIRECTANGULAR'),):
        if hasattr(cam.data, attr):
            setattr(cam.data, attr, val)
        elif hasattr(cam.data, "cycles"):
            cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
    _aim_equirect_cam(cam)
    scn.camera = cam
    return scn


def render_skies():
    import numpy as np

    os.makedirs(SKY_DIR, exist_ok=True)
    scn = get_bake_scene()
    rig = {"zones": [], "pano": [PANO_W, PANO_H]}

    for spec in ZONES:
        w = bpy.data.worlds.get(spec["world"])
        if w is None:
            raise SystemExit(f"[sky] world {spec['world']} missing — run --build first")
        scn.world = w
        scn.view_settings.exposure = auto_exposure(scn, spec)
        path = os.path.join(SKY_DIR, f"sky_{spec['key']}.jpg")
        scn.render.filepath = path
        # `bpy.ops.render.render()` renders bpy.context.scene, which in -b is
        # still the main world — name the bake scene explicitly
        bpy.ops.render.render(write_still=True, scene=scn.name)
        size = os.path.getsize(path) / 1024.0
        print(f"[sky] {os.path.basename(path)}  {size:.0f} kB")

        # sample the panorama back for the light rig, so fog / hemisphere /
        # sun tint can never drift away from the painted sky
        img = bpy.data.images.load(path, check_existing=False)
        img.colorspace_settings.name = 'Non-Color'   # keep sRGB-encoded values
        buf = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(buf)
        px = buf.reshape(img.size[1], img.size[0], 4)[:, :, :3]
        bpy.data.images.remove(img)
        rows = px.shape[0]
        # Row 0 is the bottom of the image (nadir), row -1 the zenith. The
        # horizon band is sampled strictly *above* row 0.5: straddling the line
        # averages in the panorama's dark ground slab and the fog comes out a
        # muddy grey instead of the colour the distance actually is.
        ground = px[:int(rows * 0.42)].mean(axis=(0, 1))
        horizon = px[int(rows * 0.505):int(rows * 0.565)].mean(axis=(0, 1))
        zenith = px[int(rows * 0.80):].mean(axis=(0, 1))
        upper = px[int(rows * 0.56):].mean(axis=(0, 1))

        # The key light is tinted explicitly, not sampled: the sky *around* a
        # high sun is blue, so sampling there paints the whole world blue.
        # `sun_color` in the zone spec is the sunlight itself.
        #
        # The hemisphere is sampled, but hue only — a three.js HemisphereLight
        # reads its two colours as irradiance, so the sky colour has to stay
        # near white (or every up-facing surface turns blue) and the ground
        # colour has to stay genuinely dark (or every down-facing surface —
        # the atrium ceiling above all — lights up like a lamp).
        rig["zones"].append(dict(
            key=spec["key"],
            label=spec["label"],
            texture=f"./assets/world/sky/sky_{spec['key']}.jpg",
            sun_color=spec["sun_color"],
            sun_intensity=round(spec["sun_energy"], 3),
            hemi_sky=_hex(_normalize_tint(upper, 0.42)),
            hemi_ground=_hex(_normalize_tint(ground, 0.30, level=0.40)),
            hemi_intensity=round(spec["hemi"], 3),
            # the bounce light that stands in for the GI the runtime has not
            # got: aimed back from the sun's far side, tinted by the ground
            fill_color=_hex(_normalize_tint(ground, 0.55)),
            fill_intensity=round(spec["fill_energy"], 3),
            fog_color=_hex(horizon),
            fog_density=spec["fog_density"],
            bg_color=_hex(horizon),
            zenith_color=_hex(zenith),
            exposure=round(spec["exposure"], 3),
            sky_brightness=round(spec["sky_brightness"], 3),
        ))

    bx, by, bz = sun_vector()
    rig["sun"] = {
        # Blender Z-up -> three.js Y-up, same swizzle the glTF exporter uses
        "dir": [round(bx, 5), round(bz, 5), round(-by, 5)],
        "elevation_deg": SUN_ELEVATION,
        "rotation_deg": SUN_ROTATION,
    }
    rig["shadow_box"] = outdoor_shadow_box()

    with open(RIG_JSON, "w", encoding="utf-8") as fh:
        json.dump(rig, fh, indent=2)
    print(f"[sky] wrote {RIG_JSON}")
    for z in rig["zones"]:
        print(f"       {z['key']}: sun {z['sun_dir']} {z['sun_color']} "
              f"fog {z['fog_color']} hemi {z['hemi_sky']}/{z['hemi_ground']}")


def auto_exposure(scn, spec):
    """A physical sky node graph outputs radiance, not pixels — an eyeballed
    exposure is off by stops. Render a tiny linear EXR probe instead and solve
    for the stop that lands the 98th percentile of the *sky half* on the zone's
    `auto_target`. The sun disc is far too small to reach that percentile, so
    it keeps clipping to white the way a sun should."""
    import numpy as np

    keep = (scn.render.resolution_x, scn.render.resolution_y,
            scn.render.image_settings.file_format, scn.cycles.samples,
            scn.view_settings.exposure)
    scn.render.resolution_x, scn.render.resolution_y = 512, 256
    scn.render.image_settings.file_format = 'OPEN_EXR'
    scn.render.image_settings.color_depth = '16'
    scn.cycles.samples = 4
    scn.view_settings.exposure = 0.0
    probe = os.path.join(OUT, "sky_probe", f"probe_{spec['key']}.exr")
    os.makedirs(os.path.dirname(probe), exist_ok=True)
    scn.render.filepath = probe
    bpy.ops.render.render(write_still=True, scene=scn.name)

    img = bpy.data.images.load(probe, check_existing=False)
    buf = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(buf)
    px = buf.reshape(img.size[1], img.size[0], 4)[:, :, :3]
    bpy.data.images.remove(img)
    sky = px[px.shape[0] // 2:]                      # rows above the horizon
    lum = sky[:, :, 0] * 0.2126 + sky[:, :, 1] * 0.7152 + sky[:, :, 2] * 0.0722
    p98 = float(np.percentile(lum, 98.0))
    ev = math.log2(max(spec["auto_target"], 1e-4) / max(p98, 1e-6)) + spec["exposure_bias"]

    (scn.render.resolution_x, scn.render.resolution_y,
     scn.render.image_settings.file_format, scn.cycles.samples,
     scn.view_settings.exposure) = keep
    print(f"[sky] {spec['key']}: sky p98 = {p98:.4f} -> exposure {ev:+.2f} EV")
    return ev


def outdoor_shadow_box():
    """World-space box the single static shadow map has to cover, in three.js
    coordinates.

    Measured from the daylit collections so the map keeps covering the world
    after it is edited — add a butte in Blender and the box grows with it.
    WP4 is excluded: it is underground and gets no sun. The Z extent is
    clamped because a couple of stray meshes hang hundreds of metres below the
    garden, and letting them into the box would throw away most of the shadow
    camera's depth range on empty space."""
    from mathutils import Vector
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for coll_name in ("WP1_Atrium", "WP2_Garden", "WP3_Desert"):
        coll = bpy.data.collections.get(coll_name)
        if not coll:
            continue
        for o in coll.all_objects:
            if o.type != 'MESH' or not o.visible_get():
                continue
            for corner in o.bound_box:
                v = o.matrix_world @ Vector(corner)
                for i in range(3):
                    lo[i] = min(lo[i], v[i])
                    hi[i] = max(hi[i], v[i])
    lo[2] = max(lo[2], -45.0)
    hi[2] = min(hi[2], 70.0)
    # Blender (x, y, z) -> three.js (x, z, -y)
    tlo = [lo[0], lo[2], -hi[1]]
    thi = [hi[0], hi[2], -lo[1]]
    box = {
        "min": [round(v, 2) for v in tlo],
        "max": [round(v, 2) for v in thi],
    }
    print(f"[sky] shadow box (three.js): {box['min']} .. {box['max']}")
    return box


def _normalize_tint(rgb, desat=0.8, level=1.0):
    """Take the hue of a sampled patch and nothing else.

    Normalise to full brightness (a light's colour should tint, not dim), pull
    `desat` of the way back towards white so a saturated sunset sky does not
    paint the world orange, then scale to `level` — which is how a hemisphere
    *ground* colour stays a dim bounce instead of a second sun."""
    chans = [float(rgb[0]), float(rgb[1]), float(rgb[2])]
    k = 1.0 / max(max(chans), 1e-4)
    return [min(1.0, (c * k * desat + (1.0 - desat)) * level) for c in chans]


def _hex(rgb):
    r, g, b = (max(0.0, min(1.0, float(c))) for c in rgb[:3])
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


# --------------------------------------------------------------------- main --
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    flags = [a for a in argv if a.startswith("--")]
    save = "--no-save" not in flags
    modes = [f for f in flags if f in ("--build", "--render")]
    do_build = "--build" in flags or not modes
    do_render = "--render" in flags or not modes

    if do_build:
        for spec in ZONES:
            build_sky_world(spec)
            print(f"[sky] world {spec['world']} rebuilt")
        # the main scene previews under the atrium sky
        main_scene = bpy.data.scenes.get("Scene")
        if main_scene:
            main_scene.world = bpy.data.worlds[ZONES[0]["world"]]
        aim_sun_key()
        touched = tune_lights()
        made = add_fills()
        print(f"[sky] retuned {len(touched)} lights, added {len(made)} fills: {made}")
        assert_clear_of_rail([n[0] for n in NEW_FILLS])
        get_bake_scene()
        if save:
            bpy.ops.wm.save_as_mainfile(filepath=BLEND)
            print(f"[sky] saved {BLEND}")
        else:
            print("[sky] --no-save: .blend left untouched")

    if do_render:
        render_skies()


main()
