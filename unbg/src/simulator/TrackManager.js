import * as THREE from 'three';
import { StationBuilder } from './stations/StationBuilder.js?v=69';
import { tagCanvasTextureSRGBKeepLook } from './TextureUtils.js';

// ============================================================================
// TrackManager.js — Gleis-, Tunnel- und Umgebungs-Geometrie EINER Linie,
// gestreamt in 50-m-Chunks entlang der Bogenlänge.
//
// KI-LANDKARTE (wo bearbeite ich was):
//   - Materialien/Texturen: Konstruktor (this.materials) + create*Texture/
//     create*Material am Dateiende. Geometrien: this.geometries.
//   - Chunk-Streaming: update(trainZ) hält ein Fenster aktiver Chunks
//     (chunkCache = für immer, activeChunks = aktuell in der Szene);
//     createChunk(idx) baut einen 50m-Abschnitt komplett (Bett, Schienen,
//     Stromschiene, Tunnelröhre, Lampen, Portale, Stadt-Umfeld).
//   - Chunk-Unterdrückung in Sonderzonen: _clampInterval + die isPlaerrerZone/
//     isTrunkZone/isSwitchZone-Checks in createChunk (dort baut die Linie
//     NICHTS, weil die geteilten Rigs aus main.js die Geometrie stellen).
//   - Bespoke-Bauten (einmalig, von main.js in die Welt-Szene gehängt):
//     buildPlaerrer (gestapelte Halle, setzt this.plaerrerGroup),
//     buildPlaerrerApproach (U2/U3-Zulauf), buildSwitchTransition (Weichen).
//   - Tunnelquerschnitt: getTunnelHalfWidth/getTunnelCeilingHeight/
//     getTunnelSideWidth (Stationsaufweitung etc.).
//   - Kontinuierlich gekrümmte Meshes: buildSweptTrackBox/buildSweptFence
//     (ein BufferGeometry pro Lauf statt 5m-Kisten).
//   - Instancing: addBatched/addBatchedMatrix in createChunk bündelt kleine
//     Wiederhol-Meshes pro (Geometrie, Material) zu je EINEM InstancedMesh.
// KOORDINATEN: 1 Einheit = 1 m; "s"/"z"-Parameter sind Bogenlänge ab
// Streckenanfang, Weltkoordinaten kommen aus sim.getTrackPosition(s).
// ============================================================================
export class TrackManager {
    constructor(scene, simulation) {
        this.scene = scene;
        this.sim = simulation;
        this.userData = {}; // For hooks and shared data

        // Chunk configuration
        this.chunkSize = 50; // meters per track segment
        this.visibleChunksCount = 40; // load +/- 40 chunks (4km total window)
        this.tunnelChunksCount = 4; // reduced window when fully underground (darkness hides the distance)
        this.chunkCache = new Map(); // chunkIndex -> THREE.Group, built once and kept forever
        this.activeChunks = new Map(); // chunkIndex -> THREE.Group currently in the scene
        
        const ballastTex = this.createBallastTexture();
        const concreteBedTex = this.createConcreteBedTexture();
        const darkSleeperTex = this.createTunnelConcreteTexture();
        this.materials = {
            // Rail cross-section is split into a dark steel body (this.geometries.rail) and
            // a separate glossy head cap (this.geometries.railHead) sitting on top of it, so
            // the "white shine" only affects the top running surface, not the whole rail.
            rail: new THREE.MeshLambertMaterial({ color: '#3b3530' }),
            railHead: new THREE.MeshPhongMaterial({ color: '#d8d8d8', specular: '#ffffff', shininess: 120 }),
            // Small fastener clips (Halterungen) connecting underground (Innenstrecke) rails
            // to the concrete Gleisbett every 20cm, instead of gravel + cross-ties.
            railClip: new THREE.MeshLambertMaterial({ color: '#292824' }),
            tunnelRailClip: new THREE.MeshLambertMaterial({ color: '#1c1a18' }),
            // Open-air (Außenstrecke) sleepers/ties, kept but recolored to a dark concrete
            // texture instead of flat light grey.
            sleeper: new THREE.MeshLambertMaterial({ map: darkSleeperTex, color: '#ffffff' }),
            // side: DoubleSide on ballast/tunnelBallast/viaduct because they are swept into
            // continuous curved beds/fences (buildSweptTrackBox) that bend both left and
            // right along the route; DoubleSide sidesteps any winding-order ambiguity from
            // the curl direction instead of needing to special-case it (these 3 materials
            // are used exclusively for that swept geometry, so this is safe to set globally).
            
            ballast: new THREE.MeshLambertMaterial({
                map: ballastTex,
                side: THREE.DoubleSide
            }),
            // Ballastless concrete Gleisbett for underground (Innenstrecke) track — replaces
            // gravel ballast there entirely (lit station-platform / dark plain-tunnel variant).
            innerBed: new THREE.MeshLambertMaterial({ map: concreteBedTex, side: THREE.DoubleSide }),
            tunnelInnerBed: new THREE.MeshLambertMaterial({ map: concreteBedTex, color: '#888888', side: THREE.DoubleSide }),
            thirdRail: new THREE.MeshLambertMaterial({ color: '#cccccc' }), // light grey matte metal power rail
            tunnelWall: new THREE.MeshLambertMaterial({ map: this.createTunnelConcreteTexture(), color: 0xffffff, side: THREE.DoubleSide }),
            dividerWall: new THREE.MeshLambertMaterial({ map: this.createTunnelConcreteTexture(), color: 0xffffff, side: THREE.DoubleSide }),
            dividerPillar: new THREE.MeshLambertMaterial({ map: this.createTunnelConcreteTexture(), color: 0xffffff }),
            tunnelBallast: new THREE.MeshLambertMaterial({ map: ballastTex, color: '#888888', side: THREE.DoubleSide }),
            tunnelRail: new THREE.MeshLambertMaterial({ color: '#241f1c' }),
            tunnelRailHead: new THREE.MeshPhongMaterial({ color: '#8a8a8a', specular: '#cccccc', shininess: 80 }),
            tunnelSleeper: new THREE.MeshLambertMaterial({ map: darkSleeperTex, color: '#666666' }),
            tunnelThirdRail: new THREE.MeshLambertMaterial({ color: '#bbbbbb' }),
            viaduct: new THREE.MeshLambertMaterial({ color: '#4a4a4a', side: THREE.DoubleSide }),
            wall: new THREE.MeshLambertMaterial({ color: '#333333' }),
            cable: new THREE.MeshLambertMaterial({ color: '#000000' }),
            portal: new THREE.MeshLambertMaterial({ color: '#2c3e50' }),
            fence: new THREE.MeshLambertMaterial({
                map: this.createFenceTexture(),
                transparent: true,
                alphaTest: 0.5,
                side: THREE.DoubleSide
            }),
            fencePostMat: new THREE.MeshLambertMaterial({ color: '#b0b0b0' }),
            concrete: this.createRoughConcreteMaterial(),
            // Neon lights materials
            tunnelGlow: new THREE.MeshBasicMaterial({ color: '#ffffff' }), // white neon glow
            tunnelFixtureMat: new THREE.MeshLambertMaterial({ color: '#1e293b' }), // dark Slate casing
            neonHaloMat: new THREE.MeshBasicMaterial({
                map: this.createNeonHaloTexture(),
                blending: THREE.NormalBlending,
                transparent: true,
                depthWrite: false,
                color: 0xffffff,
                side: THREE.DoubleSide
            }),

            plaerrerHaloMat: new THREE.MeshBasicMaterial({
                map: this.createEdgeNeonHaloTexture(),
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false,
                color: 0x888888,
                side: THREE.DoubleSide
            }),
            
            // City materials
            street: new THREE.MeshLambertMaterial({ 
                map: this.createStreetTexture() 
            }),
            window: new THREE.MeshBasicMaterial({ color: '#ffcc44' }),
            building: new THREE.MeshLambertMaterial({ color: '#f1f5f9' }),

            // Ground (clouds are now part of WorldManager's sky-photo background)
            // side: DoubleSide because the shaft cutout strips are now swept continuously
            // (buildSweptTrackBox) along curves in both directions; harmless for the flat
            // plane usage elsewhere.
            ground: (() => {
                const tex = this.createGrassTexture();
                tex.repeat.set(0.1, 0.1);
                return new THREE.MeshLambertMaterial({
                    map: tex,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor: 4,
                    polygonOffsetUnits: 4
                });
            })()
        };
        
        // PRE-CREATE ALL GEOMETRIES AT STARTUP
        // This avoids memory allocations, Garbage Collection, and GPU buffer re-uploads during the game loop.
        this.geometries = {
            // Typical Vignole rail profile (foot / web / head), unit length for dynamic
            // scaling; the flat glossy head cap is a separate geometry (see below) so it can
            // carry its own "white shine" material without splitting extrude face groups.
            rail: this.createRailBodyGeometry(),
            railHead: this.createRailHeadGeometry(),
            railClip: new THREE.BoxGeometry(0.16, 0.03, 0.06), // small fastener connecting inner rails to the concrete Gleisbett
            sleeper: new THREE.BoxGeometry(2.4, 0.12, 0.3),
            thirdRail: new THREE.BoxGeometry(0.12, 0.15, 1.0), // unit length
            thirdRailCover: new THREE.BoxGeometry(0.24, 0.08, 1.0), // unit length
            fencePost: new THREE.BoxGeometry(0.04, 1.0, 0.04),
            
            // Tunnel Elements (rectangular cross-section, built procedurally)
            // tunnelWall geometry is built procedurally in createTunnelWallMesh;
            // dividerWall likewise (buildSweptTrackBox, continuously curved) —
            // only the discrete dividerPillar still uses a shared box geometry.
            dividerPillar: new THREE.BoxGeometry(0.5, 1, 0.5), // unit height, scaled per segment
            tunnelFixture: new THREE.BoxGeometry(0.12, 0.08, 1.2), // thin casing along Z
            tunnelGlow: new THREE.BoxGeometry(0.08, 0.04, 1.0), // neon tube along Z
            tunnelHalo: (() => {
                const g = new THREE.PlaneGeometry(5.25, 12.0);
                g.rotateX(-Math.PI / 2);
                return g;
            })(),
            
            // Viaduct Bridge Elements
            viaductPillar: new THREE.CylinderGeometry(1.5, 1.8, 20, 8),
            embankmentBase: new THREE.BoxGeometry(10.0, 1.0, 5.0),
  
            // City Elements
            building: new THREE.BoxGeometry(1, 1, 1),
            window: new THREE.PlaneGeometry(1, 1),
            street: new THREE.PlaneGeometry(6, 5.0), // 5m street sub-segments
        };

        // Align geometries
        // tunnelWall geometry is built procedurally (no pre-created geometry to rotate)

        this.geometries.street.rotateX(-Math.PI / 2);

        // Pre-create the portal extrude geometry
        this.geometries.portal = this.createPortalGeometry();

        // Apply world-space-like UV mapping to the divider pillar (an
        // InstancedMesh, scaled per instance) so the texture tiles
        // consistently. Since it's a simple box, we can adjust the UVs of the
        // base geometry so that after scaling it lands closer to our 4m target.
        const scaleUV = (geom, sx, sy, sz) => {
            const uv = geom.attributes.uv;
            for (let i = 0; i < uv.count; i++) {
                // Determine which face this vertex belongs to based on normal
                // (Quick hack for BoxGeometry: 6 groups of 4 vertices)
                const groupIdx = Math.floor(i / 4);
                if (groupIdx === 0 || groupIdx === 1) { // ±X faces (height x depth)
                    uv.setXY(i, uv.getX(i) * sz / 4, uv.getY(i) * sy / 4);
                } else if (groupIdx === 2 || groupIdx === 3) { // ±Y faces (width x depth)
                    uv.setXY(i, uv.getX(i) * sx / 4, uv.getY(i) * sz / 4);
                } else { // ±Z faces (width x height)
                    uv.setXY(i, uv.getX(i) * sx / 4, uv.getY(i) * sy / 4);
                }
            }
            uv.needsUpdate = true;
        };
        // dividerPillar is scaled by (dividerWidth, 6.6, dividerWidth) per instance.
        // We can't perfectly match per-instance width here, but we can fix height (6.6) and length (1.0).
        scaleUV(this.geometries.dividerPillar, 1.0, 6.6, 1.0);

        
        // Pre-create a shared sleeper InstancedMesh template matrix
        this.sleepersPerChunk = 25; // 25 sleepers per chunk for perfect curves
        this._sleeperMatrix = new THREE.Matrix4();

        // Decorative side tracks (sidings / depot leads) were removed for performance:
        // they were never drivable and their InstancedMeshes (frustumCulled = false)
        // were rendered from everywhere on the line.

        // Plärrer: the bespoke stacked station (lower Langwasser platform + upper Hardhöhe
        // hall + diverging tubes) is built from main.js AFTER the StationModel exists, so it
        // can reuse the station floor/stair textures. See buildPlaerrer(stationModel).

        // U2<->U3 switch transitions (Rothenburger Straße / Rathenauplatz) are a shared,
        // hand-authored piece built ONCE by main.js (TrackManager.buildSwitchTransition, same
        // idiom as buildPlaerrer) and added directly to the world scene -- nothing to do here;
        // this line's own chunk generation just skips that arc range (Simulation.isSwitchZone,
        // see createChunk).

        // U2/U3 only: bespoke stacked approach tracks + tubes through this line's own
        // Plärrer zone, meeting the permanent shared hall's Gleis 3/4 mock stubs flush.
        this.buildPlaerrerApproach();
    }

    // ---------- shared low-level helpers for bespoke (non-chunk) track rendering ----------

