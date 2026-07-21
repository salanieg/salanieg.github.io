// Derived (not generated) TrackData: the U2/U3 shared trunk (Rothenburger Straße -
// Rathenauplatz) is now byte-identical between TRACK_DATA_U2 and TRACK_DATA_U3
// (scratch/gen_topology_u23.mjs splices U2's trunk into U3), so this just slices it out of
// TRACK_DATA_U2 at import time -- single source of truth, no separate generation step, always
// in sync with whatever TrackDataU2.js currently contains.
//
// Built into a dedicated "trunk rig" (Simulation + TrackManager + StationModel, lineId
// "TRUNK") in main.js, mirroring how the Plärrer hall is built once and shared by all three
// lines: U2's and U3's own per-line TrackManager/StationModel skip this same arc range
// (Simulation.isTrunkZone / TrackManager.createChunk / StationModel.buildStation) so the
// stations + connecting track exist exactly once in the scene instead of once per line.
// WICHTIG: ?v= muss mit main.js/StationModel.js übereinstimmen (sonst wird die
// große TrackDataU2-Datei unter zwei URLs doppelt geladen und geparst).
import { TRACK_DATA_U2 } from './TrackDataU2.js?v=11';

const TRUNK_STATION_NAMES = ['Rothenburger Straße', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];
// LOWER BOUND (this was 40 and caused the "Längs-Lücke am Portal" bug): the margin is
// measured from each station's CENTRE, but the two boundary stations' hulls are built by
// this rig and sweep out to ± their halfLength (Rothenburger 43.09, Rathenauplatz 46.36),
// and Rathenauplatz's numSub-grid ceiling even reaches ~47.5m from centre. If the slice
// ends before that, those swept rings sample arc lengths past the sliced sim's `total` --
// and Simulation._sampleTrack CLAMPS out-of-range arc to [0,total], so the rings collapse
// onto the end point and the switch-side walls/ceiling/deck/portal simply don't get built
// (rails + bed still come from the un-clamped per-line sim / the switch piece, hence the
// classic "Schienen connecten, Betonplatte ragt raus, aber Hülle fehlt"). So EXTRACT_MARGIN
// MUST exceed ~47.5. The trunk rig also must NOT render its generic tube past the platform
// edge into the switch throat -- that is suppressed via isSwitchZone in TrackManager
// (createChunk / _clampInterval), so the extra data past ±halfLength is unused padding.
// UPPER BOUND: stay short of the real switch (~73-76m past centre) and inside the splice's
// guaranteed-identical range (~65m, TRUNK_MARGIN=65/BLEND=10 in gen_topology_u23.mjs).
// 55 sits comfortably between 47.5 and 65.
const EXTRACT_MARGIN = 55;

function buildTrunkData() {
    const td = TRACK_DATA_U2;
    const positions = TRUNK_STATION_NAMES.map(nm => td.stations.find(s => s.name === nm).position);
    const lo = Math.min(...positions) - EXTRACT_MARGIN;
    const hi = Math.max(...positions) + EXTRACT_MARGIN;
    const iLo = Math.max(0, Math.round(lo / td.step));
    const iHi = Math.min(td.cx.length - 1, Math.round(hi / td.step));
    const cx = td.cx.slice(iLo, iHi + 1);
    const cz = td.cz.slice(iLo, iHi + 1);
    const gap = td.gap.slice(iLo, iHi + 1);
    const baseArc = iLo * td.step;
    const total = (cx.length - 1) * td.step;
    // Plärrer is NOT one of this rig's own built stations (StationModel.buildStation returns
    // an empty group for it everywhere, same as every other line -- the bespoke hall IS the
    // station), but its Simulation still needs to know where it sits so isPlaerrerZone
    // correctly suppresses this rig's OWN generic tunnel/rails/bed through the hall's
    // footprint. Without this, the trunk rig built a normal tunnel tube straight through the
    // middle of Plärrer (visible inside the hall).
    const stationNames = [...TRUNK_STATION_NAMES, 'Plärrer'];
    const stations = stationNames.map(nm => {
        const s = td.stations.find(q => q.name === nm);
        return { ...s, position: Math.round((s.position - baseArc) * 100) / 100 };
    }).sort((a, b) => a.position - b.position);
    return {
        lineId: 'TRUNK', step: td.step, total, baseSpacing: td.baseSpacing,
        cx, cz, gap, stations, junctions: [],
        elevationZones: [{ end: total, type: 'underground' }],
        curveSpeedZones: []
    };
}

export const TRACK_DATA_TRUNK = buildTrunkData();
