import { writeFileSync } from 'fs';

const u1 = (await import('../src/simulator/TrackDataU1.js')).TRACK_DATA;
const u2 = (await import('../src/simulator/TrackDataU2.js')).TRACK_DATA_U2;
const u3 = (await import('../src/simulator/TrackDataU3.js')).TRACK_DATA_U3;

function decimate(pts, keepEvery) {
    const out = [];
    for (let i = 0; i < pts.length; i += keepEvery) out.push(pts[i]);
    if ((pts.length - 1) % keepEvery !== 0) out.push(pts[pts.length - 1]);
    return out;
}

function lineOf(td) {
    const pts = [];
    for (let i = 0; i < td.cx.length; i++) pts.push([round(td.cx[i]), round(td.cz[i])]);
    const stations = td.stations.map(s => {
        const idx = Math.max(0, Math.min(td.cx.length - 1, Math.round(s.position / td.step)));
        return { name: s.name, x: round(td.cx[idx]), z: round(td.cz[idx]) };
    });
    return { pts: decimate(pts, 3), stations };
}
function round(n) { return Math.round(n * 10) / 10; }

const raw = { U1: lineOf(u1), U2: lineOf(u2), U3: lineOf(u3) };

// Merge stations that appear on multiple lines (shared physical station) by name,
// averaging coordinates across the lines that serve it.
const byName = new Map();
for (const lid of ['U1', 'U2', 'U3']) {
    for (const s of raw[lid].stations) {
        if (!byName.has(s.name)) byName.set(s.name, { name: s.name, lines: [], xs: [], zs: [] });
        const e = byName.get(s.name);
        e.lines.push(lid);
        e.xs.push(s.x);
        e.zs.push(s.z);
    }
}
const stations = [...byName.values()].map(e => ({
    name: e.name,
    lines: e.lines,
    x: round(e.xs.reduce((a, b) => a + b, 0) / e.xs.length),
    z: round(e.zs.reduce((a, b) => a + b, 0) / e.zs.length)
}));

const data = {
    lines: { U1: raw.U1.pts, U2: raw.U2.pts, U3: raw.U3.pts },
    stations
};

writeFileSync(new URL('./map_data_final.json', import.meta.url), JSON.stringify(data));
console.log('points', raw.U1.pts.length, raw.U2.pts.length, raw.U3.pts.length, 'stations', stations.length);
