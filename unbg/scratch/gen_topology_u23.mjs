// U2/U3 reconstruction from two INDEPENDENT per-line geojson exports (railsplineU2.geojson /
// railsplineU3.geojson). Each line is processed completely on its own -- own graph, own
// Dijkstra path, own nearest-neighbour midline+gap harvest, own smoothing pass, own rigid
// registration into the world via the shared U1 Plärrer corridor anchor -- mirroring U1's own
// gen_centerline.ps1 pipeline exactly, just run twice. There is NO cross-line splicing/forced
// coincidence: the two lines are expected to naturally overlap on the real shared corridor
// (Rothenburger Straße..Rathenauplatz) because both source files include the same "U2/U3"
// trunk ways and both anchor to the same Plärrer corridor point, not because of any trick that
// forces them to be byte-identical there.
import fs from 'fs';

const LAT0 = 49.44, M_LAT = 111320.0, M_LON = 111320.0 * Math.cos(LAT0 * Math.PI / 180);
function project(lon, lat) { return [lon * M_LON, -lat * M_LAT]; }
function wayLen(coords) {
    let L = 0;
    for (let i = 1; i < coords.length; i++) L += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    return L;
}
function keyOf(pt) { return pt[0].toFixed(2) + ',' + pt[1].toFixed(2); }

function pointAtArc(pts, s) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (acc + d >= s) { const t = (s - acc) / d; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
        acc += d;
    }
    return pts[pts.length - 1];
}

function resamplePolyline(pts, step) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const n = Math.max(2, Math.round(L / step) + 1);
    const out = [];
    let seg = 0;
    for (let m = 0; m < n; m++) {
        const t = L * m / (n - 1);
        while (seg < pts.length - 2 && cum[seg + 1] < t) seg++;
        const sl = cum[seg + 1] - cum[seg] || 1;
        const f = (t - cum[seg]) / sl;
        out.push([pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f]);
    }
    return { pts: out, L };
}

// 1-D median filter (window +-w) -- kills isolated OSM vertex spikes before smoothing.
function medianXY(pts, w) {
    const n = pts.length, out = pts.map(p => p.slice());
    for (let i = 0; i < n; i++) {
        const xs = [], ys = [];
        for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < n) { xs.push(pts[j][0]); ys.push(pts[j][1]); } }
        xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
        out[i] = [xs[xs.length >> 1], ys[ys.length >> 1]];
    }
    return out;
}
function smoothXY(pts, passes, w) {
    let a = pts.map(p => p.slice());
    for (let p = 0; p < passes; p++) {
        const b = a.map(p => p.slice());
        for (let i = 0; i < a.length; i++) {
            let sx = 0, sy = 0, wt = 0;
            for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < a.length) { sx += b[j][0]; sy += b[j][1]; wt++; } }
            a[i] = [sx / wt, sy / wt];
        }
    }
    return a;
}

// arcWindow (optional [lo, hi]) restricts the search to segments in that arc-length range --
// a winding route (e.g. the Rothenburger..Plärrer..Opernhaus..Rathenauplatz S-bend) can
// otherwise let a naive global nearest-point search match a station against a geometrically
// nearby but wrong-arc part of the same curve.
//
// nominalStep (optional): when `pts` is a uniformly-INDEXED array (paddedPts/cx,cz sampled
// every STEP metres), report arc as i*nominalStep + t*nominalStep instead of the true
// curve-following cumulative distance -- keeps `position` consistent with the naive
// `index = position/step` convention every consumer (the game included) actually uses,
// instead of a physically-real but practically-wrong arc length that drifts on curvy sections.
function projectToPolyline(pts, pt, arcWindow, nominalStep) {
    let best = Infinity, bestArc = 0, acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        const segLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const nomLen = nominalStep || segLen;
        if (arcWindow && (acc + nomLen < arcWindow[0] || acc > arcWindow[1])) { acc += nomLen; continue; }
        const vx = B[0] - A[0], vy = B[1] - A[1], len2 = vx * vx + vy * vy || 1;
        let t = ((pt[0] - A[0]) * vx + (pt[1] - A[1]) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const qx = A[0] + vx * t, qy = A[1] + vy * t;
        const d2 = (pt[0] - qx) ** 2 + (pt[1] - qy) ** 2;
        if (d2 < best) { best = d2; bestArc = acc + t * nomLen; }
        acc += nomLen;
    }
    return { arc: bestArc, dist: Math.sqrt(best) };
}

// ---------------------------------------------------------------------------------------
// U1 anchor (Plärrer Gleis 3/4 corridor)
// ---------------------------------------------------------------------------------------
const tdText = fs.readFileSync('src/simulator/TrackDataU1.js', 'utf8');
function parseArr(name) {
    const m = tdText.match(new RegExp(name + ':\\s*\\[([^\\]]*)\\]'));
    return m[1].split(',').map(Number);
}
const U1_CX = parseArr('cx'), U1_CZ = parseArr('cz');
const U1_STEP = Number(tdText.match(/step:\s*([0-9.]+)/)[1]);
const U1_TOTAL = Number(tdText.match(/total:\s*([0-9.]+)/)[1]);
const plM = tdText.match(/name:"Plärrer"[^\r\n]*?position:([0-9.]+),halfLength:([0-9.]+)/);
const U1_PLAERRER_POS = Number(plM[1]);
const U1_PLAERRER_HALFLEN = Number(plM[2]);

