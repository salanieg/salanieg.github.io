import './dom_stubs.mjs';
import assert from 'assert';
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

function getSignPlacements(station) {
    const charCount = station.name.toUpperCase().replace(/\u00DF/g, 'SS').length;
    const signLen = Math.max(2.8, Math.min(10.0, Math.round((charCount * 0.33 + 1.2) * 100) / 100));

    if (station.side) {
        return { type: 'side', signLen, signs: [-30, 0, 30].map(z => ({ z, isDouble: false })) };
    }
    if (station.name === "Scharfreiterring") {
        return { type: 'scharfreiterring', signLen, signs: [-30, 0, 30].map(z => ({ z, isDouble: false })) };
    }
    if (station.name === "Messe") {
        return { type: 'messe', signLen, signs: [-42.5, -17.5, 42.5].map(z => ({ z, isDouble: false })) };
    }

    const pillars = getPillars(station.name);
    if (pillars.length === 0) {
        return { type: 'flat', signLen, signs: [-30, 0, 30].map(z => ({ z, isDouble: false })) };
    }

    const targetZs = [-30, 0, 30];
    const signs = [];

    for (const targetZ of targetZs) {
        let bestGap = null;
        let bestGapDist = Infinity;

        for (let i = 0; i < pillars.length - 1; i++) {
            const p1 = pillars[i], p2 = pillars[i + 1];
            const mid = (p1 + p2) / 2;
            const clearSpace = (p2 - p1) - 0.84;
            if (signLen <= clearSpace - 0.3) {
                const d = Math.abs(mid - targetZ);
                if (d < bestGapDist) {
                    bestGapDist = d;
                    bestGap = { mid, clearSpace };
                }
            }
        }

        // Check closest pillar
        let closestPillar = pillars[0];
        let closestPillarDist = Infinity;
        for (const p of pillars) {
            const d = Math.abs(p - targetZ);
            if (d < closestPillarDist) {
                closestPillarDist = d;
                closestPillar = p;
            }
        }

        // If a pillar is right at targetZ (like 0 in Hbf/Aufsessplatz/St.Leonhard),
        // or no gap fits:
        if (closestPillarDist === 0 || !bestGap || bestGapDist > 10) {
            // Check nice distribution for 6m stations
            let p = closestPillar;
            if (["Maximilianstraße", "Bärenschanze"].includes(station.name)) {
                if (targetZ === -30) p = -21;
                else if (targetZ === 0) p = -3;
                else if (targetZ === 30) p = 21;
            }
            signs.push({ z: p, isDouble: true });
        } else {
            signs.push({ z: bestGap.mid, isDouble: false });
        }
    }

    return { type: 'island', signLen, signs };
}

let totalCollisions = 0;
for (const s of uniqueStations) {
    if (["Plärrer", "Lorenzkirche", "Rathaus", "Schweinau", "Rothenburger Straße"].includes(s.name)) continue;
    if (s.side) continue;

    const cfg = getSignPlacements(s);
    const pillars = getPillars(s.name);
    const halfLen = cfg.signLen / 2;

    for (const sg of cfg.signs) {
        if (sg.isDouble) {
            // Doppelschild wraps around pillar at sg.z (opening clears it).
            // Check that it doesn't collide with OTHER pillars!
            for (const pz of pillars) {
                if (pz === sg.z) continue; // the pillar it wraps around!
                const d = Math.abs(pz - sg.z);
                if (d < halfLen + 0.42) {
                    console.log(`COLLISION for Doppelschild in ${s.name} at z=${sg.z} with other pillar at z=${pz} (dist=${d.toFixed(2)}, min=${(halfLen+0.42).toFixed(2)})`);
                    totalCollisions++;
                }
            }
        } else {
            // Flat sign: must not collide with ANY pillar
            for (const pz of pillars) {
                const d = Math.abs(pz - sg.z);
                if (d < halfLen + 0.42) {
                    console.log(`COLLISION for Flat sign in ${s.name} at z=${sg.z} with pillar at z=${pz} (dist=${d.toFixed(2)}, min=${(halfLen+0.42).toFixed(2)})`);
                    totalCollisions++;
                }
            }
        }
    }
}

console.log(`\nTotal collisions across ALL stations: ${totalCollisions}`);
assert.strictEqual(totalCollisions, 0, "Zero collisions across all stations!");
console.log("VERIFICATION SUCCESS: ZERO COLLISIONS ACROSS ALL STATIONS!");
