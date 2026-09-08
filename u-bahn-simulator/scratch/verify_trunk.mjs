// Headless verification for the shared trunk rig (run with:
//   node --import ./scratch/register.mjs scratch/verify_trunk.mjs )
// Canvas/Document-Stubs (geteilt mit verify_u23/train_census): dom_stubs.mjs
import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrackManager } from '../src/simulator/TrackManager.js';
import { StationModel } from '../src/simulator/StationModel.js';
import { TRACK_DATA_U2 } from '../src/simulator/TrackDataU2.js';
import { TRACK_DATA_U3 } from '../src/simulator/TrackDataU3.js';
import { TRACK_DATA_TRUNK } from '../src/simulator/TrackDataTrunk.js';

let failures = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
    if (!cond) failures++;
}

const TRUNK_STATION_NAMES = ['Rothenburger Straße', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];

// ---- 1. TRACK_DATA_TRUNK sanity ----
check('TRUNK: 6 stations (5 trunk + Plärrer for isPlaerrerZone)', TRACK_DATA_TRUNK.stations.length === 6, `n=${TRACK_DATA_TRUNK.stations.length}`);
check('TRUNK: station names match', TRUNK_STATION_NAMES.every(nm => TRACK_DATA_TRUNK.stations.some(s => s.name === nm)));
check('TRUNK: includes Plärrer', TRACK_DATA_TRUNK.stations.some(s => s.name === 'Plärrer'));
check('TRUNK: total > 0', TRACK_DATA_TRUNK.total > 0, `total=${TRACK_DATA_TRUNK.total}`);
check('TRUNK: cx/cz same length as expected from total', TRACK_DATA_TRUNK.cx.length === Math.round(TRACK_DATA_TRUNK.total / TRACK_DATA_TRUNK.step) + 1);

// ---- 2. Trunk world positions match U2's own (same physical stations) ----
const simU2 = new Simulation(TRACK_DATA_U2);
const simTrunk = new Simulation(TRACK_DATA_TRUNK);
for (const nm of TRUNK_STATION_NAMES) {
    const sU2 = simU2.stations.find(s => s.name === nm);
    const sT = simTrunk.stations.find(s => s.name === nm);
    const pU2 = simU2.getTrackPosition(sU2.position);
    const pT = simTrunk.getTrackPosition(sT.position);
    const d = Math.hypot(pU2.x - pT.x, pU2.z - pT.z);
    check(`TRUNK vs U2 world position: ${nm}`, d < 0.5, `dist=${d.toFixed(2)}m`);
}

// ---- 3. Simulation.isTrunkZone works for U2/U3, not for U1/TRUNK ----
const simU1 = new Simulation();
const simU3 = new Simulation(TRACK_DATA_U3);
check('U1: no trunkZone', simU1.trunkZone === null);
check('U2: has trunkZone', !!simU2.trunkZone);
check('U3: has trunkZone', !!simU3.trunkZone);
for (const [sim, id] of [[simU2, 'U2'], [simU3, 'U3']]) {
    const roth = sim.stations.find(s => s.name === 'Rothenburger Straße').position;
    const rath = sim.stations.find(s => s.name === 'Rathenauplatz').position;
    const mid = (roth + rath) / 2;
    check(`${id}: isTrunkZone true at trunk midpoint`, sim.isTrunkZone(mid));
    check(`${id}: isTrunkZone false far from trunk`, !sim.isTrunkZone(mid + 5000) && !sim.isTrunkZone(50));
}

// ---- 4. TrackManager.createChunk returns empty group inside U2/U3's trunk zone ----
const scene = new THREE.Group();
const tmU2 = new TrackManager(scene, simU2);
const roth2 = simU2.stations.find(s => s.name === 'Rothenburger Straße').position;
const rath2 = simU2.stations.find(s => s.name === 'Rathenauplatz').position;
const midIdx = Math.floor(((roth2 + rath2) / 2) / tmU2.chunkSize);
const outsideIdx = Math.floor((roth2 - 2000) / tmU2.chunkSize);
const trunkChunk = tmU2.createChunk(midIdx);
const normalChunk = tmU2.createChunk(Math.max(0, outsideIdx));
check('U2: chunk inside trunk zone is empty', trunkChunk.children.length === 0, `children=${trunkChunk.children.length}`);
check('U2: chunk outside trunk zone has geometry', normalChunk.children.length > 0, `children=${normalChunk.children.length}`);