function sampleU1(dist) {
    const cx = U1_CX, cz = U1_CZ, n = cx.length;
    if (dist < 0) dist = 0;
    if (dist > U1_TOTAL) dist = U1_TOTAL;
    const u = dist / U1_STEP;
    let i = Math.floor(u);
    if (i < 0) i = 0;
    if (i > n - 2) i = n - 2;
    const t = u - i;
    const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(n - 1, i + 1), i3 = Math.min(n - 1, i + 2);
    const x0 = cx[i0], x1 = cx[i1], x2 = cx[i2], x3 = cx[i3];
    const z0 = cz[i0], z1 = cz[i1], z2 = cz[i2], z3 = cz[i3];
    const t2 = t * t, t3 = t2 * t;
    const x = 0.5 * ((2 * x1) + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
    const z = 0.5 * ((2 * z1) + (-z0 + z2) * t + (2 * z0 - 5 * z1 + 4 * z2 - z3) * t2 + (-z0 + 3 * z1 - 3 * z2 + z3) * t3);
    const dx = 0.5 * ((-x0 + x2) + 2 * (2 * x0 - 5 * x1 + 4 * x2 - x3) * t + 3 * (-x0 + 3 * x1 - 3 * x2 + x3) * t2);
    const dz = 0.5 * ((-z0 + z2) + 2 * (2 * z0 - 5 * z1 + 4 * z2 - z3) * t + 3 * (-z0 + 3 * z1 - 3 * z2 + z3) * t2);
    const len = Math.hypot(dx, dz) || 1;
    return { x, z, tx: dx / len, tz: dz / len };
}

const STEP = 5, PAD_N = 14;
const CORRIDOR_OFF = -18.08;
const COLORS = ['#e91e63', '#3f51b5', '#009688', '#ff5722', '#8bc34a', '#673ab7', '#00bcd4', '#ffc107',
    '#795548', '#607d8b', '#f44336', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#cddc39'];

// Platform track-spacing = the REAL perpendicular distance between the two running tracks at
// each platform, measured directly from the OSM geojson (scratch/measure_gap.mjs: nearest point
// on each of the two distinct running ways to the platform centroid, then their separation).
// Single uniform value per station -> a rectangular platform (the old [start,end] pairs made a
// visibly WEDGE-shaped platform, e.g. Wöhrder Wiese 13.85->12.69). Cross-checked against the
// platform way's own perpendicular width + ~3.08 m track-occupancy and they agree for every
// station with clean data. Trunk stations (Rothenburger..Rathenauplatz) share ONE value across
// both lines since they are the same physical platform.
//   * No OSM platform way in the source: Hohe Marter, Opernhaus, Hauptbahnhof, Klinikum Nord ->
//     a sane branch-typical value is kept/assigned instead of a measurement.
//   * Nordwestring is a terminus where the two tracks pinch at the turnback (raw track gap 7.87
//     is not the platform gap); use platform-width + occupancy (~10.5) instead.
const U2_STATION_SPACINGS = {
    'Röthenbach': 11.87,
    'Hohe Marter': 11.89,           // no OSM platform way -> keep
    'Schweinau': 11.28,
    'St. Leonhard': 10.51,
    'Rothenburger Straße': 12.65,   // trunk (shared with U3)
    'Plärrer': 7.06,                // bespoke stacked station
    'Opernhaus': 11.42,             // trunk, no OSM way -> keep
    'Hauptbahnhof': 12.00,          // trunk, no OSM way -> keep
    'Wöhrder Wiese': 13.81,         // trunk
    'Rathenauplatz': 11.76,         // trunk
    'Rennweg': 10.23,
    'Schoppershof': 11.07,
    'Nordostbahnhof': 11.82,
    'Herrnhütte': 12.25,
    'Ziegelstein': 12.45,
    'Flughafen': 12.22
};

const U3_STATION_SPACINGS = {
    'Grossreuth bei Schweinau': 10.93,
    'Gustav-Adolf-Straße': 9.40,
    'Sündersbühl': 10.26,
    'Rothenburger Straße': 12.65,   // trunk (shared with U2)
    'Plärrer': 7.06,                // bespoke stacked station
    'Opernhaus': 11.42,             // trunk, no OSM way -> keep
    'Hauptbahnhof': 12.00,          // trunk, no OSM way -> keep
    'Wöhrder Wiese': 13.81,         // trunk
    'Rathenauplatz': 11.76,         // trunk
    'Maxfeld': 10.13,
    'Kaulbachplatz': 10.11,
    'Friedrich-Ebert-Platz': 14.65,
    'Klinikum Nord': 11.00,         // no OSM platform way -> branch-typical
    'Nordwestring': 10.50           // terminus: tracks pinch, use platform-width + occupancy
};

function Smoothstep(t) {
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t * t * (3 - 2 * t);
}

function snapStationSpacingsU1(gap, stations, spacings, step = 5, transitionLen = 50) {
    const newGap = gap.slice();
    const N = gap.length;
    const tr = Math.round(transitionLen / step); // 50 / 5 = 10 samples
    
    stations.forEach(s => {
        const target = spacings[s.name];
        if (target === undefined) return;
        
        let startVal = target;
        let endVal = target;
        if (Array.isArray(target)) {
            startVal = target[0];
            endVal = target[1];
        }
        
        const idx = Math.round(s.position / step);
        const half = Math.round(s.halfLength / step);
        
        const loE = Math.max(0, idx - half - tr);
        const hiE = Math.min(N - 1, idx + half + tr);
        
        const baseLo = newGap[loE];
        const baseHi = newGap[hiE];
        
        const span = 2 * half || 1;
        
        for (let k = loE; k <= hiE; k++) {
            if (k >= idx - half && k <= idx + half) {
                const t = (k - (idx - half)) / span;
                newGap[k] = startVal + (endVal - startVal) * t;
            } else if (k < idx - half) {
                const t = Smoothstep((k - loE) / tr);
                newGap[k] = baseLo + (startVal - baseLo) * t;
            } else {
                const t = Smoothstep((hiE - k) / tr);
                newGap[k] = baseHi + (endVal - baseHi) * t;
            }
        }
    });
    
    return newGap;
}


// ---------------------------------------------------------------------------------------
// Per-line pipeline: load geojson -> Dijkstra through-route per station pair -> nearest-
// neighbour midline+gap harvest (same physical-track-pairing idea as U1's two GPS relations,
// just via geometric search since this OSM source has no ready-made second relation) ->
// rigid registration into the world (Plärrer corridor anchor, direction FLIPPED so
// Röthenbach/Grossreuth lie toward Fürth/Hardhöhe) -> single-pass smoothing exactly like
// U1's gen_centerline.ps1 -> 5m resample + pads -> station/halfLength/side/gap finalize.
// ---------------------------------------------------------------------------------------
function processLine(geojsonFile, stationNames, givenDist, lineId, sharedAnchor) {
    console.log(`\n=== ${lineId} (${geojsonFile}) ===`);
    const geo = JSON.parse(fs.readFileSync(geojsonFile, 'utf8'));
    const baseTrackWays = [], platformWays = [];
    for (const f of geo.features) {
        if (f.geometry.type !== 'LineString') continue;
        const coords = f.geometry.coordinates.map(([lon, lat]) => project(lon, lat));
        const p = f.properties;
        if (p.railway === 'subway') {
            baseTrackWays.push({ id: p['@id'], name: p.name || '', service: p.service || '', coords, len: wayLen(coords) });
        } else if (p.railway === 'platform' || p.railway === 'platform_edge') {
            platformWays.push({ id: p['@id'], name: p.name || '', desc: p.description || '', coords });
        }
    }
    console.log(`  Loaded ${baseTrackWays.length} track ways (${baseTrackWays.filter(w => w.service).length} service), ${platformWays.length} platform ways.`);

    function stripGleisSuffix(s) { return s.replace(/\s+(U[- ]?Bahn(?:station)?\s+)?Gleis\s*\d+.*$/i, '').trim(); }
    function platformWaysFor(name) {
        let ways = platformWays.filter(p => p.name === name);
        if (!ways.length) ways = platformWays.filter(p => stripGleisSuffix(p.desc) === name);
        return ways;
    }
    function platformCentroid(name) {
        const ways = platformWaysFor(name);
        if (!ways.length) return null;
        let sx = 0, sy = 0, n = 0;
        for (const w of ways) for (const c of w.coords) { sx += c[0]; sy += c[1]; n++; }
        return [sx / n, sy / n];
    }
    function candidatesFor(pt, radius = 40, maxCandidates = 4) {
        const all = [];
        baseTrackWays.forEach((w, wi) => {
            if (w.service) return;
            for (let i = 0; i < w.coords.length - 1; i++) {
                const A = w.coords[i], B = w.coords[i + 1];
                const vx = B[0] - A[0], vy = B[1] - A[1];
                const len2 = vx * vx + vy * vy;
                let t = len2 > 0 ? ((pt[0] - A[0]) * vx + (pt[1] - A[1]) * vy) / len2 : 0;
                t = Math.max(0, Math.min(1, t));
                const qx = A[0] + vx * t, qy = A[1] + vy * t;
                const d = Math.hypot(pt[0] - qx, pt[1] - qy);
                if (d <= radius) all.push({ d, wayIdx: wi, segIdx: i, t, pt: [qx, qy] });
            }
        });
        all.sort((a, b) => a.d - b.d);
        const out = [];
        for (const c of all) {
            if (out.some(o => Math.hypot(o.pt[0] - c.pt[0], o.pt[1] - c.pt[1]) < 3)) continue;
            out.push(c);
            if (out.length >= maxCandidates) break;
        }
        return out;
    }

    const stationCandidates = new Map();
    for (const name of stationNames) {
        const c = platformCentroid(name);
        stationCandidates.set(name, c && c.length ? candidatesFor(c) : null);
    }
    console.log('  Station -> candidate track points:');
    for (const [name, cs] of stationCandidates) {
        console.log(`    ${name.padEnd(28)} ${cs && cs.length ? cs.map(c => `d=${c.d.toFixed(1)}m`).join(', ') : 'NO PLATFORM DATA'}`);
    }

    function buildGraphWithCuts(cuts) {
        const cutsByWay = new Map();
        cuts.forEach((c, ci) => {
            if (!cutsByWay.has(c.wayIdx)) cutsByWay.set(c.wayIdx, []);
            cutsByWay.get(c.wayIdx).push({ segIdx: c.segIdx, t: c.t, ci });
        });
        const ways = [];
        const cutKeys = new Array(cuts.length);
        baseTrackWays.forEach((w, wi) => {
            const wCuts = cutsByWay.get(wi);
            if (!wCuts) { ways.push(w); return; }
            let coordsAcc = [w.coords[0]];
            const emit = () => { if (coordsAcc.length >= 2) ways.push({ id: w.id, name: w.name, service: w.service, coords: coordsAcc.slice(), len: wayLen(coordsAcc) }); };
            for (let seg = 0; seg < w.coords.length - 1; seg++) {
                const A = w.coords[seg], B = w.coords[seg + 1];
                const segCuts = wCuts.filter(c => c.segIdx === seg).sort((a, b) => a.t - b.t);
                for (const c of segCuts) {
                    const qx = A[0] + (B[0] - A[0]) * c.t, qy = A[1] + (B[1] - A[1]) * c.t;
                    const cutPt = [qx, qy];
                    coordsAcc.push(cutPt);
                    emit();
                    coordsAcc = [cutPt];
                    cutKeys[c.ci] = keyOf(cutPt);
                }
                coordsAcc.push(B);
            }
            emit();
        });
        const adj = new Map();
        function addNode(pt) { const k = keyOf(pt); if (!adj.has(k)) adj.set(k, []); return k; }
        ways.forEach((w, idx) => {
            const a = addNode(w.coords[0]), b = addNode(w.coords[w.coords.length - 1]);
            adj.get(a).push({ to: b, wayIdx: idx, forward: true });
            adj.get(b).push({ to: a, wayIdx: idx, forward: false });
        });
        return { adj, ways, cutKeys };
    }
    function edgeCost(w) { return w.len * (w.service ? 4 : 1); }
    function dijkstra(adj, ways, startK, endK) {
        const dist = new Map([[startK, 0]]);
        const prev = new Map();
        const visited = new Set();
        while (true) {
            let uK = null, uD = Infinity;
            for (const [k, d] of dist) if (!visited.has(k) && d < uD) { uD = d; uK = k; }
            if (uK === null) return null;
            if (uK === endK) break;
            visited.add(uK);
            for (const e of (adj.get(uK) || [])) {
                const nd = uD + edgeCost(ways[e.wayIdx]);
                if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: uK, edge: e }); }
            }
        }
        const edges = [];
        let cur = endK;
        while (cur !== startK) {
            const p = prev.get(cur);
            if (!p) return null;
            edges.unshift(p.edge);
            cur = p.from;
        }
        return edges;
    }
    function pathLen(ways, edges) { return edges.reduce((s, e) => s + ways[e.wayIdx].len, 0); }
    function pathPolyline(ways, edges) {
        const pts = [];
        for (const e of edges) {
            const w = ways[e.wayIdx];
            const seq = e.forward ? w.coords : w.coords.slice().reverse();
            if (pts.length && Math.hypot(pts[pts.length - 1][0] - seq[0][0], pts[pts.length - 1][1] - seq[0][1]) < 0.01) pts.push(...seq.slice(1));
            else pts.push(...seq);
        }
        return pts;
    }
    function bestPath(nameA, nameB) {
        const CA = stationCandidates.get(nameA), CB = stationCandidates.get(nameB);
        let best = null;
        for (const ca of CA) for (const cb of CB) {
            const { adj, ways, cutKeys } = buildGraphWithCuts([ca, cb]);
            const edges = dijkstra(adj, ways, cutKeys[0], cutKeys[1]);
            if (!edges) continue;
            const len = pathLen(ways, edges);
            if (!best || len < best.len) best = { len, edges, ways, ca, cb };
        }
        return best;
    }

    // ---- through-route ----
    const knownIdx = [];
    stationNames.forEach((n, i) => { if (stationCandidates.get(n)?.length) knownIdx.push(i); });
    const segReports = [];
    const fullPolyline = [];
    const stationArc = new Map();
    let arcBase = 0;
    for (let k = 0; k < knownIdx.length - 1; k++) {
        const i0 = knownIdx[k], i1 = knownIdx[k + 1];
        const found = bestPath(stationNames[i0], stationNames[i1]);
        if (!found) { console.log(`    NO PATH ${stationNames[i0]} -> ${stationNames[i1]}`); continue; }
        const totalGiven = givenDist.slice(i0, i1).reduce((a, b) => a + b, 0);
        segReports.push({ from: stationNames[i0], to: stationNames[i1], given: totalGiven, got: found.len });
        const poly = pathPolyline(found.ways, found.edges);
        if (fullPolyline.length) fullPolyline.push(...poly.slice(1)); else fullPolyline.push(...poly);
        let cum = 0;
        for (let i = i0; i <= i1; i++) {
            if (i > i0) cum += givenDist[i - 1];
            const frac = totalGiven > 0 ? cum / totalGiven : 0;
            stationArc.set(stationNames[i], arcBase + frac * found.len);
        }
        arcBase += found.len;
    }
    console.log('  Distance validation (given vs shortest path):');
    for (const r of segReports) {
        const pct = ((r.got - r.given) / r.given * 100).toFixed(1);
        console.log(`    ${r.from.padEnd(24)} -> ${r.to.padEnd(24)} given=${r.given}m got=${r.got.toFixed(1)}m (${pct}%)`);
    }
    console.log(`  Total raw length: ${arcBase.toFixed(1)}m, ${stationArc.size} stations placed.`);

    // ---- midline + gap harvest: true midpoint of the own path and its nearest parallel
    // partner track (same physical-pair idea as U1's two GPS relations; found geometrically
    // since this source has no ready-made second relation). Per-station-segment side voting
    // keeps the partner choice from flip-flopping mid-segment. ----
    const SAMPLE = 2.5;
    const { pts: samples } = resamplePolyline(fullPolyline, SAMPLE);
    const n = samples.length;
    const tang = [];
    for (let i = 0; i < n; i++) {
        const a = samples[Math.max(0, i - 1)], b = samples[Math.min(n - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        tang.push([dx / l, dy / l]);
    }
    const partners = baseTrackWays.filter(w => !w.service);
    const boxes = partners.map(w => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of w.coords) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }
        return [x0 - 30, y0 - 30, x1 + 30, y1 + 30];
    });
    const MIN_G = 4.2, MAX_G = 22;
    const rawGap = new Array(n).fill(null);
    const rawSide = new Array(n).fill(0);
    const partnerPt = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        const P = samples[i], T = tang[i];
        let pick = null;
        for (let wi = 0; wi < partners.length; wi++) {
            const bb = boxes[wi];
            if (P[0] < bb[0] || P[0] > bb[2] || P[1] < bb[1] || P[1] > bb[3]) continue;
            const w = partners[wi];
            for (let s = 0; s < w.coords.length - 1; s++) {
                const A = w.coords[s], B = w.coords[s + 1];
                const vx = B[0] - A[0], vy = B[1] - A[1];
                const len2 = vx * vx + vy * vy;
                if (len2 < 1e-6) continue;
                let t = ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / len2;
                t = Math.max(0, Math.min(1, t));
                const qx = A[0] + vx * t, qy = A[1] + vy * t;
                const d = Math.hypot(P[0] - qx, P[1] - qy);
                if (d < MIN_G || d > MAX_G) continue;
                if (pick && d >= pick.d) continue;
                const wl = Math.hypot(vx, vy);
                const dot = Math.abs((vx / wl) * T[0] + (vy / wl) * T[1]);
                if (dot < 0.8) continue;
                pick = { d, qx, qy };
            }
        }
        if (!pick) continue;
        rawGap[i] = pick.d;
        partnerPt[i] = [pick.qx, pick.qy];
        const ox = pick.qx - P[0], oy = pick.qy - P[1];
        rawSide[i] = Math.sign(T[0] * oy - T[1] * ox) || 0;
    }
    const valid = rawGap.filter(g => g !== null).length;
    console.log(`  partner found for ${valid}/${n} samples.`);

    const segBounds = [...stationArc.values()].sort((a, b) => a - b);
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
    const segOf = (arc) => {
        for (let k = 0; k < segBounds.length - 1; k++) if (arc <= segBounds[k + 1]) return k;
        return segBounds.length - 2;
    };
    const nSegs = segBounds.length - 1;
    const segVotes = Array.from({ length: nSegs }, () => ({ pos: 0, neg: 0 }));
    for (let i = 0; i < n; i++) {
        if (rawGap[i] === null) continue;
        const v = segVotes[Math.max(0, Math.min(nSegs - 1, segOf(cum[i])))];
        if (rawSide[i] > 0) v.pos++; else if (rawSide[i] < 0) v.neg++;
    }
    const segSide = segVotes.map(v => (v.pos || v.neg) ? (v.pos >= v.neg ? 1 : -1) : 0);
    for (let k = 0; k < nSegs; k++) if (segSide[k] === 0) segSide[k] = k > 0 ? segSide[k - 1] : 1;
    for (let i = 0; i < n; i++) {
        if (rawGap[i] === null) continue;
        const side = segSide[Math.max(0, Math.min(nSegs - 1, segOf(cum[i])))];
        if (rawSide[i] !== side) { rawGap[i] = null; partnerPt[i] = null; }
    }
    let last = null;
    for (let i = 0; i < n; i++) { if (rawGap[i] === null) rawGap[i] = last; else last = rawGap[i]; }
    last = null;
    for (let i = n - 1; i >= 0; i--) { if (rawGap[i] === null) rawGap[i] = last ?? 10.12; else last = rawGap[i]; }
    const med = rawGap.slice();
    for (let i = 0; i < n; i++) {
        const win = [];
        for (let k = -4; k <= 4; k++) { const j = i + k; if (j >= 0 && j < n) win.push(rawGap[j]); }
        win.sort((a, b) => a - b);
        med[i] = win[Math.floor(win.length / 2)];
    }
    let gapDense = med.slice();
    for (let pass = 0; pass < 2; pass++) {
        const src = gapDense.slice();
        for (let i = 0; i < n; i++) {
            let s = 0, w = 0;
            for (let k = -6; k <= 6; k++) { const j = i + k; if (j >= 0 && j < n) { s += src[j]; w++; } }
            gapDense[i] = s / w;
        }
    }
    const midPts = [];
    for (let i = 0; i < n; i++) {
        const P = samples[i], T = tang[i];
        if (partnerPt[i]) {
            midPts.push([(P[0] + partnerPt[i][0]) / 2, (P[1] + partnerPt[i][1]) / 2, gapDense[i]]);
        } else {
            const side = segSide[Math.max(0, Math.min(nSegs - 1, segOf(cum[i])))];
            midPts.push([P[0] - T[1] * side * gapDense[i] / 2, P[1] + T[0] * side * gapDense[i] / 2, gapDense[i]]);
        }
    }
    const midXY = midPts.map(p => [p[0], p[1]]);
    const stationArcMid = new Map();
    for (const [name, arc] of stationArc) {
        const pt = pointAtArc(fullPolyline, arc);
        stationArcMid.set(name, projectToPolyline(midXY, pt).arc);
    }

    // ---- rigid registration into the world: this line's raw Plärrer position/tangent is
    // rotated+translated so it lands exactly on U1's Gleis 3/4 corridor point/tangent. Direction
    // is FLIPPED (Röthenbach/Grossreuth lie toward Fürth/Hardhöhe, i.e. opposite to U1's
    // increasing arc at Plärrer). Each line's OWN geometry/smoothing/gap harvest still runs
    // fully independently -- but computing theta INDEPENDENTLY per line turned out to not be
    // "simply overlaying": U2's and U3's own tangent estimates at Plärrer differed by a few
    // degrees (real noise between two independently-exported OSM files, not something a wider
    // averaging window fixes), and since this angle drives a RIGID ROTATION of the whole line,
    // even 3deg of mismatch drifts to 100+m apart by Rathenauplatz (tan(3deg)*1700m ~ 90m) --
    // exactly the divergence observed. So the FIRST line to register (U2) computes its own
    // theta/T and returns it; the caller passes that same transform in for U3 (`sharedAnchor`),
    // which keeps both lines' shapes independent while removing the spurious extra rotation.
    const cAtP = sampleU1(U1_PLAERRER_POS);
    const anchorPos = [cAtP.x + (-cAtP.tz) * CORRIDOR_OFF, cAtP.z + (cAtP.tx) * CORRIDOR_OFF];
    const anchorTan = [-cAtP.tx, -cAtP.tz];
    function tangentOfPts(poly, s, h = 10) {
        const a = pointAtArc(poly, Math.max(0, s - h)), b = pointAtArc(poly, s + h);
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        return [dx / len, dy / len];
    }
    let thetaFix, T;
    if (sharedAnchor) {
        ({ thetaFix, T } = sharedAnchor);
    } else {
        const rawPlaerrerArc = stationArcMid.get('Plärrer');
        const rawPlaerrerPos = pointAtArc(midXY, rawPlaerrerArc);
        const rawPlaerrerTan = tangentOfPts(midXY, rawPlaerrerArc, 60);
        thetaFix = Math.atan2(anchorTan[1], anchorTan[0]) - Math.atan2(rawPlaerrerTan[1], rawPlaerrerTan[0]);
        const ct0 = Math.cos(thetaFix), st0 = Math.sin(thetaFix);
        const rotatedAnchorSrc = [rawPlaerrerPos[0] * ct0 - rawPlaerrerPos[1] * st0, rawPlaerrerPos[0] * st0 + rawPlaerrerPos[1] * ct0];
        T = [anchorPos[0] - rotatedAnchorSrc[0], anchorPos[1] - rotatedAnchorSrc[1]];
    }
    const ct = Math.cos(thetaFix), st = Math.sin(thetaFix);
    function rot(pt) { return [pt[0] * ct - pt[1] * st, pt[0] * st + pt[1] * ct]; }
    function toWorld(pt) { const r = rot(pt); return [r[0] + T[0], r[1] + T[1]]; }
    console.log(`  Anchor: theta=${(thetaFix * 180 / Math.PI).toFixed(2)}deg T=(${T[0].toFixed(2)},${T[1].toFixed(2)})${sharedAnchor ? ' (shared from U2)' : ''}`);

    // ---- single-pass reconstruction, exactly like U1's gen_centerline.ps1: dense grid ->
    // median pre-filter -> box-filter smooth -> 5m arc resample + straight end pads. No trunk
    // splicing/isolation needed any more -- one clean pass over the whole route. ----
    const worldMid = midPts.map(p => toWorld(p));
    const gapByIdx = midPts.map(p => p[2]);
    const dense = resamplePolyline(worldMid, 3);
    const smoothed = smoothXY(medianXY(dense.pts, 3), 4, 11);
    const core = resamplePolyline(smoothed, STEP);
    const corePts = core.pts;
    const Ncore = corePts.length;
    const sdx = corePts[1][0] - corePts[0][0], sdy = corePts[1][1] - corePts[0][1];
    const sl = Math.hypot(sdx, sdy) || 1;
    const edx = corePts[Ncore - 1][0] - corePts[Ncore - 2][0], edy = corePts[Ncore - 1][1] - corePts[Ncore - 2][1];
    const el = Math.hypot(edx, edy) || 1;
    const cx = [], cz = [];
    for (let i = PAD_N; i > 0; i--) { cx.push(corePts[0][0] - sdx / sl * i * STEP); cz.push(corePts[0][1] - sdy / sl * i * STEP); }
    for (const p of corePts) { cx.push(p[0]); cz.push(p[1]); }
    for (let i = 1; i <= PAD_N; i++) { cx.push(corePts[Ncore - 1][0] + edx / el * i * STEP); cz.push(corePts[Ncore - 1][1] + edy / el * i * STEP); }
    const total = (cx.length - 1) * STEP;
    let paddedPts = cx.map((x, i) => [x, cz[i]]);

    // ---- stations: re-anchor onto the padded centerline. `rawArc` is already an exact arc-
    // length position within `worldMid` (toWorld is rigid, doesn't change arc lengths), and
    // box-filter smoothing barely changes total length, so scaling by core.L/dense.L (the
    // reconstruction's own measured length ratio, NOT the unrelated raw Dijkstra-path length)
    // gives an accurate final-domain estimate -- a generous +-400m window around it then
    // disambiguates the S-bend nearest-point ambiguity. ----
    const stations = [];
    for (const name of stationNames) {
        const rawArc = stationArcMid.get(name);
        if (rawArc === undefined) { console.log(`    !! no arc for ${name}`); continue; }
        const worldPt = toWorld(pointAtArc(midXY, rawArc));
        const approxFinalArc = PAD_N * STEP + rawArc * (core.L / dense.L);
        const window = [Math.max(0, approxFinalArc - 400), approxFinalArc + 400];
        const proj = projectToPolyline(paddedPts, worldPt, window, STEP);
        stations.push({ name, position: Math.round(proj.arc * 100) / 100, projDist: proj.dist });
    }

    // ---- Plärrer corridor override (FLIPPED direction: increasing own arc == decreasing U1 arc) ----
    const plaerrerArc = stations.find(s => s.name === 'Plärrer').position;
    const HARD = U1_PLAERRER_HALFLEN + 20, BLEND = 150;
    for (let i = 0; i < cx.length; i++) {
        const arc = i * STEP;
        const distFromPl = Math.abs(arc - plaerrerArc);
        if (distFromPl > HARD + BLEND) continue;
        const dU1 = U1_PLAERRER_POS - (arc - plaerrerArc);
        const c = sampleU1(dU1);
        const overrideX = c.x + (-c.tz) * CORRIDOR_OFF;
        const overrideZ = c.z + (c.tx) * CORRIDOR_OFF;
        if (distFromPl <= HARD) {
            cx[i] = overrideX; cz[i] = overrideZ;
        } else {
            const t = (distFromPl - HARD) / BLEND;
            const sm = t * t * (3 - 2 * t);
            cx[i] = overrideX * (1 - sm) + cx[i] * sm;
            cz[i] = overrideZ * (1 - sm) + cz[i] * sm;
        }
    }
    paddedPts = cx.map((x, i) => [x, cz[i]]);

    // ---- gap per final 5m sample: project onto the raw (pre-reconstruction) midline, look up
    // the harvested gap there, then a dedicated smoothing pass (rails sit +-gap/2 off the
    // centerline, so gap noise is much more visible than the same noise in the centerline). ----
    const rawCum = [0];
    for (let i = 1; i < worldMid.length; i++) rawCum.push(rawCum[i - 1] + Math.hypot(worldMid[i][0] - worldMid[i - 1][0], worldMid[i][1] - worldMid[i - 1][1]));
    let gap = [];
    for (let i = 0; i < cx.length; i++) {
        const proj = projectToPolyline(worldMid, [cx[i], cz[i]]);
        let lo = 0, hi = rawCum.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (rawCum[mid] < proj.arc) lo = mid + 1; else hi = mid; }
        const idx = Math.max(1, lo);
        const t = (proj.arc - rawCum[idx - 1]) / ((rawCum[idx] - rawCum[idx - 1]) || 1);
        const g = gapByIdx[idx - 1] + (gapByIdx[idx] - gapByIdx[idx - 1]) * Math.max(0, Math.min(1, t));
        gap.push(g);
    }
    for (let pass = 0; pass < 3; pass++) {
        const src = gap.slice();
        gap = gap.map((_, i) => {
            let s = 0, w = 0;
            for (let k = -6; k <= 6; k++) { const j = i + k; if (j >= 0 && j < src.length) { s += src[j]; w++; } }
            return s / w;
        });
    }
    gap = gap.map(g => Math.round(g * 100) / 100);

    // ---- station halfLength + side flag from platform ways ----
    const stationsFull = stations.map((s, i) => {
        let halfLength = 45.16, side = false, medLat = null;
        const ways = platformWaysFor(s.name);
        if (ways.length && s.name !== 'Plärrer') {
            let minArc = Infinity, maxArc = -Infinity;
            const lats = [];
            for (const w of ways) {
                const projPts = w.coords.map(c => projectToPolyline(paddedPts, toWorld(c), null, STEP));
                const cenDist = projPts.reduce((a, p) => a + p.dist, 0) / projPts.length;
                if (cenDist > 20) continue;
                for (const p of projPts) {
                    minArc = Math.min(minArc, p.arc);
                    maxArc = Math.max(maxArc, p.arc);
                    lats.push(p.dist);
                }
            }
            if (lats.length) {
                const hl = (maxArc - minArc) / 2;
                if (hl > 30 && hl < 80) halfLength = Math.round(Math.min(62, Math.max(40, hl)) * 100) / 100;
                lats.sort((a, b) => a - b);
                medLat = lats[Math.floor(lats.length / 2)];
            }
        }
        if (s.name === 'Plärrer') halfLength = U1_PLAERRER_HALFLEN;
        // All U2/U3 stations are island platforms (side: false)
        return { name: s.name, type: 'underground', color: COLORS[i % COLORS.length], position: s.position, halfLength, side: false, medLat };
    });

    // Enforce accurate station spacings and blend smoothly with tunnels
    const spacings = lineId === 'U2' ? U2_STATION_SPACINGS : U3_STATION_SPACINGS;
    gap = snapStationSpacingsU1(gap, stationsFull, spacings, STEP);
    gap = gap.map(g => Math.round(g * 100) / 100);

    console.log(`  ${lineId}: total=${total}m (${cx.length} samples), Plärrer arc=${plaerrerArc}m`);
    for (const s of stationsFull) {
        const g = gap[Math.round(s.position / STEP)];
        const raw = stations.find(q => q.name === s.name);
        console.log(`    ${s.name.padEnd(28)} pos=${String(s.position).padEnd(9)} halfLen=${String(s.halfLength).padEnd(6)} side=${s.side ? 'YES' : 'no '} gap=${g} medLat=${s.medLat === null ? '-' : s.medLat.toFixed(1)} projDist=${raw ? raw.projDist.toFixed(2) : '?'}`);
    }

    return {
        lineLabel: lineId, step: STEP, total, baseSpacing: 10.12, cx, cz, gap,
        stations: stationsFull,
        elevationZones: [{ end: total, type: 'underground' }],
        anchor: { thetaFix, T }
    };
}

