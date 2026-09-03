import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrackManager } from '../src/simulator/TrackManager.js';
import { StationModel } from '../src/simulator/StationModel.js';
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

console.log('=== TESTING LAUNCH SPAWN & VISIBILITY ===');

const sim = new Simulation();
const scene = new THREE.Scene();
const lineRoot = new THREE.Group();
lineRoot.visible = false;
scene.add(lineRoot);

const trainRoot = new THREE.Group();
scene.add(trainRoot);

const tm = new TrackManager(lineRoot, sim);
const sm = new StationModel(lineRoot, sim, { deferBuild: true });
sm.buildStationAtIndex(0);
const train = new TrainModel(trainRoot, sim);

train.isStraight = true;
train.update(0.016);

assert(lineRoot.visible === false, 'lineRoot is hidden during space intro');
assert(train.group.parent === trainRoot, 'train is in trainRoot during space intro');

// Simulate _completeGameLaunch
train.isStraight = false;
lineRoot.add(train.group);
scene.remove(trainRoot);
lineRoot.visible = true;

train.update(0);
tm.update(sim.position);
sm.update(sim.position);

assert(lineRoot.visible === true, 'lineRoot is visible after launch');
assert(train.group.parent === lineRoot, 'train is safely in lineRoot after launch');
assert(tm.activeChunks.size > 0, 'Active track chunks present at spawn station');
assert(sm.loadedStations.has(0), 'Start station (Langwasser Süd) is loaded in scene');

console.log(`\nLAUNCH SPAWN TEST SUMMARY: ${passed} passed, ${failed} failed`);
