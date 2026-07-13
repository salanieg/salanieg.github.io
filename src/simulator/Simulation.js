import * as THREE from 'three';
import { TRACK_DATA as TD } from './TrackDataU1.js?v=55';

// Reusable temporary vectors to prevent runtime allocations/garbage collection in path queries
const _tempP0 = new THREE.Vector3();
const _tempP1 = new THREE.Vector3();
const _tempV0 = new THREE.Vector3();
const _tempV1 = new THREE.Vector3();

// Realistic Nuremberg Siemens G1 (Inspiro) Train Physics Constants
const MASS_KG = 140000;            // Feste Zugmasse
const V_MAX_MS = 22.22;            // 80 km/h Höchstgeschwindigkeit
const POWER_W = 2240000;           // Gesamtantriebsleistung
const F_MAX_N = 149000;            // Max. Zugkraft (kraftbegrenzter Bereich)

const BRAKE_SERVICE_MS2 = 2.0;     // Normale Betriebsbremsung
const BRAKE_EMERGENCY_MS2 = 2.8;   // Notbremse
const BRAKE_SNUBBING_MS2 = 0.4;    // Sanftes Ausrollen kurz vor Stillstand

const JERK_ACCEL_MS3 = 0.6;        // Max. Änderungsrate der Beschleunigung (Traction)
const JERK_BRAKE_MS3 = 0.6;        // Max. Änderungsrate der Beschleunigung (Service Brake)
const JERK_EMERGENCY_MS3 = 4.0;    // Notbremse darf hart einsetzen

const ROLL_COEFF = 0.0025;         // Rollwiderstandskoeffizient
const DRAG_AREA_M2 = 7.0;          // Luftwiderstandsfläche (Cw * A)
const AIR_DENSITY = 1.225;         // Luftdichte

// Traction force calculation (power- and force-limited)
function getTractionForce(v_ms, throttle) {
    if (v_ms < 0.1) {
        return F_MAX_N * throttle;
    }
    const f_max = Math.min(F_MAX_N, POWER_W / v_ms);
    return f_max * throttle;
}

// Braking force calculation (service brake, emergency, or low-speed snubbing)
function getBrakeForce(brake_input, emergency, near_stop) {
    let a = 0;
    if (emergency) {
        a = BRAKE_EMERGENCY_MS2;
    } else if (near_stop) {
        a = BRAKE_SNUBBING_MS2;
    } else {
        a = BRAKE_SERVICE_MS2 * brake_input;
    }
    return MASS_KG * a;
}

// Running resistance force calculation (rolling + aerodynamic drag)
function getResistanceForce(v_ms) {
    const rolling = ROLL_COEFF * MASS_KG * 9.81;
    const drag = 0.5 * AIR_DENSITY * DRAG_AREA_M2 * v_ms * v_ms;
    return rolling + drag;
}

/**
 * Nuremberg U-Bahn Line 1 Physics & State Simulation Engine
 */
