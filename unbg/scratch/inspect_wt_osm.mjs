import fs from 'fs';

const LAT0 = 49.44;
const M_LAT = 111320.0;
const M_LON = 111320.0 * Math.cos(LAT0 * Math.PI / 180);

const geo = JSON.parse(fs.readFileSync('./unbg/railspline.geojson', 'utf8'));

function getTrackCoords(id) {
    const feat = geo.features.find(f => f.properties && f.properties['@id'] === id);
    let bestSeg = null;
    let maxLen = 0;
    for (const seg of feat.geometry.coordinates) {
        if (seg.length > maxLen) {
            maxLen = seg.length;
            bestSeg = seg;
        }
    }
    return bestSeg.map(c => ({
        lon: c[0],
        lat: c[1],
        x: c[0] * M_LON,
        y: -c[1] * M_LAT
    }));
}

const trackA = getTrackCoords('relation/538906');
const trackB = getTrackCoords('relation/538907');

// Weißer Turm is around lon=11.0707, lat=49.4504
console.log('Searching for points near Weißer Turm (11.0707, 49.4504)...');

const wtLon = 11.0707, wtLat = 49.4504;
const wtX = wtLon * M_LON, wtY = -wtLat * M_LAT;

const ptsA = trackA.filter(p => Math.hypot(p.x - wtX, p.y - wtY) < 150);
const ptsB = trackB.filter(p => Math.hypot(p.x - wtX, p.y - wtY) < 150);

console.log('Points on Track A near WT:', ptsA.length);
console.log('Points on Track B near WT:', ptsB.length);

for (const pa of ptsA) {
    let closestB = null;
    let minD = Infinity;
    for (const pb of ptsB) {
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (d < minD) {
            minD = d;
            closestB = pb;
        }
    }
    console.log(`Track A (lon=${pa.lon.toFixed(6)}, lat=${pa.lat.toFixed(6)}) -> closest Track B: dist = ${minD.toFixed(2)} m`);
}
