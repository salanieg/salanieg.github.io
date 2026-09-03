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

function getSignConfig(station) {
    const charCount = station.name.toUpperCase().replace(/\u00DF/g, 'SS').length;
    const signLen = Math.max(2.8, Math.min(10.0, Math.round((charCount * 0.33 + 1.2) * 100) / 100));
    
    if (station.side) {
        return {
            type: 'side_wall',
            signLen,
            signs: [-30, 0, 30].map(z => ({ z, isDouble: false }))
        };
    }
    if (station.name === "Scharfreiterring") {
        return {
            type: 'scharfreiterring',
            signLen,
            signs: [-30, 0, 30].map(z => ({ z, isDouble: false }))
        };
    }
    if (station.name === "Messe") {
        return {
            type: 'messe',
            signLen,
            signs: [-42.5, -17.5, 42.5].map(z => ({ z, isDouble: false }))
        };
    }

    const pillars = getPillars(station.name);
    if (pillars.length === 0) {
        return {
            type: 'column_free',
            signLen,
            signs: [-30, 0, 30].map(z => ({ z, isDouble: false }))
        };
    }

    const targetZs = [-30, 0, 30];
    const signs = [];

    for (const targetZ of targetZs) {
        // Find if a gap can fit the sign
        let bestGap = null;
        let bestGapDist = Infinity;

        for (let i = 0; i < pillars.length - 1; i++) {
            const p1 = pillars[i], p2 = pillars[i + 1];
            const mid = (p1 + p2) / 2;
            const clearSpace = (p2 - p1) - 0.84; // 0.84m pillar diameter
            if (signLen <= clearSpace - 0.3) {
                const d = Math.abs(mid - targetZ);
                if (d < bestGapDist) {
                    bestGapDist = d;
                    bestGap = { mid, clearSpace };
                }
            }
        }

        // Also check if targetZ is close to a pillar (e.g. pillar at 0, or closest pillar)
        let closestPillar = pillars[0];
        let closestPillarDist = Infinity;
        for (const p of pillars) {
            const d = Math.abs(p - targetZ);
            if (d < closestPillarDist) {
                closestPillarDist = d;
                closestPillar = p;
            }
        }

        // If targetZ is directly at a pillar (e.g. pillar at 0) or no gap fits:
        if (closestPillarDist === 0 || !bestGap || bestGapDist > 12) {
            signs.push({ z: closestPillar, isDouble: true });
        } else {
            signs.push({ z: bestGap.mid, isDouble: false });
        }
    }

    return { type: 'island', signLen, signs };
}

console.log('Testing sign configurations across all stations:');
for (const s of uniqueStations) {
    if (["Plärrer", "Lorenzkirche", "Rathaus", "Schweinau", "Rothenburger Straße"].includes(s.name)) continue;
    const cfg = getSignConfig(s);
    const signDescs = cfg.signs.map(sg => `${sg.isDouble ? 'Doppel@' : 'Flat@'}${sg.z}m`).join(', ');
    console.log(`${s.name.padEnd(25)} | len: ${cfg.signLen.toFixed(2)}m | ${signDescs}`);
}
