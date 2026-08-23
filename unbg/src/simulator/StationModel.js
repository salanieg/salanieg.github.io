// ============================================================================
// StationModel.js — Baut und verwaltet ALLE Stationsbauwerke EINER Linie
// (Bahnsteige, Wände, Treppen, Rolltreppen, Schilder, Mülleimer, Passagiere).
//
// KI-LANDKARTE (wo bearbeite ich was):
//   - Bau-Pipeline: buildNextStation/buildAllStations -> buildStation(station)
//     (die Riesen-Methode mit der komplette Stationsarchitektur; Spezialfälle
//     Rathaus/Lorenzkirche delegieren an eigene Builder-Klassen).
//   - Sichtbarkeit: update(trainZ) hängt fertige Gruppen entfernungsbasiert
//     in die/aus der Szene (stationCullDist pro Station).
//   - Gekrümmte Bahnsteig-/Wand-Meshes: buildSweptBar/buildSweptWall/
//     buildSweptProfile (EIN durchgehendes BufferGeometry statt 5m-Kisten;
//     buildSweptWall: U-Mapping beachten, s. Spiegel-Text-Bugfix).
//   - Stationsspezifische Materialien (Fliesen, Schriftzüge, Kunstwerke):
//     get<Stationsname>*Mat()-Methoden am Dateiende.
//   - Abfahrtstafeln: createDepartureBoardMaterial; Liniensignets/Beschilderung:
//     createStationSignMaterial/createWallStripeMaterial.
//   - Bahnsteig-Passagiere (statisch): spawnPassengersForStation +
//     people/PassengerData.js (Namen/Items) + people/PassengerBuilder.js.
//   - Rolltreppen: Geometrie createEscalatorGeometries (oben), Animation im
//     Vertex-Shader (StationBuilder.setupEscalatorMaterial), Registrierung
//     für Sound in registerEscalator.
// KOORDINATEN: Stationsgruppe steht am Welt-Punkt des Stationszentrums,
// gedreht auf die Gleistangente; 1 Einheit = 1 m.
// WICHTIG: ?v=-Versionen der TrackData-Importe müssen mit main.js
// übereinstimmen, sonst lädt der Browser die Daten doppelt.
// ============================================================================
import * as THREE from 'three';
import { StationBuilder } from './stations/StationBuilder.js?v=69';
import { RathausBuilder } from './stations/RathausBuilder.js?v=51';
import { LorenzkircheBuilder } from './stations/LorenzkircheBuilder.js?v=49';
import { PassengerBuilder } from './people/PassengerBuilder.js';
import { PASSENGER_DATA } from './people/PassengerData.js';
import { tagCanvasTextureSRGBKeepLook } from './TextureUtils.js';
import { TrainModel } from './TrainModel.js?v=88';
import { TRACK_DATA as TRACK_DATA_U1 } from './TrackDataU1.js?v=55';
import { TRACK_DATA_U2 } from './TrackDataU2.js?v=11';
import { TRACK_DATA_U3 } from './TrackDataU3.js?v=11';

// Mixes a hex color toward white by `amount` (0..1). Used to brighten the
// platform floor tile texture itself, independent of scene ambient light,
// since underground platforms only get ambient (no directional lighting) and
// looked too dark with the tile colors' true (unlit-reference) values.
function lightenHex(hex, amount) {
    const c = new THREE.Color(hex);
    c.lerp(new THREE.Color(0xffffff), amount);
    return `#${c.getHexString()}`;
}

function createEscalatorGeometries(rampLength, thickness, height, railWidth, railHeight) {
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
}

function getUpcomingViaText(lineId, stationName, direction) {
    let trackData;
    if (lineId === 'U2') {
        trackData = TRACK_DATA_U2;
    } else if (lineId === 'U3') {
        trackData = TRACK_DATA_U3;
    } else if (lineId === 'U1') {
        trackData = TRACK_DATA_U1;
    }

    if (!trackData) return "";

    const stations = trackData.stations;
    const currIdx = stations.findIndex(s => s.name === stationName);
    if (currIdx === -1) return "";

    let upcoming = [];
    if (direction === 'forward') {
        for (let i = currIdx + 1; i < stations.length; i++) {
            upcoming.push(stations[i].name);
        }
    } else {
        for (let i = currIdx - 1; i >= 0; i--) {
            upcoming.push(stations[i].name);
        }
    }

    if (upcoming.length <= 1) {
        return ""; // Only destination remains or none
    }

    // Exclude the destination itself
    const intermediate = upcoming.slice(0, -1);
    if (intermediate.length === 0) {
        return "";
    }

    const nextTwo = intermediate.slice(0, 2);

    const displayName = name => {
        if (name === "Hauptbahnhof") return "Hbf.";
        if (name === "Grossreuth bei Schweinau") return "Grossreuth";
        if (name === "Gustav-Adolf-Straße") return "Gustav-Adolf-Str.";
        if (name === "Friedrich-Ebert-Platz") return "Friedrich-Ebert-Pl.";
        if (name === "Rothenburger Straße") return "Rothenburger Str.";
        if (name === "Bauernfeindstraße") return "Bauernfeindstr.";
        if (name === "Gemeinschaftshaus") return "Gemeinschaftsh.";
        return name;
    };

    return "über " + nextTwo.map(displayName).join(" - ");
}

export class StationModel {
    constructor(scene, simulation, options = {}) {
        this.scene = scene;
        this.sim = simulation;
        this.userData = {}; // For hooks and shared data

        // Culling configuration
        this.loadedStations = new Map(); // stationIndex -> boolean (is in scene)
        this.escalatorTime = 0;
        // Per-station culling distance by structural type: in the tunnel the view fades to
        // black within ~200m, so keeping underground stations resident 2km out only meant
        // 5-6 full station groups in the scene at once. Surface/elevated stations stay
        // visible much further along the open line, so they keep a generous distance.
        this.stationCullDist = this.sim.stations.map(st =>
            this.sim.getChunkType(st.position) === 'underground' ? 600 : 1300);
        this.platformMaterialsCache = new Map();
        
        // Shared materials
        this.materials = {
            platform: new THREE.MeshLambertMaterial({ color: '#888888' }), // concrete platform
            edgeStrip: new THREE.MeshLambertMaterial({ color: '#ffffff' }), // white safety stripe
            ceiling: new THREE.MeshLambertMaterial({ color: '#555555' }),
            bench: new THREE.MeshLambertMaterial({ color: '#4a2f13' }), // wooden benches
            pillar: new THREE.MeshLambertMaterial({ color: '#7f8c8d' }),
            passenger: new THREE.MeshLambertMaterial({ color: '#9c27b0' }), // colorful figures
            lightTube: new THREE.MeshBasicMaterial({ color: 0xffffff }), // shared emissive light tubes
            signEdge: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
            boardCasing: new THREE.MeshLambertMaterial({ color: '#d2d7db' }),
            boardHanger: new THREE.MeshLambertMaterial({ color: '#4a4a4a' }),
            yellowCabin: new THREE.MeshLambertMaterial({ color: '#eeb211' }),
            glassCabin: new THREE.MeshLambertMaterial({ color: '#aed6f1', transparent: true, opacity: 0.4 }),
            ballast: new THREE.MeshLambertMaterial({
                map: this.createBallastTexture()
            }),
            rail: new THREE.MeshLambertMaterial({ color: '#99aaad' }),
            sleeper: new THREE.MeshLambertMaterial({ color: '#5a3825' }),
            thirdRail: new THREE.MeshLambertMaterial({ color: '#cccccc' }),
            grayWallEdge: new THREE.MeshLambertMaterial({ color: '#666666' })
        };

        // Shared geometries for elements that repeat across stations
        this.sharedGeometries = {
            lightTube: (() => { 
                const g = new THREE.CylinderGeometry(0.05, 0.05, 3.0, 6);
                g.rotateX(Math.PI / 2);
                return g;
            })(),
            pillar: new THREE.CylinderGeometry(0.25, 0.25, 7.0, 8), // hoch genug, um durch die angehobene Decke zu reichen (Überstand verdeckt)
            bench: new THREE.BoxGeometry(0.6, 0.4, 2.5),
            stairs: new THREE.BoxGeometry(2.5, 3.0, 6.0),
            boardCasing: new THREE.BoxGeometry(2.53, 0.65, 0.25),
            boardHanger: new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6)
        };
        
        // Maximilianstraße custom ceiling material matching tunnel walls
        this.tunnelConcreteTexture = this.createTunnelConcreteTexture();
        this.maximilianstrasseCeilingMat = new THREE.MeshLambertMaterial({
            map: this.tunnelConcreteTexture,
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        // Cross-beams (Querstreben) and the upper concrete wall band above the tiles use the
        // same rough concrete texture as the tunnel entrance/portal walls and staircase walls
        // (StationBuilder.createRoughConcreteMaterial), NOT the dark tunnel-tube texture above —
        // the ceiling keeps that one, only these two elements switch.
        this.stationConcreteWallMat = this.createRoughConcreteMaterial();
        this.stationConcreteWallMat.side = THREE.DoubleSide;
        this.stationConcreteBeamMat = this.createRoughConcreteMaterial();
        this.stationConcreteBeamMat.side = THREE.DoubleSide;
        this.stationConcreteBeamMat.map.wrapS = this.stationConcreteBeamMat.map.wrapT = THREE.RepeatWrapping;
        this.stationConcreteBeamMat.map.repeat.set(4, 1);
        this.stationConcreteBeamMat.map.needsUpdate = true;
        if (this.stationConcreteBeamMat.bumpMap) {
            this.stationConcreteBeamMat.bumpMap.wrapS = this.stationConcreteBeamMat.bumpMap.wrapT = THREE.RepeatWrapping;
            this.stationConcreteBeamMat.bumpMap.repeat.set(4, 1);
            this.stationConcreteBeamMat.bumpMap.needsUpdate = true;
        }

        // Shared materials for trash cans (Mülleimer). Phong instead of Standard:
        // high-metalness Standard materials NEED an environment map to reflect —
        // the scene has none, so the cans rendered near-black in stations. Phong
        // gets its metallic sheen from the light sources directly.
        this.materials.trashBody = new THREE.MeshPhongMaterial({
            map: this.createTrashCanTexture(),
            shininess: 60,
            specular: 0x555555
        });
        this.materials.trashLid = new THREE.MeshPhongMaterial({
            color: 0xd1d5db, // Light grey/silver
            shininess: 90,
            specular: 0x666666
        });
        this.materials.trashBag = new THREE.MeshStandardMaterial({
            color: 0x0055ff,
            roughness: 0.3,
            metalness: 0.1
        });

        // ALLE Stationen werden EINMAL vorgebaut (nie im Render-Loop!).
        // Standard: sofort und synchron hier im Konstruktor (Headless-Skripte,
        // Trunk-Rig, lazy gebaute U2/U3-Rigs). Der Startup-Loader in main.js
        // übergibt deferBuild=true und ruft stattdessen buildNextStation()
        // schrittweise auf, damit der Ladebalken zwischen den Stationen echten
        // Fortschritt anzeigen kann.
        this._toneMappedOff = new Set();
        this.stationsList = [];
        if (!options.deferBuild) {
            this.buildAllStations();
        }
    }

    // Baut die nächste noch fehlende Station von vorne nach hinten (Index-Reihenfolge).
    // Gibt true zurück, solange noch weitere Stationen fehlen.
    buildNextStation() {
        const stations = this.sim.stations;
        let idx = 0;
        while (idx < stations.length && this.stationsList[idx]) {
            idx++;
        }
        if (idx >= stations.length) return false;
        
        this.buildStationAtIndex(idx);
        
        // Prüfen, ob danach noch unfertige übrig sind
        let nextIdx = idx + 1;
        while (nextIdx < stations.length && this.stationsList[nextIdx]) {
            nextIdx++;
        }
        return nextIdx < stations.length;
    }

    // Erlaubt das on-demand Bauen einer bestimmten Station anhand ihres Index.
    buildStationAtIndex(idx) {
        if (this.stationsList[idx]) return this.stationsList[idx]; // Schon fertig
        
        const station = this.sim.stations[idx];
        if (!station) return null;
        
        const group = this.buildStation(station);
        this.stationsList[idx] = group;
        this._applyToneMappingExemption(group);
        return group;
    }

    buildAllStations() {
        while (this.buildNextStation()) { /* build remaining stations */ }
    }

    // Nimmt alle Materialien einer Stationsgruppe vom ACES-Tone-Mapping aus, damit
    // die handjustierten Stationsfarben nicht durch die Filmkurve verschoben werden
    // (sie reagieren weiterhin auf das Zonen-Ambientlicht). Das Set verhindert
    // doppelte Traversal-Arbeit bei geteilten Materialien.
    _applyToneMappingExemption(group) {
        group.traverse(o => {
            const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of mats) {
                if (this._toneMappedOff.has(m)) continue;
                m.toneMapped = false;
                this._toneMappedOff.add(m);
            }
        });
    }

    update(trainZ) {
        // Simple culling loop: add/remove pre-built stations from the scene (instantaneous)
        this.sim.stations.forEach((station, idx) => {
            const dist = Math.abs(trainZ - station.position);
            const isLoaded = this.loadedStations.has(idx);

            if (dist < this.stationCullDist[idx]) {
                if (!isLoaded && this.stationsList[idx]) {
                    this.scene.add(this.stationsList[idx]);
                    this.loadedStations.set(idx, true);
                }
            } else {
                if (isLoaded && this.stationsList[idx]) {
                    this.scene.remove(this.stationsList[idx]);
                    this.loadedStations.delete(idx);
                }
            }
        });
    }

    // Sammelt alle Rolltreppen-Meshes dieser Linie für die entfernungsbasierte
    // Rolltreppen-Ambience in main.js (updateEscalatorAmbience). Die
    // Stufen-Animation selbst läuft im Vertex-Shader (StationBuilder).
    registerEscalator(mesh, params) {
        if (!this.escalators) this.escalators = [];
        this.escalators.push(mesh);
    }

    tick(dt, time) {
        // Update the global escalator time uniform. The actual animation is now
        // handled on the GPU via a vertex shader (see StationBuilder.setupEscalatorMaterial).
        // speedStepsPerSec = 1.67 approx 0.5 m/s
        this.escalatorTime = time * 1.67;

        // The CPU loop that used to update thousands of instance matrices per frame
        // has been removed. Matrices are now static, and the vertex shader handles
        // the periodic movement.
    }

    adjustPlatformUVs(geometry, j, subLen, H_meters) {
        const posAttr = geometry.attributes.position;
        const uvAttr = geometry.attributes.uv;
        let maxY = -Infinity;
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i);
            if (y > maxY) maxY = y;
        }
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i);
            if (Math.abs(y - maxY) < 0.001) {
                const z = posAttr.getZ(i); // goes from -subLen/2 to +subLen/2
                const absoluteZ = (j * subLen + subLen/2) + z;
                const v = absoluteZ / H_meters;
                uvAttr.setY(i, v);
            }
        }
        uvAttr.needsUpdate = true;
    }

    // Sweeps a solid rectangular cross-section along the track spline from arc sStart..sEnd,
    // producing ONE continuous BufferGeometry instead of per-5m boxes. The half-width is
    // sampled per ring via halfWidthFn(s) so the bar tapers smoothly with the inter-track gap.
    // Vertices are emitted in the station group's LOCAL frame. mats = [sideMat, topMat]:
    // the top face uses material group 1, all other faces group 0.
    // Top-face UV: U normalised 0..1 across the (tapering) width, V = arcLength / Hmeters
    // (matches adjustPlatformUVs so the floor texture tiles continuously along the platform).
    buildSweptBar(group, sStart, sEnd, halfWidthFn, topY, botY, mats, Hmeters, centerOffFn, Wmeters) {
        // topY/botY may be a plain number (flat) OR a function of s (e.g. a periodic zigzag
        // profile like Jakobinenstraße's folded wall/coping) — sampled per ring either way.
        const topYFn = typeof topY === 'function' ? topY : () => topY;
        const botYFn = typeof botY === 'function' ? botY : () => botY;
        const length = sEnd - sStart;
        const nSeg = Math.max(2, Math.ceil(length));   // ~1 m rings
        const rings = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const hw = halfWidthFn(s);
            const co = centerOffFn ? centerOffFn(s) : 0; // lateral centre offset from centerline
            const ty = topYFn(s), by = botYFn(s);
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            const mk = (lat, y) => group.worldToLocal(new THREE.Vector3(wp.x + nX * lat, y, wp.z + nZ * lat));
            rings.push({ bl: mk(co - hw, by), br: mk(co + hw, by), tr: mk(co + hw, ty), tl: mk(co - hw, ty), cum, hw });
        }
        const pos = [], uv = [];
        let vCount = 0;
        const tri = (a, b, c, ua, ub, uc) => {
            pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
            vCount += 3;
        };
        const quad = (p0, p1, p2, p3, u0, u1, u2, u3) => { tri(p0, p1, p2, u0, u1, u2); tri(p0, p2, p3, u0, u2, u3); };

        const wTile = Wmeters;

        // TOP face -> material group 1
        const topStart = vCount;
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1];
            const vA = A.cum / Hmeters, vB = B.cum / Hmeters;
            if (wTile) {
                // Absolute-meters U-mapping (tiled): U = worldWidth / wTile
                const uA = (2 * A.hw) / wTile;
                const uB = (2 * B.hw) / wTile;
                quad(A.tl, A.tr, B.tr, B.tl, [0, vA], [uA, vA], [uB, vB], [0, vB]);
            } else {
                // Legacy 0..1 U-mapping (stretched): standard for platform floors
                quad(A.tl, A.tr, B.tr, B.tl, [0, vA], [1, vA], [1, vB], [0, vB]);
            }
        }
        const topCount = vCount - topStart;
        // SIDES + BOTTOM + end caps -> material group 0
        const sideStart = vCount;
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1];
            const vA = A.cum / Hmeters, vB = B.cum / Hmeters;
            quad(A.bl, A.tl, B.tl, B.bl, [0, vA], [1, vA], [1, vB], [0, vB]); // left
            quad(A.tr, A.br, B.br, B.tr, [0, vA], [1, vA], [1, vB], [0, vB]); // right
            quad(A.br, A.bl, B.bl, B.br, [0, vA], [1, vA], [1, vB], [0, vB]); // bottom
        }
        const c0 = rings[0], cN = rings[nSeg];
        quad(c0.bl, c0.br, c0.tr, c0.tl, [0, 0], [1, 0], [1, 1], [0, 1]);
        quad(cN.tl, cN.tr, cN.br, cN.bl, [0, 0], [1, 0], [1, 1], [0, 1]);
        const sideCount = vCount - sideStart;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.addGroup(topStart, topCount, 1);
        geom.addGroup(sideStart, sideCount, 0);
        geom.computeVertexNormals();
        // DoubleSide so winding never produces invisible faces on either curl direction.
        // NOTE: Material.clone() does NOT copy onBeforeCompile/customProgramCacheKey (they are
        // plain function properties, not part of Three.js's copyable material state) — carry
        // them over manually, otherwise any shader-hook-based cutout (e.g. Lorenzkirche/Rathaus
        // vault passages) silently stops working on the cloned material.
        const meshMats = mats.map(m => {
            const c = m.clone();
            c.side = THREE.DoubleSide;
            if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
            if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;
            return c;
        });
        const mesh = new THREE.Mesh(geom, meshMats);
        group.add(mesh);
        return mesh;
    }

    // Scharfreiterring: asymmetric lateral edges for the platform decks and the canopy
    // (Besonderheit of this station). The OUTER edge keeps a constant clearance to the
    // active running track and thus follows its curvature; the INNER edge is a
    // dead-straight world-space chord (matching the straight decorative middle tracks),
    // found per s by intersecting the local normal ray with the chord through the inner
    // edge's points at chordA/chordB. Returns { off, hw } per-s functions for buildSweptBar.
    _schAsymEdges(chordA, chordB, sign, innerBase, outerClear) {
        const mkE = (s) => {
            const p = this.sim.getTrackPosition(s);
            const t = this.sim.getTrackTangent(s);
            const nl = Math.hypot(-t.z, t.x) || 1;
            return { x: p.x + (-t.z / nl) * sign * innerBase, z: p.z + (t.x / nl) * sign * innerBase };
        };
        const EA = mkE(chordA), EB = mkE(chordB);
        const dX = EB.x - EA.x, dZ = EB.z - EA.z;
        const innerOff = (s) => {
            const p = this.sim.getTrackPosition(s);
            const t = this.sim.getTrackTangent(s);
            const nl = Math.hypot(-t.z, t.x) || 1;
            const nX = -t.z / nl, nZ = t.x / nl;
            const denom = nX * dZ - nZ * dX;
            if (Math.abs(denom) < 1e-9) return sign * innerBase;
            return ((EA.x - p.x) * dZ - (EA.z - p.z) * dX) / denom;
        };
        const outerOff = (s) => sign * (this.sim.getTrackSpacing(s) / 2 - outerClear);
        return {
            off: (s) => (outerOff(s) + innerOff(s)) / 2,
            hw: (s) => Math.max(0.05, Math.abs(outerOff(s) - innerOff(s)) / 2)
        };
    }

    // Sweeps a single vertical wall RIBBON (one tiled face) along the track from sStart..sEnd
    // at lateral offset offFn(s), spanning world Y [yBotW, yTopW]. UVs are baked metric:
    // U = arcLength / tileU (so a tiled texture repeats every tileU metres along the wall),
    // V interpolates vBot..vTop (caller passes either metric values for tiling textures, or
    // 0..1 for a single-image band like the station-name stripe). The base material's map is
    // cloned with repeat (1,1) / offset (0,0) / RepeatWrapping so only the baked UVs tile it.
    buildSweptWall(group, sStart, sEnd, offFn, yBotW, yTopW, baseMat, tileU, vBot, vTop, nSegOverride, vMetricScale) {
        // yBotW/yTopW may be a plain number (flat top/bottom) OR a function of s — e.g. a
        // periodic zigzag profile like Jakobinenstraße's folded wall/coping. For a periodic
        // profile, pass nSegOverride so rings land exactly on the pattern's own breakpoints
        // (e.g. a multiple of the period) — otherwise the default ~1m/ring default resolution
        // aliases against a short period and the peaks come out uneven ("phase noise").
        //
        // vMetricScale (optional): when yTopW/yBotW VARIES with s (e.g. a zigzag top edge), the
        // default vBot..vTop-per-ring interpolation stretches the texture to fill whatever the
        // LOCAL ring height happens to be — so a horizontal grout line ends up following the
        // zigzag instead of staying level ("Textur folgt den Dreieck-Streckungen"). Passing
        // vMetricScale switches V to an ABSOLUTE-world-Y mapping (V = worldY * vMetricScale,
        // ignoring vBot/vTop) so horizontal texture features stay at a constant world height and
        // the varying top edge just clips across the (unstretched) texture, like a real wall
        // whose roofline cuts across horizontal masonry courses.
        const yBotFn = typeof yBotW === 'function' ? yBotW : () => yBotW;
        const yTopFn = typeof yTopW === 'function' ? yTopW : () => yTopW;
        const length = sEnd - sStart;
        const nSeg = nSegOverride || Math.max(2, Math.ceil(length));
        const bots = [], tops = [], us = [], vBots = [], vTops = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = offFn(s);
            const yb = yBotFn(s), yt = yTopFn(s);
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            bots.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * off, yb, wp.z + nZ * off)));
            tops.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * off, yt, wp.z + nZ * off)));
            us.push(cum / tileU);
            if (vMetricScale) { vBots.push(yb * vMetricScale); vTops.push(yt * vMetricScale); }
            else { vBots.push(vBot); vTops.push(vTop); }
        }
        // The two side walls have viewers standing on opposite sides of the track (facing each
        // other), so a single "u increases with distance along s" rule reads correctly for only
        // one of them — the other's viewer is looking the opposite way down the platform, so to
        // them it reads backwards. This is a viewing-direction effect, not a face-winding one
        // (the material is DoubleSide, so winding never changes what's visible — only which
        // world position maps to which u does). Mirror u for the negative-offset side (the
        // Langwasser-Süd-direction side, same sign convention as the destination boards) so its
        // text reads the right way round too.
        if (offFn((sStart + sEnd) / 2) > 0) {
            const totalU = cum / tileU;
            for (let i = 0; i < us.length; i++) us[i] = totalU - us[i];
        }
        const pos = [], uv = [];
        const tri = (a, b, c, ua, ub, uc) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); };
        for (let r = 0; r < nSeg; r++) {
            const bl = bots[r], tl = tops[r], br = bots[r + 1], tr = tops[r + 1];
            const uL = us[r], uR = us[r + 1];
            const vB0 = vBots[r], vB1 = vBots[r + 1], vT0 = vTops[r], vT1 = vTops[r + 1];
            tri(bl, br, tr, [uL, vB0], [uR, vB1], [uR, vT1]);
            tri(bl, tr, tl, [uL, vB0], [uR, vT1], [uL, vT0]);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mat = baseMat.clone();
        mat.side = THREE.DoubleSide;
        // Material.clone() does NOT copy onBeforeCompile/customProgramCacheKey — see buildSweptBar.
        if (baseMat.onBeforeCompile) mat.onBeforeCompile = baseMat.onBeforeCompile;
        if (baseMat.customProgramCacheKey) mat.customProgramCacheKey = baseMat.customProgramCacheKey;
        if (baseMat.map) { mat.map = baseMat.map.clone(); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.repeat.set(1, 1); mat.map.offset.set(0, 0); mat.map.needsUpdate = true; }
        if (baseMat.bumpMap) { mat.bumpMap = baseMat.bumpMap.clone(); mat.bumpMap.wrapS = mat.bumpMap.wrapT = THREE.RepeatWrapping; mat.bumpMap.repeat.set(1, 1); mat.bumpMap.offset.set(0, 0); }
        const mesh = new THREE.Mesh(geom, mat);
        group.add(mesh);
        return mesh;
    }

    // Sweeps an ARBITRARY open cross-section profile along the track (e.g. a half-circle vault,
    // a folded roof). profilePts = [{x,y}, ...] in the lateral(x)/height(y) plane, relative to
    // lateral centre offFn(s) and to the station floor (world Y = cyW + y). Connects consecutive
    // rings into a continuous surface. U = arcLen/tileU, V = normalised distance along the
    // profile, so a texture maps along the profile. Solid colours ignore UVs.
    buildSweptProfile(group, sStart, sEnd, profilePts, cyW, offFn, material, tileU) {
        const length = sEnd - sStart;
        const nSeg = Math.max(2, Math.ceil(length));
        const P = profilePts.length;
        const rings = [], us = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = offFn ? offFn(s) : 0;
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            const ring = [];
            for (const pt of profilePts) {
                const lat = off + pt.x;
                ring.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * lat, cyW + pt.y, wp.z + nZ * lat)));
            }
            rings.push(ring); us.push(cum / tileU);
        }
        const vs = [0];
        for (let p = 1; p < P; p++) { const dx = profilePts[p].x - profilePts[p - 1].x, dy = profilePts[p].y - profilePts[p - 1].y; vs.push(vs[p - 1] + Math.hypot(dx, dy)); }
        const pos = [], uv = [];
        const tri = (a, b, c, ua, ub, uc) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); };
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1], uA = us[r], uB = us[r + 1];
            for (let p = 0; p < P - 1; p++) {
                tri(A[p], A[p + 1], B[p + 1], [uA, vs[p]], [uA, vs[p + 1]], [uB, vs[p + 1]]);
                tri(A[p], B[p + 1], B[p], [uA, vs[p]], [uB, vs[p + 1]], [uB, vs[p]]);
            }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mat = material.clone();
        mat.side = THREE.DoubleSide;
        // Material.clone() does NOT copy onBeforeCompile/customProgramCacheKey — see buildSweptBar.
        // This is what silently dropped Lorenzkirche/Rathaus's shader-based vault passage cutouts.
        if (material.onBeforeCompile) mat.onBeforeCompile = material.onBeforeCompile;
        if (material.customProgramCacheKey) mat.customProgramCacheKey = material.customProgramCacheKey;
        if (material.map) {
            mat.map = material.map.clone();
            if (material.userData && material.userData.keepWrapAndRepeat) {
                mat.map.wrapS = material.map.wrapS;
                mat.map.wrapT = material.map.wrapT;
                mat.map.repeat.copy(material.map.repeat);
                mat.map.offset.copy(material.map.offset);
            } else {
                mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
                mat.map.repeat.set(1, 1);
                mat.map.offset.set(0, 0);
            }
            mat.map.needsUpdate = true;
        }
        const mesh = new THREE.Mesh(geom, mat);
        group.add(mesh);
        return mesh;
    }

    // Standard suspended barrel light channel (Wöhrder-Wiese-Modell): aluminium
    // cylinder with a flat underside carrying flush light plates (10 cm joints),
    // pillar-style bright fades on both flanks, sealed end caps and the station
    // name bent onto the round faces. Built once per station, mirrored to both
    // sides via offFn. All Y values are LOCAL to the station group (same
    // convention as the callers: world sweep Y = centerPosY + local Y).
    buildBarrelLights(group, { startS, endS, axisY, centerPosY, centerAngle, offFn, ceilY = null, label }) {
        const chanR = 0.32;
        const plateHalfW = 0.20;
        const chordY = -Math.sqrt(chanR * chanR - plateHalfW * plateHalfW);
        const gammaC = Math.acos(plateHalfW / chanR);
        // Profile starts at angle 0 (right side, matches the fade phase), runs
        // CCW over the top to the left chord edge; the jump to the right chord
        // edge forms the flat underside, then closes at 2π.
        const circle = [];
        for (let k = 0; k <= 16; k++) {
            const a = (k / 16) * (Math.PI + gammaC);
            circle.push({ x: chanR * Math.cos(a), y: chanR * Math.sin(a) });
        }
        for (let k = 0; k <= 4; k++) {
            const a = (2 * Math.PI - gammaC) + (k / 4) * gammaC;
            circle.push({ x: chanR * Math.cos(a), y: chanR * Math.sin(a) });
        }
        const plateLen = 2.5, plateGap = 0.10;
        const tubeMats = [this.materials.lightTube, this.materials.lightTube];
        // Name plane bent onto the barrel: vertices wrapped onto a cylinder of
        // radius rText concentric with the channel axis, so the lettering hugs
        // the round face instead of floating flat.
        const rText = chanR + 0.012;
        if (!this._barrelNameGeom) {
            const g = new THREE.PlaneGeometry(5.2, 0.66, 1, 24);
            const nPos = g.attributes.position;
            for (let vi = 0; vi < nPos.count; vi++) {
                const th = nPos.getY(vi) / rText;
                nPos.setY(vi, rText * Math.sin(th));
                nPos.setZ(vi, rText * (Math.cos(th) - 1));
            }
            g.computeVertexNormals();
            this._barrelNameGeom = g;
        }
        const nameGeom = this._barrelNameGeom;
        const nameMat = this.getBarrelTextMat(label);
        // Flat end caps sealing the open barrel profile
        if (!this._barrelCapMat) {
            this._barrelCapMat = new THREE.MeshLambertMaterial({ color: '#8f9499', side: THREE.DoubleSide });
        }
        if (!this._barrelCapGeom) {
            const capShape = new THREE.Shape();
            circle.forEach((pt, i) => i === 0 ? capShape.moveTo(pt.x, pt.y) : capShape.lineTo(pt.x, pt.y));
            this._barrelCapGeom = new THREE.ShapeGeometry(capShape);
        }
        const capGeom = this._barrelCapGeom;
        // Optional hanger rods up to the ceiling, every 5 m
        let hangerGeom = null, hangerYMid = 0;
        if (ceilY !== null && ceilY - (axisY + chanR) > 0.05) {
            const hangerLen = ceilY - (axisY + chanR);
            hangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 8);
            hangerYMid = axisY + chanR + hangerLen / 2;
        }
        for (const sign of [1, -1]) {
            this.buildSweptProfile(group, startS, endS, circle, centerPosY + axisY, (s) => sign * offFn(s), this.getWoehrderChannelMat(chanR), 5);
            for (let pS = startS; pS < endS - 0.3; pS += plateLen + plateGap) {
                const pE = Math.min(pS + plateLen, endS);
                this.buildSweptBar(group, pS, pE, () => plateHalfW,
                    centerPosY + axisY + chordY + 0.01, centerPosY + axisY + chordY - 0.008,
                    tubeMats, 1.2, (s) => sign * offFn(s));
            }
            for (const sCap of [startS, endS]) {
                const cPos = this.sim.getTrackPosition(sCap);
                const cTan = this.sim.getTrackTangent(sCap);
                const cNorm = new THREE.Vector3(-cTan.z, 0, cTan.x);
                const capMesh = new THREE.Mesh(capGeom, this._barrelCapMat);
                capMesh.position.copy(group.worldToLocal(cPos.clone().addScaledVector(cNorm, sign * offFn(sCap))));
                capMesh.position.y = axisY;
                capMesh.rotation.y = Math.atan2(cTan.x, cTan.z) - centerAngle;
                group.add(capMesh);
            }
            // Station name on both faces of the channel, every 12 m
            for (let sT = startS + 6.0; sT <= endS - 3.0; sT += 12.0) {
                const posT = this.sim.getTrackPosition(sT);
                const tanT = this.sim.getTrackTangent(sT);
                const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                for (const face of [1, -1]) {
                    const pName = posT.clone().addScaledVector(normT, sign * offFn(sT) + face * rText);
                    const nameMesh = new THREE.Mesh(nameGeom, nameMat);
                    nameMesh.position.copy(group.worldToLocal(pName));
                    nameMesh.position.y = axisY;
                    nameMesh.rotation.set(0, rotYT + (face > 0 ? -Math.PI / 2 : Math.PI / 2), 0);
                    group.add(nameMesh);
                }
            }
            if (hangerGeom) {
                for (let sH = startS + 2.5; sH <= endS - 1.0; sH += 5.0) {
                    const hPos = this.sim.getTrackPosition(sH);
                    const hTan = this.sim.getTrackTangent(sH);
                    const hNorm = new THREE.Vector3(-hTan.z, 0, hTan.x);
                    const hanger = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                    hanger.position.copy(group.worldToLocal(hPos.clone().addScaledVector(hNorm, sign * offFn(sH))));
                    hanger.position.y = hangerYMid;
                    hanger.rotation.y = Math.atan2(hTan.x, hTan.z) - centerAngle;
                    group.add(hanger);
                }
            }
        }
    }

    // Plärrer-/Jakobinenstraße-Lichtbalken als wiederverwendbares Standardmodell:
    // Betonträger mit seitlichen + unteren Lichtpaneelen, Abhängern zur Decke und
    // dem Stationsnamen in regelmäßigen Abständen auf beiden Trägerflächen
    // (analog zur Namensbeschriftung der runden Tonnenleuchte, buildBarrelLights).
    // Läuft entlang beider Bahnsteigkanten, 20 cm einwärts. Y-Werte: cy ist die
    // WELT-Höhe der Gleisachse, die Balkenmaße sind lokal dazu; ceilY ist die
    // lokale Deckenhöhe für die Abhänger (Deckenunterkante = ceilY - 0.1).
    // Mit flush=true wird der Balken bündig an die Decke gesetzt (keine Abhänger).
    buildPlaererLights(group, station, centerAngle, { sA, sB, cy, ceilY, flush = false }) {
        const jGirderH = 0.35, jGirderW = 0.25;
        let jGirderY = 3.775;
        if (flush) {
            jGirderY = (ceilY - 0.1) - jGirderH / 2;
        }
        const jGirderTopY = jGirderY + jGirderH / 2;
        const jSideH = 0.232, jSideL = 1.8, jSideGap = 0.05;
        const jSideCycle = jSideL + jSideGap;
        const edgeOff = (s) => this.sim.getTrackSpacing(s) / 2 - 1.74;
        const gMats = [this.materials.boardHanger, this.materials.boardHanger];
        for (const sign of [1, -1]) {
            this.buildSweptBar(group, sA, sB, () => jGirderW / 2,
                cy + jGirderY + jGirderH / 2, cy + jGirderY - jGirderH / 2, gMats, 1.2, (s) => sign * edgeOff(s));
        }
        const dVals = [];
        for (let d = sA + jSideCycle / 2; d <= sB - jSideCycle / 2; d += jSideCycle) dVals.push(d);
        const sideInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.01, jSideH, jSideL), this.materials.lightTube, dVals.length * 4);
        const botInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.01, jSideL), this.materials.lightTube, dVals.length * 2);
        const hangM = [];
        let si = 0, bi = 0;
        for (const d of dVals) {
            const posP = this.sim.getTrackPosition(d);
            const tanP = this.sim.getTrackTangent(d);
            const rotYP = Math.atan2(tanP.x, tanP.z) - centerAngle;
            const normP = new THREE.Vector3(-tanP.z, 0, tanP.x);
            for (const sign of [1, -1]) {
                const latG = sign * edgeOff(d);
                const sy = jGirderTopY - 0.05 - jSideH / 2;
                for (const pside of [1, -1]) {
                    const wp = posP.clone().addScaledVector(normP, latG + pside * (jGirderW / 2 + 0.006));
                    const lp = group.worldToLocal(wp);
                    const m = new THREE.Matrix4().makeRotationY(rotYP);
                    m.setPosition(lp.x, sy, lp.z);
                    sideInst.setMatrixAt(si++, m);
                }
                const cp = group.worldToLocal(posP.clone().addScaledVector(normP, latG));
                const mb = new THREE.Matrix4().makeRotationY(rotYP);
                mb.setPosition(cp.x, jGirderY - jGirderH / 2 - 0.006, cp.z);
                botInst.setMatrixAt(bi++, mb);
                if (!flush && Math.abs((d - sA) % 5.0) < jSideCycle / 2) {
                    const hLen = (ceilY - 0.1) - jGirderTopY;
                    if (hLen > 0.01) {
                        const mh = new THREE.Matrix4().makeRotationY(rotYP);
                        mh.multiply(new THREE.Matrix4().makeScale(1, hLen, 1));
                        mh.setPosition(cp.x, jGirderTopY + hLen / 2, cp.z);
                        hangM.push(mh);
                    }
                }
            }
        }
        sideInst.instanceMatrix.needsUpdate = true;
        botInst.instanceMatrix.needsUpdate = true;
        const hangInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 8), this.materials.boardHanger, hangM.length);
        hangM.forEach((m, i) => hangInst.setMatrixAt(i, m));
        hangInst.instanceMatrix.needsUpdate = true;
        for (const inst of [sideInst, botInst, hangInst]) {
            inst.computeBoundingSphere();
            if (inst.boundingSphere) inst.boundingSphere.radius *= 5;
            group.add(inst);
        }
        // Stationsname alle 12 m auf beiden Flächen beider Träger
        const nameGeom = new THREE.PlaneGeometry(1.6, 0.24);
        const nameMat = this.getBarrelTextMat(station.name);
        for (let sT = sA + 6.0; sT <= sB - 3.0; sT += 12.0) {
            const posT = this.sim.getTrackPosition(sT);
            const tanT = this.sim.getTrackTangent(sT);
            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
            for (const sign of [1, -1]) {
                for (const face of [1, -1]) {
                    const pName = posT.clone().addScaledVector(normT, sign * edgeOff(sT) + face * (jGirderW / 2 + 0.012));
                    const nameMesh = new THREE.Mesh(nameGeom, nameMat);
                    nameMesh.position.copy(group.worldToLocal(pName));
                    nameMesh.position.y = jGirderY;
                    nameMesh.rotation.set(0, rotYT + (face > 0 ? -Math.PI / 2 : Math.PI / 2), 0);
                    group.add(nameMesh);
                }
            }
        }
    }

    getPlatformMaterials(station, platWidth, hasLeftStripe, hasRightStripe) {
        const cacheKey = `${station.name}_${platWidth.toFixed(3)}_${hasLeftStripe}_${hasRightStripe}`;
        if (this.platformMaterialsCache.has(cacheKey)) {
            return this.platformMaterialsCache.get(cacheKey);
        }

        const topMat = this.createPlatformTopMaterial(station, platWidth, hasLeftStripe, hasRightStripe);
        
        let sideColor = '#888888';
        if (station.name === "Lorenzkirche") {
            sideColor = '#8b4535';
        } else if (station.name === "Rathaus") {
            sideColor = '#3f4645';
        } else if (station.name === "Hardhöhe") {
            sideColor = '#f1f5f9';
        }

        const sideMat = new THREE.MeshLambertMaterial({ color: sideColor });
        const mats = [
            sideMat, // right (X+)
            sideMat, // left (X-)
            topMat,  // top (Y+)
            sideMat, // bottom (Y-)
            sideMat, // front (Z+)
            sideMat  // back (Z-)
        ];

        this.platformMaterialsCache.set(cacheKey, mats);
        return mats;
    }

    createPlatformTopMaterial(station, platWidth, hasLeftStripe, hasRightStripe) {
        const stationFloorConfigs = {
            "default": {
                tileColor: '#909291',
                groutColor: '#171918',
                tileSize: 0.3,
                offset: true,
                weatheredEdges: false,
                terracotta: false,
                stripGap: 0.2,
                stripeW: 0.6,
                blindW: 0.4,
                blindColor: '#1d201f',
                weatheredStripe: true
            },
            "Scharfreiterring": { weatheredEdges: true },
            "Muggenhof": {
                tileColor: '#8a8e91',
                groutColor: '#2b2d30',
                tileSize: 0.4,
                offset: false,
                stripeW: 0.4,
                blindW: 0.25,
                blindColor: '#fef08a', // bright yellow tactile strip
                stripGap: 0.15,
                weatheredStripe: false
            },
            "Langwasser Nord": { weatheredEdges: true },
            "Messe": { weatheredEdges: true },
            "Bauernfeindstraße": { weatheredEdges: true },
            "Lorenzkirche": {
                tileColor: '#8b4535',
                groutColor: '#451a03',
                terracotta: true,
                weatheredStripe: true
            },
            "Jakobinenstraße": {
                offset: false
            },
            "Fürth Hauptbahnhof": {
                offset: false
            },
            "Rathaus": {
                tileSize: 0.4,
                offset: false,
                rotated: true,
                marbling: true,
                tileColor: '#757980',
                groutColor: '#1a1d1c',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Stadthalle": {
                tileSize: 0.4,
                offset: false,
                tileColor: '#b97a70',
                groutColor: '#5a342e',
                terracotta: true,
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Klinikum": {
                tileSize: 0.4,
                offset: false,
                tileColor: '#757980',
                groutColor: '#555555',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Klinikum Nord": {
                // Heller beige-weißer Plattenboden (Fotos), dunkle Blindenstreifen
                tileSize: 0.4,
                offset: false,
                tileColor: '#cac4b4',
                groutColor: '#aaa494',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Flughafen": {
                // Heller Terrazzo (Fotos): große helle Platten, Fugen kaum sichtbar
                tileSize: 0.4,
                offset: false,
                tileColor: '#c6c3ba',
                groutColor: '#b5b2a9',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Maxfeld": {
                // Heller grüngrauer Terrazzo (Fotos), dunkle Streifen an den Kanten
                tileSize: 0.4,
                offset: false,
                tileColor: '#ccd1c6',
                groutColor: '#b9beb3',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Rennweg": {
                // Weiße Fliesen (Fotos; das braune Rautenmuster ist stilisiert
                // über die Fugenfarbe angedeutet)
                tileSize: 0.3,
                offset: false,
                tileColor: '#e6e4dd',
                groutColor: '#b9a898',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Nordwestring": {
                // Heller beige-grauer Granitboden (Fotos), dunkle Blindenstreifen
                tileSize: 0.4,
                offset: false,
                tileColor: '#d5d0c4',
                groutColor: '#c4bfb3',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Friedrich-Ebert-Platz": {
                // Rot-oranger Terrazzoboden (Fotos)
                tileSize: 0.4,
                offset: false,
                tileColor: '#c06a45',
                groutColor: '#9e5535',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Hardhöhe": {
                tileSize: 0.4,
                offset: false,
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                alternatingBands: true,
                weatheredStripe: false,
                tileColor: '#757980'
            },
            "Wöhrder Wiese": {
                // Near-white large tiles (photos), narrow grout
                tileSize: 0.4,
                offset: false,
                tileColor: '#c6c6c0',
                groutColor: '#93958f',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            }
        };

        const config = Object.assign({}, stationFloorConfigs["default"]);
        const spec = stationFloorConfigs[station.name];
        if (spec) {
            Object.assign(config, spec);
        }
        // Underground platforms only receive flat ambient light (no directional
        // lighting), so the true tile colors read as too dark. Brighten just the
        // floor texture rather than the scene lighting.
        config.tileColor = lightenHex(config.tileColor, 0.30);
        config.groutColor = lightenHex(config.groutColor, 0.20);

        const pixelsPerMeter = 100;
        const W_pixels = Math.round(platWidth * pixelsPerMeter);
        const H_meters = config.alternatingBands ? 4.0 : 1.2;
        const H_pixels = Math.round(H_meters * pixelsPerMeter);

        const canvas = document.createElement('canvas');
        canvas.width = W_pixels;
        canvas.height = H_pixels;
        const cCtx = canvas.getContext('2d');

        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = W_pixels;
        bumpCanvas.height = H_pixels;
        const bCtx = bumpCanvas.getContext('2d');

        // Draw background grout
        cCtx.fillStyle = config.groutColor;
        cCtx.fillRect(0, 0, W_pixels, H_pixels);

        bCtx.fillStyle = '#000000';
        bCtx.fillRect(0, 0, W_pixels, H_pixels);

        const tileSizePx = config.tileSize * pixelsPerMeter;

        if (config.rotated) {
            cCtx.save();
            cCtx.translate(W_pixels / 2, H_pixels / 2);
            cCtx.rotate(Math.PI / 4);

            bCtx.save();
            bCtx.translate(W_pixels / 2, H_pixels / 2);
            bCtx.rotate(Math.PI / 4);

            const limit = Math.max(W_pixels, H_pixels) * 2;
            for (let y = -limit; y < limit; y += tileSizePx) {
                for (let x = -limit; x < limit; x += tileSizePx) {
                    this.drawSingleTile(cCtx, bCtx, x, y, tileSizePx, config);
                }
            }
            cCtx.restore();
            bCtx.restore();
        } else {
            const rows = Math.round(H_pixels / tileSizePx);
            const cols = Math.ceil(W_pixels / tileSizePx) + 2;
            for (let r = 0; r < rows; r++) {
                const y = r * tileSizePx;
                const isOffsetRow = config.offset && (r % 2 === 1);
                const offsetPx = isOffsetRow ? (tileSizePx / 2) : 0;

                for (let c = -1; c < cols; c++) {
                    const x = c * tileSizePx + offsetPx;
                    let tileColor = config.tileColor;
                    let groutColor = config.groutColor;

                    if (config.alternatingBands) {
                        if (r >= 5) {
                            tileColor = lightenHex('#909291', 0.30);
                            groutColor = lightenHex('#4b5563', 0.20);
                        } else {
                            tileColor = lightenHex('#757980', 0.30);
                            groutColor = lightenHex('#374151', 0.20);
                        }
                    }

                    this.drawSingleTile(cCtx, bCtx, x, y, tileSizePx, config, tileColor, groutColor);
                }
            }
        }

        // Draw overlays
        const drawStripeAndBlind = (isLeft) => {
            const stripeW_px = config.stripeW * pixelsPerMeter;
            const gapW_px = config.stripGap * pixelsPerMeter;
            const blindW_px = config.blindW * pixelsPerMeter;

            const stripeLeft = isLeft ? 0 : (W_pixels - stripeW_px);
            const blindLeft = isLeft ? (stripeW_px + gapW_px) : (W_pixels - stripeW_px - gapW_px - blindW_px);

            // 1. Draw Safety Stripe
            cCtx.fillStyle = config.weatheredStripe ? '#eaeaea' : '#f8fafc';
            cCtx.fillRect(stripeLeft, 0, stripeW_px, H_pixels);

            bCtx.fillStyle = '#ffffff';
            bCtx.fillRect(stripeLeft, 0, stripeW_px, H_pixels);

            if (config.weatheredStripe) {
                // Add weathering spots (increased opacity and count)
                cCtx.fillStyle = 'rgba(0, 0, 0, 0.28)';
                for (let i = 0; i < 40; i++) {
                    const wx = stripeLeft + Math.random() * stripeW_px;
                    const wy = Math.random() * H_pixels;
                    const wSize = 1 + Math.random() * 2.5;
                    cCtx.fillRect(wx, wy, wSize, wSize);
                }
                // Add edge wear
                cCtx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                for (let i = 0; i < 20; i++) {
                    const wx = isLeft ? (stripeW_px - 2 + Math.random() * 2) : (stripeLeft + Math.random() * 2);
                    cCtx.fillRect(wx, Math.random() * H_pixels, 1.5, 2 + Math.random() * 5);
                }
            }

            // 2. Draw Tactile Blind Stripe
            const blindColor = config.blindColor || '#2d3130';
            cCtx.fillStyle = blindColor;
            cCtx.fillRect(blindLeft, 0, blindW_px, H_pixels);

            bCtx.fillStyle = '#e6e6e6';
            bCtx.fillRect(blindLeft, 0, blindW_px, H_pixels);

            const step = 4; // draw a groove every 4 pixels (4 cm)
            const numRibs = Math.floor(blindW_px / step);
            const startOffset = (blindW_px - (numRibs - 1) * step) / 2;

            for (let r = 0; r < numRibs; r++) {
                const rx = blindLeft + startOffset + r * step;

                // Draw dark groove (black)
                cCtx.strokeStyle = '#050505';
                cCtx.lineWidth = 1.5;
                cCtx.beginPath();
                cCtx.moveTo(rx, 0);
                cCtx.lineTo(rx, H_pixels);
                cCtx.stroke();

                // Draw light rib highlight (light grey) for high 3D contrast
                cCtx.strokeStyle = '#555f5c';
                cCtx.lineWidth = 1.0;
                cCtx.beginPath();
                cCtx.moveTo(rx + 1.2, 0);
                cCtx.lineTo(rx + 1.2, H_pixels);
                cCtx.stroke();

                bCtx.fillStyle = '#111111';
                bCtx.fillRect(rx - 1, 0, 2, H_pixels);
            }
        };

        if (hasLeftStripe) drawStripeAndBlind(true);
        if (hasRightStripe) drawStripeAndBlind(false);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.ClampToEdgeWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;

        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.015
        });
    }

    drawSingleTile(cCtx, bCtx, x, y, size, config, customColor, customGrout) {
        const border = 0.5;
        const tileW = size - border * 2;
        const tileH = size - border * 2;
        const tileX = x + border;
        const tileY = y + border;

        let color = customColor || config.tileColor;
        cCtx.fillStyle = color;
        cCtx.fillRect(tileX, tileY, tileW, tileH);

        bCtx.fillStyle = '#ffffff';
        bCtx.fillRect(tileX, tileY, tileW, tileH);

        if (config.terracotta) {
            cCtx.save();
            cCtx.beginPath();
            cCtx.rect(tileX, tileY, tileW, tileH);
            cCtx.clip();
            for (let i = 0; i < 8; i++) {
                cCtx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
                cCtx.fillRect(tileX + Math.random() * tileW, tileY + Math.random() * tileH, 2, 2);
            }
            cCtx.restore();
        }

        if (config.marbling) {
            cCtx.save();
            cCtx.beginPath();
            cCtx.rect(tileX, tileY, tileW, tileH);
            cCtx.clip();

            cCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)';
            cCtx.lineWidth = 1 + Math.random();
            cCtx.beginPath();
            cCtx.moveTo(tileX + Math.random() * tileW, tileY);
            cCtx.bezierCurveTo(
                tileX + Math.random() * tileW, tileY + tileH * 0.33,
                tileX + Math.random() * tileW, tileY + tileH * 0.66,
                tileX + Math.random() * tileW, tileY + tileH
            );
            cCtx.stroke();
            cCtx.restore();
        }

        if (config.weatheredEdges) {
            cCtx.save();
            cCtx.strokeStyle = '#757980';
            cCtx.lineWidth = 3.0;
            cCtx.strokeRect(tileX + 1.5, tileY + 1.5, tileW - 3.0, tileH - 3.0);

            // Add organic weathering spots along tile borders for high contrast
            cCtx.fillStyle = '#757980';
            cCtx.globalAlpha = 0.6;
            for (let i = 0; i < 6; i++) {
                const edge = Math.floor(Math.random() * 4);
                let sx, sy;
                if (edge === 0) { // top
                    sx = tileX + Math.random() * tileW;
                    sy = tileY + Math.random() * 5;
                } else if (edge === 1) { // bottom
                    sx = tileX + Math.random() * tileW;
                    sy = tileY + tileH - Math.random() * 5;
                } else if (edge === 2) { // left
                    sx = tileX + Math.random() * 5;
                    sy = tileY + Math.random() * tileH;
                } else { // right
                    sx = tileX + tileW - Math.random() * 5;
                    sy = tileY + Math.random() * tileH;
                }
                const sSize = 1.5 + Math.random() * 2.5;
                cCtx.fillRect(sx - sSize/2, sy - sSize/2, sSize, sSize);
            }
            cCtx.restore();
        }
    }

    getUpcomingViaText(lineId, stationName, direction) {
        return getUpcomingViaText(lineId, stationName, direction);
    }

    buildStation(station) {
        // --- MODULAR ARCHITECTURE HOOK ---
        // Each station will eventually have its own Builder class in src/simulator/stations/
        // if (station.name === "Aufseßplatz") return new AufsessplatzBuilder(this, station).build(); // Example for future
        if (station.name === "Rathaus") return new RathausBuilder(this, station).build();
        if (station.name === "Lorenzkirche") return new LorenzkircheBuilder(this, station).build();
        // Plärrer is a bespoke stacked station built entirely in TrackManager.buildPlaerrer
        // (two levels, offset platforms, hall, diverging tubes). It is built once (by U1's
        // rig) and lives permanently in the world scene, carrying BOTH corridors: Gleis 1/2
        // for U1 and the parallel Gleis 3/4 slot that U2/U3's centerlines are pinned onto.
        // So NO line builds a generic Plärrer stop -- the shared hall IS the station
        // (U2/U3 zone tubes come from TrackManager.buildPlaerrerApproach).
        if (station.name === "Plärrer") return new THREE.Group();
        // The other 5 shared-trunk stations (Rothenburger Straße..Rathenauplatz) are now
        // byte-identical between U2 and U3 (scratch/gen_topology_u23.mjs splices U2's trunk
        // into U3), so they're built once by a dedicated shared trunk rig (main.js, lineId
        // "TRUNK") instead of once per line -- U2/U3 skip them here exactly like Plärrer above.
        const TRUNK_STATION_NAMES = ['Rothenburger Straße', 'Opernhaus', 'Hauptbahnhof', 'Wöhrder Wiese', 'Rathenauplatz'];
        if (TRUNK_STATION_NAMES.includes(station.name) && (this.sim.track.lineId === 'U2' || this.sim.track.lineId === 'U3')) {
            return new THREE.Group();
        }

        // --- LEGACY FALLBACK ---
        const stationGroup = new THREE.Group();
        const isAufsessplatzLook = ["Aufseßplatz", "Hasenbuck", "Frankenstraße", "Maffeiplatz"].includes(station.name);

        const centerPos = this.sim.getTrackPosition(station.position);
        const centerTangent = this.sim.getTrackTangent(station.position);
        const centerAngle = Math.atan2(centerTangent.x, centerTangent.z);
        const spacing = this.sim.getTrackSpacing(station.position);

        stationGroup.position.copy(centerPos);
        stationGroup.rotation.y = centerAngle;
        stationGroup.updateMatrixWorld(true);

        const platLength = 2 * station.halfLength; // platform length (m) from the geojson spread
        const platTopY = 0.865;   // Bahnsteig-OK auf Zugboden-Höhe (ebener Einstieg, 1:1)
        const platHeight = 1.165; // Deck von Boden (-0.30) bis 0.865
        const platCenterY = 0.2825;
        const isSideStation = station.side;
        const isScharfreiterring = (station.name === "Scharfreiterring");
        const isRoethenbach = (station.name === "Röthenbach");
        const isHoheMarter = (station.name === "Hohe Marter");
        const isGrossreuth = (station.name === "Grossreuth bei Schweinau");
        const isSchweinau = (station.name === "Schweinau");
        const isStLeonhard = (station.name === "St. Leonhard");
        const isRothenburger = (station.name === "Rothenburger Straße");
        const isOpernhaus = (station.name === "Opernhaus");
        const isWoehrder = (station.name === "Wöhrder Wiese");
        const isRathenauplatz = (station.name === "Rathenauplatz");
        const isKlinikumNord = (station.name === "Klinikum Nord");
        const isFlughafen = (station.name === "Flughafen");
        const isMaxfeld = (station.name === "Maxfeld");
        const isRennweg = (station.name === "Rennweg");
        const isNordwestring = (station.name === "Nordwestring");
        const isFriedrichEbert = (station.name === "Friedrich-Ebert-Platz");
        // Scharfreiterring's platform edges and decorative middle tracks are meant to be
        // dead straight (real station). Sampling this.sim.getTrackSpacing(s)/getTrackY(s)
        // PER POSITION along their ~120-190m run bakes in the small independent-per-track
        // GPS reconstruction noise (lateral wobble) and, worse, the elevation RAMP that ends
        // inside this span (portal transition p1->sh1 lands ~50m from the station centre) -
        // that ramp is what made the decorative track bed visibly bend downward. Freezing
        // both to the station-centre value removes both: only the along-track curve (X/Z,
        // independent of spacing/elevation) still follows the real alignment.
        const schFixedSpacing = spacing;
        const schFixedY = centerPos.y;
        // const signMaterial = this.createStationSignMaterial(station.name);
        // const signGeom = new THREE.BoxGeometry(0.08, 0.6, 2.0);

        let eberhardshofRoofMat = null;
        let eberhardshofTubeGeom = null;
        if (station.name === "Eberhardshof") {
            eberhardshofRoofMat = new THREE.MeshLambertMaterial({
                color: '#a8a29e', // concrete stone-grey
                
                
                side: THREE.DoubleSide
            });
            eberhardshofTubeGeom = new THREE.CylinderGeometry(1.25, 1.25, 5.0, 16, 1, true, 0, Math.PI);
            eberhardshofTubeGeom.rotateY(-Math.PI / 2);
            eberhardshofTubeGeom.rotateX(Math.PI / 2);
        }

        let jakobinenstrasseSandstoneMat = null;
        let jakobinenstrasseCeilingLightMat = null;
        let jakobinenstrasseCeilingDarkMat = null;
        let jakobinenstrasseTextMat = null;

        let muggenhofRoofMat = null;
        let muggenhofGlassMat = null;
        let muggenhofStripeMat = null;
        let muggenhofColumnMat = null;
        let muggenhofColumnTex = null;
        let stadtgrenzeGlassMat = null;
        let stadtgrenzeFrameMat = null;
        let stadtgrenzeStripeMat = null;
        let stadtgrenzeGrassMat = null;
        let stadtgrenzeMullionMat = null;

        let aufsessplatzRedTileMat = null;
        let aufsessplatzWhiteTileMat = null;
        let aufsessplatzStripeMat = null;
        let aufsessplatzCeilingGeom = null;
        let aufsessplatzCeilingLightMat = null;
        let aufsessplatzCeilingDarkMat = null;

        let grossreuthLowerTileMat = null;
        let grossreuthUpperTileMat = null;
        let grossreuthSignMat = null;
        let grossreuthCeilingMat = null;
        let grossreuthTrackCeilingMat = null;
        let grossreuthBeamMat = null;
        let grossreuthSkylightMat = null;
        let grossreuthSkylightWallMat = null;

        if (isGrossreuth) {
            grossreuthLowerTileMat = this.createTiledMaterial('#333333', '#111111', 0.15);
            grossreuthUpperTileMat = this.getGrossreuthUpperTileMat();
            grossreuthSignMat = this.getGrossreuthSignMat();
            grossreuthCeilingMat = new THREE.MeshLambertMaterial({ color: '#B5B9C0' });
            grossreuthTrackCeilingMat = new THREE.MeshLambertMaterial({ color: '#ADADAF' });
            grossreuthBeamMat = new THREE.MeshLambertMaterial({ color: '#29261D' });
            grossreuthSkylightMat = new THREE.MeshBasicMaterial({ color: '#e0f2fe' });
            grossreuthSkylightWallMat = new THREE.MeshLambertMaterial({ color: '#cccccc' });
        }

        if (station.name === "Jakobinenstraße") {
            jakobinenstrasseSandstoneMat = this.createSandstoneMaterial();
            jakobinenstrasseCeilingLightMat = new THREE.MeshLambertMaterial({ color: '#d1d5db' });
            jakobinenstrasseCeilingDarkMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });

            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#27272a';
            ctx.font = 'bold 80px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("JAKOBINENSTRASSE", canvas.width / 2, canvas.height / 2);
            ctx.strokeStyle = '#27272a';
            ctx.lineWidth = 2.0;
            ctx.strokeText("JAKOBINENSTRASSE", canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            jakobinenstrasseTextMat = new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true
            });
        } else if (isAufsessplatzLook) {
            let tileColor = '#c74806';
            let groutColor = '#632403';
            if (station.name === "Hasenbuck") {
                tileColor = '#714a39';
                groutColor = '#38251c';
            } else if (station.name === "Frankenstraße") {
                tileColor = '#385580';
                groutColor = '#1c2a40';
            } else if (station.name === "Maffeiplatz") {
                tileColor = '#4e7c4e';
                groutColor = '#273e27';
            }
            aufsessplatzRedTileMat = this.createTiledMaterial(tileColor, groutColor, 0.15);
            aufsessplatzWhiteTileMat = this.createTiledMaterial('#b0b9b8', groutColor, 0.15);
            aufsessplatzStripeMat = this.createWallStripeMaterial(station.name, tileColor, '#ffffff');
        } else if (station.name === "Muggenhof") {
            // 1. Corrugated ceiling texture/material
            const canvasRoof = document.createElement('canvas');
            canvasRoof.width = 128;
            canvasRoof.height = 128;
            const ctxRoof = canvasRoof.getContext('2d');
            ctxRoof.fillStyle = '#cccccc'; // base grey
            ctxRoof.fillRect(0, 0, 128, 128);
            // Create corrugated sheet shadows (vertical lines)
            for (let x = 0; x < 128; x += 16) {
                ctxRoof.fillStyle = '#b3b3b3'; // dark shadow
                ctxRoof.fillRect(x, 0, 4, 128);
                ctxRoof.fillStyle = '#e6e6e6'; // bright highlight
                ctxRoof.fillRect(x + 4, 0, 4, 128);
            }
            const roofTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvasRoof));
            roofTex.wrapS = THREE.RepeatWrapping;
            roofTex.wrapT = THREE.RepeatWrapping;
            roofTex.repeat.set(10, 1);
            muggenhofRoofMat = new THREE.MeshLambertMaterial({
                map: roofTex,
                side: THREE.DoubleSide
            });

            // 2. Teal Glass
            this.materials.muggenhofGlass = new THREE.MeshLambertMaterial({
                color: '#14b8a6', // Teal
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            });
            muggenhofGlassMat = this.materials.muggenhofGlass;

            // 3. Chevron H-columns (pointing horizontally)
            const canvasCol = document.createElement('canvas');
            canvasCol.width = 256;
            canvasCol.height = 256;
            const ctxCol = canvasCol.getContext('2d');
            ctxCol.fillStyle = '#64748b'; // Slate grey base
            ctxCol.fillRect(0, 0, 256, 256);
            ctxCol.strokeStyle = '#ffffff';
            ctxCol.lineWidth = 16;
            ctxCol.lineJoin = 'round';
            ctxCol.lineCap = 'round';
            // Draw one single large horizontal chevron pointing to the right
            ctxCol.beginPath();
            ctxCol.moveTo(80, 60);
            ctxCol.lineTo(180, 128);
            ctxCol.lineTo(80, 196);
            ctxCol.stroke();
            
            muggenhofColumnTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvasCol));
            muggenhofColumnTex.wrapS = THREE.RepeatWrapping;
            muggenhofColumnTex.wrapT = THREE.RepeatWrapping;
            muggenhofColumnMat = new THREE.MeshLambertMaterial({ map: muggenhofColumnTex });

            // 4. Station name sign stripe
            muggenhofStripeMat = this.createWallStripeMaterial("Muggenhof", '#005b82', '#ffffff');
        } else if (station.name === "Stadtgrenze") {
            // 1. Ribbed Glass Material – lighter grey-blue, more transparent
            stadtgrenzeGlassMat = new THREE.MeshLambertMaterial({
                color: '#dce8ed',
                transparent: true,
                opacity: 0.55,
                side: THREE.DoubleSide
            });
            // 2. Steel-grey frame (unused for now)
            stadtgrenzeFrameMat = new THREE.MeshLambertMaterial({
                color: '#4a5568'
            });
            // 3. Grass mat (kept, not currently used)
            stadtgrenzeGrassMat = new THREE.MeshLambertMaterial({
                color: '#3b5e2b'
            });
            // 4. Dark-navy vertical mullion bars
            stadtgrenzeMullionMat = new THREE.MeshLambertMaterial({
                color: '#1a3a6b'
            });
            // (stadtgrenzeStripeMat left null – name band removed)
        }

        // Slat ceiling in the Aufseßplatz look, shared by the three Langwasser-branch
        // stations as well. The plates between the slat field and the side walls use the
        // rough concrete of the tunnel portals / Plärrer walls (not plain dark grey).
        const hasSlatCeiling = ["Weißer Turm", "Aufseßplatz", "Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte", "Hasenbuck", "Frankenstraße", "Maffeiplatz", "St. Leonhard"].includes(station.name);
        let slatCeilingConcreteMat = null;
        if (hasSlatCeiling) {
            // Slat texture canvas: 80% slat (#e2e8f0), 20% gap (#111111)
            const canvasSlat = document.createElement('canvas');
            canvasSlat.width = 16;
            canvasSlat.height = 128;
            const ctxSlat = canvasSlat.getContext('2d');
            const slatH = Math.round(128 * 0.8);
            ctxSlat.fillStyle = '#e2e8f0';
            ctxSlat.fillRect(0, 0, 16, slatH);
            ctxSlat.fillStyle = '#111111';
            ctxSlat.fillRect(0, slatH, 16, 128 - slatH);

            const slatTex = new THREE.CanvasTexture(canvasSlat);
            slatTex.wrapS = THREE.RepeatWrapping;
            slatTex.wrapT = THREE.RepeatWrapping;
            slatTex.colorSpace = THREE.SRGBColorSpace;
            slatTex.anisotropy = 8;
            slatTex.repeat.set(1, 5); // 5 repeats per meter -> repeats every 0.2 meters

            aufsessplatzCeilingLightMat = new THREE.MeshLambertMaterial({
                map: slatTex,
                side: THREE.DoubleSide
            });
            aufsessplatzCeilingDarkMat = new THREE.MeshLambertMaterial({ color: '#111111' });

            // Rough concrete for the side plates, tiled every 10m along the sweep (same
            // recipe as the Plärrer ceiling clone — buildSweptBar's material clone shares
            // this texture instance, so the repeat survives).
            slatCeilingConcreteMat = this.stationConcreteWallMat.clone();
            slatCeilingConcreteMat.map = this.stationConcreteWallMat.map.clone();
            slatCeilingConcreteMat.map.wrapS = slatCeilingConcreteMat.map.wrapT = THREE.RepeatWrapping;
            slatCeilingConcreteMat.map.repeat.set(1, 0.1);
            slatCeilingConcreteMat.map.needsUpdate = true;
            if (slatCeilingConcreteMat.bumpMap) {
                slatCeilingConcreteMat.bumpMap = this.stationConcreteWallMat.bumpMap.clone();
                slatCeilingConcreteMat.bumpMap.wrapS = slatCeilingConcreteMat.bumpMap.wrapT = THREE.RepeatWrapping;
                slatCeilingConcreteMat.bumpMap.repeat.set(1, 0.1);
                slatCeilingConcreteMat.bumpMap.needsUpdate = true;
            }
        }

        const wallPresets = {
            "Maximilianstraße": {
                bottomColor: '#f8fafc',
                bottomGrout: '#3e4033',
                topColor: '#6FB464',
                topGrout: '#3e4033',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Bärenschanze": {
                bottomColor: '#f8fafc',
                bottomGrout: '#3e4033',
                topColor: '#1f799e',
                topGrout: '#3e4033',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Gostenhof": {
                bottomColor: '#f8fafc',
                bottomGrout: '#3e4033',
                topColor: '#e0bf04',
                topGrout: '#3e4033',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Langwasser Süd": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#b0b9b8',
                topGrout: '#7e8a93',
                stripeBg: '#184763',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Gemeinschaftshaus": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#b0b9b8',
                topGrout: '#7e8a93',
                stripeBg: '#41525a',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Langwasser Mitte": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#b0b9b8',
                topGrout: '#7e8a93',
                stripeBg: '#51301b',
                stripeText: '#ffffff',
                flatTiles: true
            }
        };

        let wallTextMat = null;
        if (station.name === "Hardhöhe") {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#4b5563'; // medium-dark grey
            ctx.font = 'bold 90px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("HARDHÖHE", canvas.width / 2, canvas.height / 2);
            ctx.strokeStyle = '#4b5563';
            ctx.lineWidth = 2.0;
            ctx.strokeText("HARDHÖHE", canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            wallTextMat = new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true
            });
        } 

        const schPlatHalfWidth = 2.98; 
        const schPlatCenter = 4.21; 
        const schInnerEdge = schPlatCenter - schPlatHalfWidth; 
        const schOuterEdge = schPlatCenter + schPlatHalfWidth; 
        const schTrackCenter = schInnerEdge; 
        const schThirdRailX = schTrackCenter + 1.1;
        const schBallastWidth = schThirdRailX * 2;

        const isSpecialLangwasser = false;
        const S_len = 1.0; // Bahnsteig-Längsmaßstab: 1 Einheit = 1 Meter

        // Subdivide platform and walls into 5m segments spanning the geojson platform length
        const subLen = 5.0 * S_len;
        const numSub = Math.max(8, Math.round(platLength / subLen));

        for (let j = 0; j < numSub; j++) {
            const localZ_mid = -(numSub * subLen) / 2 + j * subLen + subLen / 2;
            const s_mid = station.position + localZ_mid;

            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
            const localPos = stationGroup.worldToLocal(pos.clone());

            // 1. Ground & Ceiling
            const localSchPlatHalfWidth = 3.5;
            const localSchPlatCenter = spacing / 2 - 5.03;
            const localSchTrackCenter = Math.max(1.23, spacing / 2 - 10.06);

            if (isScharfreiterring) {
                // Twin floor + ceiling slabs (solid) as continuous swept bars, built once.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    // The canopy stops short of the crossing building at the -Z platform end
                    // (photo: the building roof is the only cover there).
                    const sCeilA = station.position - 44 * S_len;
                    const cy = centerPos.y;
                    const flr = [this.materials.platform, this.materials.platform];
                    const cel = [this.materials.ceiling, this.materials.ceiling];
                    // Same asymmetric edges as the decks (outer follows the active track,
                    // inner dead straight along the fake middle tracks); chord anchored on
                    // the deck extents so all inner edges are collinear.
                    for (const sign of [1, -1]) {
                        const { off, hw } = this._schAsymEdges(
                            station.position - 53.5 * S_len, sB, sign,
                            schFixedSpacing / 2 - 8.53, 1.53);
                        this.buildSweptBar(stationGroup, sA, sB, hw, cy - 0.32, cy - 0.42, flr, 1.2, off);
                        this.buildSweptBar(stationGroup, sCeilA, sB, hw, cy + 4.76, cy + 4.56, cel, 1.2, off);
                    }
                }
            } else if (station.name === "Muggenhof") {
                const groundWidth = spacing + 11.1; // double track + side platforms
                const halfWidth = groundWidth / 2;
                const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));
                const cy = centerPos.y;

                // 1. Viaduct floor bed under the tracks (ballast + viaduct slab)
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    // Concrete viaduct deck under the tracks: Y = cy - 0.35 to cy - 0.95, width = spacing + 3.0
                    const vHalfW = (s) => (this.sim.getTrackSpacing(s) + 3.0) / 2;
                    this.buildSweptBar(stationGroup, sA, sB, vHalfW, cy - 0.35, cy - 0.95, [this.materials.platform, this.materials.platform], 1.2);

                    // Central concrete wall between the tracks: Y from cy - 0.35 to cy + 1.1, width = 0.6m
                    const wallMats = [this.materials.platform, this.materials.platform];
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.3, cy + 1.1, cy - 0.35, wallMats, 1.2, () => 0);

                    // Under-viaduct concrete columns supporting the station from the street level (Y = -7.0)
                    const pillOffset = 15.0;
                    for (let sVal = sA + 5; sVal <= sB - 5; sVal += pillOffset) {
                        const pPos = this.sim.getTrackPosition(sVal);
                        const pTan = this.sim.getTrackTangent(sVal);
                        const pRotY = Math.atan2(pTan.x, pTan.z) - centerAngle;
                        const pLocal = stationGroup.worldToLocal(pPos.clone());
                        
                        // Create a thick rectangular concrete viaduct pillar
                        const pillarGeom = new THREE.BoxGeometry(this.sim.getTrackSpacing(sVal) + 1.0, 7.0 - 0.95, 2.5);
                        const pillarMesh = new THREE.Mesh(pillarGeom, this.materials.platform);
                        pillarMesh.position.copy(pLocal);
                        pillarMesh.position.y = -7.0 + (7.0 - 0.95) / 2;
                        pillarMesh.rotation.y = pRotY;
                        stationGroup.add(pillarMesh);
                    }

                    // 2. Central elevator shafts (glass and steel) under the middle of the station going from street Y = -7.0 to platform Y = 0.865
                    // Place two elevator shafts: one for the left platform (at Z = -5.0) and one for the right platform (at Z = 5.0)
                    [1, -1].forEach(sideSign => {
                        const zOffset = sideSign * 5.0;
                        const sVal = station.position + zOffset;
                        const ePos = this.sim.getTrackPosition(sVal);
                        const eTan = this.sim.getTrackTangent(sVal);
                        const eRotY = Math.atan2(eTan.x, eTan.z) - centerAngle;
                        const eNormal = new THREE.Vector3(-eTan.z, 0, eTan.x);
                        
                        // Shift elevator to be flush with the outer edge of the platform in world space, then convert to local
                        const ePosWorld = ePos.clone().addScaledVector(eNormal, sideSign * (this.sim.getTrackSpacing(sVal) / 2 + 4.54));
                        const eLocal = stationGroup.worldToLocal(ePosWorld);
                        
                        const shaftH = 7.0 + 0.865 + 2.2; // ground to above platform floor
                        const shaftGeom = new THREE.BoxGeometry(2.0, shaftH, 2.0);
                        const shaftMesh = new THREE.Mesh(shaftGeom, muggenhofGlassMat);
                        shaftMesh.position.copy(eLocal);
                        shaftMesh.position.y = -7.0 + shaftH / 2;
                        shaftMesh.rotation.y = eRotY;
                        stationGroup.add(shaftMesh);

                        // Elevator steel frame corners
                        const frameGeom = new THREE.BoxGeometry(0.1, shaftH, 0.1);
                        const fOffsets = [[-0.95, -0.95], [-0.95, 0.95], [0.95, -0.95], [0.95, 0.95]];
                        fOffsets.forEach(fo => {
                            const frame = new THREE.Mesh(frameGeom, this.materials.boardCasing);
                            frame.position.copy(eLocal).add(new THREE.Vector3(fo[0], 0, fo[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), eRotY));
                            frame.position.y = -7.0 + shaftH / 2;
                            frame.rotation.y = eRotY;
                            stationGroup.add(frame);
                        });

                        // Elevator cabin inside
                        const cabinGeom = new THREE.BoxGeometry(1.6, 2.2, 1.6);
                        const cabin = new THREE.Mesh(cabinGeom, this.materials.pillar);
                        cabin.position.copy(eLocal);
                        // Place cabin midway
                        cabin.position.y = -3.0;
                        cabin.rotation.y = eRotY;
                        stationGroup.add(cabin);
                    });
                }

                // 3. Corrugated dual-pitch ceiling
                // Highest in the center (Y = 4.8m), sloping down to Y = 4.2m at the sides.
                const roofHalfWidth = halfWidth;
                const slopeAngle = Math.atan2(0.6, roofHalfWidth);
                const roofThickness = 0.08;
                
                // Left roof slab:
                const roofL = new THREE.Mesh(new THREE.BoxGeometry(roofHalfWidth, roofThickness, subLen), muggenhofRoofMat);
                roofL.position.copy(localPos).addScaledVector(localNorm, -roofHalfWidth / 2);
                roofL.position.y = 4.5;
                roofL.rotation.set(0, rotY, -slopeAngle, 'YXZ');
                
                // Right roof slab:
                const roofR = new THREE.Mesh(new THREE.BoxGeometry(roofHalfWidth, roofThickness, subLen), muggenhofRoofMat);
                roofR.position.copy(localPos).addScaledVector(localNorm, roofHalfWidth / 2);
                roofR.position.y = 4.5;
                roofR.rotation.set(0, rotY, slopeAngle, 'YXZ');
                
                stationGroup.add(roofL, roofR);

                // 4. Rafter support beams (H-beams running transversely under the roof)
                const rafterL = new THREE.Mesh(new THREE.BoxGeometry(roofHalfWidth, 0.12, 0.08), this.materials.pillar);
                rafterL.position.copy(localPos).addScaledVector(localNorm, -roofHalfWidth / 2);
                rafterL.position.y = 4.5 - 0.08;
                rafterL.rotation.set(0, rotY, -slopeAngle, 'YXZ');

                const rafterR = new THREE.Mesh(new THREE.BoxGeometry(roofHalfWidth, 0.12, 0.08), this.materials.pillar);
                rafterR.position.copy(localPos).addScaledVector(localNorm, roofHalfWidth / 2);
                rafterR.position.y = 4.5 - 0.08;
                rafterR.rotation.set(0, rotY, slopeAngle, 'YXZ');

                stationGroup.add(rafterL, rafterR);

                // 5. Standard barrel light channel above the side platforms
                // (Wöhrder-Wiese-Modell, see buildBarrelLights), hung from the roof rafters.
                if (j === 0) {
                    this.buildBarrelLights(stationGroup, {
                        startS: station.position - platLength / 2 + 3.0,
                        endS: station.position + platLength / 2 - 3.0,
                        axisY: 3.7,
                        centerPosY: centerPos.y,
                        centerAngle,
                        offFn: (s) => this.sim.getTrackSpacing(s) / 2 + 2.5,
                        ceilY: 4.5,
                        label: station.name,
                    });
                }
                // 6. Outer Walls (Plinth + Glass Windows + Name signs)
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    
                    // Plinths (white/light grey concrete base)
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.03, cy + 1.665, cy - 0.38, [this.materials.boardCasing, this.materials.boardCasing], 1.2, (s) => this.sim.getTrackSpacing(s) / 2 + 5.55);
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.03, cy + 1.665, cy - 0.38, [this.materials.boardCasing, this.materials.boardCasing], 1.2, (s) => -(this.sim.getTrackSpacing(s) / 2 + 5.55));
                    
                    // Glass Windows (teal translucent glass)
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.01, cy + 4.2, cy + 1.665, [muggenhofGlassMat, muggenhofGlassMat], 1.2, (s) => this.sim.getTrackSpacing(s) / 2 + 5.55);
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.01, cy + 4.2, cy + 1.665, [muggenhofGlassMat, muggenhofGlassMat], 1.2, (s) => -(this.sim.getTrackSpacing(s) / 2 + 5.55));

                    // Station Name Stripes
                    const repeatX = Math.round(platLength / (0.35 * 6));
                    this.buildSweptWall(stationGroup, sA, sB, (s) => this.sim.getTrackSpacing(s) / 2 + 5.53, cy + 1.0, cy + 1.22, muggenhofStripeMat, 90 / repeatX, 0, 1);
                    this.buildSweptWall(stationGroup, sA, sB, (s) => -(this.sim.getTrackSpacing(s) / 2 + 5.53), cy + 1.0, cy + 1.22, muggenhofStripeMat, 90 / repeatX, 0, 1);
                }

                // Vertical window frames (steel posts) every 5m segment boundary
                const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.2 - 1.665, 0.08), this.materials.boardCasing);
                frameL.position.copy(localPos).addScaledVector(localNorm, -(spacing / 2 + 5.55));
                frameL.position.y = 1.665 + (4.2 - 1.665) / 2;
                frameL.rotation.y = rotY;
                
                const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.2 - 1.665, 0.08), this.materials.boardCasing);
                frameR.position.copy(localPos).addScaledVector(localNorm, spacing / 2 + 5.55);
                frameR.position.y = 1.665 + (4.2 - 1.665) / 2;
                frameR.rotation.y = rotY;

                stationGroup.add(frameL, frameR);
            } else if (station.name === "Stadtgrenze") {
                const groundWidth = spacing + 11.1; // double track + side platforms
                const halfWidth = groundWidth / 2;
                const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));
                const cy = centerPos.y;

                // 1. Under-platform concrete deck (built once on j === 0)
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const vHalfW = (s) => (this.sim.getTrackSpacing(s) + 11.1) / 2;
                    this.buildSweptBar(stationGroup, sA, sB, vHalfW, cy - 0.35, cy - 0.95, [this.materials.platform, this.materials.platform], 1.2);
                }

                // 2. Folded Plate / Sawtooth Roof – 1m higher than before
                // Valley Y = 5.2m, Peak Y = 5.8m, rise = 0.6m over half a 5m segment (2.5m)
                const roofValleyY = 5.2;
                const roofPeakY  = 5.8;
                const roofRise   = roofPeakY - roofValleyY; // 0.6m
                const roofRun    = subLen / 2;              // 2.5m
                const slopeLen   = Math.sqrt(roofRun * roofRun + roofRise * roofRise);
                const slopeAngle = Math.atan2(roofRise, roofRun);

                const roofSlabGeom = new THREE.BoxGeometry(groundWidth, 0.1, slopeLen);
                // Alternating colours: ascending slab darker, descending slab lighter
                const roofDarkMat  = new THREE.MeshLambertMaterial({ color: '#9e9a94' });
                const roofLightMat = new THREE.MeshLambertMaterial({ color: '#d4d0c8' });

                // Slab 1 (slopes UP toward the peak) – darker
                const slab1 = new THREE.Mesh(roofSlabGeom, roofDarkMat);
                slab1.position.copy(localPos).addScaledVector(localDir, -roofRun / 2);
                slab1.position.y = (roofValleyY + roofPeakY) / 2;
                slab1.rotation.set(slopeAngle, rotY, 0, 'YXZ');
                
                // Slab 2 (slopes DOWN from the peak) – lighter
                const slab2 = new THREE.Mesh(roofSlabGeom, roofLightMat);
                slab2.position.copy(localPos).addScaledVector(localDir, roofRun / 2);
                slab2.position.y = (roofValleyY + roofPeakY) / 2;
                slab2.rotation.set(-slopeAngle, rotY, 0, 'YXZ');
                
                stationGroup.add(slab1, slab2);

                // 3. Transverse neon tubes at each sawtooth valley (j===0 builds all of them at once)
                if (j === 0) {
                    // Each valley is at a segment BOUNDARY: sA, sA+subLen, sA+2*subLen, …, sB
                    const sA = station.position - platLength / 2;
                    const tubeSpan = groundWidth; // full width wall-to-wall
                    const ductGeom = new THREE.BoxGeometry(tubeSpan, 0.08, 0.10);
                    const glowGeom = new THREE.BoxGeometry(tubeSpan, 0.03, 0.06);
                    const ductMat  = new THREE.MeshLambertMaterial({ color: '#374151' });
                    const glowMat  = this.materials.lightTube; // white emissive

                    for (let i = 0; i <= numSub; i++) {
                        const sVal  = sA + i * subLen;
                        const tPos  = this.sim.getTrackPosition(sVal);
                        const tTan  = this.sim.getTrackTangent(sVal);
                        const tRotY = Math.atan2(tTan.x, tTan.z) - centerAngle;
                        const tLoc  = stationGroup.worldToLocal(tPos.clone());

                        const duct = new THREE.Mesh(ductGeom, ductMat);
                        duct.position.copy(tLoc);
                        duct.position.y = roofValleyY - 0.12; // just below valley apex
                        duct.rotation.y = tRotY;

                        const glow = new THREE.Mesh(glowGeom, glowMat);
                        glow.position.copy(tLoc);
                        glow.position.y = roofValleyY - 0.17;
                        glow.rotation.y = tRotY;

                        stationGroup.add(duct, glow);
                    }
                }

                // 4. Longitudinal beams (1m tall) above V-pillar heads, per segment
                // The beam runs the full segment length at each platform side
                const beamTop = roofValleyY;   // bottom of the roof valley
                const beamH   = 1.5;           // 1.5m tall – beam sits higher, shortening V-pillar zone
                const beamY   = beamTop - beamH / 2;
                const beamOff = spacing / 2 + 4.05; // 1.5m from outer wall (spacing/2 + 5.55)

                const posBeamL   = pos.clone().addScaledVector(normal, -beamOff);
                const posBeamR   = pos.clone().addScaledVector(normal,  beamOff);
                const localBeamL = stationGroup.worldToLocal(posBeamL);
                const localBeamR = stationGroup.worldToLocal(posBeamR);

                const beamGeom = new THREE.BoxGeometry(0.5, beamH, subLen);
                const beamL    = new THREE.Mesh(beamGeom, this.materials.platform);
                beamL.position.copy(localBeamL); beamL.position.y = beamY; beamL.rotation.y = rotY;
                const beamR    = new THREE.Mesh(beamGeom, this.materials.platform);
                beamR.position.copy(localBeamR); beamR.position.y = beamY; beamR.rotation.y = rotY;
                stationGroup.add(beamL, beamR);

                // 5. Outer Walls – glass from Y=1.0 to roofPeakY (flush with roof peak)
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const wallTop = roofPeakY; // 5.8m – flush with the sawtooth peaks

                    // Plinths (concrete base)
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.03, cy + 1.0, cy - 0.38, [this.materials.boardCasing, this.materials.boardCasing], 1.2, (s) =>  this.sim.getTrackSpacing(s) / 2 + 5.55);
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.03, cy + 1.0, cy - 0.38, [this.materials.boardCasing, this.materials.boardCasing], 1.2, (s) => -this.sim.getTrackSpacing(s) / 2 - 5.55);

                    // Translucent ribbed glass windows: Y = 1.0m to wallTop
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.01, cy + wallTop, cy + 1.0, [stadtgrenzeGlassMat, stadtgrenzeGlassMat], 1.2, (s) =>  this.sim.getTrackSpacing(s) / 2 + 5.55);
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.01, cy + wallTop, cy + 1.0, [stadtgrenzeGlassMat, stadtgrenzeGlassMat], 1.2, (s) => -this.sim.getTrackSpacing(s) / 2 - 5.55);
                    // (no name-band signboard)
                }

                // Dark-navy vertical mullion bars along both glass walls every 2.5m
                // (added per segment so they follow the track curve)
                {
                    const mullionH    = roofPeakY - 1.0;  // full glass-wall height (4.8m)
                    const mullionGeom = new THREE.BoxGeometry(0.08, mullionH, 0.08);
                    // Local Y: bottom of glass is at 1.0m local, centre of bar is at 1.0 + mullionH/2
                    const mullionY    = 1.0 + mullionH / 2;
                    const wallOff     = spacing / 2 + 5.55;
                    // 2 mullions per 5m segment at ±1.25m from segment centre
                    for (let mOff = -1.25; mOff <= subLen / 2; mOff += 2.5) {
                        const mBaseL = pos.clone().addScaledVector(normal, -wallOff).addScaledVector(tangent, mOff);
                        const mBaseR = pos.clone().addScaledVector(normal,  wallOff).addScaledVector(tangent, mOff);
                        const mulL = new THREE.Mesh(mullionGeom, stadtgrenzeMullionMat);
                        mulL.position.copy(stationGroup.worldToLocal(mBaseL));
                        mulL.position.y = mullionY;
                        mulL.rotation.y = rotY;
                        const mulR = new THREE.Mesh(mullionGeom, stadtgrenzeMullionMat);
                        mulR.position.copy(stationGroup.worldToLocal(mBaseR));
                        mulR.position.y = mullionY;
                        mulR.rotation.y = rotY;
                        stationGroup.add(mulL, mulR);
                    }
                }
            } else if (station.name === "Hardhöhe") {
                const groundWidth = spacing + 2.6; // double track tunnel width
                const platWidth = spacing - 3.08; // platform width (Kante +0.43 m für vollbreiten Zug)
                const trackWidth = (groundWidth - platWidth) / 2; // track bed width on each side
                
                // Track direction and normal vectors
                const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));

                // 1. Floor: track beds (ballast) as continuous swept strips, built once.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const cy = centerPos.y;
                    const bedProfile = [{ x: -trackWidth / 2, y: -0.375 }, { x: trackWidth / 2, y: -0.375 }];
                    const bedOff = (s) => (this.sim.getTrackSpacing(s) - 3.08 + trackWidth) / 2; // (platWidth+trackWidth)/2
                    this.buildSweptProfile(stationGroup, sA, sB, bedProfile, cy, (s) => -bedOff(s), this.materials.ballast, 1);
                    this.buildSweptProfile(stationGroup, sA, sB, bedProfile, cy, (s) => bedOff(s), this.materials.ballast, 1);
                }

                // 2. Ceiling (high steel-blue, 4.8m, with daylight inlets):
                const ceilMatBlue = new THREE.MeshLambertMaterial({ color: '#3a5f78' }); // steel-blue
                const ceilMatConcrete = new THREE.MeshLambertMaterial({ color: '#cccccc' }); // light concrete for skylight

                const hasSkylight = (j >= 2 && j <= 15 && j % 2 === 0);
                if (hasSkylight) {
                    const ceilW = (groundWidth - 3.5) / 2;
                    const ceilL = new THREE.Mesh(new THREE.BoxGeometry(ceilW, 0.2, subLen), ceilMatBlue);
                    ceilL.position.copy(localPos).addScaledVector(localNorm, -(groundWidth + 3.5) / 4);
                    ceilL.position.y = 4.8;
                    ceilL.rotation.y = rotY;
                    
                    const ceilR = new THREE.Mesh(new THREE.BoxGeometry(ceilW, 0.2, subLen), ceilMatBlue);
                    ceilR.position.copy(localPos).addScaledVector(localNorm, (groundWidth + 3.5) / 4);
                    ceilR.position.y = 4.8;
                    ceilR.rotation.y = rotY;
                    
                    const ceilF = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 0.75), ceilMatBlue);
                    ceilF.position.copy(localPos).addScaledVector(localDir, -2.125);
                    ceilF.position.y = 4.8;
                    ceilF.rotation.y = rotY;
                    
                    const ceilB = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 0.75), ceilMatBlue);
                    ceilB.position.copy(localPos).addScaledVector(localDir, 2.125);
                    ceilB.position.y = 4.8;
                    ceilB.rotation.y = rotY;
                    
                    stationGroup.add(ceilL, ceilR, ceilF, ceilB);
                    
                    // Recessed skylight walls (from y=4.8 to y=5.6):
                    const recWL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 3.5), ceilMatConcrete);
                    recWL.position.copy(localPos).addScaledVector(localNorm, -1.75);
                    recWL.position.y = 5.2;
                    recWL.rotation.y = rotY;
                    
                    const recWR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 3.5), ceilMatConcrete);
                    recWR.position.copy(localPos).addScaledVector(localNorm, 1.75);
                    recWR.position.y = 5.2;
                    recWR.rotation.y = rotY;
                    
                    const recWF = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.1), ceilMatConcrete);
                    recWF.position.copy(localPos).addScaledVector(localDir, -1.75);
                    recWF.position.y = 5.2;
                    recWF.rotation.y = rotY;
                    
                    const recWB = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.1), ceilMatConcrete);
                    recWB.position.copy(localPos).addScaledVector(localDir, 1.75);
                    recWB.position.y = 5.2;
                    recWB.rotation.y = rotY;
                    
                    // Skylight basic cap:
                    const skylightMat = new THREE.MeshBasicMaterial({ color: '#e0f2fe' });
                    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 3.5), skylightMat);
                    cap.position.copy(localPos);
                    cap.position.y = 5.6;
                    cap.rotation.y = rotY;
                    
                    stationGroup.add(recWL, recWR, recWF, recWB, cap);
                } else {
                    const ceilSolid = new THREE.Mesh(new THREE.BoxGeometry(groundWidth, 0.2, subLen), ceilMatBlue);
                    ceilSolid.position.copy(localPos);
                    ceilSolid.position.y = 4.8;
                    ceilSolid.rotation.y = rotY;
                    stationGroup.add(ceilSolid);
                }
                
                // 3. Standard barrel light channel (Wöhrder-Wiese-Modell, see
                // buildBarrelLights), hung from the 4.8m steel-blue ceiling.
                if (j === 0) {
                    this.buildBarrelLights(stationGroup, {
                        startS: station.position - platLength / 2 + 3.0,
                        endS: station.position + platLength / 2 - 3.0,
                        axisY: 3.8,
                        centerPosY: centerPos.y,
                        centerAngle,
                        offFn: (s) => this.sim.getTrackSpacing(s) / 2 - 1.785,
                        ceilY: 4.8,
                        label: station.name,
                    });
                }

                // 4. Slanted ceiling panels (5 rows on each side, only at j = 7, 9, 11, 13)
                const artIndices = [7, 9, 11, 13];
                if (artIndices.includes(j)) {
                    const panelWidth = 1.0;
                    const panelLen = 5.2;
                    const panelMatLighterBlue = new THREE.MeshLambertMaterial({ color: '#5180a4' });
                    
                    // Left Track Ceiling Panels - facing platform
                    const xStartL = -spacing / 2 - 1.4;
                    const xEndL = -spacing / 2 + 1.785;
                    const stepL = (xEndL - xStartL) / 5;
                    
                    for (let r = 0; r < 5; r++) {
                        const x_r = xStartL + (r + 0.5) * stepL;
                        const y_r = 4.65 - r * 0.08; // steps down from left wall to platform
                        
                        const panelPos = localPos.clone().addScaledVector(localNorm, x_r);
                        panelPos.y = y_r;
                        
                        const panel = new THREE.Mesh(new THREE.BoxGeometry(panelWidth, 0.02, panelLen), panelMatLighterBlue);
                        panel.position.copy(panelPos);
                        panel.rotation.set(0, rotY, -0.65); // slant towards platform
                        stationGroup.add(panel);
                    }
                    
                    // Right Track Ceiling Panels - facing platform
                    const xStartR = spacing / 2 - 1.785;
                    const xEndR = spacing / 2 + 1.4;
                    const stepR = (xEndR - xStartR) / 5;
                    
                    for (let r = 0; r < 5; r++) {
                        const x_r = xStartR + (r + 0.5) * stepR;
                        const y_r = 4.65 - (4 - r) * 0.08; // steps down from right wall to platform
                        
                        const panelPos = localPos.clone().addScaledVector(localNorm, x_r);
                        panelPos.y = y_r;
                        
                        const panel = new THREE.Mesh(new THREE.BoxGeometry(panelWidth, 0.02, panelLen), panelMatLighterBlue);
                        panel.position.copy(panelPos);
                        panel.rotation.set(0, rotY, 0.65); // slant towards platform
                        stationGroup.add(panel);
                    }
                }
            } else {
                const groundWidth = isSideStation ? (spacing + 11.1) : (spacing + 3.66);
                // Floor as ONE continuous swept slab (solid colour -> no UV concerns), built once
                // on j===0, tapering with the inter-track gap. Replaces the per-5m boxes.
                if (j === 0 && station.name !== "Rothenburger Straße" && station.name !== "Rathenauplatz") {
                    const gHalfW = (s) => (this.sim.getTrackSpacing(s) + (isSideStation ? 11.1 : 3.66)) / 2;
                    this.buildSweptBar(stationGroup, station.position - platLength / 2, station.position + platLength / 2,
                        gHalfW, centerPos.y - 0.33, centerPos.y - 0.43,
                        [this.materials.platform, this.materials.platform], 1.2);
                }

                if (station.name === "Eberhardshof") {
                    // Central slab + 4 barrel vaults as continuous swept meshes, built once.
                    if (j === 0) {
                        const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                        const cy = centerPos.y;
                        // 1. central longitudinal slab (flat, solid)
                        this.buildSweptBar(stationGroup, sA, sB, () => 1.5, cy + 4.85, cy + 4.45, [this.materials.pillar, this.materials.pillar], 1.2);
                        // 2. four half-cylinder barrel vaults (semicircle cross-section swept along the track)
                        // half-circle opening UPWARD (concave up, like a trough): y dips below the rim
                        const arc = [];
                        for (let k = 0; k <= 16; k++) { const t = Math.PI * k / 16; arc.push({ x: 1.25 * Math.cos(t), y: 4.85 - 1.25 * Math.sin(t) }); }
                        [-3.75, -1.25, 1.25, 3.75].forEach(tx => {
                            this.buildSweptProfile(stationGroup, sA, sB, arc, cy, () => tx, eberhardshofRoofMat, 1e9);
                        });
                    }
                } else if (["Jakobinenstraße", "Hohe Marter", "Wöhrder Wiese", "Rathenauplatz", "Grossreuth bei Schweinau"].includes(station.name)) {
                    if (station.name === "Jakobinenstraße") {
                        const slopeAngle = Math.atan2(1.0, 1.25);
                        const plateOverlap = 0.08; // kleine Überlappung an den Knicklinien (Tälern), um Lücken zu schließen
                        const plateLength = Math.sqrt(1.25 * 1.25 + 1.0 * 1.0) + plateOverlap;
                        const plateWidth = groundWidth;

                        // Alternate ceiling segment colors: light vs dark concrete
                        const ceilMat = (j % 2 === 0) ? jakobinenstrasseCeilingLightMat : jakobinenstrasseCeilingDarkMat;

                        const p1aPosWorld = pos.clone().addScaledVector(tangent, -1.875);
                        const plate1a = new THREE.Mesh(
                            new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                            ceilMat
                        );
                        plate1a.position.copy(stationGroup.worldToLocal(p1aPosWorld));
                        plate1a.position.y = 5.5; // shifted up
                        plate1a.rotation.set(-slopeAngle, rotY, 0, 'YXZ');

                        const p1bPosWorld = pos.clone().addScaledVector(tangent, -0.625);
                        const plate1b = new THREE.Mesh(
                            new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                            ceilMat
                        );
                        plate1b.position.copy(stationGroup.worldToLocal(p1bPosWorld));
                        plate1b.position.y = 5.5;
                        plate1b.rotation.set(slopeAngle, rotY, 0, 'YXZ');
                        
                        const p2aPosWorld = pos.clone().addScaledVector(tangent, 0.625);
                        const plate2a = new THREE.Mesh(
                            new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                            ceilMat
                        );
                        plate2a.position.copy(stationGroup.worldToLocal(p2aPosWorld));
                        plate2a.position.y = 5.5;
                        plate2a.rotation.set(-slopeAngle, rotY, 0, 'YXZ');

                        const p2bPosWorld = pos.clone().addScaledVector(tangent, 1.875);
                        const plate2b = new THREE.Mesh(
                            new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                            ceilMat
                        );
                        plate2b.position.copy(stationGroup.worldToLocal(p2bPosWorld));
                        plate2b.position.y = 5.5;
                        plate2b.rotation.set(slopeAngle, rotY, 0, 'YXZ');

                        stationGroup.add(plate1a, plate1b, plate2a, plate2b);
                    }

                    // Concrete light girders + their neon tubes, swept continuously along the
                    // true curve (built once), instead of a straight 5m box per segment.
                    const girderH = 0.25;
                    const girderY = 3.775;
                    const girderMat = this.materials.boardHanger; // solid dark color
                    const lightOffFn = (s) => this.sim.getTrackSpacing(s) / 2 - 1.785;
                    const tubeY = girderY - girderH / 2 - 0.035; // hang slightly below the bottom of the girder
                    const ceilHangerY = (station.name === "Jakobinenstraße") ? 6.0 : (station.name === "Rathenauplatz" ? 9.9 : (isGrossreuth ? 5.52 : (isWoehrder ? 9.9 : 4.56)));
                    const girderTopY = girderY + girderH / 2;
                    const hangerLen = ceilHangerY - girderTopY;
                    const hangerY = (ceilHangerY + girderTopY) / 2;
                    const hangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 8);

                    if (j === 0) {
                        const R2 = station.position - (numSub * subLen) / 2;
                        const gsA = R2, gsB = R2 + numSub * subLen;
                        
                        // Build flat ceiling if not Jakobinenstraße
                        if (station.name !== "Jakobinenstraße") {
                            let ceilY = (station.name === "Rathenauplatz") ? 10.0 : (station.name === "Opernhaus" ? 7.04 : (isWoehrder ? 10.0 : 4.66));
                            if (isGrossreuth) ceilY = 5.62;

                            const hMeters = (station.name === "Rathenauplatz") ? 4.0 : (isWoehrder ? 6.0 : 1.2);
                            const wMeters = (station.name === "Rathenauplatz") ? 4.0 : (isWoehrder ? 6.0 : 1.2);
                            let ceilMat = this.materials.ceiling;
                            if (station.name === "Hohe Marter" || station.name === "Rathenauplatz") {
                                ceilMat = this.maximilianstrasseCeilingMat;
                            } else if (station.name === "Wöhrder Wiese") {
                                ceilMat = this.getWoehrderRockMat(); // dark rough rock ceiling (photos)
                            }

                            if (isGrossreuth) {
                                // 1. Platform area ceiling (center) with skylights
                                for (let jj = 0; jj < numSub; jj++) {
                                    const s_mid = gsA + (jj + 0.5) * subLen;
                                    const posSub = this.sim.getTrackPosition(s_mid);
                                    const tanSub = this.sim.getTrackTangent(s_mid);
                                    const rotYSubRel = Math.atan2(tanSub.x, tanSub.z) - centerAngle;

                                    const localPosSub = stationGroup.worldToLocal(posSub.clone());
                                    const localDir = new THREE.Vector3(Math.sin(rotYSubRel), 0, Math.cos(rotYSubRel));
                                    const localNorm = new THREE.Vector3(-Math.cos(rotYSubRel), 0, Math.sin(rotYSubRel));

                                    const spacingSub = this.sim.getTrackSpacing(s_mid);
                                    const platWSub = spacingSub - 3.4;

                                    const hasSkylight = (jj >= 2 && jj <= numSub - 3 && jj % 2 === 0);

                                    if (hasSkylight) {
                                        const holeW = 3.5;
                                        const holeL = 3.5;
                                        const ceilW = (platWSub - holeW) / 2;
                                        const endL = (subLen - holeL) / 2;

                                        // Left/Right slabs
                                        if (ceilW > 0) {
                                            const ceilL = new THREE.Mesh(new THREE.BoxGeometry(ceilW, 0.2, subLen), grossreuthCeilingMat);
                                            ceilL.position.copy(localPosSub).addScaledVector(localNorm, -(holeW + ceilW) / 2);
                                            ceilL.position.y = ceilY;
                                            ceilL.rotation.y = rotYSubRel;
                                            stationGroup.add(ceilL);

                                            const ceilR = new THREE.Mesh(new THREE.BoxGeometry(ceilW, 0.2, subLen), grossreuthCeilingMat);
                                            ceilR.position.copy(localPosSub).addScaledVector(localNorm, (holeW + ceilW) / 2);
                                            ceilR.position.y = ceilY;
                                            ceilR.rotation.y = rotYSubRel;
                                            stationGroup.add(ceilR);
                                        }

                                        // Front/Back slabs
                                        const ceilF = new THREE.Mesh(new THREE.BoxGeometry(holeW, 0.2, endL), grossreuthCeilingMat);
                                        ceilF.position.copy(localPosSub).addScaledVector(localDir, -2.125);
                                        ceilF.position.y = ceilY;
                                        ceilF.rotation.y = rotYSubRel;
                                        stationGroup.add(ceilF);

                                        const ceilB = new THREE.Mesh(new THREE.BoxGeometry(holeW, 0.2, endL), grossreuthCeilingMat);
                                        ceilB.position.copy(localPosSub).addScaledVector(localDir, 2.125);
                                        ceilB.position.y = ceilY;
                                        ceilB.rotation.y = rotYSubRel;
                                        stationGroup.add(ceilB);

                                        // Recess walls
                                        const recWL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 3.5), grossreuthSkylightWallMat);
                                        recWL.position.copy(localPosSub).addScaledVector(localNorm, -1.75);
                                        recWL.position.y = ceilY + 0.4;
                                        recWL.rotation.y = rotYSubRel;

                                        const recWR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 3.5), grossreuthSkylightWallMat);
                                        recWR.position.copy(localPosSub).addScaledVector(localNorm, 1.75);
                                        recWR.position.y = ceilY + 0.4;
                                        recWR.rotation.y = rotYSubRel;

                                        const recWF = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.1), grossreuthSkylightWallMat);
                                        recWF.position.copy(localPosSub).addScaledVector(localDir, -1.75);
                                        recWF.position.y = ceilY + 0.4;
                                        recWF.rotation.y = rotYSubRel;

                                        const recWB = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.1), grossreuthSkylightWallMat);
                                        recWB.position.copy(localPosSub).addScaledVector(localDir, 1.75);
                                        recWB.position.y = ceilY + 0.4;
                                        recWB.rotation.y = rotYSubRel;

                                        // Cap
                                        const cap = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 3.5), grossreuthSkylightMat);
                                        cap.position.copy(localPosSub);
                                        cap.position.y = ceilY + 0.8;
                                        cap.rotation.y = rotYSubRel;

                                        stationGroup.add(recWL, recWR, recWF, recWB, cap);
                                    } else {
                                        const ceilSolid = new THREE.Mesh(new THREE.BoxGeometry(platWSub, 0.2, subLen), grossreuthCeilingMat);
                                        ceilSolid.position.copy(localPosSub);
                                        ceilSolid.position.y = ceilY;
                                        ceilSolid.rotation.y = rotYSubRel;
                                        stationGroup.add(ceilSolid);
                                    }
                                }

                                // Track area ceiling (sides) - specifically over the rails
                                for (const sign of [1, -1]) {
                                    // Rail center is at spacing/2. Standard gauge is ~1.435m.
                                    // Let's make it a bit wider to cover the track bed properly (~2.5m total).
                                    const trackWidth = 2.5;
                                    const trackHalfW = trackWidth / 2;
                                    const trackCenter = (s) => sign * (this.sim.getTrackSpacing(s) / 2);

                                    this.buildSweptBar(stationGroup, gsA, gsB,
                                        () => trackHalfW, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                        [grossreuthTrackCeilingMat, grossreuthTrackCeilingMat], hMeters, trackCenter, wMeters);

                                    // Beam in #29261D - in between the platform ceiling and the track ceiling strip
                                    const beamHalfW = (s) => 0.15;
                                    const beamLateralPos = (s) => sign * (this.sim.getTrackSpacing(s) / 2 - 1.55);
                                    this.buildSweptBar(stationGroup, gsA, gsB,
                                        beamHalfW, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                        [grossreuthBeamMat, grossreuthBeamMat], hMeters, beamLateralPos, wMeters);

                                    // Fill the gap between the track strip and the wall (if any)
                                    // Current wall offset is spacing/2 + 1.83. Track strip ends at spacing/2 + 1.25.
                                    const outerGapWidth = (1.83 - 1.25) / 2;
                                    const outerGapCenter = (s) => sign * (this.sim.getTrackSpacing(s) / 2 + 1.25 + outerGapWidth);
                                    this.buildSweptBar(stationGroup, gsA, gsB,
                                        () => outerGapWidth, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                        [grossreuthTrackCeilingMat, grossreuthTrackCeilingMat], hMeters, outerGapCenter, wMeters);
                                }
                            } else {
                                const cHalfW = (s) => (this.sim.getTrackSpacing(s) + 3.66) / 2;
                                this.buildSweptBar(stationGroup, gsA, gsB,
                                    cHalfW, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], hMeters, () => 0, wMeters);
                            }
                        }

                        const startS = station.position - platLength / 2 + 3.0;
                        const endS = station.position + platLength / 2 - 3.0;

                        const girderMats = [girderMat, girderMat];
                        const tubeMats = [this.materials.lightTube, this.materials.lightTube];
                        if (isWoehrder) {
                            // Standard barrel light channel (see buildBarrelLights). The
                            // ceiling hanger rods come from the shared hanger loop below,
                            // so no ceilY is passed here.
                            this.buildBarrelLights(stationGroup, {
                                startS, endS,
                                axisY: girderY,
                                centerPosY: centerPos.y,
                                centerAngle,
                                offFn: lightOffFn,
                                label: station.name,
                            });
                        } else {
                            for (const sign of [1, -1]) {
                                this.buildSweptBar(stationGroup, startS, endS, () => 0.125, centerPos.y + girderY + girderH / 2, centerPos.y + girderY - girderH / 2, girderMats, 1.2, (s) => sign * lightOffFn(s));
                                this.buildSweptBar(stationGroup, startS, endS, () => 0.015, centerPos.y + tubeY + 0.015, centerPos.y + tubeY - 0.015, tubeMats, 1.2, (s) => sign * (lightOffFn(s) - 0.05));
                                this.buildSweptBar(stationGroup, startS, endS, () => 0.015, centerPos.y + tubeY + 0.015, centerPos.y + tubeY - 0.015, tubeMats, 1.2, (s) => sign * (lightOffFn(s) + 0.05));
                            }
                        }

                        for (let jj = 0; jj < numSub; jj++) {
                            const s_mid = gsA + (jj + 0.5) * subLen;
                            [-1.25, 1.25].forEach(tOff => {
                                const s = s_mid + tOff;
                                if (s < startS || s > endS) return; // Only spawn hangers within the shortened lights range
                                const hPos = this.sim.getTrackPosition(s);
                                const hTan = this.sim.getTrackTangent(s);
                                const hRotY = Math.atan2(hTan.x, hTan.z) - centerAngle;
                                const hNormal = new THREE.Vector3(-hTan.z, 0, hTan.x);
                                const hOff = lightOffFn(s);
                                [1, -1].forEach(sign => {
                                    const hanger = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                                    hanger.position.copy(stationGroup.worldToLocal(hPos.clone().addScaledVector(hNormal, sign * hOff)));
                                    hanger.position.y = hangerY;
                                    hanger.rotation.y = hRotY;
                                    stationGroup.add(hanger);
                                });
                            });
                        }
                    }
                } else {
                    const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
                    const isLwNord = (station.name === "Langwasser Nord" || station.name === "Bauernfeindstraße");
                    let ceilY = isMax ? 5.84 : 4.66; // Decke quer-mitskaliert (×1.4134) für 1×-Profil
                    if (station.name === "Rathenauplatz") ceilY = 10.0;
                    const ceilW = isLwNord ? (spacing - 2.22) : groundWidth;

                    if (hasSlatCeiling) {
                        // Dark background plate + rough-concrete side plates + slats as continuous
                        // swept slabs (built once on j===0). This aligns the slat texture with the
                        // station curve. Shared by Aufseßplatz + the three Langwasser-branch stations;
                        // the plates between slat field and side walls use the tunnel-portal concrete.
                        if (j === 0) {
                            const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                            const cy = centerPos.y;
                            const bpHalf = (s) => (this.sim.getTrackSpacing(s) - 2.8) / 2;
                            const tDist = (s) => this.sim.getTrackSpacing(s) / 2 + 0.215; // 3.23m plate, half 1.615
                            const plateMats = [slatCeilingConcreteMat, slatCeilingConcreteMat];
                            this.buildSweptBar(stationGroup, sA, sB, bpHalf, cy + 4.595, cy + 4.585, [aufsessplatzCeilingDarkMat, aufsessplatzCeilingDarkMat], 1.2);
                            this.buildSweptBar(stationGroup, sA, sB, () => 1.615, cy + 4.595, cy + 4.585, plateMats, 1.2, (s) => -tDist(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => 1.615, cy + 4.595, cy + 4.585, plateMats, 1.2, (s) => tDist(s));

                            // 3. Slat texture ceiling swept bar
                            this.buildSweptBar(stationGroup, sA, sB, bpHalf, cy + 4.58, cy + 4.57, [aufsessplatzCeilingLightMat, aufsessplatzCeilingDarkMat], 1.2);
                        }
                    } else if (["Schweinau", "Rothenburger Straße"].includes(station.name)) {
                        if (j === 0) {
                            const spacing = this.sim.getTrackSpacing(station.position);
                            const tubeCenterL = spacing / 4 + 1.2;
                            const tubeCenterR = -tubeCenterL;
                            const tubeRadius = tubeCenterL;
                            // Semicircle phi 0..PI springs at platform-top level; extend it
                            // past the OUTER spring point (phi<0 for the left tube, >PI for
                            // the right) so the tube surface continues down to the Gleisbett
                            // instead of stopping 0.865m above rail level with a visible gap.
                            // Drop 1.45 rel. baseY ends inside the bed slab (top gTY-0.32).
                            const arcSteps = 32;
                            const extSteps = 3;
                            const phiExt = Math.asin(1.45 / tubeRadius);
                            const mkVaultArc = (phiFrom, phiTo) => {
                                const pts = [];
                                const n = arcSteps + extSteps;
                                for (let k = 0; k <= n; k++) {
                                    const phi = phiFrom + (phiTo - phiFrom) * k / n;
                                    pts.push({ x: tubeRadius * Math.cos(phi), y: tubeRadius * Math.sin(phi) });
                                }
                                return pts;
                            };
                            const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                            const cy = centerPos.y;
                            const ceilMat = (station.name === "Schweinau") ? this.getSchweinauBrickMat(station, platLength, centerPos, centerAngle) : this.getRothenburgerGravelMat(station, platLength, centerPos, centerAngle);

                            this.buildSweptProfile(stationGroup, sA, sB, mkVaultArc(-phiExt, Math.PI), cy + 0.865, () => tubeCenterL, ceilMat, 5);
                            this.buildSweptProfile(stationGroup, sA, sB, mkVaultArc(0, Math.PI + phiExt), cy + 0.865, () => tubeCenterR, ceilMat, 5);
                        }
                    } else if (station.name !== "Plärrer" && station.name !== "Muggenhof" && station.name !== "Stadtgrenze" && station.name !== "Flughafen" && station.name !== "Nordwestring" && station.name !== "Friedrich-Ebert-Platz" && station.name !== "Rennweg") {
                        // Flughafen baut seine Stahlraster-Decke selbst (drei
                        // Abschnitte mit zwei Lichteinlass-Öffnungen), Nordwestring
                        // ebenso (Spiegel-Zickzack), Friedrich-Ebert-Platz ebenso
                        // (Rippendecke + erhöhtes oranges Mittelfeld) — siehe Wand-Zweige.
                        // Plärrer's flat ceiling is omitted: its bespoke hall (TrackManager
                        // buildPlaerrer) opens up to the surface skylights instead.
                        // Ceiling as ONE continuous swept slab (solid colour), built once on j===0.
                        if (j === 0) {
                            const cHalfW = (s) => (isLwNord ? (this.sim.getTrackSpacing(s) - 2.22)
                                                            : (this.sim.getTrackSpacing(s) + (isSideStation ? 11.1 : 3.66))) / 2;
                            let ceilMat = isMax ? this.maximilianstrasseCeilingMat : this.materials.ceiling;
                            if (station.name === "Rathenauplatz") {
                                ceilMat = this.maximilianstrasseCeilingMat;
                            } else if (station.name === "Bauernfeindstraße") {
                                // Fine concrete texture ceiling to match the doubled, textured pillars
                                if (!this._bauernfeindCeilingMat) {
                                    this._bauernfeindCeilingMat = new THREE.MeshLambertMaterial({
                                        map: this.tunnelConcreteTexture,
                                        color: 0xffffff,
                                        side: THREE.DoubleSide
                                    });
                                }
                                ceilMat = this._bauernfeindCeilingMat;
                            } else if (station.name === "Röthenbach") {
                                if (!this._roethenbachCeilingMat) {
                                    this._roethenbachCeilingMat = new THREE.MeshLambertMaterial({ color: '#44413d' });
                                }
                                ceilMat = this._roethenbachCeilingMat;
                            } else if (station.name === "Klinikum Nord") {
                                // Heller Sichtbeton (Fotos) statt des dunklen Standard-Deckels;
                                // Mittelunterzug + Lochblech-Paneele kommen im Wand-Zweig dazu.
                                if (!this._klinikumNordCeilingMat) {
                                    this._klinikumNordCeilingMat = new THREE.MeshLambertMaterial({
                                        map: this.tunnelConcreteTexture,
                                        color: 0xffffff,
                                        side: THREE.DoubleSide
                                    });
                                }
                                ceilMat = this._klinikumNordCeilingMat;
                            } else if (station.name === "Maxfeld") {
                                // Helle, fast weiße Blechdecke (Fotos) statt des
                                // dunklen Standard-Deckels
                                if (!this._maxfeldCeilingMat) {
                                    this._maxfeldCeilingMat = new THREE.MeshLambertMaterial({ color: '#d8dbdd' });
                                }
                                ceilMat = this._maxfeldCeilingMat;
                            } else if (station.name === "Rennweg") {
                                // Dunkler Waschbeton über die ganze Kaverne (Fotos)
                                ceilMat = this.getRennwegAggregateMat();
                            } else if (station.name === "Wöhrder Wiese") {
                                ceilMat = this.getWoehrderRockMat();
                            }
                            if (station.name === "Messe") {
                                this.materials.messeBlue = this.materials.messeBlue || new THREE.MeshLambertMaterial({ color: '#3a92d8' });
                                ceilMat = this.materials.messeBlue;
                            }

                            const hMeters = isMax ? 4.0 : 1.2;
                            const wMeters = isMax ? 4.0 : 1.2;

                            if (station.name === "Messe") {
                                const sStart = station.position - platLength / 2;
                                const sEnd = station.position + platLength / 2;

                                // Left side roof slab (closed track/platform side)
                                this.buildSweptBar(stationGroup, sStart, sEnd,
                                    (s) => (cHalfW(s) - 2.3) / 2, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], hMeters, (s) => -(cHalfW(s) + 2.3) / 2, wMeters);

                                // Right side roof slab (closed track/platform side)
                                this.buildSweptBar(stationGroup, sStart, sEnd,
                                    (s) => (cHalfW(s) - 2.3) / 2, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], hMeters, (s) => (cHalfW(s) + 2.3) / 2, wMeters);

                                // Center roof slab (with cutouts for escalators)
                                // Section 1: Langwasser outer end
                                this.buildSweptBar(stationGroup, sStart, station.position + 0.0,
                                    () => 2.3, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], hMeters, () => 0, wMeters);

                                // Section 2: Concourse building zone
                                this.buildSweptBar(stationGroup, station.position + 8.4, station.position + 31.6,
                                    () => 2.3, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], hMeters, () => 0, wMeters);

                                // Section 3: Fürth outer end
                                this.buildSweptBar(stationGroup, station.position + 40.0, sEnd,
                                    () => 2.3, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], hMeters, () => 0, wMeters);

                                // Build longitudinal concrete beams connecting the pillars continuously
                                this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
                                const beamMats = [this.materials.messeConcrete, this.materials.messeConcrete];
                                const pillOffsetFn = (s) => (this.sim.getTrackSpacing(s) - 3.08) / 2 - 4.0;
                                const cy = centerPos.y;

                                this.buildSweptBar(stationGroup, sStart, sEnd, () => 0.25, cy + ceilY - 0.1, cy + ceilY - 0.1 - 0.45, beamMats, 1.2, (s) => -pillOffsetFn(s));
                                this.buildSweptBar(stationGroup, sStart, sEnd, () => 0.25, cy + ceilY - 0.1, cy + ceilY - 0.1 - 0.45, beamMats, 1.2, (s) => pillOffsetFn(s));
                            } else if (station.name === "Bauernfeindstraße") {
                                // Roof cutout for the escalator/walkway shaft above the tunnel
                                // mouth at sh2 (matches the bed-slab gap in TrackManager.js's
                                // flushBedRun) -- only the tunnel-ward end gets a cutout, the
                                // Langwasser-ward end stays fully enclosed.
                                const sA = station.position - platLength / 2;
                                const sB = station.position + platLength / 2;
                                const topY = centerPos.y + ceilY + 0.1;
                                const botY = centerPos.y + ceilY - 0.1;
                                const sh2 = this.sim.track.elevation.sh2;
                                const gapHalf = 3.0;
                                this.buildSweptBar(stationGroup, sA, sh2 - gapHalf,
                                    cHalfW, topY, botY,
                                    [ceilMat, ceilMat], hMeters, () => 0, wMeters);
                                if (sh2 + gapHalf < sB) {
                                    this.buildSweptBar(stationGroup, sh2 + gapHalf, sB,
                                        cHalfW, topY, botY,
                                        [ceilMat, ceilMat], hMeters, () => 0, wMeters);
                                }
                            } else if (station.name !== "Opernhaus") {
                                const sA = station.position - platLength / 2;
                                const sB = station.position + platLength / 2;
                                const topY = centerPos.y + ceilY + 0.1;
                                const botY = centerPos.y + ceilY - 0.1;
                                this.buildSweptBar(stationGroup, sA, sB,
                                    cHalfW, topY, botY,
                                    [ceilMat, ceilMat], hMeters, () => 0, wMeters);
                            } else {
                                // Opernhaus: barrel-vault arch ceiling — one arch per 5m bay between columns.
                                // The arch is a semicircle (R = 2.5 m) springing from colH − R above the floor.
                                const opConcreteMat = this.getOpernhausConcreateMat();
                                const opConcrMats = [opConcreteMat, opConcreteMat];
                                const archR = 2.5;                          // arch radius = half column spacing
                                const colHop = 7.04;
                                const springLocalY = -0.38 + colHop - archR; // 4.16 m above track bed
                                const worldSpring = centerPos.y + springLocalY;
                                const vaultThick = 0.30;                    // vault slab thickness
                                const bayHalfSpan = archR;                  // 2.5 m each side of bay centre
                                const firstColZ = -platLength / 2 + 2.5;
                                const lastColZ  =  platLength / 2 - 2.5;
                                const numCols = Math.round((lastColZ - firstColZ) / 5.0) + 1;
                                for (let ci = 0; ci < numCols - 1; ci++) {
                                    const z0 = firstColZ + ci * 5.0;       // z of column i
                                    const z1 = z0 + 5.0;                   // z of column i+1
                                    const s0 = station.position + z0;
                                    const s1 = station.position + z1;
                                    const sMid = (s0 + s1) / 2;
                                    // Arch top / bottom as function of s (position along track)
                                    const archTop = (s) => {
                                        const dz = s - sMid;
                                        const sinVal = Math.sqrt(Math.max(0, archR * archR - dz * dz)) / archR;
                                        return worldSpring + archR * sinVal;
                                    };
                                    const archBot = (s) => archTop(s) - vaultThick;
                                    // Full lateral span: same as the non-Opernhaus ceiling
                                    this.buildSweptBar(stationGroup, s0, s1,
                                        cHalfW, archTop, archBot,
                                        opConcrMats, 1.2, () => 0, 1.5);
                                }
                            }
                        }
                        if (station.name === "Messe") {
                            // Build a transverse concrete beam at each segment center, skipping the two cutout slots
                            if (!(localZ_mid > 0.0 && localZ_mid < 8.4) && !(localZ_mid > 31.6 && localZ_mid < 40.0)) {
                                this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
                                const beamWidth = spacing + 3.6;
                                const beamHeight = 0.45;
                                const beamDepth = 0.5;
                                const beamGeom = new THREE.BoxGeometry(beamWidth, beamHeight, beamDepth);
                                const beam = new THREE.Mesh(beamGeom, this.materials.messeConcrete);
                                beam.position.copy(localPos);
                                beam.position.y = ceilY - 0.1 - beamHeight / 2;
                                beam.rotation.y = rotY;
                                stationGroup.add(beam);
                            }
                        }
                    }

                    // Continuous neon lighting parallel to platform edge, mounted directly to the ceiling
                    const targetStations = ["Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte", "Aufseßplatz", "Maffeiplatz", "Hasenbuck", "Frankenstraße", "St. Leonhard"];
                    if (targetStations.includes(station.name)) {
                        const lightOff = spacing / 2 - 1.785;
                        const ductW = 0.2;
                        const ductH = 0.06;
                        const glowW = 0.12;
                        const glowH = 0.02;
                        
                        const ductY = ceilY - 0.1 - ductH / 2; // flush under ceiling bottom (ceiling bottom is at ceilY - 0.1)
                        const glowY = ductY - ductH / 2 - glowH / 2; // directly under the duct
                        
                        const lightDuctMat = new THREE.MeshLambertMaterial({ color: '#334155' });
                        const lightEmissiveMat = this.materials.lightTube; // shared emissive basic material

                        // Light ducts + glow strips as continuous swept bars (built once on j===0),
                        // so they flow smoothly along curves instead of stepping per segment.
                        if (j === 0) {
                            const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                            const offFn = (s) => this.sim.getTrackSpacing(s) / 2 - 1.785;
                            const dM = [lightDuctMat, lightDuctMat];
                            const gM = [lightEmissiveMat, lightEmissiveMat];
                            const dTop = centerPos.y + ductY + ductH / 2, dBot = centerPos.y + ductY - ductH / 2;
                            const gTop = centerPos.y + glowY + glowH / 2, gBot = centerPos.y + glowY - glowH / 2;
                            this.buildSweptBar(stationGroup, sA, sB, () => ductW / 2, dTop, dBot, dM, 1.2, (s) => -offFn(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => ductW / 2, dTop, dBot, dM, 1.2, (s) => offFn(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => glowW / 2, gTop, gBot, gM, 1.2, (s) => -offFn(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => glowW / 2, gTop, gBot, gM, 1.2, (s) => offFn(s));
                        }
                    }


                }
            }

            // 2. Platform Decks & Safety Strips  (each deck = one continuous swept mesh,
            //    built once on j===0; the lateral centre offset tracks the inter-track gap)
            if (isSideStation) {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offFn = (s) => this.sim.getTrackSpacing(s) / 2 + 3.54;
                    const hwFn = () => 2.0; // 4.0 m wide decks
                    const matsL = this.getPlatformMaterials(station, 4.0, true, false);
                    const matsR = this.getPlatformMaterials(station, 4.0, false, true);
                    this.buildSweptBar(stationGroup, sA, sB, hwFn, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [matsL[0], matsL[2]], 1.2, (s) => offFn(s));
                    this.buildSweptBar(stationGroup, sA, sB, hwFn, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [matsR[0], matsR[2]], 1.2, (s) => -offFn(s));
                }
            } else if (isScharfreiterring) {
                if (j === 0) {
                    // Decks end flush with the crossing building's outer face at the -Z end
                    // (z = -53.5); beyond that the sloped concrete abutment ramps built with
                    // the building form the actual platform ends (photo).
                    const sA = station.position - 53.5 * S_len, sB = station.position + platLength / 2;
                    const mats6 = this.getPlatformMaterials(station, localSchPlatHalfWidth * 2, true, true);
                    // Asymmetric edges (Besonderheit of this station), see _schAsymEdges:
                    // outer edge follows the active track's curvature, inner edge is a
                    // dead-straight chord along the decorative middle tracks.
                    for (const sign of [1, -1]) {
                        const { off, hw } = this._schAsymEdges(sA, sB, sign, schFixedSpacing / 2 - 8.53, 1.53);
                        this.buildSweptBar(stationGroup, sA, sB, hw, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [mats6[0], mats6[2]], 1.2, off);
                    }
                }
            } else {
                // Island platform deck as ONE continuous swept mesh (smooth curve + per-vertex
                // taper that follows the inter-track gap), built once on the first iteration.
                // Replaces the old per-5m boxes that looked faceted/gappy on curves. The deck is
                // only present where the two tracks leave room for it (platWidth > 0); where they
                // overlap (e.g. Plärrer, single-mapped) there is no island platform.
                if (j === 0) {
                    const centerSpacing = this.sim.getTrackSpacing(station.position);
                    if (centerSpacing - 3.08 > 0) {
                        const H_meters = (station.name === "Hardhöhe") ? 4.0 : 1.2;
                        const mats6 = this.getPlatformMaterials(station, centerSpacing - 3.08, true, true);
                        const halfWidthFn = (s) => Math.max(0.05, (this.sim.getTrackSpacing(s) - 3.08) / 2);
                        this.buildSweptBar(
                            stationGroup,
                            station.position - platLength / 2,
                            station.position + platLength / 2,
                            halfWidthFn,
                            centerPos.y + platTopY,            // top y, relative to station elevation
                            centerPos.y + platTopY - platHeight, // bottom y
                            [mats6[0], mats6[2]], // [sideMat, topMat]
                            H_meters
                        );
                    }
                }
            }

            // 3. Outer Walls & Railings
            const rightWallX = isSideStation ? (-spacing / 2 - 5.55) : (-spacing / 2 - 1.83);
            const leftWallX = isSideStation ? (spacing / 2 + 5.55) : (spacing / 2 + 1.83);
            const posWallL = pos.clone().addScaledVector(normal, leftWallX);
            const posWallR = pos.clone().addScaledVector(normal, rightWallX);

            if (isScharfreiterring) {
                // Fences/railings sit 10cm further from the running tracks than the
                // generic 1.83m so the train clears them with margin.
                const wallDist = spacing / 2 + 1.93;
                const pL = pos.clone().addScaledVector(normal, -wallDist);
                const pR = pos.clone().addScaledVector(normal, wallDist);
                const localPL = stationGroup.worldToLocal(pL.clone());
                const localPR = stationGroup.worldToLocal(pR.clone());

                // Low concrete wall + its 2-bar handrail (left side), and the single-bar fence
                // (right side), as continuous swept bars, built once. The lateral offset tracks
                // the inter-track gap exactly like the rest of the station. Only the vertical
                // support posts below stay discrete (real fence posts are periodic fixtures).
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.93;
                    const pillarMats = [this.materials.pillar, this.materials.pillar];
                    const railMats = [this.materials.boardHanger, this.materials.boardHanger];
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.1, centerPos.y + 1.5, centerPos.y, pillarMats, 1.2, (s) => -offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.025, centerPos.y + 1.975, centerPos.y + 1.925, railMats, 1.2, (s) => -offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.025, centerPos.y + 2.425, centerPos.y + 2.375, railMats, 1.2, (s) => -offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.025, centerPos.y + 1.225, centerPos.y + 1.175, railMats, 1.2, (s) => offW(s));
                }

                // Vertical posts centered in each sub-segment
                const postL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), this.materials.boardHanger);
                postL.position.copy(localPL);
                postL.position.y = 1.95;
                postL.rotation.y = rotY;
                stationGroup.add(postL);

                const postR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.04), this.materials.boardHanger);
                postR.position.copy(localPR);
                postR.position.y = 0.6;
                postR.rotation.y = rotY;
                stationGroup.add(postR);



            } else if (station.name === "Eberhardshof") {
                const fencePositionsX = [-spacing / 2 - 1.83, spacing / 2 + 1.83];
                fencePositionsX.forEach(fx => {
                    // 3 horizontal rails
                    const railHeights = [0.1, 0.9, 1.7];
                    railHeights.forEach(ry => {
                        const rail = new THREE.Mesh(
                            new THREE.BoxGeometry(0.04, 0.04, subLen),
                            this.materials.boardHanger
                        );
                        const pWorld = pos.clone().addScaledVector(normal, fx);
                        rail.position.copy(stationGroup.worldToLocal(pWorld));
                        rail.position.y = ry;
                        rail.rotation.y = rotY;
                        stationGroup.add(rail);
                    });

                    // 4 vertical posts per 5m segment
                    const postOffsetsZ = [-1.875, -0.625, 0.625, 1.875];
                    postOffsetsZ.forEach(oz => {
                        const post = new THREE.Mesh(
                            new THREE.BoxGeometry(0.06, 1.8, 0.06),
                            this.materials.boardHanger
                        );
                        const pWorld = pos.clone()
                            .addScaledVector(normal, fx)
                            .addScaledVector(tangent, oz);
                        post.position.copy(stationGroup.worldToLocal(pWorld));
                        post.position.y = 0.9;
                        post.rotation.y = rotY;
                        stationGroup.add(post);
                    });
                });
            } else if (["Jakobinenstraße", "St. Leonhard", "Opernhaus"].includes(station.name)) {
                // 1. Sandstone "houses" wall + its dark coping band, swept continuously along
                // the true curve.
                if (j === 0) {
                    const R = station.position - (numSub * subLen) / 2;
                    const period = 2.5;
                    const triWave = (s, vTrough, vPeak) => {
                        const t = (((s - R) % period) + period) % period;
                        const frac = Math.abs(t - period / 2) / (period / 2); // 0 at peak, 1 at trough
                        return vPeak - frac * (vPeak - vTrough);
                    };
                    const sA = R, sB = R + numSub * subLen;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const wallTop = (s) => centerPos.y + (station.name === "Opernhaus" ? 7.04 : triWave(s, 4.77, 5.77));
                    const wallBot = centerPos.y - 0.38;
                    const fillBot = (s) => centerPos.y + triWave(s, 4.77, 5.77);
                    const fillTop = (s) => centerPos.y + triWave(s, 5.0, 6.0);
                    const zigzagNSeg = numSub * 8;
                    
                    let wallMat = jakobinenstrasseSandstoneMat;
                    let sandW = 2.4;
                    let sandH = 1.2;
                    if (station.name === "St. Leonhard") {
                        wallMat = this.getStLeonhardStoneMat();
                        sandW = wallMat.map.userData.worldW;
                        sandH = wallMat.map.userData.worldH;
                    } else if (station.name === "Opernhaus") {
                        wallMat = this.getOpernhausStoneMat();
                        sandW = wallMat.map.userData.worldW;
                        sandH = wallMat.map.userData.worldH;
                    } else if (station.name === "Weißer Turm") {
                        wallMat = this.getWeisserTurmWallMat();
                        sandW = wallMat.map.userData.worldW;
                        sandH = wallMat.map.userData.worldH;
                    }

                    for (const sign of [1, -1]) {
                        if (station.name === "Opernhaus" && sign === -1) {
                            // Build column shafts (lower 2/3) + arch-shaped head (upper 1/3)
                            const colW = 2.0;
                            const colD = 2.0;
                            const fullColH = 7.04;
                            const archR = 2.5;                           // arch radius = half column spacing
                            const shaftH = fullColH - archR;             // 4.54 m — the rectangular shaft
                            const shaftGeom = new THREE.BoxGeometry(colW, shaftH, colD);
                            const springLocalY = -0.38 + shaftH;        // world-local y where arch springs (4.16)

                            // Collect column world positions for arch building
                            const colPositions = [];
                            for (let z = -platLength / 2 + 2.5; z <= platLength / 2 - 2.5; z += 5.0) {
                                const s = station.position + z;
                                const posC = this.sim.getTrackPosition(s);
                                const tangentC = this.sim.getTrackTangent(s);
                                const rotYC = Math.atan2(tangentC.x, tangentC.z) - centerAngle;
                                const normalC = new THREE.Vector3(-tangentC.z, 0, tangentC.x);
                                const rightWallX = -this.sim.getTrackSpacing(s) / 2 - 1.83;
                                const colPosWorld = posC.clone().addScaledVector(normalC, rightWallX - colD / 2);

                                // Compute local position ONCE, then clone for each use
                                const colPosLocal = stationGroup.worldToLocal(colPosWorld.clone());

                                // Rectangular shaft (lower 2/3 of original height)
                                const colMesh = new THREE.Mesh(shaftGeom, wallMat);
                                colMesh.position.copy(colPosLocal);
                                colMesh.position.y = -0.38 + shaftH / 2;
                                colMesh.rotation.y = rotYC;
                                stationGroup.add(colMesh);

                                // Arch "impost" block at the column top (transition to arch)
                                const impostH = 0.25;
                                const impostGeom = new THREE.BoxGeometry(colW + 0.2, impostH, colD + 0.2);
                                const impost = new THREE.Mesh(impostGeom, wallMat);
                                impost.position.copy(colPosLocal);
                                impost.position.y = springLocalY + impostH / 2;
                                impost.rotation.y = rotYC;
                                stationGroup.add(impost);

                                colPositions.push({ localPos: colPosLocal.clone(), rotYC });
                            }

                            // Build semicircular arch between adjacent columns using
                            // THREE.TorusGeometry — guaranteed correct rendering.
                            // A half-torus (arc=π) placed at spring height; rotation.y=π/2
                            // puts the ring in the ZY plane (longitudinal arch plane) so it
                            // spans from one column top to the next.
                            const opConcreteMat = this.getOpernhausConcreateMat();
                            const archTubeR = 0.55;   // half arch-band "thickness" visible from below

                            for (let ci = 0; ci < colPositions.length - 1; ci++) {
                                const cp0 = colPositions[ci].localPos;
                                const cp1 = colPositions[ci + 1].localPos;
                                const bayMidX = (cp0.x + cp1.x) / 2;
                                const bayMidZ = (cp0.z + cp1.z) / 2;
                                const rotYArch = colPositions[ci].rotYC;

                                // TorusGeometry lies in the XY plane by default, arc=π spans
                                // from (R,0,0) → (0,R,0) → (-R,0,0).  A rotation.y of π/2
                                // maps  X→−Z, Z→X, which puts the torus in the ZY plane:
                                //   start → (0, 0, −R)  = column ci spring
                                //   peak  → (0, R,  0)  = keystone
                                //   end   → (0, 0, +R)  = column ci+1 spring
                                const torusGeom = new THREE.TorusGeometry(
                                    archR,          // torus radius = arch span / 2
                                    archTubeR,      // tube radius = visible band thickness
                                    8,              // radial segments (tube cross-section)
                                    24,             // tubular segments (arch smoothness)
                                    Math.PI         // half-torus (180°)
                                );
                                const archMesh = new THREE.Mesh(torusGeom, opConcreteMat);
                                archMesh.position.set(bayMidX, springLocalY, bayMidZ);
                                // rotation.y: π/2 for ZY-plane placement + track curve offset
                                archMesh.rotation.set(0, rotYArch + Math.PI / 2, 0);
                                stationGroup.add(archMesh);
                            }

                            continue;

                        }

                        const off = (s) => sign * offW(s);
                        this.buildSweptWall(stationGroup, sA, sB, off, wallBot, wallTop, wallMat, sandW, 0, 0, zigzagNSeg, 1 / sandH);
                        if (station.name !== "Opernhaus") {
                            this.buildSweptWall(stationGroup, sA, sB, off, fillBot, fillTop, this.materials.boardHanger, 1.2, 0, 1, zigzagNSeg);
                        }

                        if (station.name === "Opernhaus" && sign === 1) {
                            // White background plate
                            const rightWallX_plate = this.sim.getTrackSpacing(station.position) / 2 + 1.83;
                            const plateW = 0.1;
                            const plateH = 7.04;
                            const plateGeom = new THREE.BoxGeometry(plateW, plateH, platLength);
                            const plateMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
                            const plate = new THREE.Mesh(plateGeom, plateMat);
                            plate.position.set(rightWallX_plate + 2.1, -0.38 + plateH / 2, 0);
                            stationGroup.add(plate);

                            // build curved fences (wall side)
                            for (let z = -platLength / 2 + 2.5; z <= platLength / 2 - 2.5; z += 5.0) {
                                const s = station.position + z;
                                const rightWallX = this.sim.getTrackSpacing(s) / 2 + 1.83;

                                // Curved fence
                                if (z + 5.0 <= platLength / 2) {
                                    const s1 = s;
                                    const s2 = s + 5.0;
                                    const sMid = (s1 + s2) / 2;
                                    const posMid = this.sim.getTrackPosition(sMid);
                                    const tangentMid = this.sim.getTrackTangent(sMid);
                                    const rotYMid = Math.atan2(tangentMid.x, tangentMid.z) - centerAngle;
                                    const normalMid = new THREE.Vector3(-tangentMid.z, 0, tangentMid.x);

                                    const numStruts = 13;
                                    const strutSpacing = 0.25;
                                    const fenceHeight = 2.0;
                                    const strutGeom = new THREE.BoxGeometry(0.03, fenceHeight, 0.03);
                                    const localMid = stationGroup.worldToLocal(posMid.clone());
                                    const fenceMat = new THREE.MeshStandardMaterial({ color: '#2d2d2d', roughness: 0.7, metalness: 0.2 });

                                    for (let i = 0; i < numStruts; i++) {
                                        const zOffset = -1.5 + i * strutSpacing;
                                        const xOffset = 0.45 * (1.0 - Math.pow(zOffset / 1.5, 2));

                                        const strut = new THREE.Mesh(strutGeom, fenceMat);
                                        strut.position.set(rightWallX + xOffset, fenceHeight / 2, zOffset);
                                        strut.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotYMid);
                                        strut.position.add(localMid);
                                        strut.rotation.y = rotYMid;
                                        stationGroup.add(strut);
                                    }

                                    const railGeom = new THREE.BoxGeometry(0.04, 0.04, strutSpacing + 0.02);
                                    for (let i = 0; i < numStruts - 1; i++) {
                                        const z1 = -1.5 + i * strutSpacing;
                                        const z2 = z1 + strutSpacing;
                                        const x1 = rightWallX + 0.45 * (1.0 - Math.pow(z1 / 1.5, 2));
                                        const x2 = rightWallX + 0.45 * (1.0 - Math.pow(z2 / 1.5, 2));

                                        const midX = (x1 + x2) / 2;
                                        const midZ = (z1 + z2) / 2;
                                        const angle = Math.atan2(x2 - x1, z2 - z1);

                                        const railB = new THREE.Mesh(railGeom, fenceMat);
                                        railB.position.set(midX, 0.02, midZ);
                                        railB.rotation.y = angle;
                                        railB.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotYMid);
                                        railB.position.add(localMid);
                                        railB.rotation.y += rotYMid;
                                        stationGroup.add(railB);

                                        const railM = new THREE.Mesh(railGeom, fenceMat);
                                        railM.position.set(midX, 1.0, midZ);
                                        railM.rotation.y = angle;
                                        railM.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotYMid);
                                        railM.position.add(localMid);
                                        railM.rotation.y += rotYMid;
                                        stationGroup.add(railM);

                                        const railT = new THREE.Mesh(railGeom, fenceMat);
                                        railT.position.set(midX, 1.95, midZ);
                                        railT.rotation.y = angle;
                                        railT.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotYMid);
                                        railT.position.add(localMid);
                                        railT.rotation.y += rotYMid;
                                        stationGroup.add(railT);
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. Dark vertical columns at the segment end boundaries (z = 2.5)
                if (station.name !== "Opernhaus") {
                    const pEndL = posWallL.clone().addScaledVector(normal, -0.101).addScaledVector(tangent, 2.5);
                    const colL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colL.position.copy(stationGroup.worldToLocal(pEndL));
                    colL.position.y = 4.01;
                    colL.rotation.y = rotY;

                    const pEndR = posWallR.clone().addScaledVector(normal, 0.101).addScaledVector(tangent, 2.5);
                    const colR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colR.position.copy(stationGroup.worldToLocal(pEndR));
                    colR.position.y = 4.01;
                    colR.rotation.y = rotY;

                    stationGroup.add(colL, colR);
                }

                // 2b. Dark vertical column under the MIDDLE downward "Zacken" of each segment (z = 0)
                if (station.name !== "Opernhaus") {
                    const pMidL = posWallL.clone().addScaledVector(normal, -0.101);
                    const colMidL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colMidL.position.copy(stationGroup.worldToLocal(pMidL));
                    colMidL.position.y = 4.01;
                    colMidL.rotation.y = rotY;
                    stationGroup.add(colMidL);

                    const pMidR = posWallR.clone().addScaledVector(normal, 0.101);
                    const colMidR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colMidR.position.copy(stationGroup.worldToLocal(pMidR));
                    colMidR.position.y = 4.01;
                    colMidR.rotation.y = rotY;
                    stationGroup.add(colMidR);
                }

                // For the very first segment (j === 0), also add columns at the start boundary (z = -2.5)
                if (j === 0 && station.name !== "Opernhaus") {
                    const pStartL = posWallL.clone().addScaledVector(normal, -0.101).addScaledVector(tangent, -2.5);
                    const colStartL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colStartL.position.copy(stationGroup.worldToLocal(pStartL));
                    colStartL.position.y = 4.01;
                    colStartL.rotation.y = rotY;
                    stationGroup.add(colStartL);

                    const pStartR = posWallR.clone().addScaledVector(normal, 0.101).addScaledVector(tangent, -2.5);
                    const colStartR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colStartR.position.copy(stationGroup.worldToLocal(pStartR));
                    colStartR.position.y = 4.01;
                    colStartR.rotation.y = rotY;
                    stationGroup.add(colStartR);
                }

                // 5. Nameplate under every second house (House 2 of each segment)
                if (j > 0 && j < numSub - 1) {
                    const textMat = (station.name === "St. Leonhard") ? this.getStLeonhardTextMat() 
                                  : ((station.name === "Opernhaus") ? this.getOpernhausTextMat() 
                                  : jakobinenstrasseTextMat);

                    // Left wall text (facing tracks)
                    const textMeshL = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.5625), textMat);
                    const pTextL = posWallL.clone().addScaledVector(tangent, 1.25);
                    textMeshL.position.copy(stationGroup.worldToLocal(pTextL));
                    textMeshL.position.x += 0.11;
                    textMeshL.position.y = 2.21875; // Top edge 2.50m above track bed
                    textMeshL.rotation.set(0, rotY + Math.PI / 2, 0);
                    stationGroup.add(textMeshL);

                    // Right wall text (facing tracks)
                    if (station.name !== "Opernhaus") {
                        const textMeshR = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.5625), textMat);
                        const pTextR = posWallR.clone().addScaledVector(tangent, 1.25);
                        textMeshR.position.copy(stationGroup.worldToLocal(pTextR));
                        textMeshR.position.x -= 0.11;
                        textMeshR.position.y = 2.21875; // Top edge 2.50m above track bed
                        textMeshR.rotation.set(0, rotY - Math.PI / 2, 0);
                        stationGroup.add(textMeshR);
                    }
                }
            } else if (wallPresets[station.name]) {
                // Tiled 2-layer walls + name stripe as continuous swept ribbons, built once.
                if (j === 0) {
                    const preset = wallPresets[station.name];
                    const cacheKey = `tileMat_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = {
                            bottom: this.createTiledMaterial(preset.bottomColor, preset.bottomGrout, 0.2),
                            top: this.createTiledMaterial(preset.topColor, preset.topGrout, 0.15),
                            stripe: this.createWallStripeMaterial(station.name, preset.stripeBg, preset.stripeText)
                        };
                    }
                    const mats = this[cacheKey];
                    const repeatX = Math.round(platLength / (0.35 * (384 / 64)));
                    const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
                    const topHeight = isMax ? 5.0 : 3.7;
                    const hFactor = preset.flatTiles ? 0.6 : 1.2;
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02); // stripe sits just in front of the wall
                        if (isMax) {
                            // Tiled bottom: cy - 0.38 to cy + 1.10
                            this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 1.10, mats.bottom, 1.2, -0.38 / hFactor, 1.10 / hFactor);
                            // Tiled green top: cy + 1.10 to cy + 3.68 (height 2.58m, same height as lower green wall)
                            this.buildSweptWall(stationGroup, sA, sB, off, cy + 1.10, cy + 3.68, mats.top, 1.2, 1.1 / hFactor, 3.68 / hFactor);
                            // Stripe: cy + 2.28 to cy + 2.50
                            this.buildSweptWall(stationGroup, sA, sB, offS, cy + 2.28, cy + 2.50, mats.stripe, 90 / repeatX, 0, 1);
                            // Concrete upper wall: cy + 3.68 to cy + 5.84 (ceiling height, coarser concrete texture scale 2.4)
                            this.buildSweptWall(stationGroup, sA, sB, off, cy + 3.68, cy + 5.84, this.stationConcreteWallMat, 2.4, 3.68 / 2.4, 5.84 / 2.4);
                        } else {
                            this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 1.10, mats.bottom, 1.2, -0.38 / hFactor, 1.10 / hFactor);
                            this.buildSweptWall(stationGroup, sA, sB, off, cy + 1.10, cy + 1.10 + topHeight, mats.top, 1.2, 1.1 / hFactor, (1.1 + topHeight) / hFactor);
                            this.buildSweptWall(stationGroup, sA, sB, offS, cy + 2.28, cy + 2.50, mats.stripe, 90 / repeatX, 0, 1);
                        }
                    }
                }
            } else if (station.name === "Hardhöhe") {
                // Outer Walls for Hardhöhe (4.8m high, extended down to -0.38m):
                const localWallR = stationGroup.worldToLocal(posWallR.clone());
                const localWallL = stationGroup.worldToLocal(posWallL.clone());
                
                // Main concrete walls + beige tiled band as continuous swept slabs (solid
                // colours), built once on j===0. Art panels / text below stay discrete.
                if (j === 0) {
                    const concreteWallMat = new THREE.MeshLambertMaterial({ color: '#d4d4d8' });
                    const tileMat = new THREE.MeshLambertMaterial({ color: '#d1b894' });
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const cw = [concreteWallMat, concreteWallMat];
                    const tb = [tileMat, tileMat];
                    for (const sign of [1, -1]) {
                        this.buildSweptBar(stationGroup, sA, sB, () => 0.1, cy + 4.8, cy - 0.38, cw, 1.2, (s) => sign * offW(s));
                        this.buildSweptBar(stationGroup, sA, sB, () => 0.02, cy + 0.90, cy - 0.38, tb, 1.2, (s) => sign * (offW(s) - 0.11));
                    }
                }
                
                // 2. Artistic panels or "HARDHÖHE" text (only at specific segments)
                // Wall panels in the middle of the station and closer together (j = 7, 9, 11, 13)
                const artIndices = [7, 9, 11, 13];
                const textIndices = [2, 4, 8, 10, 12, 14, 16];
                
                if (artIndices.includes(j)) {
                    const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                    
                    // LEFT WALL ART PANEL (at localWallR, positive X)
                    // Colorful background backing plate (dark backing)
                    const backingR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.5, 4.0), new THREE.MeshLambertMaterial({ color: '#1e293b' }));
                    backingR.position.copy(localWallR);
                    backingR.position.x -= 0.11;
                    backingR.position.y = 2.8;
                    backingR.rotation.y = rotY;
                    stationGroup.add(backingR);
                    
                    // Add vertical color stripes to represent the colourful artwork
                    const stripeColors = ['#ef4444', '#ea580c', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#eab308', '#22c55e', '#ef4444'];
                    const numStripes = 10;
                    const stripeW = 4.0 / numStripes;
                    
                    for (let i = 0; i < numStripes; i++) {
                        const stripeMat = new THREE.MeshLambertMaterial({ color: stripeColors[i] });
                        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.45, stripeW - 0.02), stripeMat);
                        const zOffset = -2.0 + (i + 0.5) * stripeW;
                        stripe.position.copy(backingR.position).addScaledVector(localDir, zOffset);
                        stripe.rotation.y = rotY;
                        stationGroup.add(stripe);
                    }
                    
                    // Louvers/slats in front of left art panel
                    const slatMat = new THREE.MeshLambertMaterial({ color: '#2a2d34' });
                    for (let sIdx = 0; sIdx < 12; sIdx++) {
                        const slatY = 1.65 + sIdx * 0.21;
                        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 4.0), slatMat);
                        slat.position.copy(localWallR);
                        slat.position.x -= 0.14; // in front of the art panel
                        slat.position.y = slatY;
                        slat.rotation.y = rotY;
                        stationGroup.add(slat);
                    }
                    
                    // RIGHT WALL ART PANEL (at localWallL, negative X)
                    const backingL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.5, 4.0), new THREE.MeshLambertMaterial({ color: '#1e293b' }));
                    backingL.position.copy(localWallL);
                    backingL.position.x += 0.11;
                    backingL.position.y = 2.8;
                    backingL.rotation.y = rotY;
                    stationGroup.add(backingL);
                    
                    for (let i = 0; i < numStripes; i++) {
                        const stripeMat = new THREE.MeshLambertMaterial({ color: stripeColors[numStripes - 1 - i] });
                        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.45, stripeW - 0.02), stripeMat);
                        const zOffset = -2.0 + (i + 0.5) * stripeW;
                        stripe.position.copy(backingL.position).addScaledVector(localDir, zOffset);
                        stripe.rotation.y = rotY;
                        stationGroup.add(stripe);
                    }
                    
                    for (let sIdx = 0; sIdx < 12; sIdx++) {
                        const slatY = 1.65 + sIdx * 0.21;
                        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 4.0), slatMat);
                        slat.position.copy(localWallL);
                        slat.position.x += 0.14; // in front of the art panel
                        slat.position.y = slatY;
                        slat.rotation.y = rotY;
                        stationGroup.add(slat);
                    }
                } else if (textIndices.includes(j)) {
                    // Place "HARDHÖHE" text on left wall (localWallR, positive X, facing negative X)
                    const textMeshR = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.625), wallTextMat);
                    textMeshR.position.copy(localWallR);
                    textMeshR.position.x -= 0.11;
                    textMeshR.position.y = 2.2;
                    textMeshR.rotation.set(0, rotY - Math.PI / 2, 0); // Face tracks
                    
                    // Place "HARDHÖHE" text on right wall (localWallL, negative X, facing positive X)
                    const textMeshL = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.625), wallTextMat);
                    textMeshL.position.copy(localWallL);
                    textMeshL.position.x += 0.11;
                    textMeshL.position.y = 2.2;
                    textMeshL.rotation.set(0, rotY + Math.PI / 2, 0); // Face tracks
                    
                    stationGroup.add(textMeshR, textMeshL);
                }
            } else if (isRoethenbach) {
                if (j === 0) {
                    const tileMats = this.getRoethenbachTileMats();
                    const heights = [
                        [-0.38, 0.60],
                        [0.60, 1.60],
                        [1.60, 2.60],
                        [2.60, 3.60],
                        [3.60, 4.66]
                    ];
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02);
                        for (let i = 0; i < 5; i++) {
                            const y1 = cy + heights[i][0];
                            const y2 = cy + heights[i][1];
                            this.buildSweptWall(stationGroup, sA, sB, off, y1, y2, tileMats[i], 1.2, heights[i][0] / 1.2, heights[i][1] / 1.2);
                        }
                        
                        const textMat = this.getRoethenbachTextMat();
                        const textGeom = new THREE.PlaneGeometry(3.6, 0.45);
                        for (let z = -platLength / 2 + 1.5; z <= platLength / 2 - 1.5; z += 3.0) {
                            const s = station.position + z;
                            const posT = this.sim.getTrackPosition(s);
                            const tanT = this.sim.getTrackTangent(s);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(s));
                            
                            const textMesh = new THREE.Mesh(textGeom, textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.1;
                            textMesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(textMesh);
                        }
                    }
                }
            } else if (isHoheMarter) {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    
                    if (!this._hoheMarterSolidMat) {
                        this._hoheMarterSolidMat = new THREE.MeshLambertMaterial({ color: '#1a1c19' });
                    }
                    if (!this._hoheMarterStripeMat) {
                        this._hoheMarterStripeMat = new THREE.MeshLambertMaterial({ color: '#44403D' });
                    }

                    // Left side (sign = 1)
                    {
                        const off = (s) => offW(s);
                        const offS = (s) => offW(s) - 0.02;
                        const tileMat = this.getHoheMarterTileMatFlughafen();
                        
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 1.10, tileMat, 10.0, -0.38 / 2.5, 1.10 / 2.5);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 1.10, cy + 4.66, this._hoheMarterSolidMat, 1.2, 0, 1);
                        
                        const textMat = this.getHoheMarterTextMat(1);
                        const textGeom = new THREE.PlaneGeometry(3.6, 0.45);
                        for (let z = -platLength / 2 + 1.5; z <= platLength / 2 - 1.5; z += 3.0) {
                            const s = station.position + z;
                            const posT = this.sim.getTrackPosition(s);
                            const tanT = this.sim.getTrackTangent(s);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(s));
                            
                            const textMesh = new THREE.Mesh(textGeom, textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.2;
                            textMesh.rotation.set(0, rotYT + Math.PI / 2, 0);
                            stationGroup.add(textMesh);
                        }
                    }
                    
                    // Right side (sign = -1)
                    {
                        const off = (s) => -offW(s);
                        const offS = (s) => -(offW(s) - 0.02);
                        const tileMat = this.getHoheMarterTileMatGrossreuth();
                        
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 4.66, tileMat, 10.0, -0.38 / 2.5, 4.66 / 2.5);
                        this.buildSweptWall(stationGroup, sA, sB, offS, cy + 1.15, cy + 2.15, this._hoheMarterStripeMat, 1.2, 0, 1);
                        
                        const textMat = this.getHoheMarterTextMat(-1);
                        const textGeom = new THREE.PlaneGeometry(3.6, 0.45);
                        for (let z = -platLength / 2 + 1.5; z <= platLength / 2 - 1.5; z += 3.0) {
                            const s = station.position + z;
                            const posT = this.sim.getTrackPosition(s);
                            const tanT = this.sim.getTrackTangent(s);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(s));
                            
                            const textMesh = new THREE.Mesh(textGeom, textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 1.65;
                            textMesh.rotation.set(0, rotYT - Math.PI / 2, 0);
                            stationGroup.add(textMesh);
                        }
                    }
                }
            } else if (isSchweinau) {
                if (j === 0) {
                    const spacing = this.sim.getTrackSpacing(station.position);
                    const tubeCenterL = spacing / 4 + 1.2;
                    const tubeCenterR = -tubeCenterL;
                    const tubeRadius = tubeCenterL;
                    const panelRadius = tubeRadius - 0.02;

                    const thetaStart = Math.acos(0);
                    const thetaEnd = Math.acos(-2.5 / panelRadius);
                    const panelSteps = 16;
                    const panelProfileL = [];
                    for (let k = 0; k <= panelSteps; k++) {
                        const theta = thetaStart + (thetaEnd - thetaStart) * k / panelSteps;
                        panelProfileL.push({ x: panelRadius * Math.sin(theta), y: -panelRadius * Math.cos(theta) });
                    }
                    const panelProfileR = panelProfileL.map(p => ({ x: -p.x, y: p.y }));

                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const cy = centerPos.y;
                    const wallMat = this.getSchweinauBrickMat(station, platLength, centerPos, centerAngle);

                    this.buildSweptProfile(stationGroup, sA, sB, panelProfileL, cy + 0.865, () => tubeCenterL, wallMat, 1.0);
                    this.buildSweptProfile(stationGroup, sA, sB, panelProfileR, cy + 0.865, () => tubeCenterR, wallMat, 1.0);

                    // Schweinau name stripe
                    const stripeRadius = panelRadius - 0.005;
                    const thetaMin = Math.acos(-1.33 / stripeRadius);
                    const thetaMax = Math.acos(-1.15 / stripeRadius);
                    const stripeProfileL = [];
                    for (let k = 0; k <= 4; k++) {
                        const theta = thetaMin + (thetaMax - thetaMin) * k / 4;
                        stripeProfileL.push({ x: stripeRadius * Math.sin(theta), y: -stripeRadius * Math.cos(theta) });
                    }
                    const stripeProfileR = stripeProfileL.map(p => ({ x: -p.x, y: p.y }));
                    const stripeMat = this.getSchweinauStripeMat(station, platLength, centerPos, centerAngle);

                    this.buildSweptProfile(stationGroup, sA, sB, stripeProfileL, cy + 0.865, () => tubeCenterL, stripeMat, 3.0);
                    this.buildSweptProfile(stationGroup, sA, sB, stripeProfileR, cy + 0.865, () => tubeCenterR, stripeMat, 3.0);

                    // Vault passages (Zwischendurchgänge)
                    const archLength = 8.0;
                    const rPassage = 4.5;
                    const tubeRadiusPassage = spacing / 4 + 1.2;
                    
                    const buildPassageTube = (zPos) => {
                        const s_mid = station.position + zPos;
                        if (s_mid < sA || s_mid > sB) return;
                        const posP = this.sim.getTrackPosition(s_mid);
                        const tangentP = this.sim.getTrackTangent(s_mid);
                        const rotYP = Math.atan2(tangentP.x, tangentP.z) - centerAngle;
                        const localPosP = stationGroup.worldToLocal(posP.clone());

                        const crossGeom = new THREE.CylinderGeometry(rPassage, rPassage, archLength, 64, 1, true, 0, Math.PI);
                        const matrix = new THREE.Matrix4();
                        matrix.set(
                            0, 1, 0, 0,
                            1, 0, 0, 0.865,
                            0, 0, -1, 0,
                            0, 0, 0, 1
                        );
                        crossGeom.applyMatrix4(matrix);

                        const passageMat = new THREE.MeshLambertMaterial({ color: '#475569', side: THREE.DoubleSide });
                        passageMat.onBeforeCompile = (shader) => {
                            shader.vertexShader = `
                                varying vec3 vLocalPosForClip;
                                ${shader.vertexShader}
                            `.replace(
                                '#include <project_vertex>',
                                `
                                #include <project_vertex>
                                vLocalPosForClip = position.xyz;
                                `
                            );
                            
                            shader.fragmentShader = `
                                varying vec3 vLocalPosForClip;
                                ${shader.fragmentShader}
                            `.replace(
                                '#include <clipping_planes_fragment>',
                                `
                                #include <clipping_planes_fragment>
                                float tR = ${tubeRadiusPassage.toFixed(5)};
                                float dy = vLocalPosForClip.y - 0.865;
                                float distL = (vLocalPosForClip.x - tR) * (vLocalPosForClip.x - tR) + dy * dy;
                                float distR = (vLocalPosForClip.x + tR) * (vLocalPosForClip.x + tR) + dy * dy;
                                if (distL < tR * tR || distR < tR * tR) {
                                    discard;
                                }
                                `
                            );
                        };

                        const crossTube = new THREE.Mesh(crossGeom, passageMat);
                        crossTube.position.copy(localPosP);
                        crossTube.rotation.y = rotYP;
                        stationGroup.add(crossTube);
                    };

                    buildPassageTube(-25);
                    buildPassageTube(0);
                    buildPassageTube(25);

                    // Schweinau lights (Lorenzkirche style)
                    const lightW = 0.4;
                    const hangerLen = 1.0;
                    const lightY = 0.865 + tubeRadius - hangerLen;
                    const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
                    const casingMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
                    const hangerMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });
                    const hangerGeom = new THREE.CylinderGeometry(0.02, 0.02, hangerLen, 8);

                    [tubeCenterL, tubeCenterR].forEach(centerX => {
                        this.buildSweptBar(stationGroup, sA, sB, () => lightW / 2,
                            cy + lightY + 0.1, cy + lightY - 0.05, [casingMat, casingMat], 1.2, (s) => centerX);
                        this.buildSweptBar(stationGroup, sA, sB, () => (lightW - 0.05) / 2,
                            cy + lightY + 0.025, cy + lightY - 0.075, [lightMat, lightMat], 1.2, (s) => centerX);

                        for (let jj = 0; jj < numSub; jj++) {
                            const s_mid = sA + (jj + 0.5) * subLen;
                            [-1.25, 1.25].forEach(tOff => {
                                const s = s_mid + tOff;
                                const posH = this.sim.getTrackPosition(s);
                                const tangentH = this.sim.getTrackTangent(s);
                                const rotYH = Math.atan2(tangentH.x, tangentH.z) - centerAngle;
                                const normH = new THREE.Vector3(-tangentH.z, 0, tangentH.x);
                                const hanger = new THREE.Mesh(hangerGeom, hangerMat);
                                hanger.position.copy(stationGroup.worldToLocal(posH.clone().addScaledVector(normH, centerX)));
                                hanger.position.y = lightY + hangerLen / 2;
                                hanger.rotation.y = rotYH;
                                stationGroup.add(hanger);
                            });
                        }
                    });
                }
            } else if (isRothenburger) {
                if (j === 0) {
                    const spacing = this.sim.getTrackSpacing(station.position);
                    const tubeCenterL = spacing / 4 + 1.2;
                    const tubeCenterR = -tubeCenterL;
                    const tubeRadius = tubeCenterL;
                    const panelRadius = tubeRadius - 0.02;

                    const thetaStart = Math.acos(0);
                    const thetaEnd = Math.acos(-2.5 / panelRadius);
                    const panelSteps = 16;
                    const panelProfileL = [];
                    for (let k = 0; k <= panelSteps; k++) {
                        const theta = thetaStart + (thetaEnd - thetaStart) * k / panelSteps;
                        panelProfileL.push({ x: panelRadius * Math.sin(theta), y: -panelRadius * Math.cos(theta) });
                    }
                    const panelProfileR = panelProfileL.map(p => ({ x: -p.x, y: p.y }));

                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const cy = centerPos.y;
                    const wallMat = this.getRothenburgerGravelMat(station, platLength, centerPos, centerAngle);

                    this.buildSweptProfile(stationGroup, sA, sB, panelProfileL, cy + 0.865, () => tubeCenterL, wallMat, 1.2);
                    this.buildSweptProfile(stationGroup, sA, sB, panelProfileR, cy + 0.865, () => tubeCenterR, wallMat, 1.2);

                    // Vault passages (Zwischendurchgänge)
                    const archLength = 8.0;
                    const rPassage = 4.5;
                    const tubeRadiusPassage = spacing / 4 + 1.2;
                    
                    const buildPassageTube = (zPos) => {
                        const s_mid = station.position + zPos;
                        if (s_mid < sA || s_mid > sB) return;
                        const posP = this.sim.getTrackPosition(s_mid);
                        const tangentP = this.sim.getTrackTangent(s_mid);
                        const rotYP = Math.atan2(tangentP.x, tangentP.z) - centerAngle;
                        const localPosP = stationGroup.worldToLocal(posP.clone());

                        const crossGeom = new THREE.CylinderGeometry(rPassage, rPassage, archLength, 64, 1, true, 0, Math.PI);
                        const matrix = new THREE.Matrix4();
                        matrix.set(
                            0, 1, 0, 0,
                            1, 0, 0, 0.865,
                            0, 0, -1, 0,
                            0, 0, 0, 1
                        );
                        crossGeom.applyMatrix4(matrix);

                        const passageMat = new THREE.MeshLambertMaterial({ color: '#333333', side: THREE.DoubleSide });
                        passageMat.onBeforeCompile = (shader) => {
                            shader.vertexShader = `
                                varying vec3 vLocalPosForClip;
                                ${shader.vertexShader}
                            `.replace(
                                '#include <project_vertex>',
                                `
                                #include <project_vertex>
                                vLocalPosForClip = position.xyz;
                                `
                            );
                            
                            shader.fragmentShader = `
                                varying vec3 vLocalPosForClip;
                                ${shader.fragmentShader}
                            `.replace(
                                '#include <clipping_planes_fragment>',
                                `
                                #include <clipping_planes_fragment>
                                float tR = ${tubeRadiusPassage.toFixed(5)};
                                float dy = vLocalPosForClip.y - 0.865;
                                float distL = (vLocalPosForClip.x - tR) * (vLocalPosForClip.x - tR) + dy * dy;
                                float distR = (vLocalPosForClip.x + tR) * (vLocalPosForClip.x + tR) + dy * dy;
                                if (distL < tR * tR || distR < tR * tR) {
                                    discard;
                                }
                                `
                            );
                        };

                        const crossTube = new THREE.Mesh(crossGeom, passageMat);
                        crossTube.position.copy(localPosP);
                        crossTube.rotation.y = rotYP;
                        stationGroup.add(crossTube);
                    };

                    buildPassageTube(-25);
                    buildPassageTube(0);
                    buildPassageTube(25);

                    // Rothenburger lights (Lorenzkirche style)
                    const lightW = 0.4;
                    const hangerLen = 1.0;
                    const lightY = 0.865 + tubeRadius - hangerLen;
                    const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
                    const casingMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
                    const hangerMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });
                    const hangerGeom = new THREE.CylinderGeometry(0.02, 0.02, hangerLen, 8);

                    [tubeCenterL, tubeCenterR].forEach(centerX => {
                        this.buildSweptBar(stationGroup, sA, sB, () => lightW / 2,
                            cy + lightY + 0.1, cy + lightY - 0.05, [casingMat, casingMat], 1.2, (s) => centerX);
                        this.buildSweptBar(stationGroup, sA, sB, () => (lightW - 0.05) / 2,
                            cy + lightY + 0.025, cy + lightY - 0.075, [lightMat, lightMat], 1.2, (s) => centerX);

                        for (let jj = 0; jj < numSub; jj++) {
                            const s_mid = sA + (jj + 0.5) * subLen;
                            [-1.25, 1.25].forEach(tOff => {
                                const s = s_mid + tOff;
                                const posH = this.sim.getTrackPosition(s);
                                const tangentH = this.sim.getTrackTangent(s);
                                const rotYH = Math.atan2(tangentH.x, tangentH.z) - centerAngle;
                                const normH = new THREE.Vector3(-tangentH.z, 0, tangentH.x);
                                const hanger = new THREE.Mesh(hangerGeom, hangerMat);
                                hanger.position.copy(stationGroup.worldToLocal(posH.clone().addScaledVector(normH, centerX)));
                                hanger.position.y = lightY + hangerLen / 2;
                                hanger.rotation.y = rotYH;
                                stationGroup.add(hanger);
                            });
                        }
                    });

                    // Rothenburger ovals (every 12m)
                    const plaqueW = 4.4;
                    const plaqueH = 1.0;
                    const plaqueGeom = new THREE.PlaneGeometry(plaqueW, plaqueH);
                    const plaqueMat = this.getRothenburgerPlaqueMat();
                    const dy = 1.235;
                    const theta = Math.asin(dy / panelRadius);
                    const plaqueXLocal = panelRadius * Math.cos(theta) - 0.035;

                    const stationPlaqueZ = [-36, -24, -12, 0, 12, 24, 36];
                    stationPlaqueZ.forEach(pz => {
                        const s = station.position + pz;
                        if (s < sA || s > sB) return;
                        // Skip placing plaques where the cross tubes (Zwischendurchgänge) are
                        if (pz === 0 || pz === 24 || pz === -24) return;
                        
                        const posT = this.sim.getTrackPosition(s);
                        const tangentT = this.sim.getTrackTangent(s);
                        const rotYT = Math.atan2(tangentT.x, tangentT.z) - centerAngle;
                        const normalT = new THREE.Vector3(-tangentT.z, 0, tangentT.x);
                        
                        // Left
                        const pL = posT.clone().addScaledVector(normalT, tubeCenterL + plaqueXLocal);
                        const pMeshL = new THREE.Mesh(plaqueGeom, plaqueMat);
                        pMeshL.position.copy(stationGroup.worldToLocal(pL));
                        pMeshL.position.y = 0.865 + dy;
                        pMeshL.rotation.set(0, rotYT - Math.PI / 2, 0);
                        stationGroup.add(pMeshL);

                        // Right
                        const pR = posT.clone().addScaledVector(normalT, tubeCenterR - plaqueXLocal);
                        const pMeshR = new THREE.Mesh(plaqueGeom, plaqueMat);
                        pMeshR.position.copy(stationGroup.worldToLocal(pR));
                        pMeshR.position.y = 0.865 + dy;
                        pMeshR.rotation.set(0, rotYT + Math.PI / 2, 0);
                        stationGroup.add(pMeshR);
                    });
                }
            } else if (isWoehrder) {
                if (j === 0) {
                    // Full-height mosaic circle mural on both side walls (Rathenauplatz
                    // height, 10m), rough-rock ceiling; in the middle third a big
                    // mosaic-clad cuboid reaches deep down into the hall.
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const yBot = cy - 0.38;
                    const yCeil = cy + 10.0;
                    const circlesMat = this.getWoehrderCirclesMat();
                    const worldW = circlesMat.map.userData.worldW;
                    const worldH = circlesMat.map.userData.worldH;

                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02);
                        this.buildSweptWall(stationGroup, sA, sB, off, yBot, yCeil, circlesMat, worldW, yBot / worldH, yCeil / worldH);

                        // Small name logos set directly into the mosaic
                        const muralTextGeom = new THREE.PlaneGeometry(2.4, 0.3);
                        const textMat = this.getBarrelTextMat(station.name);
                        for (let z = -platLength / 2 + 6.0; z <= platLength / 2 - 3.0; z += 12.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(sT));

                            const textMesh = new THREE.Mesh(muralTextGeom, textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.30;
                            textMesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(textMesh);
                        }
                    }

                    // Big rough-concrete mass crossing the middle third of the hall (photo):
                    // flush with both mosaic walls, its footprint skewed in plan (diagonal),
                    // the end faces leaning inward toward the bottom. Only the visible faces
                    // are built — the underside and the two skewed ends, all in the same
                    // exposed-aggregate texture as the ceiling; the top is closed by the
                    // ceiling itself, the sides vanish flush into the walls.
                    const rockMat = this.getWoehrderRockMat();
                    const halfLen = platLength / 6;
                    const skew = 5.0;   // plan diagonal: +s shift on the +offW wall, −s on the other
                    const lean = 1.8;   // end faces lean: bottom edges pulled toward the centre
                    const yBoxBot = cy + 4.7;
                    const texM = 3.0;   // aggregate tiles every 3m
                    const wallPt = (side, s, y) => {
                        const p = this.sim.getTrackPosition(s);
                        const t = this.sim.getTrackTangent(s);
                        const nl = Math.hypot(-t.z, t.x) || 1;
                        const off = side * offW(s);
                        return stationGroup.worldToLocal(new THREE.Vector3(p.x + (-t.z / nl) * off, y, p.z + (t.x / nl) * off));
                    };
                    const kPos = [], kUv = [];
                    const kTri = (a, b, c, ua, ub, uc) => {
                        kPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
                        kUv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
                    };
                    const kQuad = (p0, p1, p2, p3, u0, u1, u2, u3) => { kTri(p0, p1, p2, u0, u1, u2); kTri(p0, p2, p3, u0, u2, u3); };

                    // Underside: strip between the two walls over the skewed, leaned s-ranges
                    const sc = station.position;
                    const sL0 = sc - halfLen + skew + lean, sL1 = sc + halfLen + skew - lean;
                    const sR0 = sc - halfLen - skew + lean, sR1 = sc + halfLen - skew - lean;
                    const nR = 30;
                    const rings = [];
                    for (let r = 0; r <= nR; r++) {
                        const t = r / nR;
                        rings.push({
                            L: wallPt(1, sL0 + (sL1 - sL0) * t, yBoxBot),
                            R: wallPt(-1, sR0 + (sR1 - sR0) * t, yBoxBot)
                        });
                    }
                    let kU = 0;
                    for (let r = 0; r < nR; r++) {
                        const A = rings[r], B = rings[r + 1];
                        const kU1 = kU + A.L.distanceTo(B.L) / texM;
                        const vA = A.L.distanceTo(A.R) / texM, vB = B.L.distanceTo(B.R) / texM;
                        kQuad(A.L, A.R, B.R, B.L, [kU, 0], [kU, vA], [kU1, vB], [kU1, 0]);
                        kU = kU1;
                    }
                    // Skewed end faces (top edge at the ceiling, bottom edge leaned inward)
                    for (const endSign of [-1, 1]) {
                        const sTop = sc + endSign * halfLen;
                        const sBot = sTop - endSign * lean;
                        const TL = wallPt(1, sTop + skew, yCeil);
                        const TR = wallPt(-1, sTop - skew, yCeil);
                        const BL = wallPt(1, sBot + skew, yBoxBot);
                        const BR = wallPt(-1, sBot - skew, yBoxBot);
                        const wFace = BL.distanceTo(BR) / texM;
                        const hFace = (yCeil - yBoxBot) / texM;
                        kQuad(BL, BR, TR, TL, [0, 0], [wFace, 0], [wFace, hFace], [0, hFace]);
                    }
                    const klotzGeom = new THREE.BufferGeometry();
                    klotzGeom.setAttribute('position', new THREE.Float32BufferAttribute(kPos, 3));
                    klotzGeom.setAttribute('uv', new THREE.Float32BufferAttribute(kUv, 2));
                    klotzGeom.computeVertexNormals();
                    const klotzMat = rockMat.clone();
                    klotzMat.side = THREE.DoubleSide;
                    stationGroup.add(new THREE.Mesh(klotzGeom, klotzMat));
                }
            } else if (isRathenauplatz) {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const yBot = cy - 0.38;
                    const yCeil = cy + 10.0;
                    const tileMat = this.getRathenauTileMat();

                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02);
                        this.buildSweptWall(stationGroup, sA, sB, off, yBot, yCeil, tileMat, 1.2, yBot / 1.2, yCeil / 1.2);

                        const herzlMat = this.getRathenauHerzlMat();
                        const rathenauMat = this.getRathenauRathenauMat();

                        const sHerzl = station.position - 20.0;
                        const herzlOff = (s) => offS(s) - sign * 0.015;
                        this.buildSweptWall(stationGroup, sHerzl - 8.0, sHerzl + 8.0, herzlOff, cy + 0.5, cy + 8.5, herzlMat, 16.0, 0, 1);

                        const sRathenau = station.position + 20.0;
                        const rathenauOff = (s) => offS(s) - sign * 0.015;
                        this.buildSweptWall(stationGroup, sRathenau - 8.0, sRathenau + 8.0, rathenauOff, cy + 0.5, cy + 8.5, rathenauMat, 16.0, 0, 1);

                        const sQuote = station.position;
                        const quoteOff = (s) => offS(s) - sign * 0.015;
                        this.buildSweptWall(stationGroup, sQuote - 8.0, sQuote + 8.0, quoteOff, cy + 2.5, cy + 6.5, this.getRathenauQuoteMat(), 16.0, 0, 1);

                        const textW = 3.6;
                        const textH = 0.45;
                        const textGeom = new THREE.PlaneGeometry(textW, textH);
                        const textMat = this.getRathenauTextMat();
                        
                        for (let z = -platLength / 2 + 2.0; z <= platLength / 2 - 2.0; z += 4.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(sT));
                            
                            const textMesh = new THREE.Mesh(textGeom, textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.1;
                            textMesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(textMesh);
                        }
                    }
                }
            } else if (isAufsessplatzLook) {
                // Red/white tiled 3-layer walls + name stripe as continuous swept ribbons, once.
                if (j === 0) {
                    const repeatX = Math.round(platLength / (0.35 * (384 / 64)));
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 0.75, aufsessplatzRedTileMat, 1.2, -0.38 / 1.2, 0.75 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 0.75, cy + 3.46, aufsessplatzWhiteTileMat, 1.2, 0.75 / 1.2, 3.46 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 3.46, cy + 4.59, aufsessplatzRedTileMat, 1.2, 3.46 / 1.2, 4.59 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, offS, cy + 2.015, cy + 2.195, aufsessplatzStripeMat, 90 / repeatX, 0, 1);
                    }
                }
            } else if (isGrossreuth) {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02);
                        // Lower sixth (1m high)
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 0.62, grossreuthLowerTileMat, 1.2, -0.38 / 1.2, 0.62 / 1.2);
                        // Upper wall (5m high)
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 0.62, cy + 5.62, grossreuthUpperTileMat, 5.0, 0, 1);

                        // Signage every 3m
                        const textGeom = new THREE.PlaneGeometry(2.4, 0.3);
                        for (let z = -platLength / 2 + 1.5; z <= platLength / 2 - 1.5; z += 3.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(sT));

                            const textMesh = new THREE.Mesh(textGeom, grossreuthSignMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.0;
                            textMesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(textMesh);
                        }

                        // Beam at the height of the white platform beam (#29261D)
                        this.buildSweptWall(stationGroup, sA, sB, offS, cy + 1.15, cy + 1.17, grossreuthBeamMat, 1.2, 0, 1);
                    }
                }
            } else if (isFriedrichEbert) {
                // Friedrich-Ebert-Platz (U3, Fotos): helle Sichtbeton-Wände mit
                // dem orangefarbenen Flechtwerk-Relief (Korbgeflecht aus
                // liegenden/stehenden Keramikriegeln im Schachbrett), orange
                // Namenstafeln mit weißer Schrift, durchgehende ORANGE Deckenfläche
                // mit einem hellen Rippenkamm + Neonband entlang beider Kanten
                // (Fotos 2-4), rot-oranger Terrazzoboden, wuchtige orange
                // Terrazzo-Bänke mit dunkler Sitzkante, orange Werbestelen.
                // Stützenfrei; Standardlampen aus.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const ceilY = 4.66;

                    // 1. Wände: Beton mit Flechtwerk-Band (Kachel = 2.4 m)
                    const wallMat = this.getFriedrichEbertWallMat();
                    for (const sign of [1, -1]) {
                        this.buildSweptWall(stationGroup, sA, sB, (s) => sign * offW(s), cy - 0.38, cy + ceilY, wallMat, 2.4, 0, 1);
                    }

                    // 2. Orange Namenstafeln alle 12 m auf beiden Wänden
                    const signGeom = new THREE.PlaneGeometry(2.6, 0.4);
                    const signMat = this.getFriedrichEbertSignMat();
                    for (const sign of [1, -1]) {
                        for (let z = -platLength / 2 + 6.0; z <= platLength / 2 - 6.0; z += 12.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pT = posT.clone().addScaledVector(normT, sign * (offW(sT) - 0.05));
                            const mesh = new THREE.Mesh(signGeom, signMat);
                            mesh.position.copy(stationGroup.worldToLocal(pT));
                            mesh.position.y = 2.35;
                            mesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(mesh);
                        }
                    }

                    // 3. Durchgehende ORANGE Deckenfläche (Fotos: satt orange,
                    // dominiert den Raum) — vorher fehlte hier eine echte
                    // Deckenplatte, nur die Randdetails waren da.
                    const ceilMat = this.getFriedrichEbertCeilingMat();
                    const cMats = [ceilMat, ceilMat];
                    const cHalfW = (s) => (this.sim.getTrackSpacing(s) + 3.66) / 2;
                    this.buildSweptBar(stationGroup, sA, sB, cHalfW, cy + ceilY + 0.1, cy + ceilY - 0.1, cMats, 1.2, () => 0, 1.2);

                    // 4. Heller Rippenkamm + Neonband an beiden Deckenrändern
                    // (Fotos 2-4): quer stehende Betonrippen alle 0.6 m über den
                    // Gleisen, mit dem Neon direkt darunter versteckt.
                    if (!this._friedrichEbertFinMat) {
                        this._friedrichEbertFinMat = new THREE.MeshLambertMaterial({
                            map: this.tunnelConcreteTexture, color: 0xffffff
                        });
                    }
                    const finGeom = new THREE.BoxGeometry(1.0, 0.5, 0.15);
                    const finM = [];
                    for (let z = -platLength / 2 + 0.6; z <= platLength / 2 - 0.6; z += 0.6) {
                        const sF = station.position + z;
                        const posF = this.sim.getTrackPosition(sF);
                        const tanF = this.sim.getTrackTangent(sF);
                        const rotYF = Math.atan2(tanF.x, tanF.z) - centerAngle;
                        const normF = new THREE.Vector3(-tanF.z, 0, tanF.x);
                        const spacingF = this.sim.getTrackSpacing(sF);
                        for (const sign of [1, -1]) {
                            const lp = stationGroup.worldToLocal(posF.clone().addScaledVector(normF, sign * (spacingF / 2 + 0.9)));
                            const m = new THREE.Matrix4().makeRotationY(rotYF);
                            m.setPosition(lp.x, ceilY - 0.1 - 0.25, lp.z);
                            finM.push(m);
                        }
                    }
                    const finInst = new THREE.InstancedMesh(finGeom, this._friedrichEbertFinMat, finM.length);
                    finM.forEach((m, i) => finInst.setMatrixAt(i, m));
                    finInst.instanceMatrix.needsUpdate = true;
                    finInst.computeBoundingSphere();
                    if (finInst.boundingSphere) finInst.boundingSphere.radius *= 5;
                    stationGroup.add(finInst);

                    const tubeMats = [this.materials.lightTube, this.materials.lightTube];
                    for (const sign of [1, -1]) {
                        for (const off of [0.35, 1.45]) {
                            this.buildSweptBar(stationGroup, sA + 0.5, sB - 0.5, () => 0.05,
                                cy + ceilY - 0.38, cy + ceilY - 0.45, tubeMats, 1.2,
                                (s) => sign * (this.sim.getTrackSpacing(s) / 2 + off));
                        }
                    }

                    // 5. Wuchtige orange Terrazzo-Bänke mit dunkler Sitzkante
                    // (Fotos 1/4: solider Block, kein Lattenrost)
                    if (!this._friedrichEbertBenchMat) {
                        this._friedrichEbertBenchMat = new THREE.MeshLambertMaterial({ color: '#c8622f' });
                        this._friedrichEbertBenchCapMat = new THREE.MeshLambertMaterial({ color: '#453833' });
                    }
                    [[-25, 1.8], [-10, -1.8], [10, 1.8], [25, -1.8]].forEach(([bz, bx]) => {
                        const sBch = station.position + bz;
                        const posBch = this.sim.getTrackPosition(sBch);
                        const tanBch = this.sim.getTrackTangent(sBch);
                        const rotYBch = Math.atan2(tanBch.x, tanBch.z) - centerAngle;
                        const normBch = new THREE.Vector3(-tanBch.z, 0, tanBch.x);
                        const g = new THREE.Group();
                        g.position.copy(stationGroup.worldToLocal(posBch.clone().addScaledVector(normBch, bx)));
                        g.position.y = 0.865;
                        g.rotation.y = rotYBch;
                        const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 2.2), this._friedrichEbertBenchMat);
                        base.position.y = 0.21;
                        g.add(base);
                        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 2.2), this._friedrichEbertBenchCapMat);
                        cap.position.y = 0.445;
                        g.add(cap);
                        stationGroup.add(g);
                    });

                    // 6. Orange Werbestelen mit Posterfläche (Fotos), neben je
                    // einer Bank
                    if (!this._friedrichEbertKioskMat) {
                        this._friedrichEbertKioskMat = new THREE.MeshLambertMaterial({ color: '#c8622f' });
                        this._friedrichEbertPosterMat = new THREE.MeshLambertMaterial({ color: '#e8e6df' });
                    }
                    [[-17, 1.8], [17, -1.8]].forEach(([kz, kx]) => {
                        const sK = station.position + kz;
                        const posK = this.sim.getTrackPosition(sK);
                        const tanK = this.sim.getTrackTangent(sK);
                        const rotYK = Math.atan2(tanK.x, tanK.z) - centerAngle;
                        const normK = new THREE.Vector3(-tanK.z, 0, tanK.x);
                        const g = new THREE.Group();
                        g.position.copy(stationGroup.worldToLocal(posK.clone().addScaledVector(normK, kx)));
                        g.position.y = 0.865;
                        g.rotation.y = rotYK;
                        const stele = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, 0.5), this._friedrichEbertKioskMat);
                        stele.position.y = 0.95;
                        g.add(stele);
                        for (const face of [1, -1]) {
                            const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), this._friedrichEbertPosterMat);
                            poster.position.set(face * 0.26, 1.35, 0);
                            poster.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
                            g.add(poster);
                        }
                        stationGroup.add(g);
                    });
                }
            } else if (isNordwestring) {
                // Nordwestring (U3, Fotos): helle Betonpaneel-Wände mit vertikalen
                // Farbstreifen (+x-Seite rot, -x-Seite grün), weiße
                // "NORDWESTRING"-Leuchtschilder, in der Deckenmitte die gezackte
                // SPIEGELDECKE (Zickzack-Facetten mit verschwommener Reflexion des
                // Bahnsteigs), seitlich helle Deckenplatten mit dunklen
                // Randbändern, Beleuchtung wie Plärrer (inkl. Namensschildern auf
                // den Trägern), Glasaufzug mitten auf dem Bahnsteig
                // (elevatorSpecs). Stützenfrei; Standardlampen aus.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const ceilY = 4.76;

                    // 1. Wände: helle Paneele mit Farbstreifen je Seite
                    for (const sign of [1, -1]) {
                        const mat = this.getNordwestringWallMat(sign > 0 ? '#c22a35' : '#2f7d4f');
                        this.buildSweptWall(stationGroup, sA, sB, (s) => sign * offW(s), cy - 0.38, cy + ceilY, mat, 2.5, 0, 1);
                    }

                    // 2. Weiße Leuchtschilder "NORDWESTRING" alle 12 m
                    const signGeom = new THREE.PlaneGeometry(2.2, 0.45);
                    const signMat = this.getNordwestringSignMat();
                    for (const sign of [1, -1]) {
                        for (let z = -platLength / 2 + 6.0; z <= platLength / 2 - 6.0; z += 12.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pT = posT.clone().addScaledVector(normT, sign * (offW(sT) - 0.05));
                            const mesh = new THREE.Mesh(signGeom, signMat);
                            mesh.position.copy(stationGroup.worldToLocal(pT));
                            mesh.position.y = 2.35;
                            mesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(mesh);
                        }
                    }

                    // 3. Decke: seitlich helle Betonplatten, dunkle Randbänder,
                    // in der Mitte die gezackte Spiegeldecke. Der Zickzack ist
                    // eine Dreieckswelle mit 2-m-Periode als botY-Funktion —
                    // buildSweptBar setzt seine Ringe alle ~1 m, trifft die
                    // Knickpunkte also exakt (kein Phasenrauschen).
                    if (!this._nordwestringCeilSideMat) {
                        this._nordwestringCeilSideMat = new THREE.MeshLambertMaterial({
                            map: this.tunnelConcreteTexture, color: 0xffffff, side: THREE.DoubleSide
                        });
                        this._nordwestringDarkMat = new THREE.MeshLambertMaterial({ color: '#2e3033' });
                    }
                    const sideMats = [this._nordwestringCeilSideMat, this._nordwestringCeilSideMat];
                    const darkMats = [this._nordwestringDarkMat, this._nordwestringDarkMat];
                    const cHalfW = (s) => (this.sim.getTrackSpacing(s) + 3.66) / 2;
                    for (const sign of [1, -1]) {
                        this.buildSweptBar(stationGroup, sA, sB,
                            (s) => (cHalfW(s) - 1.9) / 2, cy + ceilY, cy + ceilY - 0.2,
                            sideMats, 1.2, (s) => sign * ((1.9 + cHalfW(s)) / 2), 1.2);
                        this.buildSweptBar(stationGroup, sA, sB, () => 0.175,
                            cy + ceilY, cy + ceilY - 0.24, darkMats, 1.2, (s) => sign * 1.725);
                    }
                    const mirrorMat = this.getNordwestringMirrorMat();
                    const mirrorMats = [mirrorMat, mirrorMat];
                    const zigBot = (s) => cy + 4.30 + 0.24 * Math.abs(((s - sA) % 2) - 1);
                    this.buildSweptBar(stationGroup, sA, sB, () => 1.55,
                        cy + ceilY, zigBot, mirrorMats, 2.0, () => 0, 3.1);

                    // 4. Beleuchtung wie Plärrer (inkl. Stationsname auf den Trägern);
                    // Abhänger enden an der Unterkante der seitlichen Deckenplatten
                    this.buildPlaererLights(stationGroup, station, centerAngle, { sA, sB, cy, ceilY: 4.66 });
                }
            } else if (isRennweg) {
                // Rennweg (U2, Fotos): dunkle Waschbeton-Kaverne, an den
                // Gleiswänden große, gelb gerahmte Graffiti-Wandbilder mit
                // abgerundeten Ecken, weinrotes Namensband "RENNWEG", an der
                // Decke gelb gerahmte Ovale mit Weltall-Malerei, zwei lange
                // silberne Lichtbalken mit Neonband auf Stelzen, weinrote
                // Mittelbänke, weißer Fliesenboden. Stützenfrei; Standardlampen aus.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const spacingR = this.sim.getTrackSpacing(station.position);
                    const fixedOffW = spacingR / 2 + 1.83;
                    const cy = centerPos.y;
                    const ceilY = 4.66;
                    const curveStartH = 3.46;
                    const radiusR = ceilY - curveStartH;

                    const cavePts = [];
                    // Right wall bottom to curve start
                    cavePts.push({ x: fixedOffW, y: -0.38 });
                    cavePts.push({ x: fixedOffW, y: curveStartH });
                    // Right curve
                    for (let i = 1; i <= 8; i++) {
                        const a = (i / 8) * Math.PI / 2;
                        cavePts.push({ x: fixedOffW - radiusR * (1 - Math.cos(a)), y: curveStartH + radiusR * Math.sin(a) });
                    }
                    // Left curve (mirrored)
                    for (let i = 7; i >= 0; i--) {
                        const a = (i / 8) * Math.PI / 2;
                        cavePts.push({ x: -(fixedOffW - radiusR * (1 - Math.cos(a))), y: curveStartH + radiusR * Math.sin(a) });
                    }
                    // Left curve start to wall bottom
                    cavePts.push({ x: -fixedOffW, y: curveStartH });
                    cavePts.push({ x: -fixedOffW, y: -0.38 });

                    // 1. Waschbeton-Kavernenschale unified
                    const aggMat = this.getRennwegAggregateMat();
                    this.buildSweptProfile(stationGroup, sA, sB, cavePts, cy, null, aggMat, 3.0);

                    // 2. Graffiti-Wandbilder: je 12 m breite Felder
                    const graffA = this.getRennwegGraffitiMat(0);
                    const graffB = this.getRennwegGraffitiMat(1);
                    [-36, -18, 6, 24].forEach((z0, i) => {
                        const mat = (i % 2 === 0) ? graffA : graffB;
                        for (const sign of [1, -1]) {
                            this.buildSweptWall(stationGroup, station.position + z0, station.position + z0 + 12,
                                (s) => sign * (fixedOffW - 0.04), cy + 0.35, cy + 3.45, mat, 12.0, 0, 1);
                        }
                    });

                    // 3. Weinrotes Namensband auf 2m Höhe (Mitte)
                    const nameMat = this.getRennwegNameMat();
                    for (const sign of [1, -1]) {
                        this.buildSweptWall(stationGroup, sA, sB, (s) => sign * (fixedOffW - 0.03), cy + 1.875, cy + 2.125, nameMat, 3.0, 0, 1);
                    }

                    // 4. Gelbe vertikale Bänder an den Bildkanten, über die Decke verbunden
                    if (!this._rennwegYellowMat) this._rennwegYellowMat = new THREE.MeshLambertMaterial({ color: '#e3c31f' });
                    const yellowBandMat = this._rennwegYellowMat;
                    const bandPts = cavePts.map(p => {
                        let nx = 0, ny = 0;
                        if (p.y < curveStartH - 0.01) {
                            nx = p.x > 0 ? -1 : 1; // Vertical walls: shift horizontally
                        } else if (p.y > ceilY - 0.01) {
                            ny = -1; // Flat ceiling: shift downwards
                        } else {
                            // Rounded corners: shift along the inward radial normal
                            const cx = (p.x > 0) ? (fixedOffW - radiusR) : -(fixedOffW - radiusR);
                            const cy = curveStartH;
                            const dx = p.x - cx, dy = p.y - cy;
                            const mag = Math.hypot(dx, dy);
                            if (mag > 0.001) { nx = -dx / mag; ny = -dy / mag; }
                        }
                        const off = 0.015; // 1.5 cm inward to avoid Z-fighting and be visible
                        return { x: p.x + nx * off, y: p.y + ny * off };
                    });
                    const bandEdges = [-36, -24, -18, -6, 6, 18, 24, 36];
                    bandEdges.forEach(ze => {
                        const sE = station.position + ze;
                        this.buildSweptProfile(stationGroup, sE - 0.2, sE + 0.2, bandPts, cy, null, yellowBandMat, 10);
                    });

                    // 5. Decken-Ovale mit Weltall-Malerei (gelber Rand, transparente
                    // Ecken -> der Waschbeton scheint drumherum durch)
                    const cosmicMat = this.getRennwegCosmicMat();
                    const ovalGeom = new THREE.PlaneGeometry(9.0, 5.5);
                    [-22, 0, 22].forEach(zc => {
                        const sC = station.position + zc;
                        const posC = this.sim.getTrackPosition(sC);
                        const tanC = this.sim.getTrackTangent(sC);
                        const rotYC = Math.atan2(tanC.x, tanC.z) - centerAngle;
                        const oval = new THREE.Mesh(ovalGeom, cosmicMat);
                        oval.position.copy(stationGroup.worldToLocal(posC.clone()));
                        oval.position.y = ceilY - 0.12;
                        oval.rotation.set(Math.PI / 2, rotYC, 0);
                        oval.rotation.order = 'YXZ';
                        stationGroup.add(oval);
                    });

                    // 6. Runde Standard-Tonnenleuchte (Wöhrder-Wiese-Modell) mit
                    // Stationsnamen auf den Rundflächen, statt eigener Lichtbalken
                    this.buildBarrelLights(stationGroup, {
                        startS: sA + 3.0,
                        endS: sB - 3.0,
                        axisY: 3.775,
                        centerPosY: cy,
                        centerAngle,
                        offFn: (s) => this.sim.getTrackSpacing(s) / 2 - 1.785,
                        ceilY: 4.66,
                        label: station.name,
                    });

                    // 7. Weinrote Mittelbänke (Fotos), Reihe entlang der Bahnsteigmitte
                    if (!this._rennwegBenchMat) this._rennwegBenchMat = new THREE.MeshLambertMaterial({ color: '#7a2430' });
                    for (let bz = -31.5; bz <= 31.5; bz += 9) {
                        const sBch = station.position + bz;
                        const posBch = this.sim.getTrackPosition(sBch);
                        const tanBch = this.sim.getTrackTangent(sBch);
                        const rotYBch = Math.atan2(tanBch.x, tanBch.z) - centerAngle;
                        const g = new THREE.Group();
                        g.position.copy(stationGroup.worldToLocal(posBch.clone()));
                        g.position.y = 0.865;
                        g.rotation.y = rotYBch;
                        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.8), this._rennwegBenchMat);
                        seat.position.y = 0.46;
                        g.add(seat);
                        for (const e of [-0.6, 0.6]) {
                            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.43, 0.08), this._rennwegBenchMat);
                            leg.position.set(0, 0.215, e);
                            g.add(leg);
                        }
                        stationGroup.add(g);
                    }
                }
            } else if (isMaxfeld) {
                // Maxfeld (U3, Fotos): horizontale Edelstahl-Lamellenwände mit
                // Granitsockel, weiße Goethe-Zitattafeln, "MAXFELD"-Stahlschilder
                // mit gelbgrünen Lettern, Goethe-Porträt mit Infotafel, silberne
                // Halbrund-Röhre am Wandkopf, helle Decke mit durchgehenden
                // Lichtbändern + Sägezahn-Blenden, Edelstahl-Mittelbank.
                // Stützenfrei; eigene Lichtbänder statt der Standardlampen.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const ceilY = 4.66;

                    // 1. Lamellenwände raumhoch (Kachel = 2 m, Granitsockel unten)
                    const lamMat = this.getMaxfeldLamellenMat();
                    for (const sign of [1, -1]) {
                        this.buildSweptWall(stationGroup, sA, sB, (s) => sign * offW(s), cy - 0.38, cy + ceilY, lamMat, 2.0, 0, 1);
                    }

                    // 2. Silberne Hohlkehle am Wandkopf (Übergang Wand/Decke, nach innen gewölbt)
                    if (!this._maxfeldCoveMat) this._maxfeldCoveMat = new THREE.MeshLambertMaterial({ color: '#c9cdd0' });
                    const coveR = 0.80;
                    const coveSteps = 16;
                    const coveProfileL = [];
                    // Konkave Kurve (Hohlkehle) von der Wand zur Decke, zentriert auf die Ecklinie (offW, ceilY)
                    for (let k = 0; k <= coveSteps; k++) {
                        const a = (k / coveSteps) * Math.PI / 2;
                        coveProfileL.push({ x: -coveR * Math.sin(a), y: -coveR * Math.cos(a) });
                    }
                    const coveProfileR = coveProfileL.map(p => ({ x: -p.x, y: p.y }));
                    this.buildSweptProfile(stationGroup, sA, sB, coveProfileL, cy + ceilY, (s) => offW(s), this._maxfeldCoveMat, 4);
                    this.buildSweptProfile(stationGroup, sA, sB, coveProfileR, cy + ceilY, (s) => -offW(s), this._maxfeldCoveMat, 4);

                    // 3. Wandtafeln: Zitat-Stapel, Namensschilder, Goethe-Ensemble
                    const placePanel = (z, w, h, yMid, mat) => {
                        const sP = station.position + z;
                        const posP = this.sim.getTrackPosition(sP);
                        const tanP = this.sim.getTrackTangent(sP);
                        const rotYP = Math.atan2(tanP.x, tanP.z) - centerAngle;
                        const normP = new THREE.Vector3(-tanP.z, 0, tanP.x);
                        const geom = new THREE.PlaneGeometry(w, h);
                        for (const sign of [1, -1]) {
                            const pP = posP.clone().addScaledVector(normP, sign * (offW(sP) - 0.06));
                            const mesh = new THREE.Mesh(geom, mat);
                            mesh.position.copy(stationGroup.worldToLocal(pP));
                            mesh.position.y = yMid;
                            mesh.rotation.set(0, rotYP + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(mesh);
                        }
                    };
                    const quoteA = this.getMaxfeldQuoteMat(0);
                    const quoteB = this.getMaxfeldQuoteMat(1);
                    [-36, -27, -9, 9, 27, 36].forEach((z, i) => {
                        placePanel(z, 1.6, 2.6, 2.35, (i % 2 === 0) ? quoteA : quoteB);
                    });
                    [-13, 5, 23, 41].forEach(z => {
                        placePanel(z, 3.0, 0.45, 2.0, this.getMaxfeldNameMat());
                    });
                    // Goethe-Porträt + Infotafel (Foto 2), einmal je Wand
                    placePanel(-18, 1.3, 2.6, 2.25, this.getMaxfeldGoetheMat());

                    // 4. Beleuchtung wie Plärrer (Standardmodell buildPlaererLights,
                    // inkl. Stationsname in regelmäßigen Abständen auf den Trägern);
                    // bündig mit der Deckenunterkante (keine Abhänger).
                    this.buildPlaererLights(stationGroup, station, centerAngle, { sA, sB, cy, ceilY, flush: true });

                    // 5. Edelstahl-Mittelbank (Foto 1): langer Doppelsitz-Rücken an
                    // Rücken auf durchgehendem Sockel, mittig auf dem Bahnsteig
                    if (!this._maxfeldBenchSeatMat) {
                        this._maxfeldBenchSeatMat = new THREE.MeshLambertMaterial({ color: '#b4b8bc' });
                        this._maxfeldBenchBaseMat = new THREE.MeshLambertMaterial({ color: '#7c8084' });
                    }
                    for (let bz = -6; bz <= 6; bz += 3) {
                        const sBch = station.position + bz;
                        const posBch = this.sim.getTrackPosition(sBch);
                        const tanBch = this.sim.getTrackTangent(sBch);
                        const rotYBch = Math.atan2(tanBch.x, tanBch.z) - centerAngle;
                        const g = new THREE.Group();
                        g.position.copy(stationGroup.worldToLocal(posBch.clone()));
                        g.position.y = 0.865;
                        g.rotation.y = rotYBch;
                        const base = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.42, 2.95), this._maxfeldBenchBaseMat);
                        base.position.y = 0.21;
                        g.add(base);
                        for (const sgn of [1, -1]) {
                            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 2.95), this._maxfeldBenchSeatMat);
                            seat.position.set(sgn * 0.33, 0.46, 0);
                            seat.rotation.z = -sgn * 0.20;
                            g.add(seat);
                        }
                        stationGroup.add(g);
                    }
                }
            } else if (isFlughafen) {
                // Flughafen (U2, Fotos): Sichtbeton-Wände mit horizontalem
                // Aluprofil-Raster, blaue Kunstpaneele (Pfeilmotive), Dürer-
                // Selbstbildnis + Infotafel, "Flughafen"/"Airport"-Leuchtschilder,
                // gelbes Doppel-Handlaufrohr, Stahlraster-Decke mit ZWEI großen
                // hellen Lichteinlässen (verglaste Atrien mit Tageslicht): einer
                // mit Rolltreppenanlage, einer mit Glasaufzug (elevatorSpecs).
                // Stützenfrei; eigene Lichtbänder statt der Standardlampen.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const ceilY = 5.0;        // Deckenunterkante (höher als Standard 4.66)
                    const atriumTop = 7.8;    // Oberkante der beiden Lichteinlässe
                    // Vertauscht ggü. der ersten Fassung: Rolltreppe jetzt im hinteren,
                    // Aufzug im vorderen Lichteinlass. Die Rolltreppen-Öffnung ist breiter
                    // (11 statt 6 m), weil eine einzelne Fahrspur mit ~26 Stufen a 0.3 m
                    // Tiefe eine Lauflänge von knapp 8 m entlang der Gleisachse braucht.
                    const escGap = [-27, -16];  // Lichteinlass 1: einzelne Rolltreppe
                    const liftGap = [6, 12];    // Lichteinlass 2: Glasaufzug (elevatorSpecs)

                    // 1. Wände: Sichtbeton mit Aluprofil-Raster (Kachel = 4 m)
                    const wallMat = this.getFlughafenWallMat();
                    for (const sign of [1, -1]) {
                        this.buildSweptWall(stationGroup, sA, sB, (s) => sign * offW(s), cy - 0.38, cy + ceilY, wallMat, 4.0, 0, 1);
                    }

                    // 2. Gelbes Doppel-Handlaufrohr an beiden Wänden (Foto 4 unten)
                    if (!this._flughafenYellowMat) this._flughafenYellowMat = new THREE.MeshLambertMaterial({ color: '#d9a52f' });
                    const yMats = [this._flughafenYellowMat, this._flughafenYellowMat];
                    for (const sign of [1, -1]) {
                        for (const railY of [0.62, 0.82]) {
                            this.buildSweptBar(stationGroup, sA, sB, () => 0.035,
                                cy + railY + 0.07, cy + railY, yMats, 1.2, (s) => sign * (offW(s) - 0.14));
                        }
                    }

                    // 3. Wandpaneele: Pfeilkunst-Gruppen, Dürer-Ensemble, Leuchtschilder
                    const placePanel = (z, w, h, yMid, mat) => {
                        const sP = station.position + z;
                        const posP = this.sim.getTrackPosition(sP);
                        const tanP = this.sim.getTrackTangent(sP);
                        const rotYP = Math.atan2(tanP.x, tanP.z) - centerAngle;
                        const normP = new THREE.Vector3(-tanP.z, 0, tanP.x);
                        const geom = new THREE.PlaneGeometry(w, h);
                        for (const sign of [1, -1]) {
                            const pP = posP.clone().addScaledVector(normP, sign * (offW(sP) - 0.06));
                            const mesh = new THREE.Mesh(geom, mat);
                            mesh.position.copy(stationGroup.worldToLocal(pP));
                            mesh.position.y = yMid;
                            mesh.rotation.set(0, rotYP + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(mesh);
                        }
                    };
                    const arrowMatA = this.getFlughafenArrowMat(0);
                    const arrowMatB = this.getFlughafenArrowMat(1);
                    [-40, -37, -34, -31, 24, 27, 30, 33].forEach((z, i) => {
                        placePanel(z, 2.9, 3.2, 2.55, (i % 2 === 0) ? arrowMatA : arrowMatB);
                    });
                    // Dürer-Ensemble (Foto 4): Airport | Porträt | Infotafel | Flughafen
                    placePanel(-11.5, 2.6, 0.55, 2.55, this.getFlughafenSignMat('Airport'));
                    placePanel(-8.2, 2.6, 2.6, 2.55, this.getFlughafenDuererMat());
                    placePanel(-5.4, 2.6, 2.6, 2.55, this.getFlughafenDuererTextMat());
                    placePanel(-2.6, 2.6, 0.55, 2.55, this.getFlughafenSignMat('Flughafen'));
                    placePanel(18, 2.6, 0.55, 2.55, this.getFlughafenSignMat('Flughafen'));
                    placePanel(38, 2.6, 0.55, 2.55, this.getFlughafenSignMat('Airport'));
                    placePanel(-43, 2.6, 0.55, 2.55, this.getFlughafenSignMat('Flughafen'));

                    // 4. Stahlraster-Decke in drei Abschnitten; die Lücken sind die
                    // beiden Lichteinlässe
                    const ceilMat = this.getFlughafenCeilingMat();
                    const cMats = [ceilMat, ceilMat];
                    const cHalfW = (s) => (this.sim.getTrackSpacing(s) + 3.66) / 2;
                    const sortedGaps = [escGap, liftGap].sort((a, b) => a[0] - b[0]);
                    const sections = [
                        [-platLength / 2, sortedGaps[0][0]],
                        [sortedGaps[0][1], sortedGaps[1][0]],
                        [sortedGaps[1][1], platLength / 2]
                    ];
                    for (const [z0, z1] of sections) {
                        this.buildSweptBar(stationGroup, station.position + z0, station.position + z1,
                            cHalfW, cy + ceilY + 0.1, cy + ceilY - 0.1, cMats, 1.2, () => 0, 1.2);
                    }

                    // 5. Die beiden Lichteinlässe: verglaste Schächte mit Stirnwänden
                    // an den Schachtenden, oben ein strahlend heller Abschluss
                    // (Tageslicht von oben). Die Stirnwände sind um 8 cm in den
                    // Schacht eingerückt, damit sie NICHT in derselben Ebene wie
                    // die automatischen Stirnkappen der Deckenabschnitte liegen
                    // (das war das Z-Fighting-Flackern der ersten Fassung).
                    const skyMat = this.getFlughafenSkylightMat();
                    if (!this._flughafenDaylightMat) this._flughafenDaylightMat = new THREE.MeshBasicMaterial({ color: '#f2f7fa' });
                    const dMats = [this._flughafenDaylightMat, this._flughafenDaylightMat];
                    const skMats = [skyMat, skyMat];
                    for (const [z0, z1] of [escGap, liftGap]) {
                        const s0 = station.position + z0, s1 = station.position + z1;
                        for (const sign of [1, -1]) {
                            this.buildSweptBar(stationGroup, s0, s1, () => 0.06,
                                cy + atriumTop, cy + ceilY - 0.1, skMats, 1.2, (s) => sign * (cHalfW(s) - 0.06), 1.2);
                        }
                        for (const [sEnd, dir] of [[s0, 1], [s1, -1]]) {
                            const sW = sEnd + dir * 0.08;
                            const posE = this.sim.getTrackPosition(sW);
                            const tanE = this.sim.getTrackTangent(sW);
                            const rotYE = Math.atan2(tanE.x, tanE.z) - centerAngle;
                            const wE = 2 * cHalfW(sW);
                            const hE = atriumTop - (ceilY - 0.1);
                            const wallE = new THREE.Mesh(new THREE.BoxGeometry(wE, hE, 0.12), skyMat);
                            wallE.position.copy(stationGroup.worldToLocal(posE.clone()));
                            wallE.position.y = ceilY - 0.1 + hE / 2;
                            wallE.rotation.y = rotYE;
                            stationGroup.add(wallE);
                        }
                        this.buildSweptBar(stationGroup, s0, s1, cHalfW, cy + atriumTop + 0.1, cy + atriumTop, dMats, 1.2, () => 0, 1.2);
                    }

                    // 6. Beleuchtung: einfach lange, an dünnen Stäben hängende
                    // Neonröhren (Foto 2) — zwei durchgehende Leuchtbänder je
                    // Deckenabschnitt, nicht über die offenen Lichteinlässe hinweg.
                    const tubeMats = [this.materials.lightTube, this.materials.lightTube];
                    const neonHangerGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.27, 6);
                    for (const [z0, z1] of sections) {
                        const s0 = station.position + z0 + 0.3, s1 = station.position + z1 - 0.3;
                        if (s1 - s0 < 1.0) continue;
                        for (const sign of [1, -1]) {
                            this.buildSweptBar(stationGroup, s0, s1, () => 0.05,
                                cy + ceilY - 0.37, cy + ceilY - 0.43, tubeMats, 1.2, (s) => sign * 2.5);
                            for (let d = s0 + 2.5; d <= s1 - 2.0; d += 5.0) {
                                const posH = this.sim.getTrackPosition(d);
                                const tanH = this.sim.getTrackTangent(d);
                                const rotYH = Math.atan2(tanH.x, tanH.z) - centerAngle;
                                const normH = new THREE.Vector3(-tanH.z, 0, tanH.x);
                                const hanger = new THREE.Mesh(neonHangerGeom, this.materials.boardHanger);
                                hanger.position.copy(stationGroup.worldToLocal(posH.clone().addScaledVector(normH, sign * 2.5)));
                                hanger.position.y = ceilY - 0.235;
                                hanger.rotation.y = rotYH;
                                stationGroup.add(hanger);
                            }
                        }
                    }

                    // 7. Einzelne Rolltreppe im Rolltreppen-Lichteinlass — NUR eine
                    // Fahrspur, ohne Mitteltreppe und ohne zweite (Gegen-)Spur —,
                    // steigt vom Bahnsteig durch die Deckenöffnung ins helle Atrium.
                    {
                        const riseTarget = ceilY + 0.1 - 0.865;
                        const stepHeight = 0.16;
                        const numSteps = Math.max(4, Math.round(riseTarget / stepHeight));
                        const numTotalSteps = numSteps + 4;
                        const stepDepth = 0.3;
                        const run = numSteps * stepDepth;
                        const actualRise = numSteps * stepHeight;
                        const rampLength = Math.sqrt(actualRise * actualRise + run * run);
                        const rampAngle = Math.atan2(actualRise, run);

                        const escCenterZ = (escGap[0] + escGap[1]) / 2;
                        const sBase = station.position + escCenterZ - run / 2;
                        const posB = this.sim.getTrackPosition(sBase);
                        const tanB = this.sim.getTrackTangent(sBase);
                        const anchorRotY = Math.atan2(tanB.x, tanB.z) - centerAngle;

                        // Geteilte Materialien (identisch zum Bauernfeind-Rezept; lazy,
                        // weil jene Zweige auf der U2 nie laufen)
                        this.materials.bauernfeindEscStep = this.materials.bauernfeindEscStep || new THREE.MeshLambertMaterial({
                            map: (() => {
                                const canvas = document.createElement('canvas');
                                canvas.width = 64; canvas.height = 64;
                                const ctx = canvas.getContext('2d');
                                const stripeWidth = 2;
                                for (let x = 0; x < 64; x += stripeWidth) {
                                    ctx.fillStyle = (x % (stripeWidth * 2) === 0) ? '#475569' : '#94a3b8';
                                    ctx.fillRect(x, 0, stripeWidth, 64);
                                    ctx.fillStyle = '#334155'; ctx.fillRect(x, 0, 1, 64);
                                    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x + stripeWidth - 1, 0, 1, 64);
                                }
                                const texture = new THREE.CanvasTexture(canvas);
                                texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
                                texture.colorSpace = THREE.SRGBColorSpace;
                                return texture;
                            })()
                        });
                        this.materials.bauernfeindEdelstahl = this.materials.bauernfeindEdelstahl
                            || StationBuilder.createBalustradeMaterial();
                        this.materials.bauernfeindHandrail = this.materials.bauernfeindHandrail
                            || new THREE.MeshBasicMaterial({ color: '#111111' });

                        const core = new THREE.Group();
                        core.position.copy(stationGroup.worldToLocal(posB.clone()));
                        core.position.y = 0.865;
                        core.rotation.y = anchorRotY;

                        const escWidth = 1.0;
                        const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
                        const escInst = new THREE.InstancedMesh(escStepGeom, this.materials.bauernfeindEscStep, numTotalSteps);
                        const dirAttr = new Float32Array(numTotalSteps * 3);
                        for (let i = 0; i < numTotalSteps; i++) {
                            dirAttr[i * 3 + 1] = stepHeight;
                            dirAttr[i * 3 + 2] = stepDepth;
                        }
                        escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
                        StationBuilder.setupEscalatorMaterial(this.materials.bauernfeindEscStep, this);
                        const mStep = new THREE.Matrix4();
                        for (let i = 0; i < numTotalSteps; i++) {
                            const k2 = i - 2;
                            const sy = k2 * stepHeight + stepHeight / 2, sz = k2 * stepDepth + stepDepth / 2;
                            escInst.setMatrixAt(i, mStep.makeTranslation(0, sy, sz));
                        }
                        escInst.instanceMatrix.needsUpdate = true;
                        this.registerEscalator(escInst, { numTotalSteps });
                        escInst.computeBoundingSphere();
                        if (escInst.boundingSphere) escInst.boundingSphere.radius *= 5;
                        core.add(escInst);

                        const midY = actualRise / 2, midZ = run / 2;
                        // Fahrspur-Verkleidung + geschlossener Unterbau
                        const casing = new THREE.Mesh(new THREE.BoxGeometry(escWidth, 0.1, rampLength), this.materials.bauernfeindEscStep);
                        casing.position.set(0, midY - 0.15, midZ);
                        casing.rotation.x = -rampAngle;
                        core.add(casing);

                        const under = new THREE.Mesh(new THREE.BoxGeometry(escWidth + 0.6, 0.5, rampLength), new THREE.MeshLambertMaterial({ color: '#7d8288' }));
                        under.position.set(0, midY - 0.5, midZ);
                        under.rotation.x = -rampAngle;
                        core.add(under);
                        // Balustraden + Handläufe, je eine links und rechts der einzelnen Spur
                        const balGeom = new THREE.BoxGeometry(0.05, 0.9, rampLength + 0.6);
                        const railGeom = new THREE.BoxGeometry(0.09, 0.09, rampLength + 0.7);
                        for (const x of [-0.55, 0.55]) {
                            const bal = new THREE.Mesh(balGeom, this.materials.bauernfeindEdelstahl);
                            bal.position.set(x, midY + 0.45, midZ);
                            bal.rotation.x = -rampAngle;
                            core.add(bal);
                            const rail = new THREE.Mesh(railGeom, this.materials.bauernfeindHandrail);
                            rail.position.set(x, midY + 0.95, midZ);
                            rail.rotation.x = -rampAngle;
                            core.add(rail);
                        }
                        stationGroup.add(core);
                    }
                }
            } else if (isKlinikumNord) {
                // Klinikum Nord (U3, Fotos): goldgelb schimmernde Metallwände mit
                // dunklen Wolken-Flecken und vertikalen Blechstößen, gesperrter
                // grauer "KLINIKUM NORD"-Schriftzug, Mittelunterzug mit
                // Fischgrät-Lochblechpaneelen unter der hellen Betondecke und
                // Plärrer-Beleuchtung (Jakobinenstraße-Lichtbalken an beiden
                // Bahnsteigkanten). Stützenfrei.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const ceilY = 4.66;

                    // 1. Goldwände, raumhoch (Kachel = 8 m, volle Wandhöhe)
                    const goldMat = this.getKlinikumNordGoldMat();
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + ceilY, goldMat, 8.0, 0, 1);
                    }

                    // 2. Grauer Metall-Schriftzug alle 15 m auf beiden Wänden
                    const textGeom = new THREE.PlaneGeometry(3.6, 0.36);
                    const textMat = this.getKlinikumNordTextMat();
                    for (const sign of [1, -1]) {
                        const offS = (s) => sign * (offW(s) - 0.03);
                        for (let z = -platLength / 2 + 7.5; z <= platLength / 2 - 7.5; z += 15.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            const pText = posT.clone().addScaledVector(normT, offS(sT));
                            const textMesh = new THREE.Mesh(textGeom, textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.35;
                            textMesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(textMesh);
                        }
                    }

                    // 3. Beton-Mittelunterzug längs unter der Decke (Foto 2)
                    if (!this._klinikumNordBeamMat) {
                        this._klinikumNordBeamMat = new THREE.MeshLambertMaterial({
                            map: this.tunnelConcreteTexture, color: 0xffffff
                        });
                    }
                    const beamMats = [this._klinikumNordBeamMat, this._klinikumNordBeamMat];
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.3, cy + ceilY - 0.1, cy + ceilY - 0.62, beamMats, 1.2, () => 0);

                    // 4. Fischgrät-Lochblechpaneele beidseits des Unterzugs: lange
                    // Achse quer, im Grundriss ±14° geschränkt (Fischgrät) und um
                    // 8° zur Wand hin abfallend geneigt
                    const panelMat = this.getKlinikumNordPanelMat();
                    const panelStep = 2.3;
                    const nPanels = Math.floor((platLength - 2.0) / panelStep);
                    const panelGeom = new THREE.BoxGeometry(1, 0.05, 1.9); // X wird pro Instanz skaliert
                    const panelInst = new THREE.InstancedMesh(panelGeom, panelMat, nPanels * 2);
                    const tilt = 8 * Math.PI / 180;
                    const chevron = 14 * Math.PI / 180;
                    let pi = 0;
                    for (let k = 0; k < nPanels; k++) {
                        const sP = sA + 1.0 + (k + 0.5) * panelStep;
                        const posP = this.sim.getTrackPosition(sP);
                        const tanP = this.sim.getTrackTangent(sP);
                        const rotYP = Math.atan2(tanP.x, tanP.z) - centerAngle;
                        const normP = new THREE.Vector3(-tanP.z, 0, tanP.x);
                        const wallOff = offW(sP);
                        const panelLen = wallOff - 0.85;
                        for (const sign of [1, -1]) {
                            const latC = sign * (0.5 + panelLen / 2);
                            const p = stationGroup.worldToLocal(posP.clone().addScaledVector(normP, latC));
                            // Innenkante hängt auf 4.5 m, Außenkante fällt zur Wand ab
                            const yC = ceilY - 0.16 - (panelLen / 2) * Math.sin(tilt);
                            const m = new THREE.Matrix4().makeRotationY(rotYP + sign * chevron);
                            m.multiply(new THREE.Matrix4().makeRotationZ(-sign * tilt));
                            m.multiply(new THREE.Matrix4().makeScale(panelLen, 1, 1));
                            m.setPosition(p.x, yC, p.z);
                            panelInst.setMatrixAt(pi++, m);
                        }
                    }
                    panelInst.instanceMatrix.needsUpdate = true;
                    panelInst.computeBoundingSphere();
                    if (panelInst.boundingSphere) panelInst.boundingSphere.radius *= 5;
                    stationGroup.add(panelInst);

                    // 5. Beleuchtung wie Plärrer (Standardmodell buildPlaererLights,
                    // inkl. Stationsname in regelmäßigen Abständen auf den Trägern)
                    this.buildPlaererLights(stationGroup, station, centerAngle, { sA, sB, cy, ceilY });
                }
            } else if (station.name === "Weißer Turm") {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const wallInset = isSideStation ? 5.55 : 1.83;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + wallInset;
                    const cy = centerPos.y;
                    const ceilY = 4.595; // Slat ceiling height
                    
                    const wallMat = this.getWeisserTurmWallMat();
                    const textMat = this.getWeisserTurmTextMat();
                    
                    for (const sign of [1, -1]) {
                        // 1. Rusticated dark red wall
                        this.buildSweptWall(stationGroup, sA, sB, (s) => sign * offW(s), cy - 0.38, cy + ceilY, wallMat, wallMat.map.userData.worldW, cy - 0.38, cy + ceilY);
                        
                        // 2. Nameplates
                        const offS = (s) => sign * (offW(s) - 0.05);
                        for (let z = -platLength / 2 + 10; z <= platLength / 2 - 10; z += 20.0) {
                            const sT = station.position + z;
                            const posT = this.sim.getTrackPosition(sT);
                            const tanT = this.sim.getTrackTangent(sT);
                            const rotYT = Math.atan2(tanT.x, tanT.z) - centerAngle;
                            const normT = new THREE.Vector3(-tanT.z, 0, tanT.x);
                            
                            const pText = posT.clone().addScaledVector(normT, offS(sT));
                            const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.45), textMat);
                            textMesh.position.copy(stationGroup.worldToLocal(pText));
                            textMesh.position.y = 2.0;
                            textMesh.rotation.set(0, rotYT + (sign > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
                            stationGroup.add(textMesh);
                        }
                    }
                }
            } else {
                // Generic outer walls: solid colour, so one continuous swept slab per side
                // (built once on j===0), tapering its lateral offset with the inter-track gap.
                if (station.name !== "Langwasser Nord" && station.name !== "Bauernfeindstraße" && station.name !== "Messe" && station.name !== "Muggenhof" && station.name !== "Stadtgrenze" && j === 0) {
                    const wallMaterial = new THREE.MeshLambertMaterial({ color: station.color || '#333333' });
                    const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
                    const ceilYw = isMax ? 5.84 : 4.66;
                    const wallMats = [wallMaterial, wallMaterial];
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const wallInset = isSideStation ? 5.55 : 1.83;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + wallInset;
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.1, centerPos.y + ceilYw, centerPos.y - 0.38, wallMats, 1.2, (s) => offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.1, centerPos.y + ceilYw, centerPos.y - 0.38, wallMats, 1.2, (s) => -offW(s));
                }
            }
        }
 
        // 4. Pillars (every 15 meters by default: -37.5, -22.5, -7.5, 7.5, 22.5, 37.5)
        let stationPillarZ = [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5].map(z => z * S_len);
        if (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name)) {
            // 12 pillars in equal distance (from -33 to 33 with spacing 6m) to clear the escalators
            stationPillarZ = [-33, -27, -21, -15, -9, -3, 3, 9, 15, 21, 27, 33].map(z => z * S_len);
        } else if (isAufsessplatzLook || station.name === "St. Leonhard") {
            // 9 pillars in equal distance (from -32 to 32 with spacing 8m)
            stationPillarZ = [-32, -24, -16, -8, 0, 8, 16, 24, 32].map(z => z * S_len);
        }
        const tPillarTrunkGeom = new THREE.BoxGeometry(0.3, 2.75, 0.3);
        const tPillarBarGeom = new THREE.BoxGeometry(2.4, 0.25, 0.35);
 
        stationPillarZ.forEach((pz, idx) => {
            if (["Hardhöhe", "Jakobinenstraße", "Röthenbach", "Hohe Marter", "Schweinau", "Rothenburger Straße", "Opernhaus", "Wöhrder Wiese", "Rathenauplatz", "Grossreuth bei Schweinau", "Klinikum Nord", "Flughafen", "Maxfeld", "Rennweg", "Nordwestring", "Friedrich-Ebert-Platz"].includes(station.name)) return; // column-free!
            if (station.name === "Muggenhof") {
                const s = station.position + pz;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                
                const pHeight = 4.8 - 1.1; // from central wall top (1.1m) to roof peak (4.8m)
                const pY = 1.1 + pHeight / 2;

                const colGroup = new THREE.Group();
                
                // Web (spans in X, thickness in Z)
                const web = new THREE.Mesh(new THREE.BoxGeometry(0.24, pHeight, 0.04), this.materials.pillar);
                web.position.set(0, 0, 0);
                colGroup.add(web);
                
                // Flanges (span in Z, thickness in X - facing the platforms)
                // Clone texture and apply offset.x based on the pillar index
                const pTex = muggenhofColumnTex.clone();
                pTex.offset.x = (idx * 0.15) % 0.45;
                const pMat = new THREE.MeshLambertMaterial({ map: pTex });
                
                const flange1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, pHeight, 0.24), pMat);
                flange1.position.set(-0.12, 0, 0);
                
                const flange2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, pHeight, 0.24), pMat);
                flange2.position.set(0.12, 0, 0);
                
                colGroup.add(flange1, flange2);
                
                // Position and orient at X = 0 (center of tracks)
                const pLocal = stationGroup.worldToLocal(pos.clone());
                colGroup.position.copy(pLocal);
                colGroup.position.y = pY;
                colGroup.rotation.y = rotY;
                
                stationGroup.add(colGroup);
                return;
            }
            if (station.name === "St. Leonhard") {
                const s = station.position + pz;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                
                const colHeight = 4.595 - 0.865;
                const colGeom = new THREE.CylinderGeometry(0.3, 0.3, colHeight, 24);
                // Clone the shared stone material with round-column lighting baked in
                if (!this._stLeonhardPillarMat) {
                    this._stLeonhardPillarMat = this._makeCylinderPillarMat(this.getStLeonhardStoneMat());
                    this._stLeonhardPillarMat.map.repeat.set(2, colHeight / 1.2);
                }
                const pillar = new THREE.Mesh(colGeom, this._stLeonhardPillarMat);
                
                const pLocal = stationGroup.worldToLocal(pos.clone());
                pillar.position.copy(pLocal);
                pillar.position.y = 0.865 + colHeight / 2;
                pillar.rotation.y = rotY;
                
                stationGroup.add(pillar);
                return;
            }
            if (station.name === "Stadtgrenze") {
                const s = station.position + pz;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const spacing = this.sim.getTrackSpacing(s);

                const buildVPillar = (sideSign) => {
                    const colGroup = new THREE.Group();

                    // V branches start from y=0 (floor) and reach up to the beam underside.
                    // The beam underside is at beamY - beamH/2 = (roofValleyY - beamH/2) - beamH/2
                    // = 5.2 - 1.0 = 4.2m above scene floor.
                    // colGroup.position.y will be set to 0 (floor), so branch must span 4.2m height.
                    // Tips are close at the top (±0.35m Z spread) → narrow V that opens toward the floor.
                    const branchHeight = 3.7;  // roofValleyY(5.2) - beamH(1.5) = 3.7m
                    const tipSpreadZ   = 0.35; // half-spread at the TOP of each branch (narrow at top)
                    // Because the branch *centre* is at branchHeight/2, and one tip spreads outward,
                    // we translate the centre in Z by half the total spread at the midpoint:
                    const branchCentreZ = tipSpreadZ + (branchHeight * 0.5 * Math.atan2(tipSpreadZ * 2, branchHeight));
                    const branchAngle   = Math.atan2(tipSpreadZ * 2, branchHeight); // small angle

                    const branchGeom = new THREE.BoxGeometry(0.35, branchHeight, 0.35);

                    const branch1 = new THREE.Mesh(branchGeom, this.materials.platform);
                    branch1.position.set(0, branchHeight * 0.5, -tipSpreadZ);
                    branch1.rotation.x = -branchAngle; // leans slightly outward at the base

                    const branch2 = new THREE.Mesh(branchGeom, this.materials.platform);
                    branch2.position.set(0, branchHeight * 0.5,  tipSpreadZ);
                    branch2.rotation.x =  branchAngle;

                    colGroup.add(branch1, branch2);

                    // Place colGroup at floor level (y=0 of the scene, below the platform deck)
                    const pLoc   = pos.clone().addScaledVector(normal, sideSign * (spacing / 2 + 4.05)); // 1.5m from outer wall
                    const pLocal = stationGroup.worldToLocal(pLoc);
                    colGroup.position.copy(pLocal);
                    colGroup.position.y = 0; // branches start from the floor
                    colGroup.rotation.y = rotY;

                    stationGroup.add(colGroup);
                };

                buildVPillar(1);
                buildVPillar(-1);
                return;
            }
            const isTiledExitStation = (station.name === "Maximilianstraße" ||
                                        station.name === "Bärenschanze" ||
                                        station.name === "Gostenhof" ||
                                        station.name === "Langwasser Süd" ||
                                        station.name === "Gemeinschaftshaus" ||
                                        station.name === "Langwasser Mitte");
            if (isTiledExitStation && (Math.abs(Math.abs(pz) - 37.5 * S_len) < 0.01)) return; // remove end pillars to clear escalators
            const s = station.position + pz;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;

            // Calculate target height and Y position for pillars
            const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
            let ceilY = isMax ? 5.84 : 4.66;
            if (hasSlatCeiling) ceilY = 4.59; // slat ceiling sits lower than the generic slab
            if (station.name === "Hardhöhe") ceilY = 4.8;
            if (station.name === "Eberhardshof") ceilY = 4.65;

            let pHeight = ceilY - 0.865;
            let pY = 0.865 + pHeight / 2;
            if (isMax) {
                pHeight = 3.295; // Shorter pillars: ends at 4.16 (ceiling 5.84 - beam height 1.68)
                pY = 0.865 + pHeight / 2;
            }

            if (isSideStation) {
                const pR = pos.clone().addScaledVector(normal, -spacing / 2 - 3.54);
                const cacheKey = `pillarGeom_side_${station.name}`;
                if (!this[cacheKey]) {
                    this[cacheKey] = {
                        geom: new THREE.CylinderGeometry(0.25, 0.25, pHeight, 8),
                        mat: this._makeCylinderPillarMat(this.materials.pillar)
                    };
                }
                const pillarR = new THREE.Mesh(this[cacheKey].geom, this[cacheKey].mat);
                pillarR.position.copy(stationGroup.worldToLocal(pR));
                pillarR.position.y = pY;
                pillarR.rotation.y = rotY;

                const pL = pos.clone().addScaledVector(normal, spacing / 2 + 3.54);
                const pillarL = new THREE.Mesh(this[cacheKey].geom, this[cacheKey].mat);
                pillarL.position.copy(stationGroup.worldToLocal(pL));
                pillarL.position.y = pY;
                pillarL.rotation.y = rotY;

                stationGroup.add(pillarR, pillarL);
            } else if (isScharfreiterring) {
                const localSchPlatCenter = spacing / 2 - 5.03;
                const pL = pos.clone().addScaledVector(normal, -localSchPlatCenter);

                const tHeight = 4.66 - 0.865;
                const tY = 0.865 + tHeight / 2;
                const trunkGeom = new THREE.BoxGeometry(0.3, tHeight, 0.3);

                const trunkL = new THREE.Mesh(trunkGeom, this.materials.pillar);
                const localPL = stationGroup.worldToLocal(pL.clone());
                trunkL.position.copy(localPL);
                trunkL.position.y = tY;
                trunkL.rotation.y = rotY;
                const barL = new THREE.Mesh(tPillarBarGeom, this.materials.pillar);
                barL.position.copy(localPL);
                barL.position.y = 4.66 - 0.125; // Flush with ceiling
                barL.rotation.y = rotY;

                const pR = pos.clone().addScaledVector(normal, localSchPlatCenter);
                const trunkR = new THREE.Mesh(trunkGeom, this.materials.pillar);
                const localPR = stationGroup.worldToLocal(pR.clone());
                trunkR.position.copy(localPR);
                trunkR.position.y = tY;
                trunkR.rotation.y = rotY;
                const barR = new THREE.Mesh(tPillarBarGeom, this.materials.pillar);
                barR.position.copy(localPR);
                barR.position.y = 4.66 - 0.125;
                barR.rotation.y = rotY;

                stationGroup.add(trunkL, barL, trunkR, barR);
            } else {
                if (station.name === "Eberhardshof") {
                    const cacheKey = `pillarGeom_${station.name}`;
                    const beamCacheKey = `beamGeom_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = {
                            geom: new THREE.CylinderGeometry(0.75, 0.75, pHeight, 24),
                            mat: this._makeCylinderPillarMat(this.createPebbleDashMaterial())
                        };
                        this[cacheKey].mat.map.repeat.set(2, pHeight / 2.25);
                    }
                    if (!this[beamCacheKey]) {
                        const beamShape = new THREE.Shape();
                        beamShape.moveTo(-5.0, 3.6);
                        beamShape.lineTo(-5.0, 5.0);
                        beamShape.quadraticCurveTo(-3.75, 2.5, -2.5, 5.0);
                        beamShape.quadraticCurveTo(-1.25, 2.5, 0.0, 5.0);
                        beamShape.quadraticCurveTo(1.25, 2.5, 2.5, 5.0);
                        beamShape.quadraticCurveTo(3.75, 2.5, 5.0, 5.0);
                        beamShape.lineTo(5.0, 3.6);
                        beamShape.quadraticCurveTo(0, 2.0, -5.0, 3.6);
                        beamShape.closePath();

                        const bGeom = new THREE.ExtrudeGeometry(beamShape, { depth: 0.6, bevelEnabled: false });
                        bGeom.translate(0, 0, -0.3);

                        this[beamCacheKey] = {
                            geom: bGeom,
                            mat: this.materials.pillar
                        };
                    }

                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);

                    const bData = this[beamCacheKey];
                    const beam = new THREE.Mesh(bData.geom, bData.mat);
                    beam.position.copy(stationGroup.worldToLocal(pos.clone()));
                    beam.position.y = 0;
                    beam.rotation.y = rotY;
                    stationGroup.add(beam);
                } else if (wallPresets[station.name]) {
                    const preset = wallPresets[station.name];
                    const cacheKey = `pillarGeom_${station.name}`;
                    const hPillFactor = preset.flatTiles ? 0.6597 : 1.3194;
                    const isSquareLangwasser = ["Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte"].includes(station.name);

                    if (!this[cacheKey]) {
                        if (isSquareLangwasser) {
                            const pWidth = 0.63; // 1/4 narrower than 0.84 diameter
                            this[cacheKey] = {
                                geom: new THREE.BoxGeometry(pWidth, pHeight, pWidth),
                                mat: this.createTiledMaterial(preset.topColor, preset.topGrout, 0.15)
                            };
                            this[cacheKey].mat.map.repeat.set(0.5, pHeight / hPillFactor);
                            if (this[cacheKey].mat.bumpMap) {
                                this[cacheKey].mat.bumpMap.repeat.set(0.5, pHeight / hPillFactor);
                            }
                        } else {
                            this[cacheKey] = {
                                geom: new THREE.CylinderGeometry(0.42, 0.42, pHeight, 16),
                                mat: this._makeCylinderPillarMat(
                                    this.createTiledMaterial(preset.topColor, preset.topGrout, 0.15)
                                )
                            };
                            this[cacheKey].mat.map.repeat.set(2, pHeight / hPillFactor);
                            if (this[cacheKey].mat.bumpMap) {
                                this[cacheKey].mat.bumpMap.repeat.set(2, pHeight / hPillFactor);
                            }
                        }
                    }
                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                } else if (isAufsessplatzLook) {
                    const cacheKey = `pillarGeom_${station.name}`;
                    if (!this[cacheKey]) {
                        const geom = new THREE.CylinderGeometry(0.42, 0.42, pHeight, 16);
                        const mat = this._makeCylinderPillarMat(aufsessplatzRedTileMat);
                        mat.map.repeat.set(2, pHeight / 1.3194);
                        if (mat.bumpMap) {
                            mat.bumpMap.repeat.set(2, pHeight / 1.3194);
                        }
                        this[cacheKey] = { geom, mat };
                    }
                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                } else if (station.name === "Messe") {
                    // Rectangular columns on both sides of the platform supporting the beams
                    this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
                    const beamHeight = 0.45;
                    const pillHeight = ceilY - 0.1 - beamHeight - 0.865;
                    const pillY = 0.865 + pillHeight / 2;
                    const cacheKey = `pillarGeom_messe`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = new THREE.BoxGeometry(0.5, pillHeight, 0.5);
                    }
                    const pillOffset = (spacing - 3.08) / 2 - 4.0;
                    
                    const pL = pos.clone().addScaledVector(normal, -pillOffset);
                    const pillarL = new THREE.Mesh(this[cacheKey], this.materials.messeConcrete);
                    pillarL.position.copy(stationGroup.worldToLocal(pL));
                    pillarL.position.y = pillY;
                    pillarL.rotation.y = rotY;

                    const pR = pos.clone().addScaledVector(normal, pillOffset);
                    const pillarR = new THREE.Mesh(this[cacheKey], this.materials.messeConcrete);
                    pillarR.position.copy(stationGroup.worldToLocal(pR));
                    pillarR.position.y = pillY;
                    pillarR.rotation.y = rotY;

                    stationGroup.add(pillarL, pillarR);
                } else if (station.name === "Weißer Turm") {
                    const cacheKey = `pillarGeom_${station.name}`;
                    if (!this[cacheKey]) {
                        const geom = new THREE.CylinderGeometry(0.42, 0.42, pHeight, 16);
                        const mat = this._makeCylinderPillarMat(this.getWeisserTurmPillarMat());
                        mat.map.repeat.set(2, pHeight / 1.3194);
                        if (mat.bumpMap) {
                            mat.bumpMap.repeat.set(2, pHeight / 1.3194);
                        }
                        this[cacheKey] = { geom, mat };
                    }
                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                } else if (station.name === "Bauernfeindstraße") {
                    // Double-diameter pillars with a fine concrete texture (Langwasser-Nord-style
                    // island platform, but with fatter, textured columns).
                    if (!this._bauernfeindPillarMat) {
                        this._bauernfeindPillarMat = this._makeCylinderPillarMat(
                            new THREE.MeshLambertMaterial({ map: this.tunnelConcreteTexture })
                        );
                    }
                    const cacheKey = `pillarGeom_generic_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = new THREE.CylinderGeometry(0.5, 0.5, pHeight, 16);
                    }
                    const pillar = new THREE.Mesh(this[cacheKey], this._bauernfeindPillarMat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                } else {
                    // Generic cylindrical pillar — use a shared gradient-lit material
                    if (!this._genericRoundPillarMat) {
                        this._genericRoundPillarMat = this._makeCylinderPillarMat(this.materials.pillar);
                    }
                    const cacheKey = `pillarGeom_generic_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = new THREE.CylinderGeometry(0.25, 0.25, pHeight, 8);
                    }
                    const pillar = new THREE.Mesh(this[cacheKey], this._genericRoundPillarMat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                }
            }

            // Build cross-beams and lights for Maximilianstraße aligned with the pillars
            if (isMax) {
                const beamWidth = spacing + 3.66;
                const beamGeom = new THREE.BoxGeometry(beamWidth, 1.68, 0.84);
                const beam = new THREE.Mesh(beamGeom, this.stationConcreteBeamMat);
                
                const beamCenter = stationGroup.worldToLocal(pos.clone());
                beamCenter.y = 5.00;
                beam.position.copy(beamCenter);
                beam.rotation.y = rotY;
                stationGroup.add(beam);

                // Attach lights under the beam (Y = 4.10, which is just below the beam bottom 4.16)
                const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));
                const lightOffset = spacing > 8 ? 2.5 : 1.3;
                const addBeamLight = (xOffset) => {
                    const l = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l.position.copy(beamCenter).addScaledVector(localNorm, xOffset);
                    l.position.y = 4.10;
                    l.rotation.y = rotY + Math.PI / 2;
                    stationGroup.add(l);
                };
                addBeamLight(-lightOffset);
                addBeamLight(lightOffset);
            }
        });

        // Benches removed by user request (except custom benches in Hardhöhe)

        // Hardhöhe Custom Furniture
        if (station.name === "Hardhöhe") {
            const furnitureZ = [-20, 0, 20];
            const adZ = [-10, 10];
            
            const concreteMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
            const steelMat = new THREE.MeshLambertMaterial({ color: '#cbd5e1' });
            const lidMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });
            const yellowMat = new THREE.MeshLambertMaterial({ color: '#eab308' });
            const posterMat = new THREE.MeshLambertMaterial({ color: '#f8fafc' });
            
            const benchSeatGeom = new THREE.BoxGeometry(0.6, 0.08, 2.0);
            const benchLegGeom = new THREE.BoxGeometry(0.5, 0.36, 0.3);
            const canGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 12);
            const lidGeom = new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12);
            
            furnitureZ.forEach(bz => {
                const s = station.position + bz;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const spacing = this.sim.getTrackSpacing(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                
                const baseLocal = stationGroup.worldToLocal(pos.clone());
                
                // Seat
                const seat = new THREE.Mesh(benchSeatGeom, concreteMat);
                seat.position.copy(baseLocal);
                seat.position.y = 0.865 + 0.36 + 0.04;
                seat.rotation.y = rotY;
                
                // Two concrete legs
                const dirVec = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                
                const legL = new THREE.Mesh(benchLegGeom, concreteMat);
                legL.position.copy(baseLocal).addScaledVector(dirVec, -0.7);
                legL.position.y = 0.865 + 0.18;
                legL.rotation.y = rotY;
                
                const legR = new THREE.Mesh(benchLegGeom, concreteMat);
                legR.position.copy(baseLocal).addScaledVector(dirVec, 0.7);
                legR.position.y = 0.865 + 0.18;
                legR.rotation.y = rotY;
                
                // Trash can next to the bench
                const trashPos = baseLocal.clone().addScaledVector(dirVec, 1.4);
                
                const can = new THREE.Mesh(canGeom, steelMat);
                can.position.copy(trashPos);
                can.position.y = 0.865 + 0.35;
                can.rotation.y = rotY;
                
                const lid = new THREE.Mesh(lidGeom, lidMat);
                lid.position.copy(trashPos);
                lid.position.y = 0.865 + 0.7 + 0.025;
                lid.rotation.y = rotY;
                
                stationGroup.add(seat, legL, legR, can, lid);
            });
            
            const adBoardGeom = new THREE.BoxGeometry(0.12, 1.8, 1.3);
            const adPosterGeom = new THREE.BoxGeometry(0.14, 1.5, 1.1);
            
            adZ.forEach(az => {
                const s = station.position + az;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                
                const baseLocal = stationGroup.worldToLocal(pos.clone());
                
                // Yellow frame board
                const frame = new THREE.Mesh(adBoardGeom, yellowMat);
                frame.position.copy(baseLocal);
                frame.position.y = 0.865 + 0.9;
                frame.rotation.y = rotY;
                
                // Posters
                const poster = new THREE.Mesh(adPosterGeom, posterMat);
                poster.position.copy(baseLocal);
                poster.position.y = 0.865 + 0.9;
                poster.rotation.y = rotY;
                
                stationGroup.add(frame, poster);
            });
        }


        // Generic station name signs removed by user request

        // 6b. Hanging Departure Boards (Anzeigetafeln)
        let track1Label = "2"; // reverse direction track label (Gleis 2)
        let track2Label = "1"; // forward direction track label (Gleis 1)
        let row1DataT1, row2DataT1; // Track 1 (reverse)
        let row1DataT2, row2DataT2; // Track 2 (forward)

        const lineId = this.sim.track.lineId;

        if (lineId === 'U2') {
            // U2: SW Röthenbach (#cb0611), NE Flughafen (#cb0611)
            // Track 1 (reverse) -> Röthenbach
            row1DataT1 = { line: 'U2', color: '#cb0611', destination: 'Röthenbach', via: getUpcomingViaText('U2', station.name, 'reverse'), minutes: '2' };
            row2DataT1 = { line: 'U2', color: '#cb0611', destination: 'Röthenbach', via: getUpcomingViaText('U2', station.name, 'reverse'), minutes: '12' };

            // Track 2 (forward) -> Flughafen
            row1DataT2 = { line: 'U2', color: '#cb0611', destination: 'Flughafen', via: getUpcomingViaText('U2', station.name, 'forward'), minutes: '3' };
            row2DataT2 = { line: 'U2', color: '#cb0611', destination: 'Flughafen', via: getUpcomingViaText('U2', station.name, 'forward'), minutes: '13' };
        } else if (lineId === 'U3') {
            // U3: SW Grossreuth bei Schweinau (#2da4a8), NW Nordwestring (#2da4a8)
            // Track 1 (reverse) -> Grossreuth bei Schweinau
            row1DataT1 = { line: 'U3', color: '#2da4a8', destination: 'Grossreuth b. Schw.', via: getUpcomingViaText('U3', station.name, 'reverse'), minutes: '4' };
            row2DataT1 = { line: 'U3', color: '#2da4a8', destination: 'Grossreuth b. Schw.', via: getUpcomingViaText('U3', station.name, 'reverse'), minutes: '14' };

            // Track 2 (forward) -> Nordwestring
            row1DataT2 = { line: 'U3', color: '#2da4a8', destination: 'Nordwestring', via: getUpcomingViaText('U3', station.name, 'forward'), minutes: '1' };
            row2DataT2 = { line: 'U3', color: '#2da4a8', destination: 'Nordwestring', via: getUpcomingViaText('U3', station.name, 'forward'), minutes: '11' };
        } else if (lineId === 'TRUNK') {
            // U2/U3 Shared Trunk: Rothenburger Straße..Rathenauplatz
            // Display both U2 and U3 with track labels 1 and 2
            // Track 1 (reverse, Gleis 2) -> U2 Röthenbach & U3 Grossreuth
            row1DataT1 = { line: 'U2', color: '#cb0611', destination: 'Röthenbach', via: getUpcomingViaText('U2', station.name, 'reverse'), minutes: '2' };
            row2DataT1 = { line: 'U3', color: '#2da4a8', destination: 'Grossreuth b. Schw.', via: getUpcomingViaText('U3', station.name, 'reverse'), minutes: '7' };

            // Track 2 (forward, Gleis 1) -> U2 Flughafen & U3 Nordwestring
            row1DataT2 = { line: 'U2', color: '#cb0611', destination: 'Flughafen', via: getUpcomingViaText('U2', station.name, 'forward'), minutes: '3' };
            row2DataT2 = { line: 'U3', color: '#2da4a8', destination: 'Nordwestring', via: getUpcomingViaText('U3', station.name, 'forward'), minutes: '5' };
        } else {
            // Default U1: Hardhöhe (#0055a5) and Langwasser Süd (#0055a5)
            row1DataT1 = { line: 'U1', color: '#0055a5', destination: 'Langwasser Süd', via: getUpcomingViaText('U1', station.name, 'reverse'), minutes: '1' };
            row2DataT1 = { line: 'U1', color: '#0055a5', destination: 'Langwasser Süd', via: getUpcomingViaText('U1', station.name, 'reverse'), minutes: '8' };

            row1DataT2 = { line: 'U1', color: '#0055a5', destination: 'Fürth Hardhöhe', via: getUpcomingViaText('U1', station.name, 'forward'), minutes: '3' };
            row2DataT2 = { line: 'U1', color: '#0055a5', destination: 'Fürth Hardhöhe', via: getUpcomingViaText('U1', station.name, 'forward'), minutes: '13' };
        }

        const boardMatGleis1 = this.createDepartureBoardMaterial(track2Label, row1DataT2, row2DataT2);
        const boardMatGleis2 = this.createDepartureBoardMaterial(track1Label, row1DataT1, row2DataT1);

        const materialsG1 = [
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            boardMatGleis1, 
            boardMatGleis1, 
        ];

        const materialsG2 = [
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            boardMatGleis2, 
            boardMatGleis2, 
        ];

        const blankBoardMat = this.createBlankDepartureBoardMaterial();
        const materialsBlank = [
            this.materials.boardCasing,
            this.materials.boardCasing,
            this.materials.boardCasing,
            this.materials.boardCasing,
            blankBoardMat,
            blankBoardMat
        ];

        const boardZ = (station.name === "Messe") ? [-42.5, -17.5, 42.5] : [-30, 0, 30]; 
        boardZ.forEach(bz => {
            const s = station.position + bz;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;

            const localSchPlatCenter = spacing / 2 - 5.03;

            const isLwNord = (station.name === "Langwasser Nord");
            const boardY = 3.925; // Unterkante bei 3.60m (3.60 + 0.65/2)
            const ceilY = (station.name === "Hardhöhe") ? 4.8 : (station.name === "Flughafen") ? 5.0 : (hasSlatCeiling ? 4.595 : (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name) ? 5.84 : 4.66));
            const hangerLen = ceilY - boardY;
            const hangerY = boardY + hangerLen / 2;
            const boardHangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 6);

            const scaleFactor = 1.0;
            const hangerOffset = 2.53 * 0.25;

            // Gleis 1 Board (Left Platform - Outer side facing active tracks)
            // Swapped directions: track 1 side board uses materialsG2 ("LANGWASSER SÜD")
            const g1X = isSideStation ? (-spacing / 2 - 3.205) : (isScharfreiterring ? -(localSchPlatCenter + 1.835) : (-spacing / 2 + 3.205));
            const p1 = pos.clone().addScaledVector(normal, g1X);
            const board1 = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsG2);
            board1.position.copy(stationGroup.worldToLocal(p1.clone()));
            board1.position.y = boardY;
            board1.rotation.y = rotY;
            board1.scale.set(scaleFactor, scaleFactor, scaleFactor);
            stationGroup.add(board1);

            const hanger1L = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p1H1 = p1.clone().addScaledVector(normal, -hangerOffset);
            hanger1L.position.copy(stationGroup.worldToLocal(p1H1));
            hanger1L.position.y = hangerY;
            hanger1L.rotation.y = rotY;

            const hanger1R = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p1H2 = p1.clone().addScaledVector(normal, hangerOffset);
            hanger1R.position.copy(stationGroup.worldToLocal(p1H2));
            hanger1R.position.y = hangerY;
            hanger1R.rotation.y = rotY;
            stationGroup.add(hanger1L, hanger1R);

            // Gleis 2 Board (Right Platform - Outer side facing active tracks)
            // Swapped directions: track 2 side board uses materialsG1 ("HARDHÖHE")
            const g2X = isSideStation ? (spacing / 2 + 3.205) : (isScharfreiterring ? (localSchPlatCenter + 1.835) : (spacing / 2 - 3.205));
            const p2 = pos.clone().addScaledVector(normal, g2X);
            const board2 = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsG1);
            board2.position.copy(stationGroup.worldToLocal(p2.clone()));
            board2.position.y = boardY;
            board2.rotation.y = rotY;
            board2.scale.set(scaleFactor, scaleFactor, scaleFactor);
            stationGroup.add(board2);

            const hanger2L = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p2H1 = p2.clone().addScaledVector(normal, -hangerOffset);
            hanger2L.position.copy(stationGroup.worldToLocal(p2H1));
            hanger2L.position.y = hangerY;
            hanger2L.rotation.y = rotY;

            const hanger2R = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p2H2 = p2.clone().addScaledVector(normal, hangerOffset);
            hanger2R.position.copy(stationGroup.worldToLocal(p2H2));
            hanger2R.position.y = hangerY;
            hanger2R.rotation.y = rotY;
            stationGroup.add(hanger2L, hanger2R);

            if (isScharfreiterring) {
                // Left Platform Inner Board (facing decorative tracks)
                const g1InnerX = -(localSchPlatCenter - 1.835);
                const p1Inner = pos.clone().addScaledVector(normal, g1InnerX);
                const board1Inner = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsBlank);
                board1Inner.position.copy(stationGroup.worldToLocal(p1Inner.clone()));
                board1Inner.position.y = boardY;
                board1Inner.rotation.y = rotY;
                board1Inner.scale.set(scaleFactor, scaleFactor, scaleFactor);
                stationGroup.add(board1Inner);

                const hanger1InnerL = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p1InnerH1 = p1Inner.clone().addScaledVector(normal, -hangerOffset);
                hanger1InnerL.position.copy(stationGroup.worldToLocal(p1InnerH1));
                hanger1InnerL.position.y = hangerY;
                hanger1InnerL.rotation.y = rotY;

                const hanger1InnerR = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p1InnerH2 = p1Inner.clone().addScaledVector(normal, hangerOffset);
                hanger1InnerR.position.copy(stationGroup.worldToLocal(p1InnerH2));
                hanger1InnerR.position.y = hangerY;
                hanger1InnerR.rotation.y = rotY;
                stationGroup.add(hanger1InnerL, hanger1InnerR);

                // Right Platform Inner Board (facing decorative tracks)
                const g2InnerX = localSchPlatCenter - 1.835;
                const p2Inner = pos.clone().addScaledVector(normal, g2InnerX);
                const board2Inner = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsBlank);
                board2Inner.position.copy(stationGroup.worldToLocal(p2Inner.clone()));
                board2Inner.position.y = boardY;
                board2Inner.rotation.y = rotY;
                board2Inner.scale.set(scaleFactor, scaleFactor, scaleFactor);
                stationGroup.add(board2Inner);

                const hanger2InnerL = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p2InnerH1 = p2Inner.clone().addScaledVector(normal, -hangerOffset);
                hanger2InnerL.position.copy(stationGroup.worldToLocal(p2InnerH1));
                hanger2InnerL.position.y = hangerY;
                hanger2InnerL.rotation.y = rotY;

                const hanger2InnerR = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p2InnerH2 = p2Inner.clone().addScaledVector(normal, hangerOffset);
                hanger2InnerR.position.copy(stationGroup.worldToLocal(p2InnerH2));
                hanger2InnerR.position.y = hangerY;
                hanger2InnerR.rotation.y = rotY;
                stationGroup.add(hanger2InnerL, hanger2InnerR);
            }
        });

        // Bauernfeindstraße: long station-name signs hanging from the ceiling in
        // every second inter-pillar gap. Pillars sit at ±7.5/±22.5/±37.5, so the
        // five gaps are centred at -30/-15/0/15/30; every second gap → -30/0/30,
        // the same rhythm as the departure boards. Same centre height as the
        // boards (3.925, Unterkante 3.60) so the signage reads as one row.
        if (station.name === "Bauernfeindstraße") {
            if (!this._bauernfeindNameSignMat) {
                const canvas = document.createElement('canvas');
                canvas.width = 2048;
                canvas.height = 128;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#817B7F';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#050407';
                ctx.font = 'bold 96px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('BAUERNFEINDSTRASSE', canvas.width / 2, canvas.height / 2 + 4);
                const tex = new THREE.CanvasTexture(canvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                this._bauernfeindNameSignMat = new THREE.MeshBasicMaterial({ map: tex });
                this._bauernfeindNameSignCasingMat = new THREE.MeshLambertMaterial({ color: '#817B7F' });
            }
            // 2/3 of the departure-board proportions ("1/3 kleiner")
            const signLen = 6.67, signH = 0.433, signT = 0.053;
            const signY = 3.925;    // departure-board centre height
            const ceilYSign = 4.66; // this station's flat slab height
            const faceGeom = new THREE.PlaneGeometry(signLen, signH);
            const casingGeom = new THREE.BoxGeometry(signT, signH, signLen);
            const signHangerLen = ceilYSign - signY;
            const signHangerGeom = new THREE.CylinderGeometry(0.015, 0.015, signHangerLen, 6);
            for (const bz of [-30, 0, 30]) {
                const sSign = station.position + bz;
                const posSign = this.sim.getTrackPosition(sSign);
                const tanSign = this.sim.getTrackTangent(sSign);
                const rotYSign = Math.atan2(tanSign.x, tanSign.z) - centerAngle;

                const signGroup = new THREE.Group();
                signGroup.position.copy(stationGroup.worldToLocal(posSign.clone()));
                signGroup.position.y = signY;
                signGroup.rotation.y = rotYSign;

                signGroup.add(new THREE.Mesh(casingGeom, this._bauernfeindNameSignCasingMat));
                for (const faceSign of [1, -1]) {
                    // rotY = +faceSign*π/2 puts each plane's front (and a correctly
                    // reading, unmirrored texture) toward its own platform side.
                    const face = new THREE.Mesh(faceGeom, this._bauernfeindNameSignMat);
                    face.position.x = faceSign * (signT / 2 + 0.002);
                    face.rotation.y = faceSign * Math.PI / 2;
                    signGroup.add(face);
                }
                for (const hz of [-2.7, 2.7]) {
                    const hang = new THREE.Mesh(signHangerGeom, this.materials.boardHanger);
                    hang.position.set(0, signHangerLen / 2, hz);
                    signGroup.add(hang);
                }
                stationGroup.add(signGroup);
            }
        }

        // 7. Lights (every 10 meters)
        // Stations with the standard barrel light channel (Wöhrder-Wiese-Modell)
        // instead of the plain light tubes:
        if (["Hauptbahnhof", "Klinikum", "Stadthalle"].includes(station.name)) {
            this.buildBarrelLights(stationGroup, {
                startS: station.position - platLength / 2 + 3.0,
                endS: station.position + platLength / 2 - 3.0,
                axisY: 3.775,
                centerPosY: centerPos.y,
                centerAngle,
                offFn: (s) => this.sim.getTrackSpacing(s) / 2 - 1.785,
                ceilY: 4.66,
                label: station.name,
            });
        }
        const lightZ = [-40, -30, -20, -10, 0, 10, 20, 30, 40];
        lightZ.forEach(lz => {
            if (["Hardhöhe", "Maximilianstraße", "Bärenschanze", "Gostenhof", "Jakobinenstraße", "Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte", "Aufseßplatz", "Maffeiplatz", "Hasenbuck", "Frankenstraße", "Hohe Marter", "Schweinau", "St. Leonhard", "Rothenburger Straße", "Wöhrder Wiese", "Rathenauplatz", "Hauptbahnhof", "Klinikum", "Stadthalle", "Klinikum Nord", "Flughafen", "Maxfeld", "Rennweg", "Nordwestring", "Friedrich-Ebert-Platz"].includes(station.name)) return; // Skip standard lights
            const s = station.position + lz;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;

            if (isScharfreiterring) {
                const localSchPlatCenter = spacing / 2 - 5.03;
                const posL1 = pos.clone().addScaledVector(normal, -localSchPlatCenter - 0.6);
                const posL2 = pos.clone().addScaledVector(normal, -localSchPlatCenter + 0.6);
                const posR1 = pos.clone().addScaledVector(normal, localSchPlatCenter - 0.6);
                const posR2 = pos.clone().addScaledVector(normal, localSchPlatCenter + 0.6);

                const addLight = (pWorld) => {
                    const l = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l.position.copy(stationGroup.worldToLocal(pWorld));
                    l.position.y = 4.52;
                    l.rotation.y = rotY;
                    stationGroup.add(l);
                };
                addLight(posL1);
                addLight(posL2);
                addLight(posR1);
                addLight(posR2);
            } else {
                if (station.name === "Muggenhof" || station.name === "Stadtgrenze") return;
                const lightOffset = isSideStation ? 0 : (spacing > 8 ? 2.5 : 1.3);
                if (isSideStation) {
                    const posL = pos.clone().addScaledVector(normal, spacing / 2 + 3.54);
                    const posR = pos.clone().addScaledVector(normal, -spacing / 2 - 3.54);

                    const lR = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    lR.position.copy(stationGroup.worldToLocal(posR));
                    lR.position.y = 4.52;
                    lR.rotation.y = rotY;

                    const lL = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    lL.position.copy(stationGroup.worldToLocal(posL));
                    lL.position.y = 4.52;
                    lL.rotation.y = rotY;

                    stationGroup.add(lR, lL);
                } else {
                    const pos1 = pos.clone().addScaledVector(normal, -lightOffset);
                    const pos2 = pos.clone().addScaledVector(normal, lightOffset);

                    const l1 = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l1.position.copy(stationGroup.worldToLocal(pos1));
                    l1.position.y = 4.52;
                    l1.rotation.y = rotY;

                    const l2 = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l2.position.copy(stationGroup.worldToLocal(pos2));
                    l2.position.y = 4.52;
                    l2.rotation.y = rotY;

                    stationGroup.add(l1, l2);
                }
            }
        });



        if (isScharfreiterring) {
            // Build Scharfreiterring custom features: Overpass, Escalators, and Curved Decorative Tracks (length 190m: -95m to +95m)
            const trackLen = 190 * S_len;
            const schNumSub = 38; 
            const schSubLen = 5.0 * S_len;

            // Rail geometry/materials identical to the REAL running rails: Vignole profile
            // body + separate glossy head cap (mirrors TrackManager.createRailBodyGeometry/
            // createRailHeadGeometry and its rail/railHead materials).
            const decRailBodyGeom = (() => {
                const shape = new THREE.Shape();
                const pts = [
                    [-0.07, -0.075], [0.07, -0.075],  // foot (wide base)
                    [0.02, -0.045],                    // taper up to the web (right)
                    [0.02, 0.025],                     // web (right)
                    [0.045, 0.045],                    // flare out to the head (right)
                    [-0.045, 0.045],                   // flat head top (capped separately)
                    [-0.02, 0.025],                    // flare in from the head (left)
                    [-0.02, -0.045]                    // web (left)
                ];
                shape.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
                shape.lineTo(pts[0][0], pts[0][1]);
                const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 });
                g.translate(0, 0, -0.5); // center along Z (unit length, scaled per segment)
                return g;
            })();
            const decRailHeadGeom = (() => {
                const g = new THREE.BoxGeometry(0.09, 0.03, 1.0);
                g.translate(0, 0.06, 0);
                return g;
            })();
            const decRailBodyMat = new THREE.MeshLambertMaterial({ color: '#3b3530' });
            const decRailHeadMat = new THREE.MeshPhongMaterial({ color: '#d8d8d8', specular: '#ffffff', shininess: 120 });

            const decRailsIM = new THREE.InstancedMesh(decRailBodyGeom, decRailBodyMat, schNumSub * 4);
            const decRailHeadsIM = new THREE.InstancedMesh(decRailHeadGeom, decRailHeadMat, schNumSub * 4);

            const decThirdRailsIM = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.12, 0.15, 1.0),
                this.materials.thirdRail,
                schNumSub * 2
            );

            const decCoversIM = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.24, 0.08, 1.0),
                this.materials.thirdRail,
                schNumSub * 2
            );

            const setDecSegmentMatrix = (im, instanceIdx, A_world, B_world, yOffset = 0, xOffsetScale = 1.0) => {
                if (xOffsetScale === 0) {
                    const matrix = new THREE.Matrix4().makeScale(0, 0, 0);
                    im.setMatrixAt(instanceIdx, matrix);
                    return;
                }
                const A = stationGroup.worldToLocal(A_world.clone());
                const B = stationGroup.worldToLocal(B_world.clone());
                A.y += yOffset;
                B.y += yOffset;
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

                const scaleMatrix = new THREE.Matrix4().makeScale(xOffsetScale, 1.0, length);
                matrix.multiply(scaleMatrix);

                im.setMatrixAt(instanceIdx, matrix);
            };

            // Decorative-track lateral offset is frozen (schFixedSpacing, not a per-position
            // sample) so both rails stay perfectly parallel and straight; see schFixedSpacing
            // above for why.
            const localSchTrackCenterFixed = Math.max(1.23, schFixedSpacing / 2 - 10.06);

            // Continuous, gap-free gravel bed under BOTH decorative tracks, swept exactly
            // like the real at-grade beds (TrackManager flushBedRun 'atgrade-normal': top
            // at trackY-0.30, extending 1.9m beyond each track centre) but frozen to the
            // station-centre elevation like everything decorative here. Its edges reach
            // ~0.4m under the platform decks (inner edges at 3.72), so there is no lateral
            // gap either; the top sits 1cm below the deck underside to avoid z-fighting.
            const decBedHalfW = localSchTrackCenterFixed + 1.9;
            this.buildSweptBar(stationGroup,
                station.position - 95 * S_len, station.position + 95 * S_len,
                () => decBedHalfW, schFixedY - 0.31, schFixedY - 0.45,
                [this.materials.ballast, this.materials.ballast], 2.5, () => 0, 2.5);

            for (let j = 0; j < schNumSub; j++) {
                const z_start = -95 * S_len + j * schSubLen;
                const z_end = -95 * S_len + (j + 1) * schSubLen;
                const z_mid = z_start + schSubLen / 2;

                const s_start = station.position + z_start;
                const s_end = station.position + z_end;
                const s_mid = station.position + z_mid;

                const posStart = this.sim.getTrackPosition(s_start);
                const posEnd = this.sim.getTrackPosition(s_end);
                // Freeze elevation to the station-centre Y instead of following the real
                // getTrackY(s) ramp along this span (see schFixedY above) - only X/Z still
                // trace the real alignment curve.
                posStart.y = schFixedY;
                posEnd.y = schFixedY;
                const tangentStart = this.sim.getTrackTangent(s_start);
                const tangentEnd = this.sim.getTrackTangent(s_end);

                const normalStart = new THREE.Vector3(-tangentStart.z, 0, tangentStart.x);
                const normalEnd = new THREE.Vector3(-tangentEnd.z, 0, tangentEnd.x);

                const localSchTrackCenterStart = localSchTrackCenterFixed;
                const localSchTrackCenterEnd = localSchTrackCenterFixed;

                // 4 Running rails (gauge +-0.7175 and rail-top height exactly like the
                // real tracks in TrackManager.createChunk); the glossy head cap shares
                // the body's placement matrix.
                const decOffsetsStart = [
                    -localSchTrackCenterStart - 0.7175,
                    -localSchTrackCenterStart + 0.7175,
                    localSchTrackCenterStart - 0.7175,
                    localSchTrackCenterStart + 0.7175
                ];
                const decOffsetsEnd = [
                    -localSchTrackCenterEnd - 0.7175,
                    -localSchTrackCenterEnd + 0.7175,
                    localSchTrackCenterEnd - 0.7175,
                    localSchTrackCenterEnd + 0.7175
                ];

                for (let r = 0; r < 4; r++) {
                    const A = posStart.clone().addScaledVector(normalStart, decOffsetsStart[r]);
                    const B = posEnd.clone().addScaledVector(normalEnd, decOffsetsEnd[r]);
                    setDecSegmentMatrix(decRailsIM, j * 4 + r, A, B, -0.21);
                    setDecSegmentMatrix(decRailHeadsIM, j * 4 + r, A, B, -0.21);
                }

                // 2 Third rails & covers facing inwards
                const decPowerStart = [-localSchTrackCenterStart + 1.1, localSchTrackCenterStart - 1.1];
                const decPowerEnd = [-localSchTrackCenterEnd + 1.1, localSchTrackCenterEnd - 1.1];

                for (let p = 0; p < 2; p++) {
                    const A_rail = posStart.clone().addScaledVector(normalStart, decPowerStart[p]);
                    const B_rail = posEnd.clone().addScaledVector(normalEnd, decPowerEnd[p]);
                    setDecSegmentMatrix(decThirdRailsIM, j * 2 + p, A_rail, B_rail, -0.05);

                    const A_cover = posStart.clone().addScaledVector(normalStart, decPowerStart[p]);
                    const B_cover = posEnd.clone().addScaledVector(normalEnd, decPowerEnd[p]);
                    setDecSegmentMatrix(decCoversIM, j * 2 + p, A_cover, B_cover, 0.03);
                }
            }

            decRailsIM.instanceMatrix.needsUpdate = true;
            decRailHeadsIM.instanceMatrix.needsUpdate = true;
            decThirdRailsIM.instanceMatrix.needsUpdate = true;
            decCoversIM.instanceMatrix.needsUpdate = true;
            stationGroup.add(decRailsIM, decRailHeadsIM, decThirdRailsIM, decCoversIM);

            // Sleepers: same geometry (2.4 x 0.12 x 0.3) and 2m spacing as the real
            // open-air track (TrackManager: chunkSize 50 / 25 sleepers per chunk)
            const sleeperCount = Math.floor(trackLen / 2.0) + 1;
            const decSleepersL = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.3), this.materials.sleeper, sleeperCount);
            const decSleepersR = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.3), this.materials.sleeper, sleeperCount);

            for (let s = 0; s < sleeperCount; s++) {
                const zOffset = -95 + s * 2.0;
                const distVal = station.position + zOffset;
                const pos = this.sim.getTrackPosition(distVal);
                const tangent = this.sim.getTrackTangent(distVal);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const angle = Math.atan2(tangent.x, tangent.z);

                // Same frozen lateral offset as the rails/ballast above, so the sleepers stay
                // centred under them instead of drifting off to the side.
                const posL = pos.clone().addScaledVector(normal, -localSchTrackCenterFixed);
                posL.y = schFixedY - 0.25;
                const localL = stationGroup.worldToLocal(posL);
                const mL = new THREE.Matrix4().makeRotationY(angle - centerAngle);
                mL.setPosition(localL);
                decSleepersL.setMatrixAt(s, mL);

                const posR = pos.clone().addScaledVector(normal, localSchTrackCenterFixed);
                posR.y = schFixedY - 0.25;
                const localR = stationGroup.worldToLocal(posR);
                const mR = new THREE.Matrix4().makeRotationY(angle - centerAngle);
                mR.setPosition(localR);
                decSleepersR.setMatrixAt(s, mR);
            }
            decSleepersL.instanceMatrix.needsUpdate = true;
            decSleepersR.instanceMatrix.needsUpdate = true;
            stationGroup.add(decSleepersL, decSleepersR);

            // 13. Crossing building at the -Z platform end (photo reference):
            // two concrete towers standing on the platforms, joined by a glazed bridge
            // over the decorative middle tracks, open footbridges continuing outward
            // over the running tracks, and sloped concrete abutment ramps that form
            // the actual platform ends. Anchored at z = -50; the platform decks end
            // flush with the towers' outer face (z = -53.5).
            {
                const s0 = station.position - 50 * S_len;
                const pos0 = this.sim.getTrackPosition(s0);
                const tan0 = this.sim.getTrackTangent(s0);
                const angle0 = Math.atan2(tan0.x, tan0.z) - centerAngle;

                const bld = new THREE.Group();
                bld.position.copy(stationGroup.worldToLocal(pos0.clone()));
                bld.position.y = 0; // frozen to the station-centre elevation, like the decks
                bld.rotation.y = angle0;
                stationGroup.add(bld);

                const platCenter = schFixedSpacing / 2 - 5.03;
                const half = 3.5; // tower footprint = full platform width
                const concMat = new THREE.MeshLambertMaterial({ color: '#b3ada0' }); // beige exposed concrete
                const frameMat = new THREE.MeshLambertMaterial({ color: '#2b3138' }); // dark window frames
                const glassMat = new THREE.MeshLambertMaterial({ color: '#4a5a6a' }); // reflective-dark glazing
                const doorMat = new THREE.MeshLambertMaterial({ color: '#8a8f94' }); // grey steel doors/cabinets
                const railMat = this.materials.boardHanger;

                const bandBot = 5.3, bandTop = 8.15, roofTop = 8.65;
                const uLogoMat = this.createSubwayULogo();
                const logoGeom = new THREE.BoxGeometry(1.2, 1.2, 0.05);

                // Vertical window mullions along one face of a glazing band
                const addMullions = (parent, faceAxis, facePos, y, h, from, to, step) => {
                    for (let u = from; u <= to + 0.001; u += step) {
                        const m = new THREE.Mesh(new THREE.BoxGeometry(
                            faceAxis === 'z' ? 0.08 : 0.06, h, faceAxis === 'z' ? 0.06 : 0.08), frameMat);
                        if (faceAxis === 'z') m.position.set(u, y, facePos);
                        else m.position.set(facePos, y, u);
                        parent.add(m);
                    }
                };

                const buildTower = (sig) => {
                    const tg = new THREE.Group();
                    tg.position.set(sig * platCenter, 0, 0);
                    bld.add(tg);

                    // Solid concrete lower storey (platform level up to the window band).
                    // Recessed on the platform side like the upper storey, so the glazed
                    // entrance head between the yellow flanks forms a covered niche the
                    // stairs climb into; the outer end face stays flush with the ramps.
                    const body = new THREE.Mesh(new THREE.BoxGeometry(half * 2, bandBot + 0.4, half * 2 - 1.2), concMat);
                    body.position.set(0, (bandBot - 0.4) / 2, -0.6);
                    tg.add(body);

                    // Solid concrete upper storey (photo: concrete on the outer, inner and
                    // end faces) -- recessed on the platform side, where the tilted glass
                    // front sits between the yellow flank walls.
                    const upper = new THREE.Mesh(new THREE.BoxGeometry(half * 2, bandTop - bandBot, half * 2 - 1.2), concMat);
                    upper.position.set(0, (bandBot + bandTop) / 2, -0.6);
                    tg.add(upper);

                    // Entrance head (photo analysis): CONCRETE slanted cheek walls form the
                    // outside of the funnel that encloses the stairs/escalators; only their
                    // INNER faces are lined yellow. The head sits flush with the FRONT edge
                    // of the hall walls (z = headZ, the halls' open end), protruding past it
                    // at the base, clear width 4.5m around the 4.2m stair layout.
                    // All shapes live in the (z, y) plane and are extruded across x; after
                    // rotateY(-PI/2) shape-x maps to +z (toward the platform) and the
                    // extrusion depth spans [-depth, 0] in x. z coordinates are relative to headZ.
                    const headZ = half + 20.0; // = hall wall front edge (wingLen)

                    // 1. Tall slanted head cheeks (platform level up to the roof)
                    const cheekShape = new THREE.Shape();
                    cheekShape.moveTo(-2.0, 0.865);
                    cheekShape.lineTo(1.8, 0.865);
                    cheekShape.lineTo(0.4, roofTop);
                    cheekShape.lineTo(-2.0, roofTop);
                    cheekShape.closePath();
                    const cheekGeom = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.75, bevelEnabled: false });
                    cheekGeom.rotateY(-Math.PI / 2);
                    // Yellow inner lining of the cheeks (slightly inset copy)
                    const liningShape = new THREE.Shape();
                    liningShape.moveTo(-1.9, 0.9);
                    liningShape.lineTo(1.62, 0.9);
                    liningShape.lineTo(0.3, roofTop - 0.2);
                    liningShape.lineTo(-1.9, roofTop - 0.2);
                    liningShape.closePath();
                    const liningGeom = new THREE.ExtrudeGeometry(liningShape, { depth: 0.06, bevelEnabled: false });
                    liningGeom.rotateY(-Math.PI / 2);

                    [1, -1].forEach(fx => {
                        // extruded span is [-depth, 0] in x -> place by the inner-face x.
                        // Outer faces at +/-3.0 meet the battered hall walls at the front edge.
                        const cheek = new THREE.Mesh(cheekGeom, concMat);
                        cheek.position.set(fx === 1 ? 3.0 : -2.25, 0, headZ);
                        tg.add(cheek);

                        const lining = new THREE.Mesh(liningGeom, this.materials.yellowCabin);
                        lining.position.set(fx === 1 ? 2.25 : -2.19, 0, headZ);
                        tg.add(lining);
                    });

                    // 3. Tilted glass front between the yellow-lined cheeks, reaching up
                    // to the white roof fascia
                    const gBotY = 4.7, gBotZ = headZ + 1.24;
                    const gTopY = roofTop - 0.1, gTopZ = headZ + 0.40;
                    const gLen = Math.hypot(gTopY - gBotY, gBotZ - gTopZ);
                    const gTilt = Math.atan2(gBotZ - gTopZ, gTopY - gBotY);
                    const glassGroup = new THREE.Group();
                    glassGroup.position.set(0, (gBotY + gTopY) / 2, (gBotZ + gTopZ) / 2);
                    glassGroup.rotation.x = -gTilt;
                    const glassFront = new THREE.Mesh(new THREE.BoxGeometry(4.2, gLen, 0.08), glassMat);
                    glassGroup.add(glassFront);
                    [-1.4, 0, 1.4].forEach(mx => {
                        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.1, gLen, 0.14), frameMat);
                        mullion.position.x = mx;
                        glassGroup.add(mullion);
                    });
                    tg.add(glassGroup);

                    // White fascia cap over the head, continuing the hall's roof edge
                    const headCap = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.12, 1.1), new THREE.MeshLambertMaterial({ color: '#e8e8e8' }));
                    headCap.position.set(0, roofTop + 0.06, headZ + 0.45);
                    tg.add(headCap);

                    // Overhanging flat roof slab with white fascia edge (photo)
                    const roof = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.7, roofTop - bandTop, half * 2 + 0.7), concMat);
                    roof.position.y = (bandTop + roofTop) / 2;
                    tg.add(roof);
                    const roofCap = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.8, 0.1, half * 2 + 0.8), new THREE.MeshLambertMaterial({ color: '#e8e8e8' }));
                    roofCap.position.y = roofTop + 0.05;
                    tg.add(roofCap);

                    // Grey double doors on the outer end face (platform level, as in the photo)
                    [-0.55, 0.55].forEach(dx => {
                        const door = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.1, 0.08), doorMat);
                        door.position.set(dx, 0.865 + 1.05, -(half + 0.02));
                        tg.add(door);
                    });

                    // Glazed window band on the upper storey of the face pointing AWAY from
                    // the platforms (first photo), with dark frame rails and mullions
                    const nGlass = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 0.9, bandTop - bandBot - 0.35, 0.1), glassMat);
                    nGlass.position.set(0, (bandBot + bandTop) / 2, -(half + 0.06));
                    tg.add(nGlass);
                    [(bandBot + bandTop) / 2 - 1.33, (bandBot + bandTop) / 2 + 1.33].forEach(fy => {
                        const nRail = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 0.8, 0.16, 0.12), frameMat);
                        nRail.position.set(0, fy, -(half + 0.06));
                        tg.add(nRail);
                    });
                    addMullions(tg, 'z', -(half + 0.09), (bandBot + bandTop) / 2, bandTop - bandBot - 0.35, -2.7, 2.7, 0.9);
                    // Single door in the recessed niche facing the canopy side
                    const doorS = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.08), doorMat);
                    doorS.position.set(0.7, 0.865 + 1.05, half - 1.16);
                    tg.add(doorS);

                };
                buildTower(1);
                buildTower(-1);

                // Monolithic hall bodies ("aus einem Guss"): the elongated 20m volumes are
                // part of the building itself. Their slightly battered side walls run in
                // ONE flat plane from platform level all the way up to the roof -- the
                // lower walls are exactly as long as the upper ones and enclose the
                // stairs/escalators -- all in the same concrete as the rest. The far end
                // carries a tilted glass front like the entrance heads.
                {
                    const wingLen = 20.0;
                    const botY = 0.865, topY = roofTop;
                    const topHalfW = 3.0; // slight batter: 3.5 at the platform -> 3.0 at the roof
                    const wallT = 0.35;
                    const fasciaMat = new THREE.MeshLambertMaterial({ color: '#e8e8e8' });

                    // Battered side wall: full height in one slanted plane, extruded along
                    // the full length of the volume (shape in x/y, depth along +z)
                    const mkWallGeom = (ws) => {
                        const sh = new THREE.Shape();
                        sh.moveTo(ws * half, botY);
                        sh.lineTo(ws * (half - wallT), botY);
                        sh.lineTo(ws * (topHalfW - wallT), topY);
                        sh.lineTo(ws * topHalfW, topY);
                        sh.closePath();
                        return new THREE.ExtrudeGeometry(sh, { depth: wingLen, bevelEnabled: false });
                    };
                    const wallGeoms = [mkWallGeom(1), mkWallGeom(-1)];

                    [1, -1].forEach(sig => {
                        const cx = sig * platCenter;
                        wallGeoms.forEach(g => {
                            const wall = new THREE.Mesh(g, concMat);
                            wall.position.set(cx, 0, half);
                            bld.add(wall);
                        });

                        // Roof slab spanning the wall tops + white fascia edge
                        const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(topHalfW * 2, 0.4, wingLen), concMat);
                        roofSlab.position.set(cx, topY - 0.2, half + wingLen / 2);
                        bld.add(roofSlab);
                        const fascia = new THREE.Mesh(new THREE.BoxGeometry(topHalfW * 2 + 0.15, 0.12, wingLen + 0.15), fasciaMat);
                        fascia.position.set(cx, topY + 0.06, half + wingLen / 2);
                        bld.add(fascia);

                        // Interior soffit (upper-storey floor). It ends at z = 17.0 -- the
                        // last 6.5m before the entrance head stay open as the stair void
                        // where the escalators come up through this level.
                        const soffit = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.15, 13.5), concMat);
                        soffit.position.set(cx, 4.8, half + 13.5 / 2);
                        bld.add(soffit);

                        // U logo on the battered outer wall...
                        const logoSide = new THREE.Mesh(logoGeom, uLogoMat);
                        logoSide.position.set(cx + sig * 3.25, 6.6, half + wingLen - 2.5);
                        logoSide.rotation.y = sig * Math.PI / 2;
                        bld.add(logoSide);

                        // ...and lying flat on the roof
                        const logoTop = new THREE.Mesh(logoGeom, uLogoMat);
                        logoTop.position.set(cx, topY + 0.16, half + wingLen - 2.5);
                        logoTop.rotation.x = -Math.PI / 2;
                        bld.add(logoTop);
                    });
                }

                // Stairs + escalators under the wings: the codebase's standard dual-lane
                // layout (static centre staircase flanked by two GPU-animated escalator
                // lanes, four balustrades; see the Bauernfeindstraße block /
                // StationBuilder.createStairsAndEscalator). They climb from platform
                // level up to the bridge walk level (4.7) into the towers' upper storey.
                {
                    this.materials.bauernfeindStairTex = this.materials.bauernfeindStairTex || new THREE.MeshLambertMaterial({
                        map: (() => {
                            const canvas = document.createElement('canvas');
                            canvas.width = 64; canvas.height = 64;
                            const ctx = canvas.getContext('2d');
                            ctx.fillStyle = '#8a8680'; ctx.fillRect(0, 0, 64, 64);
                            ctx.fillStyle = '#6f6b66'; ctx.fillRect(0, 0, 64, 2);
                            const texture = new THREE.CanvasTexture(canvas);
                            texture.colorSpace = THREE.SRGBColorSpace;
                            return texture;
                        })()
                    });
                    this.materials.bauernfeindEscStep = this.materials.bauernfeindEscStep || new THREE.MeshLambertMaterial({
                        map: (() => {
                            const canvas = document.createElement('canvas');
                            canvas.width = 64; canvas.height = 64;
                            const ctx = canvas.getContext('2d');
                            const stripeWidth = 2;
                            for (let x = 0; x < 64; x += stripeWidth) {
                                ctx.fillStyle = (x % (stripeWidth * 2) === 0) ? '#475569' : '#94a3b8';
                                ctx.fillRect(x, 0, stripeWidth, 64);
                                ctx.fillStyle = '#334155'; ctx.fillRect(x, 0, 1, 64);
                                ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x + stripeWidth - 1, 0, 1, 64);
                            }
                            const texture = new THREE.CanvasTexture(canvas);
                            texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
                            texture.colorSpace = THREE.SRGBColorSpace;
                            return texture;
                        })()
                    });
                    this.materials.bauernfeindEdelstahl = this.materials.bauernfeindEdelstahl
                        || StationBuilder.createBalustradeMaterial();
                    this.materials.bauernfeindHandrail = this.materials.bauernfeindHandrail
                        || new THREE.MeshBasicMaterial({ color: '#111111' });
                    this.materials.bauernfeindLamp = this.materials.bauernfeindLamp
                        || new THREE.MeshBasicMaterial({ color: '#ffffe0', side: THREE.DoubleSide });

                    const riseTarget = 4.7 - 0.865;
                    const stepHeight = 0.16;
                    const numSteps = Math.max(4, Math.round(riseTarget / stepHeight)); // 24
                    const numTotalSteps = numSteps + 4;
                    const stepDepth = 0.3;
                    const runLength = numSteps * stepDepth; // 7.2
                    const actualRise = numSteps * stepHeight; // 3.84
                    const rampLength = Math.sqrt(actualRise * actualRise + runLength * runLength);
                    const rampAngle = Math.atan2(actualRise, runLength);

                    const stairWidth = 2.0;
                    const escWidth = 1.0;
                    const thickness = 0.05;
                    const balustradeHeight = 0.9;
                    const { balustradeGeom, handrailGeom, lampGeom } = createEscalatorGeometries(rampLength, thickness, balustradeHeight, 0.1, 0.1);

                    [1, -1].forEach(sig => {
                        const stairGroup = new THREE.Group();
                        // Base anchored at the entrance head (the halls' open front edge at
                        // z = half + 20); local +z is the climb direction, rotated to ascend
                        // into the hall toward the tower (-z of the building).
                        stairGroup.position.set(sig * platCenter, 0.865, half + 20.0 + 0.8);
                        stairGroup.rotation.y = Math.PI;
                        bld.add(stairGroup);

                        const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
                        const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
                        const stairInst = new THREE.InstancedMesh(stairGeom, this.materials.bauernfeindStairTex, numSteps);
                        const escInst = new THREE.InstancedMesh(escStepGeom, this.materials.bauernfeindEscStep, 2 * numTotalSteps);

                        // Left lane UP, right lane DOWN (standard dual-lane pattern)
                        const dirAttr = new Float32Array(2 * numTotalSteps * 3);
                        for (let i = 0; i < numTotalSteps; i++) {
                            dirAttr[(2 * i) * 3 + 1] = stepHeight;
                            dirAttr[(2 * i) * 3 + 2] = stepDepth;
                            dirAttr[(2 * i + 1) * 3 + 1] = -stepHeight;
                            dirAttr[(2 * i + 1) * 3 + 2] = -stepDepth;
                        }
                        escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
                        StationBuilder.setupEscalatorMaterial(this.materials.bauernfeindEscStep, this);

                        const stepMatrix = new THREE.Matrix4();
                        for (let i = 0; i < numSteps; i++) {
                            const sy = i * stepHeight + stepHeight / 2;
                            const sz = i * stepDepth + stepDepth / 2;
                            stairInst.setMatrixAt(i, stepMatrix.makeTranslation(0, sy, sz));
                        }
                        for (let i = 0; i < numTotalSteps; i++) {
                            const stepIdx = i - 2;
                            const sy = stepIdx * stepHeight + stepHeight / 2;
                            const sz = stepIdx * stepDepth + stepDepth / 2;
                            escInst.setMatrixAt(2 * i, stepMatrix.makeTranslation(-1.55, sy, sz));
                            escInst.setMatrixAt(2 * i + 1, stepMatrix.makeTranslation(1.55, sy, sz));
                        }
                        stairInst.instanceMatrix.needsUpdate = true;
                        escInst.instanceMatrix.needsUpdate = true;
                        stairGroup.add(stairInst, escInst);
                        this.registerEscalator(escInst, { numTotalSteps });
                        escInst.computeBoundingSphere();
                        if (escInst.boundingSphere) escInst.boundingSphere.radius *= 5;

                        const midY = actualRise / 2;
                        const midZ = runLength / 2;

                        // Continuous underside strips beneath the escalator lanes
                        const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);
                        [-1.55, 1.55].forEach(ex => {
                            const escRamp = new THREE.Mesh(escRampGeom, this.materials.bauernfeindEscStep);
                            escRamp.position.set(ex, midY - 0.15, midZ);
                            escRamp.rotation.x = -rampAngle;
                            stairGroup.add(escRamp);
                        });

                        // Balustrades + handrails + lamps
                        [-2.05, -1.05, 1.05, 2.05].forEach(bx => {
                            const b = new THREE.Mesh(balustradeGeom, this.materials.bauernfeindEdelstahl);
                            b.position.set(bx, midY + 0.45, midZ);
                            b.rotation.x = -rampAngle;
                            const r = balustradeHeight / 2;
                            for (let z = -rampLength / 2 + 1.0; z <= rampLength / 2 - 1.0; z += 1.5) {
                                const lamp = new THREE.Mesh(lampGeom, this.materials.bauernfeindLamp);
                                lamp.position.set((bx < 0 ? 1 : -1) * (thickness / 2 + 0.001), 0.3 - r, z);
                                b.add(lamp);
                            }
                            const h = new THREE.Mesh(handrailGeom, this.materials.bauernfeindHandrail);
                            h.position.set(bx, midY + 0.45, midZ);
                            h.rotation.x = -rampAngle;
                            stairGroup.add(b, h);
                        });

                        // Dark entry portal at the back of the glazed entrance recess,
                        // where the stairs reach the upper storey
                        const portal = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.06), frameMat);
                        portal.position.set(sig * platCenter, 5.9, half - 1.14);
                        bld.add(portal);
                    });
                }

                // Glazed bridge section spanning the middle tracks between the towers
                {
                    const span = platCenter * 2 - half * 2 + 0.6; // slight overlap into the towers
                    const depth = 6.2; // recessed vs. the 7m-deep towers
                    const grp = new THREE.Group();
                    bld.add(grp);

                    const belt = new THREE.Mesh(new THREE.BoxGeometry(span, 5.6 - 4.4, depth), concMat);
                    belt.position.y = (4.4 + 5.6) / 2;
                    grp.add(belt);

                    const glass = new THREE.Mesh(new THREE.BoxGeometry(span, bandTop - 5.6, depth - 0.5), glassMat);
                    glass.position.y = (5.6 + bandTop) / 2;
                    grp.add(glass);
                    [5.68, bandTop - 0.08].forEach(fy => {
                        const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.16, depth - 0.3), frameMat);
                        rail.position.y = fy;
                        grp.add(rail);
                    });
                    const midY = (5.6 + bandTop) / 2;
                    addMullions(grp, 'z', depth / 2 - 0.2, midY, bandTop - 5.6, -3.2, 3.2, 0.8);
                    addMullions(grp, 'z', -(depth / 2 - 0.2), midY, bandTop - 5.6, -3.2, 3.2, 0.8);

                    const roof = new THREE.Mesh(new THREE.BoxGeometry(span, roofTop - bandTop, half * 2 + 0.7), concMat);
                    roof.position.y = (bandTop + roofTop) / 2;
                    grp.add(roof);
                }

                // Open footbridges continuing outward over the running tracks
                [1, -1].forEach(sig => {
                    const len = 13.0;
                    const cx = sig * (platCenter + half + len / 2);
                    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 4.0), concMat);
                    deck.position.set(cx, 4.55, 0);
                    bld.add(deck);

                    [1.95, -1.95].forEach(dz => {
                        [5.15, 5.7].forEach(ry => {
                            const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), railMat);
                            rail.position.set(cx, ry, dz);
                            bld.add(rail);
                        });
                        for (let px = -len / 2 + 0.5; px <= len / 2 - 0.4; px += 2.4) {
                            const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05), railMat);
                            post.position.set(cx + px, 5.25, dz);
                            bld.add(post);
                        }
                    });

                    // End support pillar carrying the footbridge behind the running track
                    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.8, 3.0), concMat);
                    pillar.position.set(sig * (platCenter + half + len - 1.0), 2.0, 0);
                    bld.add(pillar);
                });

                // Sloped concrete abutment ramps forming the platform ends (photo foreground)
                const rampLen = 6.5;
                const rampShape = new THREE.Shape();
                rampShape.moveTo(0, -0.4);
                rampShape.lineTo(0, 0.865);
                rampShape.lineTo(rampLen, 0.05);
                rampShape.lineTo(rampLen, -0.4);
                rampShape.closePath();
                const rampGeom = new THREE.ExtrudeGeometry(rampShape, { depth: half * 2, bevelEnabled: false });
                rampGeom.rotateY(Math.PI / 2); // shape-x -> -z (toward the platform end), depth -> +x
                const rampSlope = Math.atan2(0.865 - 0.05, rampLen);
                [1, -1].forEach(sig => {
                    const ramp = new THREE.Mesh(rampGeom, concMat);
                    ramp.position.set(sig * platCenter - half, 0, -half);
                    bld.add(ramp);

                    // Handrails along both sloped edges of the ramp
                    [half - 0.15, -(half - 0.15)].forEach(dx => {
                        [1.0, 0.55].forEach(hy => {
                            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, rampLen + 0.15), railMat);
                            rail.position.set(sig * platCenter + dx, (0.865 + 0.05) / 2 + hy, -half - rampLen / 2);
                            rail.rotation.x = -rampSlope;
                            bld.add(rail);
                        });
                    });
                });
            }

            // 14. Static decorative DT1 train (turned off) parked on the inner decorative track
            // Positioned at z = +30m relative to the station centre (facing Langwasser)
            const staticTrain = new TrainModel(new THREE.Group(), this.sim);
            staticTrain.setTrainModel('DT1');

            const schTrainDist = station.position + 30.0 * S_len;
            const mockSim = Object.create(this.sim);
            mockSim.position = schTrainDist;
            mockSim.isReversing = false;
            mockSim.stations = this.sim.stations;
            mockSim.track = this.sim.track || { lineId: 'U1' };
            mockSim.getTrackXOffset = () => localSchTrackCenterFixed;
            mockSim.getTrackPosition = (s, target) => {
                const p = this.sim.getTrackPosition(s, target);
                p.y = schFixedY;
                return p;
            };
            mockSim.getTrackElevationOffset = () => 0;

            staticTrain.sim = mockSim;
            staticTrain.update(0);

            staticTrain.group.position.copy(stationGroup.worldToLocal(staticTrain.group.position));
            staticTrain.group.rotation.y -= centerAngle;
            stationGroup.add(staticTrain.group);

            // "Ausgeschaltet" - turn off all lights, screens and destination signs
            staticTrain.radioDisplays.forEach(d => {
                d.ctx.fillStyle = '#000';
                d.ctx.fillRect(0, 0, d.canvas.width, d.canvas.height);
                d.texture.needsUpdate = true;
            });
            if (staticTrain.dt1DestScreenMat) {
                staticTrain.dt1DestScreenMat.color.set('#222'); // dark grey/off
                if (staticTrain.dt1DestScreenMat.map) {
                    staticTrain.dt1DestScreenMat.map = null;
                    staticTrain.dt1DestScreenMat.needsUpdate = true;
                }
            }
            Object.values(staticTrain.lights).forEach(lArr => lArr.forEach(l => l.visible = false));
        }

        if (station.name === "Messe") {
            this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
            this.materials.glassCabin = this.materials.glassCabin || new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.4, side: THREE.DoubleSide });
            this.materials.pylonMat = new THREE.MeshLambertMaterial({ color: '#dddddd' });
            this.materials.cableMat = new THREE.MeshBasicMaterial({ color: '#333333' });

            const concourseLength = 23.2; // Long along platform Z
            const concourseWidth = 5.0;   // Narrow along platform X
            const concourseHeight = 7.2 - 4.76;

            // 1. Central Concourse Building (Elevated above roof slab top level Y = 4.76)
            const concourseGeom = new THREE.BoxGeometry(concourseWidth, concourseHeight, concourseLength);
            const concourseMesh = new THREE.Mesh(concourseGeom, this.materials.messeConcrete);
            concourseMesh.position.set(0, 4.76 + concourseHeight / 2, 20.0);
            stationGroup.add(concourseMesh);

            // Concourse Roof Plate (dark grey)
            const concourseRoof = new THREE.Mesh(new THREE.BoxGeometry(concourseWidth + 0.1, 0.1, concourseLength + 0.1), new THREE.MeshLambertMaterial({ color: '#555555' }));
            concourseRoof.position.set(0, 7.2 + 0.05, 20.0);
            stationGroup.add(concourseRoof);

            // Skylights on Concourse Roof
            const skylightGeom = new THREE.BoxGeometry(1.5, 0.05, 1.5);
            const skylightMat = new THREE.MeshLambertMaterial({ color: '#222222' });
            const skylightZ = [20.0 - 9, 20.0 - 6, 20.0 - 3, 20.0, 20.0 + 3, 20.0 + 6, 20.0 + 9];
            const skylightX = [-1.2, 1.2];
            for (let sz of skylightZ) {
                for (let sx of skylightX) {
                    const skylight = new THREE.Mesh(skylightGeom, skylightMat);
                    skylight.position.set(sx, 7.2 + 0.1, sz);
                    stationGroup.add(skylight);
                }
            }

            // 2. Escalator Glass Canopies (Symmetrical canopies, one at each end)
            const getMesseStairParams = (zDir) => {
                const anchorZ = (zDir === 1) ? 0.0 : 40.0;
                const s = station.position + anchorZ;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                const localPos = stationGroup.worldToLocal(pos.clone());
                return { localPos, rotY };
            };

            const buildEscalatorCanopy = (zDir) => {
                const canopyGroup = new THREE.Group();
                const rampLength = Math.sqrt(4.48 * 4.48 + 8.4 * 8.4);
                const rampAngle = Math.atan2(4.48, 8.4);

                // Glass walls
                const glassW = 0.05;
                const glassH = 2.6;
                const glassGeom = new THREE.BoxGeometry(glassW, glassH, rampLength);

                const leftGlass = new THREE.Mesh(glassGeom, this.materials.glassCabin);
                leftGlass.position.set(-2.2, glassH / 2, 0);

                const rightGlass = new THREE.Mesh(glassGeom, this.materials.glassCabin);
                rightGlass.position.set(2.2, glassH / 2, 0);

                canopyGroup.add(leftGlass, rightGlass);

                // Sloped roof
                const roofGeom = new THREE.BoxGeometry(4.45, 0.1, rampLength);
                const roofMesh = new THREE.Mesh(roofGeom, this.materials.glassCabin);
                roofMesh.position.set(0, glassH, 0);
                canopyGroup.add(roofMesh);

                // Frame lines
                const frameGeom = new THREE.BoxGeometry(4.5, 0.15, 0.1);
                const frameMat = new THREE.MeshLambertMaterial({ color: '#444444' });
                for (let d = -rampLength/2; d <= rampLength/2; d += 2.0) {
                    const frame = new THREE.Mesh(frameGeom, frameMat);
                    frame.position.set(0, glassH, d);
                    canopyGroup.add(frame);
                }

                // Position and orient
                const params = getMesseStairParams(zDir);
                const canopyPos = params.localPos.clone();
                const dirZ = new THREE.Vector3(Math.sin(params.rotY), 0, Math.cos(params.rotY));
                canopyPos.addScaledVector(dirZ, zDir * 4.2);
                canopyPos.y = 0.865 + 4.48 / 2;

                canopyGroup.position.copy(canopyPos);
                canopyGroup.rotation.order = 'YXZ';
                canopyGroup.rotation.y = params.rotY;
                canopyGroup.rotation.x = -zDir * rampAngle;

                stationGroup.add(canopyGroup);
            };

            buildEscalatorCanopy(1);  // Langwasser side (descends to Z = 0.0)
            buildEscalatorCanopy(-1); // Fürth side (descends to Z = 40.0)

            // 3. Cylinder drawing helper
            const createCylinderBetweenPoints = (pA, pB, radius, material) => {
                const dir = new THREE.Vector3().subVectors(pB, pA);
                const length = dir.length();
                const geom = new THREE.CylinderGeometry(radius, radius, length, 8);
                const mesh = new THREE.Mesh(geom, material);
                
                const pos = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
                mesh.position.copy(pos);
                
                dir.normalize();
                const up = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
                mesh.setRotationFromQuaternion(quaternion);
                
                return mesh;
            };

            // 4. Left Bridge (Cable-Stayed Bridge, facing X-)
            const leftBridgeLen = 40.8;
            const leftBridgeX = -(concourseWidth / 2 + leftBridgeLen / 2); // -2.5 - 20.4 = -22.9
            
            // Deck
            const leftDeck = new THREE.Mesh(new THREE.BoxGeometry(leftBridgeLen, 0.2, 4.5), this.materials.messeConcrete);
            leftDeck.position.set(leftBridgeX, 5.345, 20.0);
            stationGroup.add(leftDeck);

            // Glass walls
            const leftGlass = new THREE.Mesh(new THREE.BoxGeometry(leftBridgeLen, 2.4, 4.4), this.materials.glassCabin);
            leftGlass.position.set(leftBridgeX, 5.345 + 1.2, 20.0);
            stationGroup.add(leftGlass);

            // Roof
            const leftRoof = new THREE.Mesh(new THREE.BoxGeometry(leftBridgeLen, 0.1, 4.5), new THREE.MeshLambertMaterial({ color: '#555555' }));
            leftRoof.position.set(leftBridgeX, 5.345 + 2.5, 20.0);
            stationGroup.add(leftRoof);

            // A-frame Pylon at X = -25, shifted to Z = 20.0
            const pTop = new THREE.Vector3(-25, 18, 20.0);
            const pA1 = new THREE.Vector3(-25, 0, 20.0 - 3.5);
            const pA2 = new THREE.Vector3(-25, 0, 20.0 + 3.5);

            const leg1 = createCylinderBetweenPoints(pA1, pTop, 0.4, this.materials.pylonMat);
            const leg2 = createCylinderBetweenPoints(pA2, pTop, 0.4, this.materials.pylonMat);
            stationGroup.add(leg1, leg2);

            // Support Cables
            const deckXCoords = [-12, -18, -32, -38];
            for (let dx of deckXCoords) {
                const cL = createCylinderBetweenPoints(pTop, new THREE.Vector3(dx, 5.345, 20.0 - 2.25), 0.04, this.materials.cableMat);
                const cR = createCylinderBetweenPoints(pTop, new THREE.Vector3(dx, 5.345, 20.0 + 2.25), 0.04, this.materials.cableMat);
                stationGroup.add(cL, cR);
            }

            // 5. Right Bridge (Concrete Girder Bridge, facing X+, shifted to Z = 20.0)
            const rightBridgeLen = 15.8;
            const rightBridgeX = concourseWidth / 2 + rightBridgeLen / 2; // 2.5 + 7.9 = 10.4

            // Deck
            const rightDeck = new THREE.Mesh(new THREE.BoxGeometry(rightBridgeLen, 0.2, 4.5), this.materials.messeConcrete);
            rightDeck.position.set(rightBridgeX, 5.345, 20.0);
            stationGroup.add(rightDeck);

            // Concrete Railings
            const railF = new THREE.Mesh(new THREE.BoxGeometry(rightBridgeLen, 1.1, 0.15), this.materials.messeConcrete);
            railF.position.set(rightBridgeX, 5.345 + 0.55, 20.0 + 2.25);
            
            const railB = new THREE.Mesh(new THREE.BoxGeometry(rightBridgeLen, 1.1, 0.15), this.materials.messeConcrete);
            railB.position.set(rightBridgeX, 5.345 + 0.55, 20.0 - 2.25);
            
            stationGroup.add(railF, railB);

            // Support Pillar under right bridge
            const supportPillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5.345, 0.8), this.materials.messeConcrete);
            supportPillar.position.set(rightBridgeX, 5.345 / 2, 20.0);
            stationGroup.add(supportPillar);

            // 6. Spawn passenger group at platform center
            const passBuilder = new PassengerBuilder();

            // Mann (180 cm, blond/ponytail, fair skin, black T-shirt with orange square on back, grey shorts, black shoes)
            const passengerMan = passBuilder.createCharacter({
                height: 1.80,
                skinColor: '#f5d0c0',
                hairColor: '#edd18c',
                hairStyle: 'ponytail',
                shirtColor: '#111111',
                shirtStyle: 'tshirt',
                pantsColor: '#555555',
                pantsStyle: 'shorts',
                shoesColor: '#111111',
                backDecal: 'orange_square'
            });
            passengerMan.position.set(0.0, 0.865, 18.4);
            passengerMan.rotation.y = 0;

            // Frau 1 (175 cm, fair skin, long brown hair, salmon shirt, dark blue skirt, black shoes)
            const passengerWoman1 = passBuilder.createCharacter({
                height: 1.75,
                skinColor: '#f5d0c0',
                hairColor: '#593e1a',
                hairStyle: 'long',
                shirtColor: '#fa8072',
                shirtStyle: 'tshirt',
                pantsColor: '#0f2b5c',
                pantsStyle: 'skirt',
                shoesColor: '#111111'
            });
            passengerWoman1.position.set(0.6, 0.865, 19.0);
            passengerWoman1.rotation.y = -Math.PI / 2;

            // Frau 2 (175 cm, fair skin, long blond hair, sunglasses, light green summer dress, white shoes)
            const passengerWoman2 = passBuilder.createCharacter({
                height: 1.75,
                skinColor: '#f5d0c0',
                hairColor: '#edd18c',
                hairStyle: 'long',
                shirtColor: '#90ee90',
                shirtStyle: 'sleeveless',
                pantsColor: '#ffffff',
                pantsStyle: 'dress',
                shoesColor: '#ffffff',
                sunglasses: true
            });
            passengerWoman2.position.set(0.0, 0.865, 19.6);
            passengerWoman2.rotation.y = Math.PI;

            // Frau 3 (165 cm, Arabic-brown skin, long black hair, white long-sleeved crop top, short jeans skirt, black shoes)
            const passengerWoman3 = passBuilder.createCharacter({
                height: 1.65,
                skinColor: '#c68642',
                hairColor: '#090807',
                hairStyle: 'long',
                shirtColor: '#ffffff',
                shirtStyle: 'crop',
                pantsColor: '#4682b4',
                pantsStyle: 'skirt',
                shoesColor: '#111111'
            });
            passengerWoman3.position.set(-0.6, 0.865, 19.0);
            passengerWoman3.rotation.y = Math.PI / 2;

            stationGroup.add(passengerMan, passengerWoman1, passengerWoman2, passengerWoman3);
        }

        if (station.name === "Bauernfeindstraße") {
            // Escalator shaft through the roof cutout + a short covered walkway over
            // the tunnel mouth, replacing the removed portal arch (see TrackManager.js
            // createChunk portals loop / flushBedRun tunnel branch).
            this.materials.bauernfeindStructConcrete = this.materials.bauernfeindStructConcrete
                || new THREE.MeshLambertMaterial({ color: '#9c9891' });
            this.materials.bauernfeindGlass = this.materials.bauernfeindGlass
                || new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.4, side: THREE.DoubleSide });
            this.materials.bauernfeindWalkwayRoof = this.materials.bauernfeindWalkwayRoof
                || new THREE.MeshLambertMaterial({ color: '#555555' });

            const sh2 = this.sim.track.elevation.sh2;
            const gapWidth = 6.0; // matches the 3.0m half-width gap cut into the ceiling/bed slab above
            const ceilYLocal = 4.66; // isLwNord ceiling height used for this station's flat slab

            const anchorPos = this.sim.getTrackPosition(sh2);
            const anchorTangent = this.sim.getTrackTangent(sh2);
            const anchorRotY = Math.atan2(anchorTangent.x, anchorTangent.z) - centerAngle;
            const anchorLocalPos = stationGroup.worldToLocal(anchorPos.clone());

            // Working escalator: real instanced moving steps (like buildMuggenhofStairs/
            // buildStadtgrenzeStairs), housed under a canopy built exactly like Messe's
            // buildEscalatorCanopy (see the Messe block above). stepDepth is solved from
            // numSteps so numSteps*stepDepth exactly fills gapWidth -- keeps the steps,
            // the canopy shell and the ceiling/bed-slab cutout all self-consistent instead
            // of imposing an independent slope on the continuous shell.
            const riseTarget = ceilYLocal + 0.1 - 0.865;
            const stepHeight = 0.16;
            const numSteps = Math.max(4, Math.round(riseTarget / stepHeight));
            const numTotalSteps = numSteps + 4; // extend by 2 steps at each end
            const stepDepth = gapWidth / numSteps;
            const actualRise = numSteps * stepHeight;
            const rampLength = Math.sqrt(actualRise * actualRise + gapWidth * gapWidth);
            const rampAngle = Math.atan2(actualRise, gapWidth);

            const dirZ = new THREE.Vector3(Math.sin(anchorRotY), 0, Math.cos(anchorRotY));

            // 1. Canopy shell (unrotated group, individual continuous pieces tilted to rampAngle)
            const canopyGroup = new THREE.Group();

            const glassW = 0.05;
            const glassH = 2.6;
            const glassGeom = new THREE.BoxGeometry(glassW, glassH, rampLength);

            const leftGlass = new THREE.Mesh(glassGeom, this.materials.bauernfeindGlass);
            leftGlass.position.set(-2.35, glassH / 2, 0);
            const rightGlass = new THREE.Mesh(glassGeom, this.materials.bauernfeindGlass);
            rightGlass.position.set(2.35, glassH / 2, 0);
            canopyGroup.add(leftGlass, rightGlass);

            const roofGeom = new THREE.BoxGeometry(4.9, 0.1, rampLength);
            const roofMesh = new THREE.Mesh(roofGeom, this.materials.bauernfeindGlass);
            roofMesh.position.set(0, glassH, 0);
            canopyGroup.add(roofMesh);

            const frameGeom = new THREE.BoxGeometry(4.95, 0.15, 0.1);
            const frameMat = new THREE.MeshLambertMaterial({ color: '#444444' });
            for (let d = -rampLength / 2; d <= rampLength / 2; d += 2.0) {
                const frame = new THREE.Mesh(frameGeom, frameMat);
                frame.position.set(0, glassH, d);
                canopyGroup.add(frame);
            }

            const canopyPos = anchorLocalPos.clone().addScaledVector(dirZ, gapWidth / 2);
            canopyPos.y = 0.865 + actualRise / 2;

            canopyGroup.position.copy(canopyPos);
            canopyGroup.rotation.order = 'YXZ';
            canopyGroup.rotation.y = anchorRotY;
            canopyGroup.rotation.x = -rampAngle;
            stationGroup.add(canopyGroup);

            // 2. Working steps: the codebase's normal stairs+escalator layout (see
            // StationBuilder.createStairsAndEscalator) -- a static center staircase
            // flanked by two moving escalator lanes (one up, one down), four balustrade
            // panels. Base-anchored group (no group-level slope rotation -- the stacked
            // per-step sy/sz offsets already build the staircase shape); only the
            // continuous casing/balustrades/handrails below get individually tilted.
            this.materials.bauernfeindStairTex = this.materials.bauernfeindStairTex || new THREE.MeshLambertMaterial({
                map: (() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 64; canvas.height = 64;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#8a8680'; ctx.fillRect(0, 0, 64, 64);
                    ctx.fillStyle = '#6f6b66'; ctx.fillRect(0, 0, 64, 2);
                    const texture = new THREE.CanvasTexture(canvas);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    return texture;
                })()
            });
            this.materials.bauernfeindEscStep = this.materials.bauernfeindEscStep || new THREE.MeshLambertMaterial({
                map: (() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 64; canvas.height = 64;
                    const ctx = canvas.getContext('2d');
                    const stripeWidth = 2;
                    for (let x = 0; x < 64; x += stripeWidth) {
                        ctx.fillStyle = (x % (stripeWidth * 2) === 0) ? '#475569' : '#94a3b8';
                        ctx.fillRect(x, 0, stripeWidth, 64);
                        ctx.fillStyle = '#334155'; ctx.fillRect(x, 0, 1, 64);
                        ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x + stripeWidth - 1, 0, 1, 64);
                    }
                    const texture = new THREE.CanvasTexture(canvas);
                    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
                    texture.colorSpace = THREE.SRGBColorSpace;
                    return texture;
                })()
            });
            this.materials.bauernfeindEdelstahl = this.materials.bauernfeindEdelstahl
                || StationBuilder.createBalustradeMaterial();
            this.materials.bauernfeindHandrail = this.materials.bauernfeindHandrail
                || new THREE.MeshBasicMaterial({ color: '#111111' });
            this.materials.bauernfeindLamp = this.materials.bauernfeindLamp
                || new THREE.MeshBasicMaterial({ color: '#ffffe0', side: THREE.DoubleSide });

            const stairCoreGroup = new THREE.Group();

            const stairWidth = 2.0;
            const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
            const escWidth = 1.0;
            const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
            const stairInst = new THREE.InstancedMesh(stairGeom, this.materials.bauernfeindStairTex, numSteps);
            const escInst = new THREE.InstancedMesh(escStepGeom, this.materials.bauernfeindEscStep, 2 * numTotalSteps);

            // Left lane UP, right lane DOWN, same as the reference dual-lane pattern.
            const dirAttr = new Float32Array(2 * numTotalSteps * 3);
            for (let i = 0; i < numTotalSteps; i++) {
                dirAttr[(2 * i) * 3 + 0] = 0;
                dirAttr[(2 * i) * 3 + 1] = stepHeight;
                dirAttr[(2 * i) * 3 + 2] = stepDepth;
                dirAttr[(2 * i + 1) * 3 + 0] = 0;
                dirAttr[(2 * i + 1) * 3 + 1] = -stepHeight;
                dirAttr[(2 * i + 1) * 3 + 2] = -stepDepth;
            }
            escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
            StationBuilder.setupEscalatorMaterial(this.materials.bauernfeindEscStep, this);

            const stepMatrix = new THREE.Matrix4();
            for (let i = 0; i < numSteps; i++) {
                const sy = i * stepHeight + stepHeight / 2;
                const sz = i * stepDepth + stepDepth / 2;
                stairInst.setMatrixAt(i, stepMatrix.makeTranslation(0, sy, sz));
            }
            for (let i = 0; i < numTotalSteps; i++) {
                const stepIdx = i - 2;
                const sy = stepIdx * stepHeight + stepHeight / 2;
                const sz = stepIdx * stepDepth + stepDepth / 2;
                escInst.setMatrixAt(2 * i, stepMatrix.makeTranslation(-1.55, sy, sz));
                escInst.setMatrixAt(2 * i + 1, stepMatrix.makeTranslation(1.55, sy, sz));
            }
            stairInst.instanceMatrix.needsUpdate = true;
            escInst.instanceMatrix.needsUpdate = true;
            stairCoreGroup.add(stairInst, escInst);
            this.registerEscalator(escInst, { numTotalSteps });
            escInst.computeBoundingSphere();
            if (escInst.boundingSphere) escInst.boundingSphere.radius *= 5;

            const midY = actualRise / 2;
            const midZ = gapWidth / 2;

            const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);
            const escL = new THREE.Mesh(escRampGeom, this.materials.bauernfeindEscStep);
            escL.position.set(-1.55, midY - 0.15, midZ);
            escL.rotation.x = -rampAngle;
            const escR = new THREE.Mesh(escRampGeom, this.materials.bauernfeindEscStep);
            escR.position.set(1.55, midY - 0.15, midZ);
            escR.rotation.x = -rampAngle;
            stairCoreGroup.add(escL, escR);

            const thickness = 0.05;
            const balustradeHeight = 0.9;
            const railWidth = 0.1;
            const railHeight = 0.1;
            const { balustradeGeom, handrailGeom, lampGeom } = createEscalatorGeometries(rampLength, thickness, balustradeHeight, railWidth, railHeight);

            const addLamps = (mesh, dirX) => {
                const r = balustradeHeight / 2;
                const halfW = rampLength / 2;
                for (let z = -halfW + 1.0; z <= halfW - 1.0; z += 1.5) {
                    const lamp = new THREE.Mesh(lampGeom, this.materials.bauernfeindLamp);
                    lamp.position.set(dirX * (thickness / 2 + 0.001), 0.3 - r, z);
                    mesh.add(lamp);
                }
            };

            const balustradeXs = [-2.05, -1.05, 1.05, 2.05];
            const balustrades = [];
            const handrails = [];
            for (const bx of balustradeXs) {
                const b = new THREE.Mesh(balustradeGeom, this.materials.bauernfeindEdelstahl);
                b.position.set(bx, midY + 0.45, midZ);
                b.rotation.x = -rampAngle;
                addLamps(b, bx < 0 ? 1 : -1);
                balustrades.push(b);

                const h = new THREE.Mesh(handrailGeom, this.materials.bauernfeindHandrail);
                h.position.set(bx, midY + 0.45, midZ);
                h.rotation.x = -rampAngle;
                handrails.push(h);
            }
            stairCoreGroup.add(...balustrades, ...handrails);

            stairCoreGroup.position.copy(anchorLocalPos);
            stairCoreGroup.position.y += 0.865;
            stairCoreGroup.rotation.y = anchorRotY;
            stationGroup.add(stairCoreGroup);

            // Covered walkway spanning sideways over the roof at the cutout, standing
            // in for the removed tunnel portal. Shifted a half walkway-depth past sh2
            // so its whole footprint sits over the tunnel, not the at-grade approach.
            // Twice the previous width/height; facades are a fine concrete texture
            // instead of glass. Deck and roof are cut out where the escalator/canopy
            // passes through (flanking strips + a far cap closing the rest of the
            // center strip), same idea as the ceiling/roof cutouts elsewhere.
            this.materials.bauernfeindWalkwayConcrete = this.materials.bauernfeindWalkwayConcrete
                || new THREE.MeshLambertMaterial({ map: this.tunnelConcreteTexture });

            const walkwayWidth = 36.0;
            const walkwayDepth = gapWidth + 2.0;
            const wallHeight = 4.4;
            const walkwayY = ceilYLocal + 0.35;

            const walkwayAnchorLocalPos = anchorLocalPos.clone().addScaledVector(dirZ, walkwayDepth / 2);

            const walkwayGroup = new THREE.Group();

            // Escalator/canopy passage, in the walkway's own local frame (z=0 is its
            // center; local z=-walkwayDepth/2 lines up with sh2, the escalator's base).
            // Matches the canopy frame's outer face (frameGeom is 4.95 wide, so half
            // 2.475) so the deck/roof cutout is flush with the escalators' own side
            // cladding instead of leaving a gap (or, worse, clipping the canopy roof).
            const escHalf = 2.475;
            const escZStart = -walkwayDepth / 2;
            const escZEnd = escZStart + gapWidth;

            const addRect = (material, y, thickness, x0, x1, z0, z1) => {
                if (x1 <= x0 || z1 <= z0) return;
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, thickness, z1 - z0), material);
                mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
                walkwayGroup.add(mesh);
            };
            const buildDeckLike = (y, thickness, material) => {
                addRect(material, y, thickness, -walkwayWidth / 2, -escHalf, -walkwayDepth / 2, walkwayDepth / 2);
                addRect(material, y, thickness, escHalf, walkwayWidth / 2, -walkwayDepth / 2, walkwayDepth / 2);
                addRect(material, y, thickness, -escHalf, escHalf, escZEnd, walkwayDepth / 2);
            };

            buildDeckLike(walkwayY, 0.2, this.materials.bauernfeindStructConcrete);
            // Top roof: ONE full slab, no escalator cutout — the canopy tops out at
            // ~7.4 local (escalator top 4.76 + glassH 2.6), well under this roof at
            // walkwayY + wallHeight = 9.41, so nothing pokes through it.
            addRect(this.materials.bauernfeindWalkwayRoof, walkwayY + wallHeight, 0.1,
                -walkwayWidth / 2, walkwayWidth / 2, -walkwayDepth / 2, walkwayDepth / 2);

            const walkwayGlassF = new THREE.Mesh(new THREE.BoxGeometry(walkwayWidth, wallHeight, 0.05), this.materials.bauernfeindWalkwayConcrete);
            walkwayGlassF.position.set(0, walkwayY + wallHeight / 2, walkwayDepth / 2 - 0.05);
            const walkwayGlassB = new THREE.Mesh(new THREE.BoxGeometry(walkwayWidth, wallHeight, 0.05), this.materials.bauernfeindWalkwayConcrete);
            walkwayGlassB.position.set(0, walkwayY + wallHeight / 2, -walkwayDepth / 2 + 0.05);
            walkwayGroup.add(walkwayGlassF, walkwayGlassB);

            // Tunnel portal buildings (eckig): two open-ended box structures under the
            // walkway, one per side of the escalator shaft, each made of exactly three
            // pieces -- an OUTER wall flush with the tunnel tube's side walls (same
            // spacing/2 + 3.1 base half-width as TrackManager.getTunnelHalfWidth;
            // the tube starts ~2.5m past the building's far end, sh2+8 vs platform
            // margin, so the planes line up where they meet), an INNER wall flush with
            // the escalator's side cladding (same escHalf as the deck cutout above), and
            // a CEILING slab spanning the two whose underside continues the tunnel
            // tube's roof plane (4.6m) and whose top meets the walkway deck's underside.
            // Built as plain boxes in the walkway's own frame so every shared edge stays
            // flush by construction; the trains pass through the open rectangular front
            // between each wall pair -- that opening IS the (eckige) tunnel mouth.
            const portalOuterHalf = this.sim.getTrackSpacing(sh2) / 2 + 3.1;
            const portalWallT = 0.3;
            const portalFloorY = -0.5;          // surrounding terrain level
            const portalTopY = walkwayY - 0.1;  // walkway deck underside
            const portalCeilBotY = 4.6;         // tunnel tube roof: ring center +0.8, ceilY +3.8
            const portalMat = this.materials.bauernfeindStructConcrete;
            const portalWallGeom = new THREE.BoxGeometry(portalWallT, portalTopY - portalFloorY, walkwayDepth);
            const portalCeilW = (portalOuterHalf + portalWallT) - escHalf;
            const portalCeilGeom = new THREE.BoxGeometry(portalCeilW, portalTopY - portalCeilBotY, walkwayDepth);
            for (const sign of [1, -1]) {
                const wallY = (portalFloorY + portalTopY) / 2;
                const innerWall = new THREE.Mesh(portalWallGeom, portalMat);
                innerWall.position.set(sign * (escHalf + portalWallT / 2), wallY, 0);
                const outerWall = new THREE.Mesh(portalWallGeom, portalMat);
                outerWall.position.set(sign * (portalOuterHalf + portalWallT / 2), wallY, 0);
                const portalCeil = new THREE.Mesh(portalCeilGeom, portalMat);
                portalCeil.position.set(sign * (escHalf + portalCeilW / 2), (portalCeilBotY + portalTopY) / 2, 0);
                walkwayGroup.add(innerWall, outerWall, portalCeil);
            }

            walkwayGroup.position.copy(walkwayAnchorLocalPos);
            walkwayGroup.rotation.y = anchorRotY;
            stationGroup.add(walkwayGroup);

            // "Durchgang verboten" Aufsteller (free-standing A-frame stands) at both
            // platform ends. The at-grade platform just ends in the open -- unlike the
            // underground stations, whose StationBuilder end walls carry gates with
            // this same plaque -- so a portable stand marks the end instead. The
            // plaque texture is reused from StationBuilder (it doesn't touch `this`).
            const dvTex = StationBuilder.prototype.createDurchgangVerbotenTexture.call(null);
            const dvPlaqueMat = new THREE.MeshBasicMaterial({ map: dvTex });
            const dvFrameMat = new THREE.MeshLambertMaterial({ color: '#d4d4d8' });
            const dvPanelGeom = new THREE.BoxGeometry(0.55, 0.75, 0.02);
            // BoxGeometry material order: px, nx, py, ny, pz, nz -- plaque on +z only,
            // each panel is yawed so its +z (textured) face points outward.
            const dvPanelMats = [dvFrameMat, dvFrameMat, dvFrameMat, dvFrameMat, dvPlaqueMat, dvFrameMat];
            const dvTilt = 0.18;
            for (const endSign of [1, -1]) {
                const sEnd = station.position + endSign * (station.halfLength - 1.0);
                const posEnd = this.sim.getTrackPosition(sEnd);
                const tanEnd = this.sim.getTrackTangent(sEnd);
                const rotYEnd = Math.atan2(tanEnd.x, tanEnd.z) - centerAngle;
                const stand = new THREE.Group();
                stand.position.copy(stationGroup.worldToLocal(posEnd.clone()));
                stand.position.y = 0.865;
                stand.rotation.y = rotYEnd;
                for (const f of [1, -1]) {
                    const panel = new THREE.Mesh(dvPanelGeom, dvPanelMats);
                    panel.rotation.order = 'YXZ';
                    panel.rotation.y = f === 1 ? 0 : Math.PI;
                    panel.rotation.x = -dvTilt; // lean the two panels together (A-frame)
                    panel.position.set(0, 0.37, f * 0.11);
                    stand.add(panel);
                }
                stationGroup.add(stand);
            }
        }

        // --- APPLY NEW STANDARD STAIRS TO LEGACY STATIONS ---
        if (station.name === "Muggenhof") {
            this.buildMuggenhofStairs(station, stationGroup, platLength, spacing, centerPos, centerAngle);
        } else if (station.name === "Stadtgrenze") {
            this.buildStadtgrenzeStairs(station, stationGroup, platLength, spacing, centerPos, centerAngle);
        } else {
            // StationBuilder is already imported statically at the top of this
            // file, so the dynamic import() this used to go through was
            // unnecessary — building synchronously avoids the async race it
            // introduced (stairs/escalators used to finish one microtask
            // after everything else in the station).
            const builder = new StationBuilder(this, station);
            builder.group = stationGroup;
            builder.buildStairs();
        }

        // --- ADD TRASH CANS ---
        this.addTrashCansToStation(station, stationGroup, S_len, platLength, platTopY, centerAngle);

        // --- SPAWN PASSENGERS ---
        this.spawnPassengersForStation(station, stationGroup);

        // --- AUFZÜGE (universelles Modell, buildElevator) ---
        // Bewusst NACH Möblierung und Passagieren, damit _clearElevatorFootprint
        // alles Berührte wegräumen kann. Testeinbau: hinteres Viertel von
        // Langwasser Süd (Streckenanfang-Seite; Viertel = z -45..-22.6,
        // Treppenanlage endet bei ca. -36.8, Säulen bei -37.5/-22.5).
        // topY = Deckenunterkante der Station (Lamellendecke 4.59).
        const elevatorSpecs = {
            "Langwasser Süd": [{ dz: -27, topY: 4.59 }],
            // Flughafen: Glasaufzug mitten im Aufzug-Lichteinlass (z 6..12), der
            // Schacht steigt durch die Deckenöffnung bis knapp unter das helle
            // Oberlicht (atriumTop 7.8). Position mit dem liftGap oben synchron.
            "Flughafen": [{ dz: 9, topY: 7.7 }],
            // Nordwestring: Glasaufzug mitten auf dem Bahnsteig (Foto 2), bis
            // unter die seitlichen Deckenplatten (Unterkante 4.56).
            "Nordwestring": [{ dz: 8, topY: 4.56 }]
        };
        (elevatorSpecs[station.name] || []).forEach(spec => this.buildElevator(stationGroup, station, centerAngle, spec));

        return stationGroup;
    }

    createRoughConcreteMaterial() {
        // Same rough concrete look as StationBuilder.createRoughConcreteMaterial (used for the
        // stair/tunnel-entrance portal walls), duplicated here so station-wide elements like the
        // cross-beams and upper wall band can share materials cached at the StationModel level.
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
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
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
        bumpTexture.wrapS = THREE.ClampToEdgeWrapping;
        bumpTexture.wrapT = THREE.ClampToEdgeWrapping;
        bumpTexture.repeat.set(1, 1);

        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.008
        });
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
        // 1:1 repeat because we scale UVs per segment for perfect alignment
        texture.repeat.set(1, 1);
        // KeepLook statt nur colorSpace-Tag: das nackte Tag ließ diesen Schotter dunkler
        // rendern als die (ungetaggte) TrackManager-Variante direkt daneben.
        return tagCanvasTextureSRGBKeepLook(texture);
    }

    createStationSignMaterial(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff'; // white background
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.lineWidth = 10;
        ctx.strokeStyle = '#000000'; // black border
        ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

        ctx.fillStyle = '#000000'; // black text
        ctx.font = 'bold 68px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2); // CAPS LOCK
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.strokeText(name.toUpperCase(), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createWallStripeMaterial(name, colorCode, textColor = '#ffffff') {
        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = colorCode;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = textColor;
        ctx.font = 'bold 33px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw the station name centered on the canvas, compressed horizontally
        // to make it narrow (condensed) as requested by the user.
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(0.68, 1.0); // Compress horizontally to make it narrow/condensed
        const upperName = name.replace(/ß/g, 'SS').toUpperCase();
        ctx.fillText(upperName, 0, 0);
        if (textColor === '#000000') {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 1.2;
            ctx.strokeText(upperName, 0, 0);
        } else if (textColor !== '#ffffff') {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 0.8;
            ctx.strokeText(upperName, 0, 0);
        }
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.wrapS = THREE.RepeatWrapping;

        // Calculate repeat count to maintain aspect ratio on a 90m long, 0.35m high wall stripe.
        // Canvas aspect ratio is 384 / 64 = 6.
        // So a single repeat covers 0.35 * 6 = 2.1 meters.
        // Total repeat count for 90 meters is 90 / 2.1 = 42.85.
        // We round to the nearest integer to prevent seams or wrapping cuts at the ends.
        const stripeHeight = 0.35;
        const platLength = 90;
        const repeatX = Math.round(platLength / (stripeHeight * (canvas.width / canvas.height)));
        texture.repeat.set(repeatX, 1);

        return new THREE.MeshBasicMaterial({ map: texture });
    }

    // ---- Klinikum Nord (U3): goldgelbe Metallwand, Schriftzug, Lochbleche ----
    getKlinikumNordGoldMat() {
        if (this._klinikumNordGoldMat) return this._klinikumNordGoldMat;
        const canvas = document.createElement('canvas');
        canvas.width = 2048;   // Kachel = 8 m Wandlänge
        canvas.height = 640;   // volle Wandhöhe (-0.38 .. 4.66 m)
        const ctx = canvas.getContext('2d');

        // Grundton: goldgelb gespritztes Blech mit leichtem Höhenverlauf
        const base = ctx.createLinearGradient(0, 0, 0, 640);
        base.addColorStop(0, '#c9a53c');
        base.addColorStop(0.5, '#d3af45');
        base.addColorStop(1, '#c09b35');
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, 2048, 640);

        // Deterministische Wolken-Flecken (dunkel) + wenige helle Glanzstellen;
        // am Kachelrand umgebrochen gezeichnet, damit die 8-m-Kachel nahtlos kachelt
        let seed = 7;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        const blot = (x, y, r, rgb, a) => {
            for (const xo of [x - 2048, x, x + 2048]) {
                const g = ctx.createRadialGradient(xo, y, 0, xo, y, r);
                g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
                g.addColorStop(1, `rgba(${rgb},0)`);
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(xo, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        };
        for (let i = 0; i < 90; i++) {
            blot(rand() * 2048, rand() * 640, 30 + rand() * 90, '110,88,20', 0.10 + rand() * 0.22);
        }
        for (let i = 0; i < 30; i++) {
            blot(rand() * 2048, rand() * 640, 25 + rand() * 70, '255,235,170', 0.08 + rand() * 0.14);
        }
        // Feine Metallkörnung
        for (let i = 0; i < 9000; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(90,70,15,0.10)' : 'rgba(255,240,190,0.10)';
            ctx.fillRect(rand() * 2048, rand() * 640, 1.5, 1.5);
        }
        // Blechstöße: feine dunkle vertikale Fugen alle 2 m (512 px)
        ctx.fillStyle = 'rgba(70,55,10,0.85)';
        for (let x = 0; x < 2048; x += 512) ctx.fillRect(x, 0, 2, 640);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        this._klinikumNordGoldMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._klinikumNordGoldMat;
    }

    getKlinikumNordTextMat() {
        if (this._klinikumNordTextMat) return this._klinikumNordTextMat;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;  // Fläche 3.6 m x 0.36 m
        canvas.height = 102;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 1024, 102);
        const label = 'KLINIKUM NORD';
        ctx.font = 'bold 60px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        // Gesperrte Einzel-Lettern mit festem Vorschub (wie die Metallbuchstaben
        // im Foto), dahinter ein dunkler Versatz als Schattenkante
        const track = 74;
        const x0 = 512 - ((label.length - 1) * track) / 2;
        for (let i = 0; i < label.length; i++) {
            const chX = x0 + i * track;
            ctx.fillStyle = '#4a4c48';
            ctx.fillText(label[i], chX + 3, 55);
            ctx.fillStyle = '#9aa09e';
            ctx.fillText(label[i], chX, 51);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._klinikumNordTextMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
        return this._klinikumNordTextMat;
    }

    getKlinikumNordPanelMat() {
        if (this._klinikumNordPanelMat) return this._klinikumNordPanelMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#96988f';
        ctx.fillRect(0, 0, 512, 128);
        // Lochraster
        ctx.fillStyle = '#6f716a';
        for (let y = 10; y < 128; y += 12) {
            for (let x = 10; x < 512; x += 12) {
                ctx.beginPath();
                ctx.arc(x, y, 2.4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // heller Blechrahmen
        ctx.strokeStyle = '#c3c5bd';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 506, 122);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._klinikumNordPanelMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        return this._klinikumNordPanelMat;
    }

    // ---- Flughafen (U2): Betonwand mit Aluraster, Kunstpaneele, Decke ----
    getFlughafenWallMat() {
        if (this._flughafenWallMat) return this._flughafenWallMat;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;  // Kachel = 4 m Wandlänge
        canvas.height = 672;  // Wandhöhe -0.38 .. 5.0 m
        const ctx = canvas.getContext('2d');

        // Sichtbeton mit Flecken und feiner Körnung
        ctx.fillStyle = '#b9bab6';
        ctx.fillRect(0, 0, 1024, 672);
        let seed = 3;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 40; i++) {
            const x = rand() * 1024, y = rand() * 672, r = 20 + rand() * 60;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, rand() < 0.5 ? 'rgba(120,122,118,0.18)' : 'rgba(235,236,232,0.16)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = 0; i < 2500; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(105,107,103,0.15)' : 'rgba(230,231,227,0.15)';
            ctx.fillRect(rand() * 1024, rand() * 672, 1.5, 1.5);
        }
        // Horizontale Aluprofile (~alle 0.5 m) mit Schattenfuge darunter
        for (let y = 24; y < 672; y += 64) {
            ctx.fillStyle = '#3f4245';
            ctx.fillRect(0, y + 8, 1024, 3);
            const g = ctx.createLinearGradient(0, y, 0, y + 8);
            g.addColorStop(0, '#d9dcdf');
            g.addColorStop(0.5, '#aeb2b6');
            g.addColorStop(1, '#84888c');
            ctx.fillStyle = g;
            ctx.fillRect(0, y, 1024, 8);
        }
        // Vertikale Profile alle 2 m
        for (const x of [0, 512]) {
            ctx.fillStyle = '#84888c';
            ctx.fillRect(x, 0, 5, 672);
            ctx.fillStyle = '#d9dcdf';
            ctx.fillRect(x + 5, 0, 2, 672);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        this._flughafenWallMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._flughafenWallMat;
    }

    getFlughafenArrowMat(variant) {
        this._flughafenArrowMats = this._flughafenArrowMats || {};
        if (this._flughafenArrowMats[variant]) return this._flughafenArrowMats[variant];
        const canvas = document.createElement('canvas');
        canvas.width = 512;   // Paneel 2.9 x 3.2 m
        canvas.height = 576;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2f5fae';
        ctx.fillRect(0, 0, 512, 576);
        // Fliesenraster
        ctx.strokeStyle = 'rgba(20,40,90,0.35)';
        ctx.lineWidth = 2;
        for (let x = 0; x <= 512; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 576); ctx.stroke(); }
        for (let y = 0; y <= 576; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
        // Weißes geknicktes Pfeil-/Blitzmotiv (Fotovorbild)
        const drawArrow = (cx, cyA, s, rot) => {
            ctx.save();
            ctx.translate(cx, cyA);
            ctx.rotate(rot);
            ctx.scale(s, s);
            ctx.fillStyle = '#eef1f5';
            ctx.beginPath();
            ctx.moveTo(0, -90);
            ctx.lineTo(55, -25);
            ctx.lineTo(22, -25);
            ctx.lineTo(52, 60);
            ctx.lineTo(12, 90);
            ctx.lineTo(-6, 20);
            ctx.lineTo(-40, 45);
            ctx.lineTo(-18, -35);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        };
        if (variant === 0) {
            drawArrow(210, 230, 1.6, -0.35);
        } else {
            drawArrow(310, 320, 1.35, 0.5);
            drawArrow(130, 130, 0.75, -0.9);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._flughafenArrowMats[variant] = new THREE.MeshLambertMaterial({ map: tex });
        return this._flughafenArrowMats[variant];
    }

    getFlughafenSignMat(label) {
        this._flughafenSignMats = this._flughafenSignMats || {};
        if (this._flughafenSignMats[label]) return this._flughafenSignMats[label];
        const canvas = document.createElement('canvas');
        canvas.width = 1024;  // Leuchtkasten 2.6 x 0.55 m
        canvas.height = 216;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f6f4ee';
        ctx.fillRect(0, 0, 1024, 216);
        ctx.strokeStyle = '#c6c4be';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 1018, 210);
        ctx.fillStyle = '#7b8fc4';
        ctx.font = '92px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 512, 116);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        // Leuchtkasten: MeshBasic, damit das Schild selbst hell wirkt
        this._flughafenSignMats[label] = new THREE.MeshBasicMaterial({ map: tex });
        return this._flughafenSignMats[label];
    }

    getFlughafenDuererMat() {
        if (this._flughafenDuererMat) return this._flughafenDuererMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Tiefblauer Grund mit Vignette
        const bg = ctx.createLinearGradient(0, 0, 0, 512);
        bg.addColorStop(0, '#101f6e');
        bg.addColorStop(0.5, '#1a34a0');
        bg.addColorStop(1, '#0c1a5e');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 512, 512);

        // Stilisiertes blaues Selbstbildnis: Gesicht als heller Kern
        const face = ctx.createRadialGradient(256, 215, 20, 256, 225, 120);
        face.addColorStop(0, '#9db4ea');
        face.addColorStop(0.55, '#5f7ccd');
        face.addColorStop(1, 'rgba(38,62,150,0)');
        ctx.fillStyle = face;
        ctx.beginPath();
        ctx.ellipse(256, 225, 88, 118, 0, 0, Math.PI * 2);
        ctx.fill();

        // Lange gewellte Haarsträhnen beidseits
        let seed = 11;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 46; i++) {
            const side = i % 2 === 0 ? 1 : -1;
            const x0 = 256 + side * (55 + rand() * 55);
            const y0 = 105 + rand() * 40;
            ctx.strokeStyle = rand() < 0.5 ? 'rgba(120,150,220,0.45)' : 'rgba(30,50,130,0.55)';
            ctx.lineWidth = 2.5 + rand() * 3;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.bezierCurveTo(
                x0 + side * (20 + rand() * 30), y0 + 90 + rand() * 40,
                x0 + side * (5 + rand() * 40), y0 + 180 + rand() * 50,
                x0 + side * (25 + rand() * 45), y0 + 280 + rand() * 60
            );
            ctx.stroke();
        }

        // Züge: Brauen, Augen, Nase, Mund, Bart — sparsam, druckgrafisch
        ctx.strokeStyle = 'rgba(12,24,80,0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(213, 196); ctx.quadraticCurveTo(232, 188, 249, 196); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(265, 196); ctx.quadraticCurveTo(282, 188, 299, 196); ctx.stroke();
        ctx.fillStyle = 'rgba(12,24,80,0.9)';
        ctx.beginPath(); ctx.ellipse(231, 212, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(281, 212, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(12,24,80,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(256, 218); ctx.lineTo(252, 262); ctx.quadraticCurveTo(256, 268, 262, 263); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(234, 292); ctx.quadraticCurveTo(256, 300, 278, 292); ctx.stroke();
        // Schnurr- und Kinnbart
        for (let i = 0; i < 14; i++) {
            const t = i / 13;
            ctx.strokeStyle = 'rgba(20,36,110,0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(226 + t * 60, 302);
            ctx.lineTo(222 + t * 68, 330 + Math.sin(t * Math.PI) * 14);
            ctx.stroke();
        }
        // Dunkler Kragen/Gewand unten
        ctx.fillStyle = 'rgba(8,16,60,0.85)';
        ctx.beginPath();
        ctx.moveTo(100, 512);
        ctx.quadraticCurveTo(256, 360, 412, 512);
        ctx.closePath();
        ctx.fill();

        // Glanz-Streifen wie die Spiegelungen auf dem Foto
        for (const gy of [120, 190]) {
            const gl = ctx.createLinearGradient(0, gy - 14, 0, gy + 14);
            gl.addColorStop(0, 'rgba(255,255,255,0)');
            gl.addColorStop(0.5, 'rgba(235,242,255,0.30)');
            gl.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gl;
            ctx.fillRect(0, gy - 14, 512, 28);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._flughafenDuererMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._flughafenDuererMat;
    }

    getFlughafenDuererTextMat() {
        if (this._flughafenDuererTextMat) return this._flughafenDuererTextMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#14247d';
        ctx.fillRect(0, 0, 512, 512);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f2f4fa';
        ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
        ctx.fillText('Albrecht Dürer (1471 - 1528)', 48, 78);

        ctx.font = '17px "Segoe UI", Arial, sans-serif';
        const de = [
            'Das wohl berühmteste Selbstbildnis',
            'der europäischen Kunstgeschichte ist in',
            'vieler Hinsicht noch immer ein ungelöstes',
            'Rätsel. Zum eigentlichen Zweck dieses',
            'Meisterwerks der Feinmalerei gibt es nur',
            'Mutmaßungen.'
        ];
        de.forEach((line, i) => ctx.fillText(line, 48, 124 + i * 26));

        ctx.font = 'italic 17px Georgia, serif';
        const en = [
            'What is possibly the most famous self-',
            'portrait in European art history is still,',
            'in many ways, an unsolved mystery.',
            'The actual purpose of this masterpiece',
            'remains a matter of speculation.'
        ];
        en.forEach((line, i) => ctx.fillText(line, 48, 306 + i * 26));

        // Logo unten: Kreis-N + zweizeiliger Schriftzug
        ctx.strokeStyle = '#f2f4fa';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(72, 460, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
        ctx.fillText('N', 64, 469);
        ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
        ctx.fillText('ALBRECHT DÜRER', 108, 454);
        ctx.fillText('AIRPORT NÜRNBERG', 108, 476);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._flughafenDuererTextMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._flughafenDuererTextMat;
    }

    getFlughafenCeilingMat() {
        if (this._flughafenCeilingMat) return this._flughafenCeilingMat;
        // Stahl-Rippendecke wie auf den Fotos: dicht liegende schmale Rippen
        // QUER zur Fahrtrichtung, dazwischen dunkle Schattenfugen, plus eine
        // Längsträgerlinie. Auf der Decken-Oberseite läuft U (Canvas-x) quer
        // zur Fahrtrichtung und V (Canvas-y) längs — die Rippen sind daher
        // horizontale Bänder im Canvas. Kachel = 1.2 m.
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Dunkler Fugengrund
        ctx.fillStyle = '#4b4f52';
        ctx.fillRect(0, 0, 256, 256);

        // Querrippen alle 0.3 m (64 px): helle Blechunterseite mit
        // Lichtkante oben und Schattenkante unten
        for (let y = 0; y < 256; y += 64) {
            const g = ctx.createLinearGradient(0, y + 6, 0, y + 50);
            g.addColorStop(0, '#94989c');
            g.addColorStop(0.5, '#7e8286');
            g.addColorStop(1, '#65696c');
            ctx.fillStyle = g;
            ctx.fillRect(0, y + 6, 256, 44);
            ctx.fillStyle = '#a8acb0';
            ctx.fillRect(0, y + 6, 256, 3);
            ctx.fillStyle = '#3a3e41';
            ctx.fillRect(0, y + 50, 256, 3);
        }

        // Längsträgerlinie alle 1.2 m (Kachelbreite)
        ctx.fillStyle = '#5b5f62';
        ctx.fillRect(0, 0, 7, 256);
        ctx.fillStyle = '#83878b';
        ctx.fillRect(7, 0, 3, 256);

        // Feine Blechkörnung
        let seed = 5;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(60,64,67,0.18)' : 'rgba(180,184,188,0.12)';
            ctx.fillRect(rand() * 256, rand() * 256, 1.5, 1.5);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        this._flughafenCeilingMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        return this._flughafenCeilingMat;
    }

    getFlughafenSkylightMat() {
        if (this._flughafenSkylightMat) return this._flughafenSkylightMat;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        // Helle Glasflächen, nach oben leicht heller (Tageslicht)
        const bg = ctx.createLinearGradient(0, 256, 0, 0);
        bg.addColorStop(0, '#d3dfe8');
        bg.addColorStop(1, '#e9f1f6');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 256, 256);
        // Weiße Pfosten-/Riegel-Sprossen mit Schattenkante
        for (let x = 0; x < 256; x += 64) {
            ctx.fillStyle = '#b9c6ce';
            ctx.fillRect(x, 0, 2, 256);
            ctx.fillStyle = '#f6fafc';
            ctx.fillRect(x + 2, 0, 6, 256);
        }
        for (let y = 0; y < 256; y += 64) {
            ctx.fillStyle = '#b9c6ce';
            ctx.fillRect(0, y, 256, 2);
            ctx.fillStyle = '#f6fafc';
            ctx.fillRect(0, y + 2, 256, 6);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        // MeshBasic: die Atrium-Verglasung leuchtet selbst (Tageslicht)
        this._flughafenSkylightMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
        return this._flughafenSkylightMat;
    }

    // ---- Maxfeld (U3): Lamellenwand, Zitattafeln, Namensschild, Goethe ----
    getMaxfeldLamellenMat() {
        if (this._maxfeldLamellenMat) return this._maxfeldLamellenMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;   // Kachel = 2 m Wandlänge
        canvas.height = 640;  // Wandhöhe -0.38 .. 4.66 m (~127 px/m)
        const ctx = canvas.getContext('2d');

        // Granitsockel: unterste ~0.9 m hell gesprenkelt
        const graniteH = 114;
        ctx.fillStyle = '#b9b5ad';
        ctx.fillRect(0, 640 - graniteH, 512, graniteH);
        let seed = 9;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 2600; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(90,86,80,0.35)' : 'rgba(240,238,232,0.35)';
            ctx.fillRect(rand() * 512, 640 - graniteH + rand() * graniteH, 1.6, 1.6);
        }
        ctx.fillStyle = '#8f8b83'; // Fuge über dem Sockel
        ctx.fillRect(0, 640 - graniteH, 512, 4);

        // Horizontale Edelstahl-Lamellen (~0.42 m Zyklus): Panel mit
        // Vertikalverlauf, oben helle Stahlschiene, darunter Schattenfuge
        const cycle = 53;
        for (let y = 0; y < 640 - graniteH; y += cycle) {
            ctx.fillStyle = '#dfe2e5';                 // Stahlschiene
            ctx.fillRect(0, y, 512, 3);
            ctx.fillStyle = '#4e5254';                 // Schattenfuge
            ctx.fillRect(0, y + 3, 512, 5);
            const g = ctx.createLinearGradient(0, y + 8, 0, y + cycle);
            g.addColorStop(0, '#c6c9cc');
            g.addColorStop(0.55, '#aeb1b4');
            g.addColorStop(1, '#8f9296');
            ctx.fillStyle = g;
            ctx.fillRect(0, y + 8, 512, cycle - 8);
        }
        // Dezente vertikale Stoßfuge pro Kachel
        ctx.fillStyle = 'rgba(70,74,76,0.45)';
        ctx.fillRect(0, 0, 2, 640 - graniteH);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        this._maxfeldLamellenMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._maxfeldLamellenMat;
    }

    getMaxfeldQuoteMat(variant) {
        this._maxfeldQuoteMats = this._maxfeldQuoteMats || {};
        if (this._maxfeldQuoteMats[variant]) return this._maxfeldQuoteMats[variant];
        const canvas = document.createElement('canvas');
        canvas.width = 512;   // Tafelstapel 1.6 x 2.6 m, Zwischenräume transparent
        canvas.height = 832;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 512, 832);

        // Goethe-Zitate wie an der echten Station (gemeinfrei)
        const stacks = [
            [
                ['Mit Kleinen tut man kleine Taten,', 'mit Großen wird der Kleine groß.'],
                ['Die Vernunft hat nur über das', 'Lebendige Herrschaft.'],
                ["Wenn ihr's nicht fühlt,", "ihr werdet's nicht erjagen."],
                ['Nur der verdient sich Freiheit,', 'der sie täglich neu erobern muss.'],
                ['Wer sich der Einsamkeit ergibt,', 'ach, der ist bald allein.']
            ],
            [
                ['Glücklich allein ist die Seele,', 'die liebt.'],
                ['Es gibt eine Höflichkeit des Herzens;', 'sie ist der Liebe verwandt.', 'Aus ihr entspringt die bequemste', 'Höflichkeit des äußeren Betragens.'],
                ['Gebraucht der Zeit, sie geht so', 'schnell von hinnen, doch Ordnung', 'lehrt euch Zeit gewinnen.']
            ]
        ];
        const plates = stacks[variant % stacks.length];
        const gap = 34;
        const totalGap = gap * (plates.length - 1);
        const plateH = Math.floor((832 - totalGap) / plates.length);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        plates.forEach((lines, i) => {
            const y0 = i * (plateH + gap);
            ctx.fillStyle = '#f2f1ec';
            ctx.fillRect(0, y0, 512, plateH);
            ctx.strokeStyle = '#c9c8c2';
            ctx.lineWidth = 3;
            ctx.strokeRect(1.5, y0 + 1.5, 509, plateH - 3);
            ctx.fillStyle = '#4a4c4e';
            ctx.font = '21px Georgia, "Times New Roman", serif';
            const lineH = 30;
            const textY0 = y0 + plateH / 2 - (lines.length - 1) * lineH / 2;
            lines.forEach((line, li) => {
                // Leicht gestaffelte Einzüge wie auf den Fotos
                ctx.fillText(line, 30 + li * 14, textY0 + li * lineH);
            });
        });

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._maxfeldQuoteMats[variant] = new THREE.MeshLambertMaterial({ map: tex, transparent: true });
        return this._maxfeldQuoteMats[variant];
    }

    getMaxfeldNameMat() {
        if (this._maxfeldNameMat) return this._maxfeldNameMat;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;  // Schild 3.0 x 0.45 m
        canvas.height = 154;
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 0, 154);
        g.addColorStop(0, '#dcdfe2');
        g.addColorStop(0.5, '#c2c6c9');
        g.addColorStop(1, '#a8adb1');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1024, 154);
        ctx.strokeStyle = '#84888c';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 1018, 148);
        // Gelbgrüne, gesperrte Lettern wie am Original
        const label = 'MAXFELD';
        ctx.font = 'bold 78px "Segoe UI", Arial, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const track = 96;
        const x0 = 512 - ((label.length - 1) * track) / 2;
        ctx.fillStyle = '#b5c520';
        for (let i = 0; i < label.length; i++) {
            ctx.fillText(label[i], x0 + i * track, 84);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._maxfeldNameMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._maxfeldNameMat;
    }

    getMaxfeldGoetheMat() {
        if (this._maxfeldGoetheMat) return this._maxfeldGoetheMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;   // Tafel 1.3 x 2.6 m: oben Porträt, unten Infotafel
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // --- Porträt (stilisiert nach dem Stieler-Gemälde) ---
        const pH = 600;
        const bg = ctx.createLinearGradient(0, 0, 0, pH);
        bg.addColorStop(0, '#3a3733');
        bg.addColorStop(1, '#57534c');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 512, pH);
        // Dunkler Rock/Mantel
        ctx.fillStyle = '#2e2c29';
        ctx.beginPath();
        ctx.moveTo(40, pH);
        ctx.quadraticCurveTo(120, 330, 256, 320);
        ctx.quadraticCurveTo(392, 330, 472, pH);
        ctx.closePath();
        ctx.fill();
        // Weißes Hemd/Kragen
        ctx.fillStyle = '#e8e4da';
        ctx.beginPath();
        ctx.moveTo(216, 330);
        ctx.lineTo(296, 330);
        ctx.lineTo(276, 420);
        ctx.lineTo(236, 420);
        ctx.closePath();
        ctx.fill();
        // Gesicht
        ctx.fillStyle = '#d9b894';
        ctx.beginPath();
        ctx.ellipse(256, 235, 78, 96, 0, 0, Math.PI * 2);
        ctx.fill();
        // Graues Haar seitlich und oben
        ctx.fillStyle = '#b8b4ac';
        ctx.beginPath();
        ctx.ellipse(256, 165, 88, 52, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(176, 230, 22, 58, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(336, 230, 22, 58, -0.2, 0, Math.PI * 2);
        ctx.fill();
        // Züge: Brauen, Augen, Nase, Mund — sparsam
        ctx.strokeStyle = '#6b5138';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(214, 214); ctx.quadraticCurveTo(232, 206, 250, 214); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(262, 214); ctx.quadraticCurveTo(280, 206, 298, 214); ctx.stroke();
        ctx.fillStyle = '#3f3226';
        ctx.beginPath(); ctx.ellipse(231, 228, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(281, 228, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#b08a62';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(256, 232); ctx.lineTo(252, 272); ctx.quadraticCurveTo(256, 278, 262, 273); ctx.stroke();
        ctx.strokeStyle = '#8a5f45';
        ctx.beginPath(); ctx.moveTo(234, 298); ctx.quadraticCurveTo(256, 306, 278, 298); ctx.stroke();
        // Brief in der Hand (unten links)
        ctx.fillStyle = '#efece2';
        ctx.save();
        ctx.translate(150, 520);
        ctx.rotate(-0.25);
        ctx.fillRect(-45, -60, 90, 120);
        ctx.restore();

        // --- Infotafel unten ---
        ctx.fillStyle = '#f2f0ea';
        ctx.fillRect(0, pH, 512, 1024 - pH);
        ctx.fillStyle = '#3d3f41';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 24px Georgia, "Times New Roman", serif';
        ctx.fillText('Johann Wolfgang v. Goethe', 36, pH + 46);
        ctx.fillText('1749 – 1832', 36, pH + 78);
        ctx.font = '21px Georgia, "Times New Roman", serif';
        const info = [
            'weilte in Nürnberg im Juni 1788,',
            'März 1790, vom 6. – 15. November 1797',
            '',
            '... "Die Stadt bietet mancherlei',
            'Interessantes an, alte Kunstwerke,',
            'mechanische Arbeiten, so wie sich',
            'auch über politische Verhältnisse',
            'manche Betrachtungen machen',
            'lassen." ...'
        ];
        info.forEach((line, i) => ctx.fillText(line, 36, pH + 122 + i * 31));

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._maxfeldGoetheMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._maxfeldGoetheMat;
    }

    // ---- Rennweg (U2): Waschbeton, Graffiti-Felder, Weltall-Ovale ----
    getRennwegAggregateMat() {
        if (this._rennwegAggregateMat) return this._rennwegAggregateMat;
        const canvas = document.createElement('canvas');
        canvas.width = 256;   // Kachel = 3 m
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#4a4643';
        ctx.fillRect(0, 0, 256, 256);
        let seed = 13;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        // Grobe Zuschlagskörner in mehreren Grautönen
        const stones = ['#6b665f', '#332f2c', '#7d786f', '#57534d', '#8a847a'];
        for (let i = 0; i < 2400; i++) {
            ctx.fillStyle = stones[Math.floor(rand() * stones.length)];
            const r = 1 + rand() * 2.4;
            ctx.beginPath();
            ctx.arc(rand() * 256, rand() * 256, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        this._rennwegAggregateMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        return this._rennwegAggregateMat;
    }

    getRennwegGraffitiMat(variant) {
        this._rennwegGraffitiMats = this._rennwegGraffitiMats || {};
        if (this._rennwegGraffitiMats[variant]) return this._rennwegGraffitiMats[variant];
        const W = 1536, H = 400; // Feld 12 x 3.1 m
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        let seed = 21 + variant * 7;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        const rounded = (x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        };

        // Gelber Rahmen mit abgerundeten Ecken, außen transparent
        rounded(6, 6, W - 12, H - 12, 90);
        ctx.fillStyle = '#e3c31f';
        ctx.fill();
        rounded(32, 32, W - 64, H - 64, 68);
        ctx.save();
        ctx.clip();

        // Hintergrund: Himmel-Verlauf
        const bg = ctx.createLinearGradient(0, 32, 0, H - 32);
        if (variant === 0) {
            bg.addColorStop(0, '#f2a9c4');
            bg.addColorStop(0.45, '#6fc8dd');
            bg.addColorStop(1, '#3a5fa8');
        } else {
            bg.addColorStop(0, '#bfe3f2');
            bg.addColorStop(0.5, '#7a8fd0');
            bg.addColorStop(1, '#4a3f8f');
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Skyline: blaugrüne Türme mit weißen Kanten
        for (let i = 0; i < 7; i++) {
            const tw = 70 + rand() * 90;
            const th = 120 + rand() * 170;
            const tx = 40 + rand() * (W - 160);
            ctx.fillStyle = rand() < 0.5 ? '#2f7f8f' : '#3fae74';
            ctx.fillRect(tx, H - 40 - th, tw, th);
            ctx.fillStyle = '#eef4f6';
            ctx.fillRect(tx, H - 40 - th, 10, th);
            ctx.fillRect(tx, H - 40 - th, tw, 8);
        }

        // Weißer Zug mit roter Bauchbinde und Fenstern
        const trainY = H - 175, trainW = 460, trainX = variant === 0 ? W * 0.42 : W * 0.15;
        ctx.fillStyle = '#f0f0ee';
        rounded(trainX, trainY, trainW, 95, 26);
        ctx.fill();
        ctx.fillStyle = '#c22a2a';
        ctx.fillRect(trainX + 6, trainY + 62, trainW - 12, 14);
        ctx.fillStyle = '#20303c';
        for (let wx = trainX + 26; wx < trainX + trainW - 40; wx += 58) {
            ctx.fillRect(wx, trainY + 16, 38, 30);
        }

        // Graffiti-Buchstaben mit Don Graffiti Font (aus assets/ CSS geladen)
        const word = variant === 0 ? 'RENNWEG' : 'NÜRNBERG';
        ctx.font = '160px "Don Graffiti", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const wx0 = W / 2, wy0 = variant === 0 ? 130 : 210;
        ctx.save();
        ctx.rotate(-0.03);
        ctx.fillStyle = 'rgba(40,20,60,0.55)';
        ctx.fillText(word, wx0 + 10, wy0 + 12);
        ctx.strokeStyle = '#2a1a3a';
        ctx.lineWidth = 16;
        ctx.strokeText(word, wx0, wy0);
        const wordGrad = ctx.createLinearGradient(0, wy0 - 70, 0, wy0 + 70);
        if (variant === 0) {
            wordGrad.addColorStop(0, '#f2d24a');
            wordGrad.addColorStop(1, '#d97a2a');
        } else {
            wordGrad.addColorStop(0, '#f2f2f0');
            wordGrad.addColorStop(1, '#b8c4d8');
        }
        ctx.fillStyle = wordGrad;
        ctx.fillText(word, wx0, wy0);
        ctx.restore();

        // Explosionsstern + Farbblasen
        const star = (cx2, cy2, rOut, rIn, n, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < n * 2; i++) {
                const rr = (i % 2 === 0) ? rOut : rIn;
                const a = i * Math.PI / n;
                ctx.lineTo(cx2 + rr * Math.cos(a), cy2 + rr * Math.sin(a));
            }
            ctx.closePath();
            ctx.fill();
        };
        star(140 + rand() * 100, H - 130, 58, 24, 9, '#e33420');
        star(140 + rand() * 100, H - 130, 30, 12, 9, '#f2d24a');
        for (let i = 0; i < 14; i++) {
            ctx.fillStyle = `hsla(${Math.floor(rand() * 360)}, 70%, 65%, 0.5)`;
            ctx.beginPath();
            ctx.arc(rand() * W, 40 + rand() * 90, 10 + rand() * 22, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._rennwegGraffitiMats[variant] = new THREE.MeshLambertMaterial({ map: tex, transparent: true });
        return this._rennwegGraffitiMats[variant];
    }

    getRennwegCosmicMat() {
        if (this._rennwegCosmicMat) return this._rennwegCosmicMat;
        const W = 1152, H = 704; // Oval 9 x 5.5 m
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);

        // Gelber Ovalrand
        ctx.fillStyle = '#e3c31f';
        ctx.beginPath();
        ctx.ellipse(W / 2, H / 2, W / 2 - 4, H / 2 - 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(W / 2, H / 2, W / 2 - 34, H / 2 - 34, 0, 0, Math.PI * 2);
        ctx.clip();

        // Tiefes Weltall
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#101c50');
        bg.addColorStop(0.55, '#25145e');
        bg.addColorStop(1, '#0c1030');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Orange-rosa Nebel auf einer Seite (Foto 4)
        const neb = ctx.createRadialGradient(W * 0.78, H * 0.45, 30, W * 0.78, H * 0.45, 300);
        neb.addColorStop(0, 'rgba(240,170,60,0.95)');
        neb.addColorStop(0.5, 'rgba(220,90,110,0.6)');
        neb.addColorStop(1, 'rgba(220,90,110,0)');
        ctx.fillStyle = neb;
        ctx.fillRect(0, 0, W, H);

        // Spiralgalaxie
        let seed = 33;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        const gx = W * 0.3, gy = H * 0.42;
        ctx.strokeStyle = 'rgba(235,240,255,0.8)';
        for (let arm = 0; arm < 2; arm++) {
            ctx.beginPath();
            for (let t = 0; t < 2.6; t += 0.05) {
                const rr = 12 + t * 46;
                const a = t * 2.2 + arm * Math.PI;
                const px2 = gx + rr * Math.cos(a), py2 = gy + rr * Math.sin(a) * 0.55;
                if (t === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
            }
            ctx.lineWidth = 10;
            ctx.stroke();
        }
        ctx.fillStyle = '#f6f8ff';
        ctx.beginPath();
        ctx.ellipse(gx, gy, 24, 14, 0, 0, Math.PI * 2);
        ctx.fill();

        // Planeten
        const planet = (px2, py2, r, c1, c2) => {
            const g = ctx.createRadialGradient(px2 - r / 3, py2 - r / 3, r / 5, px2, py2, r);
            g.addColorStop(0, c1);
            g.addColorStop(1, c2);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px2, py2, r, 0, Math.PI * 2);
            ctx.fill();
        };
        planet(W * 0.55, H * 0.7, 44, '#e0995a', '#7a4420');
        planet(W * 0.68, H * 0.25, 26, '#c05a3a', '#5e2414');
        planet(W * 0.42, H * 0.2, 18, '#9ab8d8', '#3a5878');

        // Sterne
        for (let i = 0; i < 240; i++) {
            ctx.fillStyle = `rgba(255,255,255,${(0.3 + rand() * 0.7).toFixed(2)})`;
            const r = rand() < 0.9 ? 1.4 : 2.6;
            ctx.fillRect(rand() * W, rand() * H, r, r);
        }
        ctx.restore();

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._rennwegCosmicMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
        return this._rennwegCosmicMat;
    }

    getRennwegNameMat() {
        if (this._rennwegNameMat) return this._rennwegNameMat;
        const canvas = document.createElement('canvas');
        canvas.width = 768;   // Kachel = 3 m, Band 0.25 m hoch
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#6f2233';
        ctx.fillRect(0, 0, 768, 64);
        ctx.fillStyle = '#e8e4de';
        ctx.font = '30px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Gesperrte Lettern wie am Original
        const label = 'RENNWEG';
        const track = 34;
        const x0 = 384 - ((label.length - 1) * track) / 2;
        for (let i = 0; i < label.length; i++) {
            ctx.fillText(label[i], x0 + i * track, 34);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._rennwegNameMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._rennwegNameMat;
    }

    // ---- Nordwestring (U3): Paneelwand, Leuchtschild, Spiegel-Zickzack ----
    getNordwestringWallMat(accentColor) {
        this._nordwestringWallMats = this._nordwestringWallMats || {};
        if (this._nordwestringWallMats[accentColor]) return this._nordwestringWallMats[accentColor];
        const canvas = document.createElement('canvas');
        canvas.width = 640;   // Kachel = 2.5 m Wandlänge
        canvas.height = 656;  // Wandhöhe -0.38 .. 4.76 m (~127 px/m)
        const ctx = canvas.getContext('2d');

        // Heller Sichtbeton mit feiner Körnung
        ctx.fillStyle = '#c6c4be';
        ctx.fillRect(0, 0, 640, 656);
        let seed = 17;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 2200; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(120,118,112,0.14)' : 'rgba(238,236,230,0.14)';
            ctx.fillRect(rand() * 640, rand() * 656, 1.6, 1.6);
        }
        // Vertikale Paneelfugen alle 0.625 m
        ctx.fillStyle = '#9c9a94';
        for (let x = 0; x < 640; x += 160) ctx.fillRect(x, 0, 3, 656);
        // Ein vertikaler Farbstreifen pro Kachel (alle 2.5 m)
        ctx.fillStyle = accentColor;
        ctx.fillRect(76, 32, 11, 656 - 32 - 42);
        // Dunkles Kopfband oben und Sockelband unten
        ctx.fillStyle = '#333537';
        ctx.fillRect(0, 0, 640, 32);
        ctx.fillStyle = '#3b3d3f';
        ctx.fillRect(0, 656 - 42, 640, 42);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        this._nordwestringWallMats[accentColor] = new THREE.MeshLambertMaterial({ map: tex });
        return this._nordwestringWallMats[accentColor];
    }

    getNordwestringSignMat() {
        if (this._nordwestringSignMat) return this._nordwestringSignMat;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;  // Leuchtschild 2.2 x 0.45 m
        canvas.height = 210;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f4f4f0';
        ctx.fillRect(0, 0, 1024, 210);
        ctx.strokeStyle = '#c9c9c3';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 1018, 204);
        // Dunkelblaue, leicht gesperrte Lettern wie am Original
        const label = 'NORDWESTRING';
        ctx.font = 'bold 74px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#232a3a';
        const track = 66;
        const x0 = 512 - ((label.length - 1) * track) / 2;
        for (let i = 0; i < label.length; i++) {
            ctx.fillText(label[i], x0 + i * track, 112);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        // Leuchtkasten: MeshBasic, damit das Schild selbst hell wirkt
        this._nordwestringSignMat = new THREE.MeshBasicMaterial({ map: tex });
        return this._nordwestringSignMat;
    }

    getNordwestringMirrorMat() {
        if (this._nordwestringMirrorMat) return this._nordwestringMirrorMat;
        // Pseudo-Spiegelung: verschwommene vertikale Schlieren in den Farben des
        // Bahnsteigs darunter (beiger Boden, graue Wände, dunkle Silhouetten) —
        // U läuft quer über den Spiegelstreifen, die Schlieren variieren also
        // über die Breite. Der Glanz kommt vom Phong-Highlight auf den Facetten.
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#b4ad9e';
        ctx.fillRect(0, 0, 256, 256);
        let seed = 27;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        const smear = ['#6b675e', '#8c867a', '#3a3c40', '#d9d4c8', '#54617a', '#7a4a3a', '#9aa0a8'];
        for (let i = 0; i < 46; i++) {
            const x = rand() * 256;
            const w = 4 + rand() * 20;
            const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
            const c = smear[Math.floor(rand() * smear.length)];
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.5, c);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.22 + rand() * 0.2;
            ctx.fillStyle = g;
            ctx.fillRect(x - w, 0, w * 2, 256);
        }
        ctx.globalAlpha = 1;
        // Dunklere Ränder (dort spiegeln sich die Gleiströge/Wände)
        for (const [x0, x1] of [[0, 34], [222, 256]]) {
            const g = ctx.createLinearGradient(x0, 0, x1, 0);
            g.addColorStop(x0 === 0 ? 1 : 0, 'rgba(40,42,46,0)');
            g.addColorStop(x0 === 0 ? 0 : 1, 'rgba(40,42,46,0.55)');
            ctx.fillStyle = g;
            ctx.fillRect(x0, 0, x1 - x0, 256);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        this._nordwestringMirrorMat = new THREE.MeshPhongMaterial({
            map: tex,
            shininess: 90,
            specular: 0x9aa2aa,
            side: THREE.DoubleSide
        });
        return this._nordwestringMirrorMat;
    }

    // ---- Friedrich-Ebert-Platz (U3): Flechtwerk-Wand, Namenstafel ----
    getFriedrichEbertWallMat() {
        if (this._friedrichEbertWallMat) return this._friedrichEbertWallMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;   // Kachel = 2.4 m Wandlänge
        canvas.height = 646;  // Wandhöhe -0.38 .. 4.66 m (~128 px/m)
        const ctx = canvas.getContext('2d');

        // Heller Sichtbeton mit feiner Körnung
        ctx.fillStyle = '#c6c3bc';
        ctx.fillRect(0, 0, 512, 646);
        let seed = 19;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 2200; i++) {
            ctx.fillStyle = rand() < 0.5 ? 'rgba(122,120,114,0.14)' : 'rgba(240,238,232,0.14)';
            ctx.fillRect(rand() * 512, rand() * 646, 1.6, 1.6);
        }

        // Flechtwerk-Band (1.0 .. 3.6 m über Bahnsteig): Korbgeflecht aus
        // orangen Keramikriegeln, im Schachbrett abwechselnd liegend/stehend,
        // mit Schlagschatten fürs Relief. Canvas-Oberkante = Wandoberkante,
        // Band also von y = (4.66-3.6)*128 bis (4.66-1.0)*128.
        const bandTop = Math.round((4.66 - 3.6) * 128);   // ~136
        const bandBot = Math.round((4.66 - 1.0) * 128);   // ~469
        const cell = 64; // 0.3 m Raster, 8 Zellen pro Kachel
        for (let gy = bandTop; gy + cell <= bandBot + 1; gy += cell) {
            for (let gx = 0; gx < 512; gx += cell) {
                const horizontal = (((gx / cell) + ((gy - bandTop) / cell)) % 2) === 0;
                const bw = horizontal ? 46 : 22;
                const bh = horizontal ? 22 : 46;
                const bx = gx + (cell - bw) / 2;
                const by = gy + (cell - bh) / 2;
                // Schlagschatten (Relief)
                ctx.fillStyle = 'rgba(60,45,30,0.35)';
                ctx.fillRect(bx + 4, by + 5, bw, bh);
                // Riegel mit leichter Farbvariation + heller Oberkante
                const l = 48 + rand() * 8;
                ctx.fillStyle = `hsl(24, 72%, ${Math.round(l)}%)`;
                ctx.fillRect(bx, by, bw, bh);
                ctx.fillStyle = 'rgba(255,220,170,0.45)';
                ctx.fillRect(bx, by, bw, 3);
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        this._friedrichEbertWallMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._friedrichEbertWallMat;
    }

    getFriedrichEbertSignMat() {
        if (this._friedrichEbertSignMat) return this._friedrichEbertSignMat;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;  // Tafel 2.6 x 0.4 m
        canvas.height = 158;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#d97829';
        ctx.fillRect(0, 0, 1024, 158);
        ctx.strokeStyle = '#b45f1c';
        ctx.lineWidth = 5;
        ctx.strokeRect(2.5, 2.5, 1019, 153);
        const label = 'FRIEDRICH-EBERT-PLATZ';
        ctx.font = 'bold 56px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f6f2ea';
        const track = 42;
        const x0 = 512 - ((label.length - 1) * track) / 2;
        for (let i = 0; i < label.length; i++) {
            ctx.fillText(label[i], x0 + i * track, 84);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._friedrichEbertSignMat = new THREE.MeshLambertMaterial({ map: tex });
        return this._friedrichEbertSignMat;
    }

    getFriedrichEbertCeilingMat() {
        if (this._friedrichEbertCeilMat) return this._friedrichEbertCeilMat;
        // Satt orange gestrichene Betondecke (Fotos) mit leichter Wolkigkeit
        // aus der Anstrichstruktur, keine Fototextur nötig.
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#d9772a';
        ctx.fillRect(0, 0, 256, 256);
        let seed = 41;
        const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 40; i++) {
            const x = rand() * 256, y = rand() * 256, r = 20 + rand() * 50;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, rand() < 0.5 ? 'rgba(180,110,40,0.18)' : 'rgba(240,180,110,0.16)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        this._friedrichEbertCeilMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        return this._friedrichEbertCeilMat;
    }

    /**
     * Clones a material and bakes a round-column lighting gradient into its
     * texture, leaving the original material completely unmodified.
     *
     * The gradient simulates the way a cylindrical surface catches light:
     * the two flat-facing sides (UV 0.25 / 0.75) are bright, the flanks
     * (UV 0 / 0.5 / 1.0) are shadowed. Identical colour stops to the
     * Plärrer column texture in TrackManager.createColumnTexture.
     *
     * Works for both canvas-backed and flat-colour materials.
     */
    _makeCylinderPillarMat(sourceMat) {
        // ---- build the gradient canvas ----------------------------------------
        const srcCanvas = sourceMat.map && sourceMat.map.image instanceof HTMLCanvasElement
            ? sourceMat.map.image : null;

        const W = srcCanvas ? srcCanvas.width  : 512;
        const H = srcCanvas ? srcCanvas.height : 64;

        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        if (srcCanvas) {
            // Copy the source canvas (tile / stone / pebble-dash texture)
            ctx.drawImage(srcCanvas, 0, 0, W, H);
        } else {
            // Flat-colour material — fill with the material colour
            const col = sourceMat.color
                ? '#' + sourceMat.color.getHexString()
                : '#8a9496';
            ctx.fillStyle = col;
            ctx.fillRect(0, 0, W, H);
        }

        // Multiply-blend the cylindrical lighting gradient
        ctx.globalCompositeOperation = 'multiply';
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0,    '#7A7975'); // flank (dark)
        grad.addColorStop(0.36, '#7A7975');
        grad.addColorStop(0.50, '#F4F2FB'); // face (bright)
        grad.addColorStop(0.64, '#7A7975');
        grad.addColorStop(1,    '#7A7975');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // ---- build the new material -------------------------------------------
        const newMat = sourceMat.clone();

        const newTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
        newTex.wrapS = sourceMat.map ? sourceMat.map.wrapS : THREE.RepeatWrapping;
        newTex.wrapT = sourceMat.map ? sourceMat.map.wrapT : THREE.ClampToEdgeWrapping;
        if (sourceMat.map) {
            newTex.repeat.copy(sourceMat.map.repeat);
            newTex.offset.copy(sourceMat.map.offset);
        }
        // Force horizontal repeat to 2 so the single reflection becomes two (front and back)
        newTex.repeat.x = 2;
        newTex.colorSpace = THREE.SRGBColorSpace;

        newMat.map = newTex;
        return newMat;
    }

    createTiledMaterial(tileColor, groutColor, roughness = 0.15) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = groutColor;
        ctx.fillRect(0, 0, 128, 128);
        
        ctx.fillStyle = tileColor;
        const cols = 8;
        const rows = 8;
        const w = 128 / cols;
        const h = 128 / rows;
        const border = 1;
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.fillRect(c * w + border, r * h + border, w - border * 2, h - border * 2);
            }
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 128;
        bumpCanvas.height = 128;
        const bCtx = bumpCanvas.getContext('2d');
        
        bCtx.fillStyle = '#000000';
        bCtx.fillRect(0, 0, 128, 128);
        
        bCtx.fillStyle = '#ffffff';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                bCtx.fillRect(c * w + border, r * h + border, w - border * 2, h - border * 2);
            }
        }
        
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.015,
            emissive: new THREE.Color(tileColor).multiplyScalar(0.25)
        });
    }

    createPebbleDashMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#a1a1aa'; // zinc grey base
        ctx.fillRect(0, 0, 256, 256);
        
        const numPebbles = 2000;
        for (let i = 0; i < numPebbles; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1.0 + Math.random() * 2.5;
            
            const rand = Math.random();
            if (rand < 0.45) {
                ctx.fillStyle = '#71717a'; // dark zinc grey
            } else if (rand < 0.8) {
                ctx.fillStyle = '#f4f4f5'; // light grey/white
            } else if (rand < 0.95) {
                ctx.fillStyle = '#d4d4d8'; // medium-light grey
            } else {
                ctx.fillStyle = '#b45309'; // brownish pebbles
            }
            
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 4);
        texture.colorSpace = THREE.SRGBColorSpace;
        
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 256;
        bumpCanvas.height = 256;
        const bCtx = bumpCanvas.getContext('2d');
        
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, 256, 256);
        
        for (let i = 0; i < numPebbles; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1.0 + Math.random() * 2.5;
            bCtx.fillStyle = Math.random() > 0.5 ? '#c0c0c0' : '#404040';
            bCtx.beginPath();
            bCtx.arc(x, y, size, 0, 2 * Math.PI);
            bCtx.fill();
        }
        
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        bumpTexture.repeat.set(2, 4);
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.025
        });
    }

    createSandstoneMaterial() {
        // Coursed ashlar sandstone: irregular-height horizontal courses (20-40cm real-world),
        // each built from blocks in varying beige tones, with the joints offset row-to-row like
        // real masonry (running bond). Cheap to generate — only flat fillRect calls, no
        // per-pixel loops, no bump map. The canvas represents a fixed WORLD_W x WORLD_H metre
        // patch of wall (stored in texture.userData so callers can size their own tiling
        // density instead of guessing); it then repeats via wrapping.
        const WORLD_W = 2.4, WORLD_H = 1.2;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const pxPerMX = canvas.width / WORLD_W;
        const pxPerMY = canvas.height / WORLD_H;
        const joint = 2; // grout line thickness in px, shows through as the gap between blocks

        // Grout base (shows through in the gaps left between blocks below)
        ctx.fillStyle = '#5c4d3a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tones = ['#d8c1a0', '#e2ccac', '#cdb187', '#e7d5ba', '#d4b98f', '#ddc9a5', '#c9ab7e'];
        let y = 0, row = 0;
        while (y < canvas.height) {
            const courseM = 0.20 + Math.random() * 0.20; // 20-40cm course height
            let h = Math.round(courseM * pxPerMY);
            if (y + h > canvas.height) h = canvas.height - y;
            const blockM = 0.5 + Math.random() * 0.35; // ~50-85cm block width
            const w = Math.max(16, Math.round(blockM * pxPerMX));
            const offset = (row % 2 === 0) ? 0 : -Math.round(w / 2); // running-bond offset
            for (let x = offset; x < canvas.width; x += w) {
                ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
                ctx.fillRect(x + joint, y + joint, w - joint * 2, Math.max(1, h - joint * 2));
            }
            y += h;
            row++;
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.userData = { worldW: WORLD_W, worldH: WORLD_H };

        return new THREE.MeshLambertMaterial({
            map: texture
        });
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
        texture.repeat.set(4, 4);
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
        bumpTexture.repeat.set(4, 4);
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.008
        });
    }

    createDepartureBoardMaterial(trackNumberLabel, row1, row2) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 264;
        const ctx = canvas.getContext('2d');

        // 1. Draw main casing face (light grey/silver)
        ctx.fillStyle = '#d2d7db';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw Left Screen (Departure Display)
        ctx.fillStyle = '#100d08'; // dark screen background
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(16, 16, 736, 232, 16);
        } else {
            ctx.rect(16, 16, 736, 232);
        }
        ctx.fill();

        // 3. Draw Right Screen (Info Display Screen)
        ctx.fillStyle = '#100d08';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(792, 16, 216, 232, 24);
        } else {
            ctx.rect(792, 16, 216, 232);
        }
        ctx.fill();

        // 4. Draw Info "i" Symbol on Right Screen
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 130px "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('i', 900, 126); // Draw lowercase 'i' centered

        // 5. Draw Track/Gleis info in Left Screen
        ctx.fillStyle = '#f4d96d'; // Yellow text
        ctx.textAlign = 'center';
        
        ctx.font = 'bold 24px "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.fillText('Gleis', 100, 70);
        
        ctx.font = 'bold 110px "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.fillText(trackNumberLabel, 100, 160);

        // Vertical divider on Left Screen
        ctx.strokeStyle = '#223344';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(190, 24);
        ctx.lineTo(190, 240);
        ctx.stroke();

        // 6. Draw Departures (Row 1 & Row 2)
        const destX = 300;
        const timeX = 660;
        const minX = 720;

        // Row 1
        // Line badge
        ctx.fillStyle = row1.color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(210, 36, 64, 32, 6);
        } else {
            ctx.rect(210, 36, 64, 32);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px "Geist", "Inter", sans-serif';
        ctx.fillText(row1.line, 242, 52);

        // Destination name
        ctx.fillStyle = '#f4d96d';
        ctx.textAlign = 'left';
        ctx.font = 'bold 28px "Geist", "Inter", sans-serif';
        ctx.fillText(row1.destination, destX, 50);

        // Subline
        ctx.fillStyle = '#88929a';
        ctx.font = '16px "Geist", "Inter", sans-serif';
        ctx.fillText(row1.via, destX, 82);

        // Minutes
        ctx.fillStyle = '#f4d96d';
        ctx.textAlign = 'right';
        ctx.font = 'bold 36px "Geist", sans-serif';
        ctx.fillText(row1.minutes, timeX, 50);
        
        ctx.textAlign = 'left';
        ctx.font = '14px sans-serif';
        ctx.fillText('Min.', minX, 50);

        // Row 2
        // Line badge
        ctx.fillStyle = row2.color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(210, 116, 64, 32, 6);
        } else {
            ctx.rect(210, 116, 64, 32);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px "Geist", "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(row2.line, 242, 132);

        // Destination name
        ctx.fillStyle = '#f4d96d';
        ctx.textAlign = 'left';
        ctx.font = 'bold 28px "Geist", "Inter", sans-serif';
        ctx.fillText(row2.destination, destX, 130);

        // Subline
        ctx.fillStyle = '#88929a';
        ctx.font = '16px "Geist", "Inter", sans-serif';
        ctx.fillText(row2.via, destX, 162);

        // Minutes
        ctx.fillStyle = '#f4d96d';
        ctx.textAlign = 'right';
        ctx.font = 'bold 36px "Geist", sans-serif';
        ctx.fillText(row2.minutes, timeX, 130);
        
        ctx.textAlign = 'left';
        ctx.font = '14px sans-serif';
        ctx.fillText('Min.', minX, 130);

        // 7. Bottom Ticker (yellow bar with black text)
        ctx.fillStyle = '#f4d96d';
        ctx.fillRect(206, 196, 524, 34);
        
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.font = 'bold 16px "Geist", "Inter", sans-serif';
        ctx.fillText('Aufgrund von Bauarbeiten kann es zu Einschränkungen kommen', 468, 219);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createBlankDepartureBoardMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 264;
        const ctx = canvas.getContext('2d');

        // 1. Draw main casing face (light grey/silver)
        ctx.fillStyle = '#d2d7db';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw Left Screen (Departure Display)
        ctx.fillStyle = '#100d08'; // dark screen background
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(16, 16, 736, 232, 16);
        } else {
            ctx.rect(16, 16, 736, 232);
        }
        ctx.fill();

        // 3. Draw Right Screen (Info Display Screen)
        ctx.fillStyle = '#100d08';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(792, 16, 216, 232, 24);
        } else {
            ctx.rect(792, 16, 216, 232);
        }
        ctx.fill();

        // 4. Draw Info "i" Symbol on Right Screen
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 130px "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('i', 900, 126);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createSubwayULogo() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Blue background
        ctx.fillStyle = '#0055a5';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // White border
        ctx.lineWidth = 14;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
        
        // White U in center
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 150px "Geist", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('U', canvas.width / 2, canvas.height / 2 + 10);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createTrashCanTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // Smooth background with a subtle dark grey fade
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, '#d1d5db');
        grad.addColorStop(1, '#9ca3af');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 512);
        
        // Draw the black trash icon (person throwing trash)
        ctx.fillStyle = '#2c3e50';
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const cx = 128;
        const cy = 150;
        
        // Head
        ctx.beginPath();
        ctx.arc(cx, cy - 25, 7, 0, Math.PI * 2);
        ctx.fill();
        
        // Torso
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18);
        ctx.lineTo(cx - 3, cy + 5);
        ctx.stroke();
        
        // Left Leg
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 5);
        ctx.lineTo(cx - 12, cy + 30);
        ctx.stroke();
        
        // Right Leg
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 4, cy + 30);
        ctx.stroke();
        
        // Left Arm (leaning back slightly)
        ctx.beginPath();
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx - 15, cy - 2);
        ctx.stroke();
        
        // Right Arm (throwing trash)
        ctx.beginPath();
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx + 12, cy - 14);
        ctx.lineTo(cx + 20, cy - 2);
        ctx.stroke();
        
        // Falling trash (small dot)
        ctx.beginPath();
        ctx.arc(cx + 24, cy + 5, 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Trash bin outline on the right
        ctx.beginPath();
        ctx.moveTo(cx + 22, cy + 12);
        ctx.lineTo(cx + 34, cy + 12);
        ctx.lineTo(cx + 31, cy + 32);
        ctx.lineTo(cx + 25, cy + 32);
        ctx.closePath();
        ctx.stroke();
        
        // Dot/Mesh pattern below the icon (embossed dots)
        for (let row = 0; row < 18; row++) {
            const y = 220 + row * 13;
            // Diamond pattern width
            const maxCols = 15 - Math.abs(row - 9); 
            const startX = 128 - (maxCols - 1) * 7;
            for (let col = 0; col < maxCols; col++) {
                const x = startX + col * 14;
                // Draw embossed dot: shadow + highlight
                ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.beginPath();
                ctx.arc(x + 1, y + 1, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    buildTrashCan() {
        const trashCanGroup = new THREE.Group();
        
        // 1. Create the main body shape (extruded)
        const shape = new THREE.Shape();
        shape.moveTo(-0.1, -0.25);
        shape.lineTo(0.1, -0.25);
        shape.quadraticCurveTo(0.2, 0.0, 0.1, 0.25);
        shape.lineTo(-0.1, 0.25);
        shape.quadraticCurveTo(-0.2, 0.0, -0.1, -0.25);
        
        // Add a hole in the shape so the body and rim are hollow inside
        const holePath = new THREE.Path();
        holePath.moveTo(-0.05, -0.12);
        holePath.lineTo(-0.05, 0.12);
        holePath.lineTo(0.05, 0.12);
        holePath.lineTo(0.05, -0.12);
        holePath.closePath();
        shape.holes.push(holePath);
        
        // Extrude body up to 0.95m
        const extrudeSettings = {
            depth: 0.95,
            bevelEnabled: false,
            curveSegments: 16
        };
        const bodyGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        bodyGeom.rotateX(-Math.PI / 2); // Make it stand vertically
        
        // Apply cylindrical UV projection for the body geometry
        const posAttr = bodyGeom.attributes.position;
        const uvAttr = bodyGeom.attributes.uv;
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);
            
            // Map U from Z-range [-0.25, 0.25] -> [0, 1]
            // Map V from Y-range [0, 0.95] -> [0, 1]
            let u = (z + 0.25) / 0.5;
            let v = y / 0.95;
            
            u = Math.max(0, Math.min(1, u));
            v = Math.max(0, Math.min(1, v));
            
            uvAttr.setXY(i, u, v);
        }
        uvAttr.needsUpdate = true;
        
        const bodyMesh = new THREE.Mesh(bodyGeom, this.materials.trashBody);
        trashCanGroup.add(bodyMesh);
        
        // 2. Create the top lid (inward funnel)
        const lidGeom = new THREE.CylinderGeometry(0.23, 0.08, 0.04, 16, 1, true);
        lidGeom.scale(0.65, 1.0, 1.0);
        const lidMesh = new THREE.Mesh(lidGeom, this.materials.trashLid);
        lidMesh.position.y = 0.97;
        trashCanGroup.add(lidMesh);
        
        // 3. Create the rim (thin top border following the body shape)
        const rimGeom = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false, curveSegments: 16 });
        rimGeom.rotateX(-Math.PI / 2);
        const rimMesh = new THREE.Mesh(rimGeom, this.materials.trashLid);
        rimMesh.position.y = 0.985;
        trashCanGroup.add(rimMesh);
        
        // 4. Create the blue trash bag inside, lowered to be visible through the opening
        const bagGeom = new THREE.BoxGeometry(0.12, 0.02, 0.26);
        const bagMesh = new THREE.Mesh(bagGeom, this.materials.trashBag);
        bagMesh.position.y = 0.90;
        trashCanGroup.add(bagMesh);
        
        return trashCanGroup;
    }

    addTrashCansToStation(station, stationGroup, S_len, platLength, platTopY, centerAngle) {
        // Collect pillar coordinates to avoid collision
        let pillarZList = [];
        if (station.name !== "Hardhöhe" && station.name !== "Jakobinenstraße") {
            if (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name)) {
                pillarZList = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30].map(z => z * S_len);
            } else if (["Aufseßplatz", "Hasenbuck", "Frankenstraße", "Maffeiplatz"].includes(station.name)) {
                pillarZList = [-32, -24, -16, -8, 0, 8, 16, 24, 32].map(z => z * S_len);
            } else {
                pillarZList = [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5].map(z => z * S_len);
            }
        }

        // Helper function to shift Z position to avoid columns
        const checkPillarsAndAdjustZ = (targetZ) => {
            let adjustedZ = targetZ;
            let attempts = 0;
            let hasCollision = true;
            // Shift towards the center first to avoid going out of platform bounds
            const shiftDir = targetZ >= 0 ? -1.0 : 1.0;
            while (hasCollision && attempts < 100) {
                hasCollision = false;
                for (const pz of pillarZList) {
                    if (Math.abs(adjustedZ - pz) < 2.5) { // 2.5m safety margin
                        adjustedZ += shiftDir * 1.5;
                        hasCollision = true;
                        break;
                    }
                }
                attempts++;
            }
            return adjustedZ;
        };

        const isSideStation = station.side;
        const isScharfreiterring = (station.name === "Scharfreiterring");
        const centerSpacing = this.sim.getTrackSpacing(station.position);

        // 3 Z positions along the platform
        const rawZOffsets = [-platLength * 0.3, 0, platLength * 0.3];
        const adjustedZOffsets = rawZOffsets.map(z => checkPillarsAndAdjustZ(z));

        // Helper to calculate curved coordinates relative to track spline
        const getLocalPlacement = (z, offsetX) => {
            const s = station.position + z;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            
            // Calculate world position and convert to local space of the stationGroup
            const worldPos = pos.clone().addScaledVector(normal, offsetX);
            const localPos = stationGroup.worldToLocal(worldPos);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
            
            return {
                pos: localPos,
                rotY: rotY
            };
        };

        let placements = []; // array of { pos, rotY }

        if (isSideStation) {
            adjustedZOffsets.forEach(z => {
                const s = station.position + z;
                const spacing = this.sim.getTrackSpacing(s);
                
                // Left platform trash can (near left wall)
                placements.push(getLocalPlacement(z, spacing / 2 + 5.25));
                
                // Right platform trash can (near right wall)
                placements.push(getLocalPlacement(z, -(spacing / 2 + 5.25)));
            });
        } else if (isScharfreiterring) {
            adjustedZOffsets.forEach(z => {
                const s = station.position + z;
                const spacing = this.sim.getTrackSpacing(s);
                const leftPlatCenter = spacing / 2 - 5.03;
                
                // Left platform trash can
                placements.push(getLocalPlacement(z, leftPlatCenter + 3.25));
                
                // Right platform trash can
                placements.push(getLocalPlacement(z, -(leftPlatCenter + 3.25)));
            });
        } else {
            // Island platform: place in the center (X = 0)
            if (centerSpacing - 3.08 > 0.5) {
                adjustedZOffsets.forEach(z => {
                    placements.push(getLocalPlacement(z, 0));
                });
            }
        }

        // Build and add the trash cans
        placements.forEach(p => {
            const trashCan = this.buildTrashCan();
            trashCan.position.copy(p.pos);
            trashCan.position.y = platTopY; // Ensure it stands flat on the deck floor
            trashCan.rotation.y = p.rotY;
            stationGroup.add(trashCan);
        });
    }

    // ========================================================================
    // AUFZUG — universelles Modell nach Vorbild der Nürnberger Glasaufzüge
    // (Glasschacht mit dunklem Stahlrahmen, Edelstahlblende über den Türen,
    // Glaskabine mit Lichtfeld; Türen beidseitig als Durchlader).
    // Grundfläche fix 2.50 x 2.50 m; die Schachthöhe folgt spec.topY und passt
    // sich damit unterschiedlichen Stationshöhen an. Nach dem Einbau räumt
    // _clearElevatorFootprint alle berührten Einrichtungsobjekte (Säulen,
    // Bänke, Mülleimer, Passagiere, Schilder ...) aus dem Grundriss.
    // spec: { dz, xOff = 0, topY = 4.66, floorY = 0.865 }
    //   dz/xOff in Metern relativ zur Stationsmitte bzw. Gleisachse.
    // ========================================================================
    buildElevator(stationGroup, station, centerAngle, spec) {
        const floorY = spec.floorY !== undefined ? spec.floorY : 0.865;
        const topY = spec.topY !== undefined ? spec.topY : 4.66;
        const H = topY - floorY;   // Schachthöhe (bis Deckenunterkante)
        const W = 2.5;             // Außenmaß 250 x 250 cm
        const half = W / 2;

        // Geteilte Materialien (einmal pro StationModel). Edelstahl als Phong,
        // NICHT als metalness-Standardmaterial: ohne Environment-Map rendert
        // hohe metalness fast schwarz (siehe Mülleimer-Kommentar im Konstruktor).
        if (!this.materials.elevFrame) {
            this.materials.elevFrame = new THREE.MeshLambertMaterial({ color: '#3d4249' });
            this.materials.elevSteel = new THREE.MeshPhongMaterial({ color: 0xd6d9dd, shininess: 90, specular: 0x666666 });
            this.materials.elevGlass = new THREE.MeshLambertMaterial({ color: '#9fb9c4', transparent: true, opacity: 0.30, side: THREE.DoubleSide });
            this.materials.elevDoorGlass = new THREE.MeshLambertMaterial({ color: '#87a5b2', transparent: true, opacity: 0.42, side: THREE.DoubleSide });
            this.materials.elevCabinFloor = new THREE.MeshLambertMaterial({ color: '#2e3238' });
            this.materials.elevLamp = new THREE.MeshBasicMaterial({ color: '#fffbe8' });
        }
        const frameMat = this.materials.elevFrame;
        const steelMat = this.materials.elevSteel;
        const glassMat = this.materials.elevGlass;
        const doorMat = this.materials.elevDoorGlass;

        // Platzierung entlang der Gleisspline (gleiches Schema wie Säulen/Mülleimer)
        const s = station.position + (spec.dz || 0);
        const pos = this.sim.getTrackPosition(s);
        const tangent = this.sim.getTrackTangent(s);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const worldPos = pos.clone().addScaledVector(normal, spec.xOff || 0);

        const elev = new THREE.Group();
        elev.position.copy(stationGroup.worldToLocal(worldPos));
        elev.position.y = floorY;
        elev.rotation.y = Math.atan2(tangent.x, tangent.z) - centerAngle;

        const addBox = (w, h, d, x, y, z, mat) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            elev.add(m);
            return m;
        };

        const postT = 0.14;              // Eckpfosten-Kantenlänge
        const postX = half - postT / 2;  // Pfostenmitte
        const innerW = W - 2 * postT;    // lichte Breite zwischen den Pfosten
        const doorTopY = Math.min(2.2, H - 0.4); // Türhöhe, bei sehr flachen Decken reduziert

        // 1. Stahlrahmen: 4 Eckpfosten, Sockelring, Kopfring
        for (const sx of [1, -1]) for (const sz of [1, -1]) {
            addBox(postT, H, postT, sx * postX, H / 2, sz * postX, frameMat);
        }
        for (const [ringY, ringH] of [[0.05, 0.10], [H - 0.09, 0.18]]) {
            addBox(W, ringH, postT, 0, ringY, postX, frameMat);
            addBox(W, ringH, postT, 0, ringY, -postX, frameMat);
            addBox(postT, ringH, innerW, postX, ringY, 0, frameMat);
            addBox(postT, ringH, innerW, -postX, ringY, 0, frameMat);
        }

        // 2. Verglasung: Seitenflächen voll, Stirnseiten oberhalb der Türen
        const sideGlassH = H - 0.28; // zwischen Sockel- (bis 0.10) und Kopfring (ab H-0.18)
        const gY = 0.10 + sideGlassH / 2;
        addBox(0.025, sideGlassH, innerW, postX, gY, 0, glassMat);
        addBox(0.025, sideGlassH, innerW, -postX, gY, 0, glassMat);
        const overH = H - 0.18 - (doorTopY + 0.12);
        if (overH > 0.05) {
            const oY = doorTopY + 0.12 + overH / 2;
            addBox(innerW, overH, 0.025, 0, oY, postX, glassMat);
            addBox(innerW, overH, 0.025, 0, oY, -postX, glassMat);
        }

        // Horizontale Sprossen auf den Seitenflächen; oberhalb der Tür alle
        // 1.1 m eine weitere Ebene, damit hohe Schächte gegliedert bleiben
        const mullionYs = [1.1, doorTopY];
        for (let my = doorTopY + 1.1; my < H - 0.35; my += 1.1) mullionYs.push(my);
        for (const my of mullionYs) {
            addBox(0.06, 0.06, innerW, postX, my, 0, frameMat);
            addBox(0.06, 0.06, innerW, -postX, my, 0, frameMat);
        }

        // 3. Türen beidseitig (Durchlader): zwei Glas-Schiebeflügel mit
        // Mittelstoß und Edelstahl-Türsturz
        const doorH = doorTopY - 0.10;
        const doorCY = 0.10 + doorH / 2;
        for (const sz of [1, -1]) {
            const zP = sz * (postX - 0.02);
            addBox(innerW / 2 - 0.04, doorH, 0.03, -innerW / 4, doorCY, zP, doorMat);
            addBox(innerW / 2 - 0.04, doorH, 0.03, innerW / 4, doorCY, zP, doorMat);
            addBox(0.06, doorH, 0.05, 0, doorCY, zP, frameMat); // Mittelstoß
            addBox(innerW, 0.12, 0.10, 0, doorTopY + 0.06, zP, steelMat); // Türsturz
        }

        // 4. Edelstahlblende über den Türen (der markante umlaufende Kragen)
        const collarY = doorTopY + 0.35;
        if (collarY + 0.16 < H - 0.2) {
            const cOut = half + 0.11;
            addBox(W + 0.22, 0.32, 0.12, 0, collarY, cOut, steelMat);
            addBox(W + 0.22, 0.32, 0.12, 0, collarY, -cOut, steelMat);
            addBox(0.12, 0.32, W, cOut, collarY, 0, steelMat);
            addBox(0.12, 0.32, W, -cOut, collarY, 0, steelMat);
        }

        // 5. Kabine: dunkler Boden, Edelstahldecke mit Lichtfeld,
        // Innenverglasung + Handläufe an den geschlossenen Seiten
        addBox(2.1, 0.06, 2.1, 0, 0.03, 0, this.materials.elevCabinFloor);
        addBox(2.1, 0.10, 2.1, 0, doorTopY - 0.15, 0, steelMat);
        addBox(1.5, 0.02, 1.5, 0, doorTopY - 0.21, 0, this.materials.elevLamp);
        const cabGlassH = doorTopY - 0.36;
        addBox(0.02, cabGlassH, 2.05, 1.02, 0.06 + cabGlassH / 2, 0, glassMat);
        addBox(0.02, cabGlassH, 2.05, -1.02, 0.06 + cabGlassH / 2, 0, glassMat);
        addBox(0.05, 0.05, 1.8, 0.96, 0.95, 0, steelMat);
        addBox(0.05, 0.05, 1.8, -0.96, 0.95, 0, steelMat);

        // 6. Anforderungssäulen neben den Türen (diagonal gegenüber)
        for (const sz of [1, -1]) {
            addBox(0.16, 1.10, 0.16, sz * 0.85, 0.55, sz * (half + 0.28), steelMat);
            addBox(0.12, 0.18, 0.03, sz * 0.85, 1.02, sz * (half + 0.28 + 0.08), this.materials.elevLamp);
        }

        // Exakter Räum-Grundriss im Aufzug-eigenen Frame: nur der Schacht
        // selbst (2.5 x 2.5) plus 2 cm Toleranz — Blendenüberstand und
        // Anforderungssäulen räumen nichts, was nur daneben steht.
        elev.userData.clearanceBox = new THREE.Box3(
            new THREE.Vector3(-(half + 0.02), 0, -(half + 0.02)),
            new THREE.Vector3(half + 0.02, H, half + 0.02)
        );

        stationGroup.add(elev);
        this._clearElevatorFootprint(stationGroup, elev);
        return elev;
    }

    // Entfernt alle Einrichtungsobjekte, deren Bounding-Box den Aufzug berührt
    // (Säulen, Bänke, Mülleimer, Automaten, Passagiere, Schilder ...). Große,
    // strukturelle Objekte (gesweepte Böden/Decken/Wände, Treppenanlagen)
    // werden über ihre Grundriss-Ausdehnung (> 6 m) verschont — der Aufzug soll
    // die Möblierung räumen, nicht die Station selbst.
    // Alle Boxen werden in den Frame des AUFZUGS transformiert (nicht der
    // Station): dort ist der Räum-Grundriss exakt achsparallel. Die Welt-AABB
    // der Nachbarobjekte bläht sich beim Rücktransformieren nur um deren
    // Verdrehung RELATIV zum Aufzug auf — auf derselben Gleistangente ist das
    // praktisch null, während eine stations- oder weltbezogene AABB bei
    // diagonal liegenden Stationen (z. B. Langwasser Süd, ~45°) den Grundriss
    // auf das Doppelte aufblasen und zu viel wegräumen würde.
    _clearElevatorFootprint(stationGroup, elevGroup) {
        stationGroup.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(elevGroup.matrixWorld).invert();
        const zone = elevGroup.userData.clearanceBox;
        if (!zone) return;
        // Jede Geometrie einzeln über inv * matrixWorld in den Aufzug-Frame
        // bringen — NICHT Box3.setFromObject (Welt-AABB) und dann rücktrans-
        // formieren: das verdoppelt bei diagonal liegenden Stationen die Box
        // und räumt Objekte weg, die den Schacht gar nicht berühren.
        const rel = new THREE.Matrix4();
        const tmp = new THREE.Box3();
        const boxInElevFrame = (obj) => {
            const box = new THREE.Box3();
            obj.traverse(node => {
                if (!node.isMesh || !node.geometry) return;
                if (node.geometry.boundingBox === null) node.geometry.computeBoundingBox();
                rel.multiplyMatrices(inv, node.matrixWorld);
                tmp.copy(node.geometry.boundingBox).applyMatrix4(rel);
                box.union(tmp);
            });
            return box;
        };
        const doomed = [];
        for (const child of stationGroup.children) {
            if (child === elevGroup) continue;
            const box = boxInElevFrame(child);
            if (box.isEmpty()) continue;
            if (box.max.x - box.min.x > 6 || box.max.z - box.min.z > 6) continue;
            if (box.intersectsBox(zone)) doomed.push(child);
        }
        for (const child of doomed) stationGroup.remove(child);
    }

    spawnPassengersForStation(station, stationGroup) {
        if (station.name === "Messe") {
            // Preservation: Messe passengers are pre-defined in the original buildStation method
            return;
        }

        const configs = PASSENGER_DATA[station.name];
        if (!configs || configs.length === 0) return;

        const passBuilder = new PassengerBuilder();
        const platLength = 2 * station.halfLength;
        const platTopY = 0.865;
        const centerTangent = this.sim.getTrackTangent(station.position);
        const centerAngle = Math.atan2(centerTangent.x, centerTangent.z);
        const isSideStation = station.side;
        const isScharfreiterring = (station.name === "Scharfreiterring");

        const getLocalPlacement = (zOffset, xOffset, isLowerLevel = false) => {
            const s = station.position + zOffset;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen;
            const nZ = tan.x / nlen;
            
            let yOffset = platTopY;
            if (station.name === "Plärrer" && isLowerLevel) {
                yOffset += this.sim.getLowerLevelOffset(s);
            }
            
            const worldPos = new THREE.Vector3(wp.x + nX * xOffset, wp.y + yOffset, wp.z + nZ * xOffset);
            const posLocal = stationGroup.worldToLocal(worldPos);
            const rotY = Math.atan2(tan.x, tan.z) - centerAngle;
            return { pos: posLocal, rotY };
        };

        // Zone division along platform Z axis to avoid collisions
        const zZones = [
            [-0.32, -0.20],
            [-0.15, -0.05],
            [0.05, 0.15],
            [0.20, 0.32]
        ];

        configs.forEach((baseConfig, idx) => {
            const config = { ...baseConfig };
            
            // Deterministic seeded pseudo-random helper to make passenger positions fixed and processor-friendly
            const seedBase = station.name.charCodeAt(0) + station.name.charCodeAt(station.name.length - 1) + idx * 100;
            let seed = seedBase;
            const rand = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };

            // Deterministically pick height, skin, hair colors/styles if not explicitly specified
            if (!config.height) {
                config.height = 1.60 + rand() * 0.25;
            }
            if (!config.skinColor) {
                const skins = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#f5d0c0'];
                config.skinColor = skins[Math.floor(rand() * skins.length)];
            }
            if (!config.hairColor) {
                const hairs = ['#593e1a', '#edd18c', '#090807', '#808080', '#b25a38'];
                config.hairColor = hairs[Math.floor(rand() * hairs.length)];
            }
            if (!config.hairStyle) {
                const styles = ['short', 'long', 'ponytail', 'bun'];
                config.hairStyle = styles[Math.floor(rand() * styles.length)];
            }

            const zone = zZones[idx];
            const randZFrac = zone[0] + rand() * (zone[1] - zone[0]);
            const zOffset = randZFrac * platLength;
            const s = station.position + zOffset;
            const spacing = this.sim.getTrackSpacing(s);

            let xOffset = 0;

            if (station.name === "Plärrer") {
                // Stacked platforms, assign 2 passengers to U1 (lower) and 2 to U2 (upper)
                const isLowerLevel = (idx % 2 === 0);
                const trackSign = isLowerLevel ? -1 : 1;
                const edgeGap = 1.54;
                const edgeX = trackSign * spacing / 2 - edgeGap;

                // Avoid the middle corridor (middle is edgeX - 4.5)
                const standNearTrack = (rand() > 0.5);
                const dx = standNearTrack ? (0.5 + rand() * 2.0) : (6.5 + rand() * 2.0);
                xOffset = edgeX - dx;
            } else if (isSideStation) {
                // Side platform
                const isLeftPlat = (rand() > 0.5);
                const sign = isLeftPlat ? 1 : -1;
                const off = spacing / 2 + 3.54;
                
                // Avoid middle of 4m width, enforce 50cm safety margin from track edge (dx >= -1.5)
                const standNearTrack = (rand() > 0.5);
                const dx = standNearTrack ? (-1.5 + rand() * 0.9) : (0.8 + rand() * 0.9);
                xOffset = sign * (off + dx);
            } else if (isScharfreiterring) {
                // Scharfreiterring (wide platforms)
                const isLeftPlat = (rand() > 0.5);
                const sign = isLeftPlat ? 1 : -1;
                const leftPlatCenter = spacing / 2 - 5.03;
                
                const standNearTrack = (rand() > 0.5);
                const dx = standNearTrack ? (-3.0 + rand() * 1.8) : (1.2 + rand() * 1.8);
                xOffset = sign * (leftPlatCenter + dx);
            } else {
                // Island platform: center X = 0, width = spacing - 3.08.
                const platWidth = spacing - 3.08;
                const isLeft = (rand() > 0.5);
                
                // Avoid middle corridor (|X| < 1.0)
                if (isLeft) {
                    xOffset = -1.0 - rand() * (platWidth / 2 - 1.5);
                } else {
                    xOffset = 1.0 + rand() * (platWidth / 2 - 1.5);
                }
            }

            const passenger = passBuilder.createCharacter(config);
            const isLower = (station.name === "Plärrer" && idx % 2 === 0);
            const p = getLocalPlacement(zOffset, xOffset, isLower);
            passenger.position.copy(p.pos);

            // Natural randomized stance angles
            const angles = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
            const baseAngle = angles[Math.floor(rand() * angles.length)];
            passenger.rotation.y = p.rotY + baseAngle + (rand() - 0.5) * 0.5;

            stationGroup.add(passenger);
        });
    }

    buildMuggenhofStairs(station, stationGroup, platLength, spacing, centerPos, centerAngle) {
        const numSteps = 50;
        const numTotalSteps = numSteps + 4; // Extend by 2 steps at each end
        const stepHeight = 0.16;
        const stepDepth = 0.3;
        const runLength = numSteps * stepDepth; // 15.0m
        const stairHeight = numSteps * stepHeight; // 8.0m (descends from platform to ground)
        
        const rampLength = Math.sqrt(runLength * runLength + stairHeight * stairHeight);
        const rampAngle = Math.atan2(stairHeight, runLength);
        
        // 1. Create textures locally
        const stairTex = (() => {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#64748b'; ctx.fillRect(0, 0, 128, 128);
            for (let i = 0; i < 2000; i++) {
                const x = Math.random() * 128; const y = Math.random() * 128;
                const diff = (Math.random() - 0.5) * 20; const val = Math.floor(100 + diff);
                ctx.fillStyle = `rgb(${val},${val},${val})`; ctx.globalAlpha = 0.08; ctx.fillRect(x, y, 1.5, 1.5);
            }
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#eab308'; ctx.fillRect(0, 0, 128, 8); // yellow safety warning stripe
            ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 8, 128, 6); // anti-slip strip
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        })();
        
        const escStripeTex = (() => {
            const canvas = document.createElement('canvas');
            canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            const stripeWidth = 2;
            for (let x = 0; x < 64; x += stripeWidth) {
                ctx.fillStyle = (x % (stripeWidth * 2) === 0) ? '#475569' : '#94a3b8';
                ctx.fillRect(x, 0, stripeWidth, 64);
                ctx.fillStyle = '#334155'; ctx.fillRect(x, 0, 1, 64);
                ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x + stripeWidth - 1, 0, 1, 64);
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        })();
        
        const stepMat = new THREE.MeshLambertMaterial({ map: stairTex });
        const escStepMat = new THREE.MeshLambertMaterial({ map: escStripeTex });
        const wallMat = this.createRoughConcreteMaterial();
        const handrailMat = new THREE.MeshBasicMaterial({ color: '#111111' });
        const glassMat = this.materials.muggenhofGlass || new THREE.MeshLambertMaterial({ color: '#14b8a6', transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        const edelstahlMat = StationBuilder.createBalustradeMaterial();
        const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffe0', side: THREE.DoubleSide });
        
        const stairWidth = 2.0;
        const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
        const escWidth = 1.0; // Narrowed from 1.2 to 1.0
        const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
        
        // Build the stairways for both platform sides: platformSign = 1 (positive X / right) and platformSign = -1 (negative X / left)
        // And for both ends: zDir = 1 (positive Z) and zDir = -1 (negative Z)
        [1, -1].forEach(platformSign => {
            [1, -1].forEach(zDir => {
                const stairGroup = new THREE.Group();
                
                // descentDir = zDir to make the stairs descend OUTWARDS (away from the platform)
                const descentDir = zDir;
                const rotX = descentDir * rampAngle;
                const midZ = descentDir * (runLength / 2);
                const midY = -(stairHeight / 2);
                
                // 1. Instanced steps
                const stairInst = new THREE.InstancedMesh(stairGeom, stepMat, numSteps);
                const escInst = new THREE.InstancedMesh(escStepGeom, escStepMat, numTotalSteps);

                // GPU Animation: Add direction attribute
                const dirAttr = new Float32Array(numTotalSteps * 3);
                for (let i = 0; i < numTotalSteps; i++) {
                    // Descending DOWN (yDir: -1) -> vector is (0, -stepHeight, descentDir * stepDepth)
                    dirAttr[i * 3 + 0] = 0;
                    dirAttr[i * 3 + 1] = -stepHeight;
                    dirAttr[i * 3 + 2] = descentDir * stepDepth;
                }
                escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
                StationBuilder.setupEscalatorMaterial(escStepMat, this);

                const stepMatrix = new THREE.Matrix4();
                
                // Shift stairs (inner) and escalator (outer) relative to platform center (symmetric layout)
                const shiftStairsX = -platformSign * 0.6;
                const shiftEscX = platformSign * 1.0;
                
                for (let i = 0; i < numSteps; i++) {
                    const sy = -i * stepHeight - stepHeight / 2;
                    const sz = descentDir * (i * stepDepth + stepDepth / 2);
                    stepMatrix.makeTranslation(shiftStairsX, sy, sz);
                    stairInst.setMatrixAt(i, stepMatrix);
                }
                for (let i = 0; i < numTotalSteps; i++) {
                    const stepIdx = i - 2;
                    const sy = -stepIdx * stepHeight - stepHeight / 2;
                    const sz = descentDir * (stepIdx * stepDepth + stepDepth / 2);
                    stepMatrix.makeTranslation(shiftEscX, sy, sz);
                    escInst.setMatrixAt(i, stepMatrix);
                }
                stairInst.instanceMatrix.needsUpdate = true;
                escInst.instanceMatrix.needsUpdate = true;
                stairGroup.add(stairInst, escInst);

                this.registerEscalator(escInst, { numTotalSteps });

                escInst.computeBoundingSphere();
                if (escInst.boundingSphere) escInst.boundingSphere.radius *= 5;

                // 2. Escalator ramp casing (under steps)
                const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);
                const escCasing = new THREE.Mesh(escRampGeom, escStepMat);
                escCasing.position.set(shiftEscX, midY - 0.15, midZ);
                escCasing.rotation.x = rotX;
                stairGroup.add(escCasing);
                
                // 3. Escalator Stainless Steel Balustrades
                const thickness = 0.04;
                const height = 0.9;
                const railWidth = 0.08;
                const railHeight = 0.08;
                const { balustradeGeom, handrailGeom, lampGeom } = createEscalatorGeometries(rampLength, thickness, height, railWidth, railHeight);
                
                const glassL = new THREE.Mesh(balustradeGeom, edelstahlMat);
                glassL.position.set(shiftEscX - 0.58, midY + 0.45, midZ);
                glassL.rotation.x = rotX;
                
                const glassR = new THREE.Mesh(balustradeGeom, edelstahlMat);
                glassR.position.set(shiftEscX + 0.58, midY + 0.45, midZ);
                glassR.rotation.x = rotX;
                
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
                addLamps(glassL, 1);
                addLamps(glassR, -1);
                
                stairGroup.add(glassL, glassR);
                
                // 4. Escalator Handrails (Closed loops, positioned at the same Y center as balustrades)
                const railL = new THREE.Mesh(handrailGeom, handrailMat);
                railL.position.set(shiftEscX - 0.58, midY + 0.45, midZ);
                railL.rotation.x = rotX;
                
                const railR = new THREE.Mesh(handrailGeom, handrailMat);
                railR.position.set(shiftEscX + 0.58, midY + 0.45, midZ);
                railR.rotation.x = rotX;
                stairGroup.add(railL, railR);
                
                // 5. Sloped canopy roof (base node for wall/frame attachment to prevent floating gaps)
                const canopyHeight = 2.6;
                const roofGeom = new THREE.BoxGeometry(4.0, 0.08, rampLength);
                const canopyRoof = new THREE.Mesh(roofGeom, glassMat);
                canopyRoof.position.set(0, midY + canopyHeight, midZ);
                canopyRoof.rotation.x = rotX;
                stairGroup.add(canopyRoof);
                
                // Side glass walls attached directly to roof
                const canopyGlassGeom = new THREE.BoxGeometry(0.04, canopyHeight, rampLength);
                
                const wallLeft = new THREE.Mesh(canopyGlassGeom, glassMat);
                wallLeft.position.set(-1.95, -canopyHeight / 2, 0);
                canopyRoof.add(wallLeft);
                
                const wallRight = new THREE.Mesh(canopyGlassGeom, glassMat);
                wallRight.position.set(1.95, -canopyHeight / 2, 0);
                canopyRoof.add(wallRight);
                
                // Canopy frame arches attached directly on top of the roof
                const frameGeom = new THREE.BoxGeometry(4.05, 0.1, 0.06);
                for (let d = -rampLength / 2; d <= rampLength / 2; d += 2.5) {
                    const frame = new THREE.Mesh(frameGeom, this.materials.boardCasing);
                    frame.position.set(0, 0.04, d);
                    canopyRoof.add(frame);
                }
                
                // 6. Street-level entrance kiosk at Y = -7.0
                const kioskGroup = new THREE.Group();
                const kioskW = 4.2, kioskH = 3.0, kioskD = 5.0;
                
                // Kiosk concrete walls
                const kioskWallGeom = new THREE.BoxGeometry(kioskW, kioskH, 0.15);
                const kioskBackWall = new THREE.Mesh(kioskWallGeom, wallMat);
                // Position back wall at the far end (relative to descentDir) to avoid blocking the stairs
                kioskBackWall.position.set(0, kioskH / 2, descentDir * (kioskD / 2));
                kioskGroup.add(kioskBackWall);
                
                const kioskSideGeom = new THREE.BoxGeometry(0.15, kioskH, kioskD);
                const kioskSideL = new THREE.Mesh(kioskSideGeom, wallMat);
                kioskSideL.position.set(-kioskW / 2, kioskH / 2, 0);
                const kioskSideR = new THREE.Mesh(kioskSideGeom, wallMat);
                kioskSideR.position.set(kioskW / 2, kioskH / 2, 0);
                kioskGroup.add(kioskSideL, kioskSideR);
                
                // Kiosk roof
                const kioskRoofGeom = new THREE.BoxGeometry(kioskW + 0.2, 0.15, kioskD + 0.2);
                const kioskRoof = new THREE.Mesh(kioskRoofGeom, wallMat);
                kioskRoof.position.set(0, kioskH + 0.075, 0);
                kioskGroup.add(kioskRoof);
                
                // Place kiosk at the bottom of the stairs
                kioskGroup.position.set(0, -stairHeight, descentDir * (runLength + kioskD / 2 - 0.2));
                stairGroup.add(kioskGroup);
                
                // Position the entire stair group relative to the platform end anchor
                const offset = zDir * (platLength / 2);
                const s = station.position + offset;
                const edgePos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const localSpacing = this.sim.getTrackSpacing(s);
                
                // Calculate world-space position with the outward shift (3.84m instead of 3.54m)
                const shiftPosWorld = edgePos.clone().addScaledVector(normal, platformSign * (localSpacing / 2 + 3.84));
                const edgeLoc = stationGroup.worldToLocal(shiftPosWorld);
                
                stairGroup.position.copy(edgeLoc);
                stairGroup.position.y = 0.865;
                stairGroup.rotation.y = rotY;
                
                stationGroup.add(stairGroup);
            });
        });
    }

    buildStadtgrenzeStairs(station, stationGroup, platLength, spacing, centerPos, centerAngle) {
        const numSteps = 50;
        const numTotalSteps = numSteps + 4; // Extend by 2 steps at each end
        const stepHeight = 0.16;
        const stepDepth = 0.3;
        const runLength = numSteps * stepDepth; // 15.0m
        const stairHeight = numSteps * stepHeight; // 8.0m (descends from platform to ground)
        
        const rampLength = Math.sqrt(runLength * runLength + stairHeight * stairHeight);
        const rampAngle = Math.atan2(stairHeight, runLength);
        
        // 1. Create textures locally (concrete/steps)
        const stairTex = (() => {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#78716c'; ctx.fillRect(0, 0, 128, 128); // Stone/concrete grey
            for (let i = 0; i < 2000; i++) {
                const x = Math.random() * 128; const y = Math.random() * 128;
                const diff = (Math.random() - 0.5) * 15; const val = Math.floor(120 + diff);
                ctx.fillStyle = `rgb(${val},${val},${val})`; ctx.globalAlpha = 0.08; ctx.fillRect(x, y, 1.5, 1.5);
            }
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#eab308'; ctx.fillRect(0, 0, 128, 8); // yellow safety warning stripe
            ctx.fillStyle = '#292524'; ctx.fillRect(0, 8, 128, 6); // anti-slip strip
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        })();
        
        const escStripeTex = (() => {
            const canvas = document.createElement('canvas');
            canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            const stripeWidth = 2;
            for (let x = 0; x < 64; x += stripeWidth) {
                ctx.fillStyle = (x % (stripeWidth * 2) === 0) ? '#57534e' : '#78716c';
                ctx.fillRect(x, 0, stripeWidth, 64);
                ctx.fillStyle = '#44403c'; ctx.fillRect(x, 0, 1, 64);
                ctx.fillStyle = '#a8a29e'; ctx.fillRect(x + stripeWidth - 1, 0, 1, 64);
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        })();
        
        const stepMat = new THREE.MeshLambertMaterial({ map: stairTex });
        const escStepMat = new THREE.MeshLambertMaterial({ map: escStripeTex });
        const wallMat = this.createRoughConcreteMaterial();
        const handrailMat = new THREE.MeshBasicMaterial({ color: '#111111' });
        const glassMat = this.materials.muggenhofGlass || new THREE.MeshLambertMaterial({ color: '#14b8a6', transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        const edelstahlMat = StationBuilder.createBalustradeMaterial();
        const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffe0', side: THREE.DoubleSide });
        
        const stairWidth = 2.0;
        const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
        const escWidth = 1.0; // Narrowed from 1.2 to 1.0
        const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
        
        // Build the stairways for both platform sides: platformSign = 1 (positive X / right) and platformSign = -1 (negative X / left)
        // And for both ends: zDir = 1 (positive Z) and zDir = -1 (negative Z)
        [1, -1].forEach(platformSign => {
            [1, -1].forEach(zDir => {
                const stairGroup = new THREE.Group();
                
                // descentDir = zDir to make the stairs descend OUTWARDS (away from the platform)
                const descentDir = zDir;
                const rotX = descentDir * rampAngle;
                const midZ = descentDir * (runLength / 2);
                const midY = -(stairHeight / 2);
                
                // 1. Instanced steps
                const stairInst = new THREE.InstancedMesh(stairGeom, stepMat, numSteps);
                const escInst = new THREE.InstancedMesh(escStepGeom, escStepMat, numTotalSteps);

                // GPU Animation: Add direction attribute
                const dirAttr = new Float32Array(numTotalSteps * 3);
                for (let i = 0; i < numTotalSteps; i++) {
                    // Descending DOWN (yDir: -1) -> vector is (0, -stepHeight, descentDir * stepDepth)
                    dirAttr[i * 3 + 0] = 0;
                    dirAttr[i * 3 + 1] = -stepHeight;
                    dirAttr[i * 3 + 2] = descentDir * stepDepth;
                }
                escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
                StationBuilder.setupEscalatorMaterial(escStepMat, this);

                const stepMatrix = new THREE.Matrix4();
                
                // Shift stairs (inner) and escalator (outer) relative to platform center (symmetric layout)
                const shiftStairsX = -platformSign * 0.6;
                const shiftEscX = platformSign * 1.0;
                
                for (let i = 0; i < numSteps; i++) {
                    const sy = -i * stepHeight - stepHeight / 2;
                    const sz = descentDir * (i * stepDepth + stepDepth / 2);
                    stepMatrix.makeTranslation(shiftStairsX, sy, sz);
                    stairInst.setMatrixAt(i, stepMatrix);
                }
                for (let i = 0; i < numTotalSteps; i++) {
                    const stepIdx = i - 2;
                    const sy = -stepIdx * stepHeight - stepHeight / 2;
                    const sz = descentDir * (stepIdx * stepDepth + stepDepth / 2);
                    stepMatrix.makeTranslation(shiftEscX, sy, sz);
                    escInst.setMatrixAt(i, stepMatrix);
                }
                stairInst.instanceMatrix.needsUpdate = true;
                escInst.instanceMatrix.needsUpdate = true;
                stairGroup.add(stairInst, escInst);

                this.registerEscalator(escInst, { numTotalSteps });

                escInst.computeBoundingSphere();
                if (escInst.boundingSphere) escInst.boundingSphere.radius *= 5;

                // 2. Escalator ramp casing (under steps)
                const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);
                const escCasing = new THREE.Mesh(escRampGeom, escStepMat);
                escCasing.position.set(shiftEscX, midY - 0.15, midZ);
                escCasing.rotation.x = rotX;
                stairGroup.add(escCasing);
                
                // 3. Escalator Stainless Steel Balustrades
                const thickness = 0.04;
                const height = 0.9;
                const railWidth = 0.08;
                const railHeight = 0.08;
                const { balustradeGeom, handrailGeom, lampGeom } = createEscalatorGeometries(rampLength, thickness, height, railWidth, railHeight);
                
                const glassL = new THREE.Mesh(balustradeGeom, edelstahlMat);
                glassL.position.set(shiftEscX - 0.58, midY + 0.45, midZ);
                glassL.rotation.x = rotX;
                
                const glassR = new THREE.Mesh(balustradeGeom, edelstahlMat);
                glassR.position.set(shiftEscX + 0.58, midY + 0.45, midZ);
                glassR.rotation.x = rotX;
                
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
                addLamps(glassL, 1);
                addLamps(glassR, -1);
                
                stairGroup.add(glassL, glassR);
                
                // 4. Escalator Handrails (Closed loops, positioned at the same Y center as balustrades)
                const railL = new THREE.Mesh(handrailGeom, handrailMat);
                railL.position.set(shiftEscX - 0.58, midY + 0.45, midZ);
                railL.rotation.x = rotX;
                
                const railR = new THREE.Mesh(handrailGeom, handrailMat);
                railR.position.set(shiftEscX + 0.58, midY + 0.45, midZ);
                railR.rotation.x = rotX;
                stairGroup.add(railL, railR);
                
                // 5. Enclosing canopy structure: solid concrete base wall + glass windows above
                const canopyHeight = 2.6;
                const roofGeom = new THREE.BoxGeometry(4.0, 0.12, rampLength);
                const canopyRoof = new THREE.Mesh(roofGeom, wallMat); // Concrete roof
                canopyRoof.position.set(0, midY + canopyHeight, midZ);
                canopyRoof.rotation.x = rotX;
                stairGroup.add(canopyRoof);
                
                // Side walls: 1.2m concrete base + 1.4m glass windows
                const baseH = 1.2;
                const glassH = 1.4;
                
                const buildSideWall = (xSign) => {
                    const wallGroup = new THREE.Group();
                    
                    // Concrete base wall
                    const baseGeom = new THREE.BoxGeometry(0.12, baseH, rampLength);
                    const baseWall = new THREE.Mesh(baseGeom, wallMat);
                    baseWall.position.set(0, baseH / 2, 0);
                    wallGroup.add(baseWall);
                    
                    // Glass pane above
                    const glassPaneGeom = new THREE.BoxGeometry(0.04, glassH, rampLength);
                    const glassPane = new THREE.Mesh(glassPaneGeom, glassMat);
                    glassPane.position.set(0, baseH + glassH / 2, 0);
                    wallGroup.add(glassPane);
                    
                    // Concrete structural posts every 2.5m
                    const postGeom = new THREE.BoxGeometry(0.14, glassH, 0.1);
                    for (let d = -rampLength / 2; d <= rampLength / 2; d += 2.5) {
                        const post = new THREE.Mesh(postGeom, wallMat);
                        post.position.set(0, baseH + glassH / 2, d);
                        wallGroup.add(post);
                    }
                    
                    // Frame along top edge of glass
                    const topFrameGeom = new THREE.BoxGeometry(0.14, 0.1, rampLength);
                    const topFrame = new THREE.Mesh(topFrameGeom, wallMat);
                    topFrame.position.set(0, baseH + glassH + 0.05, 0);
                    wallGroup.add(topFrame);
                    
                    wallGroup.position.set(xSign * 1.95, -canopyHeight, 0); // attached under the roof
                    return wallGroup;
                };
                
                canopyRoof.add(buildSideWall(1));
                canopyRoof.add(buildSideWall(-1));
                
                // 6. Street-level entrance kiosk at Y = -7.0
                const kioskGroup = new THREE.Group();
                const kioskW = 4.2, kioskH = 3.0, kioskD = 5.0;
                
                // Kiosk concrete walls
                const kioskWallGeom = new THREE.BoxGeometry(kioskW, kioskH, 0.15);
                const kioskBackWall = new THREE.Mesh(kioskWallGeom, wallMat);
                kioskBackWall.position.set(0, kioskH / 2, descentDir * (kioskD / 2));
                kioskGroup.add(kioskBackWall);
                
                const kioskSideGeom = new THREE.BoxGeometry(0.15, kioskH, kioskD);
                const kioskSideL = new THREE.Mesh(kioskSideGeom, wallMat);
                kioskSideL.position.set(-kioskW / 2, kioskH / 2, 0);
                const kioskSideR = new THREE.Mesh(kioskSideGeom, wallMat);
                kioskSideR.position.set(kioskW / 2, kioskH / 2, 0);
                kioskGroup.add(kioskSideL, kioskSideR);
                
                // Kiosk roof
                const kioskRoofGeom = new THREE.BoxGeometry(kioskW + 0.2, 0.15, kioskD + 0.2);
                const kioskRoof = new THREE.Mesh(kioskRoofGeom, wallMat);
                kioskRoof.position.set(0, kioskH + 0.075, 0);
                kioskGroup.add(kioskRoof);
                
                // Place kiosk at the bottom of the stairs
                kioskGroup.position.set(0, -stairHeight, descentDir * (runLength + kioskD / 2 - 0.2));
                stairGroup.add(kioskGroup);
                
                // Position the entire stair group relative to the platform end anchor
                const offset = zDir * (platLength / 2);
                const s = station.position + offset;
                const edgePos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const localSpacing = this.sim.getTrackSpacing(s);
                
                // Calculate world-space position with the outward shift (3.84m)
                const shiftPosWorld = edgePos.clone().addScaledVector(normal, platformSign * (localSpacing / 2 + 3.84));
                const edgeLoc = stationGroup.worldToLocal(shiftPosWorld);
                
                stairGroup.position.copy(edgeLoc);
                stairGroup.position.y = 0.865;
                stairGroup.rotation.y = rotY;
                
                stationGroup.add(stairGroup);
            });
        });
    }

    getRoethenbachTileMats() {
        if (!this._roethenbachTileMats) {
            const colors = ['#28411A', '#4B6303', '#6C7001', '#7C6F2E', '#11313B'];
            this._roethenbachTileMats = colors.map(c => this.createTiledMaterial(c, '#121511', 0.15));
        }
        return this._roethenbachTileMats;
    }
    
    getRoethenbachTextMat() {
        if (!this._roethenbachTextMat) {
            const canvasText = document.createElement('canvas');
            canvasText.width = 1024;
            canvasText.height = 128;
            const ctxT = canvasText.getContext('2d');
            ctxT.clearRect(0, 0, 1024, 128);
            ctxT.fillStyle = '#9A3618';
            ctxT.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctxT.textAlign = 'center';
            ctxT.textBaseline = 'middle';
            ctxT.fillText("RÖTHENBACH", canvasText.width / 2, canvasText.height / 2);
            ctxT.strokeStyle = '#9A3618';
            ctxT.lineWidth = 1.8;
            ctxT.strokeText("RÖTHENBACH", canvasText.width / 2, canvasText.height / 2);
            
            const textTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvasText));
            textTex.anisotropy = 8;
            this._roethenbachTextMat = new THREE.MeshLambertMaterial({
                map: textTex,
                transparent: true
            });
        }
        return this._roethenbachTextMat;
    }

    getHoheMarterTileMatFlughafen() {
        if (!this._hoheMarterTileMatFlughafen) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#162134';
            ctx.fillRect(0, 0, 1024, 256);
            
            const stripeColors = ['#23334D', '#162134', '#162A43'];
            let seed = 123;
            const random = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };
            
            const pxPerMeter = 256 / 2.5;
            let currentX = -500;
            while (currentX < 1500) {
                const stripeWM = 1.0 + random() * 2.0;
                const stripeW = Math.round(stripeWM * pxPerMeter);
                const col = stripeColors[Math.floor(random() * stripeColors.length)];
                
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.moveTo(currentX, 0);
                ctx.lineTo(currentX + stripeW, 0);
                ctx.lineTo(currentX + stripeW - 256, 256);
                ctx.lineTo(currentX - 256, 256);
                ctx.fill();
                
                currentX += stripeW;
            }
            
            ctx.strokeStyle = 'rgba(18,22,30,0.45)';
            ctx.lineWidth = 1.2;
            const tileSize = Math.round(0.15 * pxPerMeter);
            for (let x = -256; x < 1280; x += tileSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x - 256, 256);
                ctx.stroke();
            }
            for (let y = 0; y < 256; y += tileSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(1024, y);
                ctx.stroke();
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.repeat.set(1, 1);
            
            this._hoheMarterTileMatFlughafen = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._hoheMarterTileMatFlughafen;
    }

    getHoheMarterTileMatGrossreuth() {
        if (!this._hoheMarterTileMatGrossreuth) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#182536';
            ctx.fillRect(0, 0, 1024, 256);
            
            const stripeColors = ['#1D2E48', '#182536', '#182536'];
            let seed = 456;
            const random = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };
            
            const pxPerMeter = 256 / 2.5;
            let currentX = -500;
            while (currentX < 1500) {
                const stripeWM = 2.0 + random() * 3.0;
                const stripeW = Math.round(stripeWM * pxPerMeter);
                const col = stripeColors[Math.floor(random() * stripeColors.length)];
                
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.moveTo(currentX, 0);
                ctx.lineTo(currentX + stripeW, 0);
                ctx.lineTo(currentX + stripeW - 256, 256);
                ctx.lineTo(currentX - 256, 256);
                ctx.fill();
                
                currentX += stripeW;
            }
            
            ctx.strokeStyle = 'rgba(18,22,30,0.45)';
            ctx.lineWidth = 1.2;
            const tileSize = Math.round(0.15 * pxPerMeter);
            for (let x = -256; x < 1280; x += tileSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x - 256, 256);
                ctx.stroke();
            }
            for (let y = 0; y < 256; y += tileSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(1024, y);
                ctx.stroke();
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.repeat.set(1, 1);
            
            this._hoheMarterTileMatGrossreuth = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._hoheMarterTileMatGrossreuth;
    }

    getHoheMarterTextMat(sign) {
        const cacheKey = `_hoheMarterTextMat_${sign}`;
        if (!this[cacheKey]) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            
            const textColor = (sign > 0) ? '#1A1C19' : '#44403D';
            ctx.fillStyle = textColor;
            ctx.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("HOHE MARTER", 512, 64);
            
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.4;
            ctx.strokeText("HOHE MARTER", 512, 64);
            ctx.fillText("HOHE MARTER", 512, 64);
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this[cacheKey] = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this[cacheKey];
    }

    getSchweinauBrickMat(station, platLength, centerPos, centerAngle) {
        if (!this._schweinauBrickMat) {
            const tileColor = '#694541';
            const groutColor = '#34201c';
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            
            ctx.fillStyle = groutColor;
            ctx.fillRect(0, 0, 256, 256);
            
            const rows = 16;
            const cols = 4;
            const h = 256 / rows;
            const w = 256 / cols;
            const joint = 1.5;
            
            for (let r = 0; r < rows; r++) {
                const isShifted = (r % 2 === 1);
                const xOffset = isShifted ? (w / 2) : 0;
                ctx.fillStyle = tileColor;
                for (let c = -1; c < cols + 1; c++) {
                    const bx = c * w + xOffset;
                    ctx.fillRect(bx + joint, r * h + joint, w - joint * 2, h - joint * 2);
                }
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            
            const bumpCanvas = document.createElement('canvas');
            bumpCanvas.width = 256;
            bumpCanvas.height = 256;
            const bCtx = bumpCanvas.getContext('2d');
            bCtx.fillStyle = '#000000';
            bCtx.fillRect(0, 0, 256, 256);
            bCtx.fillStyle = '#ffffff';
            for (let r = 0; r < rows; r++) {
                const isShifted = (r % 2 === 1);
                const xOffset = isShifted ? (w / 2) : 0;
                for (let c = -1; c < cols + 1; c++) {
                    const bx = c * w + xOffset;
                    bCtx.fillRect(bx + joint, r * h + joint, w - joint * 2, h - joint * 2);
                }
            }
            const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
            bumpTexture.wrapS = THREE.RepeatWrapping;
            bumpTexture.wrapT = THREE.RepeatWrapping;
            
            this._schweinauBrickMat = new THREE.MeshLambertMaterial({
                map: texture,
                bumpMap: bumpTexture,
                bumpScale: 0.012,
                side: THREE.DoubleSide
            });
            if (station) {
                this.applyVaultClipping(this._schweinauBrickMat, station, platLength, centerPos, centerAngle);
            }
        }
        return this._schweinauBrickMat;
    }

    getSchweinauStripeMat(station, platLength, centerPos, centerAngle) {
        if (!this._schweinauStripeMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 384;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#d1d5db';
            ctx.fillRect(0, 0, 384, 64);
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 36px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.save();
            ctx.translate(192, 32);
            ctx.scale(0.7, 1.0);
            ctx.fillText("SCHWEINAU", 0, 0);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.2;
            ctx.strokeText("SCHWEINAU", 0, 0);
            ctx.restore();
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(1, 1);
            texture.anisotropy = 8;
            
            this._schweinauStripeMat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
            if (station) {
                this.applyVaultClipping(this._schweinauStripeMat, station, platLength, centerPos, centerAngle);
            }
        }
        return this._schweinauStripeMat;
    }
    getWeisserTurmWallMat() {
        if (!this._wtWallMat) {
            const WORLD_W = 2.4, WORLD_H = 1.2;
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            const pxPerMX = canvas.width / WORLD_W;
            const pxPerMY = canvas.height / WORLD_H;
            const joint = 2.0;
            ctx.fillStyle = '#1a1012'; // dark mortar
            ctx.fillRect(0, 0, 256, 256);
            
            const tones = ['#5a3a3a', '#4a2f2f', '#664242', '#3f2a2a', '#4f3535'];
            let y = 0, row = 0;
            while (y < canvas.height) {
                const h = Math.round(0.4 * pxPerMY); // roughly 40cm high blocks
                const w1 = Math.round(0.8 * pxPerMX);
                const w2 = Math.round(1.2 * pxPerMX);
                const offset = (row % 2 === 0) ? 0 : -Math.round(w1 / 2);
                for (let x = offset; x < canvas.width; x += (Math.random() > 0.5 ? w1 : w2)) {
                    const bw = (Math.random() > 0.5 ? w1 : w2);
                    ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
                    ctx.fillRect(x + joint, y + joint, bw - joint * 2, Math.max(1, h - joint * 2));
                    
                    // add some noise to the stone
                    ctx.fillStyle = 'rgba(0,0,0,0.15)';
                    ctx.fillRect(x + joint, y + joint, bw - joint * 2, 4);
                    ctx.fillStyle = 'rgba(255,255,255,0.05)';
                    ctx.fillRect(x + joint, y + h - joint - 4, bw - joint * 2, 4);
                }
                y += h;
                row++;
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.userData = { worldW: WORLD_W, worldH: WORLD_H };
            
            this._wtWallMat = new THREE.MeshLambertMaterial({ map: texture, roughness: 0.9 });
        }
        return this._wtWallMat;
    }

    getWeisserTurmTextMat() {
        if (!this._wtTextMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            ctx.fillStyle = '#1a1a1a';
            ctx.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("WEISSER TURM", 512, 64);
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._wtTextMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this._wtTextMat;
    }

    getWeisserTurmPillarMat() {
        if (!this._wtPillarMat) {
            this._wtPillarMat = this.createTiledMaterial('#3e892e', '#cbd5e1', 0.15);
        }
        return this._wtPillarMat;
    }

    getStLeonhardStoneMat() {
        if (!this._stLeonhardStoneMat) {
            const WORLD_W = 2.4, WORLD_H = 1.2;
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            const pxPerMX = canvas.width / WORLD_W;
            const pxPerMY = canvas.height / WORLD_H;
            const joint = 2.0;
            ctx.fillStyle = '#34201c';
            ctx.fillRect(0, 0, 256, 256);
            
            const tones = ['#694541', '#523F37', '#605655', '#7B6E66'];
            let y = 0, row = 0;
            while (y < canvas.height) {
                const courseM = 0.20 + Math.random() * 0.20;
                let h = Math.round(courseM * pxPerMY);
                if (y + h > canvas.height) h = canvas.height - y;
                const blockM = 0.5 + Math.random() * 0.35;
                const w = Math.max(16, Math.round(blockM * pxPerMX));
                const offset = (row % 2 === 0) ? 0 : -Math.round(w / 2);
                for (let x = offset; x < canvas.width; x += w) {
                    ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
                    ctx.fillRect(x + joint, y + joint, w - joint * 2, Math.max(1, h - joint * 2));
                }
                y += h;
                row++;
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.userData = { worldW: WORLD_W, worldH: WORLD_H };
            
            this._stLeonhardStoneMat = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._stLeonhardStoneMat;
    }

    getStLeonhardTextMat() {
        if (!this._stLeonhardTextMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            ctx.fillStyle = '#2a2725';
            ctx.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("ST. LEONHARD", 512, 64);
            ctx.strokeStyle = '#2a2725';
            ctx.lineWidth = 1.8;
            ctx.strokeText("ST. LEONHARD", 512, 64);
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._stLeonhardTextMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this._stLeonhardTextMat;
    }

    getRothenburgerGravelMat(station, platLength, centerPos, centerAngle) {
        if (!this._rothenburgerGravelMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#393D3E';
            ctx.fillRect(0, 0, 256, 256);
            
            const colors = ['#4D5256', '#3D4548', '#34383a'];
            for (let i = 0; i < 600; i++) {
                const x = Math.random() * 256;
                const y = Math.random() * 256;
                const r = 2.0 + Math.random() * 5.0;
                ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
                ctx.beginPath();
                if (Math.random() > 0.5) {
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                } else {
                    ctx.rect(x - r, y - r, r * 2, r * 2);
                }
                ctx.fill();
            }
            for (let i = 0; i < 3000; i++) {
                const x = Math.random() * 256;
                const y = Math.random() * 256;
                const val = Math.random() > 0.5 ? 20 : -20;
                ctx.fillStyle = val > 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
                ctx.fillRect(x, y, 1, 1);
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            
            const bumpCanvas = document.createElement('canvas');
            bumpCanvas.width = 256;
            bumpCanvas.height = 256;
            const bCtx = bumpCanvas.getContext('2d');
            bCtx.fillStyle = '#808080';
            bCtx.fillRect(0, 0, 256, 256);
            bCtx.globalAlpha = 0.35;
            for (let i = 0; i < 400; i++) {
                const x = Math.random() * 256;
                const y = Math.random() * 256;
                const r = 2.0 + Math.random() * 5.0;
                bCtx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
                bCtx.beginPath();
                bCtx.arc(x, y, r, 0, Math.PI * 2);
                bCtx.fill();
            }
            const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
            bumpTexture.wrapS = THREE.RepeatWrapping;
            bumpTexture.wrapT = THREE.RepeatWrapping;
            
            this._rothenburgerGravelMat = new THREE.MeshLambertMaterial({
                map: texture,
                bumpMap: bumpTexture,
                bumpScale: 0.02,
                side: THREE.DoubleSide
            });
            if (station) {
                this.applyVaultClipping(this._rothenburgerGravelMat, station, platLength, centerPos, centerAngle);
            }
        }
        return this._rothenburgerGravelMat;
    }

    getRothenburgerPlaqueMat() {
        if (!this._rothenburgerPlaqueMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 256);
            
            ctx.fillStyle = '#5C1A25';
            ctx.beginPath();
            ctx.ellipse(512, 128, 512, 128, 0, 0, Math.PI * 2);
            ctx.fill();
            
            const borderW = Math.round(256 * 0.20);
            ctx.fillStyle = '#3D4548';
            ctx.beginPath();
            ctx.ellipse(512, 128, 512 - borderW * 4, 128 - borderW, 0, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 52px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.save();
            ctx.translate(512, 128);
            ctx.scale(0.68, 1.0);
            ctx.fillText("ROTHENBURGER STRASSE", 0, 0);
            ctx.restore();
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._rothenburgerPlaqueMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        }
        return this._rothenburgerPlaqueMat;
    }

    getOpernhausStoneMat() {
        if (!this._opernhausStoneMat) {
            const WORLD_W = 2.4, WORLD_H = 1.2;
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            const pxPerMX = canvas.width / WORLD_W;
            const pxPerMY = canvas.height / WORLD_H;
            const joint = 2.0;
            ctx.fillStyle = '#1a1818';
            ctx.fillRect(0, 0, 256, 256);
            
            const tones = ['#43393A', '#8C8688', '#4D3F3F', '#5E5C5D'];
            let y = 0, row = 0;
            while (y < canvas.height) {
                const courseM = 0.20 + Math.random() * 0.20;
                let h = Math.round(courseM * pxPerMY);
                if (y + h > canvas.height) h = canvas.height - y;
                const blockM = 0.5 + Math.random() * 0.35;
                const w = Math.max(16, Math.round(blockM * pxPerMX));
                const offset = (row % 2 === 0) ? 0 : -Math.round(w / 2);
                for (let x = offset; x < canvas.width; x += w) {
                    ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
                    ctx.fillRect(x + joint, y + joint, w - joint * 2, Math.max(1, h - joint * 2));
                }
                y += h;
                row++;
            }
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.userData = { worldW: WORLD_W, worldH: WORLD_H };
            
            this._opernhausStoneMat = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._opernhausStoneMat;
    }

    /** Rough exposed-concrete material for the Opernhaus arch ceiling. */
    getOpernhausConcreateMat() {
        if (!this._opernhausConcreateMat) {
            const W = 512, H = 512;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');

            // Base concrete tone: warm mid-grey
            ctx.fillStyle = '#b0a89e';
            ctx.fillRect(0, 0, W, H);

            // Coarse aggregate: lighter patches
            ctx.globalAlpha = 0.18;
            for (let i = 0; i < 600; i++) {
                const x = Math.random() * W, y = Math.random() * H;
                const r = 2 + Math.random() * 7;
                const tone = Math.floor(170 + Math.random() * 55);
                ctx.fillStyle = `rgb(${tone},${tone - 6},${tone - 12})`;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }

            // Dark pits / voids
            ctx.globalAlpha = 0.22;
            for (let i = 0; i < 300; i++) {
                const x = Math.random() * W, y = Math.random() * H;
                const r = 1 + Math.random() * 4;
                ctx.fillStyle = `rgb(${60 + (Math.random() * 30 | 0)},${55 + (Math.random() * 25 | 0)},${50 + (Math.random() * 20 | 0)})`;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }

            // Horizontal form-work lines (shuttering marks)
            ctx.globalAlpha = 0.08;
            for (let y = 0; y < H; y += 14 + Math.random() * 10) {
                ctx.fillStyle = Math.random() > 0.5 ? '#7a7268' : '#c8c0b4';
                ctx.fillRect(0, y | 0, W, 1);
            }

            // Fine speckle / sand grain noise
            ctx.globalAlpha = 0.30;
            for (let i = 0; i < 4000; i++) {
                const x = Math.random() * W, y = Math.random() * H;
                const v = 90 + (Math.random() * 80 | 0);
                ctx.fillStyle = `rgba(${v},${v - 5},${v - 10},1)`;
                ctx.fillRect(x | 0, y | 0, 1, 1);
            }

            ctx.globalAlpha = 1.0;

            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;

            this._opernhausConcreateMat = new THREE.MeshLambertMaterial({
                map: texture,
                side: THREE.DoubleSide
            });
        }
        return this._opernhausConcreateMat;
    }

    getOpernhausTextMat() {
        if (!this._opernhausTextMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            ctx.fillStyle = '#2E2C2F';
            ctx.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("OPERNHAUS", 512, 64);
            ctx.strokeStyle = '#2E2C2F';
            ctx.lineWidth = 1.8;
            ctx.strokeText("OPERNHAUS", 512, 64);
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._opernhausTextMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this._opernhausTextMat;
    }

    getWoehrderCirclesMat() {
        if (!this._woehrderCirclesMat) {
            // Mosaic mural (photos): big FLAT overlapping circles — chartreuse, grass green,
            // blue, navy, violet, pale grey-blue — on a teal small-tile field, no outlines,
            // plus sparse small signal-red dots. A tile-joint grid + per-tile shade jitter
            // sells the ~10cm mosaic without a separate bump map.
            const W = 2048, H = 512;
            const worldW = 20.0, worldH = 4.8;
            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#3d7e92';
            ctx.fillRect(0, 0, W, H);

            const palette = [
                '#c3cf52', '#c3cf52',   // chartreuse yellow-green
                '#4f9d5c', '#4f9d5c',   // grass green
                '#77b287',              // pale green
                '#4a7ab8', '#4a7ab8',   // mid blue
                '#24386e', '#24386e',   // navy
                '#3c3168',              // dark violet
                '#a2b8c6',              // pale grey-blue
                '#2a5a6b'               // dark petrol
            ];
            let seed = 98765;
            const random = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };
            const drawCircle = (cx, cy, r, color) => {
                ctx.fillStyle = color;
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oy = -1; oy <= 1; oy++) {
                        ctx.beginPath();
                        ctx.arc(cx + ox * W, cy + oy * H, r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            };
            const scale = W / worldW;
            const circles = [];
            for (let i = 0; i < 30; i++) {
                circles.push({
                    cx: random() * W,
                    cy: random() * H,
                    r: (0.7 + random() * 1.5) * scale,
                    color: palette[Math.floor(random() * palette.length)]
                });
            }
            circles.sort((a, b) => b.r - a.r); // big ones first, small ones read on top
            circles.forEach(c => drawCircle(c.cx, c.cy, c.r, c.color));
            for (let i = 0; i < 8; i++) {
                drawCircle(random() * W, random() * H, (0.12 + random() * 0.14) * scale, '#c8342c');
            }

            // Mosaic tile joints + per-tile shade jitter
            const cell = 10;
            for (let y = 0; y < H; y += cell) {
                for (let x = 0; x < W; x += cell) {
                    const v = random();
                    ctx.fillStyle = (v < 0.5)
                        ? `rgba(255,255,255,${(v * 0.14).toFixed(3)})`
                        : `rgba(0,20,30,${((v - 0.5) * 0.16).toFixed(3)})`;
                    ctx.fillRect(x, y, cell, cell);
                }
            }
            ctx.strokeStyle = 'rgba(15,35,40,0.28)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0.5; x <= W; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
            for (let y = 0.5; y <= H; y += cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
            ctx.stroke();

            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.userData = { worldW, worldH };

            this._woehrderCirclesMat = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._woehrderCirclesMat;
    }

    getWoehrderRockMat() {
        if (!this._woehrderRockMat) {
            // Dark rough rock/shotcrete cavern ceiling. Tiled at 6m over the 10m-high
            // hall, so the features are drawn coarse: big uneven patches first, then
            // finer speckle on top.
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 1024;
            const ctx = canvas.getContext('2d');
            // Grey-brown exposed-aggregate tones measured from the station photo
            ctx.fillStyle = '#48433a';
            ctx.fillRect(0, 0, 1024, 1024);
            let seed = 24680;
            const random = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };
            // Large uneven patches (warm grey-brown)
            for (let i = 0; i < 260; i++) {
                const g = Math.floor(44 + random() * 46);
                ctx.fillStyle = `rgba(${g + 6},${g + 2},${g - 8},${(0.20 + random() * 0.35).toFixed(2)})`;
                const r = 30 + random() * 110;
                ctx.beginPath();
                ctx.ellipse(random() * 1024, random() * 1024, r, r * (0.35 + random() * 0.55), random() * Math.PI, 0, Math.PI * 2);
                ctx.fill();
            }
            // Finer aggregate speckle: mix of pale beige grains and dark pores
            for (let i = 0; i < 1600; i++) {
                const light = random() < 0.45;
                const g = light ? Math.floor(100 + random() * 55) : Math.floor(24 + random() * 30);
                ctx.fillStyle = `rgba(${g + 8},${g + 3},${g - 8},${(0.25 + random() * 0.40).toFixed(2)})`;
                const r = 3 + random() * 18;
                ctx.beginPath();
                ctx.ellipse(random() * 1024, random() * 1024, r, r * (0.4 + random() * 0.6), random() * Math.PI, 0, Math.PI * 2);
                ctx.fill();
            }
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            this._woehrderRockMat = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._woehrderRockMat;
    }

    getWoehrderChannelMat(chanR) {
        if (!this._woehrderChannelMat) {
            // Aluminium barrel of the suspended light channel, with a shading fade
            // baked around the circumference so the swept cylinder reads as round
            // under the flat ambient light. buildSweptProfile maps V once around
            // the profile (arc length), so repeat.y = 1/circumference stretches the
            // gradient exactly once around; keepWrapAndRepeat preserves that through
            // the profile builder's material clone. The profile starts at the right
            // side (angle 0) and runs counter-clockwise, so V=0.25 is the barrel top.
            const H = 256;
            const canvas = document.createElement('canvas');
            canvas.width = 4;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgb(194,199,203)';
            ctx.fillRect(0, 0, 4, H);
            // Same fade recipe as _makeCylinderPillarMat: dark flanks with narrow
            // bright highlight bands, multiply-blended over the aluminium base.
            // Here the bands sit at V=0 (right flank) and V=0.5 (left flank),
            // so the highlights run along the barrel sides, not top/bottom.
            ctx.globalCompositeOperation = 'multiply';
            const grad = ctx.createLinearGradient(0, H, 0, 0); // canvas bottom = V0 (flipY)
            grad.addColorStop(0,    '#F4F2FB'); // right flank (bright, wraps at V=1)
            grad.addColorStop(0.07, '#7A7975');
            grad.addColorStop(0.43, '#7A7975');
            grad.addColorStop(0.5,  '#F4F2FB'); // left flank (bright)
            grad.addColorStop(0.57, '#7A7975');
            grad.addColorStop(0.93, '#7A7975');
            grad.addColorStop(1,    '#F4F2FB');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 4, H);
            ctx.globalCompositeOperation = 'source-over';
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(1, 1 / (Math.PI * 2 * chanR));
            this._woehrderChannelMat = new THREE.MeshLambertMaterial({ map: texture });
            this._woehrderChannelMat.userData.keepWrapAndRepeat = true;
        }
        return this._woehrderChannelMat;
    }

    getBarrelTextMat(name) {
        // Near-black station name for the standard barrel light channel,
        // cached per station name.
        this._barrelTextMats = this._barrelTextMats || {};
        if (!this._barrelTextMats[name]) {
            const label = name.toUpperCase();
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            const fontFor = (px) => `bold ${px}px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif`;
            let fontPx = 72;
            ctx.font = fontFor(fontPx);
            const w = ctx.measureText(label).width;
            if (w > 960) {
                fontPx = Math.floor(72 * 960 / w);
                ctx.font = fontFor(fontPx);
            }
            ctx.fillStyle = '#141416';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, 512, 64);
            ctx.strokeStyle = '#141416';
            ctx.lineWidth = 1.8;
            ctx.strokeText(label, 512, 64);

            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._barrelTextMats[name] = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this._barrelTextMats[name];
    }

    getRathenauTileMat() {
        if (!this._rathenauTileMat) {
            this._rathenauTileMat = this.createTiledMaterial('#f8fafc', '#cbd5e1', 0.15);
        }
        return this._rathenauTileMat;
    }

    getRathenauQuoteMat() {
        if (!this._rathenauQuoteMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 256);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 54px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("DENKEN HEISST VERGLEICHEN.", 512, 90);
            ctx.font = '42px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.fillText("- WALTHER RATHENAU.", 512, 170);
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._rathenauQuoteMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        }
        return this._rathenauQuoteMat;
    }

    getRathenauTextMat() {
        if (!this._rathenauTextMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("RATHENAUPLATZ", 512, 64);
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 1.8;
            ctx.strokeText("RATHENAUPLATZ", 512, 64);
            
            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._rathenauTextMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this._rathenauTextMat;
    }

    getRathenauHerzlMat() {
        if (!this._rathenauHerzlMat) {
            const loader = new THREE.TextureLoader();
            const herzlUrl = new URL('../assets/Herzl.png', import.meta.url).href;
            const tex = loader.load(herzlUrl);
            tex.colorSpace = THREE.SRGBColorSpace;
            this._rathenauHerzlMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        }
        return this._rathenauHerzlMat;
    }

    getRathenauRathenauMat() {
        if (!this._rathenauRathenauMat) {
            const loader = new THREE.TextureLoader();
            const rathenauUrl = new URL('../assets/Rathenau.png', import.meta.url).href;
            const tex = loader.load(rathenauUrl);
            tex.colorSpace = THREE.SRGBColorSpace;
            this._rathenauRathenauMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        }
        return this._rathenauRathenauMat;
    }

    getGrossreuthUpperTileMat() {
        if (!this._grossreuthUpperTileMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');

            // Metallic base color
            ctx.fillStyle = '#446E98';
            ctx.fillRect(0, 0, 512, 512);

            // Clouds decoration
            ctx.fillStyle = '#446E98';
            ctx.globalAlpha = 0.5;
            ctx.globalCompositeOperation = 'lighter';
            let seed = 123;
            const random = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };
            for (let i = 0; i < 40; i++) {
                const x = random() * 512;
                const y = random() * 512;
                const r = 40 + random() * 80;

                const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, 'rgba(255,255,255,0.4)');
                grad.addColorStop(0.4, 'rgba(255,255,255,0.1)');
                grad.addColorStop(1, 'rgba(255,255,255,0)');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';

            // Tile grid (8 rows)
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 2;
            const rows = 8;
            const cols = 2; // elongated tiles
            const rowH = 512 / rows;
            const colW = 512 / cols;

            for (let r = 0; r <= rows; r++) {
                ctx.beginPath();
                ctx.moveTo(0, r * rowH);
                ctx.lineTo(512, r * rowH);
                ctx.stroke();
            }
            for (let c = 0; c <= cols; c++) {
                ctx.beginPath();
                ctx.moveTo(c * colW, 0);
                ctx.lineTo(c * colW, 512);
                ctx.stroke();
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;

            this._grossreuthUpperTileMat = new THREE.MeshLambertMaterial({ map: texture });
        }
        return this._grossreuthUpperTileMat;
    }

    getGrossreuthSignMat() {
        if (!this._grossreuthSignMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);
            ctx.fillStyle = '#000219';
            ctx.font = 'bold 72px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("GROSSREUTH bei SCHWEINAU", 512, 64);

            const texture = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            texture.anisotropy = 8;
            this._grossreuthSignMat = new THREE.MeshLambertMaterial({ map: texture, transparent: true });
        }
        return this._grossreuthSignMat;
    }

    applyVaultClipping(mat, station, platLength, centerPos, centerAngle) {
        const pos_end = this.sim.getTrackPosition(station.position + platLength / 2);
        const dummy = new THREE.Object3D();
        dummy.position.copy(centerPos);
        dummy.rotation.y = centerAngle;
        dummy.updateMatrixWorld();
        const localPos_end = dummy.worldToLocal(pos_end.clone());
        const curvatureA = localPos_end.x / (localPos_end.z * localPos_end.z);

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uCenterPos = { value: centerPos.clone() };
            shader.uniforms.uCenterAngle = { value: centerAngle };
            shader.uniforms.uCurvatureA = { value: curvatureA };
            
            shader.vertexShader = `
                varying vec3 vWorldPosForClip;
                ${shader.vertexShader}
            `.replace(
                '#include <project_vertex>',
                `
                #include <project_vertex>
                vWorldPosForClip = (modelMatrix * vec4(position, 1.0)).xyz;
                `
            );
            
            shader.fragmentShader = `
                uniform vec3 uCenterPos;
                uniform float uCenterAngle;
                uniform float uCurvatureA;
                varying vec3 vWorldPosForClip;
                ${shader.fragmentShader}
            `.replace(
                '#include <clipping_planes_fragment>',
                `
                #include <clipping_planes_fragment>
                
                vec3 offset = vWorldPosForClip - uCenterPos;
                float c = cos(-uCenterAngle);
                float s = sin(-uCenterAngle);
                float localX = offset.x * c + offset.z * s;
                float localZ = -offset.x * s + offset.z * c;
                
                localX = localX - uCurvatureA * localZ * localZ;
                
                float localY = offset.y;
                
                float dy = localY - 0.865;
                float r = 4.5;
                
                if (dy >= 0.0) {
                    float dz1 = localZ - (-25.0);
                    float dz2 = localZ - (0.0);
                    float dz3 = localZ - (25.0);
                    
                    if (abs(localX) < 5.0) {
                        if (dz1*dz1 + dy*dy < r*r) discard;
                        if (dz2*dz2 + dy*dy < r*r) discard;
                        if (dz3*dz3 + dy*dy < r*r) discard;
                    }
                    
                    if (localZ < -${(platLength / 2 - 4.0).toFixed(3)} || localZ > ${(platLength / 2 - 4.0).toFixed(3)}) {
                        if (abs(localX) < 2.5) {
                            discard;
                        }
                    }
                }
                `
            );
        };
        
        mat.customProgramCacheKey = () => {
            return station.name + '_vaultMat';
        };
    }
}