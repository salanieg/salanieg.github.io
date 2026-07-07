import * as THREE from 'three';
import { StationBuilder } from './stations/StationBuilder.js?v=67';

export class TrackManager {
    constructor(scene, simulation) {
        this.scene = scene;
        this.sim = simulation;
        
        // Chunk configuration
        this.chunkSize = 50; // meters per track segment
        this.visibleChunksCount = 40; // load +/- 40 chunks (4km total window)
        this.tunnelChunksCount = 4; // reduced window when fully underground (darkness hides the distance)
        this.chunkCache = new Map(); // chunkIndex -> THREE.Group, built once and kept forever
        this.activeChunks = new Map(); // chunkIndex -> THREE.Group currently in the scene
        
        const ballastTex = this.createBallastTexture();
        this.materials = {
            rail: new THREE.MeshLambertMaterial({ color: '#8b4513' }),
            sleeper: new THREE.MeshLambertMaterial({ color: '#cccccc' }), // light grey concrete sleepers
            // side: DoubleSide on ballast/tunnelBallast/viaduct because they are swept into
            // continuous curved beds/fences (buildSweptTrackBox) that bend both left and
            // right along the route; DoubleSide sidesteps any winding-order ambiguity from
            // the curl direction instead of needing to special-case it (these 3 materials
            // are used exclusively for that swept geometry, so this is safe to set globally).
            ballast: new THREE.MeshLambertMaterial({
                map: ballastTex,
                side: THREE.DoubleSide
            }),
            thirdRail: new THREE.MeshLambertMaterial({ color: '#cccccc' }), // light grey matte metal power rail
            tunnelWall: new THREE.MeshLambertMaterial({ map: this.createTunnelConcreteTexture(), color: 0xffffff, side: THREE.DoubleSide }),
            tunnelBallast: new THREE.MeshLambertMaterial({ map: ballastTex, color: '#888888', side: THREE.DoubleSide }),
            tunnelRail: new THREE.MeshLambertMaterial({ color: '#5d2e0d' }),
            tunnelSleeper: new THREE.MeshLambertMaterial({ color: '#777777' }),
            tunnelThirdRail: new THREE.MeshLambertMaterial({ color: '#bbbbbb' }),
            viaduct: new THREE.MeshLambertMaterial({ color: '#4a4a4a', side: THREE.DoubleSide }),
            wall: new THREE.MeshLambertMaterial({ color: '#333333' }),
            portal: new THREE.MeshLambertMaterial({ color: '#2c3e50' }),
            fence: new THREE.MeshLambertMaterial({
                map: this.createFenceTexture(),
                transparent: true,
                alphaTest: 0.5,
                side: THREE.DoubleSide
            }),
            concrete: this.createRoughConcreteMaterial(),
            // Neon lights materials
            tunnelGlow: new THREE.MeshBasicMaterial({ color: '#e0f2fe' }), // cyan-white neon glow
            tunnelFixtureMat: new THREE.MeshLambertMaterial({ color: '#1e293b' }), // dark Slate casing
            neonHaloMat: new THREE.MeshBasicMaterial({
                map: this.createNeonHaloTexture(),
                blending: THREE.NormalBlending,
                transparent: true,
                depthWrite: false,
                color: 0xc8eeff,
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
            ground: new THREE.MeshLambertMaterial({
                color: '#4a9c70', // solid mint green
                side: THREE.DoubleSide
            }),
            bgGround: new THREE.MeshLambertMaterial({
                color: '#4a9c70' // unified color to prevent brightness seams
            })
        };
        
        // PRE-CREATE ALL GEOMETRIES AT STARTUP
        // This avoids memory allocations, Garbage Collection, and GPU buffer re-uploads during the game loop.
        this.geometries = {
            rail: new THREE.BoxGeometry(0.1, 0.15, 1.0), // unit length for dynamic scaling
            sleeper: new THREE.BoxGeometry(2.4, 0.12, 0.3),
            thirdRail: new THREE.BoxGeometry(0.12, 0.15, 1.0), // unit length
            thirdRailCover: new THREE.BoxGeometry(0.24, 0.08, 1.0), // unit length
            fencePost: new THREE.BoxGeometry(0.04, 1.0, 0.04),
            
            // Tunnel Elements (Double track width, 5m sub-segments)
            tunnelWall: new THREE.CylinderGeometry(6.2, 6.2, 5.0, 8, 1, true),
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

            // Ground (clouds are now part of WorldManager's sky-photo background)
            ground: new THREE.PlaneGeometry(120, 10.0), // Overlapped to prevent curve seams (10m instead of 5m)
            bgGround: new THREE.PlaneGeometry(450, 25.0) // Overlapped to prevent curve seams (25m instead of 5m)
        };

        // Align geometries
        this.geometries.tunnelWall.rotateX(Math.PI / 2);

        this.geometries.street.rotateX(-Math.PI / 2);
        this.geometries.ground.rotateX(-Math.PI / 2);
        this.geometries.bgGround.rotateX(-Math.PI / 2);

        // Pre-create the portal extrude geometry
        this.geometries.portal = this.createPortalGeometry();
 
        
        // Pre-create a shared sleeper InstancedMesh template matrix
        this.sleepersPerChunk = 25; // 25 sleepers per chunk for perfect curves
        this._sleeperMatrix = new THREE.Matrix4();

        // Decorative side tracks (sidings / depot leads) were removed for performance:
        // they were never drivable and their InstancedMeshes (frustumCulled = false)
        // were rendered from everywhere on the line.

        // Plärrer: the bespoke stacked station (lower Langwasser platform + upper Hardhöhe
        // hall + diverging tubes) is built from main.js AFTER the StationModel exists, so it
        // can reuse the station floor/stair textures. See buildPlaerrer(stationModel).

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
        const bedM = [], sleeperM = [], railM = [], powerM = [], coverM = [];
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
                const rL = segMatrix(A, B, -GAUGE, -0.21); if (rL) railM.push(rL);
                const rR = segMatrix(A, B, GAUGE, -0.21); if (rR) railM.push(rR);
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
        const createLowerWallTexture = () => {
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
                ctx.moveTo(cx - 150, 0);
                ctx.lineTo(cx - 50, 0);
                ctx.lineTo(cx + 100, h / 2);
                ctx.lineTo(cx - 50, h);
                ctx.lineTo(cx - 150, h);
                ctx.lineTo(cx, h / 2);
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
            return tex;
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
            return tex;
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
            const escWidth = 1.1;
            const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
            const stairInst = new THREE.InstancedMesh(stairGeom, stepMat, numSteps);
            const escInst = new THREE.InstancedMesh(escStepGeom, escStepMat, 2 * numSteps);
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

            // 3. Double Escalators (ramps under the steps, escalator textures)
            const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);

            const escL = new THREE.Mesh(escRampGeom, escStepMat);
            escL.position.set(-escOffset, -0.15, 0); escL.rotation.x = rotX;

            const escR = new THREE.Mesh(escRampGeom, escStepMat);
            escR.position.set(escOffset, -0.15, 0); escR.rotation.x = rotX;
            escGroup.add(escL, escR);

            // 4. Escalator Glass Balustrades
            const glassGeom = new THREE.BoxGeometry(0.05, 0.9, rampLength);
            const outerBal = wallOffset - 0.2;
            const innerBal = stairWidth / 2;

            const glassL1 = new THREE.Mesh(glassGeom, glassMat);
            glassL1.position.set(-outerBal, 0.45, 0); glassL1.rotation.x = rotX;
            
            const glassL2 = new THREE.Mesh(glassGeom, glassMat);
            glassL2.position.set(-innerBal, 0.45, 0); glassL2.rotation.x = rotX;
            
            const glassR1 = new THREE.Mesh(glassGeom, glassMat);
            glassR1.position.set(innerBal, 0.45, 0); glassR1.rotation.x = rotX;
            
            const glassR2 = new THREE.Mesh(glassGeom, glassMat);
            glassR2.position.set(outerBal, 0.45, 0); glassR2.rotation.x = rotX;
            escGroup.add(glassL1, glassL2, glassR1, glassR2);

            // 5. Escalator Handrails
            const railGeom = new THREE.BoxGeometry(0.1, 0.1, rampLength);
            
            const railL1 = new THREE.Mesh(railGeom, handrailMat);
            railL1.position.set(-outerBal, 0.9, 0); railL1.rotation.x = rotX;
            
            const railL2 = new THREE.Mesh(railGeom, handrailMat);
            railL2.position.set(-innerBal, 0.9, 0); railL2.rotation.x = rotX;
            
            const railR1 = new THREE.Mesh(railGeom, handrailMat);
            railR1.position.set(innerBal, 0.9, 0); railR1.rotation.x = rotX;
            
            const railR2 = new THREE.Mesh(railGeom, handrailMat);
            railR2.position.set(outerBal, 0.9, 0); railR2.rotation.x = rotX;
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

        const lowerWallMat = new THREE.MeshLambertMaterial({ map: createLowerWallTexture(), side: THREE.DoubleSide });
        lowerWallMat.userData = { keepWrapAndRepeat: true };
        // Near-side variant with horizontally mirrored U: the near wall is seen from the
        // opposite side of its face, so the shared texture would read mirror-inverted there
        // (the "PLÄRRER gespiegelt" bug). Negative repeat.x + RepeatWrapping flips it back.
        const lowerWallMatMirror = lowerWallMat.clone();
        lowerWallMatMirror.map = lowerWallMat.map.clone();
        lowerWallMatMirror.map.repeat.x = -1;
        lowerWallMatMirror.userData = { keepWrapAndRepeat: true };
        const lowerCeilMat = ceilConcreteMat;

        const plainCreamTileMat = new THREE.MeshLambertMaterial({ map: createPlainCreamTileTexture(), side: THREE.DoubleSide });
        // Used on ShapeGeometry end walls whose UVs are in METERS: one texture (≈21 tile
        // rows) every ~2.4m gives ~11cm tiles, matching the side walls. The old repeat of
        // 12/m tiled the texture 12x PER METER — pure sub-pixel noise.
        plainCreamTileMat.map.repeat.set(0.42, 0.42);
        const endWallLowerMat = plainCreamTileMat;

        // Side walls once over the full platform length (they are identical in every zone;
        // splitting them per zone only multiplied meshes and GPU texture clones).
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, lowerWallLeftProfile, lBaseY, () => 0, lowerWallMat, 6);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, lowerWallRightProfile, lBaseY, () => 0, lowerWallMatMirror, 6);

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

        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperTileLeftProfile, uBaseY, () => 0, lowerWallMat, 6);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperTileRightProfile, uBaseY, () => 0, lowerWallMatMirror, 6);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperConcLeftProfile, uBaseY, () => 0, hallVaultMat, 10);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperConcRightProfile, uBaseY, () => 0, hallVaultMat, 10);
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, upperCeilProfile, uBaseY, () => 0, hallVaultMat, 10);

        // Helper to query vault/ceiling height at any X coordinate (always flat 12m now)
        const getVaultHeight = (x) => hallHeight;

        const endWallUpperMat = new THREE.MeshLambertMaterial({ color: '#b8c0c8', side: THREE.DoubleSide });

        // ---------- COLUMNS (Segmented silver pillars on both levels) ----------
        // All columns share ONE unit cylinder (scaled per instance) and all joint rings share
        // one geometry: 2 InstancedMeshes instead of ~110 individual meshes.
        const colMat = new THREE.MeshLambertMaterial({ color: '#b4bac2' }); // Brushed steel silver
        const colRingGeom = new THREE.CylinderGeometry(0.51, 0.51, 0.04, 16);
        const colRingMat = new THREE.MeshLambertMaterial({ color: '#2d3035' }); // Dark steel joints
        const colUnitGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
        const colM = [], colRingM = [];
        const colPos = (x, y, z, yScale) => {
            const m = new THREE.Matrix4().makeTranslation(x, y, z);
            if (yScale) m.multiply(new THREE.Matrix4().makeScale(1, yScale, 1));
            return m;
        };

        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const lFloorY = f.c.y + dive(d) + platTopY;

            for (const cx of [-4.5, -13.5]) {
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

        // 1. Upper Level Skylights (Recessed flat rings on the flat ceiling, rotated to face track direction)
        const skyRingM = [], skyDiskM = [];
        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const skylightY = f.c.y + platTopY + hallHeight;
            const sc = f.c.clone().addScaledVector(f.nrm, -9.0);

            // Recessed flat rings with a diameter close to the column distance (approx 8m diameter / 4m radius)
            skyRingM.push(flatAt(sc.x, skylightY - 0.01, sc.z, f.rotY));
            skyDiskM.push(flatAt(sc.x, skylightY - 0.02, sc.z, f.rotY));
        }
        addI(new THREE.RingGeometry(3.8, 4.0, 64), recessMat, skyRingM);
        addI(new THREE.CircleGeometry(3.8, 64), skyMat, skyDiskM);

        // 2. Lower Level lights (Recessed flat rings matching the upper skylight locations on the flat ceiling)
        const lightX = -9.0;
        const lRingM = [], lDiskM = [];
        for (let d = P - platHalf; d < P + platHalf - 0.1; d += segLen) {
            const dm = d + segLen / 2;
            if (Math.abs(dm - P) < ESC_HALF) continue; // Skip escalator shaft

            if (Math.round((dm - P) / segLen) % 2 === 0) {
                const f = frameAt(dm);
                const lc = f.c.clone().addScaledVector(f.nrm, lightX);
                const lCeilY = f.c.y + dive(dm) + lowerH;
                lRingM.push(flatAt(lc.x, lCeilY - 0.02, lc.z));
                lDiskM.push(flatAt(lc.x, lCeilY - 0.03, lc.z));
            }
        }
        addI(new THREE.RingGeometry(0.45, 0.62, 18), recessMat, lRingM);
        addI(new THREE.CircleGeometry(0.45, 18), skyMat, lDiskM);

        // ---------- PLATFORM ACCESSORIES & FURNISHING ----------
        const trashBodyGeom = new THREE.BoxGeometry(0.25, 0.45, 0.25);
        const trashLidGeom = new THREE.BoxGeometry(0.26, 0.04, 0.26);
        const trashOrangeMat = new THREE.MeshLambertMaterial({ color: '#f97316' }); // Nuremberg Orange

        // 1. Column-Mounted Trash Cans (2 InstancedMeshes: bodies + lids)
        const trashBodyM = [], trashLidM = [];
        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const lFloorY = f.c.y + dive(d) + platTopY;

            for (const cx of [-4.5, -13.5]) {
                const cp = f.c.clone().addScaledVector(f.nrm, cx);
                const facingSign = (cx === -4.5) ? 1 : -1; // Face outward from column center
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
        // portal at each platform end makes the tube join the station hall flush ("bündig").
        const tubeMat = this.materials.tunnelWall;
        const TUBE_R = 3.4;
        if (!this._plTubeGeom) this._plTubeGeom = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).rotateX(Math.PI / 2);
        if (!this._plGlowGeom) this._plGlowGeom = new THREE.BoxGeometry(0.55, 0.07, 1);
        // Tube segments + their crown lamp strips only collect matrices here; they become
        // TWO InstancedMeshes after the loop (instead of ~300 individual meshes).
        const tubeM = [], tubeGlowM = [];
        const renderTube = (latFn, yFn, d0, d1) => {
            const ds = 10, R = TUBE_R;
            // The last ring must land EXACTLY on d1: with a plain `d += ds` loop the tube
            // stopped up to ds short of the end wall / zone boundary whenever (d1-d0) is not
            // a multiple of ds — the "tube doesn't reach the cutout" gap.
            const nSeg = Math.max(1, Math.ceil((d1 - d0) / ds));
            let prev = null;
            for (let i = 0; i <= nSeg; i++) {
                const d = i === nSeg ? d1 : d0 + i * ds;
                const c = sim.getTrackPosition(d);
                const tan = sim.getTrackTangent(d);
                const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
                const cur = c.clone().addScaledVector(nrm, latFn(d));
                cur.y = c.y + yFn(d) + 0.8;
                if (prev) {
                    const dir = new THREE.Vector3().subVectors(cur, prev);
                    const len = dir.length();
                    if (len > 0.01) {
                        dir.normalize();
                        const right = new THREE.Vector3().crossVectors(up, dir).normalize();
                        const aUp = new THREE.Vector3().crossVectors(dir, right).normalize();
                        const mid = new THREE.Vector3().addVectors(prev, cur).multiplyScalar(0.5);
                        const m = new THREE.Matrix4().makeBasis(right, aUp, dir);
                        m.setPosition(mid);
                        m.multiply(new THREE.Matrix4().makeScale(R, R, len));
                        tubeM.push(m);

                        // Lamp strip running along the crown of the tube.
                        const gm = new THREE.Matrix4().makeBasis(right, aUp, dir);
                        gm.setPosition(mid.clone().addScaledVector(aUp, R * 0.82));
                        gm.multiply(new THREE.Matrix4().makeScale(1, 1, len));
                        tubeGlowM.push(gm);
                    }
                }
                prev = cur;
            }
        };

        const buildEndWall = (d, lat, yc, mat, uLeft, uRight, vBot, vTop, noHole) => {
            const shape = new THREE.Shape();
            shape.moveTo(uLeft, vBot);
            shape.lineTo(uRight, vBot);
            shape.lineTo(uRight, vTop);
            shape.lineTo(uLeft, vTop);
            shape.lineTo(uLeft, vBot);
            if (!noHole) {
                const hole = new THREE.Path();
                hole.absarc(0, 0, TUBE_R + 0.05, 0, Math.PI * 2, true);
                shape.holes.push(hole);
            }
            const f = frameAt(d);
            const pp = f.c.clone().addScaledVector(f.nrm, lat);
            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
            mesh.position.set(pp.x, yc, pp.z);
            // rotY alone maps the shape's local +X to -nrm, i.e. the u-coordinates (designed
            // in +nrm lateral coords like every other lateral offset here) would come out
            // MIRRORED about the track axis: the asymmetric panels then overshoot one side
            // wall and leave the middle of the end wall wide open. The extra half turn flips
            // local +X onto +nrm (the tube hole is centred at u=0, so it stays aligned; the
            // materials are DoubleSide, so the flipped facing is irrelevant).
            mesh.rotation.y = f.rotY + Math.PI;
            group.add(mesh);
        };

        for (const sign of [-1, 1]) {
            const inner = P + sign * platHalf;     // platform end (joins the station)
            const outer = P + sign * zoneHalf;     // zone boundary (joins the generic tunnel)
            const r0 = Math.min(inner, outer), r1 = Math.max(inner, outer);
            
            // Running tracks tubes
            renderTube(d => sp(d) / 2, () => 0, r0, r1);     // upper running (Hardhöhe)
            renderTube(d => -sp(d) / 2, dive, r0, r1);        // lower running (Langwasser)

            // Future track connection tubes (running 20 meters from platform ends into the darkness)
            const oppR0 = Math.min(inner, inner + sign * 20.0);
            const oppR1 = Math.max(inner, inner + sign * 20.0);
            
            // Draw upper and lower opposite mock tubes at both ends
            renderTube(d => sp(d) / 2 - 18.08, () => 0, oppR0, oppR1);     // upper opposite
            renderTube(d => -sp(d) / 2 - 18.08, dive, oppR0, oppR1);        // lower opposite
            const baseYi = sim.getTrackPosition(inner).y;

            // Upper portals
            if (sign === 1) {
                // Hardhöhe end: fully closed — left upper end wall with opposite track hole
                // (covers -21.88 to -8.75 absolute)
                buildEndWall(inner, sp(inner) / 2 - 18.08, baseYi + 0.8, endWallUpperMat,
                             -4.1, 9.03, -3.8, hallHeight + 0.07);
                // Hardhöhe end: right upper end wall with running track hole (covers -8.75 to 3.9 absolute)
                buildEndWall(inner, sp(inner) / 2, baseYi + 0.8, endWallUpperMat,
                             -9.05, 3.6, -3.8, hallHeight + 0.07);
            } else {
                // Langwasser end: left upper end wall with opposite track hole, leaving the wide
                // stair/escalator opening to the mezzanine (covers -21.88 to -14.5 absolute;
                // -14.5 to -3.5 stays open for the bank built above)
                buildEndWall(inner, sp(inner) / 2 - 18.08, baseYi + 0.8, endWallUpperMat,
                             -4.1, 3.28, -3.8, hallHeight + 0.07);
                // Langwasser end: right upper end wall with running track hole (covers -3.5 to 3.9 absolute)
                buildEndWall(inner, sp(inner) / 2, baseYi + 0.8, endWallUpperMat,
                             -3.8, 3.6, -3.8, hallHeight + 0.07);
            }

            // Lower portals (Split into 2 panels, each with a tube hole)
            buildEndWall(inner, -sp(inner) / 2, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         -9.05, 4.1, -3.8, LOWER_CLEAR + platTopY - 0.85);        // right lower end wall (running track - covers -9.35 to 3.8 absolute)
            buildEndWall(inner, -sp(inner) / 2 - 18.08, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         -3.6, 9.03, -3.8, LOWER_CLEAR + platTopY - 0.85);        // left lower end wall (opposite track - covers -21.98 to -9.35 absolute)
        }
        addI(this._plTubeGeom, tubeMat, tubeM);
        addI(this._plGlowGeom, this.materials.tunnelGlow, tubeGlowM);

        this.scene.add(group);
        this.plaerrerGroup = group;
    }

    createPortalGeometry() {
        const archShape = new THREE.Shape();
        archShape.moveTo(-7.5, -2.8);
        archShape.lineTo(7.5, -2.8);
        archShape.lineTo(7.5, 6.7);
        archShape.lineTo(-7.5, 6.7);
        archShape.lineTo(-7.5, -2.8);
        
        const hole = new THREE.Path();
        hole.absarc(0, 0, 6.2, 0, Math.PI * 2, true);
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

    // Builds ONE merged tunnel-wall mesh for a whole chunk from a list of [s_start, s_end]
    // arc-length segments (typically the 5 m sub-segments). Merging all ring pairs into a
    // single BufferGeometry replaces the former one-mesh-per-5m approach (10 draw calls and
    // 10 geometries per underground chunk -> 1).
    createTunnelWallMesh(segments, chunkGroup) {
        const radialSegments = 16; // 16 for a rounder, premium look

        const vertices = [];
        const indices = [];
        const uvs = [];
        let ringBase = 0;

        const up = new THREE.Vector3(0, 1, 0); // vertical up
        const normal = new THREE.Vector3();
        const center = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const worldVertex = new THREE.Vector3();

        for (const [s_start, s_end] of segments) {
            // Two rings of vertices per segment (j = 0 and 1)
            for (let j = 0; j <= 1; j++) {
                const s = j === 0 ? s_start : s_end;
                this.sim.getTrackPosition(s, center);
                this.sim.getTrackTangent(s, tangent);
                const spacing = this.sim.getTrackSpacing(s);

                let radius = spacing / 2 + 3.1;

                // Expand tunnel around Jakobinenstraße, Maximilianstraße, Bärenschanze and Gostenhof to prevent overlaps with tall ceilings/walls
                for (const name of ["Jakobinenstraße", "Maximilianstraße", "Bärenschanze", "Gostenhof"]) {
                    const st = this.sim.stations.find(s => s.name === name);
                    if (st) {
                        const dist = Math.abs(s - st.position);
                        const fullPlatform = st.halfLength + 2.0; // platform length + 2m margin
                        const transitionZone = 15.0; // 15m smooth transition
                        if (dist < fullPlatform + transitionZone) {
                            const extraR = (name !== "Jakobinenstraße") ? 6.2 : 5.5;
                            const targetRadius = spacing / 2 + extraR; // expanded radius to clear the tall ceiling/walls
                            if (dist <= fullPlatform) {
                                radius = Math.max(radius, targetRadius);
                            } else {
                                // Smoothly interpolate between targetRadius and normal radius
                                const t = (dist - fullPlatform) / transitionZone;
                                const lerped = THREE.MathUtils.lerp(targetRadius, spacing / 2 + 3.1, t);
                                radius = Math.max(radius, lerped);
                            }
                        }
                    }
                }

                normal.set(-tangent.z, 0, tangent.x).normalize();

                // Ring center (y is offset by 0.8)
                center.y += 0.8;

                for (let k = 0; k <= radialSegments; k++) {
                    const theta = (k / radialSegments) * Math.PI * 2;
                    const cos = Math.cos(theta);
                    const sin = Math.sin(theta);

                    worldVertex.copy(center)
                        .addScaledVector(normal, cos * radius)
                        .addScaledVector(up, sin * radius);

                    const localVertex = chunkGroup.worldToLocal(worldVertex);
                    vertices.push(localVertex.x, localVertex.y, localVertex.z);

                    // UV coordinates: u goes around the circle, v goes along the length of the track
                    uvs.push(k / radialSegments, j);
                }
            }

            // Generate indices for faces (inward-facing normals)
            for (let k = 0; k < radialSegments; k++) {
                const a = ringBase + k;
                const b = ringBase + (k + 1);
                const c = ringBase + (radialSegments + 1) + k;
                const d = ringBase + (radialSegments + 1) + (k + 1);

                // Two triangles per quad (front faces facing inside)
                indices.push(a, b, c);
                indices.push(b, d, c);
            }
            ringBase += 2 * (radialSegments + 1);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return new THREE.Mesh(geometry, this.materials.tunnelWall);
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

    createChunk(idx) {
        const chunkGroup = new THREE.Group();
        const startZ = idx * this.chunkSize;
        const endZ = (idx + 1) * this.chunkSize;
        
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
        let railMat = this.materials.rail;
        let sleeperMat = this.materials.sleeper;
        let thirdRailMat = this.materials.thirdRail;

        const isPlatform = this.isInsideStationPlatform(centerZ);
        if (chunkType === 'underground' && !isPlatform) {
            ballastMat = this.materials.tunnelBallast;
            railMat = this.materials.tunnelRail;
            sleeperMat = this.materials.tunnelSleeper;
            thirdRailMat = this.materials.tunnelThirdRail;
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
            if (kind === 'viaduct') {
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.3) / 2, (s) => gTY(s) - 0.80, (s) => gTY(s) - 0.30, this.materials.viaduct);
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
                    (s) => (gSp(s) + 4.3) / 2, (s) => gTY(s) - 0.80, (s) => gTY(s) - 0.30, this.materials.viaduct);
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
                // OUTER edge stays fixed at 60m, matching the normal open-air ground width.
                for (const sign of [1, -1]) {
                    const outer = 60;
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd,
                        (s) => sign * (wShaft(s) / 2 + outer) / 2,
                        (s) => (outer - wShaft(s) / 2) / 2,
                        () => -0.425, () => -0.375, this.materials.ground);
                }
            } else if (kind === 'tunnel' || kind === 'tunnel-platform') {
                const yOff = kind === 'tunnel-platform' ? 0.52 : 0.50;
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 4.2) / 2, (s) => gTY(s) - yOff - 0.2, (s) => gTY(s) - yOff + 0.2, ballastMat);
            }
            bedRun = null;
        };

        for (let j = 0; j < numSub; j++) {
            const s_start = startZ + j * subLen;
            const s_end = startZ + (j + 1) * subLen;
            const s_mid = (s_start + s_end) / 2;

            // Plärrer is built bespoke (stacked levels + hall + diverging tubes); skip all
            // generic beds / ground / tunnel walls there.
            if (this.sim.isPlaerrerZone(s_mid)) { flushBedRun(); continue; }

            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const spacing = this.sim.getTrackSpacing(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - chunkGroup.rotation.y;
            const localPos = chunkGroup.worldToLocal(pos.clone());

            const subChunkType = this.getChunkType(s_mid);

            // Build tunnel wall segment if it overlaps with underground tunnels.
            // Underground = [0,p1], [p2,p3], [p4,end] from the re-anchored elevation breakpoints.
            const e = this.sim.track.elevation;
            const tunnelIntervals = [
                [0, e.p1],
                [e.p2, e.p3],
                [e.p4, this.sim.totalLength]
            ];
            tunnelIntervals.forEach(interval => {
                const intersectStart = Math.max(s_start, interval[0]);
                const intersectEnd = Math.min(s_end, interval[1]);
                if (intersectStart < intersectEnd) {
                    // Plärrer is enclosed by a bespoke rectangular hall (buildPlaerrer),
                    // so suppress the generic circular tube there (it is too small to reach
                    // the lower level anyway).
                    if (this.sim.isPlaerrerZone((intersectStart + intersectEnd) / 2)) return;
                    tunnelWallSegs.push([intersectStart, intersectEnd]);
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

            // Build Ground & Streets for open-air sub-segments
            if (subChunkType !== 'underground') {
                const groundY = -0.35;
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

                // Left background ground (width 450m, offset -280m, covers -505m to -55m)
                const posBgL = chunkGroup.worldToLocal(pos.clone().addScaledVector(normal, -280));
                addBatched('bgGround', this.geometries.bgGround, this.materials.bgGround,
                    posBgL.x, (groundY - 0.15) - chunkGroupY, posBgL.z, rotY); // keep world Y flat at -0.5m

                // Right background ground (width 450m, offset 280m, covers 55m to 505m)
                const posBgR = chunkGroup.worldToLocal(pos.clone().addScaledVector(normal, 280));
                addBatched('bgGround', this.geometries.bgGround, this.materials.bgGround,
                    posBgR.x, (groundY - 0.15) - chunkGroupY, posBgR.z, rotY);

                // Open-cut shaft has split grass terrain to expose retaining walls; that split
                // is now built as one continuous swept pair per run in flushBedRun() (kind
                // 'shaft'), alongside the retaining walls it must line up with, so skip it here.
                if (subChunkType !== 'shaft') {
                    addBatched('ground', this.geometries.ground, this.materials.ground,
                        localPos.x, (groundY - 0.05) - chunkGroupY, localPos.z, rotY);
                }
            }
        }
        flushBedRun(); // build the last open run (nothing left to change its kind)

        // Merged tunnel wall: one geometry + one draw call for the whole chunk
        if (tunnelWallSegs.length > 0) {
            chunkGroup.add(this.createTunnelWallMesh(tunnelWallSegs, chunkGroup));
        }

        // Add elevated pillars underneath the tracks
        if (chunkType === 'elevated' || chunkType === 'ramp') {
            this.createPillars(chunkGroup, startZ);
        }

        // Add tunnel lights (the bespoke Plärrer tubes carry their own lamps).
        // The fixtures/tubes/halos are collected into the chunk batches (3 InstancedMeshes)
        // instead of 24 individual meshes per chunk.
        if (chunkType === 'underground') {
            const lightSpacings = [6.25, 18.75, 31.25, 43.75];
            lightSpacings.forEach(ls => {
                if (this.sim.isPlaerrerZone(startZ + ls)) return;
                this.createTunnelLights(chunkGroup, startZ + ls, addBatchedMatrix);
            });
        }

        // 2. Build running rails as InstancedMesh
        const railsIM = new THREE.InstancedMesh(this.geometries.rail, railMat, 40);
        const powerRailsIM = new THREE.InstancedMesh(this.geometries.thirdRail, thirdRailMat, 20);
        const coversIM = new THREE.InstancedMesh(this.geometries.thirdRailCover, thirdRailMat, 20);

        const setSegmentMatrix = (im, instanceIdx, A_world, B_world) => {
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

            const scaleMatrix = new THREE.Matrix4().makeScale(1.0, 1.0, length);
            matrix.multiply(scaleMatrix);

            im.setMatrixAt(instanceIdx, matrix);
        };

        const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let j = 0; j < numSub; j++) {
            const s_start = startZ + j * subLen;
            const s_end = startZ + (j + 1) * subLen;

            // Suppress generic rails in the bespoke Plärrer zone.
            if (this.sim.isPlaerrerZone((s_start + s_end) / 2)) {
                for (let r = 0; r < 4; r++) railsIM.setMatrixAt(j * 4 + r, _zeroMat);
                for (let p = 0; p < 2; p++) { powerRailsIM.setMatrixAt(j * 2 + p, _zeroMat); coversIM.setMatrixAt(j * 2 + p, _zeroMat); }
                continue;
            }

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
                setSegmentMatrix(railsIM, j * 4 + r, A, B);
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
                setSegmentMatrix(powerRailsIM, j * 2 + p, A_rail, B_rail);

                const A_cover = posStart.clone().addScaledVector(normalStart, powerStart[p]);
                A_cover.y = posStart.y + 0.03;
                const B_cover = posEnd.clone().addScaledVector(normalEnd, powerEnd[p]);
                B_cover.y = posEnd.y + 0.03;
                setSegmentMatrix(coversIM, j * 2 + p, A_cover, B_cover);
            }
        }

        railsIM.instanceMatrix.needsUpdate = true;
        powerRailsIM.instanceMatrix.needsUpdate = true;
        coversIM.instanceMatrix.needsUpdate = true;
        chunkGroup.add(railsIM, powerRailsIM, coversIM);

        // 3. Build Sleepers locally for both tracks (25 sleepers)
        const sleeperIM1 = new THREE.InstancedMesh(this.geometries.sleeper, sleeperMat, this.sleepersPerChunk);
        const sleeperIM2 = new THREE.InstancedMesh(this.geometries.sleeper, sleeperMat, this.sleepersPerChunk);
        const spacingVal = this.chunkSize / this.sleepersPerChunk;

        for (let s = 0; s < this.sleepersPerChunk; s++) {
            const distVal = startZ + s * spacingVal + spacingVal / 2;
            if (this.sim.isPlaerrerZone(distVal)) {
                sleeperIM1.setMatrixAt(s, _zeroMat); sleeperIM2.setMatrixAt(s, _zeroMat);
                continue;
            }
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
            sleeperIM1.setMatrixAt(s, matrix1);

            const pos2 = pos.clone().addScaledVector(normal, -spacing / 2);
            pos2.y = pos.y - 0.25;
            const localPos2 = chunkGroup.worldToLocal(pos2);
            const matrix2 = new THREE.Matrix4().makeRotationY(angle - chunkGroup.rotation.y);
            matrix2.setPosition(localPos2);
            sleeperIM2.setMatrixAt(s, matrix2);
        }
        sleeperIM1.instanceMatrix.needsUpdate = true;
        sleeperIM2.instanceMatrix.needsUpdate = true;
        chunkGroup.add(sleeperIM1, sleeperIM2);

        // 5. Add tunnel portals at the re-anchored portal transition coordinates
        const e = this.sim.track.elevation;
        const portals = [e.p1, e.p2, e.p3, e.p4];
        portals.forEach(portalZ => {
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
        const spacing = this.sim.getTrackSpacing(s);
        const scale = (spacing / 2 + 3.1) / 6.2;

        const R_tunnel = 6.2 * scale;
        const Y_center = 0.8;
        const Y_lamp = 1.8;
        const Y_diff = Y_lamp - Y_center;
        const X_diff = Math.sqrt(Math.max(0.1, R_tunnel * R_tunnel - Y_diff * Y_diff)) - 0.5;

        const posL = pos.clone().addScaledVector(normal, X_diff);
        const posR = pos.clone().addScaledVector(normal, -X_diff);

        const rotZ_L = Math.atan2(Y_diff, -X_diff) + Math.PI / 2;
        const rotZ_R = Math.atan2(Y_diff, X_diff) + Math.PI / 2;

        const localL = chunkGroup.worldToLocal(posL);
        const localR = chunkGroup.worldToLocal(posR);
        const angle = Math.atan2(tangent.x, tangent.z) - chunkGroup.rotation.y;

        const one = new THREE.Vector3(1, 1, 1);
        const addLamp = (local, rotZ) => {
            // Fixture casing at the wall, then the glow tube and the halo plane as
            // fixed local +Y offsets of the fixture (formerly child meshes).
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, rotZ, 'YXZ'));
            const fm = new THREE.Matrix4().compose(new THREE.Vector3(local.x, local.y + Y_lamp, local.z), q, one);
            addBatchedMatrix('tunnelFixture', this.geometries.tunnelFixture, this.materials.tunnelFixtureMat, fm);
            const gm = fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.041, 0));
            addBatchedMatrix('tunnelGlow', this.geometries.tunnelGlow, this.materials.tunnelGlow, gm);
            // halo slightly offset from the casing in local +Y (towards center of tunnel)
            const hm = fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.005, 0));
            addBatchedMatrix('tunnelHalo', this.geometries.tunnelHalo, this.materials.neonHaloMat, hm);
        };

        addLamp(localL, rotZ_L); // Left Wall Lamp
        addLamp(localR, rotZ_R); // Right Wall Lamp
    }

    createPortalArch(localPortalZ, group, centerX = 0, scale = 1.0) {
        const portalMesh = new THREE.Mesh(this.geometries.portal, this.materials.portal);
        portalMesh.position.set(centerX, 0.8, localPortalZ);
        portalMesh.scale.set(scale, scale, 1.0);
        group.add(portalMesh);
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
        return texture;
    }

    createBallastTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const size = 1 + Math.random() * 2;
            const colorVal = Math.random();
            if (colorVal < 0.4) ctx.fillStyle = '#1e1e1e';
            else if (colorVal < 0.8) ctx.fillStyle = '#4a4a4a';
            else ctx.fillStyle = '#555555';
            ctx.fillRect(x, y, size, size);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // 1:1 repeat because we now scale UVs in the geometry itself to match world meters
        texture.repeat.set(1, 1);
        return texture;
    }

    createTunnelConcreteTexture() {
        // Near-black base with minimal pixel grain – adapts naturally to 8-sided cylinder panels
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Near-black base
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, size, size);

        // Minimal grainy noise – only very subtle pixel variation
        for (let i = 0; i < 6000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const v = Math.floor(10 + Math.random() * 18); // 10–28 range, almost invisible
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1, 1);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        // 8 panels in the octagon cylinder \u2013 8 U-repeats means each panel gets exactly one texture tile
        // V=1 covers the 5m segment height without stretching
        tex.repeat.set(8, 1);
        return tex;
    }

    createNeonHaloTexture() {
        // Tall canvas so the gradient naturally stretches vertically when the sprite is scaled.
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size / 2;  // 64 wide
        canvas.height = size;     // 128 tall
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        // Elliptical falloff: tight horizontally, extended vertically
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
        grad.addColorStop(0.00, 'rgba(210,235,255,0.65)');
        grad.addColorStop(0.30, 'rgba(190,225,255,0.28)');
        grad.addColorStop(0.65, 'rgba(170,215,255,0.07)');
        grad.addColorStop(1.00, 'rgba(0,0,0,0.00)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }

    createFenceTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);

        // Dark grey metal color
        ctx.fillStyle = '#222222';
        
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
            
            addBatched('fencePost', this.geometries.fencePost, this.materials.wall,
                localPos.x, localPos.y, localPos.z, rotY, 1, height, 1);
        }
    }

}
