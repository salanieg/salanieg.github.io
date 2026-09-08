import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrainModel } from '../src/simulator/TrainModel.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log('  [PASS] ' + message);
        passed++;
    } else {
        console.error('  [FAIL] ' + message);
        failed++;
    }
}

console.log('=== 1. TESTING STRAIGHT ALIGNMENT FOR G1, DT1, DT3 ===');
const sim = new Simulation();
const root = new THREE.Group();
const tm = new TrainModel(root, sim);

for (const type of ['G1', 'DT1', 'DT3']) {
    tm.isStraight = true;
    tm.setTrainModel(type);
    
    assert(tm.isStraight === true, `${type}: isStraight is preserved on model switch`);
    assert(tm.group.position.x === 0 && tm.group.position.y === 0 && tm.group.position.z === 0, `${type}: Train group at (0, 0, 0)`);
    assert(tm.group.rotation.x === 0 && tm.group.rotation.y === 0 && tm.group.rotation.z === 0, `${type}: Train group rotation is 0`);
    
    for (let i = 0; i < tm.carriages.length; i++) {
        const c = tm.carriages[i];
        assert(Math.abs(c.position.x) < 1e-5, `${type} car ${i}: X is 0`);
        assert(Math.abs(c.rotation.y) < 1e-5, `${type} car ${i}: Yaw is 0`);
        assert(Math.abs(c.rotation.x) < 1e-5, `${type} car ${i}: Pitch is 0`);
    }
}

console.log('\n=== 2. TESTING HEADLIGHTS & TAILLIGHTS (FORWARD) ===');
for (const type of ['G1', 'DT1', 'DT3']) {
    tm.isStraight = true;
    tm.setTrainModel(type);
    tm.updateLights(false);
    
    const fWhite = tm.lights.frontWhite.every(l => l.visible === true);
    const fRed = tm.lights.frontRed.every(l => l.visible === false);
    const rWhite = tm.lights.rearWhite.every(l => l.visible === false);
    const rRed = tm.lights.rearRed.every(l => l.visible === true);
    
    assert(fWhite, `${type}: Front white headlights are ON`);
    assert(fRed, `${type}: Front red taillights are OFF`);
    assert(rWhite, `${type}: Rear white headlights are OFF`);
    assert(rRed, `${type}: Rear red taillights are ON`);
}

console.log('\n=== 3. TESTING HEADLIGHTS & TAILLIGHTS (REVERSE) ===');
for (const type of ['G1', 'DT1', 'DT3']) {
    tm.isStraight = true;
    tm.setTrainModel(type);
    tm.updateLights(true);
    
    const fWhite = tm.lights.frontWhite.every(l => l.visible === false);
    const fRed = tm.lights.frontRed.every(l => l.visible === true);
    const rWhite = tm.lights.rearWhite.every(l => l.visible === true);
    const rRed = tm.lights.rearRed.every(l => l.visible === false);
    
    assert(fWhite, `${type} (rev): Front white headlights are OFF`);
    assert(fRed, `${type} (rev): Front red taillights are ON`);
    assert(rWhite, `${type} (rev): Rear white headlights are ON`);
    assert(rRed, `${type} (rev): Rear red taillights are OFF`);
}

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
