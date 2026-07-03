import * as THREE from 'three';
import { TRACK_DATA as TD } from './TrackData.js?v=48';

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
    constructor() {
        // ---------------------------------------------------------------
        // Track geometry & stations are sourced from Schienen.geojson and
        // precomputed into TrackData.js: the centerline of the route, the
        // inter-track spacing, every station's position/length, the
        // elevation transitions and the decorative side tracks. The whole
        // route is scaled so its length equals 18500 m.
        // ---------------------------------------------------------------
        this.track = TD;

        this.stations = [];
        TD.stations.forEach((s, idx) => {
            const center = this.getTrackPosition(s.position);
            const tangent = this.getTrackTangent(s.position);
            const distPrev = (idx === 0) ? s.position : (s.position - TD.stations[idx - 1].position);

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

        this.totalLength = TD.total;

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
        this.plaerrer = this.stations.find(s => s.name === "Plärrer") || null;
        this.plaerrerDrop = 10.0;  // lower level depth below the upper level (Gleis 2 ≈ -16.5 m)
        this.plStackHalf = 150;    // (zone half-extent = plStackHalf + plRamp; tubes span it)
        this.plRamp = 300;         // the tubes/dive reach this far past the stacked core

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
        this.currentRadioStationIdx = 0;
        this.radioMenuOpen = false;
        this.wantsRadioPlay = false;
    }
 
    get trainHalfLength() {
        // Maßstab 1:1 – 1 Einheit = 1 Meter. Halbe Gesamtzuglänge (G1 = 76,170 m, DT1 ≈ 74,3 m).
        return this.trainModelType === 'G1' ? 38.085 : 37.15;
    }

    getTrackPosition(dist, target = new THREE.Vector3()) {
        const res = this.getTrackPositionAndTangent(dist);
        return target.copy(res.position);
    }

    getTrackTangent(dist, target = new THREE.Vector3()) {
        const res = this.getTrackPositionAndTangent(dist);
        return target.copy(res.tangent);
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
    // the correct stacked Plärrer level: the upper level when heading to Hardhöhe (forward),
    // the lower level when heading to Langwasser Süd (reverse).
    getTrackElevationOffset(dist, reversing) {
        return reversing ? this.getLowerLevelOffset(dist) : 0;
    }

    // True inside the bespoke Plärrer zone (platform + the two-tube split on each side),
    // where the generic tunnel tube / running rails are suppressed and replaced by the
    // custom stacked-station geometry.
    isPlaerrerZone(dist) {
        const p = this.plaerrer;
        if (!p) return false;
        return Math.abs(dist - p.position) <= this.plStackHalf + this.plRamp;
    }

    getTrackY(z) {
        // Elevation profile. Levels: underground -6.5 m, surface 0 m, elevated +7 m.
        // Transition distances (portals / open-cut shafts / ramps) come from TrackData
        // and are re-anchored to the geojson station positions.
        const e = this.track.elevation;
        const UG = -6.5, EL = 7.0;

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

    getTrackPositionAndTangent(dist) {
        // Smooth Catmull-Rom interpolation of the precomputed geojson centerline
        // (TrackData.cx / cz, sampled every TrackData.step metres of arc length).
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

        const t2 = t * t, t3 = t2 * t;
        const cr = (p0, p1, p2, p3) =>
            0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        const crDeriv = (p0, p1, p2, p3) =>
            0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2);

        const x = cr(cx[i0], cx[i1], cx[i2], cx[i3]);
        const z = cr(cz[i0], cz[i1], cz[i2], cz[i3]);
        const dx = crDeriv(cx[i0], cx[i1], cx[i2], cx[i3]);
        const dz = crDeriv(cz[i0], cz[i1], cz[i2], cz[i3]);
        const len = Math.sqrt(dx * dx + dz * dz) || 1;

        const tangent = new THREE.Vector3(dx / len, 0, dz / len);
        const position = new THREE.Vector3(x, this.getTrackY(dist), z);
        return { position, tangent };
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

        // Special curves speed limit (e.g. between Messe and Bauernfeindstraße)
        const s5 = this.stations[5].position;
        const s6 = this.stations[6].position;
        if (this.position > s5 + 0 && this.position < s6 - 0) {
            limit = 50; // sharp curve
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
        // 2. Side platforms (Messe, Bauernfeindstraße, Muggenhof, Stadtgrenze) -> Right exit.
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
        // Antizipiert die scharfe Kurve zwischen Messe and Bauernfeindstraße:
        // ein erfahrener Fahrer bremst VOR der Kurve ab, nicht erst beim Erreichen der Zone.
        const s6 = this.stations[5].position;
        const s7 = this.stations[6].position;
        const zoneStart = s6 + 0;
        const zoneEnd = s7 - 0;
        const curveLimit = 50 / 3.6;

        const entrancePos = dir > 0 ? zoneStart : zoneEnd;
        const exitPos = dir > 0 ? zoneEnd : zoneStart;

        const distToExit = (exitPos - trainCenter) * dir;
        if (distToExit < 0) {
            return Infinity; // Kurve bereits vollständig passiert
        }

        const distToEntrance = (entrancePos - trainCenter) * dir;
        if (distToEntrance > 0) {
            // Noch vor der Kurve: zulässige Geschwindigkeit JETZT, um rechtzeitig auf curveLimit zu kommen
            return Math.sqrt(Math.max(0, curveLimit * curveLimit + 2 * decel * distToEntrance));
        }
        // Bereits innerhalb der Kurvenzone
        return curveLimit;
    }

    runATO(dt) {
        const nextStation = this.stations[this.nextStationIdx];
        const trainCenter = this.isReversing ? (this.position + this.trainHalfLength) : (this.position - this.trainHalfLength);
        const distToStation = Math.abs(trainCenter - nextStation.position);
        const dir = this.isReversing ? -1 : 1;

        // --- Stopped at platform ---
        if (this.speed < 0.05 && distToStation < 1.5) {
            this.throttle = -0.5; // hold brakes
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

        // Wait for doors to close before departing
        if (this.doorState !== 0 || this.doorProgress > 0) {
            this.throttle = -0.5;
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
            desired = Math.max(-1.0, -0.3 - Math.min(0.7, ((-err) - brakeThreshold) * 0.2));
        } else if (err > 1.0 && !onApproach) {
            desired = Math.min(1.0, 0.4 + Math.min(0.6, (err - 1.0) * 0.12));
        } else {
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
