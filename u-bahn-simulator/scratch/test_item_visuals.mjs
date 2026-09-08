import './dom_stubs.mjs';
import assert from 'assert';
import * as THREE from 'three';
import { PassengerBuilder } from '../src/simulator/people/PassengerBuilder.js';
import { PASSENGER_DATA } from '../src/simulator/people/PassengerData.js';

console.log("=== TESTING ALL ITEMS FOR VISUAL STRUCTURE & ANATOMICAL ATTACHMENT ===");
const builder = new PassengerBuilder();

// Collect all unique items
const allItems = new Set();
for (const [station, list] of Object.entries(PASSENGER_DATA)) {
    for (const p of list) {
        if (p.item) allItems.add(p.item);
    }
}
allItems.add('koffer');
allItems.add('nackenhoernchen');

console.log(`Found ${allItems.size} unique items to test.`);

let successCount = 0;
for (const item of allItems) {
    const char = builder.createCharacter({
        name: `Test_${item}`,
        item: item,
        height: 1.80
    });

    assert.ok(char.userData.isPassenger, `${item}: isPassenger is true`);
    
    // Check bounding box
    const bbox = new THREE.Box3().setFromObject(char);
    
    // No item should protrude below ground level
    assert.ok(bbox.min.y >= -0.05, `${item}: Does not clip below floor (min Y: ${bbox.min.y.toFixed(3)})`);
    
    // Character height should remain realistic (~1.7 - 2.2m for body, up to 3.3m for rods/flags)
    assert.ok(bbox.max.y >= 1.4 && bbox.max.y <= 3.3, `${item}: Top of character is realistic (max Y: ${bbox.max.y.toFixed(3)})`);

    // Merged meshes count must be <= 9 for optimal draw-call performance
    let meshCount = 0;
    char.traverse(o => { if (o.isMesh) meshCount++; });
    assert.ok(meshCount <= 9, `${item}: Merged into <= 9 meshes (actual: ${meshCount})`);

    successCount++;
}

console.log(`[PASS] Successfully verified all ${successCount} items!`);
