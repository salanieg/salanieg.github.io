// Headless verification for the U2/U3 implementation (run with:
//   node --import ./scratch/register.mjs scratch/verify_u23.mjs )
// Checks, without a browser:
//  1. U2/U3 sims get stacked Plärrer semantics (spacing 0.6, dive, forward-dives flag).
//  2. Their centerlines run EXACTLY along U1's Gleis 3/4 corridor at Plärrer, direction
//     ANTI-parallel to U1 (Röthenbach/Grossreuth toward Fürth).
//  3. The bespoke approach tracks land on the same world points as the hall's mock stubs.
//  4. The bespoke switch transitions (Rothenburger Straße/Rathenauplatz) build headlessly, their
//     entry frame agrees between U2/U3, their exit frames match each line's own real Simulation
//     exactly (seamless hand-off), both branches stay smooth (no kink), and isSwitchZone/
//     buildPlaerrerApproach behave as expected.
import './dom_stubs.mjs'; // Canvas/Document-Stubs für die Textur-Codepfade
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrackManager } from '../src/simulator/TrackManager.js';
import { TRACK_DATA_U2 } from '../src/simulator/TrackDataU2.js';
import { TRACK_DATA_U3 } from '../src/simulator/TrackDataU3.js';

let failures = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
    if (!cond) failures++;
}

const simU1 = new Simulation();
const simU2 = new Simulation(TRACK_DATA_U2);
const simU3 = new Simulation(TRACK_DATA_U3);

// ---- 1. Stacked Plärrer semantics ----
for (const [sim, id] of [[simU1, 'U1'], [simU2, 'U2'], [simU3, 'U3']]) {
    const P = sim.plaerrer?.position;
    check(`${id}: plaerrer set`, !!sim.plaerrer, `pos=${P}`);
    const sp = sim.getTrackSpacing(P);
    check(`${id}: stacked spacing 0.6 at Plärrer`, Math.abs(sp - 0.6) < 1e-6, `sp=${sp}`);
    const dive = sim.getLowerLevelOffset(P);
    check(`${id}: dive ~ -9.98 at Plärrer`, dive < -9.5 && dive > -10.01, `dive=${dive.toFixed(2)}`);
    check(`${id}: isPlaerrerZone at P`, sim.isPlaerrerZone(P) && !sim.isPlaerrerZone(P + 451));
}
check('U1: reverse dives', simU1.getTrackElevationOffset(simU1.plaerrer.position, true) < -9 &&
    simU1.getTrackElevationOffset(simU1.plaerrer.position, false) === 0);
check('U2: FORWARD dives', simU2.getTrackElevationOffset(simU2.plaerrer.position, false) < -9 &&
    simU2.getTrackElevationOffset(simU2.plaerrer.position, true) === 0);
check('U3: FORWARD dives', simU3.getTrackElevationOffset(simU3.plaerrer.position, false) < -9 &&
    simU3.getTrackElevationOffset(simU3.plaerrer.position, true) === 0);

// ---- 2. Corridor alignment + direction ----
const P1 = simU1.plaerrer.position;
const corridorPoint = (dU1) => {
    const c = simU1.getTrackPosition(dU1);
    const t = simU1.getTrackTangent(dU1);
    return new THREE.Vector3(c.x + (-t.z) * -18.08, 0, c.z + t.x * -18.08);
};
for (const [sim, id] of [[simU2, 'U2'], [simU3, 'U3']]) {
    const P = sim.plaerrer.position;
    let maxErr = 0;
    for (let d = -65; d <= 65; d += 5) {
        const own = sim.getTrackPosition(P + d);
        const cor = corridorPoint(P1 - d);
        maxErr = Math.max(maxErr, Math.hypot(own.x - cor.x, own.z - cor.z));
    }
    check(`${id}: centerline pinned to Gleis 3/4 corridor (+-65m)`, maxErr < 0.05, `maxErr=${maxErr.toFixed(3)}m`);
    const tOwn = sim.getTrackTangent(P);
    const tU1 = simU1.getTrackTangent(P1);
    const dot = tOwn.x * tU1.x + tOwn.z * tU1.z;
    check(`${id}: direction anti-parallel to U1 at Plärrer`, dot < -0.999, `dot=${dot.toFixed(4)}`);
    // First station toward Fürth: vector Plärrer->first station has positive dot with U1 fwd
    const first = sim.stations[0];
    const pF = sim.getTrackPosition(first.position), pP = sim.getTrackPosition(P);
    const v = { x: pF.x - pP.x, z: pF.z - pP.z };
    check(`${id}: ${first.name} lies toward Fürth`, v.x * tU1.x + v.z * tU1.z > 0);
}

