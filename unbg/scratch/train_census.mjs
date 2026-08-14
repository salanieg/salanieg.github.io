// Headless census of the TrainModel scene graph: counts meshes, draw calls,
// unique geometries/materials and triangles without a browser.

// ---- Minimal DOM stubs so canvas-texture code runs under Node ----
function makeCtxProxy() {
    const gradient = { addColorStop() {} };
    const cache = new Map();
    return new Proxy({}, {
        get(t, prop) {
            if (prop === 'canvas') return null;
            if (prop === 'measureText') return () => ({ width: 50 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
            if (prop === 'createPattern') return () => ({});
            if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w * h)) });
            if (!cache.has(prop)) cache.set(prop, () => {});
            return cache.get(prop);
        },
        set() { return true; }
    });
}
function makeCanvas() {
    return {
        width: 0, height: 0,
        getContext: () => makeCtxProxy(),
        toDataURL: () => '',
        style: {}
    };
}
globalThis.document = {
    createElement: (tag) => makeCanvas(),
    createElementNS: () => makeCanvas(),
    fonts: { add() {} },
    body: { classList: { contains: () => false } }
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.self = globalThis;

// ---- Simulation stub with all fields the build path may read ----
const stations = [];
for (let i = 0; i < 27; i++) stations.push({ name: 'Station ' + i, position: i * 700, index: i, halfLength: 45 });
const sim = {
    speed: 0, throttle: 0, brakeCylinderPressure: 0, emergencyBrake: false,
    doorState: 0, doorProgress: 0, doorsOpen: false, doorWarningActive: false,
    atoMode: false, position: 0, isReversing: false, trainModelType: 'G1',
    stations, displayNextStationIdx: 0, nextStationIdx: 0, currentStationIdx: 0,
    radioActive: false, sifaTimer: 0, trainHalfLength: 38,
    lineName: 'U1', targetName: 'Hardhöhe',
    track: { lineId: 'U1' },
    getPlatformSide: () => 'left',
    getTrackPosition: () => ({ x: 0, y: 0, z: 0, clone() { return this; }, addScaledVector() { return this; } }),
    getTrackTangent: () => ({ x: 0, y: 0, z: 1 }),
    getTrackSpacing: () => 3.6
};

const THREE = await import('three');
const { TrainModel } = await import('../src/simulator/TrainModel.js');

const scene = { add() {}, remove() {} };

function census(group, label) {
    let meshes = 0, sprites = 0, groups = 0, other = 0, triangles = 0, transparentMeshes = 0;
    const geos = new Set(), mats = new Set();
    const matMeshCount = new Map();
    group.traverse(o => {
        if (o.isMesh) {
            meshes++;
            if (o.geometry) {
                geos.add(o.geometry);
                const idx = o.geometry.index;
                const pos = o.geometry.attributes && o.geometry.attributes.position;
                if (idx) triangles += idx.count / 3;
                else if (pos) triangles += pos.count / 3;
            }
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of ms) {
                if (!m) continue;
                mats.add(m);
                if (m.transparent) transparentMeshes++;
                const key = m.type + (m.transparent ? ' (transparent)' : '');
                matMeshCount.set(key, (matMeshCount.get(key) || 0) + 1);
            }
        } else if (o.isSprite) {
            sprites++;
            if (o.material) mats.add(o.material);
        } else if (o.isGroup) groups++;
        else other++;
    });
    console.log(`\n===== ${label} =====`);
    console.log(`Meshes (≈ draw calls wenn sichtbar): ${meshes}`);
    console.log(`Sprites: ${sprites}   Groups: ${groups}   Sonstige: ${other}`);
    console.log(`Unique Geometrien: ${geos.size}`);
    console.log(`Unique Materialien: ${mats.size}`);
    console.log(`Dreiecke gesamt: ${Math.round(triangles).toLocaleString('de-DE')}`);
    console.log(`Meshes mit transparentem Material: ${transparentMeshes}`);
    console.log(`Meshes nach Material-Typ:`);
    [...matMeshCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

const tm = new TrainModel(scene, sim);
census(tm.group, 'G1 (Standard-Zug)');

// DT1: rebuild without calling update(0) (needs live track sampling)
tm.trainType = 'DT1';
while (tm.group.children.length > 0) tm.group.remove(tm.group.children[0]);
tm.doors = []; tm.cabDoors = []; tm.interiorDisplays = []; tm.speedNeedles = [];
tm.brakeNeedles = []; tm.throttleLevers = []; tm.dashboardScreens = [];
tm.radioMeshes = []; tm.radioDisplays = []; tm.carriages = [];
tm.lights = { frontWhite: [], frontRed: [], rearWhite: [], rearRed: [] };
tm.buildTrain();
census(tm.group, 'DT1');