const U2_STATIONS = ['Röthenbach', 'Hohe Marter', 'Schweinau', 'St. Leonhard', 'Rothenburger Straße', 'Plärrer',
    'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz', 'Rennweg', 'Schoppershof',
    'Nordostbahnhof', 'Herrnhütte', 'Ziegelstein', 'Flughafen'];
const U2_DIST = [1317, 684, 517, 762, 970, 766, 533, 767, 525, 611, 650, 902, 835, 945, 2388];

const U3_STATIONS = ['Grossreuth bei Schweinau', 'Gustav-Adolf-Straße', 'Sündersbühl', 'Rothenburger Straße', 'Plärrer',
    'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz', 'Maxfeld', 'Kaulbachplatz',
    'Friedrich-Ebert-Platz', 'Klinikum Nord', 'Nordwestring'];
const U3_DIST = [898, 607, 929, 970, 766, 533, 767, 525, 963, 453, 553, 534, 713];

const u2Track = processLine('railsplineU2.geojson', U2_STATIONS, U2_DIST, 'U2');
const u3TrackRaw = processLine('railsplineU3.geojson', U3_STATIONS, U3_DIST, 'U3', u2Track.anchor);

// ---------------------------------------------------------------------------------------
// Shared trunk splice: U2 and U3 physically run on the SAME two rails between Rothenburger
// Straße and Rathenauplatz -- sharing only a rigid registration (as above) got them within
// 6-10m of each other there, close but not identical, which left the switches (where
// buildJunction measures how far the other line's real track has drifted) without a clean
// flush connection. Grafting U2's ALREADY-SMOOTHED trunk polyline directly into U3's ALREADY-
// SMOOTHED route -- unlike the earlier splice-before-smoothing attempt, which had to isolate
// three pieces mid-pipeline and left an under-smoothed kink at each piece boundary -- makes
// the trunk byte-identical with only a small local blend at the two splice seams, well inside
// the switch throat margin.
// ---------------------------------------------------------------------------------------
const TRUNK_STATIONS = ['Rothenburger Straße', 'Plärrer', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];
// The old "must stay well clear of the real switch" constraint no longer applies: the switch
// geometry is now a separate, hand-authored piece (TrackManager.buildSwitchTransition) that
// doesn't read these centerlines past the platform at all, so there's no risk of re-creating
// the old "wild switch" bug by extending this splice further out. It just needs to comfortably
// cover the bespoke piece's own entry point (platform halfLength + 5m, up to ~51m).
const TRUNK_MARGIN = 130;

