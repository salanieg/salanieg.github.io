import * as THREE from 'three';
import fs from 'fs';

console.log('--- Verifying Mansion Terrain and 5 Exits ---');

// 1. Check terrain_data.js
const terrainJs = fs.readFileSync('mansion/js/terrain_data.js', 'utf8');
const match = terrainJs.match(/window\.TERRAIN_HEIGHTS_256\s*=\s*"([^"]+)";/);
if (!match) {
    throw new Error('Could not find window.TERRAIN_HEIGHTS_256 in terrain_data.js');
}
const b64 = match[1];
const bin = Buffer.from(b64, 'base64');
console.log('Decoded Base64 buffer byte length:', bin.length, '(expected 262144)');
const terrainGrid = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
console.log('Grid length:', terrainGrid.length, '(expected 65536 points)');

// 2. Test getTerrainHeight logic
const TERRAIN_CENTER_HEIGHT_NORM = 0.34117648;
const TERRAIN_MAX_HEIGHT = 140.0;
const TERRAIN_OCEAN_LEVEL = -31.5;

function getTerrainHeight(x, z) {
    const dist = Math.hypot(x, z);
    if (dist <= 33.0) return 0.0;
    const u = (x + 512.0) / 1024.0;
    const v = (z + 512.0) / 1024.0;
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return TERRAIN_OCEAN_LEVEL;
    const gx = Math.max(0.0, Math.min(255.0, u * 255.0));
    const gz = Math.max(0.0, Math.min(255.0, v * 255.0));
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(255, x0 + 1);
    const z1 = Math.min(255, z0 + 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const h00 = terrainGrid[z0 * 256 + x0];
    const h10 = terrainGrid[z0 * 256 + x1];
    const h01 = terrainGrid[z1 * 256 + x0];
    const h11 = terrainGrid[z1 * 256 + x1];
    const h0 = h00 * (1.0 - fx) + h10 * fx;
    const h1 = h01 * (1.0 - fx) + h11 * fx;
    const h = h0 * (1.0 - fz) + h1 * fz;
    return (h - TERRAIN_CENTER_HEIGHT_NORM) * TERRAIN_MAX_HEIGHT;
}

console.log('Center height (x=0, z=0):', getTerrainHeight(0, 0));
console.log('Exit 1 South height (x=0, z=28):', getTerrainHeight(0, 28).toFixed(2));
console.log('Mountain peak around r=150:', getTerrainHeight(100, 100).toFixed(2));

// 3. Test 5 Exits and Wall Gaps
const COURTYARD_RADIUS = 24.0;
const EXIT_ANGLES = [
    0.314159265,  // 18°
    1.570796327,  // 90° (Süd)
    2.827433388,  // 162°
    -2.199114858, // 234° (-126°)
    -0.942477796  // 306° (-54°)
];
const EXIT_OPENING_WIDTH = 7.5;
const EXIT_OPENING_ANGLE = EXIT_OPENING_WIDTH / COURTYARD_RADIUS;
const EXIT_HALF_ANGLE = EXIT_OPENING_ANGLE * 0.5;

function isPlayerInAnyPortal(px, pz) {
    const curAngle = Math.atan2(pz, px);
    for (let i = 0; i < EXIT_ANGLES.length; i++) {
        let diff = Math.abs(curAngle - EXIT_ANGLES[i]);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
        if (diff <= EXIT_HALF_ANGLE) return true;
    }
    return false;
}

console.log('\n--- Checking Portal detection at each exit center (R=24.0m) ---');
EXIT_ANGLES.forEach((ang, idx) => {
    const px = Math.cos(ang) * 24.0;
    const pz = Math.sin(ang) * 24.0;
    const inP = isPlayerInAnyPortal(px, pz);
    console.log(`Exit ${idx} at ${(ang * 180 / Math.PI).toFixed(1)}° (x=${px.toFixed(2)}, z=${pz.toFixed(2)}): inPortal = ${inP}`);
    if (!inP) throw new Error(`Exit ${idx} failed portal check!`);
});

console.log('\n--- Checking Wall detection behind each room center (R=24.0m) ---');
const SATELLITE_ROOMS = [
    { name: "Arbeit", cx: 0.0, cz: -16.5 },
    { name: "Kunst", cx: 15.692, cz: -5.099 },
    { name: "Chillen", cx: 9.698, cz: 13.349 },
    { name: "Gaming", cx: -9.698, cz: 13.349 },
    { name: "Lager", cx: -15.692, cz: -5.099 }
];
SATELLITE_ROOMS.forEach(room => {
    const roomAng = Math.atan2(room.cz, room.cx);
    const wx = Math.cos(roomAng) * 24.0;
    const wz = Math.sin(roomAng) * 24.0;
    const inP = isPlayerInAnyPortal(wx, wz);
    console.log(`Wall behind ${room.name} at ${(roomAng * 180 / Math.PI).toFixed(1)}° (x=${wx.toFixed(2)}, z=${wz.toFixed(2)}): inPortal = ${inP} (expected false)`);
    if (inP) throw new Error(`Wall behind ${room.name} should NOT be in portal!`);
});

// 4. Test Mesh creation & Shader chunks
const terrainGeo = new THREE.PlaneGeometry(1024, 1024, 255, 255);
terrainGeo.rotateX(-Math.PI / 2);
const posAttr = terrainGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const vy = getTerrainHeight(vx, vz);
    posAttr.setY(i, vy);
}
posAttr.needsUpdate = true;
terrainGeo.computeVertexNormals();
console.log('\nTerrain vertices successfully populated: count =', posAttr.count);

console.log('\nALL VERIFICATION CHECKS PASSED PERFECTLY!');