    // Matrix placing a unit-length box between A and B, shifted `lateral` metres to the
    // right of the segment direction and `yOff` up (same math as buildPlaerrer's local
    // segMatrix; duplicated there to keep that fragile builder untouched).
    _trackSegMatrix(A, B, lateral, yOff) {
        const dir = new THREE.Vector3().subVectors(B, A);
        const length = dir.length();
        if (length < 0.01) return null;
        dir.normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, dir).normalize();
        const aUp = new THREE.Vector3().crossVectors(dir, right).normalize();
        const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5).addScaledVector(right, lateral);
        mid.y += yOff;
        const m = new THREE.Matrix4().makeBasis(right, aUp, dir);
        m.setPosition(mid);
        m.multiply(new THREE.Matrix4().makeScale(1, 1, length));
        return m;
    }

    _newTrackCollectors() {
        return { bed: [], sleeper: [], rail: [], railHead: [], power: [], cover: [] };
    }

    // Collect bed/rail/railHead/power/cover (+ optional sleeper) instance matrices for ONE
    // track whose CENTER runs along pts[] (world-space points at track elevation). Same
    // per-part offsets as buildPlaerrer's renderTrack, so bespoke track built here joins
    // the hall's mock Gleis 3/4 stubs seamlessly.
    _collectTrackRun(coll, pts, { powerSide = 1, sleepers = false } = {}) {
        const GAUGE = 0.7175, POWER = 1.1;
        for (let i = 0; i < pts.length - 1; i++) {
            const A = pts[i], B = pts[i + 1];
            const push = (arr, lateral, yOff) => {
                const m = this._trackSegMatrix(A, B, lateral, yOff);
                if (m) arr.push(m);
            };
            // The ballast box (coll.bed) is removed to prevent Z-fighting with the concrete slab.
            // push(coll.bed, 0, -0.375);
            push(coll.rail, -GAUGE, -0.21); push(coll.railHead, -GAUGE, -0.21);
            push(coll.rail, GAUGE, -0.21); push(coll.railHead, GAUGE, -0.21);
            push(coll.power, powerSide * POWER, -0.05);
            push(coll.cover, powerSide * POWER, 0.03);
            if (sleepers) {
                const dir = new THREE.Vector3().subVectors(B, A);
                const length = dir.length();
                if (length < 0.01) continue;
                const angle = Math.atan2(dir.x, dir.z);
                const nS = Math.max(1, Math.round(length / 2));
                for (let s = 0; s < nS; s++) {
                    const t = (s + 0.5) / nS;
                    const pp = A.clone().lerp(B, t);
                    const m = new THREE.Matrix4().makeRotationY(angle);
                    m.setPosition(pp.x, pp.y - 0.25, pp.z);
                    coll.sleeper.push(m);
                }
            }
        }
    }

    _addInstanced(group, geom, mat, matrices) {
        if (!matrices.length) return;
        const im = new THREE.InstancedMesh(geom, mat, matrices.length);
        matrices.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        group.add(im);
    }

    _emitTrackCollectors(group, coll) {
        if (!this._bespokeBedGeom) this._bespokeBedGeom = new THREE.BoxGeometry(3.6, 0.15, 1.0);
        this._addInstanced(group, this._bespokeBedGeom, this.materials.tunnelBallast, coll.bed);
        this._addInstanced(group, this.geometries.sleeper, this.materials.tunnelSleeper, coll.sleeper);
        this._addInstanced(group, this.geometries.rail, this.materials.tunnelRail, coll.rail);
        this._addInstanced(group, this.geometries.railHead, this.materials.tunnelRailHead, coll.railHead);
        this._addInstanced(group, this.geometries.thirdRail, this.materials.tunnelThirdRail, coll.power);
        this._addInstanced(group, this.geometries.thirdRailCover, this.materials.tunnelThirdRail, coll.cover);
    }

    // ONE rectangular tunnel-wall mesh (floor/ceiling/side walls, inward-facing, 4m-tiled
    // UVs like createTunnelWallMesh) swept along an arbitrary world-space centerline --
    // used for the junction branch tubes, which don't follow the own line's arc
    // parametrization. pts are at track elevation; floor/ceiling match the mainline tunnel
    // cross-section (centre offset +0.8: floor -2.8, ceiling +3.8 -> -2.0 / +4.6 here).
    _buildPolylineTunnel(group, pts, halfWFn, floorY = -2.0, ceilY = 4.6, hideWallFlags = null) {
        if (pts.length < 2) return null;
        const vertices = [], uvs = [], indices = [];
        let cum = 0;
        for (let i = 0; i < pts.length; i++) {
            const P = pts[i];
            const Pn = pts[Math.min(pts.length - 1, i + 1)];
            const Pp = pts[Math.max(0, i - 1)];
            const tan = new THREE.Vector3().subVectors(Pn, Pp);
            tan.y = 0;
            tan.normalize();
            const nX = -tan.z, nZ = tan.x;
            if (i > 0) cum += P.distanceTo(pts[i - 1]);
            const hw = halfWFn(i);
            const corners = [[-hw, floorY], [hw, floorY], [hw, ceilY], [-hw, ceilY], [-hw, floorY]];
            let per = 0, prev = null;
            for (const [lat, y] of corners) {
                if (prev) per += Math.hypot(lat - prev[0], y - prev[1]);
                prev = [lat, y];
                vertices.push(P.x + nX * lat, P.y + y, P.z + nZ * lat);
                uvs.push(per / 4.0, cum / 4.0);
            }
        }
        const vertsPerRing = 5;
        for (let r = 0; r < pts.length - 1; r++) {
            const hideRight = hideWallFlags && hideWallFlags[r] === 'right';
            const hideLeft = hideWallFlags && hideWallFlags[r] === 'left';
            for (let k = 0; k < 4; k++) {
                if (k === 1 && hideRight) continue;
                if (k === 3 && hideLeft) continue;
                const a = r * vertsPerRing + k;
                const b = a + 1;
                const c = a + vertsPerRing;
                const d = b + vertsPerRing;
                indices.push(a, b, c, b, d, c);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, this.materials.tunnelWall);
        group.add(mesh);
        return mesh;
    }

    // Cubic Hermite evaluator: p0/p1 endpoint positions, t0/t1 endpoint TANGENT VECTORS already
    // scaled to the desired "pull" (standard practice: chord length, so the curve doesn't
    // overshoot or undershoot). u in [0,1]. Used by buildSwitchTransition for a smooth,
    // mathematically continuous (C1: matches position AND direction at both ends) branch
    // curve -- unlike the old GPS-survey-derived junction geometry, this is exact by construction.
    _hermitePoint(p0, t0, p1, t1, u) {
        const u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        return new THREE.Vector3(
            h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x,
            h00 * p0.y + h10 * t0.y + h01 * p1.y + h11 * t1.y,
            h00 * p0.z + h10 * t0.z + h01 * p1.z + h11 * t1.z,
        );
    }

    _rawFrameAt(sim, s) {
        const pos = new THREE.Vector3();
        const tan = new THREE.Vector3();
        sim.getTrackPositionAndTangent(s, pos, tan);
        return { pos, tan, spacing: sim.getTrackSpacing(s) };
    }

    _buildSingleTrackBranch(group, coll, pts, sim, reversing, partnerPts = null, pairSide = null) {
        // Build the single-track tube (width 3.1m from center)
        const hideWallFlags = [];
        for (let r = 0; r < pts.length - 1; r++) {
            let flag = null;
            if (partnerPts && r < partnerPts.length) {
                const dist = pts[r].distanceTo(partnerPts[r]);
                if (dist < 6.5) {
                    flag = pairSide === 'left' ? 'right' : 'left';
                }
            }
            hideWallFlags.push(flag);
        }

        this._buildPolylineTunnel(group, pts, (i) => 3.1, -2.0, 4.6, hideWallFlags);

        // Build concrete track bed
        const bedMesh = this._buildPolylineTunnel(group, pts, (i) => 1.6, -0.7, -0.3);
        if (bedMesh) {
            bedMesh.material = this.materials.tunnelInnerBed;
        }
        
        // Add lighting fixtures (lamps every ~10m)
        const lampM = [], glowM = [], haloM = [];
        const ceilY = 3.8;
        const Y_center = 0.8;
        const Y_lamp = Y_center + ceilY - 0.06;
        const one = new THREE.Vector3(1, 1, 1);
        
        for (let i = 0; i < pts.length - 1; i++) {
            const A = pts[i], B = pts[i + 1];
            const len = A.distanceTo(B);
            if (len < 0.01) continue;
            // Place lamps every ~25m to match generic tunnels (2 per 50m).
            // steps=100 over 350m -> each step is ~3.5m. 7 steps = 24.5m.
            if (i % 7 !== 0) continue;
            
            const dirVec = new THREE.Vector3().subVectors(B, A).normalize();
            const angle = Math.atan2(dirVec.x, dirVec.z);
            
            const normal = new THREE.Vector3(-dirVec.z, 0, dirVec.x);
            const hw = 3.1 - 0.08;
            
            // Right wall only
            const pt = A.clone().addScaledVector(normal, hw);
            pt.y += Y_lamp;
            
            // Right wall tilt is +PI/4 in createTunnelLights
            const tilt = Math.PI / 4;
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, tilt));
            const fm = new THREE.Matrix4().compose(pt, q, one);
            lampM.push(fm);
            
            const gm = fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.041, 0));
            glowM.push(gm);
            
            // Halos (Right wall uses `angle` directly)
            const chm = new THREE.Matrix4().compose(
                new THREE.Vector3(pt.x, pt.y + 0.05, pt.z),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
                one
            );
            chm.multiply(new THREE.Matrix4().makeTranslation(1.6, 0, 0));
            haloM.push(chm);
            
            const whm = new THREE.Matrix4().compose(
                new THREE.Vector3(pt.x, pt.y, pt.z),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, -Math.PI / 2)),
                one
            );
            whm.multiply(new THREE.Matrix4().makeTranslation(1.5, 0, 0));
            haloM.push(whm);
        }
        
        this._addInstanced(group, this.geometries.tunnelFixture, this.materials.tunnelFixtureMat, lampM);
        this._addInstanced(group, this.geometries.tunnelGlow, this.materials.tunnelGlow, glowM);
        this._addInstanced(group, this.geometries.tunnelHalo, this.materials.neonHaloMat, haloM);
        
        // Track rails etc
        const buildTrackPts = () => pts.map(p => p.clone());
        // For power rail side, use 1 (standard)
        this._collectTrackRun(coll, buildTrackPts(), { powerSide: 1 });
    }

    buildSwitchTransition(u2Sim, u3Sim, stationName, name) {
        const SWITCH_LEN = 350;
        const dir = stationName === 'Rothenburger Straße' ? -1 : 1;
        const st2 = u2Sim.stations.find(s => s.name === stationName);
        const st3 = u3Sim.stations.find(s => s.name === stationName);
        if (!st2 || !st3) return null;

        const group = new THREE.Group();
        group.name = `switchTransition_${name}`;
        const coll = this._newTrackCollectors();

        const getBaseFrame = (sim, st, isStart, isSplit) => {
            const offset = isStart ? 0 : (isSplit ? 10 : 10 + SWITCH_LEN);
            const d = st.position + dir * (st.halfLength + offset);
            const frame = this._rawFrameAt(sim, d);
            frame.tan.multiplyScalar(dir); // flip tangent if dir=-1
            frame.dist = d;
            return frame;
        };

        const trunkFrameStart = getBaseFrame(u2Sim, st2, true, false);
        const trunkFrameSplit = getBaseFrame(u2Sim, st2, false, true);
        const u2FrameExit = getBaseFrame(u2Sim, st2, false, false);
        const u3FrameExit = getBaseFrame(u3Sim, st3, false, false);

        const getSingleTrackFrame = (base, sgn) => {
            const hw = base.spacing / 2;
            const pos = base.pos.clone().addScaledVector(new THREE.Vector3(-base.tan.z, 0, base.tan.x), sgn * hw);
            return { pos, tan: base.tan.clone(), hw: hw, dist: base.dist };
        };

        const generateBranchPoints = (sim, sgn, endBase, isDiving, maxSwing) => {
            const startF = getSingleTrackFrame(trunkFrameStart, sgn);
            const splitF = getSingleTrackFrame(trunkFrameSplit, sgn);
            const endF = getSingleTrackFrame(endBase, sgn);
            const reversing = sgn === -1;
            
            const pts = [];
            
            // 1. Straight part: from startF to splitF
            const straightSteps = 5;
            for (let i = 0; i < straightSteps; i++) {
                const u = i / straightSteps;
                const p = new THREE.Vector3().lerpVectors(startF.pos, splitF.pos, u);
                pts.push(p);
            }
            
            // 2. Spline part: from splitF to endF
            const splineSteps = 95;
            const chord = splitF.pos.distanceTo(endF.pos);
            const t0 = splitF.tan.clone().normalize().multiplyScalar(chord);
            const t1 = endF.tan.clone().normalize().multiplyScalar(chord);
            for (let i = 0; i <= splineSteps; i++) {
                const u = i / splineSteps;
                const p = this._hermitePoint(splitF.pos, t0, endF.pos, t1, u);
                
                const u2 = u * u;
                const dh00 = 6*u2 - 6*u;
                const dh10 = 3*u2 - 4*u + 1;
                const dh01 = -6*u2 + 6*u;
                const dh11 = 3*u2 - 2*u;
                const tan = new THREE.Vector3(
                    dh00 * splitF.pos.x + dh10 * t0.x + dh01 * endF.pos.x + dh11 * t1.x,
                    dh00 * splitF.pos.y + dh10 * t0.y + dh01 * endF.pos.y + dh11 * t1.y,
                    dh00 * splitF.pos.z + dh10 * t0.z + dh01 * endF.pos.z + dh11 * t1.z
                );
                tan.y = 0;
                tan.normalize();
                
                if (isDiving) {
                    // Apply Y dive (starts at u=0.1, max -12.0m at u=0.55, climbs back to 0 at u=1.0)
                    let diveVal = 0;
                    if (u >= 0.1 && u < 0.55) {
                        const t = (u - 0.1) / 0.45;
                        diveVal = -12.0 * (1 - Math.cos(Math.PI * t)) / 2;
                    } else if (u >= 0.55 && u <= 1.0) {
                        const t = (u - 0.55) / 0.45;
                        diveVal = -12.0 * (1 + Math.cos(Math.PI * t)) / 2;
                    }
                    p.y += diveVal;
                    
                    // Apply lateral swing (swing outwards up to maxSwing, C1 smooth, returns to 0 at u=0.9)
                    const normal = new THREE.Vector3(-tan.z, 0, tan.x);
                    let swingVal = 0;
                    if (u < 0.9) {
                        swingVal = maxSwing * Math.pow(Math.sin(Math.PI * u / 0.9), 2);
                    }
                    const sgnVal = reversing ? -1 : 1;
                    p.addScaledVector(normal, sgnVal * swingVal);
                }
                pts.push(p);
            }
            return pts;
        };

        const maxSwing = stationName === 'Rathenauplatz' ? 65.0 : 90.0;
        
        let pts1, pts2, pts3, pts4;
        
        if (stationName === 'Rathenauplatz') {
            pts1 = generateBranchPoints(u2Sim, 1, u2FrameExit, false, maxSwing);  // U2 OUT (Left)
            pts2 = generateBranchPoints(u3Sim, 1, u3FrameExit, true, maxSwing);   // U3 OUT (Right, dives)
            pts3 = generateBranchPoints(u3Sim, -1, u3FrameExit, false, maxSwing); // U3 IN (Left)
            pts4 = generateBranchPoints(u2Sim, -1, u2FrameExit, false, maxSwing); // U2 IN (Right)
            
            this._buildSingleTrackBranch(group, coll, pts1, u2Sim, false, pts2, 'left');
            this._buildSingleTrackBranch(group, coll, pts2, u3Sim, false, pts1, 'right');
            this._buildSingleTrackBranch(group, coll, pts3, u3Sim, true, pts4, 'left');
            this._buildSingleTrackBranch(group, coll, pts4, u2Sim, true, pts3, 'right');
        } else {
            // Rothenburger Straße
            pts1 = generateBranchPoints(u3Sim, 1, u3FrameExit, false, maxSwing);  // U3 OUT (Right)
            pts2 = generateBranchPoints(u2Sim, 1, u2FrameExit, false, maxSwing);  // U2 OUT (Left)
            pts3 = generateBranchPoints(u2Sim, -1, u2FrameExit, false, maxSwing); // U2 IN (Right)
            pts4 = generateBranchPoints(u3Sim, -1, u3FrameExit, true, maxSwing);  // U3 IN (Left, dives)
            
            this._buildSingleTrackBranch(group, coll, pts1, u3Sim, false, pts2, 'right');
            this._buildSingleTrackBranch(group, coll, pts2, u2Sim, false, pts1, 'left');
            this._buildSingleTrackBranch(group, coll, pts3, u2Sim, true, pts4, 'right');
            this._buildSingleTrackBranch(group, coll, pts4, u3Sim, true, pts3, 'left');
        }

        this._emitTrackCollectors(group, coll);
        return group;
    }

    // U2/U3 only: their sim.plaerrer is set (stacked semantics like U1), so the generic
    // chunk pipeline suppresses ALL tunnel/rails within +-(plStackHalf+plRamp) of Plärrer.
    // U1's permanent hall provides the platform section plus 20m mock Gleis 3/4 stubs;
    // everything beyond that -- the stacked single tracks (forward = LOWER Gleis 4 slot,
    // reverse = UPPER Gleis 3, see Simulation.plaerrerForwardDives) with their diverging
    // tubes and crown lamp strips -- is built here along this line's OWN centerline, which
    // the generator pinned onto exactly the hall's Gleis 3/4 corridor.
    buildPlaerrerApproach() {
        const sim = this.sim;
        const p = sim.plaerrer;
        if (!p || !sim.track.lineId || sim.track.lineId !== 'TRUNK') return;
        const P = p.position;
        const zoneHalf = sim.plStackHalf + sim.plRamp;
        const innerHalf = p.halfLength + 20; // where the hall's mock Gleis 3/4 stubs end
        const group = new THREE.Group();
        group.name = `plaerrerApproach_${sim.track.lineId}`;

        const sp = (d) => sim.getTrackSpacing(d);
        const dive = (d) => sim.getLowerLevelOffset(d);
        const samplePath = (latFn, yFn, d0, d1, ds = 5) => {
            const pts = [];
            const nSeg = Math.max(1, Math.ceil((d1 - d0) / ds));
            for (let i = 0; i <= nSeg; i++) {
                const d = i === nSeg ? d1 : d0 + i * ds;
                const c = sim.getTrackPosition(d);
                const tan = sim.getTrackTangent(d);
                const pt = c.clone().addScaledVector(new THREE.Vector3(-tan.z, 0, tan.x), latFn(d));
                pt.y = c.y + yFn(d);
                pts.push(pt);
            }
            return pts;
        };

        const coll = this._newTrackCollectors();
        for (const sign of [-1, 1]) {
            const d0 = sign < 0 ? P - zoneHalf : P + innerHalf;
            const d1 = sign < 0 ? P - innerHalf : P + zoneHalf;

            const lowerPts = samplePath((d) => sp(d) / 2, dive, d0, d1, 5);
            const upperPts = samplePath((d) => -sp(d) / 2, () => 0, d0, d1, 5);

            this._buildSingleTrackBranch(group, coll, lowerPts, sim, false);
            this._buildSingleTrackBranch(group, coll, upperPts, sim, false);
        }
        this._emitTrackCollectors(group, coll);
        this.scene.add(group);
    }

    // Per-side tunnel half-width: sideSign +1 = positive lateral (normal (-tz, 0, tx))
    // direction. The two sides used to differ near U2/U3 switches (junction-cavern
    // widening); those are now a fully separate, hand-authored piece
    // (buildSwitchTransition) that owns its own geometry, so both sides are just the
    // symmetric base width everywhere else.
    getTunnelSideWidth(s, sideSign) {
        return this.getTunnelHalfWidth(s);
    }

    buildPlaerrer(stationModel) {
        const sim = this.sim;
        const p = sim.plaerrer;
        if (!p) return;

        const P = p.position;
        const hold = sim.plStackHalf, ramp = sim.plRamp, drop = sim.plaerrerDrop;
        const zoneHalf = hold + ramp;
        const platHalf = p.halfLength;
        const up = new THREE.Vector3(0, 1, 0);
        const GAUGE = 0.7175, POWER = 1.1; // match the mainline rail gauge (createChunk's ±0.7175 offsets)
        const group = new THREE.Group();

        // ---------- Plärrer vertical layout constants ----------
        const LOWER_CLEAR = 3.75;                    // lower ceiling clearance
        const platTopY = 0.865;                      // platform top height relative to track elevation
        const lowerH = LOWER_CLEAR + platTopY;        // total height of the lower level (4.615m)

        // ---------- instanced track helper ----------
        const bedM = [], sleeperM = [], railM = [], railHeadM = [], powerM = [], coverM = [];
        const segMatrix = (A, B, lateral, yOff) => {
            const dir = new THREE.Vector3().subVectors(B, A);
            const length = dir.length();
            if (length < 0.01) return null;
            dir.normalize();
            const right = new THREE.Vector3().crossVectors(up, dir).normalize();
            const aUp = new THREE.Vector3().crossVectors(dir, right).normalize();
            const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5).addScaledVector(right, lateral);
            mid.y += yOff;
            const m = new THREE.Matrix4().makeBasis(right, aUp, dir);
            m.setPosition(mid);
            m.multiply(new THREE.Matrix4().makeScale(1, 1, length));
            return m;
        };
        const renderTrack = (pts) => {
            for (let i = 0; i < pts.length - 1; i++) {
                const A = pts[i], B = pts[i + 1];
                const dir = new THREE.Vector3().subVectors(B, A);
                const length = dir.length();
                if (length < 0.01) continue;
                const bed = segMatrix(A, B, 0, -0.375); if (bed) bedM.push(bed);
                const rL = segMatrix(A, B, -GAUGE, -0.21); if (rL) { railM.push(rL); railHeadM.push(rL); }
                const rR = segMatrix(A, B, GAUGE, -0.21); if (rR) { railM.push(rR); railHeadM.push(rR); }
                const pw = segMatrix(A, B, POWER, -0.05); if (pw) powerM.push(pw);
                const cv = segMatrix(A, B, POWER, 0.03); if (cv) coverM.push(cv);
                const angle = Math.atan2(dir.x, dir.z);
                const nS = Math.max(1, Math.round(length / 2));
                for (let s = 0; s < nS; s++) {
                    const t = (s + 0.5) / nS;
                    const pp = A.clone().lerp(B, t);
                    const m = new THREE.Matrix4().makeRotationY(angle);
                    m.setPosition(pp.x, pp.y - 0.25, pp.z);
                    sleeperM.push(m);
                }
            }
        };
        // Sample a track path: centerline + normal*lateral(d), y = base + yOff(d).
        const samplePath = (latFn, yFn, d0, d1, ds = 5) => {
            const pts = [];
            for (let d = d0; d <= d1 + 0.01; d += ds) {
                const c = sim.getTrackPosition(d);
                const tan = sim.getTrackTangent(d);
                const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
                const pt = c.clone().addScaledVector(nrm, latFn(d));
                pt.y = c.y + yFn(d);
                pts.push(pt);
            }
            return pts;
        };
        const sp = d => sim.getTrackSpacing(d);
        const dive = d => sim.getLowerLevelOffset(d);

        // Gleis 1 (forward / Hardhöhe, UPPER) at +spacing/2, base level – runs the whole zone.
        renderTrack(samplePath(d => sp(d) / 2, () => 0, P - zoneHalf, P + zoneHalf));
        // Gleis 2 (reverse / Langwasser, LOWER) at -spacing/2, dives – directly under Gleis 1.
        renderTrack(samplePath(d => -sp(d) / 2, dive, P - zoneHalf, P + zoneHalf));
        // Gleis 3 (opposite UPPER) at sp(d)/2 - 18.08, base level
        renderTrack(samplePath(d => sp(d) / 2 - 18.08, () => 0, P - platHalf - 20, P + platHalf + 20));
        // Gleis 4 (opposite LOWER) at -sp(d)/2 - 18.08, dives
        renderTrack(samplePath(d => -sp(d) / 2 - 18.08, dive, P - platHalf - 20, P + platHalf + 20));

        const bedGeom = new THREE.BoxGeometry(3.6, 0.15, 1.0);
        const addI = (geom, mat, arr) => {
            if (!arr.length) return;
            const im = new THREE.InstancedMesh(geom, mat, arr.length);
            arr.forEach((m, i) => im.setMatrixAt(i, m));
            im.instanceMatrix.needsUpdate = true;
            // Keep frustum culling ON: three r160's Frustum.intersectsObject computes the
            // instance-aware InstancedMesh.boundingSphere automatically. frustumCulled=false
            // would render every instanced mesh from everywhere, which costs GPU time exactly
            // when the player looks around inside the station.
            group.add(im);
        };
        addI(bedGeom, this.materials.tunnelBallast, bedM);
        addI(this.geometries.sleeper, this.materials.tunnelSleeper, sleeperM);
        addI(this.geometries.rail, this.materials.tunnelRail, railM);
        addI(this.geometries.railHead, this.materials.tunnelRailHead, railHeadM);
        addI(this.geometries.thirdRail, this.materials.tunnelThirdRail, powerM);
        addI(this.geometries.thirdRailCover, this.materials.tunnelThirdRail, coverM);

        // ---------- shared constants & reused station materials ----------
        const platHeight = 1.165, segLen = 5;
        // Island deck width: from the running-track edge to the opposite (mock) track's edge.
        // NOT to the far hall wall — the ~4m band in front of the far wall is the opposite
        // track's trough (Gleis 3/4 + the dummy tubes run there, below platform level).
        const LOWER_W = 15, UPPER_W = 15;
        const EDGE_GAP = 1.54;                       // platform edge inboard of its track centre
        const HALL_H = 12.0;                          // upper vault height (m) - coved arch peak
        const ESC_HALF = 9.0;                         // escalator shaft half-length along Z
        const ESC_X0 = -11.75, ESC_X1 = -6.25;       // escalator band in X
        // Side walls sit DIRECTLY at the edge of the respective track's ballast bed (3.6m
        // wide, so ±1.8 around the track centre) — no gap, no filler apron. The two levels
        // differ because their tracks sit at ±sp/2 and the mock tracks at (±sp/2 - 18.08).
        const upperFar = -19.6;    // upper mock track  0.3-18.08 = -17.78, bed edge -19.58
        const upperNear = 2.1;     // upper running track +0.3, bed edge +2.1
        const lowerFar = -20.2;    // lower mock track -0.3-18.08 = -18.38, bed edge -20.18
        const lowerNear = 1.5;     // lower running track -0.3, bed edge +1.5

        // Reuse the existing station floor textures for both decks.
        const lowerFloorMats = stationModel.getPlatformMaterials(p, LOWER_W, false, false);
        const upperFloorMats = stationModel.getPlatformMaterials(p, UPPER_W, false, false);
        const stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const tactileMat = new THREE.MeshLambertMaterial({ color: '#1d201f' });
        const recessMat = new THREE.MeshLambertMaterial({ color: '#7a8088', side: THREE.DoubleSide });
        const skyMat = new THREE.MeshBasicMaterial({ color: '#9bc8eb' });

        // ---------- PROCEDURAL CUSTOM TEXTURES ----------

        // 2. Cream tile wall with red chevrons & bold "PLÄRRER" text (Lower Level)
        const createLowerWallTexture = (flipped = false) => {
            const w = 1024, h = 512;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');

            // Cream tile base color
            ctx.fillStyle = '#eddcb9';
            ctx.fillRect(0, 0, w, h);

            // Draw red brick chevrons (pointing right, centered at x=256 and x=768)
            const drawChevron = (cx) => {
                ctx.fillStyle = '#b83724';
                ctx.beginPath();
                if (!flipped) {
                    ctx.moveTo(cx - 150, 0);
                    ctx.lineTo(cx - 50, 0);
                    ctx.lineTo(cx + 100, h / 2);
                    ctx.lineTo(cx - 50, h);
                    ctx.lineTo(cx - 150, h);
                    ctx.lineTo(cx, h / 2);
                } else {
                    ctx.moveTo(cx + 150, 0);
                    ctx.lineTo(cx + 50, 0);
                    ctx.lineTo(cx - 100, h / 2);
                    ctx.lineTo(cx + 50, h);
                    ctx.lineTo(cx + 150, h);
                    ctx.lineTo(cx, h / 2);
                }
                ctx.closePath();
                ctx.fill();
            };
            drawChevron(256);
            drawChevron(768);

            // Draw bold "PLÄRRER" text centered between chevrons (at x=0/1024 and x=512)
            ctx.fillStyle = '#111317';
            ctx.font = 'bold 38px "Helvetica Neue", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const textY = 278; // Maps to name stripe height (~1.465m)
            ctx.fillText('PLÄRRER', 512, textY);
            ctx.fillText('PLÄRRER', 0, textY);
            ctx.fillText('PLÄRRER', 1024, textY);

            // Draw tile grout lines over the entire wall
            ctx.strokeStyle = 'rgba(156, 141, 110, 0.35)';
            ctx.lineWidth = 1.2;
            // Horizontal grout lines every 12 pixels
            for (let y = 0; y < h; y += 12) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
            // Vertical grout lines every 24 pixels (staggered tile pattern)
            for (let y = 0; y < h; y += 12) {
                const offset = (Math.round(y / 12) % 2) * 12;
                for (let x = offset; x < w + 24; x += 24) {
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 12); ctx.stroke();
                }
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.repeat.set(1, 1 / lowerH);
            // The wall profiles start 0.35m below track level (tucked into the ballast bed);
            // shift V so the texture's 0..1 still spans track level..lowerH — keeps the name
            // band at its height and avoids a stretched clamp streak under the ceiling.
            tex.offset.set(0, -0.35 / lowerH);
            tex.anisotropy = 8;
            return tagCanvasTextureSRGBKeepLook(tex);
        };

        // 3. Plain cream tiles texture for end walls (no chevrons/text to avoid stretching)
        const createPlainCreamTileTexture = () => {
            const w = 256, h = 256;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#eddcb9';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(156, 141, 110, 0.35)';
            ctx.lineWidth = 1.2;
            for (let y = 0; y < h; y += 12) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
            for (let y = 0; y < h; y += 12) {
                const offset = (Math.round(y / 12) % 2) * 12;
                for (let x = offset; x < w + 24; x += 24) {
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 12); ctx.stroke();
                }
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            return tagCanvasTextureSRGBKeepLook(tex);
        };

        // framed-stair / escalator textures / concrete textures
        const sb = new StationBuilder(stationModel, p);
        const concreteMat = sb.createRoughConcreteMaterial();
        
        // Clone concreteMat and configure it for Plärrer ceiling/walls to prevent high-frequency tiling
        const ceilConcreteMat = concreteMat.clone();
        ceilConcreteMat.map = concreteMat.map.clone();
        ceilConcreteMat.map.wrapS = THREE.RepeatWrapping;
        ceilConcreteMat.map.wrapT = THREE.RepeatWrapping;
        ceilConcreteMat.map.repeat.set(1, 0.1); // repeat every 10 meters along the profile height
        if (ceilConcreteMat.bumpMap) {
            ceilConcreteMat.bumpMap = concreteMat.bumpMap.clone();
            ceilConcreteMat.bumpMap.wrapS = THREE.RepeatWrapping;
            ceilConcreteMat.bumpMap.wrapT = THREE.RepeatWrapping;
            ceilConcreteMat.bumpMap.repeat.set(1, 0.1);
        }
        ceilConcreteMat.userData = { keepWrapAndRepeat: true };

        const hallVaultMat = ceilConcreteMat;
        const stepMat     = new THREE.MeshLambertMaterial({ map: sb.createStairTexture() });
        const escStepMat  = new THREE.MeshLambertMaterial({ map: sb.createEscalatorStripeTexture() });
        const glassMat    = new THREE.MeshBasicMaterial({ color: '#9fb3c8', transparent: true, opacity: 0.45 });
        const handrailMat = new THREE.MeshBasicMaterial({ color: '#15181c' });
        const edelstahlMat = StationBuilder.createBalustradeMaterial();
        const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffe0', side: THREE.DoubleSide });

        const createEscalatorGeometries = (rampLength, thickness, height, railWidth, railHeight) => {
            const r = height / 2;
            const halfW = rampLength / 2;

            // 1. Balustrade Shape (extended straight part to full rampLength)
            const balShape = new THREE.Shape();
            balShape.moveTo(-halfW, -r);
            balShape.lineTo(halfW, -r);
            balShape.absarc(halfW, 0, r, -Math.PI / 2, Math.PI / 2, false);
            balShape.lineTo(-halfW, r);
            balShape.absarc(-halfW, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);

            const balExtrudeSettings = {
                depth: thickness,
                bevelEnabled: false,
                steps: 1
            };
            const balustradeGeom = new THREE.ExtrudeGeometry(balShape, balExtrudeSettings);
            balustradeGeom.translate(0, 0, -thickness / 2);
            balustradeGeom.rotateY(Math.PI / 2);

            // 2. Handrail Shape with Hole (extended straight part to full rampLength)
            const railShape = new THREE.Shape();
            const t = railHeight;
            // Outer boundary (CCW)
            railShape.moveTo(-halfW, -r - t);
            railShape.lineTo(halfW, -r - t);
            railShape.absarc(halfW, 0, r + t, -Math.PI / 2, Math.PI / 2, false);
            railShape.lineTo(-halfW, r + t);
            railShape.absarc(-halfW, 0, r + t, Math.PI / 2, 3 * Math.PI / 2, false);

            // Inner boundary / Hole (CW)
            const holePath = new THREE.Path();
            holePath.moveTo(-halfW, r);
            holePath.lineTo(halfW, r);
            holePath.absarc(halfW, 0, r, Math.PI / 2, -Math.PI / 2, true);
            holePath.lineTo(-halfW, -r);
            holePath.absarc(-halfW, 0, r, -Math.PI / 2, Math.PI / 2, true);

            railShape.holes.push(holePath);

            const railExtrudeSettings = {
                depth: railWidth,
                bevelEnabled: false,
                steps: 1
            };
            const handrailGeom = new THREE.ExtrudeGeometry(railShape, railExtrudeSettings);
            handrailGeom.translate(0, 0, -railWidth / 2);
            handrailGeom.rotateY(Math.PI / 2);

            // 3. 2D Pill Lamp Geometry (Flat Shape in Z-Y plane)
            const L_lamp = 0.27;
            const H_lamp = 0.09;
            const rl = H_lamp / 2;
            const hw = L_lamp / 2;
            
            const lampShape = new THREE.Shape();
            lampShape.moveTo(-hw + rl, -rl);
            lampShape.lineTo(hw - rl, -rl);
            lampShape.absarc(hw - rl, 0, rl, -Math.PI / 2, Math.PI / 2, false);
            lampShape.lineTo(-hw + rl, rl);
            lampShape.absarc(-hw + rl, 0, rl, Math.PI / 2, 3 * Math.PI / 2, false);

            const lampGeom = new THREE.ShapeGeometry(lampShape);
            lampGeom.rotateY(Math.PI / 2); // Rotate to lie in Z-Y plane

            return { balustradeGeom, handrailGeom, lampGeom };
        };

        const frameAt = (d) => {
            const c = sim.getTrackPosition(d);
            const tan = sim.getTrackTangent(d);
            const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
            return { c, tan, nrm, rotY: Math.atan2(tan.x, tan.z) };
        };

        if (!this._plUnitBox) this._plUnitBox = new THREE.BoxGeometry(1, 1, 1);
        const placeBetween = (A, B, w, h, mat) => {
            const dir = new THREE.Vector3().subVectors(B, A); const len = dir.length();
            if (len < 0.01) return; dir.normalize();
            const right = new THREE.Vector3().crossVectors(up, dir).normalize();
            const aUp = new THREE.Vector3().crossVectors(dir, right).normalize();
            const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
            const m = new THREE.Matrix4().makeBasis(right, aUp, dir); m.setPosition(mid);
            m.multiply(new THREE.Matrix4().makeScale(w, h, len));
            const mesh = new THREE.Mesh(this._plUnitBox, mat); mesh.applyMatrix4(m); group.add(mesh);
        };

        // ---------- platform decks ----------
        // Continuous swept meshes (buildSweptBar, like the generic stations) instead of the
        // old per-1m boxes + per-1m strips: ~900 meshes -> 14 draw calls. The elevation is
        // flat across the whole platform (underground level, dive fully developed), so
        // constant top/bottom Y per level is exact.
        const uDeckTop = sim.getTrackPosition(P).y + platTopY;             // upper deck top
        const lDeckTop = sim.getTrackPosition(P).y + dive(P) + platTopY;   // lower deck top
        const deckBar = (sA, sB, innerFn, outerFn, topYd, mats) => {
            const hwFn = (s) => (innerFn(s) - outerFn(s)) / 2;
            const coFn = (s) => (innerFn(s) + outerFn(s)) / 2;
            return stationModel.buildSweptBar(group, sA, sB, hwFn, topYd, topYd - platHeight, [mats[0], mats[2]], 1.2, coFn);
        };
        // buildSweptBar maps the top-face U 0..1 across the bar's own width. The floor texture
        // is sized for the FULL deck width, so partial strips (flanking the escalator shaft)
        // must remap their U to their share of the full deck or the tiles get squashed.
        const remapTopU = (mesh, u0, u1) => {
            const uvA = mesh.geometry.attributes.uv;
            const g = mesh.geometry.groups.find(gr => gr.materialIndex === 1);
            for (let i = g.start; i < g.start + g.count; i++) {
                uvA.setX(i, u0 + uvA.getX(i) * (u1 - u0));
            }
            uvA.needsUpdate = true;
        };
        const stripBar = (sA, sB, xFn, halfW, topYd, mat) =>
            stationModel.buildSweptBar(group, sA, sB, () => halfW, topYd + 0.022, topYd + 0.002, [mat, mat], 1.2, xFn);
        const buildDeckLevel = (trackSign, width, topYd, mats, openHalf) => {
            const edge = (s) => trackSign * sp(s) / 2 - EDGE_GAP;
            const outer = (s) => edge(s) - width;
            const s0 = P - platHalf, s1 = P + platHalf;
            if (openHalf) {
                // Full width outside the central escalator shaft, two flanking strips inside it.
                const holeMin = Math.min(ESC_X0, ESC_X1), holeMax = Math.max(ESC_X0, ESC_X1);
                deckBar(s0, P - openHalf, edge, outer, topYd, mats);
                const mA = deckBar(P - openHalf, P + openHalf, edge, () => holeMax, topYd, mats);
                const mB = deckBar(P - openHalf, P + openHalf, () => holeMin, outer, topYd, mats);
                // top-face U runs 0 at the outer edge .. 1 at the track edge
                remapTopU(mA, (holeMax - outer(P)) / width, 1);
                remapTopU(mB, 0, (holeMin - outer(P)) / width);
                deckBar(P + openHalf, s1, edge, outer, topYd, mats);
            } else {
                deckBar(s0, s1, edge, outer, topYd, mats);
            }
            // white edge strip / tactile band / outer safety stripe, continuous
            stripBar(s0, s1, (s) => edge(s) - 0.08, 0.08, topYd, stripMat);
            stripBar(s0, s1, (s) => edge(s) - 0.45, 0.15, topYd, tactileMat);
            stripBar(s0, s1, (s) => edge(s) - width + 0.08, 0.08, topYd, stripMat);
        };
        buildDeckLevel(+1, UPPER_W, uDeckTop, upperFloorMats, ESC_HALF);   // Hardhöhe (upper)
        buildDeckLevel(-1, LOWER_W, lDeckTop, lowerFloorMats, null);       // Langwasser (lower)

        const uBaseY = sim.getTrackPosition(P).y;          // upper track elevation

        // Helper to build standard escalator/stair bank
        const buildEscalatorBank = (centerZ, wallOffset, stairWidth, escOffset, zSign, baseFloorY, targetFloorY, escHalf) => {
            const fMid = frameAt(centerZ);
            const escCx = -9.0;
            
            const midY = (baseFloorY + targetFloorY) / 2;
            const midPos = fMid.c.clone().addScaledVector(fMid.nrm, escCx);
            midPos.y = midY;
            
            const escGroup = new THREE.Group();
            escGroup.position.copy(midPos);
            escGroup.rotation.y = fMid.rotY;

            const numSteps = Math.max(10, Math.round(Math.abs(targetFloorY - baseFloorY) / 0.166));
            const numTotalSteps = numSteps + 4; // Extend by 2 steps at each end
            const stepDepth = (2 * escHalf) / numSteps;
            const stepHeight = Math.abs(targetFloorY - baseFloorY) / numSteps;
            const rampLength = Math.sqrt(Math.pow(2 * escHalf, 2) + Math.pow(targetFloorY - baseFloorY, 2));
            const rampAngle = Math.atan2(Math.abs(targetFloorY - baseFloorY), 2 * escHalf);
            const rotX = -zSign * rampAngle; // Tilted downwards or upwards depending on direction
            
            // 1. Enclosing concrete walls on both sides, aligned to the deck openings
            const wallH = 11.5;
            const wallGeom = new THREE.BoxGeometry(0.4, wallH, 2 * escHalf);
            
            const lWall = new THREE.Mesh(wallGeom, concreteMat);
            lWall.position.set(-wallOffset, 0, 0);
            
            const rWall = new THREE.Mesh(wallGeom, concreteMat);
            rWall.position.set(wallOffset, 0, 0);
            escGroup.add(lWall, rWall);

            // 2. Stairs in the middle + escalator steps, as TWO InstancedMeshes instead of
            // 3*numSteps individual meshes (numSteps is ~60 for the 10m central bank).
            const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
            const escWidth = 1.0; // Narrowed from 1.1 to 1.0 to fit inside balustrades
            const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
            const stairInst = new THREE.InstancedMesh(stairGeom, stepMat, numSteps);
            const escInst = new THREE.InstancedMesh(escStepGeom, escStepMat, 2 * numSteps);

            // GPU Animation: Add direction attribute to escalator steps
            const dirAttr = new Float32Array(2 * numSteps * 3);
            for (let i = 0; i < numSteps; i++) {
                // Left lane: UP (perInstanceDir[0] = 1) -> vector is (0, stepHeight, zSign * stepDepth)
                dirAttr[(2 * i) * 3 + 0] = 0;
                dirAttr[(2 * i) * 3 + 1] = stepHeight;
                dirAttr[(2 * i) * 3 + 2] = zSign * stepDepth;

                // Right lane: DOWN (perInstanceDir[1] = -1) -> vector is (0, -stepHeight, -zSign * stepDepth)
                dirAttr[(2 * i + 1) * 3 + 0] = 0;
                dirAttr[(2 * i + 1) * 3 + 1] = -stepHeight;
                dirAttr[(2 * i + 1) * 3 + 2] = -zSign * stepDepth;
            }
            escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
            StationBuilder.setupEscalatorMaterial(escStepMat, this.sim.stationModel);

            const stepMatrix = new THREE.Matrix4();
            for (let i = 0; i < numSteps; i++) {
                const sy = i * stepHeight + stepHeight / 2 - Math.abs(targetFloorY - baseFloorY) / 2;
                const sz = -zSign * (escHalf - (i * stepDepth + stepDepth / 2));
                stairInst.setMatrixAt(i, stepMatrix.makeTranslation(0, sy, sz));
                escInst.setMatrixAt(2 * i, stepMatrix.makeTranslation(-escOffset, sy, sz));
                escInst.setMatrixAt(2 * i + 1, stepMatrix.makeTranslation(escOffset, sy, sz));
            }
            stairInst.instanceMatrix.needsUpdate = true;
            escInst.instanceMatrix.needsUpdate = true;
            escGroup.add(stairInst, escInst);

            // Registering with the model is no longer needed for animation as it's now handled by the shader.
            this.registerEscalator(escInst, { numSteps });

            // Ensure instances are not culled when their origin is off-screen
            escInst.computeBoundingSphere();
            if (escInst.boundingSphere) escInst.boundingSphere.radius *= 10;
            escInst.frustumCulled = false;

            // 3. Double Escalators (ramps under the steps, escalator textures)
            const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);

            const escL = new THREE.Mesh(escRampGeom, escStepMat);
            escL.position.set(-escOffset, -0.15, 0); escL.rotation.x = rotX;

            const escR = new THREE.Mesh(escRampGeom, escStepMat);
            escR.position.set(escOffset, -0.15, 0); escR.rotation.x = rotX;
            escGroup.add(escL, escR);

            // 4. Escalator Stainless Steel Balustrades
            const thickness = 0.05;
            const height = 0.9;
            const railWidth = 0.1;
            const railHeight = 0.1;
            const { balustradeGeom, handrailGeom, lampGeom } = createEscalatorGeometries(rampLength, thickness, height, railWidth, railHeight);
            
            const outerBal = wallOffset - 0.2;
            const innerBal = stairWidth / 2;

            const glassL1 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassL1.position.set(-outerBal, 0.45, 0); glassL1.rotation.x = rotX;
            
            const glassL2 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassL2.position.set(-innerBal, 0.45, 0); glassL2.rotation.x = rotX;
            
            const glassR1 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassR1.position.set(innerBal, 0.45, 0); glassR1.rotation.x = rotX;
            
            const glassR2 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassR2.position.set(outerBal, 0.45, 0); glassR2.rotation.x = rotX;
            
            // Add pill-shaped lamps to the inside of the balustrades
            const addLamps = (mesh, dirX) => {
                const r = height / 2;
                const halfW = rampLength / 2;
                for (let z = -halfW + 1.0; z <= halfW - 1.0; z += 1.5) {
                    const lamp = new THREE.Mesh(lampGeom, lampMat);
                    lamp.position.set(dirX * (thickness / 2 + 0.001), 0.3 - r, z);
                    mesh.add(lamp);
                }
            };
            addLamps(glassL1, 1);
            addLamps(glassL2, -1);
            addLamps(glassR1, 1);
            addLamps(glassR2, -1);
            
            escGroup.add(glassL1, glassL2, glassR1, glassR2);

            // 5. Escalator Handrails (Closed loops, positioned at the same Y center as balustrades)
            const railL1 = new THREE.Mesh(handrailGeom, handrailMat);
            railL1.position.set(-outerBal, 0.45, 0); railL1.rotation.x = rotX;
            
            const railL2 = new THREE.Mesh(handrailGeom, handrailMat);
            railL2.position.set(-innerBal, 0.45, 0); railL2.rotation.x = rotX;
            
            const railR1 = new THREE.Mesh(handrailGeom, handrailMat);
            railR1.position.set(innerBal, 0.45, 0); railR1.rotation.x = rotX;
            
            const railR2 = new THREE.Mesh(handrailGeom, handrailMat);
            railR2.position.set(outerBal, 0.45, 0); railR2.rotation.x = rotX;
            escGroup.add(railL1, railL2, railR1, railR2);

            group.add(escGroup);
        };

        // Get floor height at P
        const floorY = sim.getTrackPosition(P).y + platTopY; // upper platform / hall floor level

        // Build central escalator/stair bank (descends in +Z, connecting lower and upper levels)
        const fTopC = frameAt(P - ESC_HALF), fBotC = frameAt(P + ESC_HALF);
        const topYC = fTopC.c.y + platTopY;
        const botYC = fBotC.c.y + dive(P + ESC_HALF) + platTopY;
        buildEscalatorBank(P, 2.55, 2.4, 1.775, -1, botYC, topYC, 9.0);
        
        // Build the wide escalator/stair bank at the LANGWASSER end (P - platHalf, i.e. the
        // start-of-line direction): connects the upper platform to the mezzanine above and
        // leaves the hall through the matching opening in that end wall.
        const fTopL = frameAt(P - platHalf);
        const topYL = fTopL.c.y + platTopY;
        const mezzanineHeight = 5.0;
        // Use escHalf = 4.33 (for a realistic steep 30-degree slope) and shift 15cm into the
        // hall (center at P - platHalf - 4.18) to overlap and eliminate the gap
        buildEscalatorBank(P - platHalf - 4.18, 5.5, 8.0, 4.55, -1, topYL, topYL + mezzanineHeight, 4.33);

        // ---------- LOWER platform enclosure (Flat vertical walls & horizontal ceiling) ----------
        const lBaseY = sim.getTrackPosition(P).y + dive(P);
        
        // Wall and ceiling profiles in absolute lateral coordinates. Walls start slightly
        // below the ballast bed top (-0.3) so the wall base meets the bed with no crack.
        const lowerWallLeftProfile = [{ x: lowerFar, y: -0.35 }, { x: lowerFar, y: lowerH }];
        const lowerWallRightProfile = [{ x: lowerNear, y: -0.35 }, { x: lowerNear, y: lowerH }];
        const lowerCeilProfile = [{ x: lowerFar, y: lowerH }, { x: lowerNear, y: lowerH }];
        const lowerCeilLeftProfile = [{ x: lowerFar, y: lowerH }, { x: ESC_X0, y: lowerH }];
        const lowerCeilRightProfile = [{ x: ESC_X1, y: lowerH }, { x: lowerNear, y: lowerH }];

        const lowerWallMat = new THREE.MeshLambertMaterial({ map: createLowerWallTexture(false), side: THREE.DoubleSide });
        lowerWallMat.userData = { keepWrapAndRepeat: true };
        // Near-side variant with horizontally mirrored U: the near wall is seen from the
        // opposite side of its face, so the shared texture would read mirror-inverted there
        // (the "PLÄRRER gespiegelt" bug). Negative repeat.x + RepeatWrapping flips it back.
        const lowerWallMatMirror = lowerWallMat.clone();
        lowerWallMatMirror.map = lowerWallMat.map.clone();
        lowerWallMatMirror.map.repeat.x = -1;
        lowerWallMatMirror.userData = { keepWrapAndRepeat: true };

        // Flipped variants for Gleis 1 and 2
        const lowerWallMatFlipped = new THREE.MeshLambertMaterial({ map: createLowerWallTexture(true), side: THREE.DoubleSide });
        lowerWallMatFlipped.userData = { keepWrapAndRepeat: true };
        const lowerWallMatMirrorFlipped = lowerWallMatFlipped.clone();
        lowerWallMatMirrorFlipped.map = lowerWallMatFlipped.map.clone();
        lowerWallMatMirrorFlipped.map.repeat.x = -1;
        lowerWallMatMirrorFlipped.userData = { keepWrapAndRepeat: true };

        const lowerCeilMat = ceilConcreteMat;

        const plainCreamTileMat = new THREE.MeshLambertMaterial({ map: createPlainCreamTileTexture(), side: THREE.DoubleSide });
        // Used on ShapeGeometry end walls whose UVs are in METERS: one texture (≈21 tile
        // rows) every ~2.4m gives ~11cm tiles, matching the side walls. The old repeat of
        // 12/m tiled the texture 12x PER METER — pure sub-pixel noise.
        plainCreamTileMat.map.repeat.set(0.42, 0.42);
        const endWallLowerMat = plainCreamTileMat;

        // Side walls once over the full platform length (they are identical in every zone;
        // splitting them per zone only multiplied meshes and GPU texture clones).
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, lowerWallLeftProfile, lBaseY, () => 0, lowerWallMat, 6); // Gleis 4 Far (West-pointing)
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, lowerWallRightProfile, lBaseY, () => 0, lowerWallMatMirrorFlipped, 6); // Gleis 2 Near (Flipped East-pointing)

        // Ceiling in 3 zones (solid / escalator opening / solid)
        stationModel.buildSweptProfile(group, P - platHalf, P - ESC_HALF, lowerCeilProfile, lBaseY, () => 0, lowerCeilMat, 10);
        stationModel.buildSweptProfile(group, P - ESC_HALF, P + ESC_HALF, lowerCeilLeftProfile, lBaseY, () => 0, lowerCeilMat, 10);
        stationModel.buildSweptProfile(group, P - ESC_HALF, P + ESC_HALF, lowerCeilRightProfile, lBaseY, () => 0, lowerCeilMat, 10);
        stationModel.buildSweptProfile(group, P + ESC_HALF, P + platHalf, lowerCeilProfile, lBaseY, () => 0, lowerCeilMat, 10);

        // ---------- UPPER distribution HALL (Flat ceiling & vertical walls) ----------
        const hallHeight = 12.0; // flat ceiling height above the hall floor (floorY)
        const hallCeilY = hallHeight + platTopY; // same, but relative to the upper TRACK level

        // Side walls: tiled PLÄRRER name band with the SAME height as the lower level's wall
        // (from track level up lowerH), plain concrete continuing above it up to the ceiling.
        // y-coords are relative to the upper track level (uBaseY), matching the lower walls.
        const upperTileLeftProfile = [{ x: upperFar, y: -0.35 }, { x: upperFar, y: lowerH }];
        const upperTileRightProfile = [{ x: upperNear, y: -0.35 }, { x: upperNear, y: lowerH }];
        const upperConcLeftProfile = [{ x: upperFar, y: lowerH }, { x: upperFar, y: hallCeilY }];
        const upperConcRightProfile = [{ x: upperNear, y: lowerH }, { x: upperNear, y: hallCeilY }];
        const upperCeilProfile = [{ x: upperFar, y: hallCeilY }, { x: upperNear, y: hallCeilY }];

        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperTileLeftProfile, uBaseY, () => 0, lowerWallMat, 6); // Gleis 3 Far (West-pointing)
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperTileRightProfile, uBaseY, () => 0, lowerWallMatMirrorFlipped, 6); // Gleis 1 Near (Flipped East-pointing)
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperConcLeftProfile, uBaseY, () => 0, hallVaultMat, 10);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperConcRightProfile, uBaseY, () => 0, hallVaultMat, 10);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperCeilProfile, uBaseY, () => 0, hallVaultMat, 10);

        // Concrete roof over the upper tracks (Gleis 1 and 3)
        // Spans from side walls to 100cm over the platform edge, at 4.7m height above tracks.
        const roofThick = 0.2, rTop = uBaseY + 4.7, rBot = uBaseY + 4.7 - roofThick;
        const sR0 = P - platHalf, sR1 = P + platHalf;
        // Roof over Gleis 1 (Right / Near side)
        const r1Inner = (s) => (sp(s) / 2 - EDGE_GAP) - 1.0;
        stationModel.buildSweptBar(group, sR0, sR1, (s) => (upperNear - r1Inner(s)) / 2,
            rTop, rBot, [hallVaultMat, hallVaultMat], 1.2, (s) => (upperNear + r1Inner(s)) / 2);
        // Roof over Gleis 3 (Left / Far side)
        const r3Inner = (s) => (sp(s) / 2 - EDGE_GAP - UPPER_W) + 1.0;
        stationModel.buildSweptBar(group, sR0, sR1, (s) => (r3Inner(s) - upperFar) / 2,
            rTop, rBot, [hallVaultMat, hallVaultMat], 1.2, (s) => (r3Inner(s) + upperFar) / 2);

        // ---------- L-shaped heavy duty concrete struts ----------
        // These struts fix the roofs to the main hall ceiling.
        const strutMat = hallVaultMat.clone();
        strutMat.color = new THREE.Color('#cccccc'); // Lighter gray
        const strutBaseGeom = new THREE.BoxGeometry(2.4, 0.8, 0.8);
        const strutNeckGeom = new THREE.BoxGeometry(0.8, 9.0, 0.8);
        const strutBaseM = [], strutNeckM = [];
        const addStrut = (d, latX, y, tiltSign) => {
            const f = frameAt(d);
            // Position at the inner edge of the roof
            const basePos = f.c.clone().addScaledVector(f.nrm, latX);
            basePos.y = y;

            const m = new THREE.Matrix4().makeRotationY(f.rotY);

            // Foot of the L (horizontal, sitting ON TOP of the roof)
            const footM = m.clone();
            // Center of the 2.4m foot: shifted by 1.2m outwards and 0.4m up to be flush with roof top
            const footCenter = basePos.clone().addScaledVector(f.nrm, tiltSign * 1.2);
            footCenter.y += 0.4;
            footM.setPosition(footCenter);
            strutBaseM.push(footM);

            // Neck of the L (inclined 20° towards the station center)
            const neckM = m.clone();
            const neckAngle = tiltSign * (-20 * Math.PI / 180);
            neckM.multiply(new THREE.Matrix4().makeRotationZ(neckAngle));

            // The neck center calculation
            const neckStartPos = basePos.clone();
            neckStartPos.y += 0.4; // Start at foot center height

            const lateralShift = Math.sin(-neckAngle) * 4.5;
            const verticalShift = Math.cos(neckAngle) * 4.5;
            const neckCenter = neckStartPos.clone();
            neckCenter.addScaledVector(f.nrm, lateralShift);
            neckCenter.y += verticalShift;

            neckM.setPosition(neckCenter);
            strutNeckM.push(neckM);
        };
        for (let d = P - 40; d <= P + 40.1; d += 10) {
            addStrut(d, r1Inner(d), uBaseY + 4.7, 1);
            addStrut(d, r3Inner(d), uBaseY + 4.7, -1);
        }
        addI(strutBaseGeom, strutMat, strutBaseM);
        addI(strutNeckGeom, strutMat, strutNeckM);

        // Helper to query vault/ceiling height at any X coordinate (always flat 12m now)
        const getVaultHeight = (x) => hallHeight;

        const endWallUpperMat = new THREE.MeshLambertMaterial({ color: '#b8c0c8', side: THREE.DoubleSide });

        // ---------- COLUMNS (Segmented silver pillars on both levels) ----------
        // All columns share ONE unit cylinder (scaled per instance) and all joint rings share
        // one geometry: 2 InstancedMeshes instead of ~110 individual meshes.
        const createColumnTexture = () => {
            const w = 512, h = 64;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            // Light color (#F4F2FB) at the sides perpendicular to the track (UV 0.25 and 0.75)
            // to make them "parallel to travel direction" in world space.
            grad.addColorStop(0, '#7A7975');
            grad.addColorStop(0.175, '#7A7975');
            grad.addColorStop(0.25, '#F4F2FB');
            grad.addColorStop(0.325, '#7A7975');
            grad.addColorStop(0.675, '#7A7975');
            grad.addColorStop(0.75, '#F4F2FB');
            grad.addColorStop(0.825, '#7A7975');
            grad.addColorStop(1, '#7A7975');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            return tagCanvasTextureSRGBKeepLook(tex);
        };
        const colMat = new THREE.MeshLambertMaterial({ map: createColumnTexture() });
        const colRingGeom = new THREE.CylinderGeometry(0.51, 0.51, 0.04, 16);
        const colRingMat = new THREE.MeshLambertMaterial({ color: '#2d3035' }); // Dark steel joints
        const colUnitGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
        const colM = [], colRingM = [];
        const colPos = (x, y, z, yScale) => {
            const m = new THREE.Matrix4().makeTranslation(x, y, z);
            if (yScale) m.multiply(new THREE.Matrix4().makeScale(1, yScale, 1));
            return m;
        };

        // 2 rows of 9 columns each (evenly spaced over 80m span)
        for (let d = P - 40; d <= P + 40.1; d += 10) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const lFloorY = f.c.y + dive(d) + platTopY;

            for (const cx of [-5.5, -12.5]) {
                const cp = f.c.clone().addScaledVector(f.nrm, cx);

                // A. Upper columns (height matches the flat hall ceiling)
                const uColH = getVaultHeight(cx);
                colM.push(colPos(cp.x, uFloorY + uColH / 2, cp.z, uColH));
                for (let y = 2.4; y < uColH - 0.5; y += 2.4) {
                    colRingM.push(colPos(cp.x, uFloorY + y, cp.z));
                }

                // B. Lower columns (joining lower floor and lower ceiling)
                colM.push(colPos(cp.x, lFloorY + LOWER_CLEAR / 2, cp.z, LOWER_CLEAR));
                for (let y = 1.2; y < LOWER_CLEAR - 0.3; y += 1.2) {
                    colRingM.push(colPos(cp.x, lFloorY + y, cp.z));
                }
            }
        }
        addI(colUnitGeom, colMat, colM);
        addI(colRingGeom, colRingMat, colRingM);

        // ---------- LIGHTS & SKYLIGHTS ----------
        // Rings and disks of both levels as 4 InstancedMeshes instead of ~40 meshes.
        const flatAt = (x, y, z, rotZ = 0) => {
            const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2, 0, rotZ));
            m.setPosition(x, y, z);
            return m;
        };

        // 1. Upper Level Skylights (6 circular recessed lights in the central row)
        const skyRingM = [], skyDiskM = [];
        for (let d = P - 37.5; d <= P + 37.51; d += 15) {
            const f = frameAt(d);
            const skylightY = f.c.y + platTopY + hallHeight;
            const sc = f.c.clone().addScaledVector(f.nrm, -9.0);

            // Recessed flat rings with a diameter close to the column distance (approx 8m diameter / 4m radius)
            skyRingM.push(flatAt(sc.x, skylightY - 0.01, sc.z, f.rotY));
            skyDiskM.push(flatAt(sc.x, skylightY - 0.02, sc.z, f.rotY));
        }
        addI(new THREE.RingGeometry(3.8, 4.0, 64), recessMat, skyRingM);
        addI(new THREE.CircleGeometry(3.8, 64), skyMat, skyDiskM);

        // 2. Lower Level lights (matching the upper skylight grid, skipping those above the escalator shaft)
        const lightX = -9.0;
        const lRingM = [], lDiskM = [];
        for (let d = P - 37.5; d <= P + 37.51; d += 15) {
            if (Math.abs(d - P) < ESC_HALF) continue; // Skip escalator shaft

            const f = frameAt(d);
            const lc = f.c.clone().addScaledVector(f.nrm, lightX);
            const lCeilY = f.c.y + dive(d) + lowerH;
            lRingM.push(flatAt(lc.x, lCeilY - 0.02, lc.z));
            lDiskM.push(flatAt(lc.x, lCeilY - 0.03, lc.z));
        }
        addI(new THREE.RingGeometry(0.45, 0.62, 18), recessMat, lRingM);
        addI(new THREE.CircleGeometry(0.45, 18), skyMat, lDiskM);

        // 3. Jakobinenstraße-style lighting for Plärrer
        // Girder dimensions (increased height to accommodate larger light panels)
        const jGirderH = 0.35, jGirderW = 0.25;
        const jGirderY = 3.775; // center Y
        const jGirderTopY = jGirderY + jGirderH / 2;
        const jGirderMat = stationModel.materials.boardHanger;
        const jTubeMat = stationModel.materials.lightTube;

        // Side/Bottom light panels ("Plärrer difference")
        const jSideH = 0.232; // Doubled height (~0.116 * 2)
        const jSideL = 1.8;   // 4x longer (0.45 * 4)
        const jSideGap = 0.05; // 5cm gap between panels
        const jSideCycle = jSideL + jSideGap;
        const jSideGeom = new THREE.BoxGeometry(0.01, jSideH, jSideL);
        const jBottomGeom = new THREE.BoxGeometry(0.15, 0.01, jSideL);
        const jSideM = [], jBottomM = [];
        const jHangerGeom = new THREE.CylinderGeometry(0.015, 0.015, 1, 8);
        const jHangerM = [];
        // Stationsname in regelmäßigen Abständen auf beiden Trägerflächen
        // (gleiches Schema wie StationModel.buildPlaererLights/buildBarrelLights)
        const jNameGeom = new THREE.PlaneGeometry(1.6, 0.24);
        const jNameMat = stationModel.getBarrelTextMat('Plärrer');

        const buildJLighting = (levelBaseY, trackSign, levelCeilRelY, platWidth) => {
            const edgeFn = (s) => trackSign * sim.getTrackSpacing(s) / 2 - 1.54;
            // Two rows per platform level, 20cm inwards from the edges (-0.2 and -(platWidth - 0.2))
            [-0.2, -(platWidth - 0.2)].forEach(xOff => {
                const latFn = (s) => edgeFn(s) + xOff;
                const s0 = P - platHalf, s1 = P + platHalf;

                // Swept concrete girder
                stationModel.buildSweptBar(group, s0, s1, () => jGirderW / 2,
                    levelBaseY + jGirderY + jGirderH / 2, levelBaseY + jGirderY - jGirderH / 2,
                    [jGirderMat, jGirderMat], 1.2, latFn);

                // Light panels (Sides and Bottom) and Hangers
                for (let d = s0 + jSideCycle/2; d <= s1; d += jSideCycle) {
                    const f = frameAt(d);
                    const cp = f.c.clone().addScaledVector(f.nrm, latFn(d));

                    // Side lights on both sides of the girder
                    const sy = levelBaseY + jGirderTopY - 0.05 - jSideH / 2;
                    for (const side of [1, -1]) {
                        const m = new THREE.Matrix4().makeRotationY(f.rotY);
                        m.setPosition(cp.x + f.nrm.x * (side * (jGirderW / 2 + 0.006)), sy, cp.z + f.nrm.z * (side * (jGirderW / 2 + 0.006)));
                        jSideM.push(m);
                    }

                    // Bottom light panel (replaces neon tubes)
                    const by = levelBaseY + jGirderY - jGirderH / 2 - 0.006;
                    const mb = new THREE.Matrix4().makeRotationY(f.rotY);
                    mb.setPosition(cp.x, by, cp.z);
                    jBottomM.push(mb);

                    // Hangers every ~5m
                    if (Math.abs((d - s0) % 5.0) < jSideCycle / 2) {
                        const hLen = levelCeilRelY - jGirderTopY;
                        const hy = levelBaseY + jGirderTopY + hLen / 2;
                        const m = new THREE.Matrix4().makeRotationY(f.rotY);
                        m.setPosition(cp.x, hy, cp.z);
                        m.multiply(new THREE.Matrix4().makeScale(1, hLen, 1));
                        jHangerM.push(m);
                    }
                }

                // Stationsname alle 12 m auf beiden Flächen des Trägers
                for (let dT = s0 + 6.0; dT <= s1 - 3.0; dT += 12.0) {
                    const f = frameAt(dT);
                    const cp = f.c.clone().addScaledVector(f.nrm, latFn(dT));
                    for (const face of [1, -1]) {
                        const plate = new THREE.Mesh(jNameGeom, jNameMat);
                        plate.position.set(
                            cp.x + f.nrm.x * face * (jGirderW / 2 + 0.012),
                            levelBaseY + jGirderY,
                            cp.z + f.nrm.z * face * (jGirderW / 2 + 0.012));
                        plate.rotation.y = f.rotY + (face > 0 ? -Math.PI / 2 : Math.PI / 2);
                        group.add(plate);
                    }
                }
            });
        };

        buildJLighting(lBaseY, -1, lowerH, LOWER_W); // Lower
        buildJLighting(uBaseY, +1, hallHeight + platTopY, UPPER_W); // Upper
        addI(jSideGeom, jTubeMat, jSideM);
        addI(jBottomGeom, jTubeMat, jBottomM);
        addI(jHangerGeom, jGirderMat, jHangerM);

        // ---------- PLATFORM ACCESSORIES & FURNISHING ----------
        const trashBodyGeom = new THREE.BoxGeometry(0.25, 0.45, 0.25);
        const trashLidGeom = new THREE.BoxGeometry(0.26, 0.04, 0.26);
        const trashOrangeMat = new THREE.MeshLambertMaterial({ color: '#f97316' }); // Nuremberg Orange

        // 1. Column-Mounted Trash Cans (matched to the new 9-column grid)
        const trashBodyM = [], trashLidM = [];
        for (let d = P - 40; d <= P + 40.1; d += 10) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const lFloorY = f.c.y + dive(d) + platTopY;

            for (const cx of [-5.5, -12.5]) {
                const cp = f.c.clone().addScaledVector(f.nrm, cx);
                const facingSign = (cx === -5.5) ? 1 : -1; // Face outward from column center
                const colRadius = 0.5 + 0.125; // column radius + half-thickness of trash can
                const tx = cp.x + facingSign * colRadius;

                for (const fy of [uFloorY, lFloorY]) {
                    trashBodyM.push(colPos(tx, fy + 0.8, cp.z));
                    trashLidM.push(colPos(tx, fy + 0.8 + 0.245, cp.z));
                }
            }
        }
        addI(trashBodyGeom, trashOrangeMat, trashBodyM);
        addI(trashLidGeom, colRingMat, trashLidM);

        // 2. Back-to-Back Red Wire Mesh Benches & Snack Vending Machines
        const benchPipeGeom = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8).rotateX(Math.PI / 2);
        const benchLegGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8);
        const seatBaseGeom = new THREE.BoxGeometry(0.45, 0.03, 0.4);
        const seatBackGeom = new THREE.BoxGeometry(0.03, 0.4, 0.4);
        const benchOrangeMat = new THREE.MeshLambertMaterial({ color: '#f97316' }); // Nuremberg Orange (matches the trash cans)

        // All benches share 4 InstancedMeshes (pipe/legs/seats/backs across every bench on
        // both levels) instead of ~20 meshes per bench. addBench only collects matrices;
        // the InstancedMeshes are created after the distribution loop below.
        const benchPipeM = [], benchLegM = [], benchSeatM = [], benchBackM = [];
        const addBench = (bz, levelFloorY) => {
            const bx = -9.0;
            const f = frameAt(bz);
            const base = new THREE.Matrix4().makeTranslation(
                f.c.x + f.nrm.x * bx, levelFloorY, f.c.z + f.nrm.z * bx);
            // +90°: benches sit across the platform, seats facing along the tracks
            base.multiply(new THREE.Matrix4().makeRotationY(f.rotY + Math.PI / 2));
            const part = (arr, px, py, pz, rotZ = 0) => {
                const m = base.clone().multiply(new THREE.Matrix4().makeTranslation(px, py, pz));
                if (rotZ) m.multiply(new THREE.Matrix4().makeRotationZ(rotZ));
                arr.push(m);
            };

            part(benchPipeM, 0, 0.45, 0);                 // horizontal support pipe
            part(benchLegM, 0, 0.225, -0.9);              // legs
            part(benchLegM, 0, 0.225, 0.9);

            // 4 back-to-back seats
            for (const zo of [-0.75, -0.25, 0.25, 0.75]) {
                part(benchSeatM, 0.25, 0.47, zo);                 // side 1 (facing right)
                part(benchBackM, 0.04, 0.67, zo, -0.15);
                part(benchSeatM, -0.25, 0.47, zo);                // side 2 (facing left)
                part(benchBackM, -0.04, 0.67, zo, 0.15);
            }
        };

        const addVendingMachine = (vz, levelFloorY) => {
            // Collect per-part matrices; every vending machine shares the same 7 instanced
            // part meshes (created after the distribution loop), instead of ~26 meshes with
            // fresh geometries/materials per machine.
            const vx = -9.0;
            const f = frameAt(vz);
            const base = new THREE.Matrix4().makeTranslation(
                f.c.x + f.nrm.x * vx, levelFloorY, f.c.z + f.nrm.z * vx);
            base.multiply(new THREE.Matrix4().makeRotationY(f.rotY));
            const part = (arr, px, py, pz) =>
                arr.push(base.clone().multiply(new THREE.Matrix4().makeTranslation(px, py, pz)));

            part(vmCabBackM, 0, 1.1, -0.05);      // 1. back support body
            part(vmRecessM, 0, 1.1, 0.28);        // 2. window recess back panel
            // 3. Colorful shelves snack boxes (color set per instance below)
            for (let r2 = 0; r2 < 4; r2++) {
                for (let c2 = 0; c2 < 4; c2++) {
                    part(vmItemM, -0.33 + c2 * 0.22, 0.52 + r2 * 0.36, 0.32);
                    vmItemColors.push(vmItemPalette[(r2 + c2) % vmItemPalette.length]);
                }
            }
            part(vmGlassM, 0, 1.1, 0.36);         // 4. glass shield
            part(vmSideFrameM, -0.5125, 1.1, 0.335); // 5. border frame
            part(vmSideFrameM, 0.5125, 1.1, 0.335);
            part(vmCapFrameM, 0, 0.175, 0.335);
            part(vmCapFrameM, 0, 2.025, 0.335);
            part(vmHeaderM, 0, 2.025, 0.40);      // 6. backlit top header panel
        };
        const vmCabBackM = [], vmRecessM = [], vmItemM = [], vmGlassM = [];
        const vmSideFrameM = [], vmCapFrameM = [], vmHeaderM = [];
        const vmItemColors = [];
        const vmItemPalette = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa']
            .map(c => new THREE.Color(c));
        const vmCabMat = new THREE.MeshLambertMaterial({ color: '#3f4448' });

        // Distribute elements along the platforms (both levels) at midpoints between columns
        // Column midpoints are: P - 36, P - 24, P - 12, P, P + 12, P + 24, P + 36
        const midPoints = [-36, -24, -12, 0, 12, 24, 36];
        for (const offset of midPoints) {
            const zPos = P + offset;
            const uFloor = sim.getTrackPosition(zPos).y + platTopY;
            const lFloor = sim.getTrackPosition(zPos).y + dive(zPos) + platTopY;

            // Skip escalator zones for vending machines/benches (central and Langwasser-end wide banks)
            if (Math.abs(offset) < ESC_HALF + 2.0 || (offset > -platHalf - 2.0 && offset < -platHalf + 20.0)) continue;

            if (offset === -24 || offset === 24) {
                addVendingMachine(zPos, uFloor);
                addVendingMachine(zPos, lFloor);
            } else {
                addBench(zPos, uFloor);
                addBench(zPos, lFloor);
            }
        }
        // Build the shared instanced meshes for benches and vending machines.
        addI(benchPipeGeom, benchOrangeMat, benchPipeM);
        addI(benchLegGeom, benchOrangeMat, benchLegM);
        addI(seatBaseGeom, benchOrangeMat, benchSeatM);
        addI(seatBackGeom, benchOrangeMat, benchBackM);
        addI(new THREE.BoxGeometry(1.1, 2.2, 0.65), vmCabMat, vmCabBackM);
        addI(new THREE.BoxGeometry(0.95, 1.5, 0.02), new THREE.MeshLambertMaterial({ color: '#111215' }), vmRecessM);
        addI(new THREE.BoxGeometry(0.95, 1.5, 0.01), glassMat, vmGlassM);
        addI(new THREE.BoxGeometry(0.075, 1.5, 0.12), vmCabMat, vmSideFrameM);
        addI(new THREE.BoxGeometry(1.1, 0.35, 0.12), vmCabMat, vmCapFrameM);
        addI(new THREE.BoxGeometry(0.95, 0.25, 0.01), new THREE.MeshBasicMaterial({ color: '#0284c7' }), vmHeaderM);
        if (vmItemM.length) {
            const itemInst = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.12, 0.16, 0.05),
                new THREE.MeshBasicMaterial({ color: '#ffffff' }), vmItemM.length);
            vmItemM.forEach((m, i2) => {
                itemInst.setMatrixAt(i2, m);
                itemInst.setColorAt(i2, vmItemColors[i2]);
            });
            itemInst.instanceMatrix.needsUpdate = true;
            itemInst.instanceColor.needsUpdate = true;
            group.add(itemInst);
        }

        // ---------- single-track TUBES + standard tunnel-entrance portals ----------
        // The two stacked tubes run from each platform end out to the zone boundary, where a
        // standard portal frames the transition into the generic double-track tunnel. A matching
        // standard portal frames the transition into the generic double-track tunnel. A matching
        // standard portal frames the transition into the generic double-track tunnel. A matching
        // portal at each platform end makes the tube join the station hall flush ("bündig").
        const tubeMat = this.materials.tunnelWall;
        const buildEndWall = (d, lat, yc, mat, uLeft, uRight, vBot, vTop, noHole) => {
            const shape = new THREE.Shape();
            shape.moveTo(uLeft, vBot);
            shape.lineTo(uRight, vBot);
            shape.lineTo(uRight, vTop);
            shape.lineTo(uLeft, vTop);
            shape.lineTo(uLeft, vBot);
            if (!noHole) {
                const hole = new THREE.Path();
                const hw = 3.15;
                const hBot = -2.0;
                const hTop = 3.8;
                hole.moveTo(-hw, hBot);
                hole.lineTo(hw, hBot);
                hole.lineTo(hw, hTop);
                hole.lineTo(-hw, hTop);
                hole.lineTo(-hw, hBot);
                shape.holes.push(hole);
            }
            const f = frameAt(d);
            const pp = f.c.clone().addScaledVector(f.nrm, lat);
            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
            mesh.position.set(pp.x, yc, pp.z);
            mesh.rotation.y = f.rotY + Math.PI;
            group.add(mesh);
        };

        const samplePlaerrerPath = (latFn, yFn, d0, d1, ds = 5) => {
            const pts = [];
            const nSeg = Math.max(1, Math.ceil((d1 - d0) / ds));
            for (let i = 0; i <= nSeg; i++) {
                const d = i === nSeg ? d1 : d0 + i * ds;
                const c = sim.getTrackPosition(d);
                const tan = sim.getTrackTangent(d);
                const pt = c.clone().addScaledVector(new THREE.Vector3(-tan.z, 0, tan.x), latFn(d));
                pt.y = c.y + yFn(d);
                pts.push(pt);
            }
            return pts;
        };

        const coll = this._newTrackCollectors();
        for (const sign of [-1, 1]) {
            const inner = P + sign * platHalf;     // platform end (joins the station)
            const outer = P + sign * zoneHalf;     // zone boundary (joins the generic tunnel)
            const r0 = Math.min(inner, outer), r1 = Math.max(inner, outer);
            
            // Build single-track branches for all 4 track corridors (running + opposite)
            // spanning the full zone from platform end (inner) to zone boundary (outer)
            const upperRunPts = samplePlaerrerPath(d => sp(d) / 2, () => 0, r0, r1);
            const lowerRunPts = samplePlaerrerPath(d => -sp(d) / 2, dive, r0, r1);
            const upperOppPts = samplePlaerrerPath(d => sp(d) / 2 - 18.08, () => 0, r0, r1);
            const lowerOppPts = samplePlaerrerPath(d => -sp(d) / 2 - 18.08, dive, r0, r1);

            this._buildSingleTrackBranch(group, coll, upperRunPts, sim, false);
            this._buildSingleTrackBranch(group, coll, lowerRunPts, sim, false);
            this._buildSingleTrackBranch(group, coll, upperOppPts, sim, false);
            this._buildSingleTrackBranch(group, coll, lowerOppPts, sim, false);

            const baseYi = sim.getTrackPosition(inner).y;

            // Upper portals
            if (sign === 1) {
                // Hardhöhe end: fully closed — left upper end wall with opposite track hole
                buildEndWall(inner, sp(inner) / 2 - 18.08, baseYi + 0.8, endWallUpperMat,
                             -4.1, 9.03, -3.8, hallHeight + 0.07);
                // Hardhöhe end: right upper end wall with running track hole
                buildEndWall(inner, sp(inner) / 2, baseYi + 0.8, endWallUpperMat,
                             -9.05, 3.6, -3.8, hallHeight + 0.07);
            } else {
                // Langwasser end: left upper end wall with opposite track hole
                buildEndWall(inner, sp(inner) / 2 - 18.08, baseYi + 0.8, endWallUpperMat,
                             -4.1, 3.28, -3.8, hallHeight + 0.07);
                // Langwasser end: right upper end wall with running track hole
                buildEndWall(inner, sp(inner) / 2, baseYi + 0.8, endWallUpperMat,
                             -3.8, 3.6, -3.8, hallHeight + 0.07);
            }

            // Lower portals (Split into 2 panels, each with a tube hole)
            buildEndWall(inner, -sp(inner) / 2, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         -9.05, 4.1, -3.8, LOWER_CLEAR + platTopY - 0.85);        // right lower end wall
            buildEndWall(inner, -sp(inner) / 2 - 18.08, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         -3.6, 9.03, -3.8, LOWER_CLEAR + platTopY - 0.85);        // left lower end wall
        }
        this._emitTrackCollectors(group, coll);

        // ---------- DEPARTURE BOARDS ----------
        const createBoardMat = (trackLabel, row1, row2) => {
            const mat = stationModel.createDepartureBoardMaterial(trackLabel, row1, row2);
            return [
                stationModel.materials.boardCasing, stationModel.materials.boardCasing,
                stationModel.materials.boardCasing, stationModel.materials.boardCasing,
                mat, mat
            ];
        };

        const via = (line, dir) => stationModel.getUpcomingViaText(line, "Plärrer", dir);

        // Gleis 1 (Upper, U1 -> Hardhöhe)
        const matG1 = createBoardMat("1",
            { line: 'U1', color: '#0055a5', destination: 'Fürth Hardhöhe', via: via('U1', 'forward'), minutes: '3' },
            { line: 'U1', color: '#0055a5', destination: 'Fürth Hardhöhe', via: via('U1', 'forward'), minutes: '13' }
        );
        // Gleis 2 (Lower, U1 -> Langwasser Süd)
        const matG2 = createBoardMat("2",
            { line: 'U1', color: '#0055a5', destination: 'Langwasser Süd', via: via('U1', 'reverse'), minutes: '1' },
            { line: 'U1', color: '#0055a5', destination: 'Langwasser Süd', via: via('U1', 'reverse'), minutes: '8' }
        );
        // Gleis 3 (Upper, U2 -> Röthenbach / U3 -> Grossreuth)
        const matG3 = createBoardMat("3",
            { line: 'U2', color: '#cb0611', destination: 'Röthenbach', via: via('U2', 'reverse'), minutes: '2' },
            { line: 'U3', color: '#2da4a8', destination: 'Grossreuth b. Schw.', via: via('U3', 'reverse'), minutes: '7' }
        );
        // Gleis 4 (Lower, U2 -> Flughafen / U3 -> Nordwestring)
        const matG4 = createBoardMat("4",
            { line: 'U2', color: '#cb0611', destination: 'Flughafen', via: via('U2', 'forward'), minutes: '3' },
            { line: 'U3', color: '#2da4a8', destination: 'Nordwestring', via: via('U3', 'forward'), minutes: '5' }
        );

        const boardZ = [-30, 0, 30];
        const hOff = 2.53 * 0.25;
        const bY = 3.925;

        boardZ.forEach(bz => {
            const f = frameAt(P + bz);
            const spacing = sp(P + bz);

            const addBoard = (latX, yBase, mats, ceilY) => {
                const pos = f.c.clone().addScaledVector(f.nrm, latX);
                const board = new THREE.Mesh(stationModel.sharedGeometries.boardCasing, mats);
                board.position.copy(pos);
                board.position.y = yBase + bY;
                board.rotation.y = f.rotY;
                group.add(board);

                const hLen = ceilY - bY;
                const hY = yBase + bY + hLen / 2;
                const hGeom = new THREE.CylinderGeometry(0.015, 0.015, hLen, 6);
                const hMat = stationModel.materials.boardHanger;
                [hOff, -hOff].forEach(ho => {
                    const h = new THREE.Mesh(hGeom, hMat);
                    h.position.copy(pos.clone().addScaledVector(f.nrm, ho));
                    h.position.y = hY;
                    h.rotation.y = f.rotY;
                    group.add(h);
                });
            };

            // Upper Boards (Gleis 1 and 3) hung from track roofs (4.7m)
            addBoard(spacing / 2 - 3.205, uBaseY, matG1, 4.7);
            addBoard(spacing / 2 - 14.875, uBaseY, matG3, 4.7);

            // Lower Boards (Gleis 2 and 4) hung from lower ceiling (lowerH = 4.615m)
            addBoard(-spacing / 2 - 3.205, lBaseY, matG2, lowerH);
            addBoard(-spacing / 2 - 14.875, lBaseY, matG4, lowerH);
        });

        // Spawn passengers
        stationModel.spawnPassengersForStation(p, group);

        this.scene.add(group);
        this.plaerrerGroup = group;
        return group;
    }

    createPortalGeometry() {
        // Outer frame of the portal (slightly larger than tunnel opening)
        const archShape = new THREE.Shape();
        archShape.moveTo(-7.5, -2.8);
        archShape.lineTo(7.5, -2.8);
        archShape.lineTo(7.5, 6.7);
        archShape.lineTo(-7.5, 6.7);
        archShape.lineTo(-7.5, -2.8);
        
        // Rectangular hole matching the tunnel cross-section
        // halfW default = spacing/2 + 3.1 ~ 6.2 at default scale
        // floorY = -2.8, ceilY = 3.8 relative to center (y offset 0.8)
        const holeW = 6.0; // slightly smaller than the outer frame
        const holeBot = -2.6;
        const holeTop = 3.6;
        const hole = new THREE.Path();
        hole.moveTo(-holeW, holeBot);
        hole.lineTo(holeW, holeBot);
        hole.lineTo(holeW, holeTop);
        hole.lineTo(-holeW, holeTop);
        hole.lineTo(-holeW, holeBot);
        archShape.holes.push(hole);

        const extrudeSettings = { 
            depth: 1.0, 
            bevelEnabled: true, 
            bevelSegments: 1, 
            steps: 1, 
            bevelSize: 0.05, 
            bevelThickness: 0.05 
        };
        const geom = new THREE.ExtrudeGeometry(archShape, extrudeSettings);
        geom.translate(0, 0, -0.5); // center
        return geom;
    }

    getTunnelHalfWidth(s) {
        // Uniform tube width everywhere. Both the blanket per-station moderate
        // widening and the bespoke per-station extra widths that used to sit
        // here were removed: tunnel mouths keep the plain tube width right up
        // to every station.
        return this.sim.getTrackSpacing(s) / 2 + 3.1;
    }

    getTunnelCeilingHeight(s) {
        // Uniform tube ceiling everywhere — the per-station raises (blanket 4.4
        // and the bespoke tall-ceiling list) were removed along with the width
        // widening, so the tube profile no longer flares at stations at all.
        return 3.8;
    }

    // Arc-length zones ([sStart, sEnd] pairs) just past every underground station's
    // platform ends where StationBuilder.buildStairs places the end stair/escalator
    // shafts. The shaft enclosures (walls at ±2.3, 0.4m thick → outer face ±2.5) and
    // the climbing steps pierce the tunnel tube's roof there, so the roof gets a
    // matching rectangular cutout (see createTunnelWallMesh). Plärrer is excluded:
    // its bespoke stacked hall has no generic end stairs.
    getStairShaftZones() {
        if (!this._stairShaftZones) {
            const zones = [];
            for (const st of this.sim.stations) {
                if (st.type !== 'underground' || st.name === 'Plärrer') continue;
                const numSteps = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(st.name) ? 33 : 28;
                const stairLen = numSteps * 0.3; // stepDepth 0.3, climbing outward from the platform end
                zones.push([st.position + st.halfLength, st.position + st.halfLength + stairLen]);
                zones.push([st.position - st.halfLength - stairLen, st.position - st.halfLength]);
            }
            this._stairShaftZones = zones;
        }
        return this._stairShaftZones;
    }

    createTunnelWallMesh(segments, chunkGroup) {
        // Rectangular cross-section swept along the track. Above the station-end
        // stair shafts (getStairShaftZones) the ceiling is emitted as two flanking
        // strips instead of one full-width quad, leaving a hole matching the stair
        // enclosure footprint (±shaftHalf around the centerline).
        const shaftHalf = 2.5;
        const shaftZones = this.getStairShaftZones();

        // Split segments at zone boundaries so each emitted segment is either fully
        // inside or fully outside a shaft zone and the hole starts/ends exactly on
        // the stair footprint, not on the nearest 5m sub-segment boundary.
        const splitSegs = [];
        for (const [s0, s1] of segments) {
            const cuts = [s0, s1];
            for (const [a, b] of shaftZones) {
                if (a > s0 && a < s1) cuts.push(a);
                if (b > s0 && b < s1) cuts.push(b);
            }
            cuts.sort((x, y) => x - y);
            for (let i = 0; i < cuts.length - 1; i++) {
                if (cuts[i + 1] - cuts[i] > 1e-4) splitSegs.push([cuts[i], cuts[i + 1]]);
            }
        }

        const vertices = [];
        const indices = [];
        const uvs = [];
        const normals = [];
        let ringBase = 0;

        const up = new THREE.Vector3(0, 1, 0);
        const normal = new THREE.Vector3();
        const center = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const worldVertex = new THREE.Vector3();
        const faceNormalWorld = new THREE.Vector3();
        const faceNormalLocal = new THREE.Vector3();
        const normalProbe = new THREE.Vector3();

        for (const [s_start, s_end] of splitSegs) {
            const s_mid = (s_start + s_end) / 2;
            const hasShaftHole = shaftZones.some(([a, b]) => s_mid > a && s_mid < b);

            // Profile as consecutive corner points; `connect[k]` says whether corners
            // k and k+1 are joined by a face (false across the roof cutout gap).
            // Without a hole this reproduces the original floor/right/ceiling/left
            // ring exactly.
            const connect = hasShaftHole
                ? [true, true, true, false, true, true]
                : [true, true, true, true];
            const numFaces = connect.length;
            // Two UNSHARED vertices per face per ring: sharing the corner vertices
            // between floor/wall/ceiling made computeVertexNormals average the
            // normals across the 90° edges (and along the strip), which showed up
            // as smudgy light/dark gradients across each face. Each face carries
            // its own exact analytic normal instead.
            const vertsPerRing = 2 * numFaces;

            // Rings every ~2m along the segment (matching buildSweptTrackBox's resStep),
            // not just at the two 5m sub-segment ends — a 5m chord visibly cuts the
            // corner on curves (sagitta ~ L^2/8R), which made this wall look chunky
            // next to the 2m-sampled divider wall.
            const nSub = Math.max(1, Math.ceil((s_end - s_start) / 2));
            for (let j = 0; j <= nSub; j++) {
                const s = s_start + (s_end - s_start) * j / nSub;
                this.sim.getTrackPosition(s, center);
                this.sim.getTrackTangent(s, tangent);

                // Per-side half-widths (asymmetric at the U2<->U3 junction caverns) and
                // ceiling height for the rectangular tunnel
                const halfWL = this.getTunnelSideWidth(s, -1);
                const halfWR = this.getTunnelSideWidth(s, 1);
                const ceilY = this.getTunnelCeilingHeight(s);

                normal.set(-tangent.z, 0, tangent.x).normalize();

                // Tunnel dimensions relative to center
                const floorY = -2.8;  // floor below track center

                // Center offset (same as old code)
                center.y += 0.8;

                // Corner order: bottom-left, bottom-right, top-right, (roof gap edges,)
                // top-left, bottom-left(wrap)
                const cornerOffsets = hasShaftHole
                    ? [
                        [-halfWL, floorY],
                        [ halfWR, floorY],
                        [ halfWR, ceilY],
                        [ shaftHalf, ceilY],
                        [-shaftHalf, ceilY],
                        [-halfWL, ceilY],
                        [-halfWL, floorY],
                    ]
                    : [
                        [-halfWL, floorY],
                        [ halfWR, floorY],
                        [ halfWR, ceilY],
                        [-halfWL, ceilY],
                        [-halfWL, floorY],
                    ];

                // Cumulative perimeter distance for U-mapping. The gap span is included
                // in the running distance so the texture stays aligned with the
                // neighbouring hole-free segments.
                let perimeterCum = 0;
                const perimeterPoints = [];
                for (let k = 0; k < cornerOffsets.length; k++) {
                    if (k > 0) {
                        const d = Math.hypot(cornerOffsets[k][0] - cornerOffsets[k-1][0], cornerOffsets[k][1] - cornerOffsets[k-1][1]);
                        perimeterCum += d;
                    }
                    perimeterPoints.push(perimeterCum);
                }

                for (let k = 0; k < numFaces; k++) {
                    // Inward-facing face normal from the profile edge k -> k+1:
                    // profile edge (dLat, dY), interior on its left => (-dY, dLat).
                    const dLat = cornerOffsets[k + 1][0] - cornerOffsets[k][0];
                    const dY = cornerOffsets[k + 1][1] - cornerOffsets[k][1];
                    const dLen = Math.hypot(dLat, dY) || 1;
                    faceNormalWorld.copy(normal).multiplyScalar(-dY / dLen)
                        .addScaledVector(up, dLat / dLen);

                    for (const kk of [k, k + 1]) {
                        const [lateralOff, verticalOff] = cornerOffsets[kk];

                        worldVertex.copy(center)
                            .addScaledVector(normal, lateralOff)
                            .addScaledVector(up, verticalOff);

                        // Local-space normal via probe point, exact for any chunkGroup
                        // transform (they are translation-only today, but cheap anyway).
                        normalProbe.copy(worldVertex).add(faceNormalWorld);
                        const localVertex = chunkGroup.worldToLocal(worldVertex);
                        faceNormalLocal.copy(chunkGroup.worldToLocal(normalProbe)).sub(localVertex).normalize();

                        vertices.push(localVertex.x, localVertex.y, localVertex.z);
                        normals.push(faceNormalLocal.x, faceNormalLocal.y, faceNormalLocal.z);

                        // UV: U follows the perimeter in METERS, V follows track length in METERS.
                        // Tiled at 4m x 4m.
                        uvs.push(perimeterPoints[kk] / 4.0, s / 4.0);
                    }
                }
            }

            // Generate indices for faces (inward-facing normals), one quad strip
            // between each pair of consecutive rings
            for (let j = 0; j < nSub; j++) {
                const front = ringBase + j * vertsPerRing;
                const back = front + vertsPerRing;
                for (let k = 0; k < numFaces; k++) {
                    if (!connect[k]) continue;
                    const a = front + 2 * k;
                    const b = front + 2 * k + 1;
                    const c = back + 2 * k;
                    const d = back + 2 * k + 1;

                    // Two triangles per quad (front faces facing inside the tunnel)
                    indices.push(a, b, c);
                    indices.push(b, d, c);
                }
            }
            ringBase += (nSub + 1) * vertsPerRing;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setIndex(indices);

        return new THREE.Mesh(geometry, this.materials.tunnelWall);
    }

    // Adds 5 horizontal black cables along both side walls of the tunnel.
    // The cables have a 100m wavelength and 20cm amplitude.
    createTunnelCables(segments, chunkGroup, startZ) {
        const vertices = [];
        const indices = [];
        let vertexCount = 0;

        const numCables = 5;
        const cableSpacing = 0.1; // 10cm apart
        const yBase = 0.5; // Lowered from 1.0m to hang lower

        // Outer wall cables: present along every underground segment,
        // regardless of station proximity (unlike the divider cables below).
        for (const [s_start, s_end] of segments) {
            for (let i = 0; i < numCables; i++) {
                const yOff = yBase + i * cableSpacing;
                for (const sideSign of [-1, 1]) {
                    vertexCount += this._addCableSegment(s_start, s_end, sideSign, true, yOff, vertices, indices, vertexCount, chunkGroup);
                }
            }
        }

        // Divider cables: only across the same runs the divider wall itself
        // occupies (getDividerWallRuns) — using the wall's own 5m-precise
        // boundaries instead of a once-per-segment check keeps the cables
        // from floating into the 20m buffer zone where there's no wall.
        for (const { sStart, sEnd } of this.getDividerWallRuns(startZ)) {
            for (let i = 0; i < numCables; i++) {
                const yOff = yBase + i * cableSpacing;
                for (const sideSign of [-1, 1]) {
                    vertexCount += this._addCableSegment(sStart, sEnd, sideSign, false, yOff, vertices, indices, vertexCount, chunkGroup);
                }
            }
        }

        if (vertices.length === 0) return null;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return new THREE.Mesh(geometry, this.materials.cable);
    }

    // Samples the cable ribbon every `resStep` meters between s_start/s_end
    // instead of just the two endpoints, so it follows the true track curve
    // (and its own sine sag) the same way buildSweptTrackBox/buildSweptFence
    // do for the bed/fences — a straight chord between two far-apart points
    // visibly cut corners on curves. Returns the vertex count added, so the
    // caller can advance its running vStart correctly.
    _addCableSegment(s_start, s_end, sideSign, isOuter, yOff, vertices, indices, vStart, chunkGroup, resStep = 2) {
        const length = s_end - s_start;
        if (length <= 0) return 0;
        const up = new THREE.Vector3(0, 1, 0);
        const normal = new THREE.Vector3();
        const center = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const worldVertex = new THREE.Vector3();
        const cableWidth = 0.04;
        const waveLength = 100.0;
        const amplitude = 0.2;

        const nSeg = Math.max(1, Math.ceil(length / resStep));
        // Winding: outer wall side -1 (left) needs flip, side 1 (right) doesn't.
        // Divider: side -1 (inner left) doesn't need flip, side 1 (inner right) needs flip.
        const shouldFlip = isOuter ? (sideSign === -1) : (sideSign === 1);

        for (let r = 0; r <= nSeg; r++) {
            const s = s_start + length * r / nSeg;
            this.sim.getTrackPosition(s, center);
            this.sim.getTrackTangent(s, tangent);

            let lateralOff;
            if (isOuter) {
                lateralOff = sideSign * (this.getTunnelSideWidth(s, sideSign) - 0.03);
            } else {
                // Divider face is at spacing/2 - 0.7675 - 1.75 = (spacing - 5.035)/2
                const dividerHalfW = (this.sim.getTrackSpacing(s) - 5.035) / 2;
                lateralOff = sideSign * (dividerHalfW + 0.03); // 3cm in front of divider
            }

            normal.set(-tangent.z, 0, tangent.x).normalize();
            const wave = Math.sin(s * Math.PI * 2 / waveLength) * amplitude;
            const totalY = yOff + wave + 0.8;

            for (let k = 0; k <= 1; k++) {
                const vOffset = (k === 0 ? -cableWidth / 2 : cableWidth / 2);
                worldVertex.copy(center)
                    .addScaledVector(normal, lateralOff)
                    .addScaledVector(up, totalY + vOffset);

                const localVertex = chunkGroup.worldToLocal(worldVertex);
                vertices.push(localVertex.x, localVertex.y, localVertex.z);
            }

            if (r > 0) {
                const b = vStart + (r - 1) * 2;
                if (shouldFlip) {
                    indices.push(b, b + 2, b + 1);
                    indices.push(b + 1, b + 2, b + 3);
                } else {
                    indices.push(b, b + 1, b + 2);
                    indices.push(b + 1, b + 3, b + 2);
                }
            }
        }
        return (nSeg + 1) * 2;
    }

    // Contiguous 5m-granularity runs where a continuous divider WALL should
    // exist (spacing > 5.135m i.e. dividerWidth > 0.1, underground, not
    // within a station's platform + 20m buffer, not Plärrer). Shared by
    // createTunnelDividers (the wall itself) and createTunnelCables (the
    // cables that run alongside it), so both line up — the cables used to
    // only check once per up-to-50m chunk-segment, a much coarser test that
    // let them float into the 20m buffer zone where the wall doesn't exist.
    getDividerWallRuns(startZ) {
        const numSub = 10;
        const subLen = this.chunkSize / numSub;
        const stationBuffer = 20.0;
        const runs = [];
        let run = null;
        const lineId = this.sim.track.lineId;
        for (let j = 0; j < numSub; j++) {
            const raw_s_start = startZ + j * subLen;
            const raw_s_end = startZ + (j + 1) * subLen;
            const s_mid = (raw_s_start + raw_s_end) / 2;

            let ok = !this.sim.isPlaerrerZone(s_mid) && this.getChunkType(s_mid) === 'underground';
            
            const clamped = this._clampInterval(raw_s_start, raw_s_end, lineId);
            if (!clamped) ok = false;
            
            if (ok) {
                const spacing = this.sim.getTrackSpacing(s_mid);
                ok = (spacing - 5.035) > 0.1 && spacing >= 4.0;
            }
            if (ok) {
                const [s_start, s_end] = clamped;
                for (const st of this.sim.stations) {
                    if (Math.abs(s_mid - st.position) < st.halfLength + stationBuffer) { ok = false; break; }
                }
                if (ok) {
                    if (!run) run = { sStart: s_start, sEnd: s_end };
                    else run.sEnd = s_end;
                }
            }
            if (!ok && run) {
                runs.push(run);
                run = null;
            }
        }
        if (run) runs.push(run);
        return runs;
    }

    // Creates dividers between the two tracks inside the tunnel:
    // - spacing >= 4m (dividerWidth > 0.1): continuous concrete WALL, swept
    //   along the true curve like the track bed/platforms (see
    //   buildSweptTrackBox) instead of a chain of flat, only-yaw-rotated
    //   boxes that didn't bend within their own 5m span.
    // - spacing < 4m: concrete PILLARS (dynamically sized) every ~5m —
    //   discrete posts are already correctly positioned/oriented per
    //   instance, so they don't have the "chord on a curve" problem and stay
    //   as instanced placements.
    // Width leaves 1.75m clearance from the inner rail edge to the divider face.
    // Inner rail edge = trackCenter ± (0.7175 + 0.05) = ±0.7675 from track center.
    // Dividers start 20m after each station platform ends (not at trasse portals).
    createTunnelDividers(chunkGroup, startZ, addBatchedMatrix) {
        const numSub = 10;
        const subLen = this.chunkSize / numSub;
        const floorY = -2.8;
        const ceilY = 3.8;
        const wallHeight = ceilY - floorY; // 6.6m
        const centerYOffset = 0.8; // same Y offset as tunnel walls
        const stationBuffer = 20.0; // 20m clearance after station platform ends
        const gTY = (s) => this.sim.getTrackY(s);
        const gSp = (s) => this.sim.getTrackSpacing(s);

        // Continuous concrete wall: one swept mesh per contiguous run (see
        // getDividerWallRuns — shared with createTunnelCables so the wall and
        // its cables always cover exactly the same stretch).
        for (const { sStart, sEnd } of this.getDividerWallRuns(startZ)) {
            this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                (s) => (gSp(s) - 5.035) / 2,
                (s) => gTY(s) + centerYOffset + floorY,
                (s) => gTY(s) + centerYOffset + ceilY,
                this.materials.dividerWall);
        }

        // Narrow spacing: discrete concrete pillars every ~5m.
        const lineId = this.sim.track.lineId;
        for (let j = 0; j < numSub; j++) {
            const s_mid = startZ + j * subLen + subLen / 2;
            if (this.sim.isPlaerrerZone(s_mid)) continue;
            if ((lineId === 'U2' || lineId === 'U3') && (this.sim.isTrunkZone(s_mid) || this.sim.isSwitchZone(s_mid))) continue;
            if (this.getChunkType(s_mid) !== 'underground') continue;

            let nearStation = false;
            for (const st of this.sim.stations) {
                if (Math.abs(s_mid - st.position) < st.halfLength + stationBuffer) { nearStation = true; break; }
            }
            if (nearStation) continue;

            const spacing = gSp(s_mid);
            // Divider width: 1.75m gap from inner rail edge to divider face on each side.
            // Inner rail of each track is at spacing/2 - 0.7175 (half gauge) from center,
            // rail half-width is 0.05m, so inner edge is at spacing/2 - 0.7675.
            // dividerHalfWidth = spacing/2 - 0.7675 - 1.75
            // dividerWidth = spacing - 2 * (0.7675 + 1.75) = spacing - 5.035
            const dividerWidth = spacing - 5.035;
            if (dividerWidth <= 0.1 || spacing >= 4.0) continue; // too narrow, or handled by the wall runs above

            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const localPos = chunkGroup.worldToLocal(pos.clone());
            const angle = Math.atan2(tangent.x, tangent.z) - chunkGroup.rotation.y;

            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
            const pillarY = localPos.y + centerYOffset + floorY + wallHeight / 2;
            const scaleXZ = dividerWidth / 0.5; // dividerPillar base geometry is 0.5m
            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(localPos.x, pillarY, localPos.z),
                q,
                new THREE.Vector3(scaleXZ, wallHeight, scaleXZ)
            );
            addBatchedMatrix('dividerPillar', this.geometries.dividerPillar, this.materials.dividerPillar, m);
        }
    }


    // Sweeps a solid rectangular BOX cross-section along the track spline between sStart..sEnd
    // as ONE continuous BufferGeometry, instead of a chain of straight 5m boxes each only
    // yaw-rotated to face the curve. Used for track beds AND fences/retaining walls alike —
    // both are just boxes at different width/offset/height, so one helper covers both.
    //
    // This is what fixes the "staircase" look on ramps: the old code centred each flat,
    // perfectly HORIZONTAL box at a different height per 5m sub-segment (no pitch), which
    // visually stacks like steps. Here every ring samples its own true elevation
    // (yBotFn/yTopFn return ABSOLUTE world Y, typically this.sim.getTrackY(s) + offset), so
    // the quad connecting two rings is itself a tilted plane that follows the true slope —
    // exact wherever the elevation profile is linear (which it is, between breakpoints),
    // and it also lets width/offset vary continuously with the local track spacing instead
    // of stepping per 5m sub-segment.
    //
    // centerOffFn(s): lateral offset of the box's centre from the track centreline.
    // halfWidthFn(s): half-width of the box.
    // yBotFn(s)/yTopFn(s): ABSOLUTE world Y of the box's bottom/top face at that ring.
    // UV is baked in real metres (1 repeat per meter, same convention the old boxes used), so the shared
    // RepeatWrapping ballast/viaduct materials can be reused directly — no cloning needed.
    buildSweptTrackBox(chunkGroup, sStart, sEnd, centerOffFn, halfWidthFn, yBotFn, yTopFn, material, resStep = 2) {
        const length = sEnd - sStart;
        if (length <= 0) return null;
        const nSeg = Math.max(1, Math.ceil(length / resStep));
        const rings = [];
        let cum = 0;
        const wp = new THREE.Vector3(), tan = new THREE.Vector3(), prevWp = new THREE.Vector3();
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            this.sim.getTrackPosition(s, wp);
            this.sim.getTrackTangent(s, tan);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = centerOffFn ? centerOffFn(s) : 0;
            const hw = halfWidthFn(s);
            const yTop = yTopFn(s), yBot = yBotFn(s);
            if (r > 0) cum += wp.distanceTo(prevWp);
            prevWp.copy(wp);
            const mk = (lat, y) => chunkGroup.worldToLocal(new THREE.Vector3(wp.x + nX * lat, y, wp.z + nZ * lat));
            rings.push({ bl: mk(off - hw, yBot), br: mk(off + hw, yBot), tr: mk(off + hw, yTop), tl: mk(off - hw, yTop), cum, w2: hw * 2 });
        }
        const pos = [], uv = [];
        const tri = (a, b, c, ua, ub, uc) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); };
        const quad = (p0, p1, p2, p3, u0, u1, u2, u3) => { tri(p0, p1, p2, u0, u1, u2); tri(p0, p2, p3, u0, u2, u3); };
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1];
            quad(A.tl, A.tr, B.tr, B.tl, [0, A.cum], [A.w2, A.cum], [B.w2, B.cum], [0, B.cum]); // top
            quad(A.br, A.bl, B.bl, B.br, [0, A.cum], [A.w2, A.cum], [B.w2, B.cum], [0, B.cum]); // bottom
            quad(A.bl, A.tl, B.tl, B.bl, [0, A.cum], [0, A.cum], [0, B.cum], [0, B.cum]); // left side
            quad(A.tr, A.br, B.br, B.tr, [0, A.cum], [0, A.cum], [0, B.cum], [0, B.cum]); // right side
        }
        const c0 = rings[0], cN = rings[nSeg];
        quad(c0.bl, c0.br, c0.tr, c0.tl, [0, 0], [1, 0], [1, 1], [0, 1]); // start cap
        quad(cN.tl, cN.tr, cN.br, cN.bl, [0, 0], [1, 0], [1, 1], [0, 1]); // end cap

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(geom, material);
        chunkGroup.add(mesh);
        return mesh;
    }

    update(trainZ) {
        // Distance-culling for the bespoke Plärrer complex: its hundreds of meshes are
        // only worth traversing/rendering when the train is anywhere near the zone.
        if (this.plaerrerGroup && this.sim.plaerrer) {
            const plaerrerVisibleDist = this.sim.plStackHalf + this.sim.plRamp + 600;
            this.plaerrerGroup.visible = Math.abs(trainZ - this.sim.plaerrer.position) < plaerrerVisibleDist;
        }

        const currentChunkIdx = Math.floor(trainZ / this.chunkSize);

        // Streaming-Early-Out: das Chunk-Fenster kann sich nur ändern, wenn der Zug
        // eine 50m-Chunk-Grenze überquert hat — dazwischen ist der komplette
        // Fenster-Scan unten (81 getChunkType-Aufrufe + Map-Iteration) pro Frame
        // reine Wiederholung. Nach einem Rig-/Linienwechsel greift der Cache nicht
        // (frische Instanz bzw. geänderte activeChunks), Teleports ändern den Index.
        if (currentChunkIdx === this._lastStreamChunkIdx && this.activeChunks.size > 0) return;
        this._lastStreamChunkIdx = currentChunkIdx;

        // Deep underground the tunnel is pitch black beyond ~200 m, so a smaller streaming
        // window suffices. Only shrink it when the FULL default window is underground —
        // near portals the daylight world must already be streamed in before it gets visible.
        let windowChunks = this.tunnelChunksCount;
        for (let i = currentChunkIdx - this.visibleChunksCount; i <= currentChunkIdx + this.visibleChunksCount; i++) {
            const z = (i + 0.5) * this.chunkSize;
            if (z < 0 || z > this.sim.totalLength) continue;
            if (this.sim.getChunkType(z) !== 'underground') {
                windowChunks = this.visibleChunksCount;
                break;
            }
        }

        const minChunk = Math.max(0, currentChunkIdx - windowChunks);
        const maxChunk = Math.min(Math.floor(this.sim.totalLength / this.chunkSize), currentChunkIdx + windowChunks);

        // Ensure all chunks in the window are in the scene. Chunks are built once and then
        // cached forever: re-entering an area re-adds the cached group instead of rebuilding
        // geometry mid-frame (this removes the 50m-interval hitches and the old GPU-memory
        // churn from never-disposed geometries).
        for (let i = minChunk; i <= maxChunk; i++) {
            if (!this.activeChunks.has(i)) {
                let chunk = this.chunkCache.get(i);
                if (!chunk) {
                    chunk = this.createChunk(i);
                    this.chunkCache.set(i, chunk);
                }
                this.scene.add(chunk);
                this.activeChunks.set(i, chunk);
            }
        }

        // Detach far away chunks from the scene (they stay cached)
        for (const [idx, chunk] of this.activeChunks.entries()) {
            if (idx < minChunk || idx > maxChunk) {
                this.scene.remove(chunk);
                this.activeChunks.delete(idx);
            }
        }
    }

    // Sammelt alle Rolltreppen-Meshes (hier: die der Plärrer-Halle) für die
    // entfernungsbasierte Rolltreppen-Ambience in main.js (updateEscalatorAmbience).
    // Die eigentliche Stufen-Animation läuft im Vertex-Shader (StationBuilder).
    registerEscalator(mesh, params) {
        if (!this.escalators) this.escalators = [];
        this.escalators.push(mesh);
    }

    tick(dt, time) {
        // Shared escalator animation is handled via the StationModel's global uniform.
    }

    _clampInterval(s0, s1, lineId) {
        if (s0 > this.sim.totalLength) return null;
        if (s1 > this.sim.totalLength) s1 = this.sim.totalLength;
        if (s0 < 0) s0 = 0;

        const isU23 = (lineId === 'U2' || lineId === 'U3');
        // U1 (and any other plain line) has no trunk/switch zones -- pass through unchanged.
        // The shared trunk rig (lineId 'TRUNK') is EXEMPT from trunk-zone suppression (it MUST
        // build the trunk itself) but IS subject to switch-zone suppression: the hand-authored
        // switch piece owns the throat geometry, so the trunk tube must stop at the platform
        // edge just like the per-line tubes do (otherwise, now that EXTRACT_MARGIN reaches past
        // the platform, it would poke into the switch and z-fight the branch tubes).
        if (!isU23 && lineId !== 'TRUNK') {
            if (s0 >= s1) return null;
            return [s0, s1];
        }

        if (isU23 && this.sim.trunkZone) {
            const [tz0, tz1] = this.sim.trunkZone;
            if (s0 >= tz0 && s1 <= tz1) return null;
            if (s0 < tz1 && s1 > tz1) s0 = tz1;
            else if (s0 < tz0 && s1 > tz0) s1 = tz0;
        }

        if (this.sim.switchZones) {
            for (const z of this.sim.switchZones) {
                const [sz0, sz1] = z.range;
                if (s0 >= sz0 && s1 <= sz1) return null;
                if (s0 < sz1 && s1 > sz1) s0 = sz1;
                else if (s0 < sz0 && s1 > sz0) s1 = sz0;
            }
        }

        if (s0 >= s1) return null;
        return [s0, s1];
    }

    createChunk(idx) {
        const startZ = idx * this.chunkSize;
        const endZ = (idx + 1) * this.chunkSize;

        const lineId = this.sim.track.lineId;

        const chunkGroup = new THREE.Group();
        const posStart = this.sim.getTrackPosition(startZ);
        const posEnd = this.sim.getTrackPosition(endZ);
        const posCenter = new THREE.Vector3().addVectors(posStart, posEnd).multiplyScalar(0.5);
        const chunkGroupY = posCenter.y;
        const dir = new THREE.Vector3().subVectors(posEnd, posStart);
        const angle = Math.atan2(dir.x, dir.z);

        chunkGroup.position.copy(posCenter);
        chunkGroup.rotation.y = angle;
        chunkGroup.updateMatrix();
        chunkGroup.updateMatrixWorld(true);

        // Keep centerZ as the distance along the line for type checking
        const centerZ = startZ + this.chunkSize / 2;
        const chunkType = this.getChunkType(centerZ);

        // Resolve materials dynamically to darken tunnels
        let ballastMat = this.materials.ballast;

        const isPlatform = this.isInsideStationPlatform(centerZ);
        if (chunkType === 'underground' && !isPlatform) {
            ballastMat = this.materials.tunnelBallast;
        }

        // --- Batching collectors ------------------------------------------------------
        // All small static per-sub-segment meshes (beds, walls, ground, streets, lamps ...)
        // are gathered per (geometry, material) pair and emitted as ONE InstancedMesh each
        // at the end of createChunk, instead of ~50-80 individual meshes per chunk.
        const batches = new Map();
        const _bq = new THREE.Quaternion();
        const _be = new THREE.Euler();
        const _bp = new THREE.Vector3();
        const _bs = new THREE.Vector3();
        const addBatchedMatrix = (key, geom, mat, matrix) => {
            let b = batches.get(key);
            if (!b) { b = { geom, mat, mats: [] }; batches.set(key, b); }
            b.mats.push(matrix);
        };
        const addBatched = (key, geom, mat, x, y, z, rotYVal, sx = 1, sy = 1, sz = 1) => {
            _be.set(0, rotYVal, 0);
            _bq.setFromEuler(_be);
            const m = new THREE.Matrix4().compose(_bp.set(x, y, z), _bq, _bs.set(sx, sy, sz));
            addBatchedMatrix(key, geom, mat, m);
        };
        // Tunnel-wall arc segments, merged into a single geometry after the loop
        const tunnelWallSegs = [];

        // Subdivide chunk into 10 sub-segments of length 5 meters for beds/walls and rails
        const numSub = 10;
        const subLen = this.chunkSize / numSub;

        // Track bed / fence "kind" (classified per sub-segment below) is tracked across runs
        // and flushed as ONE continuous swept mesh per contiguous run, instead of one flat
        // box per 5m sub-segment (buildSweptTrackBox — see its comment for why this also
        // fixes the "staircase" look on ramps). A run only ends where the kind actually
        // changes (or at a Plärrer gap / the end of the chunk), so a run can span the whole
        // chunk on straight, unbroken track.
        let bedRun = null; // { kind, sStart, sEnd }
        const flushBedRun = () => {
            if (!bedRun) return;
            const { kind, sStart, sEnd } = bedRun;
            const gTY = (s) => this.sim.getTrackY(s);
            const gSp = (s) => this.sim.getTrackSpacing(s);

            // Lay a mathematically curved, smooth 600m-wide grass ground carpet for all open-air sections
            if (kind === 'viaduct' || kind === 'ramp' || kind === 'atgrade-split' || kind === 'atgrade-normal') {
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    () => 300, () => -0.50, () => -0.49, this.materials.ground);
            }

            if (kind === 'viaduct') {
                // Concrete bridge deck below, gravel ballast bed on top (same thickness/
                // position as the at-grade ballast layer) — the Trasse still runs on Schotter.
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.3) / 2, (s) => gTY(s) - 0.80, (s) => gTY(s) - 0.45, this.materials.viaduct);
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.3) / 2, (s) => gTY(s) - 0.45, (s) => gTY(s) - 0.30, ballastMat);
                for (const sign of [1, -1]) {
                    const offsetFn = (s) => sign * (gSp(s) / 2 + 2.15);
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, offsetFn,
                        () => 0.1, (s) => gTY(s) - 0.25, (s) => gTY(s) + 0.75, this.materials.viaduct);
                    this.buildSweptFence(chunkGroup, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.75, (s) => gTY(s) + 1.95, this.materials.fence);
                    this.placeFencePosts(addBatched, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.75, 1.2, chunkGroup);
                }
            } else if (kind === 'ramp') {
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.3) / 2, (s) => gTY(s) - 0.80, (s) => gTY(s) - 0.45, this.materials.viaduct);
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.3) / 2, (s) => gTY(s) - 0.45, (s) => gTY(s) - 0.30, ballastMat);
                for (const sign of [1, -1]) {
                    const offsetFn = (s) => sign * (gSp(s) / 2 + 2.15);
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, offsetFn,
                        () => 0.1, (s) => gTY(s) - 0.25, (s) => gTY(s) + 0.75, this.materials.concrete);
                    this.buildSweptFence(chunkGroup, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.75, (s) => gTY(s) + 1.95, this.materials.fence);
                    this.placeFencePosts(addBatched, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.75, 1.2, chunkGroup);
                }
            } else if (kind === 'atgrade-split') {
                for (const sign of [1, -1]) {
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, (s) => sign * gSp(s) / 2,
                        () => 1.6, (s) => gTY(s) - 0.45, (s) => gTY(s) - 0.30, ballastMat);
                    
                    const offsetFn = (s) => sign * (gSp(s) / 2 + 2.15);
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, offsetFn,
                        () => 0.1, (s) => gTY(s) - 0.45, (s) => gTY(s) + 0.55, this.materials.concrete);
                    this.buildSweptFence(chunkGroup, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.55, (s) => gTY(s) + 1.75, this.materials.fence);
                    this.placeFencePosts(addBatched, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.55, 1.2, chunkGroup);
                }
            } else if (kind === 'atgrade-normal') {
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 3.8) / 2, (s) => gTY(s) - 0.45, (s) => gTY(s) - 0.30, ballastMat);
                for (const sign of [1, -1]) {
                    const offsetFn = (s) => sign * (gSp(s) / 2 + 2.15);
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, offsetFn,
                        () => 0.1, (s) => gTY(s) - 0.45, (s) => gTY(s) + 0.55, this.materials.concrete);
                    this.buildSweptFence(chunkGroup, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.55, (s) => gTY(s) + 1.75, this.materials.fence);
                    this.placeFencePosts(addBatched, sStart, sEnd, offsetFn,
                        (s) => gTY(s) + 0.55, 1.2, chunkGroup);
                }
            } else if (kind === 'shaft') {
                const wShaft = (s) => gSp(s) + 4.5;
                const wallCenterY = (s) => (gTY(s) - 0.85) / 2;
                const wallHalfH = (s) => (0.15 - gTY(s)) / 2;
                for (const sign of [1, -1]) {
                    const offsetFn = (s) => sign * wShaft(s) / 2;
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, offsetFn,
                        () => 0.1, (s) => wallCenterY(s) - wallHalfH(s), (s) => wallCenterY(s) + wallHalfH(s), this.materials.concrete);
                    this.buildSweptFence(chunkGroup, sStart, sEnd, offsetFn,
                        () => -0.35, () => 0.85, this.materials.fence);
                    this.placeFencePosts(addBatched, sStart, sEnd, offsetFn,
                        () => -0.35, 1.2, chunkGroup);
                }
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => wShaft(s) / 2, (s) => gTY(s) - 0.65, (s) => gTY(s) - 0.45, this.materials.viaduct);
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.2) / 2, (s) => gTY(s) - 0.695, (s) => gTY(s) - 0.295, ballastMat);
                // Grass cutout either side of the shaft, exposing the retaining walls. The
                // INNER edge (the visible cutout boundary) tracks wShaft(s)/2 continuously —
                // same run, same function as the retaining walls above — instead of the old
                // per-5m step, which is what made the opening look jagged on curves. The
                // OUTER edge stays fixed at 300m, matching the normal 600m-wide ground carpet.
                for (const sign of [1, -1]) {
                    const outer = 300;
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd,
                        (s) => sign * (wShaft(s) / 2 + outer) / 2,
                        (s) => (outer - wShaft(s) / 2) / 2,
                        () => -0.50, () => -0.49, this.materials.ground);
                }
            } else if (kind === 'tunnel' || kind === 'tunnel-platform') {
                const yOff = kind === 'tunnel-platform' ? 0.52 : 0.50;
                // Color resolved from `kind` itself (already classified per 5m
                // sub-segment / continuous run at the real platform boundary),
                // NOT from the outer `ballastMat` variable — that one is only
                // resolved once per 50m CHUNK from the chunk's center point, so
                // the bright/dark bed transition used to land wherever the
                // chunk center happened to fall, up to ~25m off the actual
                // platform edge that `kind` already gets right.
                // Underground track runs on a ballastless concrete Gleisbett (Feste
                // Fahrbahn) instead of gravel ballast — no cross-ties there either,
                // the rails are fastened straight to the slab (see the rail-clip loop).
                const concreteBedMat = kind === 'tunnel-platform' ? this.materials.innerBed : this.materials.tunnelInnerBed;
                // Bed spans the full (possibly asymmetric, at junction caverns) tunnel width
                const bedOffsetFn = (s) => (this.getTunnelSideWidth(s, 1) - this.getTunnelSideWidth(s, -1)) / 2;
                const bedHalfWidthFn = (s) => (this.getTunnelSideWidth(s, 1) + this.getTunnelSideWidth(s, -1)) / 2;
                const bedBotFn = (s) => gTY(s) - yOff - 0.2;
                const bedTopFn = (s) => gTY(s) - yOff + 0.2;
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd,
                    bedOffsetFn, bedHalfWidthFn, bedBotFn, bedTopFn, concreteBedMat);
            }
            bedRun = null;
        };

        for (let j = 0; j < numSub; j++) {
            const raw_s_start = startZ + j * subLen;
            const raw_s_end = startZ + (j + 1) * subLen;
            const s_mid = (raw_s_start + raw_s_end) / 2;

            if (this.sim.isPlaerrerZone(s_mid)) { flushBedRun(); continue; }
            if ((lineId === 'U2' || lineId === 'U3') && (this.sim.isTrunkZone(s_mid) || this.sim.isSwitchZone(s_mid))) { flushBedRun(); continue; }
            // Trunk rig: skip the switch throat (the switch piece owns tube/bed/rails there);
            // it stays exempt from the trunk-zone skip since it must build the trunk itself.
            if (lineId === 'TRUNK' && this.sim.isSwitchZone(s_mid)) { flushBedRun(); continue; }
            
            const clamped = this._clampInterval(raw_s_start, raw_s_end, lineId);
            if (!clamped) { flushBedRun(); continue; }
            const [s_start, s_end] = clamped;

            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const spacing = this.sim.getTrackSpacing(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - chunkGroup.rotation.y;
            const localPos = chunkGroup.worldToLocal(pos.clone());

            const subChunkType = this.getChunkType(s_mid);

            // Build tunnel wall segment if it overlaps with underground tunnels.
            // Underground = [0,p1], [p2,p3], [p4,end] from the re-anchored elevation breakpoints
            // (U1's hand-tuned profile), or -- for tracks with a generic elevationZones list
            // (e.g. U2/U3, entirely underground) -- every 'underground'/'shaft' zone.
            let tunnelIntervals;
            if (this.sim.track.elevationZones) {
                tunnelIntervals = [];
                let zoneStart = 0;
                for (const zn of this.sim.track.elevationZones) {
                    if (zn.type === 'underground' || zn.type === 'shaft') tunnelIntervals.push([zoneStart, zn.end]);
                    zoneStart = zn.end;
                }
            } else {
                const e = this.sim.track.elevation;
                tunnelIntervals = [
                    [0, e.p1],
                    [e.sh2, e.p3],
                    [e.p4, this.sim.totalLength]
                ];
            }
            tunnelIntervals.forEach(interval => {
                const intersectStart = Math.max(s_start, interval[0]);
                const intersectEnd = Math.min(s_end, interval[1]);
                if (intersectStart >= intersectEnd) return;

                // EVERY station builds its own enclosing walls/ceiling (StationModel's
                // hall, or a bespoke builder like LorenzkircheBuilder's dome vault), so
                // the generic tube is suppressed across the platform itself. This used
                // to be a per-5m-sub-segment MIDPOINT check against halfLength+1
                // (isInsideStationPlatform), which rounded the tube start outward by up
                // to ~3.5m — the visible GAP between a station's portal end wall and
                // the tunnel wall/roof. Instead, subtract the exact platform interval
                // (station.position ± halfLength — the portal end wall plane) from the
                // segment, so the tube now runs flush up to the portal.
                let pieces = [[intersectStart, intersectEnd]];
                for (const st of this.sim.stations) {
                    const a = st.position - st.halfLength, b = st.position + st.halfLength;
                    const next = [];
                    for (const [p0, p1] of pieces) {
                        if (b <= p0 || a >= p1) { next.push([p0, p1]); continue; }
                        if (p0 < a) next.push([p0, a]);
                        if (p1 > b) next.push([b, p1]);
                    }
                    pieces = next;
                }
                for (const [p0, p1] of pieces) {
                    if (p1 - p0 < 1e-4) continue;
                    // Plärrer is enclosed by a bespoke rectangular hall (buildPlaerrer),
                    // so suppress the generic tube there (it is too small to reach
                    // the lower level anyway).
                    if (this.sim.isPlaerrerZone((p0 + p1) / 2)) continue;
                    tunnelWallSegs.push([p0, p1]);
                }
            });

            // 1. Track bed / fence: classify this sub-segment's "kind" and extend the current
            // run, or flush it and start a new one if the kind just changed. The actual
            // geometry is built once per contiguous run in flushBedRun() above, as one
            // continuous swept mesh (see buildSweptTrackBox for why that fixes ramp "steps").
            const isPlatformHere = this.isInsideStationPlatform(s_mid);
            let kind;
            if (subChunkType === 'elevated') kind = 'viaduct';
            else if (subChunkType === 'ramp') kind = 'ramp';
            else if (subChunkType === 'at-grade') kind = (isPlatformHere && spacing > 15.0) ? 'atgrade-split' : 'atgrade-normal';
            else if (subChunkType === 'shaft') kind = 'shaft';
            else kind = isPlatformHere ? 'tunnel-platform' : 'tunnel';

            if (!bedRun) bedRun = { kind, sStart: s_start, sEnd: s_end };
            else if (bedRun.kind !== kind) { flushBedRun(); bedRun = { kind, sStart: s_start, sEnd: s_end }; }
            else bedRun.sEnd = s_end;

        }
        flushBedRun(); // build the last open run (nothing left to change its kind)

        // Merged tunnel wall: one geometry + one draw call for the whole chunk
        if (tunnelWallSegs.length > 0) {
            chunkGroup.add(this.createTunnelWallMesh(tunnelWallSegs, chunkGroup));
            const cables = this.createTunnelCables(tunnelWallSegs, chunkGroup, startZ);
            if (cables) chunkGroup.add(cables);
        }

        // Add tunnel dividers (concrete walls or pillars between tracks)
        if (chunkType === 'underground') {
            this.createTunnelDividers(chunkGroup, startZ, addBatchedMatrix);
        }

        // Add elevated pillars underneath the tracks
        if (chunkType === 'elevated' || chunkType === 'ramp') {
            this.createPillars(chunkGroup, startZ);
        }

        // Bauernfeindstraße's tunnel is shallow enough right past the platform that the
        // surface grass field keeps going for ~100m past sh2 (a buried cut-and-cover
        // roof), but with a continuous cutout the whole way so no grass renders directly
        // over the tunnel bore itself -- only flanking it, same technique as the old
        // open-cut 'shaft' ground carpet. The cutout widens near the walkway (poking up
        // through the field) and otherwise just tracks the tube's own width.
        {
            const e = this.sim.track.elevation;
            if (e && e.sh2 != null) {
                const grassStart = e.sh2, grassEnd = e.sh2 + 100.0, walkwayEnd = e.sh2 + 8.0;
                const outerHalf = 300;
                const innerHalf = (s) => Math.max(this.getTunnelHalfWidth(s) + 0.5, (s < walkwayEnd) ? 9.0 : 0);
                const clip = (a, b) => {
                    const s0 = Math.max(a, startZ), s1 = Math.min(b, endZ);
                    return s0 < s1 ? [s0, s1] : null;
                };
                const grassRange = clip(grassStart, grassEnd);
                if (grassRange) {
                    const [gs, ge] = grassRange;
                    for (const sign of [1, -1]) {
                        this.buildSweptTrackBox(chunkGroup, gs, ge,
                            (s) => sign * (innerHalf(s) + outerHalf) / 2,
                            (s) => (outerHalf - innerHalf(s)) / 2,
                            () => -0.50, () => -0.49, this.materials.ground);
                    }
                }
            }
        }

        // Add tunnel lights (the bespoke Plärrer tubes carry their own lamps).
        // The fixtures/tubes/halos are collected into the chunk batches (3 InstancedMeshes)
        // instead of 24 individual meshes per chunk.
        if (chunkType === 'underground') {
            const lightSpacings = [12.5, 37.5];
            lightSpacings.forEach(ls => {
                const s_light = startZ + ls;
                if (s_light > this.sim.totalLength) return;
                if (this.sim.isPlaerrerZone(s_light)) return;
                if ((lineId === 'U2' || lineId === 'U3') && (this.sim.isTrunkZone(s_light) || this.sim.isSwitchZone(s_light))) return;
                this.createTunnelLights(chunkGroup, s_light, addBatchedMatrix);
            });
        }

        // 2. Build running rails. Routed through addBatchedMatrix per SUB-SEGMENT
        // (bright this.materials.rail vs dark tunnelRail, same for thirdRail/
        // sleeper below) instead of one InstancedMesh with a single material
        // resolved once for the whole 50m chunk from its center point — that
        // used to let the bright/dark rail transition land up to ~25m off the
        // real platform edge, the same imprecision just fixed for the ballast
        // bed (kind is already classified per 5m sub-segment; the material now
        // follows that same precision instead of the chunk-level shortcut).
        const isDarkAt = (s) => this.getChunkType(s) === 'underground' && !this.isInsideStationPlatform(s);

        const pushSegmentMatrix = (key, geom, mat, A_world, B_world) => {
            const A = chunkGroup.worldToLocal(A_world.clone());
            const B = chunkGroup.worldToLocal(B_world.clone());
            const pos = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
            const dir = new THREE.Vector3().subVectors(B, A);
            const length = dir.length();
            dir.normalize();

            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(up, dir).normalize();
            const actualUp = new THREE.Vector3().crossVectors(dir, right).normalize();

            const matrix = new THREE.Matrix4();
            matrix.makeBasis(right, actualUp, dir);
            matrix.setPosition(pos);
            matrix.multiply(new THREE.Matrix4().makeScale(1.0, 1.0, length));

            addBatchedMatrix(key, geom, mat, matrix);
        };

        for (let j = 0; j < numSub; j++) {
            const raw_s_start = startZ + j * subLen;
            const raw_s_end = startZ + (j + 1) * subLen;
            const s_mid = (raw_s_start + raw_s_end) / 2;

            if (this.sim.isPlaerrerZone(s_mid)) continue;
            if ((lineId === 'U2' || lineId === 'U3') && (this.sim.isTrunkZone(s_mid) || this.sim.isSwitchZone(s_mid))) continue;
            
            const clamped = this._clampInterval(raw_s_start, raw_s_end, lineId);
            if (!clamped) continue;
            const [s_start, s_end] = clamped;

            const dark = isDarkAt(s_mid);
            const railKey = dark ? 'tunnelRail' : 'rail';
            const railMatChoice = dark ? this.materials.tunnelRail : this.materials.rail;
            const headKey = dark ? 'tunnelRailHead' : 'railHead';
            const headMatChoice = dark ? this.materials.tunnelRailHead : this.materials.railHead;
            const clipKey = dark ? 'tunnelRailClip' : 'railClip';
            const clipMatChoice = dark ? this.materials.tunnelRailClip : this.materials.railClip;
            const thirdKey = dark ? 'tunnelThirdRail' : 'thirdRail';
            const thirdMatChoice = dark ? this.materials.tunnelThirdRail : this.materials.thirdRail;
            // Underground (Innenstrecke) vs open-air (Außenstrecke): both plain tunnel AND
            // underground station platforms run on the ballastless concrete Gleisbett (no
            // ballast, no ties there), unlike `dark` which only governs material brightness.
            const underground = this.getChunkType(s_mid) === 'underground';

            const posStart = this.sim.getTrackPosition(s_start);
            const posEnd = this.sim.getTrackPosition(s_end);
            const spacingStart = this.sim.getTrackSpacing(s_start);
            const spacingEnd = this.sim.getTrackSpacing(s_end);
            const tangentStart = this.sim.getTrackTangent(s_start);
            const tangentEnd = this.sim.getTrackTangent(s_end);

            const normalStart = new THREE.Vector3(-tangentStart.z, 0, tangentStart.x);
            const normalEnd = new THREE.Vector3(-tangentEnd.z, 0, tangentEnd.x);

            const offsetsStart = [
                spacingStart / 2 - 0.7175,
                spacingStart / 2 + 0.7175,
                -spacingStart / 2 - 0.7175,
                -spacingStart / 2 + 0.7175
            ];
            const offsetsEnd = [
                spacingEnd / 2 - 0.7175,
                spacingEnd / 2 + 0.7175,
                -spacingEnd / 2 - 0.7175,
                -spacingEnd / 2 + 0.7175
            ];

            for (let r = 0; r < 4; r++) {
                const A = posStart.clone().addScaledVector(normalStart, offsetsStart[r]);
                A.y = posStart.y - 0.21;
                const B = posEnd.clone().addScaledVector(normalEnd, offsetsEnd[r]);
                B.y = posEnd.y - 0.21;
                pushSegmentMatrix(railKey, this.geometries.rail, railMatChoice, A, B);
                pushSegmentMatrix(headKey, this.geometries.railHead, headMatChoice, A, B);

                // Underground (Innenstrecke) rails sit on a ballastless concrete Gleisbett
                // instead of gravel + cross-ties, fastened with small clip brackets every
                // 20cm (see sleeper placement below, which skips ties underground).
                if (underground) {
                    const clipStep = 0.2;
                    const segLen = A.distanceTo(B);
                    const nClips = Math.max(1, Math.round(segLen / clipStep));
                    const rotYc = Math.atan2(B.x - A.x, B.z - A.z) - chunkGroup.rotation.y;
                    for (let c = 0; c < nClips; c++) {
                        const t = (c + 0.5) / nClips;
                        const cp = A.clone().lerp(B, t);
                        cp.y -= 0.075; // sit right under the rail foot
                        const localCp = chunkGroup.worldToLocal(cp);
                        addBatched(clipKey, this.geometries.railClip, clipMatChoice,
                            localCp.x, localCp.y, localCp.z, rotYc);
                    }
                }
            }

            const powerStart = [
                spacingStart / 2 + 1.1,
                -spacingStart / 2 - 1.1
            ];
            const powerEnd = [
                spacingEnd / 2 + 1.1,
                -spacingEnd / 2 - 1.1
            ];

            for (let p = 0; p < 2; p++) {
                const A_rail = posStart.clone().addScaledVector(normalStart, powerStart[p]);
                A_rail.y = posStart.y - 0.05;
                const B_rail = posEnd.clone().addScaledVector(normalEnd, powerEnd[p]);
                B_rail.y = posEnd.y - 0.05;
                pushSegmentMatrix(thirdKey, this.geometries.thirdRail, thirdMatChoice, A_rail, B_rail);

                const A_cover = posStart.clone().addScaledVector(normalStart, powerStart[p]);
                A_cover.y = posStart.y + 0.03;
                const B_cover = posEnd.clone().addScaledVector(normalEnd, powerEnd[p]);
                B_cover.y = posEnd.y + 0.03;
                pushSegmentMatrix(thirdKey + 'Cover', this.geometries.thirdRailCover, thirdMatChoice, A_cover, B_cover);
            }
        }

        // 3. Build Sleepers (Streben) for both tracks (25 per chunk), same per-position
        // bright/dark precision as the rails above. Only open-air track (Außenstrecke) gets
        // ties on top of the gravel ballast; underground track (Innenstrecke) has none — it
        // runs on the ballastless concrete Gleisbett with small clip fasteners instead (see
        // the per-rail clip loop above).
        const spacingVal = this.chunkSize / this.sleepersPerChunk;

        for (let s = 0; s < this.sleepersPerChunk; s++) {
            const distVal = startZ + s * spacingVal + spacingVal / 2;
            if (this.sim.isPlaerrerZone(distVal)) continue;
            if ((lineId === 'U2' || lineId === 'U3') && (this.sim.isTrunkZone(distVal) || this.sim.isSwitchZone(distVal))) continue;
            if (this.getChunkType(distVal) === 'underground') continue; // no ties underground

            const sleeperKey = 'sleeper';
            const sleeperMatChoice = this.materials.sleeper;

            const pos = this.sim.getTrackPosition(distVal);
            const tangent = this.sim.getTrackTangent(distVal);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(distVal);
            const angle = Math.atan2(tangent.x, tangent.z);

            const pos1 = pos.clone().addScaledVector(normal, spacing / 2);
            pos1.y = pos.y - 0.25;
            const localPos1 = chunkGroup.worldToLocal(pos1);
            const matrix1 = new THREE.Matrix4().makeRotationY(angle - chunkGroup.rotation.y);
            matrix1.setPosition(localPos1);
            addBatchedMatrix(sleeperKey, this.geometries.sleeper, sleeperMatChoice, matrix1);

            const pos2 = pos.clone().addScaledVector(normal, -spacing / 2);
            pos2.y = pos.y - 0.25;
            const localPos2 = chunkGroup.worldToLocal(pos2);
            const matrix2 = new THREE.Matrix4().makeRotationY(angle - chunkGroup.rotation.y);
            matrix2.setPosition(localPos2);
            addBatchedMatrix(sleeperKey, this.geometries.sleeper, sleeperMatChoice, matrix2);
        }

        // 5. Add tunnel portals at the re-anchored portal transition coordinates. Tracks with
        // a generic elevationZones list (U2/U3) are entirely underground -- no portals at all.
        const portals = this.sim.track.elevationZones ? [] : (() => {
            const e = this.sim.track.elevation;
            // Bauernfeindstraße's portal sits at sh2 (near the platform end), not p2
            // (the far end of the ramp descent) -- the tube now starts right where the
            // ramp begins, matching a standard tunnel portal placed close to the station.
            return [e.p1, e.sh2, e.p3, e.p4];
        })();
        portals.forEach(portalZ => {
            // Bauernfeindstraße's sh2 portal is replaced by a roof cutout/covered
            // walkway (see StationModel.js) instead of a standard portal arch.
            if (!this.sim.track.elevationZones && portalZ === this.sim.track.elevation.sh2) return;
            if (portalZ >= startZ && portalZ < endZ) {
                const spacing = this.sim.getTrackSpacing(portalZ);
                const scale = (spacing / 2 + 3.1) / 6.2;
                
                const pos = this.sim.getTrackPosition(portalZ);
                const tangent = this.sim.getTrackTangent(portalZ);
                const rotY = Math.atan2(tangent.x, tangent.z) - chunkGroup.rotation.y;
                const localPos = chunkGroup.worldToLocal(pos.clone());
                
                const portalMesh = new THREE.Mesh(this.geometries.portal, this.materials.portal);
                portalMesh.position.copy(localPos);
                portalMesh.position.y += 0.8;
                portalMesh.rotation.y = rotY;
                portalMesh.scale.set(scale, scale, 1.0);
                chunkGroup.add(portalMesh);
            }
        });

        // 6. Build procedural city environment for open-air chunks
        // if (chunkType !== 'underground') {
        //     this.createCityEnvironment(chunkGroup, 0, chunkType, idx);
        // }

        // 7. Emit the collected batches: one InstancedMesh per (geometry, material) pair
        // (a lone instance becomes a plain Mesh).
        batches.forEach(b => {
            if (b.mats.length === 1) {
                const mesh = new THREE.Mesh(b.geom, b.mat);
                mesh.applyMatrix4(b.mats[0]);
                chunkGroup.add(mesh);
            } else {
                const im = new THREE.InstancedMesh(b.geom, b.mat, b.mats.length);
                for (let i = 0; i < b.mats.length; i++) im.setMatrixAt(i, b.mats[i]);
                im.instanceMatrix.needsUpdate = true;
                chunkGroup.add(im);
            }
        });

        return chunkGroup;
    }

    getChunkType(z) {
        return this.sim.getChunkType(z);
    }

    isInsideStationPlatform(z) {
        for (let i = 0; i < this.sim.stations.length; i++) {
            const s = this.sim.stations[i];
            if (Math.abs(z - s.position) <= s.halfLength + 1) { // platform half-length + a tiny margin
                return true;
            }
        }
        return false;
    }

    createPillars(group, startZ) {
        for (let i = 0; i < 2; i++) {
            const s = startZ + i * 25 + 12.5;
            const pos = this.sim.getTrackPosition(s);
            if (pos.y < 1.5) continue; // Only render pillars if track is elevated enough

            const localPos = group.worldToLocal(pos.clone());
            const pillarHeight = Math.max(1.0, pos.y - 1.5);
            const pillar = new THREE.Mesh(this.geometries.viaductPillar, this.materials.viaduct);
            pillar.scale.set(1, pillarHeight / 20, 1);
            pillar.position.x = localPos.x;
            pillar.position.z = localPos.z;
            pillar.position.y = localPos.y - pillarHeight / 2 - 0.6;
            group.add(pillar);
        }
    }

    createTunnelLights(chunkGroup, s, addBatchedMatrix) {
        const pos = this.sim.getTrackPosition(s);
        const tangent = this.sim.getTrackTangent(s);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

        // Lights are mounted on the top edge of the outer walls
        const ceilY = 3.8; // ceiling height relative to center
        const Y_center = 0.8; // center Y offset

        // Slightly inset from corner to avoid z-fighting or clipping. Per-side widths so
        // the lamps stay ON the wall where a junction cavern widens one side.
        const Y_lamp = Y_center + ceilY - 0.06;

        const posL = pos.clone().addScaledVector(normal, this.getTunnelSideWidth(s, 1) - 0.08);
        const posR = pos.clone().addScaledVector(normal, -(this.getTunnelSideWidth(s, -1) - 0.08));

        const localL = chunkGroup.worldToLocal(posL);
        const localR = chunkGroup.worldToLocal(posR);
        const angle = Math.atan2(tangent.x, tangent.z) - chunkGroup.rotation.y;

        const one = new THREE.Vector3(1, 1, 1);
        const addLamp = (local, isLeft) => {
            // Fixture tilted 45 degrees to face the track from the corner
            // isLeft=true is at -X, needs to tilt +PI/4 to face center (+X)
            const tilt = (isLeft ? 1 : -1) * Math.PI / 4;
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, tilt));
            const fm = new THREE.Matrix4().compose(new THREE.Vector3(local.x, local.y + Y_lamp, local.z), q, one);

            addBatchedMatrix('tunnelFixture', this.geometries.tunnelFixture, this.materials.tunnelFixtureMat, fm);

            const gm = fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.041, 0));
            addBatchedMatrix('tunnelGlow', this.geometries.tunnelGlow, this.materials.tunnelGlow, gm);

            // "Knick" Effect: two halos, one for ceiling and one for wall

            // 1. Ceiling Halo (Horizontal)
            const chm = new THREE.Matrix4().compose(
                new THREE.Vector3(local.x, local.y + Y_lamp + 0.05, local.z),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, isLeft ? angle : angle + Math.PI, 0)),
                one
            );
            // Shift inward (toward track center)
            chm.multiply(new THREE.Matrix4().makeTranslation(1.6, 0, 0));
            addBatchedMatrix('tunnelHalo', this.geometries.tunnelHalo, this.materials.neonHaloMat, chm);

            // 2. Wall Halo (Vertical)
            const whm = new THREE.Matrix4().compose(
                new THREE.Vector3(local.x, local.y + Y_lamp, local.z),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, isLeft ? angle : angle + Math.PI, -Math.PI / 2)),
                one
            );
            // In the rotated basis:
            // X=Down, Y=Inward. Translate (1.6, 0.05) -> Down 1.6m, Inward 0.05m
            whm.multiply(new THREE.Matrix4().makeTranslation(1.6, 0.05, 0));
            addBatchedMatrix('tunnelHalo', this.geometries.tunnelHalo, this.materials.neonHaloMat, whm);
        };

        addLamp(localL, true);  // Left Wall/Ceiling Corner
        addLamp(localR, false); // Right Wall/Ceiling Corner
    }

    createCityEnvironment(group, spacingCenter, chunkType, idx) {
        const groundY = -0.35;
        const chunkGroupY = group.position.y;

        // Pseudo-random seed function
        function seedRandom(s) {
            const x = Math.sin(s) * 10000;
            return x - Math.floor(x);
        }

        const buildingColors = [
            new THREE.Color('#3a3d45'), // concrete grey
            new THREE.Color('#4e525a'), // medium grey
            new THREE.Color('#5d626d'), // slate grey
            new THREE.Color('#6c727d'), // light slate grey
            new THREE.Color('#2d2f34'), // dark grey
            new THREE.Color('#464950'), // granite grey
            new THREE.Color('#383a40'), // charcoal grey
            new THREE.Color('#565961')  // cool grey
        ];

        // 1. Create Instanced Buildings (12 skyscrapers per chunk)
        const buildingIM = new THREE.InstancedMesh(this.geometries.building, this.materials.building, 12);
        
        for (let b = 0; b < 12; b++) {
            const seed = idx * 17 + b * 31;
            const rand1 = seedRandom(seed);
            const rand2 = seedRandom(seed + 1);
            const rand3 = seedRandom(seed + 2);

            const H = 12 + rand1 * 12; // 12 to 24m tall
            const W = 25 + rand2 * 25; // 25 to 50m wide
            const D = 10 + rand3 * 6;  // 10 to 16m deep

            const isLeft = (b < 6);
            const X = isLeft ? (-50 - rand2 * 60 - W/2) : (50 + rand2 * 60 + W/2);
            const Z = -25 + rand3 * 50;

            const matrix = new THREE.Matrix4();
            matrix.makeScale(W, H, D);
            matrix.setPosition(X, (groundY + H/2) - chunkGroupY, Z); // keep world Y flat
            buildingIM.setMatrixAt(b, matrix);

            const colIdx = Math.floor(rand1 * buildingColors.length);
            buildingIM.setColorAt(b, buildingColors[colIdx]);
        }
        buildingIM.instanceMatrix.needsUpdate = true;
        if (buildingIM.instanceColor) buildingIM.instanceColor.needsUpdate = true;

        // Create window dummy (size 1, count 0) to avoid any issues
        const windowIM = new THREE.InstancedMesh(this.geometries.window, this.materials.window, 1);
        windowIM.count = 0;

        group.add(buildingIM, windowIM);

        // Clouds are no longer separate per-chunk meshes: they are baked into the
        // equirectangular sky photo used as scene.background (see WorldManager.init).
    }


    createStreetTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#222222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < 1500; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            ctx.fillStyle = Math.random() > 0.5 ? '#1a1a1a' : '#2a2a2a';
            ctx.fillRect(x, y, 1, 1);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(4, 0, 3, canvas.height);
        ctx.fillRect(canvas.width - 7, 0, 3, canvas.height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 4);
        return tagCanvasTextureSRGBKeepLook(texture);
    }

    createBallastTexture() {
        // Coarse gravel (grober Schotter) for the outer rail ballast beds.
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#413f40';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < 900; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const size = 2 + Math.random() * 4; // larger, coarser stones than fine ballast noise
            const colorVal = Math.random();
            if (colorVal < 0.45) ctx.fillStyle = '#1a1819';
            else if (colorVal < 0.85) ctx.fillStyle = '#807f7d';
            else ctx.fillStyle = '#413f40';
            ctx.fillRect(x, y, size, size);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // 1:1 repeat because we now scale UVs in the geometry itself to match world meters
        texture.repeat.set(1, 1);
        return tagCanvasTextureSRGBKeepLook(texture);
    }

    createConcreteBedTexture() {
        // Smooth concrete Gleisbett strip for the inner rails (between the two tracks).
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3d372a';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 14; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 30 + Math.random() * 60;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            const c = Math.random() > 0.5 ? '55,56,51' : '70,71,65';
            grad.addColorStop(0, `rgba(${c},0.35)`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);
        }
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 6000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const v = Math.random();
            ctx.fillStyle = v < 0.34 ? '#373833' : (v < 0.68 ? '#464741' : '#3d372a');
            ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
        }
        ctx.globalAlpha = 1.0;
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        // buildSweptTrackBox maps 1 UV unit per world metre; repeat 0.25 gives the
        // bed the same 4m concrete tile size as the tunnel walls (whose UVs are
        // divided by 4 at generation time), so bed and tube read as one material
        // now that the tube runs flush up to the station portals.
        tex.repeat.set(0.25, 0.25);
        return tagCanvasTextureSRGBKeepLook(tex);
    }

    createRailBodyGeometry() {
        // Vignole rail profile (foot -> web -> flared head) in the XY cross-section plane,
        // extruded along Z (the rail's length axis, matching the old BoxGeometry's Z=length
        // convention so every placement matrix keeps working unchanged). The flat top of the
        // head is left open here and capped separately by createRailHeadGeometry() so the top
        // running surface can carry its own glossy material.
        const shape = new THREE.Shape();
        const pts = [
            [-0.07, -0.075], [0.07, -0.075],  // foot (wide base)
            [0.02, -0.045],                    // taper up to the web (right)
            [0.02, 0.025],                      // web (right)
            [0.045, 0.045],                     // flare out to the head (right)
            [-0.045, 0.045],                    // flat head top (closed by the head cap above)
            [-0.02, 0.025],                      // flare in from the head (left)
            [-0.02, -0.045],                      // web (left)
        ];
        shape.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
        shape.lineTo(pts[0][0], pts[0][1]);
        const geom = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 });
        geom.translate(0, 0, -0.5); // center along Z like the old unit-length BoxGeometry
        return geom;
    }

    createRailHeadGeometry() {
        // Flat glossy rail-head cap, sitting directly on the body's flat top (y=0.045..0.075).
        const geom = new THREE.BoxGeometry(0.09, 0.03, 1.0);
        geom.translate(0, 0.06, 0);
        return geom;
    }

    createTunnelConcreteTexture() {
        // Improved smooth concrete texture: medium-dark grey with subtle procedural patches
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Base grey
        ctx.fillStyle = '#333333';
        ctx.fillRect(0, 0, size, size);

        // Subtle large-scale patches (cloud-like)
        for (let i = 0; i < 12; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 40 + Math.random() * 80;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            const v = Math.floor(Math.random() * 15) - 7; // -7 to +7 offset
            grad.addColorStop(0, `rgba(${51+v},${51+v},${51+v}, 0.4)`);
            grad.addColorStop(1, 'rgba(51,51,51,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);
        }

        // Fine grainy noise
        for (let i = 0; i < 20000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const v = Math.floor(Math.random() * 10) - 5;
            const c = 51 + v;
            ctx.fillStyle = `rgb(${c},${c},${c})`;
            ctx.fillRect(x, y, 1, 1);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        // 1:1 repeat; UVs are scaled in world-meters during geometry generation
        tex.repeat.set(1, 1);
        return tagCanvasTextureSRGBKeepLook(tex);
    }

    createEdgeNeonHaloTexture() {
        // Linear neon tube glow starting exactly at the left edge (x=0).
        const width = 64;
        const height = 128;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;

        // Peak/tube position: at the very left edge (x=0)
        const X_peak = 0;

        // Capsule parameters: line segment from y = 36 to y = 92
        const Y1 = 36;
        const Y2 = 92;
        const max_d = 64; // fall off over the whole width

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let dy = 0;
                if (y < Y1) dy = Y1 - y;
                else if (y > Y2) dy = y - Y2;

                const dx = x - X_peak;
                const d = Math.sqrt(dx * dx + dy * dy);
                let alpha = Math.max(0, 1 - d / max_d);
                alpha = alpha * alpha; // Quadratic falloff for smoother appearance

                const idx = (y * width + x) * 4;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = Math.round(alpha * 255);
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        return tagCanvasTextureSRGBKeepLook(tex);
    }

    createNeonHaloTexture() {
        // Linear neon tube glow using capsule-shaped falloff.
        // The canvas is 64 pixels wide and 128 pixels tall.
        // We define a line segment at x = X_peak (corresponding to the neon tube position)
        // and calculate the distance to this segment for each pixel, using scaled/stretched
        // horizontal coordinates on the left and right sides of the peak to achieve a
        // seamless fade-out to 0 at the boundaries of the canvas.
        const width = 64;
        const height = 128;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;

        // Peak/tube position: 12.5 pixels from left edge (corresponding to -1.6m from center of 5.25m plane)
        const X_peak = 12.5;

        // Capsule parameters: line segment from y = 36 to y = 92
        const Y1 = 36;
        const Y2 = 92;
        const max_d = 32;

        // Scaled horizontal distances to make the falloff reach exactly 0 at x = 0 and x = 64
        const scale_left = max_d / X_peak;
        const scale_right = max_d / (width - X_peak);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Calculate scaled dx
                const raw_dx = x - X_peak;
                const dx = raw_dx < 0 ? raw_dx * scale_left : raw_dx * scale_right;

                // Calculate dy to the segment [Y1, Y2]
                let dy = 0;
                if (y < Y1) {
                    dy = y - Y1;
                } else if (y > Y2) {
                    dy = y - Y2;
                }

                const d = Math.sqrt(dx * dx + dy * dy);
                const t = d / max_d;

                let a = 0;
                if (t < 1.0) {
                    if (t <= 0) {
                        a = 0.65;
                    } else if (t < 0.3) {
                        const k = t / 0.3;
                        a = 0.65 + (0.28 - 0.65) * k;
                    } else if (t < 0.65) {
                        const k = (t - 0.3) / (0.65 - 0.3);
                        a = 0.28 + (0.07 - 0.28) * k;
                    } else {
                        const k = (t - 0.65) / (1.0 - 0.65);
                        a = 0.07 * (1.0 - k);
                    }
                }

                const idx = (y * width + x) * 4;
                data[idx] = 255;     // Red
                data[idx + 1] = 255; // Green
                data[idx + 2] = 255; // Blue
                data[idx + 3] = Math.round(a * 255);
            }
        }

        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }

    createGrassTexture() {
        const W = 128, H = 128;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        // Base mid-green
        ctx.fillStyle = '#4a7c3f';
        ctx.fillRect(0, 0, W, H);

        // Subtle vertical streaks simulating grass blades / light variation
        const streakColors = ['#3d6b34', '#557a47', '#4a7c3f', '#3a6030', '#5a8a4e', '#426e38'];
        for (let i = 0; i < 80; i++) {
            const x = Math.floor(Math.random() * W);
            const w = 1 + Math.floor(Math.random() * 3);
            const h = 4 + Math.floor(Math.random() * 12);
            const y = Math.floor(Math.random() * H);
            ctx.fillStyle = streakColors[Math.floor(Math.random() * streakColors.length)];
            ctx.globalAlpha = 0.35 + Math.random() * 0.45;
            ctx.fillRect(x, y, w, h);
        }
        ctx.globalAlpha = 1.0;

        // Fine random noise dots for micro-detail
        for (let i = 0; i < 1200; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H;
            ctx.fillStyle = Math.random() > 0.5 ? '#3a5c30' : '#5e9050';
            ctx.globalAlpha = 0.18;
            ctx.fillRect(x, y, 1, 1);
        }
        ctx.globalAlpha = 1.0;

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createFenceTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        // Light grey metal color
        ctx.fillStyle = '#c8c8c8';
        
        // Horizontal rails: top, bottom, and two intermediate rails
        const railThick = 5;
        ctx.fillRect(0, 0, size, railThick);
        ctx.fillRect(0, size - railThick, size, railThick);
        ctx.fillRect(0, Math.floor(size / 3) - 2, size, 4);
        ctx.fillRect(0, Math.floor(size * 2 / 3) - 2, size, 4);

        // Vertical bars: reduced from 8 to 4 for wider spacing
        const numBars = 4;
        const step = size / numBars;
        for (let i = 0; i <= numBars; i++) {
            ctx.fillRect(i * step - 2, 0, 4, size);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createRoughConcreteMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Base color: light grey concrete (somewhat brighter)
        ctx.fillStyle = '#b0b0b0';
        ctx.fillRect(0, 0, 256, 256);

        // Add subtle organic patches for concrete texture
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const radius = 20 + Math.random() * 40;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
            const isDark = Math.random() > 0.5;
            const alpha = 0.05 + Math.random() * 0.08;
            grad.addColorStop(0, isDark ? `rgba(100,100,100,${alpha})` : `rgba(235,235,235,${alpha})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // High-frequency fine concrete grain noise
        const numGrains = 4000;
        for (let i = 0; i < numGrains; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1.0 + Math.random() * 1.5;

            const rand = Math.random();
            if (rand < 0.4) {
                ctx.fillStyle = '#8e8e8e'; // dark speckles
            } else if (rand < 0.8) {
                ctx.fillStyle = '#d2d2d2'; // light speckles
            } else {
                ctx.fillStyle = '#a0a0a0'; // mid speckles
            }

            ctx.globalAlpha = 0.12;
            ctx.fillRect(x, y, size, size);
        }
        ctx.globalAlpha = 1.0;

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;

        // Generate bump map canvas for rough surface
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 256;
        bumpCanvas.height = 256;
        const bCtx = bumpCanvas.getContext('2d');

        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, 256, 256);

        bCtx.globalAlpha = 0.25;
        for (let i = 0; i < 3000; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1 + Math.random() * 2;
            bCtx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
            bCtx.fillRect(x, y, size, size);
        }
        bCtx.globalAlpha = 1.0;

        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        bumpTexture.repeat.set(1, 1);

        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.008,
            side: THREE.DoubleSide
        });
    }

    buildSweptFence(chunkGroup, sStart, sEnd, centerOffFn, yBotFn, yTopFn, material, resStep = 2) {
        const length = sEnd - sStart;
        if (length <= 0) return null;
        const nSeg = Math.max(1, Math.ceil(length / resStep));
        const rings = [];
        let cum = 0;
        const wp = new THREE.Vector3(), tan = new THREE.Vector3(), prevWp = new THREE.Vector3();
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            this.sim.getTrackPosition(s, wp);
            this.sim.getTrackTangent(s, tan);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = centerOffFn ? centerOffFn(s) : 0;
            const yTop = yTopFn(s), yBot = yBotFn(s);
            if (r > 0) cum += wp.distanceTo(prevWp);
            prevWp.copy(wp);
            
            const botPt = chunkGroup.worldToLocal(new THREE.Vector3(wp.x + nX * off, yBot, wp.z + nZ * off));
            const topPt = chunkGroup.worldToLocal(new THREE.Vector3(wp.x + nX * off, yTop, wp.z + nZ * off));
            rings.push({ bot: botPt, top: topPt, cum, isPlatform: this.isInsideStationPlatform(s) });
        }
        const pos = [], uv = [];
        const tri = (a, b, c, ua, ub, uc) => {
            pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
        };
        const quad = (p0, p1, p2, p3, u0, u1, u2, u3) => {
            tri(p0, p1, p2, u0, u1, u2);
            tri(p0, p2, p3, u0, u2, u3);
        };
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1];
            if (A.isPlatform || B.isPlatform) continue; // Skip rendering fence if it's on a station platform
            const uA = A.cum / 1.25;
            const uB = B.cum / 1.25;
            quad(A.bot, B.bot, B.top, A.top, [uA, 0], [uB, 0], [uB, 1], [uA, 1]);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(geom, material);
        chunkGroup.add(mesh);
        return mesh;
    }

    placeFencePosts(addBatched, sStart, sEnd, offsetFn, yBotFn, height, chunkGroup) {
        const step = 2.5;
        const count = Math.max(1, Math.floor((sEnd - sStart) / step));
        const wp = new THREE.Vector3(), tan = new THREE.Vector3();
        for (let i = 0; i <= count; i++) {
            const s = sStart + (sEnd - sStart) * i / count;
            if (this.isInsideStationPlatform(s)) continue; // Skip rendering post if it's on a station platform
            this.sim.getTrackPosition(s, wp);
            this.sim.getTrackTangent(s, tan);
            
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen;
            const nZ = tan.x / nlen;
            
            const off = offsetFn(s);
            const yBot = typeof yBotFn === 'function' ? yBotFn(s) : yBotFn;
            
            const worldPos = new THREE.Vector3(wp.x + nX * off, yBot + height / 2, wp.z + nZ * off);
            const localPos = chunkGroup.worldToLocal(worldPos.clone());
            const rotY = Math.atan2(tan.x, tan.z) - chunkGroup.rotation.y;
            
            addBatched('fencePost', this.geometries.fencePost, this.materials.fencePostMat,
                localPos.x, localPos.y, localPos.z, rotY, 1, height, 1);
        }
    }

}
