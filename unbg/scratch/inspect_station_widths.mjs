import './dom_stubs.mjs';
import { Simulation } from '../src/simulator/Simulation.js';
import { TRACK_DATA as U1 } from '../src/simulator/TrackDataU1.js';

const sim = new Simulation(U1);
const wt = U1.stations.find(s => s.name === "Weißer Turm");
console.log("Station Weißer Turm:", wt);

console.log("\nTrack spacing along Weißer Turm platform:");
for (let z = -60; z <= 60; z += 10) {
    const s = wt.position + z;
    const spacing = sim.getTrackSpacing(s);
    const platWidth = spacing - 3.08;
    const hallWidth = spacing + 3.66;
    console.log(`  z=${z.toFixed(0)}m (dist=${s.toFixed(1)}): trackSpacing=${spacing.toFixed(2)}m -> platformWidth=${platWidth.toFixed(2)}m, hallWidth=${hallWidth.toFixed(2)}m`);
}

console.log("\nComparison with other U1 Mittelbahnsteige:");
for (const st of U1.stations) {
    if (st.side || st.name === "Plärrer") continue;
    const spacing = sim.getTrackSpacing(st.position);
    const platWidth = spacing - 3.08;
    console.log(`  ${st.name.padEnd(24)}: configSpacing=${st.platformSpacing} | sampledSpacing=${spacing.toFixed(2)}m | platWidth=${platWidth.toFixed(2)}m`);
}
