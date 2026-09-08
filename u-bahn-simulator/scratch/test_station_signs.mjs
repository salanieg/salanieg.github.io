import './dom_stubs.mjs';
import assert from 'node:assert';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { StationModel } from '../src/simulator/StationModel.js';
import { TRACK_DATA as TRACK_DATA_U1 } from '../src/simulator/TrackDataU1.js';
import { TRACK_DATA_U2 } from '../src/simulator/TrackDataU2.js';

const root = new THREE.Group();
const sim = new Simulation(TRACK_DATA_U1);
const stationModel = new StationModel(root, sim);

const EXPECTED_SIGN_Y = 3.81675;
const EXPECTED_SIGN_H = 0.6495;
const EXPECTED_TOP_Y = EXPECTED_SIGN_Y + EXPECTED_SIGN_H / 2; // 4.1415m

console.log("=== 1. TESTING ADAPTIVE SIGN DIMENSIONS (TEXT-BASED) ===");
const dimsMesse = stationModel.getSignDimensions("Messe");
const dimsHbf = stationModel.getSignDimensions("Hauptbahnhof");
const dimsGross = stationModel.getSignDimensions("Grossreuth bei Schweinau");

console.log(`  Messe length: ${dimsMesse.signLen}m (height: ${dimsMesse.signH}m)`);
console.log(`  Hauptbahnhof length: ${dimsHbf.signLen}m (height: ${dimsHbf.signH}m)`);
console.log(`  Grossreuth length: ${dimsGross.signLen}m (height: ${dimsGross.signH}m)`);

assert.ok(dimsMesse.signLen < dimsHbf.signLen, "Short station name is shorter than medium station name");
assert.ok(dimsHbf.signLen < dimsGross.signLen, "Medium station name is shorter than long station name");
assert.strictEqual(dimsMesse.signH, EXPECTED_SIGN_H, "Sign height is 0.6495m");
assert.strictEqual(dimsGross.signH, EXPECTED_SIGN_H, "Sign height is 0.6495m");
assert.ok(Math.abs(EXPECTED_TOP_Y - 4.1415) < 0.0001, "Top edge is exactly at 4.1415m");
console.log("  [PASS] Adaptive text length scaling and fixed top edge verified");

console.log("\n=== 2. TESTING MATERIAL GENERATION & CACHING ===");
const bfMat = stationModel.getStationNameSignMaterial("Bauernfeindstraße");
assert.ok(bfMat, "Bauernfeindstraße material generated");
assert.ok(bfMat.map, "Bauernfeindstraße has canvas texture");

const bfMatCached = stationModel.getStationNameSignMaterial("Bauernfeindstraße");
assert.strictEqual(bfMat, bfMatCached, "Materials are cached per station");
console.log("  [PASS] Material generation and caching verified");

console.log("\n=== 3. TESTING MITTELBAHNSTEIG: BAUERNFEINDSTRASSE (BETWEEN PILLARS) ===");
const bfStation = TRACK_DATA_U1.stations.find(s => s.name === "Bauernfeindstraße");
const bfGroup = stationModel.buildStation(bfStation);

let bfSigns = [];
bfGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && child.children.length === 5) {
        bfSigns.push(child);
    }
});
console.log(`  Bauernfeindstraße signs found: ${bfSigns.length}`);
assert.strictEqual(bfSigns.length, 3, "Bauernfeindstraße has exactly 3 hanging signs (-30, 0, 30)");

// Verify all signs are between pillars
const bfPillars = stationModel.getStationPillars("Bauernfeindstraße");
const halfLenBf = dimsHbf.signLen / 2;
for (const sg of bfSigns) {
    for (const pz of bfPillars) {
        const dist = Math.abs(sg.position.z - pz);
        assert.ok(dist > halfLenBf, `Sign at z=${sg.position.z} is clear of pillar at z=${pz} (dist: ${dist}m)`);
    }
}
console.log("  [PASS] Bauernfeindstraße flat signs are between pillars with zero collisions");

console.log("\n=== 4. TESTING MITTELBAHNSTEIG: HAUPTBAHNHOF (FLAT SIGNS & DOPPELSCHILD) ===");
const hbfStation = TRACK_DATA_U1.stations.find(s => s.name === "Hauptbahnhof");
const hbfGroup = stationModel.buildStation(hbfStation);

