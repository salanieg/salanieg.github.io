import { TRACK_DATA } from '../src/simulator/TrackDataU1.js';

function smoothstep(t) {
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t * t * (3 - 2 * t);
}

const gap = [...TRACK_DATA.gap];
const step = TRACK_DATA.step; // 5m
const wt = TRACK_DATA.stations.find(s => s.name === "Weißer Turm");
const targetSpacing = 12.20; // Correct Mittelbahnsteig standard

const idx = Math.round(wt.position / step);
const half = Math.round(wt.halfLength / step);
const tr = Math.round(50 / step); // 50m transition zone

const loE = Math.max(0, idx - half - tr);
const hiE = Math.min(gap.length - 1, idx + half + tr);
const baseLo = gap[loE];
const baseHi = gap[hiE];

console.log(`Original gap at Weißer Turm: ${gap[idx]}m`);
console.log(`Platform interval: idx ${idx - half} to ${idx + half} (s = ${(idx - half) * step}m to ${(idx + half) * step}m)`);
console.log(`Transition interval: idx ${loE} to ${hiE} (s = ${loE * step}m to ${hiE * step}m)`);
console.log(`Base at loE: ${baseLo}m, Base at hiE: ${baseHi}m`);

for (let k = loE; k <= hiE; k++) {
    if (k >= idx - half && k <= idx + half) {
        gap[k] = targetSpacing;
    } else if (k < idx - half) {
        const t = smoothstep((k - loE) / tr);
        gap[k] = Math.round((baseLo + (targetSpacing - baseLo) * t) * 100) / 100;
    } else {
        const t = smoothstep((hiE - k) / tr);
        gap[k] = Math.round((baseHi + (targetSpacing - baseHi) * t) * 100) / 100;
    }
}

console.log('\nNew gap values across Weißer Turm:');
for (let k = loE; k <= hiE; k += 2) {
    console.log(`  s=${k * step}m (idx=${k}): gap=${gap[k]}m -> platWidth=${(gap[k] - 3.08).toFixed(2)}m`);
}
