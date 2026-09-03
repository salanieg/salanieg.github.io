import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { StationModel } from '../src/simulator/StationModel.js';
import { TrainModel } from '../src/simulator/TrainModel.js';
import { WorldManager } from '../src/simulator/WorldManager.js';
import { PassengerBuilder } from '../src/simulator/people/PassengerBuilder.js';
import { LorenzkircheBuilder } from '../src/simulator/stations/LorenzkircheBuilder.js';

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

console.log('=== 1. PASSENGER BUILDER & GEOMETRY MERGING ===');
const pb = new PassengerBuilder();
const char = pb.createCharacter({
    name: 'Anna Schmidt',
    height: 1.75,
    hairStyle: 'ponytail',
    shirtColor: '#ff0000',
    pantsColor: '#0000ff',
    item: 'koffer'
});

let meshCount = 0;
char.traverse(o => { if (o.isMesh) meshCount++; });
console.log('  Passenger meshes count: ' + meshCount);
assert(meshCount <= 9, 'Passenger meshes merged into <= 9 meshes (actual: ' + meshCount + ')');
assert(char.userData && char.userData.isPassenger === true, 'char.userData.isPassenger is true');
assert(char.userData.config.name === 'Anna Schmidt', 'char.userData.config preserved');

console.log('\n=== 2. ZERO-ALLOCATION TRACK SAMPLING ===');
const sim = new Simulation();
const outPos = new THREE.Vector3();
const outTan = new THREE.Vector3();
const retPos = sim.getTrackPosition(500, outPos);
const retTan = sim.getTrackTangent(500, outTan);
assert(retPos === outPos, 'getTrackPosition returns passed target reference (zero-allocation)');
assert(retTan === outTan, 'getTrackTangent returns passed target reference (zero-allocation)');
assert(!isNaN(outPos.x) && !isNaN(outPos.y) && !isNaN(outPos.z), 'Track position values are valid numbers');

console.log('\n=== 3. STATION PASSENGERS & VISIBILITY REGISTRY ===');
const lineRoot = new THREE.Group();
const sm = new StationModel(lineRoot, sim, { deferBuild: true });
const st0 = sm.buildStationAtIndex(0);
assert(st0 !== null, 'Station 0 built successfully');
const pass0 = sm.stationPassengers.get(0);
assert(Array.isArray(pass0), 'Station 0 has registered passengers list');
console.log('  Station 0 passengers count: ' + (pass0 ? pass0.length : 0));

const wm = Object.create(WorldManager.prototype);
wm.activePassengers = new Set();
sm.onPassengerVisibility = (passengers, active) => {
    wm.setPassengersActive(passengers, active);
};

if (pass0 && pass0.length > 0) {
    sm.onPassengerVisibility(pass0, true);
    assert(wm.activePassengers.size === pass0.length, 'activePassengers Set in WorldManager contains ' + pass0.length + ' items');
    sm.onPassengerVisibility(pass0, false);
    assert(wm.activePassengers.size === 0, 'activePassengers Set cleared when unloaded');
}

console.log('\n=== 4. LORENZKIRCHE FAST TEXTURE GENERATION ===');
const lkStation = sim.stations.find(s => s.name === 'Lorenzkirche');
const t0 = performance.now();
const lkBuilder = new LorenzkircheBuilder(sm, lkStation);
const lkGroup = lkBuilder.build();
const t1 = performance.now();
console.log('  Lorenzkirche build time: ' + (t1 - t0).toFixed(2) + ' ms');
assert(lkGroup && lkGroup.children.length > 0, 'Lorenzkirche station group created successfully');
assert(t1 - t0 < 500, 'Lorenzkirche build completes within reasonable time');

console.log('\n=== 5. PLANAR REFLECTION DOWN-SAMPLING (1024x576) ===');
const tm = new TrainModel(lineRoot, sim);
tm.initPlanarMirrors();
assert(tm.mirror !== null, 'TrainModel mirror initialized');
assert(tm.mirror.targets[0].width === 1024, 'Mirror target width is 1024 (actual: ' + tm.mirror.targets[0].width + ')');
assert(tm.mirror.targets[0].height === 576, 'Mirror target height is 576 (actual: ' + tm.mirror.targets[0].height + ')');
assert(tm.mirror.targets.length === 2, 'Mirror has 2 targets (L and R)');

console.log('\n=== 6. WORLD MANAGER CITY MODEL CULLING ===');
const fakeCityModel = new THREE.Group();
fakeCityModel.visible = true;
wm.cityModel = fakeCityModel;
wm.scene = { background: null, fog: { density: 0, color: { copy() {} } } }; wm.ambientLight = { intensity: 0 }; wm.renderer = { toneMappingExposure: 1.0 }; wm.sunLight = { intensity: 0 }; wm.headlight = { intensity: 0 };
wm.skyTexture = {};
wm.skyColor = {};
wm.tunnelColor = {};
wm.sim = sim;
wm.getChunkTypeAtDistance = (z) => 'underground';
wm.updateEnvironmentLighting(100, 0.016);
assert(wm.cityModel.visible === false, 'City model is hidden underground');

wm.getChunkTypeAtDistance = (z) => 'open';
wm.updateEnvironmentLighting(100, 0.016);
assert(wm.cityModel.visible === true, 'City model is shown in open air');

console.log('\n========================================');
console.log('VERIFICATION SUMMARY: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}
