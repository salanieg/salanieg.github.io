import './dom_stubs.mjs';
import assert from 'assert';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { StationModel } from '../src/simulator/StationModel.js';
import { TRACK_DATA } from '../src/simulator/TrackDataU1.js';

const sim = new Simulation(TRACK_DATA);
const sm = new StationModel(new THREE.Group(), sim);

console.log('Testing StationModel.getDoppelschildGeometries...');
const signLen = 6.8;
const halfL = signLen / 2;
const result = sm.getDoppelschildGeometries(signLen, 0.6495, 0.06, 0.51);

assert.ok(result.branchR.casingGeom);
assert.ok(result.branchR.faceGeom);
assert.ok(result.branchL.casingGeom);
assert.ok(result.branchL.faceGeom);

// Check UV coordinates on Branch R (+X side, facing Track 1)
// Viewer from +X looks towards -X.
// Left is +Z, right is -Z.
// Left (Z = +halfL) must have u = 0.
// Right (Z = -halfL) must have u = 1.
const posR = result.branchR.faceGeom.getAttribute('position');
const uvR = result.branchR.faceGeom.getAttribute('uv');

let minZ_R = Infinity, maxZ_R = -Infinity;
let uAtMinZ_R = null, uAtMaxZ_R = null;

for (let i = 0; i < posR.count; i++) {
    const z = posR.getZ(i);
    const u = uvR.getX(i);
    if (z < minZ_R) { minZ_R = z; uAtMinZ_R = u; }
    if (z > maxZ_R) { maxZ_R = z; uAtMaxZ_R = u; }
}

console.log(`Branch R (+X side): minZ=${minZ_R.toFixed(2)} has u=${uAtMinZ_R}, maxZ=${maxZ_R.toFixed(2)} has u=${uAtMaxZ_R}`);
// Left side of sign as seen from Track 1 is maxZ (+halfL)
assert.strictEqual(uAtMaxZ_R, 0, 'Branch R left side (+Z) must have u=0 (start of text)');
assert.strictEqual(uAtMinZ_R, 1, 'Branch R right side (-Z) must have u=1 (end of text)');
console.log('  [PASS] Branch R (+X) text reads normally from left to right (not mirrored)');

// Check UV coordinates on Branch L (-X side, facing Track 2)
// Viewer from -X looks towards +X.
// Left is -Z, right is +Z.
// Left (Z = -halfL) must have u = 0.
// Right (Z = +halfL) must have u = 1.
const posL = result.branchL.faceGeom.getAttribute('position');
const uvL = result.branchL.faceGeom.getAttribute('uv');

let minZ_L = Infinity, maxZ_L = -Infinity;
let uAtMinZ_L = null, uAtMaxZ_L = null;

for (let i = 0; i < posL.count; i++) {
    const z = posL.getZ(i);
    const u = uvL.getX(i);
    if (z < minZ_L) { minZ_L = z; uAtMinZ_L = u; }
    if (z > maxZ_L) { maxZ_L = z; uAtMaxZ_L = u; }
}

console.log(`Branch L (-X side): minZ=${minZ_L.toFixed(2)} has u=${uAtMinZ_L}, maxZ=${maxZ_L.toFixed(2)} has u=${uAtMaxZ_L}`);
// Left side of sign as seen from Track 2 is minZ (-halfL)
assert.strictEqual(uAtMinZ_L, 0, 'Branch L left side (-Z) must have u=0 (start of text)');
assert.strictEqual(uAtMaxZ_L, 1, 'Branch L right side (+Z) must have u=1 (end of text)');
console.log('  [PASS] Branch L (-X) text reads normally from left to right (not mirrored)');

console.log('\nALL DOPPELSCHILD GEOMETRY AND UV CHECKS PASSED!');
