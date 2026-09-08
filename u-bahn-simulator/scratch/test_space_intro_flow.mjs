import './dom_stubs.mjs';
import * as THREE from 'three';
import { SpaceIntro } from '../src/simulator/SpaceIntro.js';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrainModel } from '../src/simulator/TrainModel.js';
import { WorldManager } from '../src/simulator/WorldManager.js';

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

console.log('=== TESTING INSTANT SPACE INTRO FLOW ===');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 16/9, 0.1, 1000);
const intro = new SpaceIntro(scene, camera);

assert(intro !== null, 'SpaceIntro instantiated');
assert(scene.children.includes(intro.group), 'SpaceIntro group added to scene');
assert(intro.starLines !== null, 'Starfield line segments created');
assert(intro.starLines.geometry.attributes.position.count === 5600, '2,800 stars (5,600 line vertices) created');
assert(intro.isActive === true, 'SpaceIntro is active');

// Test starfield drift
const posBefore = intro.starPositions[2];
intro.update(0.05);
const posAfter = intro.starPositions[2];
assert(posAfter < posBefore, 'Stars drift forward along -Z');

// Test warp transition
let warpDone = false;
intro.triggerWarp(() => {
    warpDone = true;
});
assert(intro.isWarping === true, 'Warp triggered');

for (let i = 0; i < 60; i++) {
    intro.update(0.02);
}
assert(warpDone === true, 'Warp callback invoked upon completion');

// Test cleanup
intro.dispose();
assert(intro.isActive === false, 'SpaceIntro marked inactive');
assert(!scene.children.includes(intro.group), 'SpaceIntro group removed from scene');

console.log(`\nSPACE INTRO TEST SUMMARY: ${passed} passed, ${failed} failed`);