export class Simulation {
    constructor(trackData = TD) {
        // ---------------------------------------------------------------
        // Track geometry & stations are sourced from Schienen.geojson and
        // precomputed into TrackDataU1.js: the centerline of the route, the
        // inter-track spacing, every station's position/length, the
        // elevation transitions and the decorative side tracks. The whole
        // route is scaled so its length equals 18500 m.
        // ---------------------------------------------------------------
        this.track = trackData;

        this.stations = [];
        trackData.stations.forEach((s, idx) => {
            const center = this.getTrackPosition(s.position);
            const tangent = this.getTrackTangent(s.position);
            const distPrev = (idx === 0) ? s.position : (s.position - trackData.stations[idx - 1].position);

            this.stations.push({
                name: s.name,
                index: idx,
                position: s.position,
                distPrev: distPrev,
                type: s.type,
                color: s.color,
                center: center,
                tangent: tangent,
                halfLength: s.halfLength,            // platform half-length (m), from the geojson track spread
                side: s.side                          // true = outer/side platforms, false = island platform
            });
        });

        this.totalLength = trackData.total;

        // Plärrer is a bespoke stacked station: two 12 m island platforms one above the
        // other. The Hardhöhe-bound track (forward) uses the UPPER level (base tunnel
        // elevation); the Langwasser-bound track (reverse) uses the LOWER level, which
        // sits plaerrerDrop metres below and is reached via a dive that the tubes split
        // into over plaerrerSplit metres on each side of the platform.
        // Per the geojson the two tracks are coincident (in top view) for ~±230 m around
        // Plärrer — i.e. genuinely STACKED there (Gleis 1 directly above Gleis 2 on the
        // centerline). They diverge into two separate tubes over the ramps out to ~±380 m.
        // Gleis 2 (reverse) is fully dived BEFORE the tracks converge, so it never has to
        // cross sideways through Gleis 1.
        // The bespoke stacked hall (TrackManager.buildPlaerrer, built once by U1 and kept
        // permanently in the world scene) serves ALL THREE lines: U1 rides Gleis 1/2, and
        // U2/U3 ride the parallel Gleis 3/4 corridor 18.08 m away -- their generated
        // centerlines are pinned onto exactly that corridor (scratch/gen_topology_u23.mjs).
        // So every line with a Plärrer stop gets the same stacked semantics here: spacing
        // converges to 0.6 m, one direction dives to the lower level, and the generic
        // tunnel/rails are suppressed in the zone (replaced by the hall + approach tubes).
        this.plaerrer = this.stations.find(s => s.name === "Plärrer") || null;
        // U2/U3 traverse the shared corridor OPPOSITE to U1 (their south-west termini
        // Röthenbach/Grossreuth lie toward Fürth as seen from Plärrer), so their FORWARD
        // (+spacing/2) track lands on the Gleis 4 slot and must be the one that dives;
        // U1 keeps its historic reverse-dives behavior (Gleis 2 lower, Gleis 1 upper).
        this.plaerrerForwardDives = !!(trackData.lineId && trackData.lineId !== "U1");
        this.plaerrerDrop = 10.0;  // lower level depth below the upper level (Gleis 2 ≈ -16.5 m)
        this.plStackHalf = 150;    // (zone half-extent = plStackHalf + plRamp; tubes span it)
        this.plRamp = 300;         // the tubes/dive reach this far past the stacked core

        // Shared trunk zone (Rothenburger Straße..Rathenauplatz, U2/U3 only): the station
        // platforms + connecting track there are now byte-identical between U2 and U3
        // (scratch/gen_topology_u23.mjs splices U2's trunk into U3), so they're rendered ONCE
        // by a dedicated shared "trunk rig" (built in main.js, mirroring the Plärrer hall)
        // instead of once per line. Each line's OWN TrackManager/StationModel must skip
        // building chunks/stations there (see isTrunkZone, TrackManager.createChunk,
        // StationModel.buildStation) so the two don't end up duplicated in the scene. The 10m
        // cutoff must stay INSIDE the splice's own guaranteed-identical range (the crossfade
        // in gen_topology_u23.mjs completes ~15m before each station) and well short of the
        // real switch (~73-76m out) -- extending this out to the switch was what made U2/U3's
        // centerlines get force-blended together right where they're meant to diverge, which
        // is what made the junctions look "wild". TrackDataTrunk.js's own EXTRACT_MARGIN (40m)
        // stays a bit wider than this cutoff so the shared rig's geometry always covers
        // slightly more than what each line skips (avoiding a gap at the 50m chunk grain).
        const TRUNK_STATION_NAMES = ['Rothenburger Straße', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];
        const trunkPositions = TRUNK_STATION_NAMES.map(nm => this.stations.find(s => s.name === nm)?.position);
        this.trunkZone = trunkPositions.every(p => p !== undefined)
            ? [Math.min(...trunkPositions) - 10, Math.max(...trunkPositions) + 10]
            : null;

        // Bespoke switch-transition zones (U2/U3 only): past each of the two boundary trunk
        // stations, ~SWITCH_LEN of tunnel is a hand-authored, shared piece (TrackManager.
        // buildSwitchTransition, built once and reused by both lines like the Plärrer hall)
        // instead of each line's own procedural chunk tunnel -- see isSwitchZone,
        // TrackManager.createChunk. `dir` is the arc direction AWAY from the trunk interior
        // (where the real switch/Weiche physically sits), matching gen_topology_u23.mjs's
        // convention. Zone starts a few meters inside the platform edge (no gap at the 50m
        // chunk grain) and ends a bit past SWITCH_LEN (must match TrackManager's SWITCH_LEN).
        const SWITCH_LEN = 250;
        const SWITCH_STATIONS = [
            { name: 'Rothenburger Straße', dir: -1 },
            { name: 'Rathenauplatz', dir: 1 },
        ];
        this.switchZones = SWITCH_STATIONS
            .map(({ name, dir }) => {
                const st = this.stations.find(s => s.name === name);
                if (!st) return null;
                const a = st.position + dir * (st.halfLength - 5);
                const b = st.position + dir * (st.halfLength + SWITCH_LEN + 10);
                return { name, range: [Math.min(a, b), Math.max(a, b)] };
            })
            .filter(Boolean);

        // Named speed-restricted curve zones (station-name pairs, not raw indices, so a
        // second/third line's own station order never accidentally hits the wrong stretch).
        // U1's own sharp curve (Messe -> Bauernfeindstraße) is the historic default, applied
        // whenever a track doesn't specify curveSpeedZones itself (pass [] to opt out).
        const curveZoneDefs = trackData.curveSpeedZones !== undefined
            ? trackData.curveSpeedZones
            : [{ before: "Messe", after: "Bauernfeindstraße", limitKmh: 50 }];
        this.curveSpeedZones = curveZoneDefs
            .map(z => ({
                startPos: this.stations.find(s => s.name === z.before)?.position,
                endPos: this.stations.find(s => s.name === z.after)?.position,
                limitKmh: z.limitKmh
            }))
            .filter(z => z.startPos !== undefined && z.endPos !== undefined);

        // Simulation State
        this.trainModelType = 'G1'; // 'G1' or 'DT1'
        this.position = this.stations[0].position + this.trainHalfLength; // start at the first station's center (Langwasser Süd)
        this.speed = 0; // m/s
        this.acceleration = 0; // m/s^2
        this.targetSpeed = 0; // m/s (speed limit)
        this.throttle = 0; // -1 (full brake) to 1 (full traction)
        this.brakeCylinderPressure = 0; // bar (0 to 5)
        this.mainReservoirPressure = 9.5; // bar (Normal 8.5 to 10.0)
        this.compressorActive = false;
        this.lastBrakeCylinderPressure = 0;
        this.doorsOpen = false;
        this.doorState = 0; // 0 = closed, 1 = opening, 2 = open, 3 = closing
        this.doorProgress = 0; // 0 to 1
        this.currentPlatformSide = 'right'; // side to open

        // Passengers & Score
        this.passengers = 120;
        this.maxPassengers = 600;
        this.currentStationIdx = 0;
        this.nextStationIdx = 1;
        this.displayNextStationIdx = 1; // shown on displays – lags behind nextStationIdx until train leaves
        this.pendingDisplayAdvance = false; // true once nextStationIdx advanced but train still in station
        this.isReversing = false; // driving direction
        
        // Mode
        this.atoMode = false; // Autopilot (ATO)
        this.atoCoasting = false; // ATO: currently rolling in neutral (coasting) on open track
        this.activeCameraType = 'cab';
        this.wantsDoorWarning = false;
        this.doorWarningActive = false;
        this.atoDoorWarningPlayed = false;

        // Safety
        this.emergencyBrake = false;

        // Environment variables
        this.trainMass = MASS_KG; 
        this.maxForce = F_MAX_N; 
        this.maxBrakeForce = MASS_KG * BRAKE_SERVICE_MS2; 
        this.maxEmergencyBrakeForce = MASS_KG * BRAKE_EMERGENCY_MS2;

        // Schedule
        this.time = 0; // total simulation run time in seconds
        this.scheduleOffset = 0; // difference to timetable in seconds
        this.stopWaitTime = 0; // time spent waiting at current station (seconds)
        this.scheduledStopTime = 8.25; // seconds to wait at station
        this.score = 1000; // driving quality score

        // Horn state
        this.hornActive = false;

        // SIFA state
        this.sifaTimer = 0;
        this.sifaWarning = false;
        this.sifaMaxTime = 30;
        this.sifaWarningTime = 2.5;

        // Stats
        this.powerConsumption = 0; // kWh used
        
        // Track Gradient / Curves simplified
        this.gradient = 0; // % slope
        this.trackCurvature = 0; // 1/radius

        // Radio state
        this.radioActive = false;
        this.wantsRadioPlay = false; // click while off: turn on (default station)
        this.wantsRadioNext = false; // click while on, main area: next station
        this.wantsRadioOff = false;  // click while on, "Aus" button: turn off
    }
 
