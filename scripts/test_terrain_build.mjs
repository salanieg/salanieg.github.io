import * as THREE from 'three';
import fs from 'fs';
import path from 'path';

console.log('Testing terrain setup in Three.js...');

// 1. Test binary read
const binPath = path.resolve('mansion/assets/textures/terrain/terrain_heights_256.bin');
const buf = fs.readFileSync(binPath);
const grid = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
console.log('Binary grid loaded, elements:', grid.length);

// 2. Test PlaneGeometry displacement
const terrainGeo = new THREE.PlaneGeometry(1024, 1024, 255, 255);
terrainGeo.rotateX(-Math.PI / 2);

const posAttr = terrainGeo.attributes.position;
console.log('Vertex count:', posAttr.count);

for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const u = (vx + 512.0) / 1024.0;
    const v = (vz + 512.0) / 1024.0;
    const gx = Math.max(0, Math.min(255, Math.round(u * 255.0)));
    const gz = Math.max(0, Math.min(255, Math.round(v * 255.0)));
    const hNorm = grid[gz * 256 + gx];
    const vy = (hNorm - 0.49733075) * 120.0;
    posAttr.setY(i, vy);
}
posAttr.needsUpdate = true;
terrainGeo.computeVertexNormals();
console.log('Geometry displaced and normals computed.');

// 3. Check bounding box
terrainGeo.computeBoundingBox();
console.log('Bounding Box Min:', terrainGeo.boundingBox.min);
console.log('Bounding Box Max:', terrainGeo.boundingBox.max);

console.log('All geometry tests passed!');