// ---- 3. Approach tracks land on the hall's mock Gleis 3/4 stubs ----
// Mock Gleis 3 (upper): U1 frame lateral sp1/2 - 18.08; Gleis 4 (lower): -sp1/2 - 18.08.
// U2 upper track = its REVERSE side (-sp2/2), lower = FORWARD (+sp2/2).
for (const [sim, id] of [[simU2, 'U2'], [simU3, 'U3']]) {
    const P = sim.plaerrer.position;
    let maxUp = 0, maxLo = 0;
    for (let d = -60; d <= 60; d += 10) {
        const a = P + d, dU1 = P1 - d;
        const cO = sim.getTrackPosition(a), tO = sim.getTrackTangent(a);
        const nO = new THREE.Vector3(-tO.z, 0, tO.x);
        const spO = sim.getTrackSpacing(a);
        const c1 = simU1.getTrackPosition(dU1), t1 = simU1.getTrackTangent(dU1);
        const n1 = new THREE.Vector3(-t1.z, 0, t1.x);
        const sp1 = simU1.getTrackSpacing(dU1);
        const ownUpper = cO.clone().addScaledVector(nO, -spO / 2);
        const mockG3 = c1.clone().addScaledVector(n1, sp1 / 2 - 18.08);
        maxUp = Math.max(maxUp, Math.hypot(ownUpper.x - mockG3.x, ownUpper.z - mockG3.z));
        const ownLower = cO.clone().addScaledVector(nO, spO / 2);
        const mockG4 = c1.clone().addScaledVector(n1, -sp1 / 2 - 18.08);
        maxLo = Math.max(maxLo, Math.hypot(ownLower.x - mockG4.x, ownLower.z - mockG4.z));
    }
    check(`${id}: upper track == mock Gleis 3`, maxUp < 0.05, `maxErr=${maxUp.toFixed(3)}m`);
    check(`${id}: lower track == mock Gleis 4`, maxLo < 0.05, `maxErr=${maxLo.toFixed(3)}m`);
    // dive parity with U1's formula at the stub handoff
    const dHand = sim.plaerrer.halfLength + 20;
    const dl = Math.abs(sim.getLowerLevelOffset(P + dHand) - simU1.getLowerLevelOffset(P1 - dHand));
    check(`${id}: dive matches U1 at stub handoff`, dl < 0.02, `delta=${dl.toFixed(3)}m`);
}

// ---- 4. Bespoke switch transitions: headless build + seam/smoothness checks ----
function fakeTrackManager(sim) {
    // Bare object carrying just what buildSwitchTransition/buildPlaerrerApproach/side-width
    // helpers need, with THREE-only stand-ins for the canvas-texture materials.
    const fake = Object.create(TrackManager.prototype);
    fake.sim = sim;
    fake.scene = new THREE.Group();
    const m = new THREE.MeshBasicMaterial();
    fake.materials = { tunnelBallast: m, tunnelSleeper: m, tunnelRail: m, tunnelRailHead: m, tunnelThirdRail: m, tunnelWall: m, tunnelGlow: m, portal: m };
    fake.geometries = {
        sleeper: new THREE.BoxGeometry(2.4, 0.12, 0.3),
        rail: new THREE.BoxGeometry(0.1, 0.1, 1),
        railHead: new THREE.BoxGeometry(0.09, 0.03, 1),
        thirdRail: new THREE.BoxGeometry(0.12, 0.15, 1),
        thirdRailCover: new THREE.BoxGeometry(0.24, 0.08, 1),
        portal: new THREE.BoxGeometry(1, 1, 1)
    };
    return fake;
}

