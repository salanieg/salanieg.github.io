import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { StationModel } from '../src/simulator/StationModel.js';
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

const sim = new Simulation(U1);
const sm = new StationModel(new THREE.Group(), sim);

console.log('Station Analysis:');
for (const s of uniqueStations) {
    const isExcluded = ["Plärrer", "Lorenzkirche", "Rathaus", "Schweinau", "Rothenburger Straße"].includes(s.name);
    if (isExcluded) continue;

    // Check pillar type
    const S_len = 1.0;
    let pZs = [];
    if (["Hardhöhe", "Jakobinenstraße", "Röthenbach", "Hohe Marter", "Opernhaus", "Wöhrder Wiese", "Rathenauplatz", "Grossreuth bei Schweinau", "Klinikum Nord", "Flughafen", "Maxfeld", "Rennweg", "Nordwestring", "Friedrich-Ebert-Platz"].includes(s.name)) {
        pZs = []; // column free
    } else if (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(s.name)) {
        pZs = [-33, -27, -21, -15, -9, -3, 3, 9, 15, 21, 27, 33];
    } else if (s.name === "St. Leonhard" || s.name === "Aufseßplatz" || s.name === "Hauptbahnhof") {
        pZs = [-32, -24, -16, -8, 0, 8, 16, 24, 32];
    } else {
        pZs = [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5];
    }

    console.log(`- ${s.name.padEnd(25)} | side: ${Boolean(s.side).toString().padEnd(5)} | pillars: ${pZs.length} | spacing: ${pZs.length > 1 ? (pZs[1] - pZs[0]) + 'm' : 'none'}`);
}
