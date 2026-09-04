import fs from 'fs';

const geo = JSON.parse(fs.readFileSync('./unbg/railspline.geojson', 'utf8'));

// Find all subway features near Weißer Turm (11.0707, 49.4504)
const wtLon = 11.0707, wtLat = 49.4504;

const nearbyWays = [];
for (const f of geo.features) {
    const p = f.properties || {};
    let coordsList = [];
    if (f.geometry.type === 'LineString') coordsList = [f.geometry.coordinates];
    else if (f.geometry.type === 'MultiLineString') coordsList = f.geometry.coordinates;

    for (const seg of coordsList) {
        for (const c of seg) {
            const d = Math.hypot(c[0] - wtLon, c[1] - wtLat) * 111320;
            if (d < 200) {
                nearbyWays.push({
                    id: p['@id'],
                    name: p.name,
                    railway: p.railway,
                    tunnel: p.tunnel,
                    segLen: seg.length
                });
                break;
            }
        }
    }
}

console.log('Nearby ways in geojson:', nearbyWays);