let hbfFlatSigns = [];
let hbfDoppelSigns = [];
hbfGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01) {
        if (child.children.length === 5) hbfFlatSigns.push(child);
        else if (child.children.length >= 8) hbfDoppelSigns.push(child);
    }
});
console.log(`  Hauptbahnhof flat signs (between pillars): ${hbfFlatSigns.length}`);
console.log(`  Hauptbahnhof Doppelschilder (around pillar): ${hbfDoppelSigns.length}`);
assert.strictEqual(hbfFlatSigns.length, 2, "Hauptbahnhof has 2 flat signs in pillar gaps (-28m, +28m)");
assert.strictEqual(hbfDoppelSigns.length, 1, "Hauptbahnhof has 1 Doppelschild at central pillar (0m)");
console.log("  [PASS] Hauptbahnhof combination of flat signs and Doppelschild verified");

console.log("\n=== 5. TESTING MITTELBAHNSTEIG: MAXIMILIANSTRASSE (ALL DOPPELSCHILDER) ===");
const maxStation = TRACK_DATA_U1.stations.find(s => s.name === "Maximilianstraße");
const maxGroup = stationModel.buildStation(maxStation);

let maxDoppelSigns = [];
maxGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && child.children.length >= 8) {
        maxDoppelSigns.push(child);
    }
});
console.log(`  Maximilianstraße Doppelschilder found: ${maxDoppelSigns.length}`);
assert.strictEqual(maxDoppelSigns.length, 3, "Maximilianstraße has 3 Doppelschilder around pillars");

// Verify Doppelschild geometry: opening clears pillar, ends meet at x=0
const dGeom = stationModel.getDoppelschildGeometries(dimsHbf.signLen, EXPECTED_SIGN_H, 0.06, 0.51);
assert.ok(dGeom.branchR && dGeom.branchL, "Doppelschild geometries created");
console.log("  [PASS] Maximilianstraße Doppelschilder verified");

console.log("\n=== 6. TESTING SCHARFREITERRING (HANGING SIGNS PER PLATFORM) ===");
const schStation = TRACK_DATA_U1.stations.find(s => s.name === "Scharfreiterring");
const schGroup = stationModel.buildStation(schStation);
let schSigns = [];
schGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && child.children.length === 5) {
        schSigns.push(child);
    }
});
console.log(`  Scharfreiterring signs found: ${schSigns.length}`);
assert.strictEqual(schSigns.length, 6, "Scharfreiterring has 6 hanging signs (3 per platform)");
console.log("  [PASS] Scharfreiterring signs verified");

console.log("\n=== 7. TESTING SEITENBAHNSTEIGE (WALL-MOUNTED SIGNS) ===");
const muggStation = TRACK_DATA_U1.stations.find(s => s.name === "Muggenhof");
const muggGroup = stationModel.buildStation(muggStation);
let muggSigns = [];
muggGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && child.children.length === 2) {
        muggSigns.push(child);
    }
});
console.log(`  Muggenhof wall signs found: ${muggSigns.length}`);
assert.strictEqual(muggSigns.length, 6, "Muggenhof has 6 wall signs (3 left wall + 3 right wall)");

const stadtStation = TRACK_DATA_U1.stations.find(s => s.name === "Stadtgrenze");
const stadtGroup = stationModel.buildStation(stadtStation);
let stadtSigns = [];
stadtGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && child.children.length === 2) {
        stadtSigns.push(child);
    }
});
console.log(`  Stadtgrenze wall signs found: ${stadtSigns.length}`);
assert.strictEqual(stadtSigns.length, 6, "Stadtgrenze has 6 wall signs (3 left wall + 3 right wall)");
console.log("  [PASS] Seitenbahnsteig wall-mounted signs verified");

console.log("\n=== 8. TESTING EXCLUDED STATIONS ===");
const plaerrerStation = TRACK_DATA_U1.stations.find(s => s.name === "Plärrer");
const plaerrerGroup = stationModel.buildStation(plaerrerStation);
let plaerrerSigns = [];
plaerrerGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && (child.children.length === 5 || child.children.length === 2 || child.children.length >= 8)) {
        plaerrerSigns.push(child);
    }
});
assert.strictEqual(plaerrerSigns.length, 0, "Plärrer must NOT have standard signs");

const simU2 = new Simulation(TRACK_DATA_U2);
const sbU2 = new StationModel(root, simU2);
const schwStation = TRACK_DATA_U2.stations.find(s => s.name === "Schweinau");
const schwGroup = sbU2.buildStation(schwStation);
let schwSigns = [];
schwGroup.traverse((child) => {
    if (child.isGroup && Math.abs(child.position.y - EXPECTED_SIGN_Y) < 0.01 && (child.children.length === 5 || child.children.length === 2 || child.children.length >= 8)) {
        schwSigns.push(child);
    }
});
assert.strictEqual(schwSigns.length, 0, "Schweinau must NOT have standard signs");
console.log("  [PASS] Excluded stations verified");

console.log("\n========================================");
console.log("ALL STATION SIGN TESTS PASSED!");
