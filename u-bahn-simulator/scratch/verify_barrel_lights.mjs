// Headless verification for the standard barrel light channel (Wöhrder-Wiese-
// Modell, StationModel.buildBarrelLights). Run with:
//   node --import ./scratch/register.mjs scratch/verify_barrel_lights.mjs
import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { StationModel } from '../src/simulator/StationModel.js';
import { TRACK_DATA_TRUNK } from '../src/simulator/TrackDataTrunk.js';

let failures = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
    if (!cond) failures++;
}

// Stations with the standard barrel lights, per line rig that builds them.
const U1_BARREL = ['Hardhöhe', 'Klinikum', 'Stadthalle', 'Muggenhof', 'Lorenzkirche', 'Rathaus'];
const TRUNK_BARREL = ['Hauptbahnhof', 'Wöhrder Wiese'];

function countByMaterial(group, mat) {
    let n = 0;
    group.traverse(o => { if (o.isMesh && o.material === mat) n++; });
    return n;
}

for (const [label, sim, names] of [
    ['U1', new Simulation(), U1_BARREL],
    ['TRUNK', new Simulation(TRACK_DATA_TRUNK), TRUNK_BARREL],
]) {
    const sm = new StationModel(new THREE.Group(), sim);
    for (const nm of names) {
        const idx = sim.stations.findIndex(s => s.name === nm);
        check(`${label}/${nm}: station exists`, idx >= 0);
        if (idx < 0) continue;
        const group = sm.stationsList[idx];
        check(`${label}/${nm}: group has geometry`, group.children.length > 0, `children=${group.children.length}`);
        // 2 signs x 2 ends = 4 end caps per station (caps share _barrelCapMat uncloned)
        const caps = countByMaterial(group, sm._barrelCapMat);
        check(`${label}/${nm}: 4 barrel end caps`, caps === 4, `caps=${caps}`);
        // Name bands share the per-name text material (uncloned)
        const nameMat = sm._barrelTextMats && sm._barrelTextMats[nm];
        const nameMeshes = nameMat ? countByMaterial(group, nameMat) : 0;
        check(`${label}/${nm}: name bands present`, nameMeshes > 0, `bands=${nameMeshes}`);
        // Light plates: buildSweptBar CLONES the lightTube material into a
        // 2-material array, so match by type/color instead of identity.
        let plates = 0;
        group.traverse(o => {
            if (o.isMesh && Array.isArray(o.material) && o.material[0].isMeshBasicMaterial
                && o.material[0].color.getHex() === 0xffffff) plates++;
        });
        check(`${label}/${nm}: light plates present`, plates >= 10, `plates=${plates}`);
    }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
