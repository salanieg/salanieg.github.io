import './dom_stubs.mjs';
import assert from 'assert';
import * as THREE from 'three';
import { PassengerBuilder } from '../src/simulator/people/PassengerBuilder.js';
import { PASSENGER_DATA } from '../src/simulator/people/PassengerData.js';

console.log("=== 1. TESTING SLEEVE MATERIAL FIXES (NO TEXTURE DISTORTION) ===");
const builder = new PassengerBuilder();

// Test that patterned torso shirts do NOT apply chest canvas textures to sleeves
const testStyles = ['striped', 'plaid', 'logo', 'yellow_shoulders', 'tie', 'tie_crooked', 'fcn', 'greuther', 'split_nuremberg_fuerth', 'doctor', 'evening', 'suspenders', 'pinstripe'];

for (const style of testStyles) {
    const torsoMat = builder.getTorsoMaterial(style, '#fa8072', {});
    const sleeveMat = builder.getSleeveMaterial(style, '#fa8072', {}, false);
    
    // Torso material has a canvas texture map
    if (['striped', 'plaid', 'logo', 'tie', 'doctor'].includes(style)) {
        assert.ok(torsoMat.map, `Torso material for ${style} has texture map`);
    }
    
    // Sleeve material must NEVER have a squashed canvas texture map!
    assert.strictEqual(sleeveMat.map, null, `Sleeve material for ${style} must NOT have texture map`);
    assert.ok(sleeveMat.color, `Sleeve material for ${style} has valid color`);
}
console.log("  [PASS] All sleeve materials are clean, solid, and free of distorted torso textures");

console.log("\n=== 2. TESTING CHARACTER CREATION WITH VARIOUS POSES ===");
const testConfigs = [
    { name: "Phone User", item: "smartphone" },
    { name: "Watch Checker", item: "armbanduhr" },
    { name: "Coffee Drinker", item: "kaffeebecher" },
    { name: "Reader", item: "buch" },
    { name: "Photographer", item: "fotoapparat" },
    { name: "Runner", pose: "sprint" },
    { name: "Doctor", shirtStyle: "doctor", item: "stethoskop" },
    { name: "Nuremberg-Fürth Fan", shirtStyle: "split_nuremberg_fuerth" },
    { name: "Hipster", hairStyle: "beanie_hipster", glasses: "black" },
    { name: "Woman with Ponytail & Cap", hairStyle: "ponytail", item: "wanderstock" }
];

for (const cfg of testConfigs) {
    const char = builder.createCharacter(cfg);
    assert.ok(char.userData.isPassenger, `${cfg.name}: isPassenger is true`);
    assert.ok(char.userData.config, `${cfg.name}: config preserved`);
    
    // Check bounding box: must be reasonable human dimensions (Y around [0, 1.8m])
    const bbox = new THREE.Box3().setFromObject(char);
    assert.ok(bbox.min.y >= -0.05, `${cfg.name}: Feet/shoes are at ground level (min Y: ${bbox.min.y})`);
    assert.ok(bbox.max.y >= 1.4 && bbox.max.y <= 2.2, `${cfg.name}: Top of head is around 1.8m (max Y: ${bbox.max.y})`);
    
    // Check mesh count: geometry merging must merge into <= 9 meshes
    let meshCount = 0;
    char.traverse(o => { if (o.isMesh) meshCount++; });
    assert.ok(meshCount <= 9, `${cfg.name}: Merged into <= 9 meshes (actual: ${meshCount})`);
}
console.log("  [PASS] All characters created with correct dimensions and merged <= 9 meshes");

console.log("\n=== 3. TESTING ALL PASSENGER_DATA DEFINITIONS ===");
let totalChecked = 0;
for (const [stationName, passengers] of Object.entries(PASSENGER_DATA)) {
    for (const p of passengers) {
        const char = builder.createCharacter(p);
        assert.ok(char.userData.isPassenger);
        totalChecked++;
    }
}
console.log(`  [PASS] Successfully generated all ${totalChecked} passengers across all stations without errors!`);

console.log("\n========================================");
console.log("ALL PASSENGER TESTS PASSED!");
