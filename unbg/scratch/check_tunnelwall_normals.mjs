// One-off check for createTunnelWallMesh's analytic normals (run with:
//   node --import ./scratch/register.mjs scratch/check_tunnelwall_normals.mjs )
import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrackManager } from '../src/simulator/TrackManager.js';
import { TRACK_DATA_U2 } from '../src/simulator/TrackDataU2.js';

let failures = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
    if (!cond) failures++;
}

const sim = new Simulation(TRACK_DATA_U2);
const scene = new THREE.Group();
const tm = new TrackManager(scene, sim);

// Scan several chunks (plain tunnel, away from the trunk zone) and inspect the
// merged tunnelWall mesh of each.
let meshes = 0, ringsWithCurve = 0;
let maxLenErr = 0, minVertical = 1, badAxis = 0, nan = 0;
const totalChunks = Math.floor(sim.totalLength / tm.chunkSize);
for (let idx = 2; idx < Math.min(totalChunks, 40); idx++) {
    const chunk = tm.createChunk(idx);
    if (!chunk) continue;
    chunk.updateMatrixWorld(true);
    chunk.traverse(o => {
        if (!o.isMesh || o.material !== tm.materials.tunnelWall) return;
        meshes++;
        const pos = o.geometry.getAttribute('position');
        const nrm = o.geometry.getAttribute('normal');
        const uv = o.geometry.getAttribute('uv');
        const idxAttr = o.geometry.getIndex();
        check(`chunk ${idx}: attribute counts match`, nrm && pos.count === nrm.count && pos.count === uv.count,
            `pos=${pos.count} nrm=${nrm ? nrm.count : 'none'} uv=${uv.count}`);
        let maxIdx = 0;
        for (let i = 0; i < idxAttr.count; i++) maxIdx = Math.max(maxIdx, idxAttr.getX(i));
        check(`chunk ${idx}: indices within vertex count`, maxIdx < pos.count, `maxIdx=${maxIdx} count=${pos.count}`);
        for (let i = 0; i < nrm.count; i++) {
            const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
            if (Number.isNaN(x + y + z)) { nan++; continue; }
            const len = Math.hypot(x, y, z);
            maxLenErr = Math.max(maxLenErr, Math.abs(len - 1));
            // Every face of the rectangular profile is either horizontal-normal
            // (walls: y≈0) or vertical-normal (floor/ceiling: |y|≈1).
            const ay = Math.abs(y);
            if (ay > 0.01 && ay < 0.99) badAxis++;
        }
    });
}

check('found tunnelWall meshes', meshes > 0, `n=${meshes}`);
check('no NaN normals', nan === 0, `nan=${nan}`);
check('normals unit length', maxLenErr < 1e-3, `maxErr=${maxLenErr.toExponential(2)}`);
check('normals axis-aligned in profile (wall horizontal / floor+ceiling vertical)', badAxis === 0, `bad=${badAxis}`);

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