// Hard insertion + box-filter blend (first attempt) left a real ~9-18m position jump right at
// the blend window's OUTER edge: a plain box average mixes far-apart raw values without any
// taper, so the very first blended sample swings hard toward the (very different) far side
// while its untouched neighbour one index earlier stays put -- a genuine discontinuity, not
// just residual roughness. Fixed by never inserting/deleting samples at all: keep secondary's
// own array length and arc grid, and within the trunk zone replace each sample's VALUE with a
// weighted crossfade between secondary's own point and primary's trunk curve resampled onto
// that same arc (via a simple arc offset, primary and secondary trunks are within ~2.5m of the
// same length so no scale correction is needed). The weight is a smoothstep ramp (0->1) over a
// wide margin, so there is no hard edge anywhere -- true trunk-identical only in the core,
// tapering smoothly into each line's own approach track outside it.
function spliceSharedTrunk(primary, secondary) {
    const trunkRange = (td) => {
        const positions = TRUNK_STATIONS.map(nm => td.stations.find(s => s.name === nm).position);
        return [Math.min(...positions) - TRUNK_MARGIN, Math.max(...positions) + TRUNK_MARGIN];
    };
    const [loA] = trunkRange(primary);
    const [loB, hiB] = trunkRange(secondary);
    const iLoB = Math.max(0, Math.round(loB / secondary.step));
    const iHiB = Math.min(secondary.cx.length - 1, Math.round(hiB / secondary.step));

    function samplePrimary(arc) {
        const u = Math.max(0, Math.min(primary.cx.length - 2, arc / primary.step));
        const i = Math.floor(u), t = u - i;
        return [
            primary.cx[i] + (primary.cx[i + 1] - primary.cx[i]) * t,
            primary.cz[i] + (primary.cz[i + 1] - primary.cz[i]) * t,
            primary.gap[i] + (primary.gap[i + 1] - primary.gap[i]) * t
        ];
    }
    function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

    // The full-identical (w=1) core must reach past each boundary station's platform edge PLUS
    // the switch piece's own entry point (halfLength+5m, up to ~51m) so the secondary line stays
    // glued to the shared, wall-mounted station structure there (otherwise it drifts and the
    // train clips the station wall, or the switch piece's two entry frames disagree). The two
    // lines are independent GPS surveys of the SAME shared track that sit ~6-9m apart even on
    // the corridor, so the crossfade back to the secondary's own survey has to absorb that
    // offset -- doing so over too short a span makes it a sharp curvature kink. BLEND=13 (65m)
    // with TRUNK_MARGIN=130 keeps the w=1 core to ~center+65m (comfortably past the ~51m entry
    // point) and tapers the remaining 65m out to center+130m -- well before the switch piece's
    // own exit sampling point (up to ~300m), so its exit frames read genuinely independent data.
    const BLEND = 13;
    const newCx = secondary.cx.slice(), newCz = secondary.cz.slice(), newGap = secondary.gap.slice();
    for (let i = iLoB; i <= iHiB; i++) {
        const s = i * secondary.step;
        const [px, pz, pg] = samplePrimary(loA + (s - loB));
        const w = Math.min(smoothstep((i - iLoB) / BLEND), smoothstep((iHiB - i) / BLEND));
        newCx[i] = secondary.cx[i] * (1 - w) + px * w;
        newCz[i] = secondary.cz[i] * (1 - w) + pz * w;
        newGap[i] = secondary.gap[i] * (1 - w) + pg * w;
    }

    // Trunk stations: exact world position from primary, mapped by the same arc offset (their
    // platform is literally the same physical structure -- lands in the fully-blended w=1 core
    // since stations sit TRUNK_MARGIN=110m inside the window, well past the 75m taper).
    const newStations = secondary.stations.map(s => {
        if (!TRUNK_STATIONS.includes(s.name)) return s;
        const ps = primary.stations.find(q => q.name === s.name);
        const secondaryArc = loB + (ps.position - loA);
        return { ...s, position: Math.round(secondaryArc * 100) / 100, halfLength: ps.halfLength, side: ps.side };
    });

    console.log(`  Blended ${primary.lineLabel}'s trunk into ${secondary.lineLabel} over arc index [${iLoB}..${iHiB}] (${BLEND * secondary.step}m taper each side)`);
    return { ...secondary, cx: newCx, cz: newCz, gap: newGap.map(g => Math.round(g * 100) / 100), stations: newStations };
}