// ---- 5. StationModel skips trunk stations for U2/U3, builds them for TRUNK ----
const smU2 = new StationModel(scene, simU2);
const smTrunk = new StationModel(scene, simTrunk);
const idxOpernhausU2 = simU2.stations.findIndex(s => s.name === 'Opernhaus');
const idxOpernhausTrunk = simTrunk.stations.findIndex(s => s.name === 'Opernhaus');
check('U2: Opernhaus group is empty (built by shared trunk rig instead)',
    smU2.stationsList[idxOpernhausU2].children.length === 0, `children=${smU2.stationsList[idxOpernhausU2].children.length}`);
check('TRUNK: Opernhaus group has real geometry',
    smTrunk.stationsList[idxOpernhausTrunk].children.length > 0, `children=${smTrunk.stationsList[idxOpernhausTrunk].children.length}`);

// ---- 6. Full trunk rig build (mirrors main.js buildTrunkRig): every chunk buildable, no NaN ----
const tmTrunk = new TrackManager(new THREE.Group(), simTrunk);
const totalChunks = Math.ceil(simTrunk.totalLength / tmTrunk.chunkSize);
let builtOk = true, totalChildren = 0;
for (let i = 0; i <= totalChunks; i++) {
    try {
        const c = tmTrunk.createChunk(i);
        totalChildren += c.children.length;
    } catch (e) { builtOk = false; console.log('  chunk build error at', i, e.message); break; }
}
check('TRUNK: all chunks build without error', builtOk, `n=${totalChunks + 1}`);
check('TRUNK: chunks contain real geometry', totalChildren > 0, `totalChildren=${totalChildren}`);

// ---- 6b. Trunk rig itself must suppress its OWN generic tunnel inside Plärrer (the bug:
// the rig had no idea Plärrer existed, so it built a normal tunnel tube straight through the
// bespoke hall). ----
check('TRUNK: Simulation knows about Plärrer', !!simTrunk.plaerrer, `pos=${simTrunk.plaerrer?.position}`);
if (simTrunk.plaerrer) {
    const plChunkIdx = Math.floor(simTrunk.plaerrer.position / tmTrunk.chunkSize);
    check('TRUNK: isPlaerrerZone true at Plärrer', simTrunk.isPlaerrerZone(simTrunk.plaerrer.position));
    const plChunk = tmTrunk.createChunk(plChunkIdx);
    // A normal underground trunk chunk has tunnel walls + bed + rails + sleepers/clips
    // (dozens of meshes); a chunk fully inside isPlaerrerZone should build almost nothing,
    // since the bespoke hall (built separately, shared by all 3 lines) replaces it entirely.
    check('TRUNK: chunk at Plärrer builds far less than a normal chunk (generic tunnel suppressed)',
        plChunk.children.length < 5, `children=${plChunk.children.length} (normal chunk had ${totalChildren / (totalChunks + 1) | 0}+ avg)`);
}

// ---- 7. Plärrer (still bespoke/shared, unaffected) + the bespoke switch transitions still
// work for U2/U3 (full correctness -- seams, smoothness, zone suppression -- is covered in
// scratch/verify_u23.mjs; this is just a smoke check that trunk-splice changes didn't break it) ----
check('U2: Plärrer still set (unaffected by trunk changes)', !!simU2.plaerrer);
check('U2/U3: buildSwitchTransition still produces geometry', (() => {
    const g = tmU2.buildSwitchTransition(simU2, simU3, 'Rathenauplatz', 'Rathenauplatz');
    return !!g && g.children.length >= 6;
})());

console.log(failures ? `\n${failures} FAILURES` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
