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

// ---------------------------------------------------------------- ambience --
// Keyed by path u (see PIPELINE.md §2 for anchor values).
function ambiencePoints(a) {
    const A = (u, bg, fog, dens, exp, hemi, sun) =>
        ({ u, bg: new THREE.Color(bg), fog: new THREE.Color(fog), dens, exp, hemi, sun });
    const pts = [
        A(0.000, 0x8fb4d9, 0xaec6dd, 0.0042, 1.00, 0.55, 1.15),   // atrium
        A(a.projects - 0.015, 0x9cc7d8, 0xb5d2cf, 0.0050, 1.00, 0.60, 1.20),
        A(0.185, 0xc4d4de, 0xc9d5d8, 0.0060, 1.02, 0.60, 1.25),   // canyon gate
        A(0.220, 0xd9c19d, 0xd6bf9d, 0.0075, 1.05, 0.55, 1.40),   // desert bowl
        A(a.about + 0.005, 0xd9c19d, 0xd0b894, 0.0080, 1.05, 0.50, 1.35),
        A(0.268, 0x241f1a, 0x191510, 0.0200, 1.00, 0.21, 0.30),   // mine portal
        A(0.310, 0x14110d, 0x0f0c09, 0.0140, 1.05, 0.17, 0.05),   // lantern shaft
        A(0.345, 0x0a0d12, 0x090c11, 0.0140, 1.10, 0.10, 0.02),   // cavern reveal
        A(a.contact_inside + 0.02, 0x0a0d12, 0x090c11, 0.0150, 1.10, 0.10, 0.02),
        A(0.470, 0x04060a, 0x03050a, 0.0450, 1.00, 0.09, 0.00),   // tunnel
        A(0.940, 0x04060a, 0x03050a, 0.0450, 1.00, 0.09, 0.00),
        A(0.985, 0x6e93bd, 0x92acc7, 0.0090, 1.00, 0.40, 0.90),   // emergence
    ];
    pts.push({ ...pts[0], u: 1.0 });
    return pts;
}

export function setupFX(scene, renderer, gltfScene, anchors) {
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

    // imported punctual lights come in with raw candela values — normalize
    gltfScene.traverse((o) => {
        if (o.isPointLight) { o.intensity = 9; o.distance = 17; o.decay = 1.7; }
        else if (o.isSpotLight) { o.intensity = 55; o.distance = 55; o.decay = 1.4; o.angle = Math.min(o.angle, 0.65); }
        else if (o.isDirectionalLight) { o.visible = false; }   // we bring our own sun
    });

    const hemi = new THREE.HemisphereLight(0xcfe4f5, 0x54626e, 0.55);
    scene.add(hemi);
    // sun from the north-east (-Z here): the arch, saloon and train fronts
    // all face north along the travel direction and must catch the light
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
    sun.position.set(45, 85, -140);
    scene.add(sun);

    scene.fog = new THREE.FogExp2(0xaec6dd, 0.0042);
    scene.background = new THREE.Color(0x8fb4d9);

    const pts = ambiencePoints(anchors);
    const cur = { bg: new THREE.Color(), fog: new THREE.Color() };

    function applyAmbience(u) {
        let a = pts[0];
        let b = pts[pts.length - 1];
        for (let i = 0; i < pts.length - 1; i++) {
            if (u >= pts[i].u && u <= pts[i + 1].u) { a = pts[i]; b = pts[i + 1]; break; }
        }
        const t = b.u > a.u ? (u - a.u) / (b.u - a.u) : 0;
        const k = t * t * (3 - 2 * t);
        cur.bg.lerpColors(a.bg, b.bg, k);
        cur.fog.lerpColors(a.fog, b.fog, k);
        scene.background.copy(cur.bg);
        scene.fog.color.copy(cur.fog);
        scene.fog.density = a.dens + (b.dens - a.dens) * k;
        renderer.toneMappingExposure = a.exp + (b.exp - a.exp) * k;
        hemi.intensity = a.hemi + (b.hemi - a.hemi) * k;
        sun.intensity = a.sun + (b.sun - a.sun) * k;
    }

    return {
        update(t, u) {
            for (const mmat of animated) mmat.uniforms.uTime.value = t;
            applyAmbience(u);
        },
        hemi,
        sun,
    };
}