const u3Track = spliceSharedTrunk(u2Track, u3TrackRaw);

// NOTE: the switch/Weiche geometry where U2 and U3 diverge (Rothenburger Straße /
// Rathenauplatz) is no longer derived here from the two independent GPS surveys -- that
// repeatedly produced kinked, inconsistent-looking switches. It's now a single, hand-authored
// bespoke piece shared between both lines: TrackManager.buildSwitchTransition (built once in
// main.js, exactly like the Plärrer hall). This file only needs to produce each line's own,
// independent running centerline/stations; nothing here feeds the switch geometry any more.
function sampleTrack(td, dist) {
    const cx = td.cx, cz = td.cz, n = cx.length;
    if (dist < 0) dist = 0;
    if (dist > td.total) dist = td.total;
    const u = dist / td.step;
    let i = Math.floor(u);
    if (i < 0) i = 0;
    if (i > n - 2) i = n - 2;
    const t = u - i;
    return [cx[i] + (cx[i + 1] - cx[i]) * t, cz[i] + (cz[i + 1] - cz[i]) * t];
}

// ---------------------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------------------
console.log('\n--- Sanity checks ---');
const cAtPGlobal = sampleU1(U1_PLAERRER_POS);
const anchorPosGlobal = [cAtPGlobal.x + (-cAtPGlobal.tz) * CORRIDOR_OFF, cAtPGlobal.z + (cAtPGlobal.tx) * CORRIDOR_OFF];
for (const [td, first] of [[u2Track, 'Röthenbach'], [u3Track, 'Grossreuth bei Schweinau']]) {
    const pl = td.stations.find(s => s.name === 'Plärrer');
    const f = td.stations.find(s => s.name === first);
    const pPl = sampleTrack(td, pl.position), pF = sampleTrack(td, f.position);
    const v = [pF[0] - pPl[0], pF[1] - pPl[1]];
    const dot = v[0] * cAtPGlobal.tx + v[1] * cAtPGlobal.tz;
    console.log(`  ${td.lineLabel}: ${first} is ${dot > 0 ? 'TOWARD Fürth (ok)' : 'toward Langwasser (WRONG)'} (dot=${dot.toFixed(0)})`);
    const pMid = sampleTrack(td, pl.position);
    const dx = pMid[0] - anchorPosGlobal[0], dz = pMid[1] - anchorPosGlobal[1];
    console.log(`  ${td.lineLabel}: Plärrer centerline offset from Gleis3/4 corridor anchor: ${Math.hypot(dx, dz).toFixed(2)}m`);
}
// U2<->U3 overlap on the shared trunk (informational -- no longer forced, just measured).
{
    const trunkNames = ['Rothenburger Straße', 'Plärrer', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];
    console.log('  Shared-station world positions (U2 vs U3, informational -- not forced to match):');
    for (const nm of trunkNames) {
        const a = u2Track.stations.find(s => s.name === nm), b = u3Track.stations.find(s => s.name === nm);
        if (!a || !b) { console.log(`    ${nm}: missing on one line`); continue; }
        const pa = sampleTrack(u2Track, a.position), pb = sampleTrack(u3Track, b.position);
        console.log(`    ${nm.padEnd(20)} dist=${Math.hypot(pa[0] - pb[0], pa[1] - pb[1]).toFixed(2)}m`);
    }
}

