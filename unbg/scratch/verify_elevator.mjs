// Headless verification for the universal elevator model (run with:
//   node --import ./scratch/register.mjs scratch/verify_elevator.mjs )
import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { StationModel } from '../src/simulator/StationModel.js';
import { TRACK_DATA } from '../src/simulator/TrackDataU1.js';

let failures = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
    if (!cond) failures++;
}

const scene = new THREE.Group();
const sim = new Simulation(TRACK_DATA);
const sm = new StationModel(scene, sim);

const idx = sim.stations.findIndex(s => s.name === 'Langwasser Süd');
const station = sim.stations[idx];
const group = sm.stationsList[idx];
check('Langwasser Süd group built', group && group.children.length > 0, `children=${group?.children.length}`);

// The elevator group: the last-added group containing ~50 box meshes around local z of dz=-27
scene.updateMatrixWorld(true);
const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();

// Expected local position of the elevator center
const wp = sim.getTrackPosition(station.position - 27);
const expected = wp.clone().applyMatrix4(inv);

const elev = group.children.find(c =>
    c.isGroup && c.children.length > 30 &&
    Math.hypot(c.position.x - expected.x, c.position.z - expected.z) < 0.5);
check('elevator group present at dz=-27', !!elev, elev ? `meshes=${elev.children.length} at z=${elev.position.z.toFixed(2)}` : 'not found');

if (elev) {
    // Measure in the elevator's OWN frame: children are plain translated boxes
    // (no rotation), so union of geometry bounding boxes + positions is exact.
    const box = new THREE.Box3();
    for (const m of elev.children) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox.clone().translate(m.position));
    }
    const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
    // 2.5m shaft + 0.11 collar overhang per side; Z adds the call posts/panels
    check('footprint ~2.72m in X (shaft+collar)', sx > 2.6 && sx < 2.9, `sx=${sx.toFixed(2)}`);
    check('footprint ~2.5-3.4m in Z (call posts)', sz > 2.4 && sz < 3.4, `sz=${sz.toFixed(2)}`);
    check('shaft height reaches ceiling', Math.abs((elev.position.y + box.max.y) - 4.59) < 0.05, `top=${(elev.position.y + box.max.y).toFixed(2)}`);
    check('shaft starts at platform floor', Math.abs(elev.position.y - 0.865) < 0.001, `floorY=${elev.position.y.toFixed(3)}`);
    check('no NaN in elevator transforms', [elev.position.x, elev.position.z].every(Number.isFinite));
    check('clearance box stored', !!elev.userData.clearanceBox);

    // Clearance: no other furniture-sized object may intersect the footprint.
    // Same per-geometry measurement the production clearance pass uses (world
    // AABBs would double-inflate on this ~45°-rotated station).
    const invE = new THREE.Matrix4().copy(elev.matrixWorld).invert();
    const zone = elev.userData.clearanceBox;
    const rel = new THREE.Matrix4();
    const tmp = new THREE.Box3();
    const boxInElevFrame = (obj) => {
        const b = new THREE.Box3();
        obj.traverse(node => {
            if (!node.isMesh || !node.geometry) return;
            if (node.geometry.boundingBox === null) node.geometry.computeBoundingBox();
            rel.multiplyMatrices(invE, node.matrixWorld);
            tmp.copy(node.geometry.boundingBox).applyMatrix4(rel);
            b.union(tmp);
        });
        return b;
    };
    let intruders = 0;
    let neighbors = 0; // furniture-sized objects within 1.5m of the zone that SURVIVED
    const nearZone = zone.clone().expandByScalar(1.5);
    for (const child of group.children) {
        if (child === elev) continue;
        const b = boxInElevFrame(child);
        if (b.isEmpty()) continue;
        if (b.max.x - b.min.x > 6 || b.max.z - b.min.z > 6) continue; // structural
        if (b.intersectsBox(zone)) intruders++;
        else if (b.intersectsBox(nearZone)) neighbors++;
    }
    check('footprint cleared of furniture-sized objects', intruders === 0, `intruders=${intruders}`);
    // Regression for over-clearing: objects NEXT to the shaft must survive
    console.log(`INFO surviving furniture-sized neighbors within 1.5m of shaft: ${neighbors}`);
}

// Control: another slat-ceiling station without an elevator spec must have no elevator group
const idx2 = sim.stations.findIndex(s => s.name === 'Gemeinschaftshaus');
const group2 = sm.stationsList[idx2];
const elevMats = sm.materials.elevFrame;
check('elevator materials created once', !!elevMats);
const stray = group2.children.find(c => c.isGroup && c.children.some(m => m.material === elevMats));
check('no elevator at Gemeinschaftshaus', !stray);

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
