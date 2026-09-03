import './dom_stubs.mjs';
import { TRACK_DATA as U1 } from '../src/simulator/TrackDataU1.js';
import { TRACK_DATA_U2 as U2 } from '../src/simulator/TrackDataU2.js';
import { TRACK_DATA_U3 as U3 } from '../src/simulator/TrackDataU3.js';

const allStations = [...U1.stations, ...U2.stations, ...U3.stations];
const uniqueNames = [...new Set(allStations.map(s => s.name))];

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const fontSize = 96;
ctx.font = `bold ${fontSize}px Arial, sans-serif`;

console.log("Name | TextWidth(px)");
const widths = [];
for (const name of uniqueNames) {
    const text = name.toUpperCase().replace(/\u00DF/g, "SS");
    const w = ctx.measureText(text).width;
    widths.push({ name, text, w });
}
widths.sort((a, b) => a.w - b.w);
for (const item of widths) {
    console.log(`${item.name.padEnd(28)} | ${item.w.toFixed(0).padStart(6)}px`);
}
