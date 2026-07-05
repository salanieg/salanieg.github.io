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
            treeTrunk: new THREE.MeshLambertMaterial({ color: '#4a2f13' }),
            treeLeaves: new THREE.MeshLambertMaterial({ color: '#2d6a4f' }),

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
            treeTrunk: new THREE.CylinderGeometry(0.15, 0.25, 3.5, 6),
            treeLeaves: new THREE.SphereGeometry(1.6, 6, 5),
            street: new THREE.PlaneGeometry(6, 5.0), // 5m street sub-segments
 
            // Ground (clouds are now part of WorldManager's sky-photo background)
            ground: new THREE.PlaneGeometry(120, 10.0), // Overlapped to prevent curve seams (10m instead of 5m)
            bgGround: new THREE.PlaneGeometry(450, 25.0) // Overlapped to prevent curve seams (25m instead of 5m)
        };
 
        // Align geometries
        this.geometries.tunnelWall.rotateX(Math.PI / 2);
        
        this.geometries.treeTrunk.translate(0, 1.75, 0);
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
        // (The cosmetic outer deco tracks were removed for performance.)

        const bedGeom = new THREE.BoxGeometry(3.6, 0.15, 1.0);
        const addI = (geom, mat, arr) => {
            if (!arr.length) return;
            const im = new THREE.InstancedMesh(geom, mat, arr.length);
            arr.forEach((m, i) => im.setMatrixAt(i, m));
            im.instanceMatrix.needsUpdate = true;
            im.frustumCulled = false;
            group.add(im);
        };
        addI(bedGeom, this.materials.tunnelBallast, bedM);
        addI(this.geometries.sleeper, this.materials.tunnelSleeper, sleeperM);
        addI(this.geometries.rail, this.materials.tunnelRail, railM);
        addI(this.geometries.thirdRail, this.materials.tunnelThirdRail, powerM);
        addI(this.geometries.thirdRailCover, this.materials.tunnelThirdRail, coverM);

        // ---------- shared constants & reused station materials ----------
        const platHeight = 1.165, platCenterY = 0.2825, platTopY = 0.865, segLen = 5;
        const LOWER_W = 15, UPPER_W = 15;            // normal island-platform width (m), both levels
        const EDGE_GAP = 1.54;                       // platform edge inboard of its track centre
        const LOWER_CLEAR = 3.75;                    // lower ceiling clearance ≈ Aufseßplatz
        const HALL_H = 16;                           // upper distribution-hall height (m)
        const ESC_HALF = 9;                          // escalator shaft half-length along Z
        const ESC_X0 = -11.75, ESC_X1 = -6.25;       // escalator band in X (also the framing walls)
        const WALL_X = -21.0;                        // outer station wall (beyond the deco track)

        // Reuse the existing station floor textures for both decks (tiled top + side faces).
        const lowerFloorMats = stationModel.getPlatformMaterials(p, LOWER_W, false, false);
        const upperFloorMats = stationModel.getPlatformMaterials(p, UPPER_W, false, false);
        const stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const tactileMat = new THREE.MeshLambertMaterial({ color: '#1d201f' });
        const glowMat = this.materials.tunnelGlow;

        // photo 1 (lower platform): cream tiles + dark-red accent band + station name stripe.
        // The lower level is deep and dimly lit, so lift the walls with a gentle self-glow.
        const lowerTileMat = stationModel.createTiledMaterial('#e0d4bb', '#7c6a4d', 0.2);
        const lowerRedMat  = stationModel.createTiledMaterial('#b1422f', '#5a1e16', 0.2);
        const lowerCeilMat = new THREE.MeshLambertMaterial({ color: '#cfc8ba', emissive: '#332f27' });
        lowerTileMat.emissive = new THREE.Color('#4a4334');
        lowerRedMat.emissive = new THREE.Color('#3c150f');
        const nameStripeMat = stationModel.createWallStripeMaterial('Plärrer', '#b1422f', '#ffffff');

        // photo 2 (upper hall): bright walls + ceiling, brushed-silver columns, recessed lights.
        const hallWallMat = new THREE.MeshLambertMaterial({ color: '#d7dbe0' });
        const hallCeilMat = new THREE.MeshLambertMaterial({ color: '#e6e9ed' });
        const colMat      = new THREE.MeshLambertMaterial({ color: '#c4cad2' });
        const recessMat   = new THREE.MeshLambertMaterial({ color: '#aeb4bc', side: THREE.DoubleSide });
        const skyMat      = new THREE.MeshBasicMaterial({ color: '#eaf4ff' });

        // framed-stair / escalator textures reused from the generic station builder.
        const sb = new StationBuilder(stationModel, p);
        const concreteMat = sb.createRoughConcreteMaterial();
        const escStepMat  = new THREE.MeshLambertMaterial({ map: sb.createEscalatorStripeTexture() });
        const glassMat    = new THREE.MeshBasicMaterial({ color: '#9fb3c8', transparent: true, opacity: 0.45 });
        const handrailMat = new THREE.MeshBasicMaterial({ color: '#15181c' });

        const frameAt = (d) => {
            const c = sim.getTrackPosition(d);
            const tan = sim.getTrackTangent(d);
            const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
            return { c, tan, nrm, rotY: Math.atan2(tan.x, tan.z) };
        };
        // slab aligned to the local track frame, centred laterally at xLat, at world height y.
        const addSlab = (d, xLat, w, h, yWorld, mat, depth = segLen) => {
            const f = frameAt(d);
            const pp = f.c.clone().addScaledVector(f.nrm, xLat);
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), mat);
            m.position.set(pp.x, yWorld, pp.z); m.rotation.y = f.rotY;
            group.add(m); return m;
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

        // ---------- platform decks (reuse the tiled station-floor texture) ----------
        const platSegLen = 1.0;
        const buildDeck = (dm, j, trackSign, width, mats, baseY, openHalf) => {
            const f = frameAt(dm);
            // Plärrer Special Logic:
            // Both island platforms extend into the NEGATIVE X direction relative to their track.
            // Upper track (trackSign +1) is at +sp/2. Platform edge is at +sp/2 - EDGE_GAP.
            // Lower track (trackSign -1) is at -sp/2. Platform edge is at -sp/2 - EDGE_GAP.
            const edgeX = trackSign * sp(dm) / 2 - EDGE_GAP;
            const outerX = edgeX - width;

            const addBox = (xStart, xEnd) => {
                const w = Math.abs(xEnd - xStart);
                if (w < 0.01) return;
                const cx = (xStart + xEnd) / 2;
                const geom = new THREE.BoxGeometry(w, platHeight, platSegLen);
                stationModel.adjustPlatformUVs(geom, j, platSegLen, 1.2);
                const ctr = f.c.clone().addScaledVector(f.nrm, cx);
                const deck = new THREE.Mesh(geom, mats);
                deck.position.set(ctr.x, baseY + platCenterY, ctr.z); deck.rotation.y = f.rotY;
                group.add(deck);
            };

            const inEscZone = openHalf && Math.abs(dm - P) < openHalf;
            if (inEscZone) {
                const holeMin = Math.min(ESC_X0, ESC_X1);
                const holeMax = Math.max(ESC_X0, ESC_X1);
                // Draw platform pieces around the hole.
                // Plärrer's tracks are at +/- sp/2. Upper is at +sp/2, platform extends in -X.
                // So edgeX > holeMax > holeMin > outerX.
                if (trackSign > 0) {
                    addBox(edgeX, holeMax);
                    addBox(holeMin, outerX);
                } else {
                    // Lower platform currently has no hole, but if it did:
                    addBox(edgeX, outerX);
                }
            } else {
                addBox(edgeX, outerX);
            }

            const e1 = f.c.clone().addScaledVector(f.nrm, edgeX - 0.08);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, platSegLen), stripMat);
            strip.position.set(e1.x, baseY + platTopY + 0.012, e1.z); strip.rotation.y = f.rotY; group.add(strip);
            const e2 = f.c.clone().addScaledVector(f.nrm, edgeX - 0.45);
            const tact = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, platSegLen), tactileMat);
            tact.position.set(e2.x, baseY + platTopY + 0.012, e2.z); tact.rotation.y = f.rotY; group.add(tact);
            // outer (deco-track) edge safety stripe – restores the island-platform look
            const e3 = f.c.clone().addScaledVector(f.nrm, edgeX - width + 0.08);
            const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, platSegLen), stripMat);
            strip2.position.set(e3.x, baseY + platTopY + 0.012, e3.z); strip2.rotation.y = f.rotY; group.add(strip2);
        };
        let j = 0;
        for (let d = P - platHalf; d < P + platHalf - 0.01; d += platSegLen, j++) {
            const dm = d + platSegLen / 2;
            const baseY = sim.getTrackPosition(dm).y;
            buildDeck(dm, j, +1, UPPER_W, upperFloorMats, baseY, ESC_HALF);          // Hardhöhe (upper)
            buildDeck(dm, j, -1, LOWER_W, lowerFloorMats, baseY + dive(dm), null);   // Langwasser (lower)
        }

        // ---------- framed escalators linking the two levels (reused step texture) ----------
        {
            const fTop = frameAt(P - ESC_HALF), fBot = frameAt(P + ESC_HALF);
            const topY = fTop.c.y + platTopY;
            const botY = fBot.c.y + dive(P + ESC_HALF) + platTopY;
            const escCx = (ESC_X0 + ESC_X1) / 2;
            for (const off of [escCx - 1.35, escCx + 1.35]) {
                const A = fTop.c.clone().addScaledVector(fTop.nrm, off); A.y = topY + 0.18;
                const B = fBot.c.clone().addScaledVector(fBot.nrm, off); B.y = botY + 0.18;
                placeBetween(A, B, 2.2, 0.3, escStepMat);                                  // moving step band
                const gAl = A.clone().addScaledVector(fTop.nrm, -1.1), gBl = B.clone().addScaledVector(fBot.nrm, -1.1);
                const gAr = A.clone().addScaledVector(fTop.nrm, 1.1),  gBr = B.clone().addScaledVector(fBot.nrm, 1.1);
                placeBetween(gAl, gBl, 0.05, 0.9, glassMat);
                placeBetween(gAr, gBr, 0.05, 0.9, glassMat);
                placeBetween(gAl.clone().setY(gAl.y + 0.9), gBl.clone().setY(gBl.y + 0.9), 0.13, 0.13, handrailMat);
                placeBetween(gAr.clone().setY(gAr.y + 0.9), gBr.clone().setY(gBr.y + 0.9), 0.13, 0.13, handrailMat);
            }
            // enclosing concrete framing walls on both sides of the escalator bank ("eingefasst")
            const midZ = P, fMid = frameAt(midZ);
            const wallH = (topY + 0.4) - botY;
            for (const wx of [ESC_X0, ESC_X1]) {
                const wp = fMid.c.clone().addScaledVector(fMid.nrm, wx);
                const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, wallH, 2 * ESC_HALF), concreteMat);
                wall.position.set(wp.x, botY + wallH / 2, wp.z); wall.rotation.y = fMid.rotY;
                group.add(wall);
            }
        }

        // ---------- LOWER platform enclosure ("photo 1": cream/red tile, low ceiling) ----------
        for (let d = P - platHalf; d < P + platHalf - 0.1; d += segLen) {
            const dm = d + segLen / 2;
            const f = frameAt(dm);
            const lBaseY = f.c.y + dive(dm);
            const wallX = WALL_X;                                  // outer wall, beyond the deco track
            const ceilY = lBaseY + platTopY + LOWER_CLEAR;
            const nearX = -sp(dm) / 2 + 1.0;                       // just past the lower track
            const lightX = -9.0;                                   // over the platform centre
            const wallH = LOWER_CLEAR + platTopY;
            // curved tiled side wall (cream) with a red accent band + name stripe
            addSlab(dm, wallX + 0.12, 0.3, wallH, lBaseY + wallH / 2, lowerTileMat);
            addSlab(dm, wallX + 0.16, 0.32, 0.5, lBaseY + platTopY + 1.95, lowerRedMat);
            addSlab(dm, wallX + 0.2, 0.34, 0.34, lBaseY + platTopY + 1.45, nameStripeMat);
            // ceiling – leave a gap over the escalator band so the shaft is open to the hall
            if (Math.abs(dm - P) < ESC_HALF) {
                addSlab(dm, (wallX + ESC_X0) / 2, (ESC_X0 - wallX), 0.4, ceilY, lowerCeilMat);
                addSlab(dm, (ESC_X1 + nearX) / 2, (nearX - ESC_X1), 0.4, ceilY, lowerCeilMat);
            } else {
                addSlab(dm, (wallX + nearX) / 2, (nearX - wallX), 0.4, ceilY, lowerCeilMat);
                if ((j2 => j2 % 2 === 0)(Math.round((dm - P) / segLen))) {
                    const lc = f.c.clone().addScaledVector(f.nrm, lightX);
                    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 18), recessMat);
                    ring.position.set(lc.x, ceilY - 0.21, lc.z); ring.rotation.x = Math.PI / 2; group.add(ring);
                    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.45, 18), skyMat);
                    disk.position.set(lc.x, ceilY - 0.22, lc.z); disk.rotation.x = Math.PI / 2; group.add(disk);
                }
            }
        }

        // ---------- UPPER distribution HALL ("photo 2": 16 m, silver columns, round skylights) ----------
        const HALL_FAR = WALL_X, HALL_NEAR = 3.0;                  // hall side-wall X positions
        for (let d = P - platHalf; d < P + platHalf - 0.1; d += segLen) {
            const dm = d + segLen / 2;
            const f = frameAt(dm);
            const floorY = f.c.y + platTopY;                       // upper platform / hall floor level
            const ceilY = floorY + HALL_H;
            addSlab(dm, HALL_FAR, 0.5, HALL_H, (floorY + ceilY) / 2, hallWallMat);
            addSlab(dm, HALL_NEAR, 0.5, HALL_H, (floorY + ceilY) / 2, hallWallMat);
            addSlab(dm, (HALL_FAR + HALL_NEAR) / 2, (HALL_NEAR - HALL_FAR), 0.5, ceilY + 0.25, hallCeilMat);
        }
        // silver columns + recessed round skylights every 12 m
        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const floorY = f.c.y + platTopY, ceilY = floorY + HALL_H;
            for (const cx of [-4.5, -13.5]) {
                const cp = f.c.clone().addScaledVector(f.nrm, cx);
                const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, HALL_H, 16), colMat);
                col.position.set(cp.x, (floorY + ceilY) / 2, cp.z); group.add(col);
            }
            const sc = f.c.clone().addScaledVector(f.nrm, -9.0);
            const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.0, 28), recessMat);
            ring.position.set(sc.x, ceilY - 0.02, sc.z); ring.rotation.x = Math.PI / 2; group.add(ring);
            const disk = new THREE.Mesh(new THREE.CircleGeometry(1.6, 28), skyMat);
            disk.position.set(sc.x, ceilY - 0.04, sc.z); disk.rotation.x = Math.PI / 2; group.add(disk);
        }

        // ---------- single-track TUBES + standard tunnel-entrance portals ----------
        // The two stacked tubes run from each platform end out to the zone boundary, where a
        // standard portal frames the transition into the generic double-track tunnel. A matching
        // portal at each platform end makes the tube join the station hall flush ("bündig").
        const tubeMat = this.materials.tunnelWall;
        const TUBE_R = 3.4;
        if (!this._plTubeGeom) this._plTubeGeom = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).rotateX(Math.PI / 2);
        const renderTube = (latFn, yFn, d0, d1) => {
            const ds = 10, R = TUBE_R;
            let prev = null;
            for (let d = d0; d <= d1 + 0.01; d += ds) {
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
                        const tube = new THREE.Mesh(this._plTubeGeom, tubeMat);
                        tube.applyMatrix4(m);
                        group.add(tube);

                        // Lamp strip running along the crown of the tube.
                        if (!this._plGlowGeom) this._plGlowGeom = new THREE.BoxGeometry(0.55, 0.07, 1);
                        const gm = new THREE.Matrix4().makeBasis(right, aUp, dir);
                        gm.setPosition(mid.clone().addScaledVector(aUp, R * 0.82));
                        gm.multiply(new THREE.Matrix4().makeScale(1, 1, len));
                        const glow = new THREE.Mesh(this._plGlowGeom, this.materials.tunnelGlow);
                        glow.applyMatrix4(gm);
                        group.add(glow);
                    }
                }
                prev = cur;
            }
        };
        // Classic in-station tunnel entrance: a flat end wall (station material) with a round
        // tube opening, like the tunnel mouths in the other underground stations.
        const endWallLowerMat = lowerTileMat.clone(); endWallLowerMat.side = THREE.DoubleSide;
        const endWallUpperMat = hallWallMat.clone(); endWallUpperMat.side = THREE.DoubleSide;
        const buildEndWall = (d, lat, yc, mat, uLeft, uRight, vBot, vTop) => {
            const shape = new THREE.Shape();
            shape.moveTo(uLeft, vBot);
            shape.lineTo(uRight, vBot);
            shape.lineTo(uRight, vTop);
            shape.lineTo(uLeft, vTop);
            shape.lineTo(uLeft, vBot);
            const hole = new THREE.Path();
            hole.absarc(0, 0, TUBE_R + 0.05, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            const f = frameAt(d);
            const pp = f.c.clone().addScaledVector(f.nrm, lat);
            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
            mesh.position.set(pp.x, yc, pp.z);
            mesh.rotation.y = f.rotY;
            group.add(mesh);
        };
        for (const sign of [-1, 1]) {
            const inner = P + sign * platHalf;     // platform end (joins the station)
            const outer = P + sign * zoneHalf;     // zone boundary (joins the generic tunnel)
            const r0 = Math.min(inner, outer), r1 = Math.max(inner, outer);
            renderTube(d => sp(d) / 2, () => 0, r0, r1);     // upper (Hardhöhe)
            renderTube(d => -sp(d) / 2, dive, r0, r1);        // lower (Langwasser)
            // classic tunnel-entrance end walls at the platform ends, framing each tube flush
            const baseYi = sim.getTrackPosition(inner).y;
            buildEndWall(inner, sp(inner) / 2, baseYi + 0.8, endWallUpperMat,
                         HALL_FAR - sp(inner) / 2, 3.8, -3.8, HALL_H + 0.07);          // upper hall end
            buildEndWall(inner, -sp(inner) / 2, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         WALL_X + sp(inner) / 2, 3.8, -3.8, LOWER_CLEAR + platTopY - 0.85); // lower platform end
        }

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

                const radius = spacing / 2 + 3.1;
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
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, (s) => sign * (gSp(s) / 2 + 2.15),
                        () => 0.1, (s) => gTY(s) - 0.25, (s) => gTY(s) + 0.75, this.materials.viaduct);
                }
            } else if (kind === 'atgrade-split') {
                for (const sign of [1, -1]) {
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, (s) => sign * gSp(s) / 2,
                        () => 1.6, (s) => gTY(s) - 0.45, (s) => gTY(s) - 0.30, ballastMat);
                }
            } else if (kind === 'atgrade-normal') {
                this.buildSweptTrackBox(chunkGroup, sStart, sEnd, null,
                    (s) => (gSp(s) + 3.8) / 2, (s) => gTY(s) - 0.45, (s) => gTY(s) - 0.30, ballastMat);
            } else if (kind === 'shaft') {
                const wShaft = (s) => gSp(s) + 4.5;
                const wallCenterY = (s) => (gTY(s) - 0.85) / 2;
                const wallHalfH = (s) => (0.15 - gTY(s)) / 2;
                for (const sign of [1, -1]) {
                    this.buildSweptTrackBox(chunkGroup, sStart, sEnd, (s) => sign * wShaft(s) / 2,
                        () => 0.1, (s) => wallCenterY(s) - wallHalfH(s), (s) => wallCenterY(s) + wallHalfH(s), this.materials.viaduct);
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
            const isViaduct = (subChunkType === 'elevated' || subChunkType === 'ramp');
            const isPlatformHere = this.isInsideStationPlatform(s_mid);
            let kind;
            if (isViaduct) kind = 'viaduct';
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
            
            const pillar = new THREE.Mesh(this.geometries.viaductPillar, this.materials.viaduct);
            pillar.position.copy(group.worldToLocal(pos));
            pillar.position.y = -10;
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

        // 2. Create Instanced Trees Forest (30 trees total) - skipped near all stations
        const centerZ = idx * this.chunkSize + this.chunkSize / 2;
        const isNearStation = this.sim.stations.some(s => Math.abs(centerZ - s.position) < 60);

        if (!isNearStation) {
            const treeTrunkIM = new THREE.InstancedMesh(this.geometries.treeTrunk, this.materials.treeTrunk, 30);
            const treeLeavesIM = new THREE.InstancedMesh(this.geometries.treeLeaves, this.materials.treeLeaves, 30);

            const leafColors = [
                new THREE.Color('#143d16'), // very dark green
                new THREE.Color('#1e5321'), // dark green
                new THREE.Color('#2a6a30'), // forest green
                new THREE.Color('#38823f'), // medium green
                new THREE.Color('#4a9c52')  // light green
            ];

            for (let t = 0; t < 30; t++) {
                const seed = idx * 23 + t * 47;
                const rand1 = seedRandom(seed);
                const rand2 = seedRandom(seed + 1);
                const rand3 = seedRandom(seed + 2);

                const isLeft = (t < 15);
                
                // Select a side and coordinate band to avoid the street at +/- 18 (width 6, so 15 to 21)
                let X_tree;
                if (rand3 < 0.35) {
                    // Inner band (between track ballast and street)
                    X_tree = 8 + rand1 * 6; // 8 to 14
                } else {
                    // Outer band (beyond the street)
                    X_tree = 22 + rand1 * 14; // 22 to 36
                }
                if (isLeft) X_tree = -X_tree;

                const Z_tree = -25 + rand2 * 50; // spread along the 50m chunk

                const scaleY = 0.85 + rand1 * 0.45;
                const scaleXZ = 0.85 + rand2 * 0.35;

                // Trunk
                const trunkMatrix = new THREE.Matrix4();
                trunkMatrix.makeScale(scaleXZ, scaleY, scaleXZ);
                trunkMatrix.setPosition(X_tree, groundY - chunkGroupY, Z_tree); // keep world Y flat
                treeTrunkIM.setMatrixAt(t, trunkMatrix);

                // Leaves
                const leavesMatrix = new THREE.Matrix4();
                const leavesScale = scaleXZ * 1.35;
                leavesMatrix.makeScale(leavesScale, leavesScale, leavesScale);
                leavesMatrix.setPosition(X_tree, (groundY + 3.5 * scaleY) - chunkGroupY, Z_tree); // keep world Y flat
                treeLeavesIM.setMatrixAt(t, leavesMatrix);

                const leafColIdx = Math.floor(rand2 * leafColors.length);
                treeLeavesIM.setColorAt(t, leafColors[leafColIdx]);
            }
            treeTrunkIM.instanceMatrix.needsUpdate = true;
            treeLeavesIM.instanceMatrix.needsUpdate = true;
            if (treeLeavesIM.instanceColor) treeLeavesIM.instanceColor.needsUpdate = true;

            group.add(treeTrunkIM, treeLeavesIM);
        }

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

}
