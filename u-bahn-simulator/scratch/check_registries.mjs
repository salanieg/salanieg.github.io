// Prüft nach dem Merging, ob alle dynamischen Registry-Objekte noch im Graphen hängen.
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
function makeCanvas() { return { width: 0, height: 0, getContext: () => makeCtxProxy(), toDataURL: () => '', style: {} }; }
globalThis.document = { createElement: () => makeCanvas(), createElementNS: () => makeCanvas(), fonts: { add() {} }, body: { classList: { contains: () => false } } };
globalThis.window = { devicePixelRatio: 1 };
globalThis.self = globalThis;

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
const { TrainModel } = await import('../src/simulator/TrainModel.js');
const tm = new TrainModel({ add() {}, remove() {} }, sim);

function check(tm, label) {
    const connected = new Set();
    tm.group.traverse(o => connected.add(o));
    let ok = 0, broken = [];
    const registries = {
        doors: tm.doors, cabDoors: tm.cabDoors, interiorDisplays: tm.interiorDisplays,
        speedNeedles: tm.speedNeedles, brakeNeedles: tm.brakeNeedles,
        throttleLevers: tm.throttleLevers, dashboardScreens: tm.dashboardScreens,
        radioMeshes: tm.radioMeshes, radioDisplays: tm.radioDisplays,
        'lights.frontWhite': tm.lights.frontWhite, 'lights.frontRed': tm.lights.frontRed,
        'lights.rearWhite': tm.lights.rearWhite, 'lights.rearRed': tm.lights.rearRed
    };
    for (const [name, registry] of Object.entries(registries)) {
        for (const entry of registry) {
            if (!entry) continue;
            const objs = entry.isObject3D ? [entry]
                : Object.values(entry).filter(v => v && v.isObject3D);
            for (const o of objs) {
                if (connected.has(o)) ok++;
                else broken.push(name);
            }
        }
    }
    console.log(`${label}: ${ok} Registry-Objekte verbunden, ${broken.length} GETRENNT ${broken.length ? '-> ' + [...new Set(broken)].join(', ') : '(alles ok)'}`);
}
check(tm, 'G1');
tm.trainType = 'DT1';
tm.disposeTrainResources();
while (tm.group.children.length > 0) tm.group.remove(tm.group.children[0]);
tm.doors = []; tm.cabDoors = []; tm.interiorDisplays = []; tm.speedNeedles = [];
tm.brakeNeedles = []; tm.throttleLevers = []; tm.dashboardScreens = [];
tm.radioMeshes = []; tm.radioDisplays = []; tm.carriages = [];
tm.lights = { frontWhite: [], frontRed: [], rearWhite: [], rearRed: [] };
tm.dt1DestScreenMat = null;
tm.buildTrain();
check(tm, 'DT1 (nach disposeTrainResources + Rebuild)');
