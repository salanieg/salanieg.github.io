// ============================================================================
// fx.js — shader swaps for `shader:` tagged planes + zone ambience.
//
// The GLB ships plain PBR placeholders; anything with userData.shader gets a
// living material here. Ambience (fog / background / exposure / light mix)
// is keyed along the path parameter u so the four waypoints feel like four
// different worlds while remaining one continuous scene.
// ============================================================================
import * as THREE from 'three';

// ---------------------------------------------------------------- materials --
function waterMaterial(deep, shallow, opacity) {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0 },
            uDeep: { value: new THREE.Color(deep) },
            uShallow: { value: new THREE.Color(shallow) },
            uOpacity: { value: opacity },
        },
        vertexShader: /* glsl */`
            uniform float uTime;
            varying vec3 vWorld;
            varying vec3 vNormalW;
            void main() {
                vec3 p = position;
                vec4 w = modelMatrix * vec4(p, 1.0);
                p.z += sin(w.x * 1.9 + uTime * 1.15) * 0.022
                     + cos(w.z * 1.5 - uTime * 0.9) * 0.02;
                w = modelMatrix * vec4(p, 1.0);
                vWorld = w.xyz;
                vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
                gl_Position = projectionMatrix * viewMatrix * w;
            }`,
        fragmentShader: /* glsl */`
            uniform float uTime;
            uniform vec3 uDeep;
            uniform vec3 uShallow;
            uniform float uOpacity;
            varying vec3 vWorld;
            varying vec3 vNormalW;
            void main() {
                vec3 V = normalize(cameraPosition - vWorld);
                float fres = pow(1.0 - abs(dot(V, vNormalW)), 2.4);
                float rip = sin(vWorld.x * 1.3 + uTime * 0.7)
                          * sin(vWorld.z * 1.1 - uTime * 0.55) * 0.5 + 0.5;
                vec3 col = mix(uDeep, uShallow, fres * 0.7 + rip * 0.18);
                gl_FragColor = vec4(col, uOpacity + fres * 0.18);
            }`,
    });
}

function waterfallMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */`
            uniform float uTime;
            varying vec2 vUv;
            varying vec3 vWorldPos;
            varying vec3 vNormalW;
            void main() {
                vUv = uv;
                vec3 p = position;

                // Edge mask to keep outer sides anchored to rock cliffs
                float edgeMask = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);

                // Physical 3D organic wave displacement for cascading volume
                float wave1 = sin(vUv.y * 16.0 - uTime * 5.0) * cos(vUv.x * 8.0 + uTime * 2.0);
                p.z += wave1 * 0.08 * edgeMask;
                p.x += sin(vUv.y * 24.0 + uTime * 4.0) * 0.03 * (1.0 - edgeMask * 0.5);

                vec4 w = modelMatrix * vec4(p, 1.0);
                vWorldPos = w.xyz;
                vNormalW = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * w;
            }`,
        fragmentShader: /* glsl */`
            uniform float uTime;
            varying vec2 vUv;
            varying vec3 vWorldPos;
            varying vec3 vNormalW;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }
            float noise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
            }

            void main() {
                // Downward cascading water streaks (vUv.y: 0 = top lip, 1 = bottom plunge)
                float s1 = noise(vec2(vUv.x * 18.0 + sin(vUv.y * 6.0) * 0.15, vUv.y * 5.0 + uTime * 3.2));
                float s2 = noise(vec2(vUv.x * 36.0, vUv.y * 12.0 + uTime * 5.5));
                float s3 = noise(vec2(vUv.x * 72.0 - uTime * 0.5, vUv.y * 24.0 + uTime * 8.5));

                float streamFlow = s1 * 0.50 + s2 * 0.35 + s3 * 0.15;

                // Soft alpha blending at rock edges
                float edgeAlpha = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);

                // Whitewater crest at top lip and boiling plunge foam at bottom
                float topLipFoam = smoothstep(0.15, 0.0, vUv.y) * 0.70;
                float plungeFoam = smoothstep(0.70, 1.0, vUv.y) * 0.85;

                // Foam density (fine highlights along flow streaks, not solid block)
                float foamVal = clamp(pow(streamFlow, 1.8) * 1.1 + topLipFoam + plungeFoam, 0.0, 1.0);

                // Water colors: Azure Teal Core -> Cyan Highlights -> Whitewater Foam
                vec3 deepTeal = vec3(0.06, 0.30, 0.36);    // Deep mountain stream
                vec3 crystalCyan = vec3(0.24, 0.70, 0.75); // Translucent cyan stream
                vec3 whitewater = vec3(0.95, 0.98, 1.0);   // Foam highlights

                // Fresnel & Specular Lighting
                vec3 V = normalize(cameraPosition - vWorldPos);
                vec3 N = normalize(vNormalW);
                vec3 L = normalize(vec3(0.35, 0.75, -0.55));
                vec3 H = normalize(L + V);
                float spec = pow(max(dot(N, H), 0.0), 32.0) * 0.35;
                float fresnel = pow(1.0 - max(dot(V, N), 0.0), 2.2);

                vec3 waterCol = mix(deepTeal, crystalCyan, fresnel * 0.5 + streamFlow * 0.4);
                vec3 finalCol = mix(waterCol, whitewater, foamVal * 0.65) + vec3(spec);

                // Clear translucent water body with bright foam highlights
                float alpha = (0.35 + foamVal * 0.40 + fresnel * 0.18) * edgeAlpha;
                gl_FragColor = vec4(finalCol, clamp(alpha, 0.0, 0.88));
            }`,
    });
}

function foamMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform float uTime;
            varying vec2 vUv;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
            }
            void main() {
                vec2 c = (vUv - 0.5) * 2.0;
                float r = length(c);
                float angle = atan(c.y, c.x);

                // Concentric churn rings expanding from impact point
                float rings = sin(r * 18.0 - uTime * 4.5) * 0.5 + 0.5;
                float churn = noise(vec2(c.x * 12.0 + uTime * 1.8, c.y * 12.0 - uTime * 1.5));
                float foamCells = noise(vec2(r * 16.0 - uTime * 2.2, angle * 8.0));

                float mask = (1.0 - smoothstep(0.4, 0.95, r));
                float alpha = (0.35 + 0.35 * rings + 0.30 * churn * foamCells) * mask;

                vec3 col = mix(vec3(0.75, 0.90, 0.96), vec3(1.0), alpha);
                gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.88));
            }`,
    });
}

function mistMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            uniform float uTime;
            void main() {
                vUv = uv;
                vec3 p = position;
                // Soft upward billowing expansion
                p.y += sin(uTime * 0.9 + p.x * 2.0) * 0.12;
                p.x += cos(uTime * 0.7 + p.y * 2.0) * 0.10;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform float uTime;
            varying vec2 vUv;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
            }
            void main() {
                vec2 c = (vUv - 0.5) * 2.0;
                float r = length(c);
                float billow = noise(vec2(vUv.x * 6.0 + uTime * 0.8, vUv.y * 6.0 - uTime * 0.6));
                float alpha = 0.32 * (1.0 - smoothstep(0.2, 0.95, r)) * (0.6 + 0.4 * billow);
                gl_FragColor = vec4(vec3(0.88, 0.94, 0.98), clamp(alpha, 0.0, 0.40));
            }`,
    });
}

