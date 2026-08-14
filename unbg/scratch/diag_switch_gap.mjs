// Beweist die Längs-Lücke an den Weichen-Stationen: die Stammstrecken-Sim
// (TRACK_DATA_TRUNK) endet WEGEN EXTRACT_MARGIN=40 (um die Mittelpunkte) vor der
// Bahnsteigkante der Endstationen (halfLength 43-46). _sampleTrack klemmt auf
// [0,total], also kollabieren die Stations-Sweeps (Wände/Decke/Deck/Portal) auf
// der Weichenseite -> längs fehlende Hülle.
//
// node --import ./scratch/register.mjs scratch/diag_switch_gap.mjs
import './dom_stubs.mjs';
import * as THREE from 'three';
import { Simulation } from '../src/simulator/Simulation.js';
import { TRACK_DATA_U2 } from '../src/simulator/TrackDataU2.js';
import { TRACK_DATA_TRUNK } from '../src/simulator/TrackDataTrunk.js';

const simTrunk = new Simulation(TRACK_DATA_TRUNK);
const total = simTrunk.totalLength;

console.log('TRUNK-Sim total (lokale Bogenlänge) = ' + total.toFixed(2) + ' m');
console.log('EXTRACT_MARGIN = 40 m (um die Stations-MITTELPUNKTE)\n');

const numSubFor = (hl) => Math.max(8, Math.round((2 * hl) / 5.0));

const SW = [
    { name: 'Rothenburger Straße', dir: -1 },
    { name: 'Rathenauplatz',       dir: 1 },
];

for (const { name, dir } of SW) {
    const st = simTrunk.stations.find(s => s.name === name);
    const P = st.position, hl = st.halfLength;
    const numSub = numSubFor(hl);
    const ceilHalf = numSub * 2.5;

    // Bogenlängen, die die Stations-Sweeps auf der Weichenseite ABTASTEN wollen:
    const sWallDeck = P + dir * hl;          // Wände / Deck / Portal-Endwand
    const sCeil     = P + dir * ceilHalf;    // numSub-Decke (Rathenauplatz)
    const inRange = (s) => s >= 0 && s <= total;

    console.log('=== ' + name + '  (dir=' + dir + ') ===');
    console.log('  lokale position=' + P.toFixed(2) + '  halfLength=' + hl.toFixed(2));
    console.log('  Sweep will abtasten bis:');
    console.log('    Wand/Deck/Portal  s=' + sWallDeck.toFixed(2) + '   im Sim-Bereich [0,' + total.toFixed(2) + ']? ' +
                (inRange(sWallDeck) ? 'JA' : 'NEIN -> WIRD GEKLEMMT'));
    console.log('    Decke (numSub)    s=' + sCeil.toFixed(2)     + '   im Sim-Bereich? ' +
                (inRange(sCeil) ? 'JA' : 'NEIN -> WIRD GEKLEMMT'));

    // Wie weit LÄUFT der Sweep über das Sim-Ende hinaus (= Länge der Lücke)?
    const clampBoundary = dir > 0 ? total : 0;
    const gapLen = Math.abs(sWallDeck - clampBoundary);
    console.log('  -> Klemm-Grenze bei s=' + clampBoundary.toFixed(2) +
                ';  Wand/Deck läuft ' + gapLen.toFixed(2) + ' m darüber hinaus.');

    // Beweis des Kollaps: getTrackPosition am Portal == getTrackPosition an der Klemmgrenze?
    const pPortal = simTrunk.getTrackPosition(sWallDeck);
    const pClamp  = simTrunk.getTrackPosition(clampBoundary);
    const d = pPortal.distanceTo(pClamp);
    console.log('  -> getTrackPosition(Portal) vs getTrackPosition(Klemmgrenze): Abstand = ' + d.toFixed(4) + ' m');
    console.log('     (0.0000 = beide Punkte identisch = alle Ringe jenseits der Grenze kollabieren = KEINE Hülle)\n');
}

// Kontroll-Referenz: die Linien-Sim (U2) hat an denselben Stellen sehr wohl gültige Daten.
const simU2 = new Simulation(TRACK_DATA_U2);
console.log('Kontrolle: U2 (Linien-Sim) total=' + simU2.totalLength.toFixed(2) + ' m — deckt beide Stationen ± halfLength klar ab,');
console.log('daher laufen Schienen/Weichenstück (aus U2) durch, waehrend die Trunk-Stationshuelle abbricht.');

console.log('\nEmpfohlener Fix: EXTRACT_MARGIN >= max(halfLength)+Puffer (z. B. 55) in TrackDataTrunk.js,');
console.log('UND Trunk-Rig-Roehre in der switchZone unterdruecken (sonst kollidiert sie mit dem Weichenstueck).');
