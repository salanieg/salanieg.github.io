import fs from 'fs';

const bin = fs.readFileSync('mansion/assets/textures/terrain/terrain_heights_256.bin');
console.log('Size in bytes:', bin.length);
const b64 = bin.toString('base64');
const content = `window.TERRAIN_HEIGHTS_256 = "${b64}";\n`;
fs.writeFileSync('mansion/js/terrain_data.js', content, 'utf8');
console.log('Written mansion/js/terrain_data.js successfully, chars:', content.length);
