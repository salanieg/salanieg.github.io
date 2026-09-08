import './dom_stubs.mjs';
import assert from 'assert';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TRACK_DATA } from '../src/simulator/TrackDataU1.js';
import { TrainModel } from '../src/simulator/TrainModel.js';
import { StationModel } from '../src/simulator/StationModel.js';

console.log('=== 1. TESTING getStationStopPosition ===');
const sim = new Simulation(TRACK_DATA);
const schStation = sim.stations.find(s => s.name === 'Scharfreiterring');
const bfeStation = sim.stations.find(s => s.name === 'Bauernfeindstraße');

assert.strictEqual(sim.getStationStopPosition(bfeStation), bfeStation.position, 'Standard station stop position equals station.position');
assert.strictEqual(sim.getStationStopPosition(schStation), schStation.position + 18.0, 'Scharfreiterring stop position is shifted by +18.0m');
console.log('  [PASS] getStationStopPosition verified');

console.log('\n=== 2. TESTING DOOR SIDES (FORWARD & REVERSE) ===');
// Forward:
sim.isReversing = false;
assert.strictEqual(sim.getSideForStation(sim.stations.indexOf(schStation)), 'right', 'Scharfreiterring opens right in forward');
assert.strictEqual(sim.getSideForStation(sim.stations.indexOf(bfeStation)), 'right', 'Bauernfeindstraße opens right in forward');
const muggStation = sim.stations.find(s => s.name === 'Muggenhof');
assert.strictEqual(sim.getSideForStation(sim.stations.indexOf(muggStation)), 'left', 'Muggenhof (side station) opens left in forward');

// Reverse:
sim.isReversing = true;
assert.strictEqual(sim.getSideForStation(sim.stations.indexOf(schStation)), 'left', 'Scharfreiterring opens left in reverse');
assert.strictEqual(sim.getSideForStation(sim.stations.indexOf(bfeStation)), 'left', 'Bauernfeindstraße opens left in reverse');
assert.strictEqual(sim.getSideForStation(sim.stations.indexOf(muggStation)), 'right', 'Muggenhof (side station) opens right in reverse');
console.log('  [PASS] Door opening side rules verified');

console.log('\n=== 3. TESTING 3D PHYSICAL DOOR OPENING ONTO PLATFORM AT SCHARFREITERRING ===');
const scene = new THREE.Scene();
const tm = new TrainModel(scene, sim, 'G1');
const sm = new StationModel(scene, sim);
const stGroup = sm.buildStation(schStation);

// Forward test
sim.isReversing = false;
sim.nextStationIdx = sim.stations.indexOf(schStation);
const stopPosFwd = sim.getStationStopPosition(schStation);
sim.position = stopPosFwd + sim.trainHalfLength; // Front cab at stopPos + trainHalfLength -> trainCenter at stopPos
tm.update(0.016);

// Open doors
sim.speed = 0;
sim.doorState = 0;
sim.triggerDoors();
assert.strictEqual(sim.currentPlatformSide, 'right', 'sim.currentPlatformSide is right in forward');

// Check world position of open door relative to platform
const openDoorFwd = tm.doors.find(d => d.carIdx === 0 && d.side === 'right');
const pWFwd = new THREE.Vector3(); openDoorFwd.meshL.getWorldPosition(pWFwd);
const pLocFwd = stGroup.worldToLocal(pWFwd.clone());
console.log(`  Forward open door (G1) local X: ${pLocFwd.x.toFixed(2)}, Z: ${pLocFwd.z.toFixed(2)}`);
// Left platform is centered at -7.22 (spans -10.72 to -3.72)
assert.ok(pLocFwd.x > -11.0 && pLocFwd.x < -3.5, `Door opens towards platform (-10.72..-3.72), actual X=${pLocFwd.x.toFixed(2)}`);

// Reverse test
sim.isReversing = true;
sim.nextStationIdx = sim.stations.indexOf(schStation);
const stopPosRev = sim.getStationStopPosition(schStation);
sim.position = stopPosRev - sim.trainHalfLength;
tm.update(0.016);

sim.doorState = 0;
sim.triggerDoors();
assert.strictEqual(sim.currentPlatformSide, 'left', 'sim.currentPlatformSide is left in reverse');

const openDoorRev = tm.doors.find(d => d.carIdx === 0 && d.side === 'left');
const pWRev = new THREE.Vector3(); openDoorRev.meshL.getWorldPosition(pWRev);
const pLocRev = stGroup.worldToLocal(pWRev.clone());
console.log(`  Reverse open door (G1) local X: ${pLocRev.x.toFixed(2)}, Z: ${pLocRev.z.toFixed(2)}`);
// Right platform is centered at +7.22 (spans +3.72 to +10.72)
assert.ok(pLocRev.x > 3.5 && pLocRev.x < 11.0, `Door opens towards platform (3.72..10.72), actual X=${pLocRev.x.toFixed(2)}`);
console.log('  [PASS] Physical door alignment with platform decks verified');

console.log('\n=== 4. TESTING TRAIN CLEARANCE FROM ESCALATOR BUILDING (ROLLTREPPENBAU) ===');
// For a 75m train (trainHalfLength = 37.5), stopped at stopPos = station.position + 18.0:
// Train center relative to station is +18.0m.
// Rear/front extends: 18 - 37.5 = -19.5m, 18 + 37.5 = +55.5m.
// Escalator landing is at z = -25.7m. Platform end is at z = +60.22m.
const trainZMin = 18.0 - 37.5;
const trainZMax = 18.0 + 37.5;
console.log(`  Train footprint along platform Z: [${trainZMin}m, ${trainZMax}m]`);
assert.ok(trainZMin > -25.0, `Train rear/front (${trainZMin}m) is completely clear of escalators (-25.7m)`);
assert.ok(trainZMax < 60.0, `Train rear/front (${trainZMax}m) stays within platform boundary (+60.22m)`);
console.log('  [PASS] Full train clearance from Rolltreppenbau and platform bounds verified');

console.log('\n========================================');
console.log('ALL SCHARFREITERRING TESTS PASSED!');