// -------------------------------------------------------------------- sky --
// A two-texture cross-fading sky dome. `scene.background` can only ever hold
// one texture, so blending two skies means drawing them ourselves: an inverted
// sphere with depth test off, drawn first, with the view matrix' translation
// stripped so it is infinitely far away and can never intersect the rail.
// Both panoramas come out of Blender already tone-mapped (see
// blender/sky_and_light.py), so the dome is deliberately NOT tone-mapped
// again — it is displayed exactly as authored, scaled by the zone exposure.
function skyDome() {
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
        uniforms: {
            uTexA: { value: null },
            uTexB: { value: null },
            uMix: { value: 0 },
            uExposure: { value: 1 },
            uFogColor: { value: new THREE.Color(0xaec6dd) },
            uFogBlend: { value: 0.6 },
        },
        vertexShader: /* glsl */`
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                // rotation only — the dome follows the camera for free
                mat4 v = viewMatrix;
                v[3].xyz = vec3(0.0);
                vec4 p = projectionMatrix * v * vec4(position, 1.0);
                gl_Position = p.xyww;      // pin to the far plane
            }`,
        fragmentShader: /* glsl */`
            uniform sampler2D uTexA;
            uniform sampler2D uTexB;
            uniform float uMix;
            uniform float uExposure;
            uniform vec3 uFogColor;
            uniform float uFogBlend;
            varying vec3 vDir;
            void main() {
                vec3 d = normalize(vDir);
                // three.js' own equirect convention (see equirectUv())
                vec2 uv = vec2(atan(d.z, d.x) * 0.1591549 + 0.5,
                               asin(clamp(d.y, -1.0, 1.0)) * 0.3183099 + 0.5);
                vec3 col = mix(texture2D(uTexA, uv).rgb,
                               texture2D(uTexB, uv).rgb, uMix);
                // Dissolve into the scene fog at the horizon so distant
                // terrain and sky meet in the same colour, and go to fog
                // outright below it — the panorama's ground half is a flat
                // slab that must never show through a gap in the terrain.
                float haze = smoothstep(0.20, 0.00, d.y) * uFogBlend;
                float below = smoothstep(0.02, -0.10, d.y);
                col = mix(col, uFogColor, max(haze, below));
                gl_FragColor = vec4(col * uExposure, 1.0);
            }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.raycast = () => {};
    mesh.name = 'FX_SkyDome';
    return mesh;
}

// Fit a directional light's ortho shadow camera tightly around a world-space
// box. A bounding-sphere fit would be simpler but wastes most of the map here:
// the world is 142 m wide and 216 m long, so the sphere is ~40 % larger than
// the box actually needs in the short axis.
function fitShadowToBox(light, box) {
    // A plain Object3D's lookAt() aims its +Z at the target, a camera's or a
    // light's aims -Z. The probe must therefore be a Camera, or the whole box
    // lands behind the frustum and near/far come out negative.
    const probe = new THREE.Camera();
    probe.position.copy(light.position);
    probe.lookAt(light.target.position);
    probe.updateMatrixWorld();
    const toLight = new THREE.Matrix4().copy(probe.matrixWorld).invert();
    const v = new THREE.Vector3();
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z).applyMatrix4(toLight);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    const cam = light.shadow.camera;
    cam.left = minX; cam.right = maxX;
    cam.bottom = minY; cam.top = maxY;
    // the camera looks down -Z, so the box sits at negative z
    cam.near = Math.max(0.5, -maxZ - 5);
    cam.far = -minZ + 5;
    cam.updateProjectionMatrix();
}

function skyTexture(image) {
    const t = new THREE.Texture(image);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    // no mipmaps: the dome is displayed at roughly 1:1 and mip selection
    // across the u = 0/1 wrap draws a hard seam down the sky
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
}

// ---------------------------------------------------------------- ambience --
// Keyed by path u (see PIPELINE.md §2 for anchor values); each key names one
// of the four Blender zones in sky_rig.json, and every value (sky texture, sun
// direction and tint, hemisphere, fog, exposure) is interpolated between the
// two zones bracketing the current u. Placing the keys so that neighbouring
// zones differ only across a stretch the geometry hides — the arch, the
// canyon, the mine mouth — is what makes the change of world read as a
// dissolve rather than a cut.
//
// The list MUST be ascending in u: applyAmbience picks the bracket
// pts[i].u <= u <= pts[i+1].u, so an out-of-order entry silently swallows a
// whole stretch of the ride (that is how the plaza ended up lit like the
// cavern). Anchor-relative wherever possible so re-baking the rail can shift
// the waypoints without stranding these values again.
function ambiencePoints(a, rig) {
    const P = (u, zone, over) => ({ u, zone, over: over || null });
    // the teleport lands the visitor back outdoors: dark on the last sample of
    // the mine car, full daylight on the first sample of the plaza car
    const uIn = rig && rig.uIn > 0 ? rig.uIn : a.contact_inside;
    const uOut = rig && rig.uOut > 0 ? rig.uOut : a.contact_inside + 0.0015;
    const pts = [
        P(0.000, 'wp1'),                          // atrium plaza
        P(a.home, 'wp1'),                         // under the arch
        P(a.projects - 0.02, 'wp2'),              // …dissolves through the gate
        P(a.projects_boat + 0.04, 'wp2'),
        P(0.450, 'wp2'),                          // canyon / falls
        P(0.550, 'wp3'),                          // …dissolves along the canyon
        P(a.about, 'wp3'),                        // saloon
        P(0.660, 'wp3'),                          // back of the bowl
        P(0.700, 'wp4', { dens: 0.0200 }),        // mine portal — hard and fast
        P(0.760, 'wp4', { dens: 0.0140 }),        // lantern shaft
        P(0.820, 'wp4', { dens: 0.0140 }),        // cavern reveal
        P(a.contact, 'wp4'),
        P(uIn, 'wp4'),                            // in the mine car
        P(uOut, 'wp1'),                           // …and out at the terminus
        P(1.000, 'wp1'),
    ];
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].u < pts[i - 1].u) {
            console.warn('[fx] ambience points out of order at', i,
                         pts[i - 1].u, '>', pts[i].u);
        }
    }
    return pts;
}

// ------------------------------------------------------------- quality --
// Decided once, before the first frame, and never changed again. That is not
// laziness: three.js bakes the shadow-map type, the shadow flag and the light
// *counts* into every material's shader program, so flipping any of them at
// runtime recompiles the whole scene. Doing that mid-ride cost a 1.1 s freeze
// at the mine portal — which is exactly the bug this replaced.
// `?quality=low` forces the cheap tier on any machine — handy for checking how
// the world holds up before shipping, and as an escape hatch for a visitor on
// hardware the sniff below guesses wrong about.
const TIERS = {
    // Pool sizes come from measurement, and the high one is deliberately above
    // the maximum: sweeping the whole ride, at most 9 lamps are ever in reach
    // at once (in the atrium). At 10 the pool can never overflow, which means
    // no lamp is ever dropped while it still contributes and every lamp keeps
    // exactly the intensity it was given in Blender.
    high: { name: 'high', shadowSize: 4096, lamps: 10, pixelRatio: 2,
            shadowType: THREE.PCFSoftShadowMap },
    // 2048, not 1024, even on the cheap tier: the map is rendered once, so its
    // size costs a one-off pass and some VRAM but nothing per frame — and at
    // 1024 the 174 m box gives 17 cm texels, which reads as smeared blobs
    // 6 rather than 5: only 7 lamps ever exceed a score of 0.03, so at 6 the
    // ones the pool has to drop are always the near-invisible tail
    low: { name: 'low', shadowSize: 2048, lamps: 6, pixelRatio: 1.25,
           shadowType: THREE.PCFShadowMap },
};

function pickQuality() {
    const forced = new URLSearchParams(location.search).get('quality');
    if (TIERS[forced]) return TIERS[forced];
    const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    return (mobile || cores <= 4 || mem <= 4) ? TIERS.low : TIERS.high;
}

// --------------------------------------------------------------- lamps --
// The GLB ships 23 punctual lights and interactions.js adds 4 more. three.js
// has no light culling: every one of them is evaluated in every fragment of
// every material, which is the single most expensive thing about this scene on
// a weak GPU. So the authored lamps are demoted to plain data behind an
// Object3D anchor (kept in the hierarchy, so lamps on the train or on a swaying
// lantern still move), and a small fixed-size pool of real lights is retargeted
// to whichever ones actually reach the camera. The count never changes, so the
// shaders never recompile — and Blender is still the only place lighting is
// authored: add a lamp there and the pool picks it up.
// three.js' physically-correct point-light falloff, replicated so the pool
// ranks lamps by what actually arrives at the camera. Mirrors
// getDistanceAttenuation() in lights_pars_begin.glsl — including the window
// term that drives the contribution to exactly zero at `cutoff`, which is what
// makes swapping a lamp in or out of the pool invisible.
function attenuation(dist, cutoff, decay) {
    let f = 1 / Math.max(dist ** decay, 0.01);
    if (cutoff > 0) {
        const w = Math.max(0, Math.min(1, 1 - (dist / cutoff) ** 4));
        f *= w * w;
    }
    return f;
}

function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
    return t * t * (3 - 2 * t);
}

function harvestLamps(gltfScene) {
    const lamps = [];
    const found = [];
    gltfScene.traverse((o) => {
        if (o.isPointLight || o.isSpotLight) found.push(o);
    });
    for (const o of found) {
        const d = o.userData || {};
        const parent = o.parent;
        const anchor = new THREE.Object3D();
        anchor.name = o.name + '_Anchor';
        anchor.position.copy(o.position);
        anchor.quaternion.copy(o.quaternion);
        parent.add(anchor);

        // A spot's own `target` is a child of the light, so detaching the
        // light strands it outside the graph and its world matrix stops
        // updating. Re-express the aim as a second anchor under the same
        // parent: a glTF spot looks down its local -Z.
        let aim = null;
        if (o.isSpotLight) {
            aim = new THREE.Object3D();
            aim.name = o.name + '_Aim';
            aim.position.copy(o.position).add(
                new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion));
            parent.add(aim);
        }
        parent.remove(o);

        const loop = o.name.startsWith('WP4_Loop_Light');
        lamps.push({
            anchor,
            spot: !!o.isSpotLight,
            color: o.color.clone(),
            intensity: d.web_intensity ?? (o.isSpotLight ? 55 : loop ? 46 : 9),
            distance: d.web_distance ?? (o.isSpotLight ? 55 : loop ? 30 : 17),
            decay: d.web_decay ?? (o.isSpotLight ? 1.4 : loop ? 1.5 : 1.7),
            angle: o.isSpotLight ? Math.min(o.angle, 0.65) : 0,
            penumbra: o.penumbra || 0.4,
            target: aim,
        });
    }
    return lamps;
}

class LampPool {
    constructor(scene, lamps, count) {
        this.lamps = lamps;
        this.slots = [];
        this._p = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            const l = new THREE.PointLight(0xffffff, 0, 10, 1.7);
            l.name = `FX_LampSlot_${i}`;
            scene.add(l);
            this.slots.push(l);
        }
        // one spot is enough: the two DT1 headlights are never both in view
        this.spot = new THREE.SpotLight(0xffffff, 0, 55, 0.5, 0.4, 1.4);
        this.spot.name = 'FX_SpotSlot';
        scene.add(this.spot);
        scene.add(this.spot.target);
        this._ranked = [];
    }

    /** Add a lamp that is not in the GLB (the mine lanterns are built in JS).
     *  Same contract as a harvested one: an anchor in the scene graph, so it
     *  follows whatever it is parented to. */
    register(parent, localPos, { color, intensity, distance, decay }) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(localPos);
        parent.add(anchor);
        this.lamps.push({
            anchor, spot: false, color: new THREE.Color(color),
            intensity, distance, decay, angle: 0, penumbra: 0, target: null,
        });
        return anchor;
    }

    update(camPos) {
        const ranked = this._ranked;
        ranked.length = 0;
        let bestSpot = null;
        let bestSpotScore = 0;
        for (const lamp of this.lamps) {
            lamp.anchor.getWorldPosition(this._p);
            const dist = this._p.distanceTo(camPos);
            if (dist >= lamp.distance) continue;
            // Soften the last stretch before the cutoff radius. Measured, not
            // assumed: a lamp sitting at 25.8 m of its 26 m range still
            // accounts for ~11 % of the frame's brightness here, so crossing
            // `distance` is a hard on/off and pops. This ramp is deliberately
            // NOT a proximity falloff — it is flat 1.0 over the inner 78 % of
            // the range, so lamps keep exactly the intensity Blender gave
            // them and the room does not brighten in stages as you approach.
            const gate = smoothstep(1.0, 0.78, dist / lamp.distance);
            if (gate <= 0) continue;
            const score = lamp.intensity * attenuation(dist, lamp.distance, lamp.decay) * gate;
            if (lamp.spot) {
                if (score > bestSpotScore) {
                    bestSpotScore = score;
                    bestSpot = { lamp, gate, pos: this._p.clone() };
                }
            } else {
                ranked.push({ lamp, score, gate, x: this._p.x, y: this._p.y, z: this._p.z });
            }
        }
        ranked.sort((a, b) => b.score - a.score);

        // Lamps keep the intensity they were given in Blender. three.js' own
        // `distance` window already falls to exactly zero at that radius, so a
        // lamp entering or leaving the pool there contributes nothing and the
        // swap is invisible for free — dimming them a second time by proximity
        // is what used to light the temple up in visible stages.
        //
        // The one case that does need help is an over-subscribed pool, where a
        // lamp that still contributes gets pushed out. Then, and only then,
        // fade the ones near the cut so both sides of a swap are near zero.
        const overflow = ranked.length > this.slots.length;
        const cut = overflow ? ranked[this.slots.length].score : 0;
        for (let i = 0; i < this.slots.length; i++) {
            const s = this.slots[i];
            const r = ranked[i];
            if (!r) { s.intensity = 0; continue; }
            s.position.set(r.x, r.y, r.z);
            s.color.copy(r.lamp.color);
            s.distance = r.lamp.distance;
            s.decay = r.lamp.decay;
            s.intensity = r.lamp.intensity * r.gate
                * (overflow ? smoothstep(cut, cut * 3, r.score) : 1);
        }

        if (bestSpot) {
            const { lamp, gate, pos } = bestSpot;
            this.spot.position.copy(pos);
            this.spot.color.copy(lamp.color);
            this.spot.distance = lamp.distance;
            this.spot.decay = lamp.decay;
            this.spot.angle = lamp.angle;
            this.spot.penumbra = lamp.penumbra;
            this.spot.intensity = lamp.intensity * gate;
            if (lamp.target) {
                lamp.target.getWorldPosition(this.spot.target.position);
                this.spot.target.updateMatrixWorld();
            }
        } else {
            this.spot.intensity = 0;
        }
    }
}

// Fallback rig for a missing sky_rig.json: no panoramas, but the ride still
// lights itself and — the part that matters — still goes dark underground.
// Zones with no entry resolve to the first one via zoneOf().
const FALLBACK_RIG = {
    zones: [
        { key: 'wp1', sun_dir: [0.32, 0.62, -0.72], sun_color: '#fff2dd', sun_intensity: 1.4,
          hemi_sky: '#cfe4f5', hemi_ground: '#54626e', hemi_intensity: 0.6,
          fog_color: '#aec6dd', fog_density: 0.0042, bg_color: '#8fb4d9',
          fill_color: '#e8f0ff', fill_intensity: 0.32,
          exposure: 1.0, sky_brightness: 1.0 },
        { key: 'wp4', sun_dir: [-0.15, -0.24, -0.96], sun_color: '#8fa6c8', sun_intensity: 0.03,
          hemi_sky: '#d6e3ff', hemi_ground: '#665f5b', hemi_intensity: 0.14,
          fog_color: '#0e0f14', fog_density: 0.015, bg_color: '#0e0f14',
          fill_color: '#ffdecf', fill_intensity: 0.02,
          exposure: 1.1, sky_brightness: 1.0 },
    ],
};

export function setupFX(scene, renderer, gltfScene, anchors, rig, skyRig, skyImages) {
    const animated = [];
    const waters = {
        WP1_Pool_Water: [0x1d5560, 0x6fb5a8, 0.6],
        default: [0x1c5a58, 0x63ab97, 0.62],
    };
    gltfScene.traverse((o) => {
        const s = o.userData && o.userData.shader;
        if (!s) return;
        if (s === 'water') {
            const [d, sh, op] = waters[o.name] || waters.default;
            o.material = waterMaterial(d, sh, op);
        } else if (s === 'waterfall') {
            o.material = waterfallMaterial();
        } else if (s === 'foam') {
            o.material = foamMaterial();
        } else if (s === 'mist') {
            o.material = mistMaterial();
        }
        o.material.name = 'FX_' + s;
        animated.push(o.material);
    });

    const quality = pickQuality();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));

    // Blender's directional light is dropped — the web sun comes from the rig.
    gltfScene.traverse((o) => {
        if (o.isDirectionalLight) o.visible = false;
    });
    // …and every punctual lamp becomes data behind an anchor (see LampPool)
    const lampPool = new LampPool(scene, harvestLamps(gltfScene), quality.lamps);

    // ---- zone rig ---------------------------------------------------------
    const zones = {};
    for (const z of (skyRig && skyRig.zones ? skyRig.zones : FALLBACK_RIG.zones)) {
        zones[z.key] = {
            ...z,
            sunColor: new THREE.Color(z.sun_color),
            hemiSky: new THREE.Color(z.hemi_sky),
            hemiGround: new THREE.Color(z.hemi_ground),
            fogColor: new THREE.Color(z.fog_color),
            bgColor: new THREE.Color(z.bg_color),
            fillColor: new THREE.Color(z.fill_color || z.hemi_ground),
            fill_intensity: z.fill_intensity ?? 0.35,
            tex: skyImages && skyImages[z.key] ? skyTexture(skyImages[z.key]) : null,
        };
    }
    const zoneOf = (key) => zones[key] || zones[Object.keys(zones)[0]];

    const hemi = new THREE.HemisphereLight(0xcfe4f5, 0x54626e, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
    scene.add(sun);
    scene.add(sun.target);

    // Bounce fill: with shadows on and no GI, everything the sun cannot see
    // collapses to flat hemisphere ambient. A second, shadowless directional
    // light aimed back from the sun's far side and tinted by the ground is the
    // cheap stand-in — it models the shadowed sides instead of just raising
    // them. (three r160 has no light.shadow.intensity to soften shadows with.)
    const fill = new THREE.DirectionalLight(0x8899aa, 0.38);
    scene.add(fill);
    scene.add(fill.target);

    // ---- one sun, one shadow map, rendered once -----------------------------
    // The world has a single sun (blender/sky_and_light.py::SUN_ELEVATION), so
    // its shadow map can cover the whole daylit world in one static pass:
    // rendered on the first frame and never again. That buys three things at
    // once — shadows that are perfectly still instead of crawling as the
    // shadow box slides along with the visitor, zero per-frame shadow cost on
    // weak hardware, and no `castShadow` toggling, which is what used to
    // recompile every material at the mine portal.
    const sunDir = new THREE.Vector3(
        ...((skyRig && skyRig.sun && skyRig.sun.dir) || [0.32, 0.62, -0.72])).normalize();
    const box = (skyRig && skyRig.shadow_box)
        ? new THREE.Box3(new THREE.Vector3(...skyRig.shadow_box.min),
                         new THREE.Vector3(...skyRig.shadow_box.max))
        : new THREE.Box3(new THREE.Vector3(-72, -45, -46), new THREE.Vector3(72, 42, 170));

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = quality.shadowType;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;      // exactly one pass, on frame 1

    const boxCenter = box.getCenter(new THREE.Vector3());
    const boxRadius = box.getSize(new THREE.Vector3()).length() * 0.5;
    sun.position.copy(boxCenter).addScaledVector(sunDir, boxRadius + 20);
    sun.target.position.copy(boxCenter);
    sun.target.updateMatrixWorld();
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    fitShadowToBox(sun, box);
    // texels are ~4 cm (high) to ~16 cm (low) here, so the bias has to be
    // generous enough for the coarse tier without detaching contact shadows
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = quality.name === 'low' ? 0.9 : 0.45;

    // The bounce fill mirrors the sun across the vertical, sits low, casts
    // nothing — and is then swung 65 deg off that axis. The sun here runs
    // almost due +Y(blender), so a straight mirror leaves both side walls of
    // the atrium on the ambient floor (measured 0.30 against 2.59 on the
    // sunlit facade) and they read as slate. Off-axis, the bounce rakes them.
    const fillDir = new THREE.Vector3(-sunDir.x, 0, -sunDir.z)
        .normalize()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(65));
    fillDir.y = 0.34;
    fill.position.copy(boxCenter).add(fillDir.normalize().multiplyScalar(boxRadius));
    fill.target.position.copy(boxCenter);
    fill.target.updateMatrixWorld();

    gltfScene.traverse((o) => {
        if (!o.isMesh) return;
        // shader planes (water, falls, mist) are transparent fakes — they must
        // not throw shadows, and glass would only produce black slabs
        if (o.userData && o.userData.shader) return;
        // the train drives along the rail; a static map would nail its shadow
        // to wherever it happened to be parked on frame 1
        o.castShadow = !o.name.startsWith('DT1_');
        o.receiveShadow = true;
    });

    const dome = skyDome();
    scene.add(dome);
    const domeU = dome.material.uniforms;

    scene.fog = new THREE.FogExp2(0xaec6dd, 0.0042);
    scene.background = new THREE.Color(0x8fb4d9);

    const pts = ambiencePoints(anchors, rig);

    function applyAmbience(u) {
        let a = pts[0];
        let b = pts[pts.length - 1];
        for (let i = 0; i < pts.length - 1; i++) {
            if (u >= pts[i].u && u <= pts[i + 1].u) { a = pts[i]; b = pts[i + 1]; break; }
        }
        const t = b.u > a.u ? (u - a.u) / (b.u - a.u) : 0;
        const k = t * t * (3 - 2 * t);
        const za = zoneOf(a.zone);
        const zb = zoneOf(b.zone);
        const mix = (key) => {
            const va = (a.over && a.over[key] !== undefined) ? a.over[key] : null;
            const vb = (b.over && b.over[key] !== undefined) ? b.over[key] : null;
            return [va, vb];
        };

        scene.background.lerpColors(za.bgColor, zb.bgColor, k);
        scene.fog.color.lerpColors(za.fogColor, zb.fogColor, k);
        const [da, db] = mix('dens');
        const d0 = da ?? za.fog_density;
        const d1 = db ?? zb.fog_density;
        scene.fog.density = d0 + (d1 - d0) * k;
        renderer.toneMappingExposure = za.exposure + (zb.exposure - za.exposure) * k;

        hemi.color.lerpColors(za.hemiSky, zb.hemiSky, k);
        hemi.groundColor.lerpColors(za.hemiGround, zb.hemiGround, k);
        hemi.intensity = za.hemi_intensity + (zb.hemi_intensity - za.hemi_intensity) * k;

        // Direction is fixed for the whole world (one sun, one static shadow
        // map). Only colour and level are keyed per zone — which is enough to
        // carry a crisp morning into a dusty afternoon, and cannot desync the
        // shadows from the light.
        sun.color.lerpColors(za.sunColor, zb.sunColor, k);
        sun.intensity = za.sun_intensity + (zb.sun_intensity - za.sun_intensity) * k;
        fill.color.lerpColors(za.fillColor, zb.fillColor, k);
        fill.intensity = za.fill_intensity + (zb.fill_intensity - za.fill_intensity) * k;

        domeU.uTexA.value = za.tex;
        domeU.uTexB.value = zb.tex || za.tex;
        domeU.uMix.value = zb.tex ? k : 0;
        domeU.uExposure.value =
            za.sky_brightness + (zb.sky_brightness - za.sky_brightness) * k;
        domeU.uFogColor.value.copy(scene.fog.color);
    }

    return {
        update(t, u, camPos) {
            for (const mmat of animated) mmat.uniforms.uTime.value = t;
            applyAmbience(u);
            if (camPos) lampPool.update(camPos);
        },
        quality,
        hemi,
        sun,
        fill,
        dome,
        lampPool,
        zones,
    };
}
