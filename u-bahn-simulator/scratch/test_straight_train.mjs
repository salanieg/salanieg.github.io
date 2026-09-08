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

console.log('=== TESTING STRAIGHT TRAIN IN SPACE ===');

const sim = new Simulation();
const root = new THREE.Group();
const tm = new TrainModel(root, sim);

tm.isStraight = true;
tm.update(0.016);

assert(tm.group.position.x === 0 && tm.group.position.y === 0 && tm.group.position.z === 0, 'Train group is at origin (0, 0, 0)');
assert(tm.group.rotation.y === 0, 'Train group rotation is 0');

for (let i = 0; i < tm.carriages.length; i++) {
    const c = tm.carriages[i];
    assert(c.position.x === 0, `Carriage ${i} X position is exactly 0`);
    assert(c.rotation.y === 0, `Carriage ${i} yaw rotation is exactly 0 (straight)`);
    assert(c.rotation.x === 0, `Carriage ${i} pitch rotation is exactly 0 (level)`);
}

// Test transition to normal curved track
tm.isStraight = false;
tm.update(0.016);
assert(tm.isStraight === false, 'Train returned to normal track following mode');

console.log(`\nSTRAIGHT TRAIN TEST SUMMARY: ${passed} passed, ${failed} failed`);
