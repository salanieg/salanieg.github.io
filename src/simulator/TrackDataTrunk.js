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
import { TRACK_DATA_U2 } from './TrackDataU2.js?v=9';

const TRUNK_STATION_NAMES = ['Rothenburger Straße', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];
// Must stay inside the real switch distance (~73-76m past each station's centre --
// halfLength+30 past the platform edge) AND inside the splice's own guaranteed-identical
// range (scratch/gen_topology_u23.mjs's crossfade completes ~15m before each station, given
// TRUNK_MARGIN=65/BLEND=10). 40m clears the +-25m worst-case chunk-boundary slop (see
// Simulation.isTrunkZone's cutoff, which must be smaller than this) without reaching the
// switch or the still-converging part of the crossfade.
const EXTRACT_MARGIN = 40;

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
