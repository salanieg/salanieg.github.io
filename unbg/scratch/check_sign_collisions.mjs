import './dom_stubs.mjs';
import { TRACK_DATA as U1 } from '../src/simulator/TrackDataU1.js';
import { TRACK_DATA_U2 as U2 } from '../src/simulator/TrackDataU2.js';
import { TRACK_DATA_U3 as U3 } from '../src/simulator/TrackDataU3.js';

const allStations = [...U1.stations, ...U2.stations, ...U3.stations];
const uniqueStations = [];
const seen = new Set();
for (const s of allStations) {
    if (!seen.has(s.name)) {
        seen.add(s.name);
        uniqueStations.push(s);
    }
}

function getPillars(name) {
    if (["Hardhöhe", "Jakobinenstraße", "Röthenbach", "Hohe Marter", "Opernhaus", "Wöhrder Wiese", "Rathenauplatz", "Grossreuth bei Schweinau", "Klinikum Nord", "Flughafen", "Maxfeld", "Rennweg", "Nordwestring", "Friedrich-Ebert-Platz"].includes(name)) {
        return [];
    }
    if (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(name)) {
        return [-33, -27, -21, -15, -9, -3, 3, 9, 15, 21, 27, 33];
    }
    if (name === "St. Leonhard" || name === "Aufseßplatz" || name === "Hauptbahnhof") {
        return [-32, -24, -16, -8, 0, 8, 16, 24, 32];
    }
    return [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5];
}

console.log('Collision check at z in [-30, 0, 30] for standard signLen = 6.5m:');
for (const s of uniqueStations) {
    if (["Plärrer", "Lorenzkirche", "Rathaus", "Schweinau", "Rothenburger Straße"].includes(s.name)) continue;
    if (s.side) continue; // side wall signs don't hit center pillars

    const pillars = getPillars(s.name);
    if (pillars.length === 0) continue;

    const charCount = s.name.toUpperCase().replace(/\u00DF/g, 'SS').length;
    const signLen = Math.max(2.8, Math.min(10.0, charCount * 0.33 + 1.2));
    const halfLen = signLen / 2;

    const testZs = (s.name === 'Messe') ? [-42.5, -17.5, 42.5] : [-30, 0, 30];
    const collisions = [];

    for (const sz of testZs) {
        for (const pz of pillars) {
            if (Math.abs(sz - pz) < halfLen + 0.42) {
                collisions.push({ sz, pz, dist: Math.abs(sz - pz) });
            }
        }
    }

    if (collisions.length > 0) {
        console.log(`COLLISION in ${s.name} (signLen: ${signLen.toFixed(2)}m):`);
        for (const c of collisions) {
            console.log(`  Sign at Z=${c.sz} collides with pillar at Z=${c.pz} (dist: ${c.dist.toFixed(2)}m < ${(halfLen + 0.42).toFixed(2)}m)`);
        }
    }
}