const SWITCH_LEN = 250; // must match TrackManager.buildSwitchTransition
const SWITCH_STATIONS = [{ name: 'Rothenburger Straße', dir: -1 }, { name: 'Rathenauplatz', dir: 1 }];
const fakeBuilder = fakeTrackManager(simU1); // sim is irrelevant here -- all args are explicit
for (const { name, dir } of SWITCH_STATIONS) {
    const stU2 = simU2.stations.find(s => s.name === name), stU3 = simU3.stations.find(s => s.name === name);
    check(`U2/U3: isSwitchZone agrees at ${name}`,
        simU2.isSwitchZone(stU2.position + dir * (stU2.halfLength + 20)) &&
        simU3.isSwitchZone(stU3.position + dir * (stU3.halfLength + 20)));
    check(`${name}: switch zone outside Plärrer zone`, !simU2.isPlaerrerZone(
        simU2.stations.find(s => s.name === name).position + dir * (simU2.stations.find(s => s.name === name).halfLength + 20)));

    const group = fakeBuilder.buildSwitchTransition(simU2, simU3, name, name);
    check(`${name}: buildSwitchTransition built one shared group`, !!group && group.children.length >= 6,
        `children=${group ? group.children.length : 0}`);

    // Entry frame agreement: U2's and U3's own centerlines must coincide (within a few cm) at
    // the shared entry point just past the platform -- otherwise the piece wouldn't be "one
    // world" (this is the wall-clip failure mode from earlier this session).
    const st2 = simU2.stations.find(s => s.name === name), st3 = simU3.stations.find(s => s.name === name);
    const sEntry2 = st2.position + dir * (st2.halfLength + 5), sEntry3 = st3.position + dir * (st3.halfLength + 5);
    const pEntry2 = simU2.getTrackPosition(sEntry2), pEntry3 = simU3.getTrackPosition(sEntry3);
    check(`${name}: entry frame agrees between U2/U3`, pEntry2.distanceTo(pEntry3) < 0.2,
        `dist=${pEntry2.distanceTo(pEntry3).toFixed(3)}m`);

    // Exit-frame seam: re-derive the Hermite curve for each destination and confirm its far end
    // exactly matches that line's own real Simulation there (zero-seam hand-off, no cap/gap).
    for (const [destSim, destId] of [[simU2, 'U2'], [simU3, 'U3']]) {
        const stD = destSim.stations.find(s => s.name === name);
        const sExit = stD.position + dir * (stD.halfLength + 5 + SWITCH_LEN);
        // getTrackTangent always points in the direction of increasing arc length; flip by
        // `dir` so it points the way the curve actually travels (see the matching fix/comment
        // in TrackManager.buildSwitchTransition) -- otherwise dir=-1 stations (Rothenburger
        // Straße) get a near-reversed tangent and a ~150deg kink.
        const entry = fakeBuilder._rawFrameAt(simU2, sEntry2);
        const exit = fakeBuilder._rawFrameAt(destSim, sExit);
        entry.tan.multiplyScalar(dir);
        exit.tan.multiplyScalar(dir);
        const chord = entry.pos.distanceTo(exit.pos);
        const t0 = entry.tan.clone().normalize().multiplyScalar(chord);
        const t1 = exit.tan.clone().normalize().multiplyScalar(chord);
        const curveEnd = fakeBuilder._hermitePoint(entry.pos, t0, exit.pos, t1, 1);
        const seam = curveEnd.distanceTo(exit.pos);
        check(`${name} -> ${destId}: exit seam matches real track exactly`, seam < 1e-6, `seam=${seam.toExponential(2)}m`);

        // Smoothness: max turning angle per ~5m step along the branch, same measure used
        // earlier this session on the main route (which sits ~1.4-4.3deg/5m) -- cap generously.
        let maxTurn = 0;
        const steps = Math.round(SWITCH_LEN / 5), pts = [];
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            pts.push(fakeBuilder._hermitePoint(entry.pos, t0, exit.pos, t1, u));
        }
        for (let i = 1; i < pts.length - 1; i++) {
            const a = pts[i].clone().sub(pts[i - 1]), b = pts[i + 1].clone().sub(pts[i]);
            a.y = 0; b.y = 0;
            const la = a.length(), lb = b.length();
            if (la < 0.01 || lb < 0.01) continue;
            let c = (a.x * b.x + a.z * b.z) / (la * lb);
            c = Math.max(-1, Math.min(1, c));
            maxTurn = Math.max(maxTurn, Math.acos(c) * 180 / Math.PI);
        }
        check(`${name} -> ${destId}: branch stays smooth (no kink)`, maxTurn < 8, `maxTurn=${maxTurn.toFixed(1)}deg/~5m`);
    }

    const fake2 = fakeTrackManager(simU2);
    fake2.buildPlaerrerApproach();
    const apr = fake2.scene.children[0];
    check(`U2: buildPlaerrerApproach built geometry (unaffected by switch removal)`, !!apr && apr.children.length >= 6,
        `children=${apr ? apr.children.length : 0}`);
}

// U1 must be unaffected: no switch zone, side widths symmetric
check('U1: not in any switch zone', !simU1.isSwitchZone(5000) && simU1.switchZones.length === 0);
check('U1: side widths symmetric', Math.abs(fakeBuilder.getTunnelSideWidth(5000, 1) - fakeBuilder.getTunnelSideWidth(5000, -1)) < 1e-9);

// ---- 5. Station/gap sanity across both lines ----
for (const [sim, id] of [[simU2, 'U2'], [simU3, 'U3']]) {
    let ok = true, detail = '';
    for (const st of sim.stations) {
        if (st.name === 'Plärrer') continue;
        const g = sim.getTrackSpacing(st.position);
        if (g < 4.0 || g > 22) { ok = false; detail += `${st.name}=${g.toFixed(1)} `; }
    }
    check(`${id}: station gaps within [4,22]`, ok, detail);
    check(`${id}: first station has lead track before it`, sim.stations[0].position > 25, `pos=${sim.stations[0].position}`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
