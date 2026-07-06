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

            // Far-distance backdrop (Kulisse), ~200m beyond the outer tracks: flat, alpha-cut
            // billboards, unlit (MeshBasicMaterial = cheapest shading) and DoubleSide since the
            // route runs both directions past them. Texture is near-white/neutral so the
            // per-instance color (set via InstancedMesh.setColorAt) supplies all the actual
            // color/height variation with a single shared draw call per type.
            treeLaubBillboard: new THREE.MeshBasicMaterial({
                map: this.createTreeBillboardTexture(false),
                alphaTest: 0.5,
                side: THREE.DoubleSide
            }),
            treeNadelBillboard: new THREE.MeshBasicMaterial({
                map: this.createTreeBillboardTexture(true),
                alphaTest: 0.5,
                side: THREE.DoubleSide
            }),

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

            // Far-distance backdrop billboard: unit plane, base edge at local y=0 so per-instance
            // scale.y directly becomes the tree/building height standing on the ground.
            billboard: new THREE.PlaneGeometry(1, 1),

            // Ground (clouds are now part of WorldManager's sky-photo background)
            ground: new THREE.PlaneGeometry(120, 10.0), // Overlapped to prevent curve seams (10m instead of 5m)
            bgGround: new THREE.PlaneGeometry(450, 25.0) // Overlapped to prevent curve seams (25m instead of 5m)
        };

        // Align geometries
        this.geometries.tunnelWall.rotateX(Math.PI / 2);

        this.geometries.treeTrunk.translate(0, 1.75, 0);
        this.geometries.billboard.translate(0, 0.5, 0);
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

        // Distant backdrop scenery (trees/buildings) only depends on the static TrackData
        // route, so it can be built once right here instead of waiting on main.js.
        this.buildTrackScenery();
    }

    // Behelfs-Kulisse: flat billboard trees standing in a band ~200m beyond the outer
    // tracks, for the whole route. Built once as 2 InstancedMeshes total (one draw call
    // per species) - never rebuilt, never updated per frame - so despite covering all
    // ~18.5km of route this costs only a few thousand extra triangles overall.
    buildTrackScenery() {
        const sim = this.sim;
        const total = sim.totalLength;
        const step = 5; // candidate slot spacing per side (m)
        const placeChance = 0.88; // leaves natural gaps instead of a solid tree wall

        const laubM = [], laubC = [];
        const nadelM = [], nadelC = [];

        const pos = new THREE.Vector3();
        const tan = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const faceDir = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        const axisY = new THREE.Vector3(0, 1, 0);

        for (let d = 0; d < total; d += step) {
            const chunkType = sim.getChunkType(d);
            if (chunkType === 'underground' || chunkType === 'shaft') continue; // no open sky here

            sim.getTrackPosition(d, pos);
            sim.getTrackTangent(d, tan);
            nrm.set(-tan.z, 0, tan.x);
            const clearance = sim.getTrackSpacing(d) / 2 + 5; // past the outer rail/ballast

            for (const side of [-1, 1]) {
                if (Math.random() > placeChance) continue;

                const lateral = clearance + 200 + Math.random() * 70; // 200-270 m band
                const along = (Math.random() - 0.5) * step;
                const p = pos.clone()
                    .addScaledVector(nrm, side * lateral)
                    .addScaledVector(tan, along);
                p.y = 0;

                faceDir.copy(nrm).multiplyScalar(-side); // billboard faces back toward the track
                quat.setFromAxisAngle(axisY, Math.atan2(faceDir.x, faceDir.z));

                const brightness = 0.85 + Math.random() * 0.3;
                if (Math.random() < 0.55) {
                    // Laubbaum (deciduous)
                    const h = 5 + Math.random() * 11, w = h * (0.55 + Math.random() * 0.25);
                    scl.set(w, h, 1);
                    laubM.push(new THREE.Matrix4().compose(p, quat, scl));
                    laubC.push(new THREE.Color(brightness, brightness, brightness));
                } else {
                    // Nadelbaum (conifer)
                    const h = 6 + Math.random() * 13, w = h * (0.4 + Math.random() * 0.2);
                    scl.set(w, h, 1);
                    nadelM.push(new THREE.Matrix4().compose(p, quat, scl));
                    nadelC.push(new THREE.Color(brightness, brightness, brightness));
                }
            }
        }

        const addBillboards = (mats, colors, material) => {
            if (!mats.length) return;
            const im = new THREE.InstancedMesh(this.geometries.billboard, material, mats.length);
            for (let i = 0; i < mats.length; i++) {
                im.setMatrixAt(i, mats[i]);
                im.setColorAt(i, colors[i]);
            }
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
            im.computeBoundingSphere();
            this.scene.add(im);
        };

        addBillboards(laubM, laubC, this.materials.treeLaubBillboard);
        addBillboards(nadelM, nadelC, this.materials.treeNadelBillboard);
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
        const LOWER_CLEAR = 3.75;                    // lower ceiling clearance
        const HALL_H = 12.0;                          // upper vault height (m) - coved arch peak
        const ESC_HALF = 9.0;                         // escalator shaft half-length along Z
        const ESC_X0 = -11.75, ESC_X1 = -6.25;       // escalator band in X
        const WALL_X = -21.0;                        // outer station wall
        const HALL_FAR = WALL_X;
        const HALL_NEAR = 3.0;

        // Reuse the existing station floor textures for both decks.
        const lowerFloorMats = stationModel.getPlatformMaterials(p, LOWER_W, false, false);
        const upperFloorMats = stationModel.getPlatformMaterials(p, UPPER_W, false, false);
        const stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const tactileMat = new THREE.MeshLambertMaterial({ color: '#1d201f' });
        const recessMat = new THREE.MeshLambertMaterial({ color: '#7a8088', side: THREE.DoubleSide });
        const skyMat = new THREE.MeshBasicMaterial({ color: '#9bc8eb' });

        // ---------- PROCEDURAL CUSTOM TEXTURES ----------
        // 1. Concrete texture for vault panels (Upper Level)
        const createPlaerrerConcreteTexture = () => {
            const w = 512, h = 512;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            
            // Light grey base concrete
            ctx.fillStyle = '#b8c0c8';
            ctx.fillRect(0, 0, w, h);
            
            // Add subtle grainy noise
            for (let i = 0; i < 8000; i++) {
                const val = Math.floor(Math.random() * 16 - 8);
                const r = 184 + val, g = 192 + val, b = 200 + val;
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
            }
            
            // Draw panel joints (concrete seams)
            ctx.strokeStyle = '#9ea6ae';
            ctx.lineWidth = 1.5;
            for (let x = 0; x < w; x += 128) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            }
            for (let y = 0; y < h; y += 128) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
            
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.anisotropy = 8;
            return tex;
        };

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

        const hallVaultMat = new THREE.MeshLambertMaterial({ map: createPlaerrerConcreteTexture(), side: THREE.DoubleSide });
        hallVaultMat.map.repeat.set(10 / 2, 32 / 2); // 2m x 2m concrete panels

        // framed-stair / escalator textures
        const sb = new StationBuilder(stationModel, p);
        const concreteMat = sb.createRoughConcreteMaterial();
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
        const platSegLen = 1.0;
        const buildDeck = (dm, j2, trackSign, width, mats, baseY, openHalf) => {
            const f = frameAt(dm);
            const edgeX = trackSign * sp(dm) / 2 - EDGE_GAP;
            const outerX = edgeX - width;

            const addBox = (xStart, xEnd) => {
                const w = Math.abs(xEnd - xStart);
                if (w < 0.01) return;
                const cx = (xStart + xEnd) / 2;
                const geom = new THREE.BoxGeometry(w, platHeight, platSegLen);
                stationModel.adjustPlatformUVs(geom, j2, platSegLen, 1.2);
                const ctr = f.c.clone().addScaledVector(f.nrm, cx);
                const deck = new THREE.Mesh(geom, mats);
                deck.position.set(ctr.x, baseY + platCenterY, ctr.z); deck.rotation.y = f.rotY;
                group.add(deck);
            };

            const inEscZone = openHalf && Math.abs(dm - P) < openHalf;
            if (inEscZone) {
                const holeMin = Math.min(ESC_X0, ESC_X1);
                const holeMax = Math.max(ESC_X0, ESC_X1);
                if (trackSign > 0) {
                    addBox(edgeX, holeMax);
                    addBox(holeMin, outerX);
                } else {
                    addBox(edgeX, outerX);
                }
            } else {
                addBox(edgeX, outerX);
            }

            const e1 = f.c.clone().addScaledVector(f.nrm, edgeX - 0.08);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, platSegLen), stripMat);
            strip.position.set(e1.x, baseY + platTopY + 0.012, e1.z); strip.rotation.y = f.rotY; group.add(strip);
            const e2 = f.c.clone().addScaledVector(f.nrm, edgeX - 0.45);
            const tactile = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, platSegLen), tactileMat);
            tactile.position.set(e2.x, baseY + platTopY + 0.012, e2.z); tactile.rotation.y = f.rotY; group.add(tactile);
            // outer safety stripe
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

            // 2. Stairs in the middle
            const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
            for (let i = 0; i < numSteps; i++) {
                const step = new THREE.Mesh(stairGeom, stepMat);
                step.position.set(
                    0.0,
                    i * stepHeight + stepHeight / 2 - Math.abs(targetFloorY - baseFloorY) / 2,
                    -zSign * (escHalf - (i * stepDepth + stepDepth / 2))
                );
                escGroup.add(step);
            }

            // 3. Double Escalators (with steps, escalator textures)
            const escWidth = 1.1;
            const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);
            
            const escL = new THREE.Mesh(escRampGeom, escStepMat);
            escL.position.set(-escOffset, -0.15, 0); escL.rotation.x = rotX;
            
            const escR = new THREE.Mesh(escRampGeom, escStepMat);
            escR.position.set(escOffset, -0.15, 0); escR.rotation.x = rotX;
            escGroup.add(escL, escR);

            // Escalator steps
            const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
            for (let i = 0; i < numSteps; i++) {
                const sy = i * stepHeight + stepHeight / 2 - Math.abs(targetFloorY - baseFloorY) / 2;
                const sz = -zSign * (escHalf - (i * stepDepth + stepDepth / 2));

                const stepL = new THREE.Mesh(escStepGeom, escStepMat);
                stepL.position.set(-escOffset, sy, sz); escGroup.add(stepL);

                const stepR = new THREE.Mesh(escStepGeom, escStepMat);
                stepR.position.set(escOffset, sy, sz); escGroup.add(stepR);
            }

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
        
        // Build north wide escalator/stair bank (connecting the upper platform at P - platHalf to the mezzanine level above, going north out of the station)
        const fTopN = frameAt(P - platHalf);
        const topYN = fTopN.c.y + platTopY;
        const mezzanineHeight = 5.0;
        // Use escHalf = 4.33 (for a realistic steep 30-degree slope) and shift south by 15cm (center at P - platHalf - 4.18) to overlap and eliminate the gap
        buildEscalatorBank(P - platHalf - 4.18, 5.5, 8.0, 4.55, -1, topYN, topYN + mezzanineHeight, 4.33);

        // ---------- LOWER platform enclosure (Flat vertical walls & horizontal ceiling) ----------
        const lBaseY = sim.getTrackPosition(P).y + dive(P);
        const lowerFar = WALL_X; // -21.0
        const lowerNear = 0.7;
        const lowerW = lowerNear - lowerFar; // 21.7
        const lowerH = LOWER_CLEAR + platTopY; // 4.615
        
        // Wall and ceiling profiles in absolute lateral coordinates
        const lowerWallProfile = [{ x: lowerFar, y: 0 }, { x: lowerFar, y: lowerH }];
        const lowerCeilProfile = [{ x: lowerFar, y: lowerH }, { x: lowerNear, y: lowerH }];
        const lowerCeilLeftProfile = [{ x: lowerFar, y: lowerH }, { x: ESC_X0, y: lowerH }];
        const lowerCeilRightProfile = [{ x: ESC_X1, y: lowerH }, { x: lowerNear, y: lowerH }];

        const lowerWallMat = new THREE.MeshLambertMaterial({ map: createLowerWallTexture(), side: THREE.DoubleSide });
        const lowerCeilMat = new THREE.MeshLambertMaterial({ color: '#bfc4cc', side: THREE.DoubleSide });
        
        const lowerTileMat = lowerWallMat;
        const plainCreamTileMat = new THREE.MeshLambertMaterial({ map: createPlainCreamTileTexture(), side: THREE.DoubleSide });
        plainCreamTileMat.map.repeat.set(12, 6);
        const endWallLowerMat = plainCreamTileMat;

        // Sweep Zone 1: P - platHalf to P - ESC_HALF (solid lower ceiling)
        stationModel.buildSweptProfile(group, P - platHalf, P - ESC_HALF, lowerWallProfile, lBaseY, () => 0, lowerWallMat, 6);
        stationModel.buildSweptProfile(group, P - platHalf, P - ESC_HALF, lowerCeilProfile, lBaseY, () => 0, lowerCeilMat, 10);

        // Sweep Zone 2: P - ESC_HALF to P + ESC_HALF (center escalator opening)
        stationModel.buildSweptProfile(group, P - ESC_HALF, P + ESC_HALF, lowerWallProfile, lBaseY, () => 0, lowerWallMat, 6);
        stationModel.buildSweptProfile(group, P - ESC_HALF, P + ESC_HALF, lowerCeilLeftProfile, lBaseY, () => 0, lowerCeilMat, 10);
        stationModel.buildSweptProfile(group, P - ESC_HALF, P + ESC_HALF, lowerCeilRightProfile, lBaseY, () => 0, lowerCeilMat, 10);

        // Sweep Zone 3: P + ESC_HALF to P + platHalf (solid lower ceiling)
        stationModel.buildSweptProfile(group, P + ESC_HALF, P + platHalf, lowerWallProfile, lBaseY, () => 0, lowerWallMat, 6);
        stationModel.buildSweptProfile(group, P + ESC_HALF, P + platHalf, lowerCeilProfile, lBaseY, () => 0, lowerCeilMat, 10);

        // ---------- UPPER distribution HALL (Flat ceiling & vertical walls) ----------
        const hallFar = WALL_X; // -21.0
        const hallNear = 3.0;
        const hallW = hallNear - hallFar; // 24.0
        const hallXc = (hallFar + hallNear) / 2; // -9.0
        const hallHeight = 12.0; // flat ceiling height matching the previous vault peak

        // Rectangular cross-section profile for a completely flat ceiling
        const hallProfile = [
            { x: hallFar, y: 0 },
            { x: hallFar, y: hallHeight },
            { x: hallNear, y: hallHeight },
            { x: hallNear, y: 0 }
        ];

        // Sweep the solid upper rectangular ceiling along the entire platform length
        stationModel.buildSweptProfile(group, P - platHalf, P + platHalf, hallProfile, floorY, () => 0, hallVaultMat, 10);

        // Helper to query vault/ceiling height at any X coordinate (always flat 12m now)
        const getVaultHeight = (x) => hallHeight;

        const hallWallMat = hallVaultMat;
        const endWallUpperMat = new THREE.MeshLambertMaterial({ color: '#b8c0c8', side: THREE.DoubleSide });

        // ---------- COLUMNS (Segmented silver pillars on both levels) ----------
        const colMat = new THREE.MeshLambertMaterial({ color: '#b4bac2' }); // Brushed steel silver
        const colRingGeom = new THREE.CylinderGeometry(0.51, 0.51, 0.04, 16);
        const colRingMat = new THREE.MeshLambertMaterial({ color: '#2d3035' }); // Dark steel joints

        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const lFloorY = f.c.y + dive(d) + platTopY;

            for (const cx of [-4.5, -13.5]) {
                const cp = f.c.clone().addScaledVector(f.nrm, cx);

                // A. Upper columns (adjusted height to perfectly match curved ceiling vault)
                const uColH = getVaultHeight(cx);
                const uCol = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, uColH, 16), colMat);
                uCol.position.set(cp.x, uFloorY + uColH / 2, cp.z);
                group.add(uCol);

                // Add dark segment joint rings to upper columns
                for (let y = 2.4; y < uColH - 0.5; y += 2.4) {
                    const ring = new THREE.Mesh(colRingGeom, colRingMat);
                    ring.position.set(cp.x, uFloorY + y, cp.z);
                    group.add(ring);
                }

                // B. Lower columns (joining lower floor and lower ceiling)
                const lCol = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, LOWER_CLEAR, 16), colMat);
                lCol.position.set(cp.x, lFloorY + LOWER_CLEAR / 2, cp.z);
                group.add(lCol);

                // Add dark segment joint rings to lower columns
                for (let y = 1.2; y < LOWER_CLEAR - 0.3; y += 1.2) {
                    const ring = new THREE.Mesh(colRingGeom, colRingMat);
                    ring.position.set(cp.x, lFloorY + y, cp.z);
                    group.add(ring);
                }
            }
        }

        // ---------- LIGHTS & SKYLIGHTS ----------
        // 1. Upper Level Skylights (Recessed flat rings on the flat ceiling, rotated to face track direction)
        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const sc = f.c.clone().addScaledVector(f.nrm, -9.0);
            const skylightY = uFloorY + hallHeight;

            // Recessed flat rings with a diameter close to the column distance (approx 8m diameter / 4m radius)
            const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 4.0, 64), recessMat);
            ring.position.set(sc.x, skylightY - 0.01, sc.z);
            ring.rotation.set(Math.PI / 2, 0, f.rotY);
            group.add(ring);
            
            const disk = new THREE.Mesh(new THREE.CircleGeometry(3.8, 64), skyMat);
            disk.position.set(sc.x, skylightY - 0.02, sc.z);
            disk.rotation.set(Math.PI / 2, 0, f.rotY);
            group.add(disk);
        }

        // 2. Lower Level lights (Recessed flat rings matching the upper skylight locations on the flat ceiling)
        const lightX = -9.0;
        for (let d = P - platHalf; d < P + platHalf - 0.1; d += segLen) {
            const dm = d + segLen / 2;
            if (Math.abs(dm - P) < ESC_HALF) continue; // Skip escalator shaft

            if (Math.round((dm - P) / segLen) % 2 === 0) {
                const f = frameAt(dm);
                const lc = f.c.clone().addScaledVector(f.nrm, lightX);
                const lCeilY = f.c.y + dive(dm) + lowerH;

                const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 18), recessMat);
                ring.position.set(lc.x, lCeilY - 0.02, lc.z); ring.rotation.x = Math.PI / 2; group.add(ring);
                const disk = new THREE.Mesh(new THREE.CircleGeometry(0.45, 18), skyMat);
                disk.position.set(lc.x, lCeilY - 0.03, lc.z); disk.rotation.x = Math.PI / 2; group.add(disk);
            }
        }

        // ---------- PLATFORM ACCESSORIES & FURNISHING ----------
        const trashBodyGeom = new THREE.BoxGeometry(0.25, 0.45, 0.25);
        const trashLidGeom = new THREE.BoxGeometry(0.26, 0.04, 0.26);
        const trashOrangeMat = new THREE.MeshLambertMaterial({ color: '#f97316' }); // Nuremberg Orange

        // 1. Column-Mounted Trash Cans
        for (let d = P - platHalf + 6; d < P + platHalf - 1; d += 12) {
            const f = frameAt(d);
            const uFloorY = f.c.y + platTopY;
            const lFloorY = f.c.y + dive(d) + platTopY;

            for (const cx of [-4.5, -13.5]) {
                const cp = f.c.clone().addScaledVector(f.nrm, cx);
                const facingSign = (cx === -4.5) ? 1 : -1; // Face outward from column center
                const colRadius = 0.5 + 0.125; // column radius + half-thickness of trash can

                // A. Upper Level Trash Can
                const utx = cp.x + facingSign * colRadius;
                const uty = uFloorY + 0.8;
                const uBody = new THREE.Mesh(trashBodyGeom, trashOrangeMat);
                uBody.position.set(utx, uty, cp.z); group.add(uBody);
                const uLid = new THREE.Mesh(trashLidGeom, colRingMat);
                uLid.position.set(utx, uty + 0.245, cp.z); group.add(uLid);

                // B. Lower Level Trash Can
                const ltx = cp.x + facingSign * colRadius;
                const lty = lFloorY + 0.8;
                const lBody = new THREE.Mesh(trashBodyGeom, trashOrangeMat);
                lBody.position.set(ltx, lty, cp.z); group.add(lBody);
                const lLid = new THREE.Mesh(trashLidGeom, colRingMat);
                lLid.position.set(ltx, lty + 0.245, cp.z); group.add(lLid);
            }
        }

        // 2. Back-to-Back Red Wire Mesh Benches & Snack Vending Machines
        const benchPipeGeom = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8).rotateX(Math.PI / 2);
        const benchLegGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8);
        const seatBaseGeom = new THREE.BoxGeometry(0.45, 0.03, 0.4);
        const seatBackGeom = new THREE.BoxGeometry(0.03, 0.4, 0.4);
        const benchRedMat = new THREE.MeshLambertMaterial({ color: '#dc2626' }); // Vibrant red mesh color

        const addBench = (bz, levelFloorY) => {
            const bx = -9.0;
            const f = frameAt(bz);
            const benchGroup = new THREE.Group();
            benchGroup.position.set(f.c.x + f.nrm.x * bx, levelFloorY, f.c.z + f.nrm.z * bx);
            benchGroup.rotation.y = f.rotY;

            // Horizontal support pipe
            const pipe = new THREE.Mesh(benchPipeGeom, benchRedMat);
            pipe.position.set(0, 0.45, 0); benchGroup.add(pipe);

            // Legs
            const leg1 = new THREE.Mesh(benchLegGeom, benchRedMat);
            leg1.position.set(0, 0.225, -0.9); benchGroup.add(leg1);
            const leg2 = new THREE.Mesh(benchLegGeom, benchRedMat);
            leg2.position.set(0, 0.225, 0.9); benchGroup.add(leg2);

            // 4 back-to-back seats
            const zOffsets = [-0.75, -0.25, 0.25, 0.75];
            for (const zo of zOffsets) {
                // Side 1 (facing right)
                const seat1 = new THREE.Mesh(seatBaseGeom, benchRedMat);
                seat1.position.set(0.25, 0.47, zo); benchGroup.add(seat1);
                const back1 = new THREE.Mesh(seatBackGeom, benchRedMat);
                back1.position.set(0.04, 0.67, zo); back1.rotation.z = -0.15; benchGroup.add(back1);

                // Side 2 (facing left)
                const seat2 = new THREE.Mesh(seatBaseGeom, benchRedMat);
                seat2.position.set(-0.25, 0.47, zo); benchGroup.add(seat2);
                const back2 = new THREE.Mesh(seatBackGeom, benchRedMat);
                back2.position.set(-0.04, 0.67, zo); back2.rotation.z = 0.15; benchGroup.add(back2);
            }
            group.add(benchGroup);
        };

        const addVendingMachine = (vz, levelFloorY) => {
            const vx = -9.0;
            const f = frameAt(vz);
            const vmGroup = new THREE.Group();
            vmGroup.position.set(f.c.x + f.nrm.x * vx, levelFloorY, f.c.z + f.nrm.z * vx);
            vmGroup.rotation.y = f.rotY;

            const cabMat = new THREE.MeshLambertMaterial({ color: '#3f4448' });

            // 1. Back support body (Z = -0.05, depth 0.65, front at Z = 0.275)
            const cabBack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.65), cabMat);
            cabBack.position.set(0, 1.1, -0.05); vmGroup.add(cabBack);

            // 2. Window recess back panel (Z = 0.28, depth 0.02, front at Z = 0.29)
            const recess = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.5, 0.02), new THREE.MeshLambertMaterial({ color: '#111215' }));
            recess.position.set(0, 1.1, 0.28); vmGroup.add(recess);

            // 3. Colorful shelves snack boxes (Z = 0.32, depth 0.05, front at Z = 0.345)
            const colors = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa'];
            for (let r2 = 0; r2 < 4; r2++) {
                const ry = 0.52 + r2 * 0.36;
                for (let c2 = 0; c2 < 4; c2++) {
                    const rx = -0.33 + c2 * 0.22;
                    const item = new THREE.Mesh(
                        new THREE.BoxGeometry(0.12, 0.16, 0.05),
                        new THREE.MeshBasicMaterial({ color: colors[(r2 + c2) % colors.length] })
                    );
                    item.position.set(rx, ry, 0.32); vmGroup.add(item);
                }
            }

            // 4. Glass shield (Z = 0.36, depth 0.01, front at Z = 0.365)
            const glass = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.5, 0.01), glassMat);
            glass.position.set(0, 1.1, 0.36); vmGroup.add(glass);

            // 5. Border frame parts (depth 0.12, centered at Z = 0.335 -> back at 0.275, front at 0.395)
            const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.5, 0.12), cabMat);
            leftFrame.position.set(-0.5125, 1.1, 0.335); vmGroup.add(leftFrame);

            const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.5, 0.12), cabMat);
            rightFrame.position.set(0.5125, 1.1, 0.335); vmGroup.add(rightFrame);

            const bottomFrame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.12), cabMat);
            bottomFrame.position.set(0, 0.175, 0.335); vmGroup.add(bottomFrame);

            const topFrame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.12), cabMat);
            topFrame.position.set(0, 2.025, 0.335); vmGroup.add(topFrame);

            // 6. Backlit top header panel (blue) (Z = 0.40, depth 0.01, front at Z = 0.405)
            const header = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.25, 0.01), new THREE.MeshBasicMaterial({ color: '#0284c7' }));
            header.position.set(0, 2.025, 0.40); vmGroup.add(header);

            group.add(vmGroup);
        };

        // Distribute elements along the platforms (both levels) at midpoints between columns
        // Column midpoints are: P - 36, P - 24, P - 12, P, P + 12, P + 24, P + 36
        const midPoints = [-36, -24, -12, 0, 12, 24, 36];
        for (const offset of midPoints) {
            const zPos = P + offset;
            const uFloor = sim.getTrackPosition(zPos).y + platTopY;
            const lFloor = sim.getTrackPosition(zPos).y + dive(zPos) + platTopY;

            // Skip escalator zones for vending machines/benches (central and north wide banks)
            if (Math.abs(offset) < ESC_HALF + 2.0 || (offset > -platHalf - 2.0 && offset < -platHalf + 20.0)) continue;

            if (offset === -24 || offset === 24) {
                addVendingMachine(zPos, uFloor);
                addVendingMachine(zPos, lFloor);
            } else {
                addBench(zPos, uFloor);
                addBench(zPos, lFloor);
            }
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
            mesh.rotation.y = f.rotY;
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
            
            // Draw upper opposite mock tube only at the south end (sign === 1)
            // since the north end has the wide escalator bank going up to the mezzanine!
            if (sign === 1) {
                renderTube(d => sp(d) / 2 - 18.08, () => 0, oppR0, oppR1);     // upper opposite
            }
            renderTube(d => -sp(d) / 2 - 18.08, dive, oppR0, oppR1);        // lower opposite

            const baseYi = sim.getTrackPosition(inner).y;

            // Upper portals
            buildEndWall(inner, sp(inner) / 2, baseYi + 0.8, endWallUpperMat,
                         -9.3, 3.8, -3.8, hallHeight + 0.07);          // right upper end wall (running track)
            
            if (sign === 1) {
                // South end: draw left upper end wall with opposite track hole (covers -21.0 to 0.26 absolute)
                buildEndWall(inner, sp(inner) / 2 - 18.08, baseYi + 0.8, endWallUpperMat,
                             -12.0, 9.3, -3.8, hallHeight + 0.07);
            } else {
                // North end: draw solid left/right walls flanking the escalator bank to close off the station
                buildEndWall(inner, -17.75, baseYi + 0.8, endWallUpperMat,
                             -3.25, 3.25, -3.8, hallHeight + 0.07, true); // left gap wall (covers -21.0 to -14.5)
                buildEndWall(inner, -1.88, baseYi + 0.8, endWallUpperMat,
                             -1.62, 1.62, -3.8, hallHeight + 0.07, true); // right gap wall (covers -3.5 to -0.26)
            }

            // Lower portals (Split into 2 panels, each with a tube hole)
            buildEndWall(inner, -sp(inner) / 2, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         -9.3, 3.8, -3.8, LOWER_CLEAR + platTopY - 0.85);        // right lower end wall (running track)
            buildEndWall(inner, -sp(inner) / 2 - 18.08, baseYi + dive(inner) + 0.8, endWallLowerMat,
                         -12.0, 9.3, -3.8, LOWER_CLEAR + platTopY - 0.85);        // left lower end wall (opposite track - covers -21.0 to 0.26 absolute)
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

    // Alpha-cut billboard silhouette for the distant tree backdrop. Transparent background,
    // trunk baked brown, foliage baked in a natural mid-tone so the per-instance brightness
    // multiply (see buildTrackScenery) still reads as green, never shifts hue oddly.
    createTreeBillboardTexture(needle) {
        const w = 96, h = 128;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = '#5a3d1e';
        ctx.fillRect(w / 2 - 4, h - 26, 8, 26);

        if (needle) {
            // Nadelbaum: stacked tapering triangles (fir/spruce silhouette)
            ctx.fillStyle = '#1f4d33';
            const tiers = 4;
            for (let i = 0; i < tiers; i++) {
                const t = i / (tiers - 1);
                const yTop = 6 + t * 46;
                const yBase = yTop + 46;
                const halfW = (w * 0.5) * (0.35 + 0.65 * t);
                ctx.beginPath();
                ctx.moveTo(w / 2, yTop);
                ctx.lineTo(w / 2 - halfW, yBase);
                ctx.lineTo(w / 2 + halfW, yBase);
                ctx.closePath();
                ctx.fill();
            }
        } else {
            // Laubbaum: irregular round canopy from overlapping blobs
            ctx.fillStyle = '#3f7d52';
            const cx = w / 2, cy = 46;
            const blobs = [[0, 0, 30], [-20, 10, 22], [20, 8, 24], [-8, -18, 20], [12, -16, 22], [0, 18, 26]];
            for (const [ox, oy, r] of blobs) {
                ctx.beginPath();
                ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        return new THREE.CanvasTexture(canvas);
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
