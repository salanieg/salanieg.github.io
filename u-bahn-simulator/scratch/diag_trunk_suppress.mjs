// Prüft die zweite Fix-Hälfte: das Trunk-Rig (lineId 'TRUNK') unterdrückt seine
// generische Röhre in der switchZone (ab Bahnsteigkante), bleibt aber in der
// trunkZone/innen normal am Bauen.
// node --import ./scratch/register.mjs scratch/diag_trunk_suppress.mjs
import './dom_stubs.mjs';
import { Simulation } from '../src/simulator/Simulation.js';
import { TrackManager } from '../src/simulator/TrackManager.js';
import { TRACK_DATA_TRUNK } from '../src/simulator/TrackDataTrunk.js';

const sim = new Simulation(TRACK_DATA_TRUNK);
const tm = Object.create(TrackManager.prototype);
tm.sim = sim;

let fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`);
    if (!cond) fail++;
};

check('Trunk-Sim hat 2 switchZones', sim.switchZones.length === 2,
    sim.switchZones.map(z => z.name + ':[' + z.range[0].toFixed(1) + ',' + z.range[1].toFixed(1) + ']').join(' '));

const rath = sim.stations.find(s => s.name === 'Rathenauplatz');
const roth = sim.stations.find(s => s.name === 'Rothenburger Straße');
const edgeR = rath.position + rath.halfLength;   // Weichenkante Rathenauplatz (dir +1)
const edgeH = roth.position - roth.halfLength;    // Weichenkante Rothenburger (dir -1)

// 1) TRUNK: Intervall komplett hinter der Bahnsteigkante -> null (unterdrückt)
check('TRUNK unterdrückt Röhre hinter Rathenauplatz-Kante',
    tm._clampInterval(edgeR + 1, edgeR + 11, 'TRUNK') === null,
    `[${(edgeR + 1).toFixed(1)},${(edgeR + 11).toFixed(1)}]`);

// 2) TRUNK: Intervall über die Kante -> auf die Kante geklemmt (Röhre stoppt genau dort)
const straddle = tm._clampInterval(edgeR - 10, edgeR + 10, 'TRUNK');
check('TRUNK klemmt straddelndes Intervall an die Kante',
    straddle && Math.abs(straddle[1] - edgeR) < 1e-6,
    straddle ? `-> [${straddle[0].toFixed(2)},${straddle[1].toFixed(2)}], Kante=${edgeR.toFixed(2)}` : 'null');

// 3) TRUNK: Rothenburger-Seite (dir -1) genauso, Intervall vor der Kante -> null
check('TRUNK unterdrückt Röhre vor Rothenburger-Kante',
    tm._clampInterval(edgeH - 11, edgeH - 1, 'TRUNK') === null,
    `[${(edgeH - 11).toFixed(1)},${(edgeH - 1).toFixed(1)}]`);

// 4) TRUNK: innen (Stammstrecke) NICHT unterdrückt (trunkZone gilt fürs Rig nicht)
const inner = tm._clampInterval(1000, 1050, 'TRUNK');
check('TRUNK baut die Stammstrecke innen normal',
    inner && inner[0] === 1000 && inner[1] === 1050);

// 5) createChunk-Loop-Gate: isSwitchZone(mid) hinter der Kante true, innen false
check('isSwitchZone: hinter Rathenauplatz-Kante true, innen false',
    sim.isSwitchZone(edgeR + 5) && !sim.isSwitchZone(rath.position));

console.log(fail ? `\n${fail} FAILURES` : '\nAlle Trunk-Suppress-Checks OK.');
process.exit(fail ? 1 : 0);
