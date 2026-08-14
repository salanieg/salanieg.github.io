// Full-line NaN/continuity sweep for U2/U3 + StationModel import smoke test.
import { Simulation } from '../src/simulator/Simulation.js';
import { TRACK_DATA_U2 } from '../src/simulator/TrackDataU2.js';
import { TRACK_DATA_U3 } from '../src/simulator/TrackDataU3.js';

for (const [td, id] of [[TRACK_DATA_U2, 'U2'], [TRACK_DATA_U3, 'U3']]) {
    const sim = new Simulation(td);
    let bad = 0, maxStepDist = 0, prev = null;
    for (let s = 0; s <= sim.totalLength; s += 2.5) {
        const p = sim.getTrackPosition(s);
        const t = sim.getTrackTangent(s);
        const sp = sim.getTrackSpacing(s);
        const dv = sim.getLowerLevelOffset(s);
        if (![p.x, p.y, p.z, t.x, t.z, sp, dv].every(Number.isFinite)) { bad++; continue; }
        if (prev) maxStepDist = Math.max(maxStepDist, prev.distanceTo(p));
        prev = p.clone();
    }
    console.log(`${id}: sweep 0..${sim.totalLength}m  nonFinite=${bad}  max 2.5m-step distance=${maxStepDist.toFixed(2)}m`);
}
const sm = await import('../src/simulator/StationModel.js?v=70').catch(e => ({ __err: e }));
console.log('StationModel import:', sm.__err ? 'FAIL ' + sm.__err.message : 'OK');