// ---------------------------------------------------------------------------------------
// Write TrackData files
// ---------------------------------------------------------------------------------------
function writeTrackDataFile(path, exportName, lineId, td, sourceFile) {
    const body = `// AUTO-GENERATED by scratch/gen_topology_u23.mjs from ${sourceFile} (independent per-line source).
// Centerline = midline of both running tracks (nearest-neighbour parallel-track harvest,
// same physical-pair idea as U1's two GPS relations), gap[] = real inter-track separation
// per 5m sample. Anchored to U1's Plärrer Gleis 3/4 corridor with the direction FLIPPED so
// ${lineId === 'U2' ? 'Röthenbach' : 'Grossreuth'} lies toward Fürth/Hardhöhe. U2 and U3 are generated fully
// independently (own geojson, own smoothing, own rigid registration) and simply overlap on
// the real shared corridor -- not forced to coincide.
// The switch where U2/U3 diverge (Rothenburger Straße/Rathenauplatz) is NOT derived from this
// data -- it's a shared, hand-authored piece built once by
// TrackManager.buildSwitchTransition (see src/main.js).
export const ${exportName} = {
  lineId: "${lineId}",
  step: ${td.step},
  total: ${td.total},
  baseSpacing: ${td.baseSpacing},
  cx: [${td.cx.map(v => Math.round(v * 100) / 100).join(',')}],
  cz: [${td.cz.map(v => Math.round(v * 100) / 100).join(',')}],
  gap: [${td.gap.join(',')}],
  stations: [
${td.stations.map(s => `    {name:"${s.name}",type:"${s.type}",color:"${s.color}",position:${s.position},halfLength:${s.halfLength},side:${s.side}},`).join('\n')}
  ],
  elevationZones: [{end: ${td.total}, type:"underground"}],
  curveSpeedZones: []
};
`;
    fs.writeFileSync(path, body, 'utf8');
    console.log(`Wrote ${path} (${(body.length / 1024).toFixed(0)} KB)`);
}
writeTrackDataFile('src/simulator/TrackDataU2.js', 'TRACK_DATA_U2', 'U2', u2Track, 'railsplineU2.geojson');
writeTrackDataFile('src/simulator/TrackDataU3.js', 'TRACK_DATA_U3', 'U3', u3Track, 'railsplineU3.geojson');

fs.writeFileSync('scratch/topology_debug.json', JSON.stringify({
    u2Stations: u2Track.stations, u3Stations: u3Track.stations,
}, null, 1));
console.log('\nWrote scratch/topology_debug.json for inspection.');
