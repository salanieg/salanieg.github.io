import fs from 'fs';

const LAT0 = 49.44;
const M_LAT = 111320.0;
const M_LON = 111320.0 * Math.cos(LAT0 * Math.PI / 180);

function toMeters(coord) {
    return [coord[0] * M_LON, -coord[1] * M_LAT];
}

const geo = JSON.parse(fs.readFileSync('./unbg/railspline.geojson', 'utf8'));
console.log('Features count:', geo.features.length);

for (const f of geo.features) {
    const p = f.properties || {};
    const name = p.name || '';
    const id = p['@id'] || '';
    if (name.includes('Weißer Turm') || (p.description && p.description.includes('Turm'))) {
        console.log('Feature:', id, name, p);
    }
}

// Check stations or relations
const rels = geo.features.filter(f => f.properties && f.properties['@id'] && f.properties['@id'].startsWith('relation/'));
console.log('Relations:', rels.map(r => ({ id: r.properties['@id'], name: r.properties.name })));