    get trainHalfLength() {
        // Maßstab 1:1 – 1 Einheit = 1 Meter. Halbe Gesamtzuglänge (G1 = 76,170 m, DT1 ≈ 74,3 m, DT3 ≈ 38,085 m).
        if (this.trainModelType === 'G1') return 38.085;
        if (this.trainModelType === 'DT3') return 19.0425;
        return 37.15; // DT1
    }

    getTrackPosition(dist, target = new THREE.Vector3()) {
        this._sampleTrack(dist, target, null);
        return target;
    }

    getTrackTangent(dist, target = new THREE.Vector3()) {
        this._sampleTrack(dist, null, target);
        return target;
    }

    // Vertical offset of the LOWER Plärrer level relative to the base elevation, as a
    // function of distance: 0 outside the split zone, smoothly diving to -plaerrerDrop
    // across the platform. Used to stack the two directional tracks at Plärrer.
    getLowerLevelOffset(dist) {
        const p = this.plaerrer;
        if (!p) return 0;
        const x = Math.abs(dist - p.position);
        const zone = this.plStackHalf + this.plRamp;
        if (x >= zone) return 0;
        // Tie the dive depth to the lateral track gap so the two single-track tubes keep a
        // ~constant centre-to-centre separation (≈ sep) and never clip: deep where the
        // tracks are laterally close (stacked over the station), shallow where they fan out.
        const gap = this.getTrackSpacing(dist);
        const sep = 10.0;
        let dy = sep * sep - gap * gap;
        dy = dy > 0 ? Math.sqrt(dy) : 0;
        dy = Math.min(this.plaerrerDrop, dy);
        // Fade the remaining dive smoothly to 0 as the tracks fan out. Without this the sqrt
        // has a vertical tangent where dy→0, which produced a steep bump at the top of the
        // climb. Safe: the tubes are already far apart laterally by the time this kicks in.
        const gapCut = 6.5;
        if (gap > gapCut) {
            const f = Math.max(0, Math.min(1, (sep - gap) / (sep - gapCut)));
            dy *= f * f * (3 - 2 * f);
        }
        const e = Math.min(1, (zone - x) / 70);       // smooth taper to 0 at the outer end
        return -dy * (e * e * (3 - 2 * e));
    }

    // Extra vertical offset applied to the moving train (and its cameras) so that it rides
    // the correct stacked Plärrer level. U1: upper when heading to Hardhöhe (forward),
    // lower when heading to Langwasser Süd (reverse). U2/U3 traverse the corridor the
    // other way round (see plaerrerForwardDives), so for them FORWARD rides the lower
    // Gleis 4 and reverse stays on the upper Gleis 3.
    getTrackElevationOffset(dist, reversing) {
        const ridesLower = this.plaerrerForwardDives ? !reversing : reversing;
        return ridesLower ? this.getLowerLevelOffset(dist) : 0;
    }

    // True inside the bespoke Plärrer zone (platform + the two-tube split on each side),
    // where the generic tunnel tube / running rails are suppressed and replaced by the
    // custom stacked-station geometry.
    isPlaerrerZone(dist) {
        const p = this.plaerrer;
        if (!p) return false;
        return Math.abs(dist - p.position) <= this.plStackHalf + this.plRamp;
    }

    // True inside the shared trunk zone (Rothenburger Straße..Rathenauplatz), where the
    // generic per-line chunk/station building is suppressed in favour of the shared trunk rig.
    isTrunkZone(dist) {
        return !!this.trunkZone && dist >= this.trunkZone[0] && dist <= this.trunkZone[1];
    }

    // True inside a bespoke switch-transition zone (past Rothenburger Straße/Rathenauplatz),
    // where the generic per-line chunk tunnel is suppressed in favour of the shared,
    // hand-authored switch piece (TrackManager.buildSwitchTransition).
    isSwitchZone(dist) {
        for (const z of this.switchZones) if (dist >= z.range[0] && dist <= z.range[1]) return true;
        return false;
    }

    // Generic interpreter for tracks that carry a simple `elevationZones` list instead of
    // U1's hand-tuned 8-segment ramp chain (used by lines with no surface/elevated sections,
    // e.g. U2/U3 which are entirely underground -- no ramp blending needed between zones).
    _zoneTypeAt(z) {
        const zones = this.track.elevationZones;
        for (const zn of zones) if (z <= zn.end) return zn.type;
        return zones[zones.length - 1].type;
    }

