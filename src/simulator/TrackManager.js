import * as THREE from 'three';
import { StationBuilder } from './stations/StationBuilder.js?v=67';

export class TrackManager {
    constructor(scene, simulation) {
        this.scene = scene;
        this.sim = simulation;
        
        // Chunk configuration
        this.chunkSize = 50; // meters per track segment
        this.visibleChunksCount = 10; // load +/- 10 chunks (1km total window)
        this.loadedChunks = new Map(); // chunkIndex -> THREE.Group
        
        const ballastTex = this.createBallastTexture();
        this.materials = {
            rail: new THREE.MeshLambertMaterial({ color: '#8b4513' }),
            sleeper: new THREE.MeshLambertMaterial({ color: '#cccccc' }), // light grey concrete sleepers
            ballast: new THREE.MeshLambertMaterial({
                map: ballastTex
            }),
            thirdRail: new THREE.MeshLambertMaterial({ color: '#cccccc' }), // light grey matte metal power rail
            tunnelWall: new THREE.MeshLambertMaterial({ map: this.createTunnelConcreteTexture(), color: 0xffffff, side: THREE.DoubleSide }),
            tunnelBallast: new THREE.MeshLambertMaterial({ map: ballastTex, color: '#888888' }),
            tunnelRail: new THREE.MeshLambertMaterial({ color: '#5d2e0d' }),
            tunnelSleeper: new THREE.MeshLambertMaterial({ color: '#777777' }),
            tunnelThirdRail: new THREE.MeshLambertMaterial({ color: '#bbbbbb' }),
            viaduct: new THREE.MeshLambertMaterial({ color: '#4a4a4a' }),
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

            // Ground & Clouds
            ground: new THREE.MeshLambertMaterial({ 
                map: this.createGrassTexture() 
            }),
            bgGround: new THREE.MeshLambertMaterial({ 
                color: '#1e3b12' 
            }),
            cloud: new THREE.MeshBasicMaterial({ 
                map: this.createCloudTexture(), 
                transparent: true, 
                depthWrite: false, 
                side: THREE.DoubleSide 
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
            tunnelBallast: new THREE.BoxGeometry(10.4, 0.4, 5.0),
            tunnelFixture: new THREE.BoxGeometry(0.12, 0.08, 1.2), // thin casing along Z
            tunnelGlow: new THREE.BoxGeometry(0.08, 0.04, 1.0), // neon tube along Z
            tunnelHalo: (() => {
                const g = new THREE.PlaneGeometry(5.25, 12.0);
                g.rotateX(-Math.PI / 2);
                return g;
            })(),
            
            // Viaduct Bridge Elements (Double track width, 5m sub-segments)
            viaductBed: new THREE.BoxGeometry(10.5, 0.5, 5.0),
            viaductWall: new THREE.BoxGeometry(0.2, 1.0, 5.0),
            viaductPillar: new THREE.CylinderGeometry(1.5, 1.8, 20, 8),
            
            // At-grade Cutting Elements (Double track width, 5m sub-segments)
            ballastBed: new THREE.BoxGeometry(10.0, 0.15, 5.0),
            embankmentBase: new THREE.BoxGeometry(10.0, 1.0, 5.0),
  
            // City Elements
            building: new THREE.BoxGeometry(1, 1, 1),
            window: new THREE.PlaneGeometry(1, 1),
            treeTrunk: new THREE.CylinderGeometry(0.15, 0.25, 3.5, 6),
            treeLeaves: new THREE.SphereGeometry(1.6, 6, 5),
            street: new THREE.PlaneGeometry(6, 5.0), // 5m street sub-segments
 
            // Ground & Clouds
            ground: new THREE.PlaneGeometry(120, 5.0), // 5m ground sub-segments
            bgGround: new THREE.PlaneGeometry(450, 5.0),
            cloud: new THREE.PlaneGeometry(50, 50)
        };
 
        // Correct UVs for ballast geometries to ensure 1:1 world scaling (1 repeat per meter)
        const scaleUVs = (geom, sx, sy) => {
            const uv = geom.attributes.uv;
            for (let i = 0; i < uv.count; i++) {
                uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
            }
            uv.needsUpdate = true;
        };
        scaleUVs(this.geometries.ballastBed, 10.0, 5.0);
        scaleUVs(this.geometries.tunnelBallast, 10.4, 5.0);
        scaleUVs(this.geometries.viaductBed, 10.5, 5.0);

        // Align geometries
        this.geometries.tunnelWall.rotateX(Math.PI / 2);
        
        this.geometries.treeTrunk.translate(0, 1.75, 0);
        this.geometries.street.rotateX(-Math.PI / 2);
        this.geometries.ground.rotateX(-Math.PI / 2);
        this.geometries.bgGround.rotateX(-Math.PI / 2);
        this.geometries.cloud.rotateX(-Math.PI / 2);
 
        // Pre-create the portal extrude geometry
        this.geometries.portal = this.createPortalGeometry();
 
        
        // Pre-create a shared sleeper InstancedMesh template matrix
        this.sleepersPerChunk = 25; // 25 sleepers per chunk for perfect curves
        this._sleeperMatrix = new THREE.Matrix4();

        // Decorative side tracks (sidings / depot leads) from the geojson – purely cosmetic.
        this.createSideTracks();

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
        const GAUGE = 0.5076, POWER = 1.1;
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
        // Cosmetic deco track running parallel on the outer side of each island platform.
        const DECO_OFF = -18.7;
        renderTrack(samplePath(() => DECO_OFF, () => 0, P - platHalf, P + platHalf));
        renderTrack(samplePath(() => DECO_OFF, dive, P - platHalf, P + platHalf));

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

    // Build all decorative tracks once. They carry no traffic, but they must look and
    // behave EXACTLY like real running track: full ballast bed, concrete sleepers, two
    // running rails at gauge, and a covered third (power) rail. Built from the geojson
    // side-track polylines plus any registered extra polylines (e.g. Plärrer's outer
    // decks). Everything is batched into a handful of InstancedMeshes for efficiency.
    // Each polyline is a flat [x,z,x,z,...] array in world metres.
    createSideTracks() {
        const data = this.sim.track;
        const polylines = [].concat(data.sideTracks || [], this.extraDecoTracks || []);
        if (polylines.length === 0) return;

        const cx = data.cx, cz = data.cz, step = data.step;
        const nearestY = (x, z) => {
            let best = Infinity, bi = 0;
            for (let k = 0; k < cx.length; k++) {
                const d = (cx[k] - x) * (cx[k] - x) + (cz[k] - z) * (cz[k] - z);
                if (d < best) { best = d; bi = k; }
            }
            return this.sim.getTrackY(bi * step);
        };

        const up = new THREE.Vector3(0, 1, 0);
        const bedM = [], sleeperM = [], railM = [], powerM = [], coverM = [];

        // Matrix for a unit-length-along-Z element placed between A and B, offset sideways
        // by `lateral` and vertically by `yOff`, and stretched in Z to the segment length.
        const segMatrix = (A, B, lateral, yOff) => {
            const dir = new THREE.Vector3().subVectors(B, A);
            const length = dir.length();
            if (length < 0.01) return null;
            dir.normalize();
            const right = new THREE.Vector3().crossVectors(up, dir).normalize();
            const actualUp = new THREE.Vector3().crossVectors(dir, right).normalize();
            const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5).addScaledVector(right, lateral);
            mid.y += yOff;
            const m = new THREE.Matrix4().makeBasis(right, actualUp, dir);
            m.setPosition(mid);
            m.multiply(new THREE.Matrix4().makeScale(1, 1, length));
            return m;
        };

        const GAUGE = 0.5076; // running-rail half-gauge, matching the main track
        const POWER = 1.1;    // third-rail offset, matching the main track

        polylines.forEach(poly => {
            for (let i = 0; i + 3 < poly.length; i += 2) {
                const ax = poly[i], az = poly[i + 1];
                const bx = poly[i + 2], bz = poly[i + 3];
                const ay = nearestY(ax, az);
                const by = nearestY(bx, bz);
                const A = new THREE.Vector3(ax, ay, az);
                const B = new THREE.Vector3(bx, by, bz);
                const dir = new THREE.Vector3().subVectors(B, A);
                const length = dir.length();
                if (length < 0.01) continue;

                // Ballast bed
                const bed = segMatrix(A, B, 0, -0.375); if (bed) bedM.push(bed);
                // Two running rails
                const rL = segMatrix(A, B, -GAUGE, -0.21); if (rL) railM.push(rL);
                const rR = segMatrix(A, B, GAUGE, -0.21); if (rR) railM.push(rR);
                // Third (power) rail + cover
                const p = segMatrix(A, B, POWER, -0.05); if (p) powerM.push(p);
                const c = segMatrix(A, B, POWER, 0.03); if (c) coverM.push(c);

                // Sleepers every ~2 m (as on the main track)
                const nSleep = Math.max(1, Math.round(length / 2));
                const angle = Math.atan2(dir.x, dir.z);
                for (let s = 0; s < nSleep; s++) {
                    const t = (s + 0.5) / nSleep;
                    const px = ax + (bx - ax) * t;
                    const py = ay + (by - ay) * t - 0.25;
                    const pz = az + (bz - az) * t;
                    const m = new THREE.Matrix4().makeRotationY(angle);
                    m.setPosition(px, py, pz);
                    sleeperM.push(m);
                }
            }
        });

        const group = new THREE.Group();
        const bedGeom = new THREE.BoxGeometry(3.6, 0.15, 1.0); // single-track ballast, unit length
        const addInstanced = (geom, mat, mats) => {
            if (!mats.length) return;
            const im = new THREE.InstancedMesh(geom, mat, mats.length);
            mats.forEach((m, i) => im.setMatrixAt(i, m));
            im.instanceMatrix.needsUpdate = true;
            im.frustumCulled = false;
            group.add(im);
        };
        addInstanced(bedGeom, this.materials.ballast, bedM);
        addInstanced(this.geometries.sleeper, this.materials.sleeper, sleeperM);
        addInstanced(this.geometries.rail, this.materials.rail, railM);
        addInstanced(this.geometries.thirdRail, this.materials.thirdRail, powerM);
        addInstanced(this.geometries.thirdRailCover, this.materials.thirdRail, coverM);

        this.scene.add(group);
        this.sideTrackGroup = group;
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

    createTunnelWallMesh(s_start, s_end, chunkGroup) {
        const numSub = 1;
        const radialSegments = 16; // 16 for a rounder, premium look
        
        const vertices = [];
        const indices = [];
        const uvs = [];
        
        // We will sample 2 rings of vertices (from j = 0 to 1)
        for (let j = 0; j <= numSub; j++) {
            const s = s_start + j * (s_end - s_start) / numSub;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const spacing = this.sim.getTrackSpacing(s);
            
            const radius = spacing / 2 + 3.1;
            
            // Perpendicular vectors
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            const up = new THREE.Vector3(0, 1, 0); // vertical up
            
            // Ring center (y is offset by 0.8)
            const center = pos.clone();
            center.y += 0.8;
            
            for (let k = 0; k <= radialSegments; k++) {
                const theta = (k / radialSegments) * Math.PI * 2;
                const cos = Math.cos(theta);
                const sin = Math.sin(theta);
                
                const worldVertex = center.clone()
                    .addScaledVector(normal, cos * radius)
                    .addScaledVector(up, sin * radius);
                    
                const localVertex = chunkGroup.worldToLocal(worldVertex);
                vertices.push(localVertex.x, localVertex.y, localVertex.z);
                
                // UV coordinates: u goes around the circle, v goes along the length of the track
                const u = k / radialSegments;
                const v = j / numSub;
                uvs.push(u, v);
            }
        }
        
        // Generate indices for faces (inward-facing normals)
        for (let j = 0; j < numSub; j++) {
            for (let k = 0; k < radialSegments; k++) {
                const a = j * (radialSegments + 1) + k;
                const b = j * (radialSegments + 1) + (k + 1);
                const c = (j + 1) * (radialSegments + 1) + k;
                const d = (j + 1) * (radialSegments + 1) + (k + 1);
                
                // Two triangles per quad (front faces facing inside)
                indices.push(a, b, c);
                indices.push(b, d, c);
            }
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        return new THREE.Mesh(geometry, this.materials.tunnelWall);
    }

    update(trainZ) {
        const currentChunkIdx = Math.floor(trainZ / this.chunkSize);
        const minChunk = Math.max(0, currentChunkIdx - this.visibleChunksCount);
        const maxChunk = Math.min(Math.floor(this.sim.totalLength / this.chunkSize), currentChunkIdx + this.visibleChunksCount);

        // Load new visible chunks
        for (let i = minChunk; i <= maxChunk; i++) {
            if (!this.loadedChunks.has(i)) {
                const chunk = this.createChunk(i);
                this.scene.add(chunk);
                this.loadedChunks.set(i, chunk);
            }
        }

        // Unload far away chunks
        for (const [idx, chunk] of this.loadedChunks.entries()) {
            if (idx < minChunk || idx > maxChunk) {
                this.scene.remove(chunk);
                this.loadedChunks.delete(idx);
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

        // Subdivide chunk into 10 sub-segments of length 5 meters for beds/walls and rails
        const numSub = 10;
        const subLen = this.chunkSize / numSub;

        for (let j = 0; j < numSub; j++) {
            const s_start = startZ + j * subLen;
            const s_end = startZ + (j + 1) * subLen;
            const s_mid = (s_start + s_end) / 2;

            // Plärrer is built bespoke (stacked levels + hall + diverging tubes); skip all
            // generic beds / ground / tunnel walls there.
            if (this.sim.isPlaerrerZone(s_mid)) continue;

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
                    const subTunnelMesh = this.createTunnelWallMesh(intersectStart, intersectEnd, chunkGroup);
                    chunkGroup.add(subTunnelMesh);
                }
            });

            // 1. Build Ballast Bed / Track foundation
            const isViaduct = (subChunkType === 'elevated' || subChunkType === 'ramp');

            if (isViaduct) {
                const bedMesh = new THREE.Mesh(this.geometries.viaductBed, this.materials.viaduct);
                bedMesh.position.copy(localPos);
                bedMesh.position.y = localPos.y - 0.55;
                bedMesh.rotation.y = rotY;
                bedMesh.scale.x = (spacing + 4.3) / 10.5;
                chunkGroup.add(bedMesh);

                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const posL = pos.clone().addScaledVector(normal, -(spacing / 2 + 2.15));
                const posR = pos.clone().addScaledVector(normal, (spacing / 2 + 2.15));

                const wallL = new THREE.Mesh(this.geometries.viaductWall, this.materials.viaduct);
                wallL.position.copy(chunkGroup.worldToLocal(posL));
                wallL.position.y = localPos.y + 0.25;
                wallL.rotation.y = rotY;

                const wallR = new THREE.Mesh(this.geometries.viaductWall, this.materials.viaduct);
                wallR.position.copy(chunkGroup.worldToLocal(posR));
                wallR.position.y = localPos.y + 0.25;
                wallR.rotation.y = rotY;

                chunkGroup.add(wallL, wallR);

            } else if (subChunkType === 'at-grade') {
                if (isPlatform && spacing > 15.0) {
                    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                    
                    const bedL = new THREE.Mesh(this.geometries.ballastBed, ballastMat);
                    const posL = pos.clone().addScaledVector(normal, -spacing / 2);
                    bedL.position.copy(chunkGroup.worldToLocal(posL));
                    bedL.position.y = localPos.y - 0.375;
                    bedL.rotation.y = rotY;
                    bedL.scale.x = 3.2 / 10.0; // 3.2m wide

                    const bedR = new THREE.Mesh(this.geometries.ballastBed, ballastMat);
                    const posR = pos.clone().addScaledVector(normal, spacing / 2);
                    bedR.position.copy(chunkGroup.worldToLocal(posR));
                    bedR.position.y = localPos.y - 0.375;
                    bedR.rotation.y = rotY;
                    bedR.scale.x = 3.2 / 10.0; // 3.2m wide

                    chunkGroup.add(bedL, bedR);
                } else {
                    const bedMesh = new THREE.Mesh(this.geometries.ballastBed, ballastMat);
                    bedMesh.position.copy(localPos);
                    bedMesh.position.y = localPos.y - 0.375;
                    bedMesh.rotation.y = rotY;
                    bedMesh.scale.x = (spacing + 3.8) / 10.0;
                    chunkGroup.add(bedMesh);
                }

            } else if (subChunkType === 'shaft') {
                const W_shaft = spacing + 4.5;
                const H_wall = 0.15 - pos.y; // height of retaining wall
                const wallY = (pos.y - 0.85) / 2 - chunkGroupY; // vertical center of retaining wall relative to chunk
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

                // Left Retaining Wall
                const wallL = new THREE.Mesh(this.geometries.viaductWall, this.materials.viaduct);
                const posL_wall = pos.clone().addScaledVector(normal, -W_shaft / 2);
                wallL.position.copy(chunkGroup.worldToLocal(posL_wall));
                wallL.position.y = wallY;
                wallL.rotation.y = rotY;
                wallL.scale.set(1.0, H_wall, 1.0);

                // Right Retaining Wall
                const wallR = new THREE.Mesh(this.geometries.viaductWall, this.materials.viaduct);
                const posR_wall = pos.clone().addScaledVector(normal, W_shaft / 2);
                wallR.position.copy(chunkGroup.worldToLocal(posR_wall));
                wallR.position.y = wallY;
                wallR.rotation.y = rotY;
                wallR.scale.set(1.0, H_wall, 1.0);

                // Concrete Floor
                const floor = new THREE.Mesh(this.geometries.viaductBed, this.materials.viaduct);
                floor.position.copy(localPos);
                floor.position.y = localPos.y - 0.55;
                floor.rotation.y = rotY;
                floor.scale.set(W_shaft / 10.5, 0.2 / 0.5, 1.0);

                // Ballast Bed (inside the concrete floor)
                const ballastMesh = new THREE.Mesh(this.geometries.tunnelBallast, ballastMat);
                ballastMesh.position.copy(localPos);
                ballastMesh.position.y = localPos.y - 0.495; // Slightly higher than floor (which is at -0.55 top -0.30) to avoid z-fighting
                ballastMesh.rotation.y = rotY;
                ballastMesh.scale.x = (spacing + 4.2) / 10.4;

                chunkGroup.add(wallL, wallR, floor, ballastMesh);

            } else {
                // Underground tunnel ballast
                const ballastMesh = new THREE.Mesh(this.geometries.tunnelBallast, ballastMat);
                ballastMesh.position.copy(localPos);
                // Lower slightly in platform areas to avoid z-fighting with platform floor bottom (at -0.30)
                ballastMesh.position.y = localPos.y - (isPlatform ? 0.52 : 0.50);
                ballastMesh.rotation.y = rotY;
                ballastMesh.scale.x = (spacing + 4.2) / 10.4;
                chunkGroup.add(ballastMesh);
            }

            // Build Ground & Streets for open-air sub-segments
            if (subChunkType !== 'underground') {
                const groundY = -0.35;
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

                // Left background ground (width 450m, offset -280m, covers -505m to -55m)
                const posBgL = pos.clone().addScaledVector(normal, -280);
                const bgMeshL = new THREE.Mesh(this.geometries.bgGround, this.materials.bgGround);
                bgMeshL.position.copy(chunkGroup.worldToLocal(posBgL));
                bgMeshL.position.y = (groundY - 0.15) - chunkGroupY; // keep world Y flat at -0.5m
                bgMeshL.rotation.y = rotY;

                // Right background ground (width 450m, offset 280m, covers 55m to 505m)
                const posBgR = pos.clone().addScaledVector(normal, 280);
                const bgMeshR = new THREE.Mesh(this.geometries.bgGround, this.materials.bgGround);
                bgMeshR.position.copy(chunkGroup.worldToLocal(posBgR));
                bgMeshR.position.y = (groundY - 0.15) - chunkGroupY;
                bgMeshR.rotation.y = rotY;

                chunkGroup.add(bgMeshL, bgMeshR);

                // Open-cut shaft has split grass terrain to expose retaining walls
                if (subChunkType === 'shaft') {
                    const W_shaft = spacing + 4.5;
                    const W_ground = 60 - W_shaft / 2;

                    const posL = pos.clone().addScaledVector(normal, -(W_shaft / 2 + W_ground / 2));
                    const leftGround = new THREE.Mesh(this.geometries.ground, this.materials.ground);
                    leftGround.position.copy(chunkGroup.worldToLocal(posL));
                    leftGround.position.y = (groundY - 0.05) - chunkGroupY; // keep world Y flat at -0.4m
                    leftGround.rotation.y = rotY;
                    leftGround.scale.x = W_ground / 120;

                    const posR = pos.clone().addScaledVector(normal, (W_shaft / 2 + W_ground / 2));
                    const rightGround = new THREE.Mesh(this.geometries.ground, this.materials.ground);
                    rightGround.position.copy(chunkGroup.worldToLocal(posR));
                    rightGround.position.y = (groundY - 0.05) - chunkGroupY;
                    rightGround.rotation.y = rotY;
                    rightGround.scale.x = W_ground / 120;

                    chunkGroup.add(leftGround, rightGround);
                } else {
                    const groundMesh = new THREE.Mesh(this.geometries.ground, this.materials.ground);
                    groundMesh.position.copy(localPos);
                    groundMesh.position.y = (groundY - 0.05) - chunkGroupY;
                    groundMesh.rotation.y = rotY;
                    chunkGroup.add(groundMesh);
                }

                const posL = pos.clone().addScaledVector(normal, -18);
                const streetL = new THREE.Mesh(this.geometries.street, this.materials.street);
                streetL.position.copy(chunkGroup.worldToLocal(posL));
                streetL.position.y = groundY - chunkGroupY; // keep world Y flat at -0.35m
                streetL.rotation.y = rotY;

                const posR = pos.clone().addScaledVector(normal, 18);
                const streetR = new THREE.Mesh(this.geometries.street, this.materials.street);
                streetR.position.copy(chunkGroup.worldToLocal(posR));
                streetR.position.y = groundY - chunkGroupY;
                streetR.rotation.y = rotY;

                chunkGroup.add(streetL, streetR);
            }
        }

        // Add elevated pillars underneath the tracks
        if (chunkType === 'elevated' || chunkType === 'ramp') {
            this.createPillars(chunkGroup, startZ);
        }

        // Add tunnel lights (the bespoke Plärrer tubes carry their own lamps)
        if (chunkType === 'underground') {
            const lightSpacings = [6.25, 18.75, 31.25, 43.75];
            lightSpacings.forEach(ls => {
                if (this.sim.isPlaerrerZone(startZ + ls)) return;
                this.createTunnelLights(chunkGroup, startZ + ls);
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
        if (chunkType !== 'underground') {
            this.createCityEnvironment(chunkGroup, 0, chunkType, idx);
        }

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

    createTunnelLights(chunkGroup, s) {
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

        // Left Wall Lamp
        const fixtureL = new THREE.Mesh(this.geometries.tunnelFixture, this.materials.tunnelFixtureMat);
        fixtureL.position.copy(localL);
        fixtureL.position.y = localL.y + Y_lamp;
        fixtureL.rotation.set(0, angle, rotZ_L, 'YXZ');

        const glowL = new THREE.Mesh(this.geometries.tunnelGlow, this.materials.tunnelGlow);
        glowL.position.set(0, 0.041, 0);
        fixtureL.add(glowL);

        const haloL = new THREE.Mesh(this.geometries.tunnelHalo, this.materials.neonHaloMat);
        haloL.position.set(0, 0.005, 0); // slightly offset from the casing in local +Y (towards center of tunnel)
        fixtureL.add(haloL);

        chunkGroup.add(fixtureL);

        // Right Wall Lamp
        const fixtureR = new THREE.Mesh(this.geometries.tunnelFixture, this.materials.tunnelFixtureMat);
        fixtureR.position.copy(localR);
        fixtureR.position.y = localR.y + Y_lamp;
        fixtureR.rotation.set(0, angle, rotZ_R, 'YXZ');

        const glowR = new THREE.Mesh(this.geometries.tunnelGlow, this.materials.tunnelGlow);
        glowR.position.set(0, 0.041, 0);
        fixtureR.add(glowR);

        const haloR = new THREE.Mesh(this.geometries.tunnelHalo, this.materials.neonHaloMat);
        haloR.position.set(0, 0.005, 0); // slightly offset from the casing in local +Y (towards center of tunnel)
        fixtureR.add(haloR);

        chunkGroup.add(fixtureR);
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

        // 3. Create Cloud Planes
        for (let c = 0; c < 3; c++) {
            const seed = idx * 37 + c * 53;
            const rand1 = seedRandom(seed);
            const rand2 = seedRandom(seed + 1);
            const rand3 = seedRandom(seed + 2);

            const cloudWidth = 50 + rand1 * 40;
            const cloudLength = 30 + rand2 * 30;
            const cloudX = (rand1 - 0.5) * 120;
            const cloudY = 40 + rand2 * 15; // height between 40m and 55m
            const cloudZ = (rand3 - 0.5) * 50;

            const cloudMesh = new THREE.Mesh(this.geometries.cloud, this.materials.cloud);
            cloudMesh.position.set(cloudX, cloudY - chunkGroupY, cloudZ); // keep world Y flat
            cloudMesh.scale.set(cloudWidth / 50, cloudLength / 50, 1.0);
            cloudMesh.rotation.y = rand3 * Math.PI * 2;
            group.add(cloudMesh);
        }
    }

    createGrassTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2e5c1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const len = 2 + Math.random() * 3;
            const colorVal = Math.random();
            if (colorVal < 0.3) ctx.strokeStyle = '#244b16';
            else if (colorVal < 0.6) ctx.strokeStyle = '#3b7527';
            else ctx.strokeStyle = '#478f2f';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (Math.random() - 0.5) * 1.5, y - len);
            ctx.stroke();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(24, 2);
        return texture;
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

    createCloudTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const numCircles = 12;
        for (let i = 0; i < numCircles; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 40;
            const x = canvas.width / 2 + Math.cos(angle) * dist;
            const y = canvas.height / 2 + Math.sin(angle) * dist;
            const radius = 25 + Math.random() * 25;
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }
}
