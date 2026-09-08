import { TRACK_DATA } from '../src/simulator/TrackDataU1.js';

const wt = TRACK_DATA.stations.find(s => s.name === "Weißer Turm");
const idx = Math.round(wt.position / TRACK_DATA.step);
const half = Math.round(wt.halfLength / TRACK_DATA.step);

console.log(`Weißer Turm center idx=${idx} (s=${wt.position}), half=${half} (from ${idx-half} to ${idx+half})`);
console.log('Values in TRACK_DATA.gap:');
for (let i = idx - half - 10; i <= idx + half + 10; i++) {
    const s = i * TRACK_DATA.step;
    console.log(`  i=${i} (s=${s.toFixed(0)}m): gap=${TRACK_DATA.gap[i]}m`);
}