    getTrackY(z) {
        // Elevation profile. Levels: underground -6.5 m, surface 0 m, elevated +7 m.
        // Transition distances (portals / open-cut shafts / ramps) come from TrackData
        // and are re-anchored to the geojson station positions.
        const UG = -6.5, EL = 7.0;
        if (this.track.elevationZones) {
            const t = this._zoneTypeAt(z);
            return (t === 'elevated' || t === 'ramp') ? EL : (t === 'at-grade' ? 0.0 : UG);
        }
        const e = this.track.elevation;

        // 1. Langwasser Mitte -> Scharfreiterring (underground -> at-grade)
        if (z < e.p1) return UG;
        if (z <= e.sh1) return UG - UG * (z - e.p1) / (e.sh1 - e.p1);

        // 2. Bauernfeindstraße -> Hasenbuck (at-grade -> underground)
        if (z < e.sh2) return 0.0;
        if (z <= e.p2) return UG * (z - e.sh2) / (e.p2 - e.sh2);

        // 3. Hasenbuck -> Maximilianstraße (underground)
        if (z < e.p3) return UG;

        // 4. Maximilianstraße -> Eberhardshof (underground -> at-grade)
        if (z <= e.sh3) return UG - UG * (z - e.p3) / (e.sh3 - e.p3);

        // 5. Eberhardshof -> Muggenhof (at-grade -> elevated)
        if (z < e.r1) return 0.0;
        if (z <= e.r1e) return EL * (z - e.r1) / (e.r1e - e.r1);

        // 6. Muggenhof -> Stadtgrenze (elevated)
        if (z < e.r2) return EL;

        // 7. Stadtgrenze -> Jakobinenstraße (elevated -> at-grade -> underground)
        if (z <= e.r2e) return EL - EL * (z - e.r2) / (e.r2e - e.r2);
        if (z <= e.p4) return UG * (z - e.r2e) / (e.p4 - e.r2e);

        // 8. Jakobinenstraße -> Hardhöhe (underground)
        return UG;
    }

    getChunkType(z) {
        // Structural type along the route, keyed to the same re-anchored transition
        // distances as getTrackY (TrackData.elevation).
        if (this.track.elevationZones) return this._zoneTypeAt(z);
        const e = this.track.elevation;

        // 1. Langwasser Mitte -> Scharfreiterring
        if (z < e.p1) return 'underground';
        if (z <= e.sh1) return 'shaft';

        // 2. Bauernfeindstraße -> Hasenbuck
        if (z < e.sh2) return 'at-grade';
        if (z <= e.p2) return 'shaft';

        // 3. Hasenbuck -> Maximilianstraße
        if (z < e.p3) return 'underground';

        // 4. Maximilianstraße -> Eberhardshof
        if (z <= e.sh3) return 'shaft';

        // 5. Eberhardshof -> Muggenhof
        if (z < e.r1) return 'at-grade';
        if (z <= e.r1e) return 'ramp';

        // 6. Muggenhof -> Stadtgrenze
        if (z < e.r2) return 'elevated';

        // 7. Stadtgrenze -> Jakobinenstraße
        if (z <= e.r2e) return 'ramp';
        if (z <= e.p4) return 'shaft';

        // 8. Jakobinenstraße -> Hardhöhe
        return 'underground';
    }

    // Core track sampler: smooth Catmull-Rom interpolation of the precomputed geojson
    // centerline (TrackData.cx / cz, sampled every TrackData.step metres of arc length).
    // Writes into the provided out-vectors (either may be null) and allocates nothing,
    // so it is safe to call from the per-frame hot path. Position and tangent are only
    // computed when their out-vector is requested.
    _sampleTrack(dist, outPos, outTan) {
        const TD = this.track;
        if (dist < 0) dist = 0;
        if (dist > TD.total) dist = TD.total;

        const cx = TD.cx, cz = TD.cz;
        const n = cx.length;
        const u = dist / TD.step;
        let i = Math.floor(u);
        if (i < 0) i = 0;
        if (i > n - 2) i = n - 2;
        const t = u - i;

        const i0 = Math.max(0, i - 1);
        const i1 = i;
        const i2 = Math.min(n - 1, i + 1);
        const i3 = Math.min(n - 1, i + 2);

        const x0 = cx[i0], x1 = cx[i1], x2 = cx[i2], x3 = cx[i3];
        const z0 = cz[i0], z1 = cz[i1], z2 = cz[i2], z3 = cz[i3];
        const t2 = t * t;

        if (outPos) {
            const t3 = t2 * t;
            const x = 0.5 * ((2 * x1) + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
            const z = 0.5 * ((2 * z1) + (-z0 + z2) * t + (2 * z0 - 5 * z1 + 4 * z2 - z3) * t2 + (-z0 + 3 * z1 - 3 * z2 + z3) * t3);
            outPos.set(x, this.getTrackY(dist), z);
        }
        if (outTan) {
            const dx = 0.5 * ((-x0 + x2) + 2 * (2 * x0 - 5 * x1 + 4 * x2 - x3) * t + 3 * (-x0 + 3 * x1 - 3 * x2 + x3) * t2);
            const dz = 0.5 * ((-z0 + z2) + 2 * (2 * z0 - 5 * z1 + 4 * z2 - z3) * t + 3 * (-z0 + 3 * z1 - 3 * z2 + z3) * t2);
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            outTan.set(dx / len, 0, dz / len);
        }
    }

    getTrackPositionAndTangent(dist, outPos = new THREE.Vector3(), outTan = new THREE.Vector3()) {
        this._sampleTrack(dist, outPos, outTan);
        return { position: outPos, tangent: outTan };
    }

    sampleLocalSpacing(dist) {
        // Real local inter-track gap (TrackData.gap), sampled every TrackData.step metres.
        // Reconstructed per-track from the GPS route relations and smoothed independently,
        // so it follows the true spacing everywhere — tunnels, viaducts AND station spreads.
        const g = this.track.gap;
        if (!g || g.length === 0) return this.track.baseSpacing;
        const u = dist / this.track.step;
        let i = Math.floor(u);
        if (i < 0) i = 0;
        if (i > g.length - 2) i = g.length - 2;
        const t = u - i;
        return g[i] + (g[i + 1] - g[i]) * t;
    }

    getTrackSpacing(dist) {
        // Distance between the two running tracks (= platform width / tunnel cross-section).
        // This now comes straight from the real per-track separation harvested from the GPS
        // geojson (TrackData.gap): the two running rails were reconstructed from the route
        // relations and smoothed INDEPENDENTLY, so the gap already contains the real
        // island-platform bulges and side-platform narrowing. No per-station override and no
        // bulge/transition blending is needed any more — the platform width is simply the
        // local gap, i.e. the platform spans between the two real tracks.
        if (dist < 0) dist = 0;
        if (dist > this.totalLength) dist = this.totalLength;

        // Plärrer stays bespoke: the two tracks are vertically STACKED here (separated by the
        // dive, not sideways), so hold the smooth convergence to the ~0.6 m stacked platform.
        const pl = this.plaerrer;
        if (pl) {
            const x = Math.abs(dist - pl.position);
            const zone = this.plStackHalf + this.plRamp;
            if (x < zone) {
                const stacked = 0.6;
                if (x <= pl.halfLength) return stacked;
                const outer = this.sampleLocalSpacing(pl.position + (dist >= pl.position ? zone : -zone));
                const t = (x - pl.halfLength) / (zone - pl.halfLength);
                const sm = t * t * (3 - 2 * t);
                return stacked + (outer - stacked) * sm;
            }
        }

        return this.sampleLocalSpacing(dist);
    }

    getTrackXOffset(dist) {
        // Near Plärrer the geojson gap shrinks to ~0, so ±spacing/2 naturally converges to
        // the centerline: both tracks stack on the centerline, separated only vertically by
        // the dive. No sideways crossing is needed, so there is no glitch through Gleis 1.
        const spacing = this.getTrackSpacing(dist);
        return this.isReversing ? (-spacing / 2) : (spacing / 2);
    }

    update(dt) {
        this.time += dt;

        // 0. Update Pneumatics (HBL and Compressor)
        this.updatePneumatics(dt);

        // SIFA Logic
        if (this.speed > 0.1 && !this.atoMode) {
            this.sifaTimer += dt;
            if (this.sifaTimer > this.sifaMaxTime) {
                this.sifaWarning = true;
            }
            if (this.sifaTimer > this.sifaMaxTime + this.sifaWarningTime) {
                if (!this.emergencyBrake) {
                    this.triggerEmergencyBrake();
                }
            }
        } else {
            this.resetSifa();
        }

        // Get track info at current position
        this.updateTrackProperties();

        // Autopilot (ATO) calculations
        if (this.atoMode) {
            this.runATO(dt);
        }

        // Door State Machine
        this.updateDoors(dt);

        // Physics Integration
        this.updatePhysics(dt);

        // Station Stop and Passenger Management
        this.updateStationCheck(dt);
    }

    updatePhysics(dt) {
        if (dt <= 0) return;

        // 1. Map inputs to throttle and brake_input
        const throttleInput = this.throttle > 0 ? this.throttle : 0;
        const brakeInput = this.throttle < 0 ? Math.abs(this.throttle) : 0;

        // Door interlock: cannot apply traction if doors are not fully closed
        const doorsFullyClosed = (this.doorState === 0 && this.doorProgress === 0);
        const effectiveThrottle = doorsFullyClosed ? throttleInput : 0;

        // 2. Compute near_stop state
        // Snubbing applies when braking (service brake active) and velocity is low.
        const nearStop = (this.speed < 0.5 && brakeInput > 0);

        // 3. Compute forces
        const fDrive = effectiveThrottle > 0 ? getTractionForce(this.speed, effectiveThrottle) : 0;
        const fBrake = (brakeInput > 0 || this.emergencyBrake) ? getBrakeForce(brakeInput, this.emergencyBrake, nearStop) : 0;
        const fResist = getResistanceForce(this.speed);

        // Gravity force (slope)
        const direction = this.isReversing ? -1 : 1;
        const fGravity = MASS_KG * 9.81 * (this.gradient / 100);

        // 4. Net Force and raw acceleration
        const fNet = fDrive - fBrake - fResist - fGravity * direction;
        let rawAccel = fNet / MASS_KG;

        // Standstill logic: if stopped and forces are trying to move us backwards (due to brakes or grade in opposite direction),
        // clamp rawAccel and acceleration to 0. Brakes cannot reverse the train.
        if (this.speed <= 0.01 && fDrive <= (fBrake + fResist + fGravity * direction)) {
            rawAccel = 0;
            if (this.acceleration < 0) {
                this.acceleration = 0;
            }
        }

        // 5. Jerk Limit
        let maxJerk = JERK_ACCEL_MS3;
        if (this.emergencyBrake) {
            maxJerk = JERK_EMERGENCY_MS3;
        } else if (fBrake > 0) {
            maxJerk = JERK_BRAKE_MS3;
        }
        
        // Apply Jerk Limit
        const maxDelta = maxJerk * dt;
        const delta = Math.max(-maxDelta, Math.min(maxDelta, rawAccel - this.acceleration));
        this.acceleration += delta;

        // 6. Update speed
        let prevSpeed = this.speed;
        this.speed += this.acceleration * dt;

        // Clamp speed
        this.speed = Math.max(0, Math.min(V_MAX_MS, this.speed));

        // Prevent reversing under brakes/coasting, and prevent creeping at standstill
        if ((prevSpeed > 0 && this.speed <= 0 && fDrive === 0) || (this.speed <= 0.001 && fDrive === 0)) {
            const fGravityVal = MASS_KG * 9.81 * (this.gradient / 100);
            if (Math.abs(fGravityVal) <= (fBrake + fResist)) {
                this.speed = 0;
                this.acceleration = 0;
            }
        }

        // Speed limit check (score deduction in manual mode)
        const absoluteSpeedLimit = this.targetSpeed;
        if (this.speed > absoluteSpeedLimit + 2 / 3.6) {
            if (!this.atoMode) {
                // Deduct score for overspeeding in manual mode, but do not override controls
                this.score = Math.max(0, this.score - dt * 5);
            }
        }

        // 7. Update brake cylinder pressure for dials and sounds
        if (this.emergencyBrake) {
            this.brakeCylinderPressure = Math.min(5, this.brakeCylinderPressure + dt * 10);
        } else {
            if (this.throttle > 0 && doorsFullyClosed) {
                this.brakeCylinderPressure = Math.max(0, this.brakeCylinderPressure - dt * 5);
            } else if (this.throttle < 0) {
                const targetPressure = Math.abs(this.throttle) * 4.5;
                if (this.brakeCylinderPressure < targetPressure) {
                    this.brakeCylinderPressure = Math.min(targetPressure, this.brakeCylinderPressure + dt * 4);
                } else {
                    this.brakeCylinderPressure = Math.max(targetPressure, this.brakeCylinderPressure - dt * 4);
                }
            } else {
                this.brakeCylinderPressure = Math.max(0, this.brakeCylinderPressure - dt * 5);
            }
        }

        // 8. Energy consumption
        if (fDrive > 0) {
            const powerWatts = fDrive * this.speed;
            this.powerConsumption += (powerWatts / 1000) * (dt / 3600); // kWh
        }

        // 9. Update position
        const deltaPos = this.speed * dt;
        if (this.isReversing) {
            this.position -= deltaPos;
        } else {
            this.position += deltaPos;
        }

        // Boundary checks
        if (this.position < 0) {
            this.position = 0;
            this.speed = 0;
            this.acceleration = 0;
        } else if (this.position > this.totalLength) {
            this.position = this.totalLength;
            this.speed = 0;
            this.acceleration = 0;
        }
    }

    updateTrackProperties() {
        // Find current limit based on position
        // Tunnels speed limit = 70 km/h (19.4 m/s)
        // Curves/Stations limits = 40-50 km/h (11.1 - 13.8 m/s)
        // Straight open-air = 80 km/h (22.2 m/s)
        
        let limit = 70; // default (19.4 m/s)

        // Check if train is approaching or inside a station
        const trainCenter = this.isReversing ? (this.position + this.trainHalfLength) : (this.position - this.trainHalfLength);
        const nextStation = this.stations[this.nextStationIdx];
        const distToNext = Math.abs(trainCenter - nextStation.position);

        if (distToNext < 100) {
            limit = 40; // station approach limit 40 km/h
        } else if (distToNext < 200) {
            limit = 60; // station approach limit 60 km/h
        } else {
            // Standard limit based on station type
            const curStation = this.stations[this.currentStationIdx];
            if (curStation.type === "elevated" || curStation.type === "at-grade") {
                limit = 80; // elevated/open track limit 80 km/h
            } else {
                limit = 70; // tunnel limit 70 km/h
            }
        }

        // Named curve speed zones (e.g. U1's Messe -> Bauernfeindstraße), see this.curveSpeedZones
        for (const z of this.curveSpeedZones) {
            if (this.position > z.startPos && this.position < z.endPos) {
                limit = z.limitKmh;
                break;
            }
        }

        this.targetSpeed = limit / 3.6; // convert to m/s

        // Calculate gradient (slope in %) dynamically from visual spline height
        this.gradient = (this.getTrackY(this.position + 0.5) - this.getTrackY(this.position - 0.5)) * 100;
    }

    updatePneumatics(dt) {
        // 1. Consumption from Brakes
        // Air is consumed when C-Pressure increases (filling cylinders)
        const bzDiff = this.brakeCylinderPressure - this.lastBrakeCylinderPressure;
        if (bzDiff > 0.001) {
            // Increased consumption for more visible needle movement
            this.mainReservoirPressure -= bzDiff * 0.15;
        }
        this.lastBrakeCylinderPressure = this.brakeCylinderPressure;

        // 2. Consumption from Doors
        if (this.doorState === 1 || this.doorState === 3) {
            this.mainReservoirPressure -= dt * 0.05;
        }

        // 3. Compressor Logic
        if (this.mainReservoirPressure < 8.5) {
            this.compressorActive = true;
        }
        if (this.mainReservoirPressure > 10.0) {
            this.compressorActive = false;
        }

        if (this.compressorActive) {
            // Refill HBL
            this.mainReservoirPressure += dt * 0.15;
        }

        // Clamp HBL
        this.mainReservoirPressure = Math.max(0, Math.min(12, this.mainReservoirPressure));
    }

    updateDoors(dt) {
        if (this.doorState === 1) { // Opening
            this.doorProgress += dt * 0.8; // opens in ~1.2s
            if (this.doorProgress >= 1) {
                this.doorProgress = 1;
                this.doorState = 2; // Open
                this.doorsOpen = true;
            }
        } else if (this.doorState === 3) { // Closing
            this.doorProgress -= dt * 0.8; // closes in ~1.2s
            if (this.doorProgress <= 0) {
                this.doorProgress = 0;
                this.doorState = 0; // Closed
                this.doorsOpen = false;
                this.doorWarningActive = false;
            }
        }
    }

    triggerDoors() {
        if (this.speed > 0.01) return; // safety interlock: cannot open doors while moving

        if (this.doorState === 0 || this.doorState === 3) {
            // Start opening
            this.doorState = 1;
            this.currentPlatformSide = this.getPlatformSide();
            this.doorWarningActive = false;
        } else if (this.doorState === 2 || this.doorState === 1) {
            // Start closing
            this.doorState = 3;
        }
    }

    getPlatformSide() {
        const trainCenter = this.isReversing ? (this.position + this.trainHalfLength) : (this.position - this.trainHalfLength);

        // Use the station we are closest to (handles starting station and stop-advancing edge cases)
        let station = this.stations[this.nextStationIdx];
        const currentStation = this.stations[this.currentStationIdx];
        if (currentStation) {
            const dNext = Math.abs(trainCenter - station.position);
            const dCurr = Math.abs(trainCenter - currentStation.position);
            if (dCurr < dNext) station = currentStation;
        }

        if (!station) return 'left';

        // Nuremberg U1 rules (from the perspective of travel towards Langwasser Süd / Reverse):
        // 1. Scharfreiterring uses outer tracks -> Right exit.
        // 2. Side platforms (Bauernfeindstraße, Muggenhof, Stadtgrenze) -> Right exit.
        // 3. Island platforms (all others) -> Left exit.
        const isRightExit = station.side || station.name === "Scharfreiterring";
        const side = isRightExit ? 'right' : 'left';

        // The simulator drives on different tracks for different directions.
        // The current logic in getTrackXOffset ensures track separation.
        // For the reverse direction (Langwasser-bound), the current rules work.
        // For the forward direction (Hardhöhe-bound), we must invert the side.
        if (this.isReversing) {
            return side;
        } else {
            return (side === 'left') ? 'right' : 'left';
        }
    }

    advanceNextStation() {
        this.currentStationIdx = this.nextStationIdx;
        this.stopWaitTime = 0;
        this.pendingDisplayAdvance = true; // display will flip once train clears the station
        
        if (this.isReversing) {
            if (this.currentStationIdx > 0) {
                this.nextStationIdx = this.currentStationIdx - 1;
            } else {
                this.nextStationIdx = 0;
            }
        } else {
            if (this.currentStationIdx < this.stations.length - 1) {
                this.nextStationIdx = this.currentStationIdx + 1;
            } else {
                this.nextStationIdx = this.stations.length - 1;
            }
        }
    }

    updateStationCheck(dt) {
        const trainCenter = this.isReversing ? (this.position + this.trainHalfLength) : (this.position - this.trainHalfLength);
        const nextStation = this.stations[this.nextStationIdx];
        const distToStation = Math.abs(trainCenter - nextStation.position);
        const isAtPlatform = distToStation < 12;

        if (isAtPlatform) {
            // Update current station indices if we have stopped at the next station
            if (this.speed < 0.05 && this.nextStationIdx !== this.currentStationIdx) {
                this.stopWaitTime += dt;
                
                // Passenger boarding logic
                if (this.doorsOpen && this.doorState === 2) {
                    // Board passengers
                    const boardingRate = 12 * dt;
                    if (this.passengers < this.maxPassengers) {
                        const amount = Math.min(this.maxPassengers - this.passengers, boardingRate);
                        this.passengers += amount;
                    }
                    
                    // Award points for stopping perfectly
                    if (this.stopWaitTime < 1.0) { // run once when stopping
                        const deviation = Math.abs(trainCenter - nextStation.position);
                        if (deviation < 2) {
                            this.score += 100; // Perfect Stop!
                        } else if (deviation < 5) {
                            this.score += 50;  // Good Stop!
                        } else {
                            this.score += 10;  // OK Stop
                        }
                    }
                }

                // Auto-departure control: once waiting time is done, advance next station
                if (this.stopWaitTime > this.scheduledStopTime && !this.doorsOpen) {
                    this.advanceNextStation();
                }
            }
        } else {
            this.stopWaitTime = 0;

            // If we have driven past the platform center of the next station, auto-advance it!
            const passedForward = !this.isReversing && (trainCenter > nextStation.position + 12);
            const passedReverse = this.isReversing && (trainCenter < nextStation.position - 12);
            if (passedForward || passedReverse) {
                this.advanceNextStation();
            }
        }

        // Track delay (simple ticking schedule clock)
        // Timetable expects average speed of 36 km/h including stops
        // 36 km/h = 10 m/s. So scheduled position = time * 10 m/s (approx)
        // We calculate delay relative to cumulative average
        const expectedTimeForPosition = this.position / 9.5; // ~34 km/h average schedule
        this.scheduleOffset = this.time - expectedTimeForPosition;

        // Flip display once the train has cleared the current station platform (>20m away)
        if (this.pendingDisplayAdvance) {
            const prevStation = this.stations[this.currentStationIdx];
            if (prevStation) {
                const trainCenter = this.isReversing ? (this.position + this.trainHalfLength) : (this.position - this.trainHalfLength);
                const distFromPrev = Math.abs(trainCenter - prevStation.position);
                if (distFromPrev > 20) {
                    this.displayNextStationIdx = this.nextStationIdx;
                    this.pendingDisplayAdvance = false;
                    this.chimeRequested = true; // signal to TrainModel to play the chime
                }
            } else {
                this.displayNextStationIdx = this.nextStationIdx;
                this.pendingDisplayAdvance = false;
            }
        }
    }

    getCurveAheadConstraint(trainCenter, dir, decel) {
        // Antizipiert scharfe Kurven (this.curveSpeedZones): ein erfahrener Fahrer bremst VOR
        // der Kurve ab, nicht erst beim Erreichen der Zone. Returns the most restrictive
        // constraint across all zones (usually there's just one, as for U1's Messe curve).
        let result = Infinity;
        for (const z of this.curveSpeedZones) {
            const curveLimit = z.limitKmh / 3.6;
            const entrancePos = dir > 0 ? z.startPos : z.endPos;
            const exitPos = dir > 0 ? z.endPos : z.startPos;

            const distToExit = (exitPos - trainCenter) * dir;
            if (distToExit < 0) continue; // Kurve bereits vollständig passiert

            const distToEntrance = (entrancePos - trainCenter) * dir;
            const v = distToEntrance > 0
                ? Math.sqrt(Math.max(0, curveLimit * curveLimit + 2 * decel * distToEntrance))
                : curveLimit;
            if (v < result) result = v;
        }
        return result;
    }

    runATO(dt) {
        const nextStation = this.stations[this.nextStationIdx];
        const trainCenter = this.isReversing ? (this.position + this.trainHalfLength) : (this.position - this.trainHalfLength);
        const distToStation = Math.abs(trainCenter - nextStation.position);
        const dir = this.isReversing ? -1 : 1;

        // --- Stopped precisely at the platform ---
        if (this.speed < 0.05 && distToStation < 1.5) {
            this.throttle = -0.5; // hold brakes
            this.atoCoasting = false;
            if (this.doorState === 0 && this.stopWaitTime < this.scheduledStopTime - 3) {
                this.triggerDoors();
                this.atoDoorWarningPlayed = false;
            } else if (this.doorState === 2 && this.stopWaitTime >= this.scheduledStopTime - 2.8) {
                if (!this.atoDoorWarningPlayed) {
                    this.wantsDoorWarning = true;
                    this.doorWarningActive = true;
                    this.atoDoorWarningPlayed = true;
                }
                if (this.stopWaitTime >= this.scheduledStopTime - 2.0) this.triggerDoors();
            }
            return;
        }

        // Doors must be fully closed before the train is allowed to move. Anywhere other than
        // a correct platform stop (e.g. left open by a manual override away from a station) the
        // autopilot closes them itself, so it always keeps heading for the next stop once able.
        if (this.doorState !== 0) {
            this.throttle = -0.5;
            if (this.doorState === 1 || this.doorState === 2) {
                this.triggerDoors(); // command close (no-op if still moving, per its own interlock)
            }
            return;
        }

        // Target speed: min of track limit and station braking curve
        const decel = 0.75; // m/s² – conservative: actual brake force must meet or exceed this
        const stationTarget = distToStation > 1.5 ? Math.sqrt(2 * decel * distToStation) : 0;
        const target = Math.min(this.targetSpeed, stationTarget);

        const err = target - this.speed;
        const onApproach = stationTarget < this.targetSpeed;
        const brakeThreshold = onApproach ? 0 : -0.5;

        // Compute the desired throttle level
        let desired;
        if (err < brakeThreshold) {
            this.atoCoasting = false;

            // Comfortable, realistic brake envelope: gentle onset while still far from the
            // platform, ramping up to full authority through the main approach and HELD there
            // all the way to the stop — do not taper it off again near distance 0, or the train
            // loses the margin it needs over the 0.75 m/s² the braking curve assumes and can
            // roll straight through the stop instead of actually halting. The soft final touch
            // ("sanft kurz vorm Stillstand") is provided by the physics layer's own low-speed
            // snubbing (BRAKE_SNUBBING_MS2), which is independent of this cap.
            const farZone = 100; // m: gentle initial-brake envelope
            const rampEnd = 15;  // m: envelope reaches full strength by this distance out
            const brakeCap = distToStation > farZone
                ? 0.35
                : 0.35 + 0.65 * Math.min(1, (farZone - distToStation) / (farZone - rampEnd));

            const raw = -0.3 - Math.min(0.7, ((-err) - brakeThreshold) * 0.2);
            desired = Math.max(-brakeCap, raw);
        } else if (!onApproach) {
            // Cruising on the open track: once the speed limit is reached, roll in neutral
            // (coast) and only re-apply power once speed has decayed 10 km/h below it — e.g.
            // hold at 80 km/h by coasting down to 70 km/h before accelerating again, instead of
            // continuously chattering the throttle to hold the limit exactly.
            const coastBand = 10 / 3.6;
            if (!this.atoCoasting && this.speed >= this.targetSpeed) {
                this.atoCoasting = true;
            } else if (this.atoCoasting && this.speed <= this.targetSpeed - coastBand) {
                this.atoCoasting = false;
            }

            if (this.atoCoasting) {
                desired = 0;
            } else if (err > 1.0) {
                desired = Math.min(1.0, 0.4 + Math.min(0.6, (err - 1.0) * 0.12));
            } else {
                desired = 0;
            }
        } else {
            this.atoCoasting = false;
            desired = 0;
        }

        // Slew-rate limit: throttle may only change by 0.6 per second.
        // This smooths out rapid flip-flopping between thrust and coast.
        const maxChange = dt * 0.6;
        this.throttle += Math.max(-maxChange, Math.min(maxChange, desired - this.throttle));
    }

    triggerEmergencyBrake() {
        this.emergencyBrake = !this.emergencyBrake;
        if (this.emergencyBrake) {
            this.throttle = -1;
        } else {
            this.emergencyBrake = false;
        }
    }

    reverseTrain() {
        // Toggle reversing direction
        this.isReversing = !this.isReversing;

        // Reset speed and throttle to holding brakes
        this.speed = 0;
        this.throttle = -0.5;
        this.brakeCylinderPressure = 2.25; // apply partial brakes

        // Recompute next station index
        if (this.isReversing) {
            this.nextStationIdx = Math.max(0, this.currentStationIdx - 1);
        } else {
            this.nextStationIdx = Math.min(this.stations.length - 1, this.currentStationIdx + 1);
        }

        // Reset waiting timers
        this.stopWaitTime = 0;
    }

    resetSifa() {
        this.sifaTimer = 0;
        this.sifaWarning = false;
    }
}
