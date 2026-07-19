// ============================================================================
// TrainModel.js — Komplettes 3D-Zugmodell (G1 / DT1 / DT3) inkl. Cockpit,
// Innenraum, Türanimation, Anzeigen und Faux-Glas-Reflexionen.
//
// KI-LANDKARTE (wo bearbeite ich was):
//   - Modellwahl/Neuaufbau: setTrainModel -> buildTrain -> buildG1Train/
//     buildDT1Train/buildDT3Train. Nach dem Bau backt mergeStaticMeshes alle
//     STATISCHEN Teile pro Domäne zu wenigen Meshes zusammen — NEUE ANIMIERTE
//     TEILE MÜSSEN in die Dynamik-Registries (doors, cabDoors, speedNeedles,
//     brakeNeedles, throttleLevers, dashboardScreens, radioMeshes, lights,
//     interiorDisplays), sonst werden sie mitgemerged und bewegen sich nicht!
//     (Headless-Prüfung: node scratch/train_census.mjs / check_registries.mjs)
//   - Per-Frame-Logik: update(dt) — Wagenausrichtung entlang der Spline (zwei
//     Drehgestelle je Wagen), Türen, Zeiger, Displays. HEISSER PFAD, nur die
//     Modul-Temp-Vektoren oben verwenden, nie allokieren.
//   - Cockpit-Bildschirme: drawLeft/Mid/RightScreen (G1), drawDT1*Screen,
//     updateDT3Monitor (alle gedrosselt). Radio-Display: drawRadioDisplay.
//   - Fahrziel-/Innenanzeigen: updateDestinationSign / updateInteriorDisplays.
//   - G1-Frontgeometrie: g1FrontZ/g1CreaseX/shearG1FrontGeometry (Knicke müssen
//     auf Shape-Grenzen liegen!); DT1-Nase: createDT1TwistedCornerGeometry.
//   - Glas: createFauxGlassMaterial (statische Cubemap, bakeInteriorEnvMap)
//     + echte planare Spiegelung updatePlanarReflections (nur Innen-Kameras).
//     WICHTIG: Wagen-Ursprung liegt am FÜHRENDEN Ende (z läuft 0..-carLength).
// KOORDINATEN: 1 Einheit = 1 m (TRAIN_SCALE = 1.0).
// ============================================================================
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// Reusable temp vectors for update loop to avoid GC stutter
const _carP1 = new THREE.Vector3();
const _carP2 = new THREE.Vector3();
const _carDirZ = new THREE.Vector3();
const _carMidWorld = new THREE.Vector3();
const _carWorldPos = new THREE.Vector3();
const _carLocalPos = new THREE.Vector3();
const _tempTangent = new THREE.Vector3();
const _tempNormal = new THREE.Vector3();
const _tempTangent2 = new THREE.Vector3();
const _tempPos = new THREE.Vector3();

// Temps for the planar window-mirror pass (updatePlanarReflections)
const _mirCamPos = new THREE.Vector3();
const _mirTmp = new THREE.Vector3();
const _mirPoint = new THREE.Vector3();
const _mirNormal = new THREE.Vector3();
const _mirView = new THREE.Vector3();
const _mirLook = new THREE.Vector3();
const _mirTarget = new THREE.Vector3();
const _mirRot = new THREE.Matrix4();
const _mirRotCam = new THREE.Matrix4();
const _mirPlane = new THREE.Plane();
const _mirClip = new THREE.Vector4();
const _mirQ = new THREE.Vector4();
const _mirClearColor = new THREE.Color();

// Längsmaßstab des Zugmodells: 1 Einheit = 1 Meter (zuvor 0.7075-Stauchung, jetzt 1:1 zur Welt).
const TRAIN_SCALE = 1.0;

// G1: real Faltenbalg (gangway bellows) length per car end, 401mm.
const G1_BELLOWS_LEN = 0.401;

// Cheap stand-in for MeshStandardMaterial: the scene has no environment map, so the PBR
// shader only adds per-pixel cost without a visual payoff. Maps the PBR metalness /
// roughness inputs onto a Phong specular so glossy parts (front mask, chrome) keep
// their highlights. All other constructor params (color, map, side, ...) pass through.
function cheapMaterial(params) {
    const { metalness, roughness, color, ...rest } = params;
    const baseColor = new THREE.Color(color || '#ffffff');
    baseColor.multiplyScalar(0.5); // Dim by 50%
    return new THREE.MeshBasicMaterial({ ...rest, color: baseColor, fog: false });
}

export class TrainModel {
    constructor(scene, simulation) {
        this.scene = scene;
        this.sim = simulation;

        // Root group for the entire train
        this.group = new THREE.Group();
        this.scene.add(this.group);
        
        // Individual door leaf references for animation
        this.doors = []; // Array of { meshL, meshR, baseZ, carIdx, side }

        // Hinged driver cab doors (G1): { pivot, sign, side, carIdx }
        this.cabDoors = [];
        this.cabDoorOpen = false;
        this.cabDoorProgress = 0;
        this.activeCabDoor = null; // { carIdx, side } set when opening

        // Dynamic passenger information displays inside carriage ends
        this.interiorDisplays = [];
        this.lastDisplayText = "";
        
        // Animated speedometer needles & throttle levers in cockpit
        this.speedNeedles = [];
        this.brakeNeedles = []; // { hbl, bz, hblSmoothed, bzSmoothed }
        this.throttleLevers = [];
        
        // Dynamic dashboard screens for Cab A and Cab B
        this.dashboardScreens = [];
        this.screenUpdateTimer = 0;

        // Clickable cab radio meshes (raycast targets for the radio menu)
        this.radioMeshes = [];
        // Canvas/texture handles for the in-cab radio display screens (one per cab),
        // kept so updateRadioDisplay() can redraw station/song name onto them live.
        this.radioDisplays = [];

        // Front and rear headlights/taillights refs for toggling
        this.lights = {
            frontWhite: [],
            frontRed: [],
            rearWhite: [],
            rearRed: []
        };
        
        // Carriage groups for individual track curve alignment
        this.carriages = [];
        
        // Destination screen materials
        this.destScreenMat = null;
        this.dt1DestScreenMat = null;

        // Static faux-reflection environment for all glass. The procedural
        // cubemap is only a stand-in until bakeInteriorEnvMap() replaces it
        // with a one-time CubeCamera snapshot of the real interior (called
        // from warmUpRenderer, so it also re-bakes on a G1<->DT1 switch).
        // Either way the map is static afterwards: no per-frame updates,
        // one cube sample per glass fragment.
        this.proceduralEnvMap = this.createInteriorEnvMap();
        this.interiorEnvMap = this.proceduralEnvMap;
        this.interiorEnvBakeTarget = null;

        // Shared materials
        this.materials = {
            bodyRedG1: cheapMaterial({ color: '#c21d2c', metalness: 0.1, roughness: 0.3, side: THREE.DoubleSide }), // Nuremberg G1 Red; DoubleSide so the side bevels read from inside the cab too
            bodyRedDT1: cheapMaterial({ color: '#ac3333', metalness: 0.1, roughness: 0.3, side: THREE.DoubleSide }), // Nuremberg DT1 Red; DoubleSide so the twisted nose corner reads from inside the cab too
            bodyWhite: cheapMaterial({ color: '#e6e8eb', metalness: 0.1, roughness: 0.4, side: THREE.DoubleSide }), // Off-white middle stripe; DoubleSide so the twisted nose corner reads from inside the cab too
            bellowsLightGrey: cheapMaterial({ color: '#b0b3b8', metalness: 0.1, roughness: 0.7 }),
            bodyDarkGrey: cheapMaterial({ color: '#1c1e22', metalness: 0.2, roughness: 0.6 }), // Window band and roof
            bodyGlossBlack: cheapMaterial({ color: '#0b0d10', metalness: 0.4, roughness: 0.25 }), // G1 glossy black front mask
            bodyGrey: cheapMaterial({ color: '#2e3033', metalness: 0.3, roughness: 0.5 }), // Underframe
            bodyBumperGrey: cheapMaterial({ color: '#43474d', metalness: 0.35, roughness: 0.55 }), // G1 front skirt block
            cabDoorGrey: cheapMaterial({ color: '#1a1c20', metalness: 0.3, roughness: 0.35 }), // G1 cab door on the black flank
            dt1DoorRubberLip: cheapMaterial({ color: '#4a4d51', metalness: 0.05, roughness: 0.9, side: THREE.DoubleSide }), // DT1 door rubber lips, static and dark gray
            cockpitTrim: cheapMaterial({ color: '#252931', roughness: 0.85, side: THREE.DoubleSide }), // G1 interior A-pillar trim — a shade darker than the dashboard panel casing (#2c303a)
            cockpitInteriorDark: cheapMaterial({ color: '#626058', roughness: 0.8, side: THREE.DoubleSide }), // G1 interior B-pillars and window surrounds (#31302C)
            cockpitCeiling: cheapMaterial({ color: '#666666', roughness: 0.8, side: THREE.DoubleSide }), // G1 interior cockpit ceiling (#333333)
            floorGrey: this.createFloorMaterial(),
            fabricRed: this.createFabricMaterial(),
            ceilingGreyG1: cheapMaterial({ color: '#8D8B8B', metalness: 0.1, roughness: 0.8, side: THREE.DoubleSide }),
            interiorWallG1: cheapMaterial({ color: '#BFC1C0', metalness: 0.1, roughness: 0.8, side: THREE.DoubleSide }), // G1 interior wall lining (window band frames, panels)
            // Args swapped vs. the texture's own defaults: canvas top (offset 0) ends up at v=1 (the
            // fillet's ceiling/top edge) after three's default flipY, so passing the light color first
            // puts it up top and the dark color - at offset 1/canvas bottom - down at v=0 (the wall edge).
            g1WallCeilingFillet: new THREE.MeshBasicMaterial({ map: this.createWallCeilingFilletTexture('#C1BFC5', '#524F50'), side: THREE.DoubleSide, fog: false }), // rounded wall-to-ceiling coving, dark at the wall fading to light at the ceiling
            cockpitFloor: cheapMaterial({ color: '#bcbcbc', metalness: 0.1, roughness: 0.8 }),
            currentCollectorYellow: cheapMaterial({ color: '#ffcc00', metalness: 0.1, roughness: 0.5 }), // Stromabnehmer yellow
            skirtGrey: cheapMaterial({ color: '#53565f', metalness: 0.1, roughness: 0.5 }), // G1 dark grey skirt stripe
            underbodyOrange: cheapMaterial({ color: '#d35400', metalness: 0.1, roughness: 0.6 }), // DT1 orange box
            windowGlass: this.createFauxGlassMaterial({ tint: '#ffffff', opacity: 0.02, reflectivity: 0.30 }),
            // Cab side windows and doors: reflectivity 0.30 (same as passenger windowGlass)
            cabWindowGlass: this.createFauxGlassMaterial({ tint: '#ffffff', opacity: 0.02, reflectivity: 0.30 }),
            windshieldGlass: this.createFauxGlassMaterial({ tint: '#ffffff', opacity: 0.02, reflectivity: 0 }), // no reflection, so the driver's forward view stays clear
            partitionGlass: this.createFauxGlassMaterial({ tint: '#000000', opacity: 0.50, reflectivity: 0 }), // cab rear-wall (Rückwand) panes: 50% tinted, no reflection (per user request)
            dt1PartitionGlass: this.createFauxGlassMaterial({ tint: '#ffffff', opacity: 0.05, reflectivity: 0 }),
            wheel: cheapMaterial({ color: '#111111', metalness: 0.8, roughness: 0.6 }),
            cockpitFloorG1: this.createNoppenFloorMaterial(),
            lightGlowWhite: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
            lightGlowWarm: new THREE.MeshBasicMaterial({ color: '#FEFEFC', fog: false }),
            lightGlowRed: new THREE.MeshBasicMaterial({ color: 0xcc0000, fog: false }),
            chromeMetal: cheapMaterial({ color: '#cccccc', metalness: 0.95, roughness: 0.1 }), // Chrome logo & coupler
            // Additive billboard glow for headlights (no depth write = no sorting issues)
            glowSpriteWhite: new THREE.SpriteMaterial({
                map: this.createGlowTexture(),
                color: 0xffffff,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }),
            glowSpriteRed: new THREE.SpriteMaterial({
                map: this.createGlowTexture(),
                color: 0xff2200,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }),
            
            // DT1 specific retro materials
            dt1Ceiling: new THREE.MeshBasicMaterial({ color: '#9D8667', side: THREE.DoubleSide, fog: false }), // custom beige ceiling
            dt1Floor: this.createDT1FloorMaterial(), // retro grey speckled floor
            dt1SeatBlue: new THREE.MeshBasicMaterial({ map: this.createSeatGradientTexture(), fog: false }), // retro dark blue seats (Image 2)
            dt1SeatRed: new THREE.MeshBasicMaterial({ color: new THREE.Color('#c21d2c').multiplyScalar(0.5), fog: false }), // DT3 test-train variant: red seats, otherwise identical to DT1
            dt1SeatGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a2e1a').multiplyScalar(0.5), fog: false }), // driver seat (dark green/black)
            dt1Handrail: new THREE.MeshBasicMaterial({ map: this.createHandrailGradientTexture(), fog: false }), // retro gold-beige handrails
            dt1Wall: new THREE.MeshBasicMaterial({ map: this.createWoodTexture(), color: '#808080', side: THREE.DoubleSide, fog: false }), // retro golden wood panels (Image 2); DoubleSide so it doesn't vanish when viewed from inside the cab
            dt1Slant: new THREE.MeshBasicMaterial({ color: '#948170', side: THREE.DoubleSide, fog: false }), // slanted cove panels
            dt1Roof: cheapMaterial({ color: '#68756B', metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide }), // custom outer roof color

            // DT3 specific custom materials
            dt3Red: cheapMaterial({ color: '#b1271d', metalness: 0.1, roughness: 0.3, side: THREE.DoubleSide }),
            dt3WhiteOuter: cheapMaterial({ color: '#ccd3cb', metalness: 0.1, roughness: 0.4, side: THREE.DoubleSide }),
            dt3WhiteInner: cheapMaterial({ color: '#d3c6b5', metalness: 0.1, roughness: 0.4, side: THREE.DoubleSide }),
            dt3FabricRed: this.createFabricMaterial('#b1271d'),
            dt3PoleGrey: cheapMaterial({ color: '#d2d4d6', metalness: 0.2, roughness: 0.5 }),
            dt3DoorInner: cheapMaterial({ color: '#a9a290', metalness: 0.1, roughness: 0.4, side: THREE.DoubleSide })
        };

        // DT3 temporary monitor material
        this.dt3MonitorCanvas = document.createElement('canvas');
        this.dt3MonitorCanvas.width = 256;
        this.dt3MonitorCanvas.height = 256;
        this.dt3MonitorCtx = this.dt3MonitorCanvas.getContext('2d');
        
        // Fill canvas with black initially
        this.dt3MonitorCtx.fillStyle = '#0f172a';
        this.dt3MonitorCtx.fillRect(0, 0, 256, 256);
        
        this.dt3MonitorTexture = new THREE.CanvasTexture(this.dt3MonitorCanvas);
        this.dt3MonitorTexture.colorSpace = THREE.SRGBColorSpace;
        this.dt3MonitorMat = new THREE.MeshBasicMaterial({ map: this.dt3MonitorTexture, side: THREE.DoubleSide, fog: false });

        // DT3 front destination sign material
        this.dt3DestCanvas = document.createElement('canvas');
        this.dt3DestCanvas.width = 512;
        this.dt3DestCanvas.height = 128;
        this.dt3DestCtx = this.dt3DestCanvas.getContext('2d');
        
        // Fill canvas with background color #14100f
        this.dt3DestCtx.fillStyle = '#14100f';
        this.dt3DestCtx.fillRect(0, 0, 512, 128);
        
        this.dt3DestTexture = new THREE.CanvasTexture(this.dt3DestCanvas);
        this.dt3DestTexture.colorSpace = THREE.SRGBColorSpace;
        this.dt3DestMat = new THREE.MeshBasicMaterial({ map: this.dt3DestTexture, side: THREE.DoubleSide, fog: false });

        this.trainType = 'G1';
        this.seatVariant = 'blue'; // DT1 passenger seat livery: 'blue' (default) or 'red' (DT3 test train)
        this.createInteriorDisplayMaterial();
        this.initSharedGeometries();
        this.buildTrain();
    }

    initSharedGeometries() {
        this.geometries = {
            dt1LowerRed: new THREE.BoxGeometry(0.04, 0.705, 1),
            dt1WhiteBand: new THREE.BoxGeometry(0.04, 0.12, 1),
            dt1TopRed: new THREE.BoxGeometry(0.04, 0.325, 1),
            dt1IntBottom: new THREE.BoxGeometry(0.01, 0.975, 1),
            dt1IntTop: new THREE.BoxGeometry(0.01, 0.525, 1),
            dt1IntPillar: new THREE.BoxGeometry(0.01, 0.93, 1),
            dt1BottomRail: new THREE.BoxGeometry(0.04, 0.15, 1),
            dt1TopRail: new THREE.BoxGeometry(0.04, 0.2, 1),
            dt1Pillar: new THREE.BoxGeometry(0.04, 0.93, 1),
            dt1Floor: new THREE.BoxGeometry(2.88, 0.05, 1),
            dt1Roof: new THREE.BoxGeometry(2.82, 0.08, 1),
            dt1Ceiling: new THREE.BoxGeometry(2.80, 0.01, 1),
            dt1Chassis: new THREE.BoxGeometry(2.86, 0.08, 1),
            dt1LightFixture: new THREE.BoxGeometry(0.12, 0.02, 1.8)
        };
    }

    setTrainModel(type, seatVariant = 'blue') {
        if (this.trainType === type && this.seatVariant === seatVariant) return;
        this.trainType = type;
        this.seatVariant = seatVariant;

        // Free GPU resources of the old build before dropping the references —
        // without this every G1<->DT1 switch leaks ~1800 geometries plus the
        // per-build canvas textures in VRAM.
        this.disposeTrainResources();

        // Clear all children of this.group
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
        }

        // Reset all references
        this.doors = [];
        this.cabDoors = [];
        this.cabDoorOpen = false;
        this.cabDoorProgress = 0;
        this.activeCabDoor = null;
        this.interiorDisplays = [];
        this.speedNeedles = [];
        this.brakeNeedles = []; // { hbl, bz, hblSmoothed, bzSmoothed }
        this.throttleLevers = [];
        this.dashboardScreens = [];
        this.radioMeshes = [];
        this.radioDisplays = [];
        this.lights = {
            frontWhite: [],
            frontRed: [],
            rearWhite: [],
            rearRed: []
        };
        this.carriages = [];
        this.lastDisplayText = "";
        this.lastDisplayKey = "";
        this.dt1DestScreenMat = null;
        
        // Rebuild the selected train model
        this.buildTrain();
        
        // Force immediate alignment
        this.update(0);
    }

    buildTrain() {
        const S = TRAIN_SCALE;
        if (this.trainType === 'DT1') {
            this.carLength = 18.575 * S;
            this.carWidth = 2.90 * S;
            this.buildDT1Train();
        } else if (this.trainType === 'DT3') {
            this.carLength = 19.0425 * S;
            this.carWidth = 2.90 * S;
            this.buildDT3Train();
        } else {
            this.carLength = 19.270 * S;
            this.carWidth = 2.90 * S;
            this.buildG1Train();
        }
        this.mergeStaticMeshes();
    }

    // All scene-graph objects that are animated, toggled or raycast at runtime
    // and therefore must survive the static-geometry merge as individual nodes.
    // Collected from the same registries the update loop works with, so a new
    // dynamic part only needs to be registered once.
    collectDynamicObjects() {
        const dynamic = new Set();
        const registries = [
            this.doors, this.cabDoors, this.interiorDisplays, this.speedNeedles,
            this.brakeNeedles, this.throttleLevers, this.dashboardScreens,
            this.radioMeshes, this.radioDisplays,
            this.lights.frontWhite, this.lights.frontRed,
            this.lights.rearWhite, this.lights.rearRed
        ];
        for (const registry of registries) {
            for (const entry of registry) {
                if (!entry) continue;
                if (entry.isObject3D) {
                    dynamic.add(entry);
                } else if (typeof entry === 'object') {
                    for (const value of Object.values(entry)) {
                        if (value && value.isObject3D) dynamic.add(value);
                    }
                }
            }
        }
        return dynamic;
    }

    // The build methods produce one mesh per construction part (~2700 per train),
    // which makes the train cost ~2700 draw calls whenever it is on screen. Bake
    // all static parts of each carriage down to one mesh per material; carriages
    // stay separate groups because they articulate individually along the track
    // curve. Dynamic parts (doors, needles, lights, raycast targets, ...) are
    // left untouched.
    mergeStaticMeshes() {
        const dynamicRoots = this.collectDynamicObjects();
        const sharedGeos = new Set(Object.values(this.geometries));
        this.group.updateMatrixWorld(true);

        let before = 0;
        this.group.traverse(o => { if (o.isMesh) before++; });

        // Merge domains: the four carriage groups, plus every dynamic group
        // (door leaves, cab-door pivots, ...) — those move as rigid bodies, so
        // their child meshes are static relative to the group and merge within it.
        const domains = [...this.carriages];
        for (const root of dynamicRoots) {
            if (root.children.length > 0) domains.push(root);
        }
        for (const domain of domains) {
            this.mergeDomain(domain, dynamicRoots, sharedGeos);
        }

        let after = 0;
        this.group.traverse(o => { if (o.isMesh) after++; });
        console.log(`TrainModel (${this.trainType}): Geometry-Merging ${before} -> ${after} Meshes`);
    }

    // Merges all static meshes underneath `root` into one mesh per material,
    // added directly to `root`. Skipped: nested dynamic subtrees (they form
    // their own domain), hidden subtrees, meshes with children (their subtree
    // would be torn apart on removal), multi-material meshes and custom
    // renderOrder (DT1 destination sign decal).
    mergeDomain(root, dynamicRoots, sharedGeos) {
        const buckets = new Map();
        const collect = (node) => {
            if (!node.visible || (node !== root && dynamicRoots.has(node))) return;
            if (node !== root && node.isMesh && node.children.length === 0 &&
                !Array.isArray(node.material) && node.renderOrder === 0 &&
                !node.material.transparent) {
                let list = buckets.get(node.material);
                if (!list) buckets.set(node.material, list = []);
                list.push(node);
            }
            for (const child of node.children) collect(child);
        };
        collect(root);

        const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
        const relMatrix = new THREE.Matrix4();

        for (const [material, meshes] of buckets) {
            if (meshes.length < 2) continue; // nothing gained by merging one mesh

            // Bake each mesh's root-relative transform into a geometry copy
            const geos = [];
            for (const mesh of meshes) {
                const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
                relMatrix.copy(invRoot).multiply(mesh.matrixWorld);
                geo.applyMatrix4(relMatrix);
                geos.push(geo);
            }

            // mergeGeometries() requires identical attribute sets: reduce to
            // position/normal/uv and fill gaps (zero-uvs only ever land on
            // untextured materials, textured parts all carry real uvs).
            const needsUv = geos.some(g => g.attributes.uv);
            for (const geo of geos) {
                for (const name of Object.keys(geo.attributes)) {
                    if (name !== 'position' && name !== 'normal' && name !== 'uv') {
                        geo.deleteAttribute(name);
                    }
                }
                if (!geo.attributes.normal) geo.computeVertexNormals();
                if (needsUv && !geo.attributes.uv) {
                    const count = geo.attributes.position.count;
                    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
                }
            }

            const merged = BufferGeometryUtils.mergeGeometries(geos, false);
            if (!merged) continue; // keep the originals if merging failed

            const mergedMesh = new THREE.Mesh(merged, material);
            mergedMesh.matrixAutoUpdate = false; // static child of the animated domain root
            root.add(mergedMesh);

            for (const mesh of meshes) {
                mesh.parent.remove(mesh);
                if (!sharedGeos.has(mesh.geometry)) mesh.geometry.dispose();
            }
        }
    }

    // Frees the GPU resources of the current build. Shared assets that survive
    // a G1<->DT1 rebuild (this.materials, this.geometries, the persistent
    // destination/interior display materials) are excluded.
    disposeTrainResources() {
        const sharedMats = new Set(Object.values(this.materials));
        if (this.interiorDisplayMat) sharedMats.add(this.interiorDisplayMat);
        if (this.destScreenMat) sharedMats.add(this.destScreenMat);
        const sharedGeos = new Set(Object.values(this.geometries));
        const sharedTextures = new Set();
        for (const m of sharedMats) {
            if (m.map) sharedTextures.add(m.map);
        }

        this.group.traverse(o => {
            if (!o.isMesh && !o.isSprite) return;
            if (o.geometry && !sharedGeos.has(o.geometry)) o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (!m || sharedMats.has(m)) continue;
                if (m.map && !sharedTextures.has(m.map)) m.map.dispose();
                m.dispose();
            }
        });
    }

    getCarriageProperties(i) {
        if (this.trainType === 'G1') {
            // Real-world G1 dimensions (incl. Faltenbalg/gangway bellows):
            // cockpit cars (0/3) = 19.270m, middle cars (1/2) = 18.815m
            const lengths = [19.270, 18.815, 18.815, 19.270];
            const startOffsets = [0, -19.270, -38.085, -56.900];
            return { length: lengths[i], startOffset: startOffsets[i] };
        } else if (this.trainType === 'DT3') {
            const carLength = 19.0425; // half of G1 (76.170 / 2)
            const startOffsets = [0, -19.0425];
            return { length: carLength, startOffset: startOffsets[i] };
        } else {
            const carLength = 18.575;
            let startOffset = -i * carLength;
            if (i >= 2) startOffset -= 1.20; // 1.20 m extra gap between the two double-units
            return { length: carLength, startOffset: startOffset };
        }
    }

    getDT3DoorEdges(i) {
        const dHalf = 0.8725;
        if (i === 0) {
            return [
                { lead: -4.3755 + dHalf, trail: -4.3755 - dHalf },
                { lead: -9.9325 + dHalf, trail: -9.9325 - dHalf },
                { lead: -15.4895 + dHalf, trail: -15.4895 - dHalf }
            ];
        } else {
            return [
                { lead: -3.553 + dHalf, trail: -3.553 - dHalf },
                { lead: -9.11 + dHalf, trail: -9.11 - dHalf },
                { lead: -14.667 + dHalf, trail: -14.667 - dHalf }
            ];
        }
    }

    getDT3Windows(i) {
        const hasFrontCab = (i === 0);
        const int1_end = hasFrontCab ? -1.44 : 0;
        const int4_start = hasFrontCab ? -19.0425 : -17.6025;
        const p = 0.314;
        const w = 1.435;
        const d = 1.745;
        const dHalf = d / 2;
        const sectionEnd = p + w + p;
        const sectionMid = p + w + p + w + p;

        const doorPositionsZ = hasFrontCab ? 
            [-4.3755, -9.9325, -15.4895] : 
            [-3.553, -9.11, -14.667];

        const intervals = [
            { zMin: doorPositionsZ[0] + dHalf, zMax: int1_end },
            { zMin: doorPositionsZ[1] + dHalf, zMax: doorPositionsZ[0] - dHalf },
            { zMin: doorPositionsZ[2] + dHalf, zMax: doorPositionsZ[1] - dHalf },
            { zMin: int4_start, zMax: doorPositionsZ[2] - dHalf }
        ];

        const windows = [];
        intervals.forEach(interval => {
            const z1 = Math.min(interval.zMin, interval.zMax);
            const z2 = Math.max(interval.zMin, interval.zMax);
            const zLength = z2 - z1;
            if (zLength <= 0.001) return;

            const zCenter = (z1 + z2) / 2;
            if (zLength >= 3.8) {
                const wWidth = 1.435;
                const midPillar = 0.32;
                const totalW = 2 * wWidth + midPillar;
                const sidePillar = (zLength - totalW) / 2;
                windows.push({ start: z1 + sidePillar, end: z1 + sidePillar + wWidth });
                windows.push({ start: z1 + sidePillar + wWidth + midPillar, end: z1 + sidePillar + wWidth + midPillar + wWidth });
            } else if (zLength >= 2.0) {
                const wWidth = 1.435;
                windows.push({ start: zCenter - wWidth/2, end: zCenter + wWidth/2 });
            }
        });

        return windows;
    }

    // Door centers (Z), front-to-back, derived from the real edge measurements
    // in getG1DoorEdges() below.
    getG1DoorPositions(i) {
        if (i === 0) {
            return [-4.389, -9.957, -15.525];
        } else if (i === 3) {
            return [-14.881, -9.313, -3.745];
        } else {
            return [-3.803, -9.4075, -15.012];
        }
    }

    // Leading (nose-proximal) / trailing (nose-distal) edges of each of the 3
    // double doors, front-to-back. Cockpit cars are chained from the nose tip
    // (3571mm to door1's leading edge, 3932mm between facing door edges, door
    // width 1636mm). Middle cars are anchored from both Faltenbalg edges
    // (2584mm to door1/door3's near edge), with door2 centered to absorb the
    // ~69mm rounding slack against the 3934mm door-to-door spec symmetrically.
    getG1DoorEdges(i) {
        if (i === 0) {
            return [
                { lead: -3.571, trail: -5.207 },
                { lead: -9.139, trail: -10.775 },
                { lead: -14.707, trail: -16.343 }
            ];
        } else if (i === 3) {
            const carLen = 19.270;
            const mirror = (z) => -(carLen - Math.abs(z));
            return this.getG1DoorEdges(0).slice().reverse().map(e => ({
                lead: mirror(e.trail),
                trail: mirror(e.lead)
            }));
        } else {
            return [
                { lead: -2.985, trail: -4.621 },
                { lead: -8.5895, trail: -10.2255 },
                { lead: -14.194, trail: -15.830 }
            ];
        }
    }

    // Explicit window rectangles (real measurements: 1364x1204 standard,
    // 1000x1043 middle-car end windows next to the Faltenbalg (edges 449mm from
    // the adjacent door), 161mm window-window gap, 449mm window-door gap.
    // The narrow window behind the cab's B-pillar sits right behind the driver
    // door (~0.42m gap), is shorter (1.00m) and its top sits below the standard
    // window line — matching the reference photo).
    getG1Windows(i) {
        const cockpitWindows = [
            { start: -2.63, end: -2.13, height: 1.00 }, // narrow B-pillar window behind the driver door
            { start: -7.0925, end: -5.7285, height: 1.204 },
            { start: -8.6175, end: -7.2535, height: 1.204 },
            { start: -12.6605, end: -11.2965, height: 1.204 },
            { start: -14.1855, end: -12.8215, height: 1.204 },
            { start: -17.354, end: -16.792, height: 1.204 }
        ];
        const middleWindows = [
            { start: -2.536, end: -1.536, height: 1.043 },
            { start: -6.52475, end: -5.16075, height: 1.204 },
            { start: -8.04975, end: -6.68575, height: 1.204 },
            { start: -12.12925, end: -10.76525, height: 1.204 },
            { start: -13.65425, end: -12.29025, height: 1.204 },
            { start: -17.279, end: -16.279, height: 1.043 }
        ];
        if (i === 0) return cockpitWindows;
        if (i === 3) {
            const carLen = 19.270;
            const mirror = (z) => -(carLen - Math.abs(z));
            return cockpitWindows.map(w => ({
                start: mirror(w.end),
                end: mirror(w.start),
                height: w.height
            }));
        }
        return middleWindows;
    }

    getG1BodyZBounds(i) {
        const carLength = (i === 0 || i === 3) ? 19.270 : 18.815;
        if (i === 0) {
            return { front: -1.9, rear: -(carLength - G1_BELLOWS_LEN) };
        } else if (i === 3) {
            return { front: -G1_BELLOWS_LEN, rear: -(carLength - 1.9) };
        } else {
            return { front: -G1_BELLOWS_LEN, rear: -(carLength - G1_BELLOWS_LEN) };
        }
    }

    buildG1Train() {
        const S = TRAIN_SCALE;
        // 4 Carriages total (local Z = 0 is train front)
        for (let i = 0; i < 4; i++) {
            const { length: carLength, startOffset: carOffsetZ } = this.getCarriageProperties(i);
            const isFrontCab = (i === 0);
            const isRearCab = (i === 3);
            
            const carGroup = new THREE.Group();
            carGroup.position.set(0, 0.465 * S, carOffsetZ);
            carGroup.scale.set(S, S, S);
            this.group.add(carGroup);
            this.carriages.push(carGroup);

            // 1. Hollow Carriage body panels
            const bounds = this.getG1BodyZBounds(i);
            const bodyLength = bounds.front - bounds.rear;
            const bodyPosZ = (bounds.front + bounds.rear) / 2;
            
            const wallMaterial = this.materials.bodyRedG1;
            const whiteMaterial = this.materials.bodyWhite; // exterior middle stripe only
            const interiorWhiteMaterial = this.materials.interiorWallG1; // interior-facing linings/frames
            const darkGreyMaterial = this.materials.bodyGlossBlack; // G1 window band is glossy black (see photos)
            const roofMaterial = this.materials.bodyDarkGrey;
            const floorMaterial = this.materials.floorGrey;
            const glassMaterial = this.materials.windowGlass;
 
            // Floor: stops at the interior wall face (X = ±1.40, matching
            // intBottom below), not the full 2.88 body width - it used to
            // reach X = ±1.44, exactly overlapping the exterior grey skirt
            // stripe's top face (Y = 0.40 for both) over the X range
            // 1.41-1.44, which z-fought there.
            const floorGeom = new THREE.BoxGeometry(2.80, 0.05, bodyLength);
            this.applyBoxUVs(floorGeom, 2.80, 0.05, bodyLength, 2.0); // 2.0 scale = 0.5m tiles
            const floor = new THREE.Mesh(floorGeom, floorMaterial);
            floor.position.set(0, 0.375, bodyPosZ);
            carGroup.add(floor);
 
            const doorEdges = this.getG1DoorEdges(i); // front-to-back: {lead, trail}
            const intervals = [
                { zMin: doorEdges[0].lead, zMax: bounds.front },
                { zMin: doorEdges[1].lead, zMax: doorEdges[0].trail },
                { zMin: doorEdges[2].lead, zMax: doorEdges[1].trail },
                { zMin: bounds.rear,       zMax: doorEdges[2].trail }
            ];
            const g1WindowRects = this.getG1Windows(i);
 
            // Side Walls build helper
            const buildSideWallsForSide = (xSign) => {
                intervals.forEach(interval => {
                    const z1 = Math.min(interval.zMin, interval.zMax);
                    const z2 = Math.max(interval.zMin, interval.zMax);
                    const zLength = z2 - z1;
                    if (zLength <= 0.001) return;
 
                    const zCenter = (z1 + z2) / 2;
 
                    // Red bottom stripe: Y = 0.40 to 0.60 (height 0.2, centered Y = 0.50)
                    const bottomRedGeom = new THREE.BoxGeometry(0.04, 0.2, zLength);
                    const bottomRed = new THREE.Mesh(bottomRedGeom, wallMaterial);
                    bottomRed.position.set(xSign * 1.43, 0.50, zCenter);
                    carGroup.add(bottomRed);

                    // Grey bottom skirt: Y = 0.00 to 0.40 (height 0.40, centered Y = 0.20, color #53565f)
                    const bottomGreyGeom = new THREE.BoxGeometry(0.04, 0.40, zLength);
                    const bottomGrey = new THREE.Mesh(bottomGreyGeom, this.materials.skirtGrey);
                    bottomGrey.position.set(xSign * 1.43, 0.20, zCenter);
                    carGroup.add(bottomGrey);
 
                    // Middle white stripe: Y = 0.60 to 1.20 (height 0.60, centered Y = 0.90)
                    const midWhiteGeom = new THREE.BoxGeometry(0.04, 0.60, zLength);
                    const midWhite = new THREE.Mesh(midWhiteGeom, whiteMaterial);
                    midWhite.position.set(xSign * 1.43, 0.90, zCenter);
                    carGroup.add(midWhite);
 
                    // Top red stripe: Y = 2.55 to 2.85 (height 0.30, centered Y = 2.70)
                    const topRedGeom = new THREE.BoxGeometry(0.04, 0.30, zLength);
                    const topRed = new THREE.Mesh(topRedGeom, wallMaterial);
                    topRed.position.set(xSign * 1.43, 2.70, zCenter);
                    carGroup.add(topRed);
 
                    // --- Interior Wall Linings (Light Grey/Off-white on inside face) ---
                    // Bottom interior panel (covers Y = 0.375 to 1.20)
                    const intBottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.825, zLength), interiorWhiteMaterial);
                    intBottom.position.set(xSign * 1.40, 0.7875, zCenter);
                    carGroup.add(intBottom);

                    // Top interior panel (covers Y = 2.55 to 2.85)
                    const intTop = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.30, zLength), interiorWhiteMaterial);
                    intTop.position.set(xSign * 1.40, 2.70, zCenter);
                    carGroup.add(intTop);

                    // Window band: Y = 1.20 to 2.55 (height 1.35)
                    // Bottom rail: split into outer (dark grey) and inner (white/hellgrau)
                    const bottomRailOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, zLength), darkGreyMaterial);
                    bottomRailOuter.position.set(xSign * 1.44, 1.275, zCenter);
                    const bottomRailInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, zLength), interiorWhiteMaterial);
                    bottomRailInner.position.set(xSign * 1.41, 1.275, zCenter);
                    carGroup.add(bottomRailOuter, bottomRailInner);

                    // Top rail: split into outer (dark grey) and inner (white/hellgrau)
                    const topRailOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.20, zLength), darkGreyMaterial);
                    topRailOuter.position.set(xSign * 1.44, 2.45, zCenter);
                    const topRailInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.20, zLength), interiorWhiteMaterial);
                    topRailInner.position.set(xSign * 1.41, 2.45, zCenter);
                    carGroup.add(topRailOuter, topRailInner);
 
                    // Windows & pillars: windows use the real measured rectangles
                    // (getG1Windows); pillars fill whatever remains in the interval.
                    const windows = g1WindowRects
                        .filter(w => w.start >= z1 - 0.01 && w.end <= z2 + 0.01)
                        .sort((a, b) => a.start - b.start);

                    let pillars = [];
                    let cursor = z1;
                    windows.forEach(w => {
                        if (w.start - cursor > 0.001) pillars.push({ start: cursor, end: w.start });
                        cursor = w.end;
                    });
                    if (z2 - cursor > 0.001) pillars.push({ start: cursor, end: z2 });

                    // Build glass
                    windows.forEach(w => {
                        const wWidth = w.end - w.start;
                        const wCenter = (w.start + w.end) / 2;
                        const wHeight = w.height;
                        const glassGeom = new THREE.BoxGeometry(0.02, wHeight, wWidth);
                        const glass = new THREE.Mesh(glassGeom, glassMaterial);
                        // x 1.435 (not 1.43): at 1.43 the pane's inner face (1.42) was
                        // exactly coplanar with the white inner frames' outer face →
                        // z-fighting flicker strips at every window edge.
                        glass.position.set(xSign * 1.435, 1.85, wCenter);
                        carGroup.add(glass);

                        const frameLeftOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, wHeight, 0.05), darkGreyMaterial);
                        frameLeftOuter.position.set(xSign * 1.44, 1.85, w.start);
                        const frameLeftInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, wHeight, 0.05), interiorWhiteMaterial);
                        frameLeftInner.position.set(xSign * 1.41, 1.85, w.start);

                        const frameRightOuter = frameLeftOuter.clone();
                        frameRightOuter.position.z = w.end;
                        const frameRightInner = frameLeftInner.clone();
                        frameRightInner.position.z = w.end;

                        carGroup.add(frameLeftOuter, frameLeftInner, frameRightOuter, frameRightInner);
                    });
 
                    // Build pillars
                    pillars.forEach(p => {
                        const pWidth = p.end - p.start;
                        const pCenter = (p.start + p.end) / 2;
                        if (pWidth <= 0.001) return;
                        const pillarOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.00, pWidth), darkGreyMaterial);
                        pillarOuter.position.set(xSign * 1.44, 1.85, pCenter);
                        const pillarInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.00, pWidth), interiorWhiteMaterial);
                        pillarInner.position.set(xSign * 1.41, 1.85, pCenter);
                        carGroup.add(pillarOuter, pillarInner);
                    });
                });
            };
 
            buildSideWallsForSide(-1);
            buildSideWallsForSide(1);


            // Roof (Red/Flatter) - height 0.05, centered Y = 2.876 (Y = 2.851 to 2.901)
            const roofGeom = new THREE.BoxGeometry(2.82, 0.05, bodyLength);
            const roof = new THREE.Mesh(roofGeom, this.materials.bodyRedG1);
            roof.position.set(0, 2.876, bodyPosZ);
            carGroup.add(roof);
 
            // Underside Ceiling lining (Grey) - height 0.01, Y = 2.846
            const ceilingLiningGeom = new THREE.BoxGeometry(2.80, 0.01, bodyLength);
            const ceilingLining = new THREE.Mesh(ceilingLiningGeom, this.materials.ceilingGreyG1);
            ceilingLining.position.set(0, 2.846, bodyPosZ);
            carGroup.add(ceilingLining);
 
            // Underframe/Chassis (Grey) - height 0.08, centered Y = 0.34 (Y = 0.30 to 0.38)
            const chassisGeom = new THREE.BoxGeometry(2.86, 0.08, bodyLength);
            const chassis = new THREE.Mesh(chassisGeom, this.materials.bodyGrey);
            chassis.position.set(0, 0.34, bodyPosZ);
            carGroup.add(chassis);

            // Visual Glowing Ceiling Light Fixtures: one per side window (left row
            // + right row, both aligned in Z with the same 6 window centers from
            // g1WindowRects), each fixture as long as a standard side window
            // (1.364m) - 12 fixtures per car.
            const standardWindowLength = 1.364;
            const fixtureGeom = new THREE.BoxGeometry(0.15, 0.02, standardWindowLength);
            g1WindowRects.forEach(w => {
                const fixtureZ = (w.start + w.end) / 2;

                const fixtureL = new THREE.Mesh(fixtureGeom, this.materials.lightGlowWhite);
                fixtureL.position.set(-0.6, 2.80, fixtureZ);

                const fixtureR = new THREE.Mesh(fixtureGeom, this.materials.lightGlowWhite);
                fixtureR.position.set(0.6, 2.80, fixtureZ);

                carGroup.add(fixtureL, fixtureR);
            });

            // Transverse entry-area lamps: 2 per door (one flanking each side of
            // the doorway), curving toward the door as they sweep across the
            // car width - each slightly longer than a standard window lamp.
            this.getG1DoorPositions(i).forEach(doorZ => {
                this.buildG1CurvedTransverseLamp(carGroup, doorZ - 0.75, 1);
                this.buildG1CurvedTransverseLamp(carGroup, doorZ + 0.75, -1);
            });

            // Rounded coving connecting the side walls to the ceiling, starting
            // at the door-top height (2.45m) and rounding a 20cm bend inward to
            // meet the ceiling, with a #524F50 -> #C1BFC5 color fade.
            for (const xSign of [-1, 1]) {
                const fillet = new THREE.Mesh(
                    this.createG1WallCeilingFilletGeometry(xSign),
                    this.materials.g1WallCeilingFillet
                );
                fillet.scale.z = bodyLength;
                fillet.position.set(0, 0, bodyPosZ);
                carGroup.add(fillet);
            }

            // Benches (Red seats)
            const seatConfigs = [];
            intervals.forEach((interval, idx) => {
                const panelLen = interval.zMax - interval.zMin;
                const centerZ = (interval.zMin + interval.zMax) / 2;
                let seatLen = panelLen - 0.3; // 15cm padding at each end
                if (seatLen > 3.6) seatLen = 3.6;
                else if (seatLen > 2.6) seatLen = 2.6;
                else if (seatLen > 2.2) seatLen = 2.2;
                else if (seatLen > 1.4) seatLen = 1.4;
                else if (seatLen < 1.0) return;
                
                seatConfigs.push({ z: centerZ, len: seatLen, panelIdx: idx });
            });
            
            seatConfigs.forEach(cfg => {
                // Bounds are already securely managed by the interval parameters (bounds.front and bounds.rear)
                if (true) {
                    const isG1MiddleCar = (this.trainType === 'G1') && (i === 1 || i === 2);
                    const useTransverseSeats = (cfg.panelIdx === 2) || (isG1MiddleCar && cfg.panelIdx === 1);

                    if (useTransverseSeats) {
                        // Replace one of the long bench pairs per carriage with facing transverse seats,
                        // except for the two middle G1 cars where the regular bench layout is used.
                        this.buildTransverseSeats(carGroup, cfg.z, cfg.len);
                    } else {
                        const isCockpitEnd = (i === 0 && cfg.panelIdx === 0) || (i === 3 && cfg.panelIdx === 3);
                        const isGangwayEnd = (i === 0 && cfg.panelIdx === 3) ||
                                             (i === 1 && (cfg.panelIdx === 0 || cfg.panelIdx === 3)) ||
                                             (i === 2 && (cfg.panelIdx === 0 || cfg.panelIdx === 3)) ||
                                             (i === 3 && cfg.panelIdx === 0);

                        if (isCockpitEnd) {
                            // Cockpit end: no seats, only bolsters on both sides
                            this.buildLeaningBench(carGroup, -1, cfg.z, 1.1);
                            this.buildLeaningBench(carGroup, 1, cfg.z, 1.1);
                        } else if (isGangwayEnd) {
                            // Gangway end:
                            // Wall closer to platform (Right side, x = 1): 3 or 2 seats, no bolsters
                            // Opposite wall (Left side, x = -1): always bolsters, no seats
                            const panelInterval = intervals[cfg.panelIdx];
                            const zCenter = (panelInterval.zMin + panelInterval.zMax) / 2;

                            // Alternate 3-seat and 2-seat benches so that across each gangway connection,
                            // one side has a 3-seat bench and the other has a 2-seat bench.
                            // panelIdx === 3 is always 3-seat, panelIdx === 0 is always 2-seat
                            const isThreeSeat = (cfg.panelIdx === 3);

                            if (isThreeSeat) {
                                this.buildSeatBench(carGroup, 1, zCenter, 1.32); // 3 seats
                            } else {
                                this.buildSeatBench(carGroup, 1, zCenter, 0.88); // 2 seats
                            }

                            // Build bolster on the opposite wall (always bolster, length 1.8m)
                            this.buildLeaningBench(carGroup, -1, zCenter, 1.8);
                        } else {
                            // Standard compartment: 7-seat benches on both sides
                            this.buildSeatBench(carGroup, -1, cfg.z, cfg.len);
                            this.buildSeatBench(carGroup, 1, cfg.z, cfg.len);
                        }
                    }
                }
            });
 
            // Add vertical poles, sleeves, and room partitions next to doors and center aisle
            const minZ = bounds.rear;
            const maxZ = bounds.front;
            this.buildInteriorPolesAndDividers(carGroup, minZ, maxZ, i);
 
            // 3. Cabin ends and interior cockpit (Cab A on Front, Cab B on Rear)
            if (isFrontCab) {
                this.buildCabEnd(carGroup, true, carLength, i);
                this.buildCockpit(carGroup, 0, 1, i);
            }
            if (isRearCab) {
                this.buildCabEnd(carGroup, false, carLength, i);
                this.buildCockpit(carGroup, -carLength, -1, i);
            }
 
            // 4. Wheels/Bogies (2 bogies per car, symmetrically spaced 12.0m apart)
            // Bogies 1, 4, 5, 8 have yellow current collectors (i.e. Car 0 Front, Car 1 Rear, Car 2 Front, Car 3 Rear)
            this.buildBogie(carGroup, -carLength / 2 + 6.0, (i === 0 || i === 2));
            this.buildBogie(carGroup, -carLength / 2 - 6.0, (i === 1 || i === 3));

            // Underbody installations (equipment boxes and air reservoirs)
            this.buildG1Underbody(carGroup, i, carLength);
 
            // 5. Build passenger doors (3 doors per side)
            const doorPositionsZ = this.getG1DoorPositions(i);
            doorPositionsZ.forEach(dz => {
                this.createDoorPair(carGroup, -1.44, dz, i, 'left');
                this.createDoorPair(carGroup, 1.44, dz, i, 'right');
 
                // Fill the gap above doors (Y = 2.45 to 2.85) and add grey skirt below doors
                for (let xSign of [-1, 1]) {
                    const posX = xSign * 1.43;
                    // Gloss black band above door: Y = 2.45 to 2.55 (height 0.10)
                    const doorTopGrey = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 1.636), this.materials.bodyGlossBlack);
                    doorTopGrey.position.set(posX, 2.50, dz);
                    // Red top stripe: Y = 2.55 to 2.85 (height 0.30)
                    const doorTopRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 1.636), this.materials.bodyRedG1);
                    doorTopRed.position.set(posX, 2.70, dz);
                    carGroup.add(doorTopGrey, doorTopRed);

                    // Grey bottom skirt under door: Y = 0.00 to 0.375 (height 0.375, centered
                    // Y = 0.1875, color #53565f). Stops at the door leaf's own real bottom
                    // edge (doorYCenter 1.4125 - doorHeight/2 1.0375 = 0.375) instead of the
                    // wall stripe's own 0.40 - the door frame's lowest crossbar (lowerFrameB)
                    // used to sink 2.5cm into this stripe (both occupy the same X range at
                    // xSign*1.43-1.45), z-fighting where the two overlapped.
                    const doorBottomGrey = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.375, 1.636), this.materials.skirtGrey);
                    doorBottomGrey.position.set(posX, 0.1875, dz);
                    carGroup.add(doorBottomGrey);

                    // Thin white lining panel on the inside above door: Y = 2.45 to 2.85 (height 0.40)
                    const doorTopWhite = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.40, 1.636), this.materials.bodyWhite);
                    doorTopWhite.position.set(xSign * 1.40, 2.65, dz);
                    carGroup.add(doorTopWhite);
                }
            });
 
            // 6. Build bellows (gangway) between carriages
            if (i > 0) this.buildBellowsHalf(carGroup, -G1_BELLOWS_LEN, 0, 'front');
            if (i < 3) this.buildBellowsHalf(carGroup, -(carLength - G1_BELLOWS_LEN), -carLength, 'rear');
        }
    }

    // Dark seat-back panel (#2C3033) inset 5cm from every edge of the white back
    // shell, G1 only. A one-sided plane floating 1mm proud of the shell's rear
    // face so the white shell still shows as a 5cm border around it.
    getG1SeatBackPanelMat() {
        if (!this._g1SeatBackPanelMat) {
            this._g1SeatBackPanelMat = new THREE.MeshBasicMaterial({ color: '#2C3033', fog: false });
        }
        return this._g1SeatBackPanelMat;
    }

    buildSeatBench(carGroup, xOffset, zOffset, length) {
        const seatColor = (this.trainType === 'DT3') ? this.materials.dt3FabricRed : this.materials.fabricRed;
        const shellColor = (this.trainType === 'DT3') ? this.materials.dt3WhiteInner : this.materials.bodyWhite;
        const xSign = xOffset > 0 ? 1 : -1;
        const isG1 = (this.trainType === 'G1' || this.trainType === 'DT3');
        
        let numSeats = 3;
        if (length > 2.0) {
            numSeats = isG1 ? 7 : 7;
        } else if (length > 1.2) {
            numSeats = 3;
        } else {
            numSeats = 2; // 2-seat benches near gangways
        }
        const step = length / numSeats;
        
        const seatWidth = length / numSeats - 0.02; // space out seats slightly
        const seatDepth = isG1 ? 0.58 : 0.44; // seat depth (along X) - increased!
        const cushionDepth = isG1 ? 0.54 : 0.42; // cushion depth (along X) - increased!
        
        // Geometries
        const bottomShellGeom = new THREE.BoxGeometry(seatDepth, 0.02, seatWidth);
        const backShellGeom = new THREE.BoxGeometry(0.02, 0.60, seatWidth);
        const cushionGeom = new THREE.BoxGeometry(cushionDepth, 0.06, seatWidth - 0.04);
        this.applyBoxUVs(cushionGeom, cushionDepth, 0.06, seatWidth - 0.04, 10);
        
        const backrestGeom = new THREE.BoxGeometry(0.02, 0.56, seatWidth - 0.04);
        this.applyBoxUVs(backrestGeom, 0.02, 0.56, seatWidth - 0.04, 10);
        
        const xWall = xSign * (isG1 ? 1.39 : 1.08);
 
        for (let s = 0; s < numSeats; s++) {
            const seatZ = zOffset - length / 2 + step / 2 + s * step;
 
            // White bottom shell
            const bottomShell = new THREE.Mesh(bottomShellGeom, shellColor);
            bottomShell.position.set(xWall - xSign * (seatDepth / 2), 0.72, seatZ);
 
            // White back shell
            const backShell = new THREE.Mesh(backShellGeom, shellColor);
            backShell.position.set(xWall - xSign * 0.01, 1.06, seatZ);

            // Dark rear panel on the shell's back face (G1 only), 5cm edge inset
            if (this.trainType === 'G1') {
                const panel = new THREE.Mesh(
                    new THREE.PlaneGeometry(seatWidth - 0.10, 0.60 - 0.10),
                    this.getG1SeatBackPanelMat()
                );
                panel.position.set(xWall + xSign * 0.001, 1.06, seatZ);
                panel.rotation.y = xSign * Math.PI / 2;
                carGroup.add(panel);
            }

            // Red cushion
            const cushion = new THREE.Mesh(cushionGeom, seatColor);
            cushion.position.set(xWall - xSign * (cushionDepth / 2 + 0.02), 0.76, seatZ);
 
            // Red backrest
            const backrest = new THREE.Mesh(backrestGeom, seatColor);
            backrest.position.set(xWall - xSign * 0.03, 1.04, seatZ);
 
            carGroup.add(bottomShell, backShell, cushion, backrest);
        }
    }

    buildLeaningBench(carGroup, xOffset, zOffset, length) {
        const cushionColor = (this.trainType === 'DT3') ? this.materials.dt3FabricRed : this.materials.fabricRed;
        const xSign = xOffset > 0 ? 1 : -1;
        const isG1 = (this.trainType === 'G1' || this.trainType === 'DT3');
 
        const geom = new THREE.BoxGeometry(0.08, 0.20, length);
        this.applyBoxUVs(geom, 0.08, 0.20, length, 10);
 
        const cushion = new THREE.Mesh(geom, cushionColor);
        const cushionX = xSign * (isG1 ? 1.36 : 1.01);
        cushion.position.set(cushionX, 1.22, zOffset);
        carGroup.add(cushion);
    }

    buildTransverseSeats(carGroup, zOffset, length) {
        const seatColor = (this.trainType === 'DT3') ? this.materials.dt3FabricRed : this.materials.fabricRed;
        const whiteMat = (this.trainType === 'DT3') ? this.materials.dt3WhiteInner : this.materials.bodyWhite;
        const isG1 = (this.trainType === 'G1' || this.trainType === 'DT3');

        // Dimensions
        const seatW = isG1 ? 0.46 : 0.40; // width along X
        const seatD = isG1 ? 0.46 : 0.42; // depth along Z
        const shellW = isG1 ? 0.48 : 0.42;
        const shellD = isG1 ? 0.48 : 0.44; // depth along Z

        // Reusable geometries for transverse seats
        const cushionGeom = new THREE.BoxGeometry(seatW, 0.06, seatD);
        this.applyBoxUVs(cushionGeom, seatW, 0.06, seatD, 10);
        const backrestGeom = new THREE.BoxGeometry(seatW, 0.56, 0.02);
        this.applyBoxUVs(backrestGeom, seatW, 0.56, 0.02, 10);

        const bottomShellGeom = new THREE.BoxGeometry(shellW, 0.02, shellD);
        const backShellGeom = new THREE.BoxGeometry(shellW, 0.60, 0.02);

        const buildRow = (xPositions, z, dirZ) => {
            // Under-seat support box spanning the seats in the row
            let minX = Math.min(...xPositions);
            let maxX = Math.max(...xPositions);
            let rowWidth = (maxX - minX) + shellW;
            let centerX = (minX + maxX) / 2;

            // 1. Under-seat support
            const support = new THREE.Mesh(
                new THREE.BoxGeometry(rowWidth, 0.12, seatD),
                whiteMat
            );
            support.position.set(centerX, 0.66, z - dirZ * 0.01);
            carGroup.add(support);

            // 2. Continuous white bottom shell for the row
            const bottomShell = new THREE.Mesh(
                new THREE.BoxGeometry(rowWidth, 0.02, shellD),
                whiteMat
            );
            bottomShell.position.set(centerX, 0.72, z - dirZ * 0.01);
            carGroup.add(bottomShell);

            // 3. Continuous white back shell for the row
            const backShell = new THREE.Mesh(
                new THREE.BoxGeometry(rowWidth, 0.60, 0.02),
                whiteMat
            );
            backShell.position.set(centerX, 1.06, z - dirZ * (shellD / 2 + 0.01));
            carGroup.add(backShell);

            // Dark rear panel on the row shell's back face (G1 only), 5cm edge inset
            if (this.trainType === 'G1') {
                const panel = new THREE.Mesh(
                    new THREE.PlaneGeometry(rowWidth - 0.10, 0.60 - 0.10),
                    this.getG1SeatBackPanelMat()
                );
                panel.position.set(centerX, 1.06, z - dirZ * (shellD / 2 + 0.021));
                panel.rotation.y = dirZ === 1 ? Math.PI : 0;
                carGroup.add(panel);
            }

            // 4. Individual red cushions and backrests
            xPositions.forEach(x => {
                // Red cushion
                const cushion = new THREE.Mesh(cushionGeom, seatColor);
                cushion.position.set(x, 0.76, z - dirZ * 0.01);

                // Red backrest
                const backrest = new THREE.Mesh(backrestGeom, seatColor);
                backrest.position.set(x, 1.04, z - dirZ * (seatD / 2 - 0.01));

                carGroup.add(cushion, backrest);
            });
        };

        if (length > 2.4) {
            // Two bays of length 1.6m each
            const bayLength = length / 2; // 1.6m
            const bay1Center = zOffset - bayLength / 2;
            const bay2Center = zOffset + bayLength / 2;

            // --- Bay 1 (Center at z = bay1Center) ---
            // Left side (4 seats): 2 seats facing +Z, 2 seats facing -Z
            buildRow([-0.65, -1.15], bay1Center - 0.55, 1);
            buildRow([-0.65, -1.15], bay1Center + 0.55, -1);

            // Right side (3 seats): 1 seat facing +Z, 2 seats facing -Z
            buildRow([1.15], bay1Center - 0.55, 1);
            buildRow([0.65, 1.15], bay1Center + 0.55, -1);

            // --- Bay 2 (Center at z = bay2Center) ---
            // Left side (4 seats): 2 seats facing +Z, 2 seats facing -Z
            buildRow([-0.65, -1.15], bay2Center - 0.55, 1);
            buildRow([-0.65, -1.15], bay2Center + 0.55, -1);

            // Right side (3 seats): 2 seats facing +Z, 1 seat facing -Z
            buildRow([0.65, 1.15], bay2Center - 0.55, 1);
            buildRow([1.15], bay2Center + 0.55, -1);
        } else {
            // Only 1 bay centered at zOffset
            // Left side (4 seats): 2 seats facing +Z, 2 seats facing -Z
            buildRow([-0.65, -1.15], zOffset - 0.55, 1);
            buildRow([-0.65, -1.15], zOffset + 0.55, -1);

            // Right side (4 seats): 2 seats facing +Z, 2 seats facing -Z
            buildRow([0.65, 1.15], zOffset - 0.55, 1);
            buildRow([0.65, 1.15], zOffset + 0.55, -1);
        }
    }

    buildCabEnd(carGroup, isFront, carLen = 19.270, carIdx) {
        const cabZ = isFront ? 0 : -carLen;

        // Only add SpotLights for the outer ends (Car 0 front, Car 3 rear)
        const isOuterEnd = (carIdx === 0 && isFront) || (carIdx === 3 && !isFront);

        this.createG1FrontGeometries();
        const G = this.geometries;

        // --- Front group: origin at the cab end on the carriage floor line, +Z out.
        // No group tilt: the raked windshield, the protruding nose kink and the
        // slight horizontal convexity are baked into the sheared geometries.
        const faceGroup = new THREE.Group();
        faceGroup.position.set(0, 0, cabZ);
        if (!isFront) faceGroup.rotation.y = Math.PI;
        carGroup.add(faceGroup);

        // 1. Broad flat red side bevels (Fasen) with the blunt-angled kink at the
        // windshield bottom line, sweeping from the crease into the body sides
        faceGroup.add(new THREE.Mesh(G.g1BevelL, this.materials.bodyRedG1));
        faceGroup.add(new THREE.Mesh(G.g1BevelR, this.materials.bodyRedG1));

        // Interior A-pillars trim (#31302C)
        faceGroup.add(new THREE.Mesh(G.g1PillarTrimL, this.materials.cockpitInteriorDark));
        faceGroup.add(new THREE.Mesh(G.g1PillarTrimR, this.materials.cockpitInteriorDark));

        // Interior bevels (#31302C) - covering the inner side of the red corner bevels
        // Offset slightly inward and back to stay strictly inside the red shell
        const bevelIntL = new THREE.Mesh(G.g1BevelL, this.materials.cockpitInteriorDark);
        bevelIntL.position.set(0.005, -0.005, -0.015);
        const bevelIntR = new THREE.Mesh(G.g1BevelR, this.materials.cockpitInteriorDark);
        bevelIntR.position.set(-0.005, -0.005, -0.015);
        faceGroup.add(bevelIntL, bevelIntR);

        // 3. Gloss-black mask reaching from just above the skirt up to the roof
        // line (no red brow band anymore), recessed 6mm behind the red fascia.
        // Stacked panels keep the profile kink and roof arc crisp (earcut chords).
        faceGroup.add(new THREE.Mesh(G.g1MaskNose, this.materials.bodyGlossBlack));
        faceGroup.add(new THREE.Mesh(G.g1Mask, this.materials.bodyGlossBlack));
        faceGroup.add(new THREE.Mesh(G.g1MaskBand, this.materials.bodyGlossBlack));
        faceGroup.add(new THREE.Mesh(G.g1MaskTop, this.materials.bodyGlossBlack));

        // 4. Windshield glass hugging the mask curvature behind the cutout
        faceGroup.add(new THREE.Mesh(G.g1Windshield, this.materials.windshieldGlass));

        // 5. Destination display band above the windshield
        const destMesh = new THREE.Mesh(G.g1DestPlane, this.createDestinationSignMaterial());
        faceGroup.add(destMesh);


        // 7. Dark grey skirt block: flat vertical front face with hard chamfered
        // corners (wedge look), tucked in slightly under the black nose
        faceGroup.add(new THREE.Mesh(G.g1Skirt, this.materials.bodyBumperGrey));

        // Car number on the skirt front face (white, like on the original)
        const numberMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.13), this.getDecalMaterial('516'));
        numberMesh.position.set(0.42, 0.40, 0.306);
        faceGroup.add(numberMesh);

        // 8. Coupler: boxy mechanical assembly protruding from the skirt center
        const couplerMount = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.30, 0.06), this.materials.bodyGrey);
        couplerMount.position.set(0, 0.28, 0.32);
        const couplerShaft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.34), this.materials.bodyDarkGrey);
        couplerShaft.position.set(0, 0.28, 0.50);
        const couplerHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.16), this.materials.bodyGrey);
        couplerHead.position.set(0, 0.28, 0.66);
        const couplerFace = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.025), this.materials.chromeMetal);
        couplerFace.position.set(0, 0.30, 0.745);
        const contactBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.11, 0.14), this.materials.bodyDarkGrey);
        contactBox.position.set(0, 0.15, 0.60);
        faceGroup.add(couplerMount, couplerShaft, couplerHead, couplerFace, contactBox);

        const hoseGeom = new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8);
        for (const hx of [-0.13, 0.13]) {
            const hose = new THREE.Mesh(hoseGeom, this.materials.bodyDarkGrey);
            hose.position.set(hx, 0.17, 0.45);
            hose.rotation.x = 0.35;
            faceGroup.add(hose);
        }

        // 9. L-shaped LED light bands, flush in the lower outer corners of the
        // black nose and following its curvature (+ glow sprite)
        const buildLHeadlight = (xSign, colorMat, spriteMat) => {
            const headlightsGroup = new THREE.Group();

            // Long stroke rising towards the outside
            const longStroke = new THREE.BoxGeometry(0.50, 0.05, 0.014);
            longStroke.rotateZ(xSign * 0.322);
            longStroke.translate(xSign * 0.79, 1.094, 0);
            this.shearG1FrontGeometry(longStroke, 0.001);
            headlightsGroup.add(new THREE.Mesh(longStroke, colorMat));

            // Short stroke kinking upwards at the outer end
            const upStroke = new THREE.BoxGeometry(0.05, 0.21, 0.014);
            upStroke.rotateZ(0);
            upStroke.translate(xSign * 1.05, 1.264, 0);
            this.shearG1FrontGeometry(upStroke, 0.001);
            headlightsGroup.add(new THREE.Mesh(upStroke, colorMat));

            // Additive glow sprite (always faces camera, no depth write)
            const glowSprite = new THREE.Sprite(spriteMat.clone());
            glowSprite.scale.set(1.0, 1.0, 1.0);
            glowSprite.position.set(xSign * 0.84, 1.144, this.g1FrontZ(0.84, 1.144) + 0.08);
            headlightsGroup.add(glowSprite);

            return headlightsGroup;
        };

        // SpotLights for front (white) – only 1 per face, narrow cone, far range
        const buildHeadSpotlight = (isWhite) => {
            const color = isWhite ? 0xfff5e0 : 0xff2200;
            const intensity = isWhite ? 4.5 : 1.2;
            const spot = new THREE.SpotLight(color, intensity, 40.0, Math.PI / 6, 0.5, 1.5);
            spot.position.set(0, 1.194, 0.30); // local to faceGroup
            // Target in front of the face (faceGroup is already rotated, so always point +Z)
            spot.target.position.set(0, 0.45, 20);
            return spot;
        };

        const spotWhite = buildHeadSpotlight(true);
        const spotRed   = buildHeadSpotlight(false);

        if (isOuterEnd) {
            faceGroup.add(spotWhite, spotWhite.target);
            faceGroup.add(spotRed,   spotRed.target);
        }

        const headLWhite = buildLHeadlight(-1, this.materials.lightGlowWhite, this.materials.glowSpriteWhite, true);
        const headLRed   = buildLHeadlight(-1, this.materials.lightGlowRed,   this.materials.glowSpriteRed,   false);
        const headRWhite = buildLHeadlight( 1, this.materials.lightGlowWhite, this.materials.glowSpriteWhite, true);
        const headRRed   = buildLHeadlight( 1, this.materials.lightGlowRed,   this.materials.glowSpriteRed,   false);

        faceGroup.add(headLWhite, headLRed, headRWhite, headRRed);

        // Narrow central headlight strip above the destination display
        const topLightGeom = new THREE.BoxGeometry(0.50, 0.045, 0.014);
        topLightGeom.translate(0, 2.8775, 0);
        this.shearG1FrontGeometry(topLightGeom, -0.002);
        const topLight = new THREE.Group();
        topLight.add(new THREE.Mesh(topLightGeom, this.materials.lightGlowWhite));
        const topGlow = new THREE.Sprite(this.materials.glowSpriteWhite.clone());
        topGlow.scale.set(0.8, 0.8, 1.0);
        topGlow.position.set(0, 2.8775, this.g1FrontZ(0, 2.8775) + 0.06);
        topLight.add(topGlow);
        faceGroup.add(topLight);

        if (isFront) {
            this.lights.frontWhite.push(headLWhite, headRWhite, topLight);
            if (isOuterEnd) this.lights.frontWhite.push(spotWhite);
            this.lights.frontRed.push(headLRed, headRRed);
            if (isOuterEnd) this.lights.frontRed.push(spotRed);
        } else {
            this.lights.rearWhite.push(headLWhite, headRWhite, topLight);
            if (isOuterEnd) this.lights.rearWhite.push(spotWhite);
            this.lights.rearRed.push(headLRed, headRRed);
            if (isOuterEnd) this.lights.rearRed.push(spotRed);
        }
    }

    buildCockpit(carGroup, noseZ, cabDir, carIdx) {
        const unscaledWidth = this.trainType === 'G1' ? 2.90 : 2.20;
        const cockpitGroup = new THREE.Group();
        carGroup.add(cockpitGroup);

        // Cockpit is now lit by the SpotLight headlights – no dome PointLight needed

        // Materials matching Cockpit.jpg
        const consoleDarkGrey = cheapMaterial({ color: '#2b2e35', roughness: 0.8, metalness: 0.2 }); // console desk body
        const panelMediumGrey = cheapMaterial({ color: '#383c44', roughness: 0.7 });
        const transparentGlass = new THREE.MeshBasicMaterial({ color: new THREE.Color('#aabbcc').multiplyScalar(0.5), transparent: true, opacity: 0.08, depthWrite: false, fog: false });

        // 1. Create Dynamic Canvases for Screens
        const leftCanvas = document.createElement('canvas');
        leftCanvas.width = 512;
        leftCanvas.height = 256;
        const leftCtx = leftCanvas.getContext('2d');
        const leftTexture = new THREE.CanvasTexture(leftCanvas);
        leftTexture.colorSpace = THREE.SRGBColorSpace;
        const leftMat = new THREE.MeshBasicMaterial({ map: leftTexture, fog: false });

        const rightCanvas = document.createElement('canvas');
        rightCanvas.width = 512;
        rightCanvas.height = 256;
        const rightCtx = rightCanvas.getContext('2d');
        const rightTexture = new THREE.CanvasTexture(rightCanvas);
        rightTexture.colorSpace = THREE.SRGBColorSpace;
        const rightMat = new THREE.MeshBasicMaterial({ map: rightTexture, fog: false });

        const midCanvas = document.createElement('canvas');
        midCanvas.width = 512;
        midCanvas.height = 256; // Full height (same as others)
        const midCtx = midCanvas.getContext('2d');
        const midTexture = new THREE.CanvasTexture(midCanvas);
        midTexture.colorSpace = THREE.SRGBColorSpace;
        const midMat = new THREE.MeshBasicMaterial({ map: midTexture, fog: false });

        // Save reference for frame updates
        const screenObj = {
            carIdx: carIdx,
            cabDir: cabDir,
            leftCanvas,
            leftCtx,
            leftTexture,
            rightCanvas,
            rightCtx,
            rightTexture,
            midCanvas,
            midCtx,
            midTexture
        };
        this.dashboardScreens.push(screenObj);
        
        // Render initial screen frames
        this.drawLeftScreen(screenObj);
        this.drawRightScreen(screenObj);
        this.drawMidScreen(screenObj);

        // 2. Build 5 connected slanted panels (Dashboard) - Narrowed by 1/3
        const panelWidth = 0.4467;
        const panelHeight = 0.367;
        const panelThickness = 0.133;

        const panelGeom = new THREE.BoxGeometry(panelWidth, panelHeight, panelThickness);
        const panelMat = cheapMaterial({ color: '#2c303a', roughness: 0.7, metalness: 0.2 }); // Slate grey casing

        // Mathematical curved screen alignment centered at driver's eye.
        // Dashboard pulled forward so the center panel's own front face sits
        // 5cm behind the side window's front tip (its bottom-front corner,
        // the frontmost point of its raked edge - see winGlassPts/glassShift
        // in createG1FrontGeometries) instead of the much larger gap it had
        // before.
        const R = 1.0; // radius of dashboard curve
        const windowTipZ = this.g1SideFrontZ(1.41) - 0.05;
        const dashCenterZ = (windowTipZ - 0.05) - panelThickness / 2;
        const cameraZ = noseZ + cabDir * (dashCenterZ - R);
        // How far the whole dashboard (and the desk/wall below it, which move
        // with it) shifted forward from its old, fixed position.
        const dashShift = (dashCenterZ - R) - (-1.45);

        // 1.5. Dashboard console desk & back wall cover (to hide the red nose panel)
        // Vertical back wall bulkhead (covers the nose panel) - shifted inward to Z = 0.20 to prevent outer nose clipping
        // Width narrowed to 2.81m to fit inside interior walls; Height reduced to 0.95m and lifted to start at Y=0.40 (floor)
        const wallGeom = new THREE.BoxGeometry(2.81, 0.95, 0.02);
        const backWall = new THREE.Mesh(wallGeom, this.materials.cockpitTrim);
        backWall.position.set(0, 0.875, noseZ - cabDir * 0.20);
        cockpitGroup.add(backWall);

        // Horizontal desk plate (shelf desk) - elevated to Y = 1.35 (flush with windshield bottom), shifted inward, depth 0.45m
        // Width narrowed to 2.81m to match back wall. Moved forward by the
        // same amount as the dashboard panels above it (so it keeps sitting
        // under them instead of trailing behind), minus a small 3cm pullback
        // since the full shift poked it out past the front plate.
        const deskGeom = new THREE.BoxGeometry(2.81, 0.02, 0.45);
        const deskMat = cheapMaterial({ color: '#1e222b', roughness: 0.8 });
        const deskPlate = new THREE.Mesh(deskGeom, deskMat);
        deskPlate.position.set(0, 1.35, noseZ - cabDir * (0.425 - dashShift + 0.03));
        cockpitGroup.add(deskPlate);

        // Panels themselves are scaled via mesh.scale below (which scales
        // every child mounted on them - screens, dials, buttons - by the same
        // factor, keeping proportions intact); spacing is scaled to match so
        // the panels still sit edge-to-edge instead of gapping or overlapping.
        // 0.9375 = the previous 0.75 ("1/4 smaller") made 1/4 bigger again.
        const panelScale = 0.9375;
        const W_spacing = 0.4113 * panelScale; // scaled spacing to maintain edge contact
        const alpha = 2 * Math.asin(W_spacing / (2 * R));
 
        // Panel configurations: [Index-relative-to-center, Name]
        const panelConfigs = [
            { idx: 2,  name: 'panel1' }, // Leftmost (Fahrplan)
            { idx: 1,  name: 'panel2' }, // Left-Mid (Empty)
            { idx: 0,  name: 'panel3' }, // Center (Speedometer)
            { idx: -1, name: 'panel4' }, // Right-Mid (Empty)
            { idx: -2, name: 'panel5' }  // Rightmost (System)
        ];
 
        const panelMeshes = {};
        const posY = 1.515;
 
        panelConfigs.forEach(cfg => {
            const mesh = new THREE.Mesh(panelGeom, panelMat);
            
            const theta = cfg.idx * alpha;
            const posX = cabDir * R * Math.sin(theta);
            const posZ = cameraZ + cabDir * R * Math.cos(theta);
            
            mesh.position.set(posX, posY, posZ);
            
            // Set rotation order to YXZ to prevent slant (X) and yaw (Y) from distorting joint edges
            mesh.rotation.order = 'YXZ';
            // Yaw towards driver (Y rotation)
            mesh.rotation.y = theta;
            // Slant up/back towards driver (X rotation)
            mesh.rotation.x = cabDir * Math.PI / 7;

            // Uniform scale so the panel body and every child mounted on it
            // later (screens, speedometer, gauges, populateG1Panel2's buttons)
            // shrink together in the same proportions.
            mesh.scale.set(panelScale, panelScale, panelScale);

            cockpitGroup.add(mesh);
            panelMeshes[cfg.name] = mesh;
        });

        if (this.trainType === 'G1') {
            this.populateG1Panel2(panelMeshes.panel2, cabDir);

            // Extra standalone panel, upper-right corner of the cab (normal panel size,
            // reusing the same box geometry/material as the 5 dash panels below it).
            // Mounted directly above panel5 (the rightmost dash panel) so it lines up
            // with free ceiling space and can't overlap anything, then tilted down
            // further than the dash (it sits ~0.5m higher) so its screen still faces
            // the driver's eye. Doubles as the radio: this panel replaces the old
            // physical radio prop (see buildRadio, removed) - clicking it (raycast
            // tags the panel body isRadio, same as the old prop) zaps to a random
            // station+song. The screen itself is the radio's whole interface now
            // (station + currently playing song), kept live via updateRadioDisplay().
            const cornerCanvas = document.createElement('canvas');
            cornerCanvas.width = 384;
            cornerCanvas.height = 256;
            const cornerCtx = cornerCanvas.getContext('2d');
            const cornerTexture = new THREE.CanvasTexture(cornerCanvas);
            cornerTexture.colorSpace = THREE.SRGBColorSpace;
            const cornerScreenMat = new THREE.MeshBasicMaterial({ map: cornerTexture, fog: false });
            this.radioDisplays.push({ ctx: cornerCtx, canvas: cornerCanvas, texture: cornerTexture });
            this.drawRadioDisplay(cornerCtx, cornerCanvas, null, null, false);

            const cornerPanel = new THREE.Mesh(panelGeom, panelMat);
            cornerPanel.position.set(panelMeshes.panel5.position.x, 2.35, panelMeshes.panel5.position.z);
            cornerPanel.rotation.order = 'YXZ';
            cornerPanel.rotation.y = panelMeshes.panel5.rotation.y; // same yaw: already proven to face the driver
            cornerPanel.rotation.x = -cabDir * Math.PI / 12; // gentle ~15° downward tilt toward the driver
            cornerPanel.scale.set(panelScale, panelScale, panelScale);
            cockpitGroup.add(cornerPanel);

            const cornerScreen = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth * 0.85, panelHeight * 0.85), cornerScreenMat);
            cornerScreen.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
            cornerScreen.rotation.y = (cabDir === 1) ? Math.PI : 0;
            // Raycast target is the screen plane itself (not the panel box) so the hit's
            // uv lines up directly with the canvas pixels drawn in drawRadioDisplay -
            // needed to tell the "Aus" button zone apart from the rest of the screen.
            cornerScreen.userData.isRadio = true;
            this.radioMeshes.push(cornerScreen);
            cornerPanel.add(cornerScreen);
        }

        // 3. Setup Panel 1 Screen (Fahrplan / Next Station)
        const screenLGeom = new THREE.PlaneGeometry(0.3553, 0.267);
        const screenL = new THREE.Mesh(screenLGeom, leftMat);
        screenL.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        screenL.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes.panel1.add(screenL);

        // 4. Setup Panel 3 Speedometer (Tacho face and needle)
        // Dial Face (rendered via custom high-res canvas markings)
        const tachoCanvas = document.createElement('canvas');
        tachoCanvas.width = 256;
        tachoCanvas.height = 256;
        const tachoCtx = tachoCanvas.getContext('2d');
        
        // Circular background with transparency for round display
        tachoCtx.clearRect(0, 0, 256, 256);
        tachoCtx.fillStyle = '#0c0f12';
        tachoCtx.beginPath();
        tachoCtx.arc(128, 128, 128, 0, Math.PI * 2);
        tachoCtx.fill();
        
        tachoCtx.strokeStyle = '#334155';
        tachoCtx.lineWidth = 6;
        tachoCtx.beginPath();
        tachoCtx.arc(128, 128, 110, 0, Math.PI * 2);
        tachoCtx.stroke();
        
        tachoCtx.strokeStyle = '#ffffff';
        tachoCtx.lineWidth = 3;
        tachoCtx.fillStyle = '#ffffff';
        tachoCtx.font = 'bold 16px monospace';
        tachoCtx.textAlign = 'center';
        tachoCtx.textBaseline = 'middle';
        
        const startAngle = Math.PI * 0.75;
        const endAngle = Math.PI * 2.25;
        
        // Main ticks and digits
        for (let speedVal = 0; speedVal <= 90; speedVal += 10) {
            const ratio = speedVal / 90;
            const angle = startAngle + ratio * (endAngle - startAngle);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            const xOuter = 128 + cos * 95;
            const yOuter = 128 + sin * 95;
            const xInner = 128 + cos * 80;
            const yInner = 128 + sin * 80;
            
            tachoCtx.strokeStyle = '#ffffff';
            tachoCtx.lineWidth = speedVal % 30 === 0 ? 4 : 2;
            
            tachoCtx.beginPath();
            tachoCtx.moveTo(xInner, yInner);
            tachoCtx.lineTo(xOuter, yOuter);
            tachoCtx.stroke();
            
            // Draw numbers for 0, 10, 20, 30, 40, 50, 60, 70, 80, 90
            const xText = 128 + cos * 62;
            const yText = 128 + sin * 62;
            tachoCtx.fillStyle = '#ffffff';
            tachoCtx.fillText(speedVal.toString(), xText, yText);
        }

        // Intermediate ticks (5, 15, 25...) without numbers
        for (let speedVal = 5; speedVal < 90; speedVal += 10) {
            const ratio = speedVal / 90;
            const angle = startAngle + ratio * (endAngle - startAngle);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const xOuter = 128 + cos * 95;
            const yOuter = 128 + sin * 95;
            const xInner = 128 + cos * 88; // Slightly shorter than main ticks
            const yInner = 128 + sin * 88;

            tachoCtx.strokeStyle = '#ffffff';
            tachoCtx.lineWidth = 1;

            tachoCtx.beginPath();
            tachoCtx.moveTo(xInner, yInner);
            tachoCtx.lineTo(xOuter, yOuter);
            tachoCtx.stroke();
        }
        
        // Red limit area removed per user request

        tachoCtx.fillStyle = '#ffffff'; // Changed to white as requested
        tachoCtx.font = '24px monospace'; // Doubled size from 12px to 24px
        tachoCtx.fillText('km/h', 128, 195); // Moved down from 175 to 195

        const tachoTexture = new THREE.CanvasTexture(tachoCanvas);
        tachoTexture.colorSpace = THREE.SRGBColorSpace;
        const tachoDialMat = new THREE.MeshBasicMaterial({ map: tachoTexture, transparent: true, fog: false });

        // Speedo plate: 1:1 aspect ratio (0.2 x 0.2) and round geometry
        const speedoPlateGeom = new THREE.CircleGeometry(0.1, 32);
        const speedoPlate = new THREE.Mesh(speedoPlateGeom, tachoDialMat);
        speedoPlate.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        speedoPlate.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes.panel3.add(speedoPlate);

        // 3D Fluorescent Green Speedometer Needle
        const needleGroup = new THREE.Group();
        needleGroup.position.set(0, 0, 0.004); // place in front of tacho dial face
        speedoPlate.add(needleGroup);

        // Needle geometry: narrower (0.004) and fits within dial (0.09 length)
        const needleGeom = new THREE.BoxGeometry(0.004, 0.09, 0.002);
        needleGeom.translate(0, 0.035, 0); // pivot at base, shifted to center properly
        const needleMat = new THREE.MeshBasicMaterial({ color: '#ccff00', fog: false }); // fluorescent light green
        const needle = new THREE.Mesh(needleGeom, needleMat);
        needleGroup.add(needle);

        // Center cap pin
        const capGeom = new THREE.CylinderGeometry(0.0133, 0.0133, 0.0067, 16);
        capGeom.rotateX(Math.PI / 2);
        const capMat = new THREE.MeshBasicMaterial({ color: '#1e293b', fog: false });
        const cap = new THREE.Mesh(capGeom, capMat);
        cap.position.set(0, 0, 0.005);
        speedoPlate.add(cap);

        // Set initial rotation (0 km/h = bottom left)
        needleGroup.rotation.z = Math.PI * 0.75;
        this.speedNeedles.push({ mesh: needleGroup });

        // 4.5. Setup Manometer (Dual-needle Brake Pressure Gauge) on Panel 3
        if (this.trainType === 'G1') {
            const manoCanvas = document.createElement('canvas');
            manoCanvas.width = 128;
            manoCanvas.height = 128;
            const manoCtx = manoCanvas.getContext('2d');

            // Draw Manometer Face - Same background color as speedometer
            manoCtx.fillStyle = '#0c0f12';
            manoCtx.beginPath();
            manoCtx.arc(64, 64, 62, 0, Math.PI * 2);
            manoCtx.fill();

            // Light grey outer ring matching speedometer style
            manoCtx.strokeStyle = '#334155';
            manoCtx.lineWidth = 4;
            manoCtx.beginPath();
            manoCtx.arc(64, 64, 58, 0, Math.PI * 2);
            manoCtx.stroke();

            // Scale 0-12 bar with minor ticks
            manoCtx.strokeStyle = '#ffffff';
            manoCtx.lineWidth = 1;
            for (let i = 0; i <= 12; i += 0.5) {
                const angle = Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
                const isMajor = i % 1 === 0;
                const len = isMajor ? 8 : 4;
                manoCtx.beginPath();
                manoCtx.moveTo(64 + Math.cos(angle) * 54, 64 + Math.sin(angle) * 54);
                manoCtx.lineTo(64 + Math.cos(angle) * (54 - len), 64 + Math.sin(angle) * (54 - len));
                manoCtx.stroke();
            }

            // Labels
            manoCtx.fillStyle = '#ffffff';
            manoCtx.font = '10px sans-serif';
            manoCtx.textAlign = 'center';
            for (let i = 0; i <= 12; i += 2) {
                const angle = Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
                const x = 64 + Math.cos(angle) * 40;
                const y = 64 + Math.sin(angle) * 40 + 4;
                manoCtx.fillText(i.toString(), x, y);
            }

            // Descriptive labels in center
            manoCtx.font = '7px sans-serif';
            manoCtx.fillStyle = '#ffffff';
            manoCtx.fillText('Hauptluftbehälter', 64, 85);
            manoCtx.fillStyle = '#ff3300';
            manoCtx.fillText('Bremszylinder', 64, 95);

            const manoTexture = new THREE.CanvasTexture(manoCanvas);
            manoTexture.colorSpace = THREE.SRGBColorSpace;
            const manoMat = new THREE.MeshBasicMaterial({ map: manoTexture, transparent: true, fog: false });
            // Increased size by 1/3: 0.045 * 1.333 ≈ 0.06
            const manoGeom = new THREE.CircleGeometry(0.06, 32);
            const manoMesh = new THREE.Mesh(manoGeom, manoMat);

            // Placement logic: always to the right of the speedometer (Panel 3)
            // Adjusted X-offset slightly to account for larger size
            const visualRightX = (cabDir === 1) ? -0.13 : 0.13;
            manoMesh.position.set(visualRightX, 0.08, -cabDir * (panelThickness / 2 + 0.003));
            manoMesh.rotation.y = (cabDir === 1) ? Math.PI : 0;
            panelMeshes.panel3.add(manoMesh);

            // Needles
            const buildNeedle = (color) => {
                const nGroup = new THREE.Group();
                // Lengthened needle for larger dial
                const nGeom = new THREE.BoxGeometry(0.0025, 0.05, 0.001);
                nGeom.translate(0, 0.02, 0);
                const nMesh = new THREE.Mesh(nGeom, new THREE.MeshBasicMaterial({ color: color, fog: false }));
                nGroup.add(nMesh);
                return nGroup;
            };

            const hblNeedle = buildNeedle('#ffffff');
            hblNeedle.position.set(0, 0, 0.001);
            manoMesh.add(hblNeedle);

            const bzNeedle = buildNeedle('#ff3300');
            bzNeedle.position.set(0, 0, 0.002);
            manoMesh.add(bzNeedle);

            this.brakeNeedles.push({
                hbl: hblNeedle,
                bz: bzNeedle,
                hblSmoothed: 9.5,
                bzSmoothed: 0,
                cabDir: cabDir
            });

            // 4.6. Setup Static "V x 10" Indicator on Panel 3 (Left Side)
            const v10Canvas = document.createElement('canvas');
            v10Canvas.width = 128;
            v10Canvas.height = 128;
            const v10Ctx = v10Canvas.getContext('2d');

            // Draw Face
            v10Ctx.fillStyle = '#0c0f12';
            v10Ctx.beginPath();
            v10Ctx.arc(64, 64, 62, 0, Math.PI * 2);
            v10Ctx.fill();

            // Outer ring
            v10Ctx.strokeStyle = '#334155';
            v10Ctx.lineWidth = 4;
            v10Ctx.beginPath();
            v10Ctx.arc(64, 64, 58, 0, Math.PI * 2);
            v10Ctx.stroke();

            // Green range 60-90
            const vStartAngle = Math.PI * 0.75;
            const vRangeAngle = Math.PI * 1.5;
            const greenStart = vStartAngle + (60 / 100) * vRangeAngle;
            const greenEnd = vStartAngle + (90 / 100) * vRangeAngle;

            v10Ctx.strokeStyle = '#22c55e'; // Emerald green
            v10Ctx.lineWidth = 6;
            v10Ctx.beginPath();
            v10Ctx.arc(64, 64, 52, greenStart, greenEnd);
            v10Ctx.stroke();

            // Scale 0-100
            v10Ctx.strokeStyle = '#ffffff';
            v10Ctx.lineWidth = 1;
            for (let i = 0; i <= 100; i += 5) {
                const angle = vStartAngle + (i / 100) * vRangeAngle;
                const isMajor = i % 10 === 0;
                const len = isMajor ? 8 : 4;
                v10Ctx.beginPath();
                v10Ctx.moveTo(64 + Math.cos(angle) * 54, 64 + Math.sin(angle) * 54);
                v10Ctx.lineTo(64 + Math.cos(angle) * (54 - len), 64 + Math.sin(angle) * (54 - len));
                v10Ctx.stroke();
            }

            // Labels
            v10Ctx.fillStyle = '#ffffff';
            v10Ctx.font = '10px sans-serif';
            v10Ctx.textAlign = 'center';
            for (let i = 0; i <= 100; i += 20) {
                const angle = vStartAngle + (i / 100) * vRangeAngle;
                const x = 64 + Math.cos(angle) * 40;
                const y = 64 + Math.sin(angle) * 40 + 4;
                v10Ctx.fillText(i.toString(), x, y);
            }

            // Text at bottom center
            v10Ctx.font = 'bold 10px sans-serif';
            v10Ctx.fillText('V x 10', 64, 95);

            const v10Texture = new THREE.CanvasTexture(v10Canvas);
            v10Texture.colorSpace = THREE.SRGBColorSpace;
            const v10Mat = new THREE.MeshBasicMaterial({ map: v10Texture, transparent: true, fog: false });
            const v10Mesh = new THREE.Mesh(new THREE.CircleGeometry(0.06, 32), v10Mat);

            // Symmetrical placement: left of speedometer
            const visualLeftX = (cabDir === 1) ? 0.13 : -0.13;
            v10Mesh.position.set(visualLeftX, 0.08, -cabDir * (panelThickness / 2 + 0.003));
            v10Mesh.rotation.y = (cabDir === 1) ? Math.PI : 0;
            panelMeshes.panel3.add(v10Mesh);

            // Static Needle
            const vNeedleGroup = new THREE.Group();
            const vNeedleGeom = new THREE.BoxGeometry(0.0025, 0.05, 0.001);
            vNeedleGeom.translate(0, 0.02, 0);
            const vNeedle = new THREE.Mesh(vNeedleGeom, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
            vNeedleGroup.add(vNeedle);
            vNeedleGroup.position.set(0, 0, 0.001);
            v10Mesh.add(vNeedleGroup);

            // Set needle to a static value (75)
            // Three.js rotation is counter-clockwise, so we subtract from the start angle
            vNeedleGroup.rotation.z = Math.PI * 0.75 - (75 / 100) * Math.PI * 1.5;
        }

        // 5. Setup Panel 5 Screen (System / Diagnostic)
        const screenRGeom = new THREE.PlaneGeometry(0.3553, 0.267);
        const screenR = new THREE.Mesh(screenRGeom, rightMat);
        screenR.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        screenR.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes.panel5.add(screenR);

        // 6. Setup Panel 4 Screen (Middle-Right, Top Half)
        const screenMGeom = new THREE.PlaneGeometry(0.28, 0.21); // Same format but smaller (approx 80%)
        const screenM = new THREE.Mesh(screenMGeom, midMat);
        // Positioned slightly upwards (0.05 offset)
        screenM.position.set(0, 0.05, -cabDir * (panelThickness / 2 + 0.002));
        screenM.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes.panel4.add(screenM);

        // 9. Hollow Cab Enclosures (Side walls & roof to prevent looking out into raw empty space)
        const cockFloorGeom = new THREE.BoxGeometry(unscaledWidth, 0.05, 1.9);
        this.applyBoxUVs(cockFloorGeom, unscaledWidth, 0.05, 1.9, 2.0);
        const cockFloor = new THREE.Mesh(cockFloorGeom, this.materials.cockpitFloorG1);
        cockFloor.position.set(0, 0.375, noseZ - cabDir * 0.95);
        cockpitGroup.add(cockFloor);

        // G1 cab flanks (see reference photos): gloss-black side panels with the
        // trapezoid driver window and a working hinged driver door in a real
        // cutout; the red bottom stripe and the white band's diagonal front cut
        // continue the body livery, and a red roof-edge strip runs across the cab.
        // buildCockpit is only called for the G1 (the DT1 has buildDT1Cockpit).
        this.createG1FrontGeometries();
        const G = this.geometries;
        const sideGroup = new THREE.Group();
        sideGroup.position.set(0, 0, noseZ);
        if (cabDir === -1) sideGroup.rotation.y = Math.PI;
        carGroup.add(sideGroup);

        for (const sign of [-1, 1]) {
            const flank = new THREE.Mesh(sign < 0 ? G.g1CabSideL : G.g1CabSideR, this.materials.bodyGlossBlack);
            const flankGlass = new THREE.Mesh(sign < 0 ? G.g1CabGlassL : G.g1CabGlassR, this.materials.cabWindowGlass);
            const redStripe = new THREE.Mesh(sign < 0 ? G.g1CabRedStripeL : G.g1CabRedStripeR, this.materials.bodyRedG1);
            const skirtStripe = new THREE.Mesh(sign < 0 ? G.g1CabSkirtStripeL : G.g1CabSkirtStripeR, this.materials.skirtGrey);
            const whiteRear = new THREE.Mesh(sign < 0 ? G.g1CabWhiteRearL : G.g1CabWhiteRearR, this.materials.bodyWhite);
            const redWedge = new THREE.Mesh(sign < 0 ? G.g1CabRedWedgeL : G.g1CabRedWedgeR, this.materials.bodyRedG1);
            const whiteTri = new THREE.Mesh(sign < 0 ? G.g1CabWhiteTriL : G.g1CabWhiteTriR, this.materials.bodyWhite);
            const topStrip = new THREE.Mesh(sign < 0 ? G.g1CabTopStripL : G.g1CabTopStripR, this.materials.bodyRedG1);

            // Interior claddings (#31302C) - full geometry used to avoid gaps
            // Offset 1.5cm inward and slightly back to hide the exterior livery from inside
            const flankInt = new THREE.Mesh(sign < 0 ? G.g1CabSideL : G.g1CabSideR, this.materials.cockpitInteriorDark);
            flankInt.position.set(-sign * 0.015, -0.005, -0.01);

            sideGroup.add(flank, flankGlass, redStripe, skirtStripe, whiteRear, redWedge, whiteTri, topStrip, flankInt);

            // Doorway reveal: jambs, header and sill lining the flank cutout so
            // the opening has visible depth when the door swings out
            const jambF = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.94, 0.03), this.materials.cockpitInteriorDark);
            jambF.position.set(sign * 1.425, 1.575, -1.125);
            const jambR = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.94, 0.03), this.materials.cockpitInteriorDark);
            jambR.position.set(sign * 1.425, 1.575, -1.795);
            const header = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.66), this.materials.cockpitInteriorDark);
            header.position.set(sign * 1.425, 2.535, -1.46);
            sideGroup.add(jambF, jambR, header);

            // Driver door: 700mm-wide leaf built as a real frame (top rail, lower
            // panel, hinge/latch stiles) around an open window cutout, so the
            // glass pane is genuinely see-through instead of an opaque overlay.
            // Hinged at the front edge, swinging outwards (animated via this.cabDoors).
            const doorW = 0.70; // real driver door width: 700mm
            const winZ0 = -0.08, winZ1 = -(doorW - 0.07); // hinge/latch margins
            const winY0 = 1.35, winY1 = 2.35; // top/bottom margins (aligned with passenger window opening)
            const doorPivot = new THREE.Group();
            doorPivot.position.set(sign * 1.428, 0, -1.11);

            const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.54 - winY1, doorW), this.materials.bodyGlossBlack);
            topRail.position.set(0, (2.54 + winY1) / 2, -doorW / 2);
            const topRailInt = new THREE.Mesh(new THREE.BoxGeometry(0.01, 2.54 - winY1 + 0.01, doorW + 0.01), this.materials.cockpitInteriorDark);
            topRailInt.position.set(-sign * 0.02, (2.54 + winY1) / 2 - 0.005, -doorW / 2);

            // Split lowerPanel into white livery stripe (Y = 0.60 to 1.20) and black frame (Y = 1.20 to winY0)
            const lowerPanelWhite = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.20 - 0.60, doorW), this.materials.bodyWhite);
            lowerPanelWhite.position.set(0, (0.60 + 1.20) / 2, -doorW / 2);
            const lowerPanelBlack = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY0 - 1.20, doorW), this.materials.bodyGlossBlack);
            lowerPanelBlack.position.set(0, (1.20 + winY0) / 2, -doorW / 2);
            const lowerPanelInt = new THREE.Mesh(new THREE.BoxGeometry(0.01, winY0 - 0.60 + 0.01, doorW + 0.01), this.materials.cockpitInteriorDark);
            lowerPanelInt.position.set(-sign * 0.02, (0.60 + winY0) / 2 + 0.005, -doorW / 2);

            const hingeStile = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY1 - winY0, -winZ0), this.materials.bodyGlossBlack);
            hingeStile.position.set(0, (winY0 + winY1) / 2, winZ0 / 2);
            const latchStile = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY1 - winY0, doorW + winZ1), this.materials.bodyGlossBlack);
            latchStile.position.set(0, (winY0 + winY1) / 2, (winZ1 - doorW) / 2);

            const frameIntF = new THREE.Mesh(new THREE.BoxGeometry(0.01, winY1 - winY0 + 0.02, -winZ0 + 0.01), this.materials.cockpitInteriorDark);
            frameIntF.position.set(-sign * 0.02, (winY0 + winY1) / 2, winZ0 / 2 - 0.005);
            const frameIntR = new THREE.Mesh(new THREE.BoxGeometry(0.01, winY1 - winY0 + 0.02, doorW + winZ1 + 0.01), this.materials.cockpitInteriorDark);
            frameIntR.position.set(-sign * 0.02, (winY0 + winY1) / 2, (winZ1 - doorW) / 2 + 0.005);

            const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.03, winY1 - winY0, winZ0 - winZ1), this.materials.cabWindowGlass);
            doorGlass.position.set(0, (winY0 + winY1) / 2, (winZ0 + winZ1) / 2);
            const handleOut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.035), this.materials.chromeMetal);
            handleOut.position.set(sign * 0.026, 1.10, winZ1 + 0.04);
            const handleIn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.035), this.materials.chromeMetal);
            handleIn.position.set(-sign * 0.036, 1.10, winZ1 + 0.04);
            doorPivot.add(topRail, topRailInt, lowerPanelWhite, lowerPanelBlack, lowerPanelInt, hingeStile, latchStile, frameIntF, frameIntR, doorGlass, handleOut, handleIn);
            sideGroup.add(doorPivot);
            const side = ((cabDir === 1) === (sign < 0)) ? 'left' : 'right';
            this.cabDoors.push({ pivot: doorPivot, sign, side, carIdx });
        }

        // Cab roof: red plan-shaped cap following the brow arc and bevel sweep
        sideGroup.add(new THREE.Mesh(G.g1CabRoofCap, this.materials.bodyRedG1));

        // Interior roof lining (#333333) - moved down and slightly back to stay hidden from outside
        const interiorRoof = new THREE.Mesh(G.g1CabRoofCap, this.materials.cockpitCeiling);
        interiorRoof.position.set(0, -0.015, -0.02);
        sideGroup.add(interiorRoof);

        // Cab Underside Ceiling lining (#333333)
        const cabCeilingLining = new THREE.Mesh(new THREE.BoxGeometry(2.78, 0.01, 1.12), this.materials.cockpitCeiling);
        cabCeilingLining.position.set(0, 2.83, -1.32);
        sideGroup.add(cabCeilingLining);

        // 10. Cabin Rear Wall partition (Rückwand) — the two transverse windows
        // flanking the cockpit door get a 50% black tint (rest of the train's
        // glass stays near-clear at 2% white); shared faux-reflection material.
        const partitionGlassMat = this.materials.partitionGlass;
        const partitionWallMat = cheapMaterial({ color: '#252931', roughness: 0.9 }); // a shade darker than the dashboard panel casing (#2c303a), matching cockpitTrim
        const interiorWidth = unscaledWidth - 0.12; // 2.78m for G1, stays strictly inside the interior walls
        const partitionH = (this.trainType === 'G1') ? 2.075 : 1.60;
        const partitionY = (this.trainType === 'G1') ? 1.4375 : 1.20; // G1: moved up 2.5cm to sit on the floor surface (Y=0.40)
        const partitionW = (interiorWidth - 0.79) / 2;
        const partitionOffset = interiorWidth / 2 - partitionW / 2;

        const partitionLGeom = new THREE.BoxGeometry(partitionW, partitionH, 0.035);
        const partitionL = new THREE.Mesh(partitionLGeom, partitionGlassMat);
        partitionL.position.set(-partitionOffset, partitionY, noseZ - cabDir * (1.90 - 0.0175)); // Moved 1.75cm towards nose to align back face with floor edge

        const partitionRGeom = new THREE.BoxGeometry(partitionW, partitionH, 0.035);
        const partitionR = new THREE.Mesh(partitionRGeom, partitionGlassMat);
        partitionR.position.set(partitionOffset, partitionY, noseZ - cabDir * (1.90 - 0.0175));

        const partitionTopH = (this.trainType === 'G1') ? 0.40 : 0.30;
        const partitionTopY = (this.trainType === 'G1') ? 2.675 : 2.15; // G1: moved up 2.5cm
        const partitionTopGeom = new THREE.BoxGeometry(interiorWidth, partitionTopH, 0.05);
        const partitionTop = new THREE.Mesh(partitionTopGeom, partitionWallMat);
        partitionTop.position.set(0, partitionTopY, noseZ - cabDir * (1.90 - 0.025)); // Moved 2.5cm towards nose to align back face with floor edge

        const cabinDoorGeom = new THREE.BoxGeometry(0.79, partitionH, 0.045);
        const cabinDoor = new THREE.Mesh(cabinDoorGeom, this.materials.bodyRedG1);
        cabinDoor.position.set(0, partitionY, noseZ - cabDir * (1.90 - 0.0225)); // Moved 2.25cm towards nose to align back face with floor edge

        // Add a light grey handle (Klinke) on the left side of the door
        const handleGeom = new THREE.BoxGeometry(0.04, 0.02, 0.12);
        const handleMat = cheapMaterial({ color: '#cccccc', metalness: 0.5, roughness: 0.5 });
        const handle = new THREE.Mesh(handleGeom, handleMat);
        handle.position.set(-0.37, partitionY + 0.05, noseZ - cabDir * (1.90 - 0.0225 - 0.03));

        cockpitGroup.add(partitionL, partitionR, partitionTop, cabinDoor, handle);

        // 11. Station display above the cockpit door (passenger side)
        const signOffset = -cabDir * 0.04;
        const displayZ = (noseZ - cabDir * (1.90 - 0.025)) + signOffset; // Moved with the partition wall
        const isG1Display = (this.trainType === 'G1');
        const displayY = isG1Display ? 2.71 : 2.12; // G1: moved up 2.5cm

        const displayBacking = new THREE.Mesh(
            new THREE.BoxGeometry(isG1Display ? 2.78 : 1.02, isG1Display ? 0.28 : 0.14, 0.03),
            this.materials.bodyDarkGrey
        );
        displayBacking.position.set(0, displayY, displayZ);
        cockpitGroup.add(displayBacking);

        const isRotated = (cabDir === 1);
        const displayScreen = new THREE.Mesh(
            new THREE.PlaneGeometry(isG1Display ? 2.74 : 1.0, isG1Display ? 0.24 : 0.12),
            isRotated ? this.interiorDisplayMatB : this.interiorDisplayMatF
        );
        displayScreen.position.set(0, displayY, displayZ + signOffset * 0.4);
        displayScreen.rotation.y = isRotated ? Math.PI : 0;
        cockpitGroup.add(displayScreen);
        this.interiorDisplays.push(displayScreen);

        // 13. Driver's seat: dark grey ergonomic chair with a padded/quilted
        // cushion texture and a tall backrest (with a separate headrest lobe),
        // sitting far enough behind the dashboard/desk for legroom.
        this.buildG1DriverSeat(cockpitGroup, noseZ, cabDir);

        // 14. Aircraft-style throttle/brake lever, mounted on a metal pedestal
        // block to the front-left of the seat.
        this.buildG1ThrottleLever(cockpitGroup, noseZ, cabDir);
    }

    // Pedestal block (metal, floor-mounted, topped at driver-seat armrest
    // height) carrying a single aircraft-throttle-style lever: centered when
    // idle, tilted forward for traction and back for braking (driven by the
    // shared this.throttleLevers update loop, same as the DT1's handle).
    // Positioned front-left of the seat (blockX clears the seat's armrests by
    // ~0.12m in X; blockZ sits ahead of the seat cushion but well behind the
    // desk, whose deepest point only reaches ~0.28m out from the nose here)
    // so it never intersects the seat or the dashboard/desk.
    buildG1ThrottleLever(cockpitGroup, noseZ, cabDir) {
        const pedestalMat = this.getG1PedestalMaterial();
        const gripMat = cheapMaterial({ map: this.createWoodTexture('#5C311E', '#3d1f13'), roughness: 0.45 });
        const rodMat = cheapMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.4 });

        const floorY = 0.40;
        const blockTopY = 1.216; // 20% taller (was 1.08)
        const blockHeight = blockTopY - floorY;
        const blockW = 0.24, blockD = 0.288; // 20% larger footprint (was 0.20x0.24)

        const leftSign = cabDir; // +X is "left" for cabDir=1, -X for cabDir=-1
        const blockX = leftSign * 0.55;
        const blockZ = noseZ - cabDir * 0.55; // 20cm further away from driver (was 0.75)

        const block = new THREE.Mesh(new THREE.BoxGeometry(blockW, blockHeight, blockD), pedestalMat);
        block.position.set(blockX, floorY + blockHeight / 2, blockZ);
        cockpitGroup.add(block);

        // Dark longitudinal line on top of the block (replaces the old pivot dome)
        const lineMat = cheapMaterial({ color: '#111111', roughness: 0.9 });
        const slotLine = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.002, 0.18), lineMat);
        slotLine.position.set(blockX, blockTopY + 0.001, blockZ);
        cockpitGroup.add(slotLine);

        // Lever: pivots fore/aft about its base like an aircraft throttle,
        // driven by the shared this.throttleLevers update (rotation.x).
        const leverGroup = new THREE.Group();
        leverGroup.position.set(blockX, blockTopY + 0.01, blockZ);
        cockpitGroup.add(leverGroup);

        const rodLength = 0.10;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, rodLength, 8), rodMat);
        rod.geometry.translate(0, rodLength / 2, 0);
        leverGroup.add(rod);

        // Grip: a horizontal knob (long axis along X) at the top of the rod
        const gripGeom = this.createRoundedBoxGeometry(0.09, 0.05, 0.03, 0.012);
        const grip = new THREE.Mesh(gripGeom, gripMat);
        grip.position.set(0, rodLength + 0.02, 0);
        leverGroup.add(grip);

        this.throttleLevers.push({ mesh: leverGroup, cabDir: cabDir, invert: true });
    }

    // Canvas-based quilted/padded upholstery texture (dark grey diamond
    // stitch pattern) shared by the seat cushion and backrest.
    getG1SeatCushionMaterial() {
        if (this._g1SeatCushionMat) return this._g1SeatCushionMat;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#33363b';
        ctx.fillRect(0, 0, 256, 256);

        // Diamond stitch grid with a soft highlight/shadow pair per seam so
        // each cell reads as a slightly domed pad instead of a flat print.
        const step = 42;
        ctx.strokeStyle = '#1c1e21';
        ctx.lineWidth = 2;
        for (let x = -256; x <= 512; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + 256, 256);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + 256, 0);
            ctx.lineTo(x, 256);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let x = -256 + 3; x <= 512; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + 256, 256);
            ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        // No separate "color" tint here: the material multiplies map
        // by color, and the previous dark grey color (#43474d) over the
        // already-dark canvas (#33363b) multiplied down to near-black,
        // hiding the stitch pattern almost entirely. Leaving color at the
        // material's white default lets the texture's own tones show.
        this._g1SeatCushionMat = cheapMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
        return this._g1SeatCushionMat;
    }

    getG1PedestalMaterial() {
        if (this._g1PedestalMat) return this._g1PedestalMat;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Main color #322F26
        ctx.fillStyle = '#322F26';
        ctx.fillRect(0, 0, 128, 128);

        // Edge fades with color #423B33
        const fadeSize = 16;

        // Top fade
        let grad = ctx.createLinearGradient(0, 0, 0, fadeSize);
        grad.addColorStop(0, '#423B33');
        grad.addColorStop(1, '#322F26');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, fadeSize);

        // Bottom fade
        grad = ctx.createLinearGradient(0, 128 - fadeSize, 0, 128);
        grad.addColorStop(0, '#322F26');
        grad.addColorStop(1, '#423B33');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 128 - fadeSize, 128, fadeSize);

        // Left fade
        grad = ctx.createLinearGradient(0, 0, fadeSize, 0);
        grad.addColorStop(0, '#423B33');
        grad.addColorStop(1, '#322F26');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, fadeSize, 128);

        // Right fade
        grad = ctx.createLinearGradient(128 - fadeSize, 0, 128, 0);
        grad.addColorStop(0, '#322F26');
        grad.addColorStop(1, '#423B33');
        ctx.fillStyle = grad;
        ctx.fillRect(128 - fadeSize, 0, fadeSize, 128);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        this._g1PedestalMat = cheapMaterial({ map: tex, roughness: 0.7, metalness: 0.2 });
        return this._g1PedestalMat;
    }

    buildG1DriverSeat(cockpitGroup, noseZ, cabDir) {
        const cushionMat = this.getG1SeatCushionMaterial();
        const frameMat = cheapMaterial({ color: '#2b2e33', roughness: 0.6, metalness: 0.4 });

        const seatGroup = new THREE.Group();
        // Centered (x=0, was -0.28) and a bit further from the dashboard/desk
        // (0.98 instead of 0.85).
        seatGroup.position.set(0, 0.40, noseZ - cabDir * 0.98);
        cockpitGroup.add(seatGroup);

        // Height-adjustable pedestal
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 12), frameMat);
        pedestal.position.y = 0.21;
        const pedestalBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16), frameMat);
        pedestalBase.position.y = 0.015;
        seatGroup.add(pedestal, pedestalBase);

        // Seat cushion: a rounded, slightly domed cushion (ergonomic contour).
        // Widened 0.46 -> 0.52 and lengthened 0.46 -> 0.56.
        const cushionGeom = this.createRoundedBoxGeometry(0.52, 0.10, 0.56, 0.07);
        const cushion = new THREE.Mesh(cushionGeom, cushionMat);
        cushion.position.y = 0.47;
        seatGroup.add(cushion);

        // Tall backrest, leaning back slightly, plus a separate headrest
        // lobe near the top - "lange Lehne" reaching well past shoulder height
        const backrestGroup = new THREE.Group();
        backrestGroup.position.set(0, 0.52, -cabDir * 0.19);
        backrestGroup.rotation.x = -cabDir * 0.12;
        seatGroup.add(backrestGroup);

        const backrestGeom = this.createRoundedBoxGeometry(0.46, 0.80, 0.09, 0.08);
        const backrest = new THREE.Mesh(backrestGeom, cushionMat);
        backrest.position.y = 0.40;
        backrestGroup.add(backrest);

        const headrestGeom = this.createRoundedBoxGeometry(0.30, 0.20, 0.10, 0.06);
        const headrest = new THREE.Mesh(headrestGeom, cushionMat);
        headrest.position.y = 0.86;
        backrestGroup.add(headrest);

        // Slim armrests, moved out to the edge of the now-wider cushion
        const armGeom = new THREE.BoxGeometry(0.06, 0.05, 0.30);
        for (const ax of [-1, 1]) {
            const armSupport = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), frameMat);
            armSupport.position.set(ax * 0.265, 0.585, -0.05);
            const armPad = new THREE.Mesh(armGeom, frameMat);
            armPad.position.set(ax * 0.265, 0.68, -0.05);
            seatGroup.add(armSupport, armPad);
        }
    }

    populateG1Panel2(panel, cabDir) {
        if (!panel) return;

        // Panel dimensions
        const panelWidth = 0.4467;
        const panelHeight = 0.367;
        const panelThickness = 0.133;

        // Container group on the panel surface
        const controlsGroup = new THREE.Group();
        // Front face of the slanted panel: Z is -cabDir * (panelThickness / 2 + 0.001)
        controlsGroup.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        controlsGroup.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panel.add(controlsGroup);

        // Helper materials
        const matRed = cheapMaterial({ color: '#d00000', roughness: 0.5 });
        const matRedGlow = new THREE.MeshBasicMaterial({ color: '#ff4444', fog: false });
        const matYellow = cheapMaterial({ color: '#e0a000', roughness: 0.5 });
        const matYellowGlow = new THREE.MeshBasicMaterial({ color: '#ffcc00', fog: false });
        const matWhite = cheapMaterial({ color: '#f0f0f0', roughness: 0.5 });
        const matWhiteGlow = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
        const matGreen = cheapMaterial({ color: '#00a000', roughness: 0.5 });
        const matGreenGlow = new THREE.MeshBasicMaterial({ color: '#44ff44', fog: false });
        const matBlack = cheapMaterial({ color: '#101010', roughness: 0.8 });
        const matGrey = cheapMaterial({ color: '#808080', roughness: 0.6, metalness: 0.4 });
        const matSilver = cheapMaterial({ color: '#aaaaaa', roughness: 0.3, metalness: 0.7 });

        // Helper functions
        const buildLight = (color, isActive, size = 0.02) => {
            const group = new THREE.Group();
            const base = new THREE.Mesh(new THREE.BoxGeometry(size * 1.2, size * 1.2, 0.005), matBlack);
            group.add(base);
            const lens = new THREE.Mesh(
                new THREE.BoxGeometry(size, size * 0.6, 0.006),
                isActive ? (color === 'red' ? matRedGlow : color === 'white' ? matWhiteGlow : matYellowGlow) : (color === 'red' ? matRed : color === 'white' ? matWhite : matYellow)
            );
            group.add(lens);
            return group;
        };

        const buildSmallLED = (color, isActive) => {
            const mesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.004, 0.004, 0.006, 8),
                isActive ? matRedGlow : matRed
            );
            mesh.rotation.x = Math.PI / 2;
            return mesh;
        };

        const buildGreenIndicator = () => {
            const group = new THREE.Group();
            const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.005, 16), matBlack);
            outer.rotation.x = Math.PI / 2;
            group.add(outer);
            const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 16), matGreenGlow);
            inner.rotation.x = Math.PI / 2;
            group.add(inner);
            return group;
        };

        const buildDarkHole = () => {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.002, 16), matBlack);
            mesh.rotation.x = Math.PI / 2;
            return mesh;
        };

        const buildMushroomButton = () => {
            const group = new THREE.Group();
            const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.02, 16), matGrey);
            stalk.rotation.x = Math.PI / 2;
            stalk.position.z = 0.01;
            group.add(stalk);
            const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.015, 16), matRed);
            head.rotation.x = Math.PI / 2;
            head.position.z = 0.02;
            group.add(head);
            return group;
        };

        const buildRingButton = (isActive, bodyMat = matRed, ringMat = null) => {
            const group = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 16), bodyMat);
            body.rotation.x = Math.PI / 2;
            body.position.z = 0.005;
            group.add(body);

            const effectiveRingMat = ringMat || (isActive ? matRedGlow : null);
            if (effectiveRingMat) {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 8, 24), effectiveRingMat);
                ring.position.z = 0.005;
                group.add(ring);
            }
            return group;
        };

        const buildToggleSwitch = (isUp) => {
            const group = new THREE.Group();
            const base = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.005), matBlack);
            group.add(base);
            const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.03, 8), matRed);
            lever.rotation.x = isUp ? -0.5 : 0.5;
            lever.position.y = isUp ? 0.01 : -0.01;
            lever.position.z = 0.015;
            group.add(lever);
            return group;
        };

        const buildRotarySwitch = (angle = 0) => {
            const group = new THREE.Group();
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.005, 16), matBlack);
            base.rotation.x = Math.PI / 2;
            group.add(base);
            const knob = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.025), matBlack);
            knob.rotation.z = angle;
            knob.position.z = 0.0125;
            group.add(knob);
            const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.015, 0.002), matWhite);
            indicator.position.y = 0.015;
            indicator.position.z = 0.0125;
            knob.add(indicator);
            return group;
        };

        const buildSilverButton = (isLarge = false) => {
            const radius = isLarge ? 0.025 : 0.018;
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.015, 16), matSilver);
            mesh.rotation.x = Math.PI / 2;
            mesh.position.z = 0.0075;
            return mesh;
        };

        const buildGreenButton = () => {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 16), matGreen);
            mesh.rotation.x = Math.PI / 2;
            mesh.position.z = 0.0075;
            return mesh;
        };

        const buildBlackButton = () => {
            const group = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 16), matBlack);
            body.rotation.x = Math.PI / 2;
            body.position.z = 0.0075;
            group.add(body);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.002, 8, 24), matSilver);
            ring.position.z = 0.005;
            group.add(ring);
            return group;
        };

        // Grid parameters
        const gridScale = 0.85;
        const cols = 6;
        const rows = 5;
        const colSpacing = (panelWidth * gridScale) / cols;
        const rowSpacing = (panelHeight * gridScale) / rows;
        const startX = -(panelWidth * gridScale) / 2 + colSpacing / 2;
        const startY = (panelHeight * gridScale) / 2 - rowSpacing / 2;

        // Zeile 1: Status- und Warnleuchten (9 slots)
        const row1Cols = 9;
        const row1Spacing = (panelWidth * gridScale) / row1Cols;
        const row1StartX = -(panelWidth * gridScale) / 2 + row1Spacing / 2;

        const row1Elements = [
            null, // Slot 0: Empty
            buildLight('red', true),    // Element 1
            buildLight('yellow', true), // Element 2
            buildLight('yellow', true, 0.015), // Element 3
            buildLight('white', true),  // Element 4
            buildGreenIndicator(),      // Element 5
            buildSmallLED('red', false),// Element 6
            buildLight('red', true),    // Element 7
            buildDarkHole()             // Element 8
        ];

        row1Elements.forEach((el, i) => {
            if (el) {
                el.position.set(row1StartX + i * row1Spacing, startY, 0);
                controlsGroup.add(el);
            }
        });

        // Rows 2-5 (6 columns)
        const row2 = [
            buildMushroomButton(),
            buildRingButton(true, matBlack, matSilver),
            buildRingButton(false, matBlack, matSilver),
            buildRingButton(true, matBlack, matSilver),
            buildRingButton(false, matBlack, matSilver),
            buildRingButton(false, matBlack, matSilver)
        ];
        const row3 = [buildToggleSwitch(true), buildRotarySwitch(0), buildRotarySwitch(0), buildSilverButton(), buildSilverButton(), buildSilverButton()];
        const row4 = [buildRotarySwitch(0), buildRotarySwitch(0), buildRotarySwitch(Math.PI/2), buildSilverButton(), buildSilverButton(true), buildRotarySwitch(0)];
        const row5 = [null, buildRotarySwitch(0), buildRotarySwitch(0), buildSilverButton(), buildGreenButton(), buildBlackButton()];

        const remainingRows = [row2, row3, row4, row5];
        remainingRows.forEach((row, rIdx) => {
            row.forEach((el, cIdx) => {
                if (el) {
                    el.position.set(startX + cIdx * colSpacing, startY - (rIdx + 1) * rowSpacing, 0);
                    controlsGroup.add(el);
                }
            });
        });
    }

    populateDT1Panels(panelMeshes, cabDir) {
        if (!panelMeshes) return;

        const panelThickness = 0.08;
        const matRed = cheapMaterial({ color: '#d00000', roughness: 0.5 });
        const matWhite = cheapMaterial({ color: '#f0f0f0', roughness: 0.5 });
        const matBlack = cheapMaterial({ color: '#101010', roughness: 0.8 });
        const matGrey = cheapMaterial({ color: '#555555', roughness: 0.6 });
        const matSilver = cheapMaterial({ color: '#aaaaaa', roughness: 0.3, metalness: 0.7 });
        const matBrass = cheapMaterial({ color: '#b5a642', roughness: 0.4, metalness: 0.8 });
        const matYellow = cheapMaterial({ color: '#e0a000', roughness: 0.5 });
        const matBlue = cheapMaterial({ color: '#00ced1', roughness: 0.5 });

        const setupControlsGroup = (panel) => {
            const group = new THREE.Group();
            group.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
            group.rotation.y = (cabDir === 1) ? Math.PI : 0;
            panel.add(group);
            return group;
        };

        const buildRoundButton = (colorMat) => {
            const group = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.019, 0.005, 20), matSilver);
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
            const button = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 20), colorMat);
            button.rotation.x = Math.PI / 2;
            button.position.z = 0.004;
            group.add(button);
            return group;
        };

        const buildToggleSwitch = () => {
            const group = new THREE.Group();
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 16), matSilver);
            base.rotation.x = Math.PI / 2;
            group.add(base);
            const stem = new THREE.Group();
            stem.rotation.x = 0.4;
            group.add(stem);
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 8), matSilver);
            rod.position.z = 0.015;
            rod.rotation.x = Math.PI / 2;
            stem.add(rod);
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), matBlack);
            cap.position.z = 0.03;
            stem.add(cap);
            return group;
        };

        const buildRectSwitch = (isSmall = false) => {
            const w = isSmall ? 0.025 : 0.045;
            const h = isSmall ? 0.015 : 0.025;
            const group = new THREE.Group();
            const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), matBlack);
            group.add(body);
            return group;
        };

        const buildIndicator = (colorMat) => {
            const group = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 16), matSilver);
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16), colorMat);
            lens.rotation.x = Math.PI / 2;
            lens.position.z = 0.002;
            group.add(lens);
            return group;
        };

        const buildKeySwitch = () => {
            const group = new THREE.Group();
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 16), matSilver);
            base.rotation.x = Math.PI / 2;
            group.add(base);
            const key = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.02, 0.025), matSilver);
            key.position.set(0, 0, 0.0125);
            group.add(key);
            return group;
        };

        const buildRotarySwitch = (isLarge = false) => {
            const radius = isLarge ? 0.035 : 0.018;
            const height = isLarge ? 0.04 : 0.015;
            const group = new THREE.Group();
            const knob = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.9, height, 16), matBlack);
            knob.rotation.x = Math.PI / 2;
            knob.position.z = height / 2;
            group.add(knob);
            return group;
        };

        const buildRustyManometer = (label1, label2, color1, color2) => {
            const group = new THREE.Group();
            // Rustic brass/copper rim
            const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.015, 32), matBrass);
            rim.rotation.x = Math.PI / 2;
            group.add(rim);

            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Weathered parchment/metal look
            ctx.fillStyle = '#000000'; // Black background
            ctx.fillRect(0, 0, 128, 128);

            // Add some "grime"
            for (let i = 0; i < 400; i++) {
                ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`;
                ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
            }

            ctx.strokeStyle = '#634b35';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(64, 64, 60, 0, Math.PI * 2);
            ctx.stroke();

            // Scale 0-12
            ctx.strokeStyle = '#d4bc9d';
            ctx.lineWidth = 1.5;
            for (let i = 0; i <= 12; i++) {
                const angle = Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
                const len = (i % 2 === 0) ? 10 : 6;
                ctx.beginPath();
                ctx.moveTo(64 + Math.cos(angle) * 58, 64 + Math.sin(angle) * 58);
                ctx.lineTo(64 + Math.cos(angle) * (58 - len), 64 + Math.sin(angle) * (58 - len));
                ctx.stroke();
            }

            // Labels
            ctx.fillStyle = '#d4bc9d';
            ctx.font = 'bold 11px serif';
            ctx.textAlign = 'center';
            for (let i = 0; i <= 12; i += 2) {
                const angle = Math.PI * 0.75 + (i / 12) * Math.PI * 1.5;
                ctx.fillText(i.toString(), 64 + Math.cos(angle) * 42, 64 + Math.sin(angle) * 42 + 4);
            }

            ctx.font = '8px serif';
            ctx.fillText(label1, 64, 85);
            ctx.fillStyle = color2;
            ctx.fillText(label2, 64, 98);

            const tex = new THREE.CanvasTexture(canvas);
            const face = new THREE.Mesh(new THREE.CircleGeometry(0.06, 32), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
            face.position.z = 0.008;
            group.add(face);

            const buildNeedle = (col) => {
                const nGrp = new THREE.Group();
                const n = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.001), new THREE.MeshBasicMaterial({ color: col, fog: false }));
                n.geometry.translate(0, 0.02, 0);
                nGrp.add(n);
                nGrp.position.z = 0.01;
                return nGrp;
            };

            const needle1 = buildNeedle(color1);
            const needle2 = buildNeedle(color2);
            needle2.position.z = 0.011;
            face.add(needle1, needle2);

            return { group, needle1, needle2 };
        };

        const buildStaticGauge = (label, value) => {
            const group = new THREE.Group();
            const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.015, 32), matBrass);
            rim.rotation.x = Math.PI / 2;
            group.add(rim);

            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000000'; // Black background
            ctx.fillRect(0, 0, 128, 128);

            ctx.strokeStyle = '#d4bc9d';
            ctx.lineWidth = 1.5;
            for (let i = 0; i <= 100; i += 10) {
                const angle = Math.PI * 0.75 + (i / 100) * Math.PI * 1.5;
                ctx.beginPath();
                ctx.moveTo(64 + Math.cos(angle) * 58, 64 + Math.sin(angle) * 58);
                ctx.lineTo(64 + Math.cos(angle) * 48, 64 + Math.sin(angle) * 48);
                ctx.stroke();
            }

            ctx.fillStyle = '#d4bc9d';
            ctx.font = 'bold 12px serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, 64, 90);

            const tex = new THREE.CanvasTexture(canvas);
            const face = new THREE.Mesh(new THREE.CircleGeometry(0.06, 32), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
            face.position.z = 0.008;
            group.add(face);

            const needle = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.001), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
            needle.geometry.translate(0, 0.02, 0);
            needle.position.z = 0.01;
            needle.rotation.z = Math.PI * 0.75 - (value / 100) * Math.PI * 1.5;
            face.add(needle);

            return group;
        };

        // Panel 1: idx -2 (Far left)
        if (panelMeshes.panel1) {
            const g = setupControlsGroup(panelMeshes.panel1);
            // Top row: Red, White, Red
            [-0.1, 0, 0.1].forEach((x, i) => {
                const btn = buildRoundButton(i === 1 ? matWhite : matRed);
                btn.position.set(x, 0.11, 0);
                g.add(btn);
            });
            // Middle row: 3 Toggles
            [-0.1, 0, 0.1].forEach(x => {
                const sw = buildToggleSwitch();
                sw.position.set(x, 0, 0);
                g.add(sw);
            });
            // Bottom row: Black rect bar
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.005), matBlack);
            bar.position.set(0, -0.11, 0);
            g.add(bar);
        }

        // Panel 2: idx -1 (Left middle)
        if (panelMeshes.panel2) {
            const g = setupControlsGroup(panelMeshes.panel2);
            // Top row: Red, Red, Black
            [-0.1, 0, 0.1].forEach((x, i) => {
                const btn = buildRoundButton(i === 2 ? matBlack : matRed);
                btn.position.set(x, 0.11, 0);
                g.add(btn);
            });
            // Middle row: 3 Toggles
            [-0.1, 0, 0.1].forEach(x => {
                const sw = buildToggleSwitch();
                sw.position.set(x, 0, 0);
                g.add(sw);
            });
            // Bottom row: Key, small rotary
            const key = buildKeySwitch();
            key.position.set(-0.06, -0.11, 0);
            g.add(key);
            const rot = buildRotarySwitch(false);
            rot.position.set(0.04, -0.11, 0);
            g.add(rot);
        }

        // Panel 3: idx 0 (Center)
        if (panelMeshes.panel3) {
            const g = setupControlsGroup(panelMeshes.panel3);
            // Above speedo: 3 indicators: Yellow, Yellow, Red
            [-0.07, 0, 0.07].forEach((x, i) => {
                const ind = buildIndicator(i === 2 ? matRed : matYellow);
                ind.position.set(x, 0.13, 0);
                g.add(ind);
            });

            // Functional Dual Manometer (HBL and BZ)
            const manometer = buildRustyManometer('HBL', 'BZ', '#ffffff', '#ff3300');
            manometer.group.position.set(0.13, 0.02, 0);
            g.add(manometer.group);

            this.brakeNeedles.push({
                hbl: manometer.needle1,
                bz: manometer.needle2,
                hblSmoothed: 8.5,
                bzSmoothed: 0
            });

            // Static V x 10 Gauge
            const v10 = buildStaticGauge('V x 10', 75);
            v10.position.set(-0.13, 0.02, 0);
            g.add(v10);

            // Bottom: 4 small rect switches
            [-0.1, -0.035, 0.035, 0.1].forEach(x => {
                const sw = buildRectSwitch(true);
                sw.position.set(x, -0.13, 0);
                g.add(sw);
            });
        }

        // Panel 4: idx 1 (Right middle)
        if (panelMeshes.panel4) {
            const g = setupControlsGroup(panelMeshes.panel4);
            // Middle: 3x4 Matrix (moved up slightly)
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 4; c++) {
                    const sq = buildRectSwitch(true);
                    sq.position.set(-0.12 + c * 0.08, 0.08 - r * 0.045, 0);
                    g.add(sq);
                }
            }
            // Bottom: Large rotary
            const rot = buildRotarySwitch(true);
            rot.position.set(0.05, -0.11, 0);
            g.add(rot);
        }

        // Panel 5: idx 2 (Far right)
        if (panelMeshes.panel5) {
            const g = setupControlsGroup(panelMeshes.panel5);
            // Bottom left: 3 large round buttons (blue)
            [-0.13, -0.07, -0.01].forEach(x => {
                const btn = buildRoundButton(matBlue);
                btn.scale.set(1.4, 1.4, 1);
                btn.position.set(x, -0.11, 0);
                g.add(btn);
            });
            // Far right: Telephone
            const phone = new THREE.Group();
            phone.position.set(0.12, 0, 0);
            g.add(phone);
            const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.02), matBlack);
            phone.add(cradle);
            const handset = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.035), matGrey);
            handset.position.z = 0.025;
            phone.add(handset);
        }
    }

    buildBogie(carGroup, zOffset, hasCollector = false, redFrameDirection = 0) {
        const S = TRAIN_SCALE;
        const isG1 = (this.trainType === 'G1');
        const isDT1 = (this.trainType === 'DT1');
        const axleOffset = 1.05 * S; // 2.1m Radstand für beide Züge
        const bogieFrameWidth = isG1 ? 2.5 * S : 2.5 * S;
        const wheelX = 0.7175;
 
        const bogieFrameGeom = new THREE.BoxGeometry(1.8 * S, 0.10 * S, bogieFrameWidth);
        const frame = new THREE.Mesh(bogieFrameGeom, this.materials.bodyGrey);
        frame.position.set(0, -0.2494, zOffset);
        carGroup.add(frame);

        // Bolster/Suspension connecting the bogie to the chassis (Wiege / Drehzapfen)
        const bolsterGeom = new THREE.BoxGeometry(1.2 * S, 0.50 * S, 0.8 * S);
        const bolster = new THREE.Mesh(bolsterGeom, this.materials.bodyGrey);
        bolster.position.set(0, 0.05 * S, zOffset);
        carGroup.add(bolster);
 
        const axleZ = [zOffset - axleOffset, zOffset + axleOffset];
        axleZ.forEach(az => {
            const shaftGeom = new THREE.CylinderGeometry(0.04 * S, 0.04 * S, 1.9 * S, 8);
            shaftGeom.rotateZ(Math.PI / 2);
            const shaft = new THREE.Mesh(shaftGeom, this.materials.bodyGrey);
            shaft.position.set(0, -0.2914, az);
            carGroup.add(shaft);
 
            const wheelGeom = new THREE.CylinderGeometry(0.45 * S, 0.45 * S, 0.15 * S, 16);
            wheelGeom.rotateZ(Math.PI / 2);
            const wheelL = new THREE.Mesh(wheelGeom, this.materials.wheel);
            wheelL.position.set(-wheelX, -0.2914, az);
            
            const wheelR = wheelL.clone();
            wheelR.position.x = wheelX;
            
            carGroup.add(wheelL, wheelR);
        });

        if ((isG1 && hasCollector) || isDT1) {
            // Build yellow side current collector (Stromabnehmer) on both sides (X = ±1.0)
            const collectorXOffsets = [-1.0, 1.0];
            collectorXOffsets.forEach(cx => {
                const xSign = cx > 0 ? 1 : -1;
                
                // 1. Horizontal mounting bar/bracket (Yellow)
                const bracketGeom = new THREE.BoxGeometry(0.08 * S, 0.08 * S, 0.6 * S);
                const bracket = new THREE.Mesh(bracketGeom, this.materials.currentCollectorYellow);
                bracket.position.set(cx * S, -0.25 * S, zOffset);
                carGroup.add(bracket);

                // 2. Vertical support arm going down (Yellow)
                const armGeom = new THREE.BoxGeometry(0.06 * S, 0.12 * S, 0.1 * S);
                const arm = new THREE.Mesh(armGeom, this.materials.currentCollectorYellow);
                arm.position.set(cx * S, -0.32 * S, zOffset);
                carGroup.add(arm);

                // 3. Current collector shoe (Stromabnehmerschuh) (Dark Grey/Black)
                const shoeGeom = new THREE.BoxGeometry(0.12 * S, 0.03 * S, 0.35 * S);
                const shoe = new THREE.Mesh(shoeGeom, this.materials.bodyDarkGrey);
                shoe.position.set((cx + xSign * 0.02) * S, -0.38 * S, zOffset);
                carGroup.add(shoe);
            });
        }

        if (isDT1 && redFrameDirection !== 0) {
            // Build red vertical protective frame on both sides (X = ±1.0)
            const frameZ = zOffset + redFrameDirection * (axleOffset + 0.40 * S);
            const frameXOffsets = [-1.0, 1.0];
            frameXOffsets.forEach(cx => {
                const frameGeom = new THREE.BoxGeometry(0.06 * S, 0.35 * S, 0.16 * S);
                const frameMesh = new THREE.Mesh(frameGeom, this.materials.bodyRedDT1);
                frameMesh.position.set(cx * S, -0.42 * S, frameZ);
                carGroup.add(frameMesh);
            });
        }
    }

    createUnderbodyBox(carGroup, xCenter, yCenter, zCenter, sizeX, sizeY, sizeZ, material, hasDetails = false) {
        const S = TRAIN_SCALE;
        const geom = new THREE.BoxGeometry(sizeX * S, sizeY * S, sizeZ * S);
        const box = new THREE.Mesh(geom, material);
        box.position.set(xCenter * S, yCenter * S, zCenter * S);
        carGroup.add(box);

        if (hasDetails) {
            // Add access panel details on left/right sides
            const panelMat = this.materials.bodyDarkGrey;
            const detailMat = this.materials.bodyGlossBlack;
            const numPanels = Math.max(2, Math.floor(sizeZ / 0.5));
            const panelLength = (sizeZ - 0.1) / numPanels;
            
            for (let side of [-1, 1]) {
                const px = xCenter + side * (sizeX / 2 + 0.005);
                for (let pIdx = 0; pIdx < numPanels; pIdx++) {
                    const pz = zCenter - sizeZ / 2 + 0.05 + pIdx * panelLength + panelLength / 2;
                    const panelGeom = new THREE.BoxGeometry(0.01 * S, (sizeY - 0.06) * S, (panelLength - 0.04) * S);
                    const panel = new THREE.Mesh(panelGeom, detailMat);
                    panel.position.set(px * S, yCenter * S, pz * S);
                    carGroup.add(panel);
                }
            }
        }
    }

    createUnderbodyCylinder(carGroup, xCenter, yCenter, zCenter, radius, length, material) {
        const S = TRAIN_SCALE;
        const geom = new THREE.CylinderGeometry(radius * S, radius * S, length * S, 12);
        geom.rotateX(Math.PI / 2); // Rotate to lie horizontally along Z axis
        const cyl = new THREE.Mesh(geom, material);
        cyl.position.set(xCenter * S, yCenter * S, zCenter * S);
        carGroup.add(cyl);

        // Add mounting brackets / straps holding the cylinder
        const strapMat = this.materials.bodyDarkGrey;
        for (let zSign of [-1, 1]) {
            const strapGeom = new THREE.BoxGeometry((radius * 2 + 0.03) * S, 0.02 * S, 0.03 * S);
            const strap = new THREE.Mesh(strapGeom, strapMat);
            strap.position.set(xCenter * S, (yCenter + radius + 0.01) * S, (zCenter + zSign * (length / 3)) * S);
            carGroup.add(strap);
        }
    }

    buildG1Underbody(carGroup, carIdx, carLength) {
        const boxMaterial = this.materials.bodyGrey; // grey box
        const cylinderMaterial = this.materials.bodyBumperGrey; // slightly different grey/silver for air reservoirs

        // Chassis bottom is at Y = 0.30. Top of running gear rail is at Y = -0.7414.
        // Underbody box height: 0.52m (stretched downward).
        // Y center of boxes: Y = 0.30 - 0.52 / 2 = 0.04m.
        const yCenter = 0.04;
        const sizeY = 0.52;
        const sizeX = 2.4; // width

        if (carIdx === 0) {
            // Car 0: Cab car 1 (19.270m)
            // Bogies at -3.635 and -15.635. Space: -14.735 to -4.535 (length ~10.2m)
            
            // 1. Auxiliary Converter (Hilfsbetriebeumrichter)
            this.createUnderbodyBox(carGroup, 0, yCenter, -6.2, sizeX, sizeY, 2.2, boxMaterial, true);
            
            // 2. Battery Box (Batteriekasten)
            this.createUnderbodyBox(carGroup, 0, yCenter, -8.7, sizeX, sizeY, 1.8, boxMaterial, true);
            
            // 3. Air Reservoirs (Hauptluftbehälter) - Cylinder group side-by-side
            const cylRadius = 0.20;
            const cylY = 0.30 - cylRadius;
            this.createUnderbodyCylinder(carGroup, -0.45, cylY, -11.2, cylRadius, 1.8, cylinderMaterial);
            this.createUnderbodyCylinder(carGroup, 0.45, cylY, -11.2, cylRadius, 1.8, cylinderMaterial);
            
            // 4. Brake Control Unit Box (Bremsgerätetafel)
            this.createUnderbodyBox(carGroup, 0, yCenter, -13.7, sizeX, sizeY, 1.6, boxMaterial, true);

        } else if (carIdx === 1) {
            // Car 1: Middle car 1 (18.815m)
            // Bogies at -3.4075 and -15.4075. Space: -14.5075 to -4.3075 (length ~10.2m)
            
            // 1. Line Reactor (Netzdrossel)
            this.createUnderbodyBox(carGroup, 0, yCenter, -6.0, sizeX, sizeY, 1.6, boxMaterial, false);
            
            // 2. Traction Inverter (Antriebsstromrichter) - Very large box with details
            this.createUnderbodyBox(carGroup, 0, yCenter, -9.4, sizeX, sizeY, 3.8, boxMaterial, true);
            
            // 3. Auxiliary Box
            this.createUnderbodyBox(carGroup, 0, yCenter, -12.9, sizeX, sizeY, 1.8, boxMaterial, true);

        } else if (carIdx === 2) {
            // Car 2: Middle car 2 (18.815m) - Symmetrical mirror of Car 1 relative to center
            // Center of car: -9.4075.
            // Mirroring the Z positions of Car 1:
            // Box 1 (Line Reactor): Z = -6.0 -> mirror distance from center (-9.4075) is 3.4075. Mirror position: -9.4075 - 3.4075 = -12.815 (approx -12.8)
            // Box 2 (Traction Inverter): Z = -9.4 -> mirror distance is 0.0075. Mirror position: -9.4 - 0.0075 = -9.4075 (approx -9.4)
            // Box 3 (Aux Box): Z = -12.9 -> mirror distance is -3.4925. Mirror position: -9.4075 + 3.4925 = -5.915 (approx -6.0)
            
            // 1. Auxiliary Box
            this.createUnderbodyBox(carGroup, 0, yCenter, -6.0, sizeX, sizeY, 1.8, boxMaterial, true);
            
            // 2. Traction Inverter (Antriebsstromrichter)
            this.createUnderbodyBox(carGroup, 0, yCenter, -9.4, sizeX, sizeY, 3.8, boxMaterial, true);
            
            // 3. Line Reactor (Netzdrossel)
            this.createUnderbodyBox(carGroup, 0, yCenter, -12.8, sizeX, sizeY, 1.6, boxMaterial, false);

        } else if (carIdx === 3) {
            // Car 3: Cab car 2 (19.270m) - Symmetrical mirror of Car 0 relative to center
            // Center of car: -9.635.
            // Box 1 (Aux Converter): Z = -6.2 -> mirror: -9.635 - 3.435 = -13.07 (approx -13.1)
            // Box 2 (Battery Box): Z = -8.7 -> mirror: -9.635 - 0.935 = -10.57 (approx -10.6)
            // Cylinders: Z = -11.2 -> mirror: -9.635 + 1.565 = -8.07 (approx -8.1)
            // Box 4 (Brake Box): Z = -13.7 -> mirror: -9.635 + 4.065 = -5.57 (approx -5.6)
            
            // 1. Brake Control Unit Box
            this.createUnderbodyBox(carGroup, 0, yCenter, -5.6, sizeX, sizeY, 1.6, boxMaterial, true);
            
            // 2. Air Reservoirs - Cylinder group side-by-side
            const cylRadius = 0.20;
            const cylY = 0.30 - cylRadius;
            this.createUnderbodyCylinder(carGroup, -0.45, cylY, -8.1, cylRadius, 1.8, cylinderMaterial);
            this.createUnderbodyCylinder(carGroup, 0.45, cylY, -8.1, cylRadius, 1.8, cylinderMaterial);
            
            // 3. Battery Box
            this.createUnderbodyBox(carGroup, 0, yCenter, -10.6, sizeX, sizeY, 1.8, boxMaterial, true);
            
            // 4. Auxiliary Converter
            this.createUnderbodyBox(carGroup, 0, yCenter, -13.1, sizeX, sizeY, 2.2, boxMaterial, true);
        }
    }

    buildDT1Underbody(carGroup, carIdx) {
        const S = TRAIN_SCALE;
        const boxMaterial = this.materials.bodyGrey; // grey box
        const orangeMaterial = this.materials.underbodyOrange; // orange box

        // Chassis bottom is at Y = 0.30. Top of running gear rail is at Y = -0.7414.
        // Underbody box height for DT1: 0.45m.
        // Y center of boxes: Y = 0.30 - 0.45 / 2 = 0.075m.
        const yCenter = 0.075;
        const sizeY = 0.45;
        const sizeX = 2.4; // width

        // Carriage has driving cab if it's even index at front, odd index at rear
        const hasFrontCab = (carIdx % 2 === 0);

        if (hasFrontCab) {
            // A-Cars (Car 0, Car 2): Cab at front (Z = 0)
            // Bogies are at -3.95 and -15.91. Space between bogie frames: -14.66 to -5.20
            
            // 1. Small grey box
            this.createUnderbodyBox(carGroup, 0, yCenter, -5.7, sizeX, sizeY, 0.6, boxMaterial, false);
            
            // 2. Orange block (characteristic battery/switch box)
            this.createUnderbodyBox(carGroup, 0, yCenter, -6.6, sizeX, sizeY, 0.8, orangeMaterial, false);
            
            // 3. Medium grey box
            this.createUnderbodyBox(carGroup, 0, yCenter, -7.9, sizeX, sizeY, 1.4, boxMaterial, true);
            
            // 4. Large traction container (Antriebscontainer)
            this.createUnderbodyBox(carGroup, 0, yCenter, -10.4, sizeX, sizeY, 2.8, boxMaterial, true);
            
            // 5. Medium auxiliary box
            this.createUnderbodyBox(carGroup, 0, yCenter, -12.4, sizeX, sizeY, 1.0, boxMaterial, true);
            
            // 6. Small auxiliary box
            this.createUnderbodyBox(carGroup, 0, yCenter, -13.8, sizeX, sizeY, 1.0, boxMaterial, true);

        } else {
            // B-Cars (Car 1, Car 3): Cab at rear (Z = -18.575)
            // Bogies are at -2.66 and -14.62. Space between bogie frames: -13.37 to -3.91
            
            // Layout is mirrored from A-car (front-to-rear bogie reference)
            // 1. Small auxiliary box
            this.createUnderbodyBox(carGroup, 0, yCenter, -4.77, sizeX, sizeY, 1.0, boxMaterial, true);
            
            // 2. Medium auxiliary box
            this.createUnderbodyBox(carGroup, 0, yCenter, -6.17, sizeX, sizeY, 1.0, boxMaterial, true);
            
            // 3. Large traction container
            this.createUnderbodyBox(carGroup, 0, yCenter, -8.17, sizeX, sizeY, 2.8, boxMaterial, true);
            
            // 4. Medium grey box
            this.createUnderbodyBox(carGroup, 0, yCenter, -10.67, sizeX, sizeY, 1.4, boxMaterial, true);
            
            // 5. Orange block
            this.createUnderbodyBox(carGroup, 0, yCenter, -11.97, sizeX, sizeY, 0.8, orangeMaterial, false);
            
            // 6. Small grey box
            this.createUnderbodyBox(carGroup, 0, yCenter, -12.87, sizeX, sizeY, 0.6, boxMaterial, false);
        }
    }

    createDoorPair(carGroup, xOffset, zOffset, carIdx, side) {
        const isG1 = (this.trainType === 'G1');
        const leafWidth = isG1 ? 0.818 : 0.55; // real G1 door width 1636mm / 2 leaves
        const doorHeight = isG1 ? 2.075 : 1.60;
        const doorYCenter = isG1 ? 1.4125 : 1.15;
        const closedOffset = isG1 ? 0.409 : 0.28;
 
        const doorL = new THREE.Group();
        doorL.position.set(xOffset, doorYCenter, zOffset - closedOffset);
        
        const doorR = new THREE.Group();
        doorR.position.set(xOffset, doorYCenter, zOffset + closedOffset);
        
        const wallMaterial = isG1 ? this.materials.bodyRedG1 : this.materials.bodyRedDT1;
        const whiteMaterial = this.materials.bodyWhite;
        const darkGreyMaterial = isG1 ? this.materials.bodyGlossBlack : this.materials.bodyDarkGrey;
        // Same material as the passenger side windows (by user request) — the
        // merge-domain box-test mismatch on door leaves (their own pivoting
        // domain, not the carriage frame) is accepted as-is here.
        const glassMaterial = this.materials.windowGlass;
        const greyMaterial = this.materials.bodyGrey;
 
        const buildDoorLeaf = (leafGroup, isLeft) => {
            const frameEdgeOffset = leafWidth / 2 - 0.05;
            const horizontalWidth = leafWidth - 0.20;
            const halfH = doorHeight / 2;
            const quarterH = doorHeight / 4;

            // Define centers and heights for the window frames and glass
            let lowFrameCenterY = -quarterH;
            let lowFrameHeight = halfH;
            let lowGlassCenterY = -quarterH;
            let lowGlassHeight = halfH - 0.20;
            let lowFrameTCenterY = 0.00;

            let upFrameCenterY = quarterH;
            let upFrameHeight = halfH;
            let upGlassCenterY = quarterH;
            let upGlassHeight = halfH - 0.20;
            let upFrameBCenterY = 0.10;

            if (isG1) {
                // Shifted for G1 to align lower edge of strut (lowerFrameT bottom) with 1.20 absolute height.
                // 1.20 absolute corresponds to 1.20 - 1.4125 = -0.2125 relative.
                // Since lowerFrameT has height 0.10, its bottom is at centerY - 0.05.
                // Thus, centerY - 0.05 = -0.2125 => centerY = -0.1625.
                lowFrameTCenterY = -0.1625;
                lowFrameCenterY = -0.575;
                lowFrameHeight = 0.925;
                lowGlassCenterY = -0.575;
                lowGlassHeight = 0.725;

                upFrameBCenterY = -0.0625;
                upFrameCenterY = 0.4625;
                upFrameHeight = 1.15;
                upGlassCenterY = 0.4625;
                upGlassHeight = 0.95;
            }

            // 1. Lower window:
            const lowerFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.02, lowFrameHeight, 0.10), darkGreyMaterial);
            lowerFrameL.position.set(0, lowFrameCenterY, -frameEdgeOffset);

            const lowerFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.02, lowFrameHeight, 0.10), darkGreyMaterial);
            lowerFrameR.position.set(0, lowFrameCenterY, frameEdgeOffset);

            const lowerFrameB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            lowerFrameB.position.set(0, -halfH + 0.05, 0);

            const lowerFrameT = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            lowerFrameT.position.set(0, lowFrameTCenterY, 0);

            const lowerGlass = new THREE.Mesh(new THREE.BoxGeometry(0.01, lowGlassHeight, horizontalWidth), glassMaterial);
            lowerGlass.position.set(0, lowGlassCenterY, 0);

            leafGroup.add(lowerFrameL, lowerFrameR, lowerFrameB, lowerFrameT, lowerGlass);

            // 2. Upper window:
            const upperFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.02, upFrameHeight, 0.10), darkGreyMaterial);
            upperFrameL.position.set(0, upFrameCenterY, -frameEdgeOffset);

            const upperFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.02, upFrameHeight, 0.10), darkGreyMaterial);
            upperFrameR.position.set(0, upFrameCenterY, frameEdgeOffset);

            const upperFrameB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            upperFrameB.position.set(0, upFrameBCenterY, 0);

            const upperFrameT = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            upperFrameT.position.set(0, halfH - 0.05, 0);

            const upperGlass = new THREE.Mesh(new THREE.BoxGeometry(0.01, upGlassHeight, horizontalWidth), glassMaterial);
            upperGlass.position.set(0, upGlassCenterY, 0);

            leafGroup.add(upperFrameL, upperFrameR, upperFrameB, upperFrameT, upperGlass);
 
            // 3. Illuminated door strip on the meeting edge (outside face)
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(0.005, doorHeight - 0.02, 0.012),
                new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false })
            );
            const stripZ = isLeft ? (closedOffset - 0.009) : (-closedOffset + 0.009);
            const stripX = 0.011 * Math.sign(xOffset);
            strip.position.set(stripX, 0.05, stripZ);
            leafGroup.add(strip);
            return strip;
        };
 
        const stripL = buildDoorLeaf(doorL, true);
        const stripR = buildDoorLeaf(doorR, false);
 
        carGroup.add(doorL, doorR);
 
        this.doors.push({
            meshL: doorL,
            meshR: doorR,
            stripL: stripL,
            stripR: stripR,
            baseZ: zOffset,
            carIdx: carIdx,
            side: side,
            xClosed: xOffset,
            closedOffset: closedOffset
        });
    }

    drawLeftScreen(screen) {
        const ctx = screen.leftCtx;
        const width = screen.leftCanvas.width;   // 512
        const height = screen.leftCanvas.height; // 256

        const bgDark = '#14171d';
        const bgField = '#0c0f12';
        const bgLight = '#d7dae0';
        const textDark = '#101216';
        const textLight = '#eef0f3';
        const textMuted = '#8b93a1';
        const blueActive = '#2f6fd1';
        const borderCol = '#4b5563';

        ctx.fillStyle = bgDark;
        ctx.fillRect(0, 0, width, height);

        const headerH = 28;
        const footerH = 26;
        const sidebarW = 46;
        const mainW = width - sidebarW;

        // ---- Kopfzeile (Statusleiste) ----
        ctx.fillStyle = bgLight;
        ctx.fillRect(0, 0, width, headerH);
        ctx.textBaseline = 'middle';

        ctx.fillStyle = textDark;
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('601   0s   KT 24h', 10, headerH / 2 + 1);

        ctx.textAlign = 'center';
        ctx.fillText('TÜREN', width / 2, headerH / 2 + 1);

        const now = new Date();
        const days = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
        const y = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${days[now.getDay()]} ${y}-${mo}-${d}   ${hh}:${mi}:${ss}`, width - 10, headerH / 2 + 1);

        // ---- Bereich 1: Fahrzeugschema ----
        const carX0 = 14, carX1 = 410, carTipX = 452, carY0 = 38, carY1 = 86;
        ctx.beginPath();
        ctx.moveTo(carX0 + 8, carY0);
        ctx.lineTo(carX1, carY0);
        ctx.lineTo(carTipX, (carY0 + carY1) / 2);
        ctx.lineTo(carX1, carY1);
        ctx.lineTo(carX0 + 8, carY1);
        ctx.quadraticCurveTo(carX0, carY1, carX0, carY1 - 8);
        ctx.lineTo(carX0, carY0 + 8);
        ctx.quadraticCurveTo(carX0, carY0, carX0 + 8, carY0);
        ctx.closePath();
        ctx.strokeStyle = '#5b6472';
        ctx.lineWidth = 2;
        ctx.stroke();

        const doorCount = 11;
        const rowX0 = 26, rowX1 = 402;
        const cellW = 24;
        const cellGap = (rowX1 - rowX0 - doorCount * cellW) / (doorCount - 1);
        for (let i = 0; i < doorCount; i++) {
            const cx = rowX0 + i * (cellW + cellGap);
            ctx.fillStyle = textLight;
            ctx.fillRect(cx, 46, cellW, 10);

            ctx.fillStyle = bgField;
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = 1;
            const sq = 10;
            const sqx = cx + cellW / 2 - sq / 2;
            ctx.fillRect(sqx, 68, sq, sq);
            ctx.strokeRect(sqx, 68, sq, sq);
        }

        // ---- Bereich 2: Zentrales Symbol-Raster ----
        const gridX0 = 10, gridX1 = 456, gridY0 = 96, gridY1 = 188;
        const cols = 5;
        const colGap = 7.75;
        const colW = (gridX1 - gridX0 - (cols - 1) * colGap) / cols;
        const rowGap = 4;
        const rowH = (gridY1 - gridY0 - rowGap) / 2;
        const row1Y = gridY0;
        const row2Y = gridY0 + rowH + rowGap;
        const colX = (i) => gridX0 + i * (colW + colGap);

        const drawField = (x, y, w, h, highlighted) => {
            ctx.fillStyle = highlighted ? blueActive : '#20242c';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);
        };

        // Row 1, Col 1: Isolierung/Abschaltung (Kreis, diagonal durchgestrichen)
        {
            const x = colX(0), yc = row1Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row1Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(xc, yc, 13, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(xc - 16, yc + 16);
            ctx.lineTo(xc + 16, yc - 16);
            ctx.stroke();
        }

        // Row 1, Col 2: Stromabnehmer / Hochspannung "3~"
        {
            const x = colX(1), yc = row1Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row1Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xc, yc - 15);
            ctx.lineTo(xc - 10, yc - 2);
            ctx.lineTo(xc + 10, yc - 2);
            ctx.lineTo(xc, yc + 12);
            ctx.stroke();
            ctx.fillStyle = textLight;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('3~', xc, yc + 15);
        }

        // Column 3 (merged, both rows): Tür-Symbol, aktiv/blau
        {
            const x = colX(2), w = colW, yc = gridY0 + (gridY1 - gridY0) / 2, xc = x + w / 2;
            drawField(x, gridY0, w, gridY1 - gridY0, true);
            ctx.fillStyle = '#ffffff';
            const doorW = 12, doorH = 34, gap = 4;
            ctx.fillRect(xc - gap / 2 - doorW, yc - doorH / 2, doorW, doorH);
            ctx.fillRect(xc + gap / 2, yc - doorH / 2, doorW, doorH);
            ctx.strokeStyle = '#0c1e4a';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(xc - gap / 2 - doorW, yc - doorH / 2, doorW, doorH);
            ctx.strokeRect(xc + gap / 2, yc - doorH / 2, doorW, doorH);
        }

        // Row 1, Col 4: Kupplung (Rechteck über Kreis)
        {
            const x = colX(3), yc = row1Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row1Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            ctx.strokeRect(xc - 9, yc - 15, 18, 10);
            ctx.beginPath();
            ctx.arc(xc, yc + 6, 9, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Row 1, Col 5: Sanden / Akustik (strahlenförmig)
        {
            const x = colX(4), yc = row1Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row1Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            for (let a = 0; a < 8; a++) {
                const ang = (a / 8) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(xc + Math.cos(ang) * 5, yc + Math.sin(ang) * 5);
                ctx.lineTo(xc + Math.cos(ang) * 15, yc + Math.sin(ang) * 15);
                ctx.stroke();
            }
        }

        // Row 2, Col 1: Bremse (Kreis mit zwei Bremsbacken)
        {
            const x = colX(0), yc = row2Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row2Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(xc, yc, 11, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = textLight;
            ctx.fillRect(xc - 18, yc - 4, 6, 8);
            ctx.fillRect(xc + 12, yc - 4, 6, 8);
        }

        // Row 2, Col 2: Motor "M" im Kreis
        {
            const x = colX(1), yc = row2Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row2Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(xc, yc, 13, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = textLight;
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('M', xc, yc + 1);
        }

        // Row 2, Col 4: Brandmeldung (Flamme)
        {
            const x = colX(3), yc = row2Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row2Y, colW, rowH, false);
            ctx.fillStyle = textLight;
            ctx.beginPath();
            ctx.moveTo(xc, yc - 15);
            ctx.quadraticCurveTo(xc + 12, yc - 4, xc + 5, yc + 8);
            ctx.quadraticCurveTo(xc + 8, yc, xc, yc + 15);
            ctx.quadraticCurveTo(xc - 8, yc, xc - 5, yc - 6);
            ctx.quadraticCurveTo(xc - 8, yc - 10, xc, yc - 15);
            ctx.closePath();
            ctx.fill();
        }

        // Row 2, Col 5: Stromabnehmer gesenkt / Erdung (T-Symbol mit Blitz)
        {
            const x = colX(4), yc = row2Y + rowH / 2, xc = x + colW / 2;
            drawField(x, row2Y, colW, rowH, false);
            ctx.strokeStyle = textLight;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xc - 12, yc - 12);
            ctx.lineTo(xc + 2, yc - 12);
            ctx.moveTo(xc - 5, yc - 12);
            ctx.lineTo(xc - 5, yc + 12);
            ctx.stroke();
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.moveTo(xc + 8, yc - 10);
            ctx.lineTo(xc, yc + 2);
            ctx.lineTo(xc + 6, yc + 2);
            ctx.lineTo(xc - 2, yc + 14);
            ctx.lineTo(xc + 12, yc - 2);
            ctx.lineTo(xc + 6, yc - 2);
            ctx.closePath();
            ctx.fill();
        }

        // ---- Bereich 3: Text-Informationszeile ----
        const infoY = 200;
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = this.sim.emergencyBrake ? '#ff5555' : textLight;
        ctx.fillText(this.sim.emergencyBrake ? 'Störung' : 'Normalbetrieb', 10, infoY);

        const isHolding = (this.sim.speed < 0.05 && this.sim.throttle < 0);
        ctx.fillStyle = isHolding ? textLight : textMuted;
        ctx.fillText('Haltebremse', 145, infoY);

        const speedKmh = Math.max(0, this.sim.speed) * 3.6;
        ctx.fillStyle = textLight;
        ctx.fillText(`${speedKmh.toFixed(1)} km/h`, 260, infoY);

        const doorState = this.sim.doorState;
        const doorLetter = (doorState === 1) ? 'B' : (doorState === 2) ? 'C' : (doorState === 3) ? 'D' : 'A';
        ctx.fillText(`Tür-Zust ${doorLetter}`, 375, infoY);

        // ---- Bereich 4: Status-Indikator ----
        const statY = 214;
        ctx.fillStyle = '#f2e6a8';
        ctx.fillRect(10, statY, 24, 16);
        ctx.strokeStyle = borderCol;
        ctx.strokeRect(10, statY, 24, 16);
        ctx.fillStyle = textDark;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('D', 22, statY + 9);

        // ---- Fußzeile (Untere Menüleiste) ----
        const footerY = height - footerH;
        ctx.fillStyle = bgLight;
        ctx.fillRect(0, footerY, mainW, footerH);
        const segCount = 8;
        const segW = mainW / segCount;
        ctx.strokeStyle = '#8a8f97';
        ctx.lineWidth = 1;
        for (let i = 1; i < segCount; i++) {
            ctx.beginPath();
            ctx.moveTo(i * segW, footerY);
            ctx.lineTo(i * segW, height);
            ctx.stroke();
        }

        ctx.fillStyle = textDark;
        ctx.textAlign = 'center';
        ctx.font = '11px sans-serif';
        ctx.fillText('Melde-', segW * 0.5, footerY + footerH / 2 - 7);
        ctx.fillText('liste', segW * 0.5, footerY + footerH / 2 + 7);
        ctx.fillText('Einstell.', segW * 1.5, footerY + footerH / 2);
        ctx.fillText('Anfahrt', segW * 3.5, footerY + footerH / 2 - 7);
        ctx.fillText('sperren', segW * 3.5, footerY + footerH / 2 + 7);

        // Home icon in the last footer segment
        {
            const hx = segW * 7.5, hy = footerY + footerH / 2;
            ctx.strokeStyle = textDark;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(hx, hy, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(hx - 5, hy);
            ctx.lineTo(hx, hy - 5);
            ctx.lineTo(hx + 5, hy);
            ctx.lineTo(hx + 3, hy);
            ctx.lineTo(hx + 3, hy + 5);
            ctx.lineTo(hx - 3, hy + 5);
            ctx.lineTo(hx - 3, hy);
            ctx.closePath();
            ctx.stroke();
        }

        // ---- Rechte Seitenleiste ----
        const sbX = mainW;
        const sbY0 = headerH;
        const sbH = height - headerH;
        ctx.fillStyle = bgLight;
        ctx.fillRect(sbX, sbY0, sidebarW, sbH);
        const sbSegCount = 5;
        const sbSegH = sbH / sbSegCount;
        ctx.strokeStyle = '#8a8f97';
        for (let i = 1; i < sbSegCount; i++) {
            ctx.beginPath();
            ctx.moveTo(sbX, sbY0 + i * sbSegH);
            ctx.lineTo(width, sbY0 + i * sbSegH);
            ctx.stroke();
        }
        ctx.fillStyle = textDark;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Quittung', sbX + sidebarW / 2, sbY0 + sbSegH * 3.5);

        screen.leftTexture.needsUpdate = true;
    }

    drawMidScreen(screen) {
        const ctx = screen.midCtx;
        const width = screen.midCanvas.width;
        const height = screen.midCanvas.height;

        // Clear background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        const now = new Date();
        const dateStr = now.toLocaleDateString('de-DE');
        const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Fahrplan offset (e.g. -0051)
        const offsetVal = Math.round(this.sim.scheduleOffset);
        const offsetSign = offsetVal >= 0 ? '+' : '-';
        const offsetStr = offsetSign + Math.abs(offsetVal).toString().padStart(4, '0');

        const isReversing = this.sim.isReversing;
        const destStation = isReversing ? this.sim.stations[0] : this.sim.stations[this.sim.stations.length - 1];
        let destination = destStation ? destStation.name : "Terminal";
        if (destination === 'Hardhöhe') destination = 'Fürth Hardhöhe';

        // 1. Top Banner (Dark Blue)
        ctx.fillStyle = '#002060';
        ctx.fillRect(0, 0, width, 60);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 18px sans-serif';

        // Row 1
        ctx.fillText(dateStr, 15, 10);
        ctx.fillText(timeStr, 130, 10);
        ctx.fillText("Fzg 487", 260, 10);
        ctx.fillText("Fahrplan : " + offsetStr, 350, 10);

        // Row 2
        const lineName = this.sim.track.lineId || 'U1';
        ctx.fillText("Linie " + lineName, 15, 35);
        ctx.fillText("Kurs 3", 130, 35);
        ctx.fillText("L", 210, 35);
        ctx.fillText("Ziel: " + destination, 260, 35);

        // 2. Stop List Box (Light Gray)
        const boxWidth = width * 0.6;
        const boxHeight = 110;
        const boxX = 15;
        const boxY = 75;
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        let listIdx = this.sim.displayNextStationIdx;
        const step = isReversing ? -1 : 1;
        const avgSpeed = 10; // m/s average for ETA

        for (let j = 0; j < 4; j++) {
            if (listIdx >= 0 && listIdx < this.sim.stations.length) {
                const s = this.sim.stations[listIdx];
                const rowY = boxY + j * 25 + 5;

                // Highlight next station
                if (j === 0) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(boxX + 2, rowY - 2, boxWidth - 4, 24);
                }

                // ETA calculation
                const trainCenter = isReversing ? (this.sim.position + this.sim.trainHalfLength) : (this.sim.position - this.sim.trainHalfLength);
                const dist = Math.abs(trainCenter - s.position);
                const etaSeconds = dist / avgSpeed;
                const arrivalTime = new Date(now.getTime() + etaSeconds * 1000);
                const arrivalStr = arrivalTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

                ctx.fillStyle = '#000000';
                ctx.font = 'bold 16px sans-serif';
                ctx.fillText(arrivalStr, boxX + 10, rowY + 2);
                ctx.fillText(s.name, boxX + 80, rowY + 2);

                listIdx += step;
            }
        }

        // 3. Navigation Buttons (Arrows)
        const btnSize = 45;
        const btnX = boxX + boxWidth + 15;
        const drawBtn = (x, y, w, h, text, highlighted = false) => {
            ctx.fillStyle = highlighted ? '#ffffff' : '#d0d0d0';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#808080';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = '#000000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(text, x + w / 2, y + h / 2);
        };

        drawBtn(btnX, boxY, btnSize, btnSize, "▲");
        drawBtn(btnX, boxY + boxHeight - btnSize, btnSize, btnSize, "▼");

        // 4. OK / Abbruch Buttons
        drawBtn(width / 2 - 60, boxY + boxHeight + 10, 50, 30, "OK");
        drawBtn(width / 2 + 10, boxY + boxHeight + 10, 80, 30, "Abbruch");

        // 5. Door Side Indicators
        const side = this.sim.getPlatformSide();
        drawBtn(15, boxY + boxHeight + 10, 100, 30, "Ausstieg links", side === 'left');
        drawBtn(width - 115, boxY + boxHeight + 10, 100, 30, "Ausstieg rechts", side === 'right');

        // 6. Bottom Toolbar
        const toolbarLabels = ["Anmeldung", "Funk", "Meldungen", "Einstellungen", "Service"];
        const toolbarW = (width - 30) / 5;
        toolbarLabels.forEach((label, i) => {
            drawBtn(15 + i * toolbarW, height - 35, toolbarW - 5, 30, label);
        });

        screen.midTexture.needsUpdate = true;
    }

    drawRightScreen(screen) {
        const ctx = screen.rightCtx;
        const width = screen.rightCanvas.width;
        const height = screen.rightCanvas.height;

        // Palette borrowed from drawLeftScreen (panel1/Fahrplan) so the two screens read
        // as one family: light Kopfzeile on a dark field, same muted/border tones.
        const bgField = '#0c0f12';
        const bgLight = '#d7dae0';
        const textDark = '#101216';
        const textMuted = '#6b7280';
        const borderCol = '#4b5563';

        // Clear background
        ctx.fillStyle = bgField;
        ctx.fillRect(0, 0, width, height);

        // --- Kopfzeile (Statusleiste) ---
        const headerH = 25;
        ctx.fillStyle = bgLight;
        ctx.fillRect(0, 0, width, headerH);
        ctx.textBaseline = 'middle';

        ctx.fillStyle = textDark;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('485', 10, headerH / 2 + 1);

        const now = new Date();
        const days = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
        const dateStr = `${days[now.getDay()]} ${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        ctx.textAlign = 'right';
        ctx.fillText(dateStr, width - 10, headerH / 2 + 1);
        ctx.textBaseline = 'alphabetic';

        // --- Zeile 1 (Karteireiter) ---
        const tabWidth = (width - 20) / 4;
        const drawTab = (x, label) => {
            ctx.fillStyle = '#4a4d52';
            ctx.beginPath();
            ctx.roundRect(x, 30, tabWidth - 2, 25, 4);
            ctx.fill();
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + tabWidth / 2, 47);
        };
        for (let i = 0; i < 4; i++) {
            drawTab(10 + i * tabWidth, (485 + i).toString());
        }

        // --- Zeile 2 (Obere Tastenreihe) ---
        const btnWidth = (width - 30) / 5;
        const drawBtn = (x, y, label, color, textColor = '#ffffff') => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(x, y, btnWidth - 4, 30, 5);
            ctx.fill();
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(label, x + (btnWidth - 4) / 2, y + 19);
        };

        const row2Labels = ['Anzeiger', 'BG-FGIS', 'FGRB', 'RFLM', 'LAN/WLAN'];
        const row2Colors = ['#4a4d52', '#4a4d52', '#4a4d52', '#eab308', '#ffffff'];
        const row2TextColors = ['#ffffff', '#ffffff', '#ffffff', '#000000', '#000000'];

        for (let i = 0; i < 5; i++) {
            drawBtn(10 + i * btnWidth, 65, row2Labels[i], row2Colors[i], row2TextColors[i]);
        }

        // --- Zeile 3 (Untere Tastenreihe) - bündig unter den ersten 4 Spalten, 5. leer ---
        const row3Labels = ['ZF', 'ELA', 'FGZ', 'RLS'];
        for (let i = 0; i < 4; i++) {
            drawBtn(10 + i * btnWidth, 105, row3Labels[i], '#4a4d52');
        }

        // --- Zeile 4 (Informationsleiste / Ticker) - flush against the footer's top edge ---
        const footerH = 35;
        const tickerH = 40;
        const tickerY = (height - footerH) - tickerH;
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, tickerY, width, tickerH);

        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'left';
        const tickerText = 'Straßenbahnen aufgrund von Hitze außer Betrieb. Ein Schienenersetzverkehr wird bereitgestellt.      ';
        const textMetrics = ctx.measureText(tickerText);
        const tickerOffset = (Date.now() / 50) % textMetrics.width;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, tickerY, width, tickerH);
        ctx.clip();
        ctx.fillText(tickerText, 10 - tickerOffset, tickerY + 25);
        ctx.fillText(tickerText, 10 - tickerOffset + textMetrics.width, tickerY + 25);
        ctx.restore();

        // --- Zeile 5 (Fußzeile / Menüleiste) ---
        ctx.fillStyle = '#1a1d22';
        ctx.fillRect(0, height - 35, width, 35);

        // Home Icon
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(25, height - 17, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        // Simple house shape inside
        ctx.beginPath();
        ctx.moveTo(25, height - 22);
        ctx.lineTo(20, height - 17);
        ctx.lineTo(22, height - 17);
        ctx.lineTo(22, height - 13);
        ctx.lineTo(28, height - 13);
        ctx.lineTo(28, height - 17);
        ctx.lineTo(30, height - 17);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = textMuted;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Legende', 80, height - 15);
        ctx.fillText('Hinweise', 140, height - 15);

        ctx.font = '9px sans-serif';
        ctx.fillText('Ortsnummer', 220, height - 20);
        ctx.fillText('umschalten', 220, height - 10);

        ctx.textAlign = 'right';
        ctx.fillText('Einstel-', width - 10, height - 20);
        ctx.fillText('lungen', width - 10, height - 10);

        screen.rightTexture.needsUpdate = true;
    }

    createDestinationSignMaterial() {
        if (this.destScreenMat) return this.destScreenMat;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 70px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lineName = this.sim.track.lineId || 'U1';
        const isReversing = this.sim.isReversing;
        const destStation = isReversing ? this.sim.stations[0] : this.sim.stations[this.sim.stations.length - 1];
        let destName = destStation ? destStation.name : 'Terminal';
        if (destName === 'Hardhöhe') destName = 'Fürth Hardhöhe';

        ctx.fillText(lineName + " " + destName, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        
        this.destScreenMat = new THREE.MeshBasicMaterial({ map: texture, fog: false });
        return this.destScreenMat;
    }

    createDT1DestinationSignMaterial() {
        if (this.dt1DestScreenMat) return this.dt1DestScreenMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const lineName = this.sim.track.lineId || 'U1';
        let boxColor = '#0055a5'; // Nuremberg U1 Blue
        if (lineName === 'U2' || lineName === 'TRUNK') boxColor = '#cb0611'; // U2 Red
        else if (lineName === 'U3') boxColor = '#2da4a8'; // U3 Turquoise

        ctx.fillStyle = boxColor;
        ctx.fillRect(canvas.width / 2 - 132, canvas.height / 2 - 28, 84, 56);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lineName, canvas.width / 2 - 90, canvas.height / 2);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px sans-serif';
        const isReversing = this.sim.isReversing;
        const destStation = isReversing ? this.sim.stations[0] : this.sim.stations[this.sim.stations.length - 1];
        let destName = destStation ? destStation.name : 'Terminal';
        if (destName === 'Hardhöhe') destName = 'Fürth Hardhöhe';
        ctx.fillText(destName, canvas.width / 2 + 70, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        this.dt1DestScreenMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, fog: false });
        return this.dt1DestScreenMat;
    }

    // Draws text horizontally compressed (canvas 2D has no reliable cross-browser
    // font-stretch support), for a narrower/condensed look at a given font size.
    fillTextNarrow(ctx, text, x, y, scaleX = 0.8) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scaleX, 1);
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    // Draws the whole in-cab radio interface (title, station, current song, or "Aus")
    // onto one radio display canvas. Shared by the initial draw and updateRadioDisplay().
    drawRadioDisplay(ctx, canvas, stationName, songName, active) {
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';

        ctx.fillStyle = '#7a7f8a';
        ctx.font = 'bold 18px sans-serif';
        ctx.textBaseline = 'top';
        this.fillTextNarrow(ctx, 'U-Bahn-Radio', canvas.width / 2, 14);

        if (!active) {
            ctx.fillStyle = '#565a63';
            ctx.font = 'bold 24px sans-serif';
            ctx.textBaseline = 'middle';
            this.fillTextNarrow(ctx, 'Aus', canvas.width / 2, canvas.height / 2 + 10);
            return;
        }

        ctx.fillStyle = '#ffcc44';
        ctx.font = 'bold 24px sans-serif';
        ctx.textBaseline = 'middle';
        this.fillTextNarrow(ctx, stationName, canvas.width / 2, canvas.height / 2 - 10);

        ctx.fillStyle = '#ffffff';
        ctx.font = '18px sans-serif';
        this.fillTextNarrow(ctx, songName, canvas.width / 2, canvas.height / 2 + 40);

        // "Aus" button, top-right corner - matches the hit-test zone in WorldManager's
        // radio click handler (uv.x > 0.75 && uv.y > 0.7, i.e. this same corner).
        const btnW = canvas.width * 0.22, btnH = canvas.height * 0.26;
        const btnX = canvas.width - btnW - 6, btnY = 6;
        ctx.strokeStyle = '#8a2f2f';
        ctx.lineWidth = 2;
        ctx.strokeRect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = '#e05555';
        ctx.font = 'bold 14px sans-serif';
        ctx.textBaseline = 'middle';
        this.fillTextNarrow(ctx, 'Aus', btnX + btnW / 2, btnY + btnH / 2 + 1);
    }

    // Called from main.js whenever the radio's station/song/on-off state changes,
    // keeping every registered radio display screen (one per cab) in sync.
    updateRadioDisplay(stationName, songName, active) {
        for (const d of this.radioDisplays) {
            this.drawRadioDisplay(d.ctx, d.canvas, stationName, songName, active);
            d.texture.needsUpdate = true;
        }
    }

    updateDestinationSign(isReversing) {
        const lineName = this.sim.track.lineId || 'U1';
        const destStation = isReversing ? this.sim.stations[0] : this.sim.stations[this.sim.stations.length - 1];
        let destName = destStation ? destStation.name : 'Terminal';
        if (destName === 'Hardhöhe') destName = 'Fürth Hardhöhe';

        // Performance guard: only redraw if the destination or line actually changed
        const destKey = `${lineName}_${destName}_${this.trainType}`;
        if (this.lastDestKey === destKey) return;
        this.lastDestKey = destKey;

        if (this.trainType === 'DT3') {
            this.updateDT3DestinationSign(lineName, destName);
            return;
        }

        if (this.trainType === 'DT1') {
            if (!this.dt1DestScreenMat || !this.dt1DestScreenMat.map) return;
            const canvas = this.dt1DestScreenMat.map.image;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#0a0a0c';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            let boxColor = '#005da7'; // Nürnberger U1 Blue
            if (lineName === 'U2') boxColor = '#cc070e'; // Nürnberger U2 Red
            else if (lineName === 'U3') boxColor = '#2ea3ab'; // Nürnberger U3 Turquoise
            else if (lineName === 'U11') boxColor = '#f97316'; // Nuremberg Orange

            ctx.fillStyle = boxColor;
            ctx.fillRect(canvas.width / 2 - 132, canvas.height / 2 - 28, 84, 56);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 44px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(lineName, canvas.width / 2 - 90, canvas.height / 2);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px sans-serif';
            ctx.fillText(destName, canvas.width / 2 + 70, canvas.height / 2);

            this.dt1DestScreenMat.map.needsUpdate = true;
            return;
        }

        if (!this.destScreenMat || !this.destScreenMat.map) return;
        const canvas = this.destScreenMat.map.image;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 70px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.fillText(lineName + " " + destName, canvas.width / 2, canvas.height / 2);
        
        this.destScreenMat.map.needsUpdate = true;
    }

    createInteriorDisplayMaterial() {
        const isG1 = this.trainType === 'G1';

        const createOne = () => {
            const canvas = document.createElement('canvas');
            canvas.width = isG1 ? 1408 : 512;
            canvas.height = isG1 ? 128 : 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, fog: false });
        };

        this.interiorDisplayMatF = createOne();
        this.interiorDisplayMatB = createOne();
        
        // For compatibility during transition/disposal
        this.interiorDisplayMat = this.interiorDisplayMatF;
        return this.interiorDisplayMatF;
    }

    updateInteriorDisplays(text, side = 'left') {
        const mats = [
            { mat: this.interiorDisplayMatF, type: 'F' },
            { mat: this.interiorDisplayMatB, type: 'B' }
        ];

        for (const { mat, type } of mats) {
            if (!mat || !mat.map) continue;
            const canvas = mat.map.image;
            if (!canvas) continue;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const isG1 = this.trainType === 'G1';
            ctx.fillStyle = '#ffffff'; // White text color
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (isG1) {
                // 1/3 smaller than the original 54px (=36px), then stretched
                // vertically via a canvas scale so the glyphs still nearly fill
                // the board's full height instead of leaving it half-empty.
                const fontSize = 36;
                const vScale = 2.85;
                ctx.font = `bold ${fontSize}px "Doto Bold"`;
                ctx.letterSpacing = `${fontSize * 0.1}px`; // +10% letter spacing
                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.scale(1, vScale);
                ctx.fillText(text, 0, 0);
                ctx.restore();
                ctx.letterSpacing = '0px';
            } else {
                ctx.font = 'bold 36px monospace';
                ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            }

            // Draw exit side triangles for G1
            if (isG1) {
                const drawTriangle = (x, y, width, height, direction, active) => {
                    ctx.fillStyle = active ? '#ff0000' : '#440000';
                    ctx.beginPath();
                    if (direction === 'left') {
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + width, y - height / 2);
                        ctx.lineTo(x + width, y + height / 2);
                    } else {
                        ctx.moveTo(x, y);
                        ctx.lineTo(x - width, y - height / 2);
                        ctx.lineTo(x - width, y + height / 2);
                    }
                    ctx.closePath();
                    ctx.fill();

                    if (active) {
                        ctx.shadowBlur = 15;
                        ctx.shadowColor = '#ff0000';
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                };

                const margin = 340; // moved further inward from the board edges so the arrows stay visible
                const triW = 40;
                const triH = 50;

                // For 'B' (Backward/Rotated) displays, we invert the visual logic
                // because the entire mesh is rotated 180 degrees.
                const visualLeftActive = (type === 'F') ? (side === 'left') : (side === 'right');
                const visualRightActive = (type === 'F') ? (side === 'right') : (side === 'left');

                drawTriangle(margin, canvas.height / 2, triW, triH, 'left', visualLeftActive);
                drawTriangle(canvas.width - margin, canvas.height / 2, triW, triH, 'right', visualRightActive);
            }

            mat.map.needsUpdate = true;
        }
    }

    createFabricMaterial(bgColor = '#c62828') {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Red background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 64, 64);

        // Regularly distributed small dark grey boxes in rows and columns
        ctx.fillStyle = '#333333';
        const boxSize = 4;
        const spacing = 12.8; // 20% closer than 16
        for (let x = 4; x < 64; x += spacing) {
            for (let y = 4; y < 64; y += spacing) {
                ctx.fillRect(x, y, boxSize, boxSize);
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Use identity repeat and handle scaling via UVs for consistency on edges
        texture.repeat.set(1, 1);

        return cheapMaterial({
            map: texture,
            roughness: 0.8
        });
    }

    /**
     * Helper to adjust UVs of a BoxGeometry so textures aren't stretched on different sized faces.
     */
    applyBoxUVs(geometry, width, height, depth, scale = 10) {
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            let u = uv.getX(i);
            let v = uv.getY(i);
            const faceIdx = Math.floor(i / 4);

            if (faceIdx < 2) { // Sides (+X, -X): depth x height
                u *= depth * scale;
                v *= height * scale;
            } else if (faceIdx < 4) { // Top/Bottom (+Y, -Y): width x depth
                u *= width * scale;
                v *= depth * scale;
            } else { // Front/Back (+Z, -Z): width x height
                u *= width * scale;
                v *= height * scale;
            }
            uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
    }

    createNoppenFloorMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Darker base for more contrast
        ctx.fillStyle = '#111315';
        ctx.fillRect(0, 0, 128, 128);

        // Coarser studs: larger spacing and radius
        const spacing = 32;
        const radius = 10;
        ctx.lineWidth = 1.5;

        for (let y = spacing / 2; y < 128; y += spacing) {
            for (let x = spacing / 2; x < 128; x += spacing) {
                // Main circle - slightly lighter to pop from background
                ctx.fillStyle = '#22262b';
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();

                // Increased contrast highlights (top-left)
                ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                ctx.beginPath();
                ctx.arc(x, y, radius, Math.PI * 1.0, Math.PI * 1.6);
                ctx.stroke();

                // Increased contrast shadows (bottom-right)
                ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                ctx.beginPath();
                ctx.arc(x, y, radius, Math.PI * 0.0, Math.PI * 0.6);
                ctx.stroke();
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4); // Coarser tiling (fewer repetitions = larger studs)

        return cheapMaterial({ map: tex, roughness: 0.9, metalness: 0.1 });
    }

    createFloorMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Background: Light grey (slightly darker than wall #e6e8eb)
        ctx.fillStyle = '#9a9a9a';
        ctx.fillRect(0, 0, 512, 512);

        // Add tiny random triangles (fast white and fast black)
        for (let i = 0; i < 4000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const size = 1 + Math.random() * 3.5;
            const angle = Math.random() * Math.PI * 2;

            ctx.fillStyle = Math.random() > 0.5 ? '#fcfcfc' : '#050505';

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, -size);
            ctx.lineTo(size * 0.866, size * 0.5);
            ctx.lineTo(-size * 0.866, size * 0.5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Map texture to cover approx 0.5m x 0.5m per tile
        // Scaling now handled via applyBoxUVs for carriage-length independence
        texture.repeat.set(1, 1);

        return cheapMaterial({
            map: texture,
            metalness: 0.1,
            roughness: 0.8
        });
    }

    playAnnouncementChime() {
        // Dreiklang tiefer (C4-E4-G4), 30% schneller, Triangle-Wave und Hochpassfilter
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const filter = ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(400, ctx.currentTime);
            filter.connect(ctx.destination);

            const playTone = (freq, startTime, duration, decayTime, gain = 0.15) => {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.connect(env);
                env.connect(filter);

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, startTime);

                env.gain.setValueAtTime(0, startTime);
                env.gain.linearRampToValueAtTime(gain, startTime + 0.012);
                env.gain.setValueAtTime(gain, startTime + duration);
                env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + decayTime);

                osc.start(startTime);
                osc.stop(startTime + duration + decayTime + 0.05);
            };

            const now = ctx.currentTime;
            const interval = 0.15; // 30% schneller als 0.22
            playTone(261.63, now + 0.00, 0.15, 0.05);          // C4
            playTone(329.63, now + interval, 0.15, 0.05);      // E4
            playTone(392.00, now + interval * 2, 0.15, 2.00, 0.20); // G4
        } catch (e) {
            // AudioContext not available – silently skip
        }
    }

    buildInteriorPolesAndDividers(carGroup, minZ, maxZ, carIndex) {
        const isG1 = (this.trainType === 'G1' || this.trainType === 'DT3');
        const poleH = isG1 ? 2.41 : 1.91;
        const poleY = isG1 ? 1.585 : 1.335;
        const sleeveY = isG1 ? 1.50 : 1.25;
        const torusY = isG1 ? 1.45 : 1.20;
        const armrestY = isG1 ? 1.38 : 1.13;
        const torusX = isG1 ? 1.40 : 1.08;
        const armrestX = isG1 ? 1.10 : 0.855;
 
        const poleGeom = new THREE.CylinderGeometry(0.015, 0.015, poleH, 8);
        const chromeMat = (this.trainType === 'DT3') ? this.materials.dt3PoleGrey : this.materials.chromeMetal;
        const sleeveColor = (this.trainType === 'DT3') ? this.materials.dt3PoleGrey : (isG1 ? this.materials.bodyRedG1 : this.materials.bodyRedDT1);
        const armrestColor = (this.trainType === 'DT3') ? this.materials.dt3FabricRed : this.materials.fabricRed;
 
        const sleeveGeom = new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8);
        const torusGeom = new THREE.TorusGeometry(isG1 ? 0.60 : 0.45, 0.015, 8, 24, Math.PI);
        const armrestGeom = new THREE.BoxGeometry(isG1 ? 0.60 : 0.45, 0.08, 0.14);
        this.applyBoxUVs(armrestGeom, isG1 ? 0.60 : 0.45, 0.08, 0.14, 10);
 
        const addPole = (x, z) => {
            const pole = new THREE.Mesh(poleGeom, chromeMat);
            pole.position.set(x, poleY, z);
            carGroup.add(pole);
 
            const sleeve = new THREE.Mesh(sleeveGeom, sleeveColor);
            sleeve.position.set(x, sleeveY, z);
            carGroup.add(sleeve);
        };
 
        const getDoorPositions = (trainType, idx) => {
            if (trainType === 'G1') return this.getG1DoorPositions(idx);
            if (trainType === 'DT3') return idx === 0 ? [-4.3755, -9.9325, -15.4895] : [-3.553, -9.11, -14.667];
            return [-3.5, -9.5, -15.5]; // DT1 fallback
        };

        const centerPolesZ = getDoorPositions(this.trainType, carIndex);
        centerPolesZ.forEach(pz => {
            if (pz >= minZ && pz <= maxZ) {
                addPole(0, pz);
            }
        });
 
        let vestibulePolesZ = [];
        if (isG1) {
            const doors = getDoorPositions(this.trainType, carIndex);
            const dHalf = (this.trainType === 'DT3') ? 0.8725 : 0.818;
            doors.forEach(dz => {
                vestibulePolesZ.push(dz + dHalf);
                vestibulePolesZ.push(dz - dHalf);
            });
        } else {
            vestibulePolesZ = [-2.8, -4.2, -8.8, -10.2, -14.8, -16.2];
        }
 
        vestibulePolesZ.forEach(pz => {
            if (pz >= minZ && pz <= maxZ) {
                if (this.trainType === 'DT3') {
                    // Check if this pole is close to any 2-bay segment where the adjacent seat row is a single seat on the right side
                    const centers2Bay = (carIndex === 0) ? [-7.154, -12.711] : [-6.3315, -11.8885];
                    const isNear2Bay = centers2Bay.some(c => Math.abs(pz - c) < 2.5);

                    // Left side is always a double seat (pole flush at X = -0.41)
                    addPole(-0.41, pz);

                    // Right side: if near a 2-bay segment, it is adjacent to a single seat (pole flush at X = 0.91), else a double seat (pole flush at X = 0.41)
                    const rightX = isNear2Bay ? 0.91 : 0.41;
                    addPole(rightX, pz);
                } else {
                    // Semicircle partitions
                    const torusL = new THREE.Mesh(torusGeom, chromeMat);
                    torusL.position.set(-torusX, torusY, pz);
                    torusL.rotation.z = -Math.PI / 2;
                    carGroup.add(torusL);
 
                    const torusR = new THREE.Mesh(torusGeom, chromeMat);
                    torusR.position.set(torusX, torusY, pz);
                    torusR.rotation.z = Math.PI / 2;
                    carGroup.add(torusR);
 
                    // Leaning cushions oriented transverse (along X) inside the semicircles
                    for (let xSign of [-1, 1]) {
                        const armrest = new THREE.Mesh(armrestGeom, armrestColor);
                        armrest.position.set(xSign * armrestX, armrestY, pz);
                        armrest.rotation.x = Math.PI / 2;
                        carGroup.add(armrest);
                    }
                }
            }
        });
 
        // Add extra center poles between long benches (Panel 1) in end cars ONLY
        const isEndCar = (this.trainType === 'DT3') ? (carIndex === 0 || carIndex === 1) : (carIndex === 0 || carIndex === 3);
        if (isG1 && this.trainType !== 'DT3' && isEndCar) {
            const doors = getDoorPositions(this.trainType, carIndex);
            const dHalf = (this.trainType === 'DT3') ? 0.8725 : 0.818;
            // Panel 1 (between door 1 and door 2) has the long benches in end cars
            const z1 = doors[0] - dHalf;
            const z2 = doors[1] + dHalf;
            const step = (z2 - z1) / 3;
            addPole(0, z1 + step);
            addPole(0, z1 + 2 * step);
        }
    }

    buildBellowsHalf(carGroup, startZ, endZ, type) {
        const isG1 = (this.trainType === 'G1' || this.trainType === 'DT3');
        // Interior white: the frame doubles as the car-end wall around the
        // gangway opening, a large interior surface (the exterior gap between
        // cars is covered by the textured outer bellows below).
        const wallMat = this.materials.bodyWhite;
        const bellowsMat = this.materials.bellowsLightGrey;
 
        const dz = endZ - startZ;
        const absDz = Math.abs(dz);

        // Frame thickness is 0.05. We shift it by half (0.025) into the bellows gap
        // to prevent Z-fighting with the carriage body walls/roof which end at startZ.
        const frameThickness = 0.05;
        const frameOffsetZ = (dz > 0 ? 1 : -1) * (frameThickness / 2);
        const framePosZ = startZ + frameOffsetZ;
 
        const unscaledWidth = isG1 ? 2.90 : 2.20;
        const openWidth = 1.66;
        const frameW = (unscaledWidth - openWidth) / 2;
        const frameX = unscaledWidth / 2 - frameW / 2;
 
        const frameH = isG1 ? 2.41 : 1.91;
        const frameY = isG1 ? 1.585 : 1.335;
 
        const frameL = new THREE.Mesh(
            new THREE.BoxGeometry(frameW, frameH, frameThickness),
            wallMat
        );
        frameL.position.set(-frameX, frameY, framePosZ);
        carGroup.add(frameL);
 
        const frameR = new THREE.Mesh(
            new THREE.BoxGeometry(frameW, frameH, frameThickness),
            wallMat
        );
        frameR.position.set(frameX, frameY, framePosZ);
        carGroup.add(frameR);
 
        const frameTopH = isG1 ? 0.20 : 0.095;
        const frameTopY = isG1 ? 2.7475 : 2.2475;
        const frameT = new THREE.Mesh(
            new THREE.BoxGeometry(unscaledWidth, frameTopH, frameThickness),
            wallMat
        );
        frameT.position.set(0, frameTopY, framePosZ);
        carGroup.add(frameT);
 
        // Bellows start after the frame.
        const bellowsDz = Math.max(0.001, absDz - frameThickness);
        const bellowsOffsetZ = (dz > 0 ? 1 : -1) * (frameThickness + bellowsDz / 2);
        const bellowsCenterZ = startZ + bellowsOffsetZ;

        const bellowsH = isG1 ? 2.315 : 1.815;
        const bellowsY = isG1 ? 1.54 : 1.29;
 
        const bellowsL = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, bellowsH, bellowsDz),
            bellowsMat
        );
        bellowsL.position.set(-openWidth/2, bellowsY, bellowsCenterZ);
        carGroup.add(bellowsL);
 
        const bellowsR = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, bellowsH, bellowsDz),
            bellowsMat
        );
        bellowsR.position.set(openWidth/2, bellowsY, bellowsCenterZ);
        carGroup.add(bellowsR);
 
        const bellowsCeilY = isG1 ? 2.70 : 2.20;
        const bellowsCeil = new THREE.Mesh(
            new THREE.BoxGeometry(openWidth, 0.02, bellowsDz),
            bellowsMat
        );
        bellowsCeil.position.set(0, bellowsCeilY, bellowsCenterZ);
        carGroup.add(bellowsCeil);

        // --- Outer bellows (flush with outer walls and roof) ---
        // Procedural bellows textures
        const texSides = this.createBellowsTexture('vertical');
        texSides.repeat.set(bellowsDz / 0.05, 1);
        const outerMatSides = cheapMaterial({ map: texSides, roughness: 0.8 });

        const texCeil = this.createBellowsTexture('horizontal');
        texCeil.repeat.set(1, bellowsDz / 0.05);
        const outerMatCeil = cheapMaterial({ map: texCeil, roughness: 0.8 });

        const outerBottomY = 0.40;
        const outerCeilY = frameTopY + frameTopH / 2;
        const outerH = outerCeilY - outerBottomY;
        const outerY = outerBottomY + outerH / 2;

        const outerBellowsL = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, outerH, bellowsDz),
            outerMatSides
        );
        outerBellowsL.position.set(-unscaledWidth / 2, outerY, bellowsCenterZ);
        carGroup.add(outerBellowsL);

        const outerBellowsR = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, outerH, bellowsDz),
            outerMatSides
        );
        outerBellowsR.position.set(unscaledWidth / 2, outerY, bellowsCenterZ);
        carGroup.add(outerBellowsR);

        const outerBellowsCeil = new THREE.Mesh(
            new THREE.BoxGeometry(unscaledWidth, 0.02, bellowsDz),
            outerMatCeil
        );
        outerBellowsCeil.position.set(0, outerCeilY, bellowsCenterZ);
        carGroup.add(outerBellowsCeil);
 
        const bellowsFloorGeom = new THREE.BoxGeometry(openWidth, 0.01, absDz);
        this.applyBoxUVs(bellowsFloorGeom, openWidth, 0.01, absDz, 2.0);
        const bellowsFloor = new THREE.Mesh(
            bellowsFloorGeom,
            this.materials.floorGrey
        );
        bellowsFloor.position.set(0, 0.385, startZ + dz / 2);
        carGroup.add(bellowsFloor);
 
        const signOffset = type === 'front' ? -0.04 : 0.04;
        const displayY = isG1 ? 2.701 : 2.12; // G1: top edge at 2.841 (interior ceiling)
        const displayBacking = new THREE.Mesh(
            new THREE.BoxGeometry(isG1 ? 2.78 : 1.02, isG1 ? 0.28 : 0.14, 0.03),
            this.materials.bodyDarkGrey
        );
        displayBacking.position.set(0, displayY, startZ + signOffset);
        carGroup.add(displayBacking);
 
        const isRotated = (type === 'front');
        const displayScreen = new THREE.Mesh(
            new THREE.PlaneGeometry(isG1 ? 2.74 : 1.0, isG1 ? 0.24 : 0.12),
            isRotated ? this.interiorDisplayMatB : this.interiorDisplayMatF
        );
        displayScreen.position.set(0, displayY, startZ + signOffset * 1.4);
        displayScreen.rotation.y = isRotated ? Math.PI : 0;
        carGroup.add(displayScreen);
 
        this.interiorDisplays.push(displayScreen);
    }

    // Toggles the driver door of the leading cab (G1 and DT1 both register cab
    // doors). Opens on the platform side, falling back to the right side.
    toggleCabDoor() {
        if (this.cabDoors.length === 0) return;
        if (!this.cabDoorOpen) {
            this.activeCabDoor = {
                carIdx: this.sim.isReversing ? 3 : 0,
                side: this.sim.currentPlatformSide || 'right'
            };
            this.cabDoorOpen = true;
        } else {
            this.cabDoorOpen = false;
        }
    }

    // DT3-Routenmonitor (Canvas-Textur im Führerstand). Wird aus update() nur
    // gedrosselt aufgerufen und zeichnet zusätzlich nur dann neu, wenn sich der
    // sichtbare Inhalt (nächste Station, Richtung, gerundete Distanz) geändert
    // hat — ein Canvas-Redraw + Textur-Upload pro Frame war ein Framedrop-Herd.
    updateDT3Monitor() {
        if (!this.dt3MonitorCanvas) return;
        const ctx = this.dt3MonitorCtx;
        const w = this.dt3MonitorCanvas.width;
        const h = this.dt3MonitorCanvas.height;

        const stationsList = [];
        const nextIdx = this.sim.nextStationIdx;
        const reversing = this.sim.isReversing;

        if (reversing) {
            for (let i = 0; i < 4; i++) {
                const idx = nextIdx - i;
                if (idx >= 0) {
                    stationsList.push(this.sim.stations[idx]);
                }
            }
        } else {
            for (let i = 0; i < 4; i++) {
                const idx = nextIdx + i;
                if (idx < this.sim.stations.length) {
                    stationsList.push(this.sim.stations[idx]);
                }
            }
        }

        // Redraw-Key: nur neu zeichnen, wenn sich etwas Sichtbares geändert hat
        const distRounded = stationsList.length > 0
            ? Math.round(Math.abs(stationsList[0].position - this.sim.position))
            : -1;
        const monitorKey = nextIdx + '|' + reversing + '|' + distRounded;
        if (monitorKey === this._dt3MonitorKey) return;
        this._dt3MonitorKey = monitorKey;

        // Clear background
        ctx.fillStyle = '#0b0f19'; // very dark slate/navy
        ctx.fillRect(0, 0, w, h);

        const lineName = this.sim.track.lineId || 'U1';
        let lineColor = '#10b981'; // status dot
        if (lineName === 'U1') lineColor = '#005da7'; // Blue
        else if (lineName === 'U2') lineColor = '#cc070e'; // Red
        else if (lineName === 'U3') lineColor = '#2ea3ab'; // Turquoise

        // Draw header
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, 40);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(lineName + ' Route', 15, 20);

        // Draw small status LED dot
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(w - 20, 20, 5, 0, Math.PI * 2);
        ctx.fill();

        if (stationsList.length === 0) {
            ctx.fillStyle = '#64748b';
            ctx.font = 'italic 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Keine Route aktiv', w / 2, h / 2);
            this.dt3MonitorTexture.needsUpdate = true;
            return;
        }

        const nextStation = stationsList[0];
        const dist = Math.abs(nextStation.position - this.sim.position);
        let distStr = '';
        if (dist >= 1000) {
            distStr = (dist / 1000).toFixed(2) + ' km';
        } else {
            distStr = Math.round(dist) + ' m';
        }

        // Draw vertical route line
        const lineX = 40;
        const startY = 80;
        const endY = 220;
        ctx.strokeStyle = '#334155'; // background track line
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lineX, startY);
        ctx.lineTo(lineX, endY);
        ctx.stroke();

        // Draw colored active track line segment
        ctx.strokeStyle = lineColor;
        ctx.beginPath();
        ctx.moveTo(lineX, startY);
        // Only draw colored down to second station if there are more
        ctx.lineTo(lineX, stationsList.length > 1 ? startY + (endY - startY) / (stationsList.length - 1) * 0.5 : startY);
        ctx.stroke();

        // Draw station nodes
        const segmentCount = Math.max(1, stationsList.length - 1);
        const stepY = (endY - startY) / segmentCount;

        stationsList.forEach((station, i) => {
            const nodeY = startY + i * stepY;

            // Draw node circle
            if (i === 0) {
                // Glowing next station node
                ctx.fillStyle = lineColor;
                ctx.beginPath();
                ctx.arc(lineX, nodeY, 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(lineX, nodeY, 5, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Inactive station node
                ctx.fillStyle = '#334155';
                ctx.beginPath();
                ctx.arc(lineX, nodeY, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#94a3b8';
                ctx.beginPath();
                ctx.arc(lineX, nodeY, 4, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw station text
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            if (i === 0) {
                // Next station: large, white/yellow, bold
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 18px sans-serif';
                ctx.fillText(station.name, lineX + 20, nodeY - 10);

                // Distance sub-label
                ctx.fillStyle = lineColor;
                ctx.font = '14px sans-serif';
                ctx.fillText('nächste Hst. • ' + distStr, lineX + 20, nodeY + 12);
            } else {
                // Subsequent stations: smaller, slate/grey
                ctx.fillStyle = '#94a3b8';
                ctx.font = '14px sans-serif';
                ctx.fillText(station.name, lineX + 20, nodeY);
            }
        });

        this.dt3MonitorTexture.needsUpdate = true;
    }

    updateDT3DestinationSign(lineName, destName) {
        if (!this.dt3DestCanvas) return;
        
        const canvas = this.dt3DestCanvas;
        const ctx = this.dt3DestCtx;
        
        // Clear background with raw color #14100f
        ctx.fillStyle = '#14100f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // New font "Doto Bold" and color #74BA33 (VAG green)
        // Note: No Caps Lock (mixed case) as requested.
        ctx.fillStyle = '#74BA33';
        ctx.font = '54px "Doto Bold", sans-serif';
        ctx.textBaseline = 'middle';
        
        // 1. Draw Line (e.g. "U1") left-aligned with a small margin
        ctx.textAlign = 'left';
        const paddingLeft = 24;
        ctx.fillText(lineName, paddingLeft, canvas.height / 2 + 5);

        // 2. Center the destination name in the remaining space to the right
        const lineMetrics = ctx.measureText(lineName);
        const lineEnd = paddingLeft + lineMetrics.width;

        const destMetrics = ctx.measureText(destName);
        const remainingWidth = canvas.width - lineEnd - 24; // margin

        ctx.textAlign = 'center';
        const centerX = lineEnd + (canvas.width - lineEnd) / 2;

        if (destMetrics.width > remainingWidth && destMetrics.width > 0) {
            // Compress text horizontally if it doesn't fit the remaining area
            this.fillTextNarrow(ctx, destName, centerX, canvas.height / 2 + 5, remainingWidth / destMetrics.width);
        } else {
            ctx.fillText(destName, centerX, canvas.height / 2 + 5);
        }
        
        this.dt3DestTexture.needsUpdate = true;
    }

    update(dt) {
        // 1. Update overall train group position and orientation along 3D curve
        const trainDist = this.sim.position;
        const reversing = this.sim.isReversing;
        const isG1 = (this.trainType === 'G1');
        const S = TRAIN_SCALE;
        const carLength = (isG1 ? 19.270 : 18.575) * S;

        const pos = this.sim.getTrackPosition(trainDist, _tempPos);
        pos.y += this.sim.getTrackElevationOffset(trainDist, reversing); // stacked Plärrer level
        const tangent = this.sim.getTrackTangent(trainDist, _tempTangent);
        const angle = Math.atan2(tangent.x, tangent.z);
        
        // Offset train group horizontally based on dynamic spacing
        const xOffset = this.sim.getTrackXOffset(trainDist);
        const normal = _tempNormal.set(-tangent.z, 0, tangent.x);
        pos.addScaledVector(normal, xOffset);
        
        this.group.position.copy(pos);
        const groupAngle = angle + (reversing ? Math.PI : 0);
        this.group.rotation.y = groupAngle;
 
        // Force update of the train group's world matrix so worldToLocal works correctly
        this.group.updateMatrixWorld(true);

        // 2. Position and rotate each carriage group individually along the track spline
        for (let i = 0; i < this.carriages.length; i++) {
            const carGroup = this.carriages[i];
            const k = reversing ? (this.carriages.length - 1 - i) : i; // carriage index relative to leading end
            
            let offsetZ;
            let carLen;
            const props = this.getCarriageProperties(k);
            offsetZ = -props.startOffset * S;
            carLen = props.length * S;

            const carCenter = carLen / 2;
            const bFront = carCenter - 6.0 * S;
            const bRear = carCenter + 6.0 * S;

            // Track distances of the two bogies for Carriage i
            let s1, s2;
            if (reversing) {
                s1 = trainDist + offsetZ + bRear;
                s2 = trainDist + offsetZ + bFront;
            } else {
                s1 = trainDist - offsetZ - bFront;
                s2 = trainDist - offsetZ - bRear;
            }
            
            // Clamp to track bounds
            s1 = Math.max(0, Math.min(this.sim.totalLength, s1));
            s2 = Math.max(0, Math.min(this.sim.totalLength, s2));
            
            // Get 3D track positions for both bogies (with the stacked-Plärrer dive offset)
            this.sim.getTrackPosition(s1, _carP1);
            _carP1.y += this.sim.getTrackElevationOffset(s1, reversing);
            this.sim.getTrackPosition(s2, _carP2);
            _carP2.y += this.sim.getTrackElevationOffset(s2, reversing);
            
            // Offset bogie positions horizontally based on dynamic spacing
            const tangent1 = this.sim.getTrackTangent(s1, _tempTangent);
            const xOffset1 = this.sim.getTrackXOffset(s1);
            const normal1 = _tempNormal.set(-tangent1.z, 0, tangent1.x);
            _carP1.addScaledVector(normal1, xOffset1);
 
            const tangent2 = this.sim.getTrackTangent(s2, _tempTangent2);
            const xOffset2 = this.sim.getTrackXOffset(s2);
            const normal2 = _tempNormal.set(-tangent2.z, 0, tangent2.x);
            _carP2.addScaledVector(normal2, xOffset2);
            
            // Unit vector from rear bogie to front bogie (carriage local +Z axis)
            _carDirZ.subVectors(_carP1, _carP2).normalize();
            
            // Midpoint of the two bogies (local center of wheelbase)
            _carMidWorld.addVectors(_carP1, _carP2).multiplyScalar(0.5);
            
            // Carriage origin (local Z = 0) in world coordinates
            _carWorldPos.copy(_carMidWorld).addScaledVector(_carDirZ, carCenter);
            
            // Carriage world yaw angle
            const carWorldAngle = Math.atan2(_carDirZ.x, _carDirZ.z);
            
            // Convert to train group local coordinates
            _carLocalPos.copy(_carWorldPos);
            this.group.worldToLocal(_carLocalPos);
            
            _carLocalPos.y += 0.465 * S;
            carGroup.position.copy(_carLocalPos);
            // Yaw THEN pitch in the carriage's own frame (YXZ). With the default XYZ order
            // the pitch is applied around the world X axis, which rolls the body on a curved
            // slope (the Plärrer dive) into a corkscrew. YXZ keeps it level like the ramps.
            carGroup.rotation.order = 'YXZ';
            carGroup.rotation.y = carWorldAngle - groupAngle;
            carGroup.rotation.x = -Math.asin(_carDirZ.y);
        }

        // Update destination screen text if it changes
        this.updateDestinationSign(reversing);

        // Update interior displays with next station name (use displayNextStationIdx – lags until train leaves)
        const nextStationIdx = this.sim.displayNextStationIdx;
        const nextStation = this.sim.stations[nextStationIdx];
        const nextStationName = nextStation ? nextStation.name : "Terminal";
        const lineName = this.sim.track.lineId || 'U1';
        const displaySide = this.sim.getSideForStation(nextStationIdx);
        const displayText = lineName + " " + nextStationName;
        const displayKey = displayText + "|" + displaySide;

        if (displayKey !== this.lastDisplayKey) {
            this.lastDisplayText = displayText;
            this.lastDisplayKey = displayKey;
            this.updateInteriorDisplays(displayText, displaySide);
        }

        // Play announcement chime when display flips
        if (this.sim.chimeRequested) {
            this.sim.chimeRequested = false;
            this.playAnnouncementChime();
        }

        // 2. Toggle Headlights and Taillights based on driving direction
        const showFrontWhite = !reversing;
        
        this.lights.frontWhite.forEach(l => l.visible = showFrontWhite);
        this.lights.frontRed.forEach(l => l.visible = !showFrontWhite);
        this.lights.rearWhite.forEach(l => l.visible = !showFrontWhite);
        this.lights.rearRed.forEach(l => l.visible = showFrontWhite);

        // 3. Animate doors based on doorProgress and update door strip lighting
        const progress = this.sim.doorProgress;
        const openSide = this.sim.currentPlatformSide;
        const doorState = this.sim.doorState;
        const blink = (Math.floor(Date.now() / 250) % 2 === 0);
        const isDT1 = this.trainType === 'DT1';

        this.doors.forEach(door => {
            const isActiveSide = (door.side === openSide);
            const doorProgress = isActiveSide ? progress : 0;
            const closedOffset = door.closedOffset !== undefined ? door.closedOffset : 0.28;
            const slideOffset = doorProgress * (closedOffset >= 0.35 ? closedOffset * 2 : 0.52);
            const popOut = Math.sin(doorProgress * Math.PI / 2) * 0.06;
            
            const sideSign = (door.xClosed > 0) ? 1 : -1;
            door.meshL.position.x = door.xClosed + sideSign * popOut;
            door.meshR.position.x = door.xClosed + sideSign * popOut;

            door.meshL.position.z = door.baseZ - closedOffset - slideOffset;
            door.meshR.position.z = door.baseZ + closedOffset + slideOffset;

            // Update strip lighting
            let color = 0xff0000;
            let visible = true;

            if (!isDT1 && isActiveSide) {
                if (this.sim.doorWarningActive) {
                    color = 0xff0000; // Red
                    visible = blink;  // Blinking
                } else if (doorState === 1 || doorState === 2) { // Opening or Open
                    color = 0x44ff44; // Bright Green
                } else if (doorState === 3) { // Closing (fallback)
                    color = 0xff0000; // Red
                    visible = blink;  // Blinking
                }
            }

            if (door.stripL) {
                if (!isDT1) {
                    door.stripL.material.color.setHex(color);
                }
                door.stripL.visible = isDT1 ? true : visible;
            }
            if (door.stripR) {
                if (!isDT1) {
                    door.stripR.material.color.setHex(color);
                }
                door.stripR.visible = isDT1 ? true : visible;
            }
        });

        // 3b. Animate the hinged driver cab door (toggled with F via toggleCabDoor)
        const cabTarget = this.cabDoorOpen ? 1 : 0;
        if (this.cabDoorProgress !== cabTarget) {
            const step = (dt || 0.016) / 1.4; // full swing in ~1.4s
            this.cabDoorProgress = cabTarget > this.cabDoorProgress
                ? Math.min(cabTarget, this.cabDoorProgress + step)
                : Math.max(cabTarget, this.cabDoorProgress - step);
            if (this.cabDoorProgress === 0) this.activeCabDoor = null;
        }
        const cabSwing = (1 - Math.cos(this.cabDoorProgress * Math.PI)) / 2; // ease in-out
        this.cabDoors.forEach(d => {
            const isActive = this.activeCabDoor
                && d.carIdx === this.activeCabDoor.carIdx
                && d.side === this.activeCabDoor.side;
            // Positive progress swings the leaf outwards and forwards around its
            // front-edge hinge; -sign flips the swing direction per body side.
            d.pivot.rotation.y = isActive ? -d.sign * 1.75 * cabSwing : 0;
        });

        // 4. Update 3D cockpit animations (Speedometer needle & throttle lever)
        const speedKmh = this.sim.speed * 3.6;
        const throttle = this.sim.throttle;

        const leadingCarIdx = reversing ? 3 : 0;
        const leadingCabDir = reversing ? -1 : 1;

        // Speedometer needles: rotate based on speed (up to 90 km/h)
        const targetNeedleRot = Math.PI * 0.75 - (Math.min(90, speedKmh) / 90) * Math.PI * 1.5;
        this.speedNeedles.forEach(needle => {
            needle.mesh.rotation.z += (targetNeedleRot - needle.mesh.rotation.z) * 0.15;
        });

        // Throttle levers: tilt forward/backward based on throttle
        this.throttleLevers.forEach(lever => {
            let val = throttle;
            if (lever.type === 'gas') val = Math.max(0, throttle);
            else if (lever.type === 'brake') val = Math.min(0, throttle);

            const targetLeverRot = - val * 0.45 * lever.cabDir * (lever.invert ? -1 : 1);
            lever.mesh.rotation.x += (targetLeverRot - lever.mesh.rotation.x) * 0.2;
        });

        // Brake Pressure Gauge (Manometer) needles update
        this.brakeNeedles.forEach(needle => {
            // HBL Smoothing (Slow)
            needle.hblSmoothed += (this.sim.mainReservoirPressure - needle.hblSmoothed) * 0.02;
            const hblRot = Math.PI * 0.75 - (needle.hblSmoothed / 12) * Math.PI * 1.5;
            // Always rotate based on its local Z, but account for cab orientation if needed for visual consistency
            needle.hbl.rotation.z = hblRot;

            // BZ Smoothing (Responsive but damped)
            needle.bzSmoothed += (this.sim.brakeCylinderPressure - needle.bzSmoothed) * 0.15;
            const bzRot = Math.PI * 0.75 - (needle.bzSmoothed / 12) * Math.PI * 1.5;
            needle.bz.rotation.z = bzRot;
        });

        // 5. Update dynamic dashboard screens (throttled to save performance)
        this.screenUpdateTimer += dt;
        const screenThreshold = (this.sim.activeCameraType === 'cab') ? 0.05 : 0.5; // ~20fps vs 2fps

        if (this.screenUpdateTimer >= screenThreshold) {
            this.dashboardScreens.forEach(screen => {
                if (screen.carIdx === leadingCarIdx && screen.cabDir === leadingCabDir) {
                    if (screen.isDT1) {
                        this.drawDT1LeftScreen(screen);
                        this.drawDT1RightScreen(screen);
                    } else {
                        this.drawLeftScreen(screen);
                        this.drawRightScreen(screen);
                        this.drawMidScreen(screen);
                    }
                }
            });
            this.screenUpdateTimer = 0;
        }

        // DT3-Routenmonitor: max. 4x pro Sekunde prüfen (die Methode selbst
        // zeichnet zudem nur bei geändertem Inhalt neu, s. updateDT3Monitor).
        if (this.trainType === 'DT3') {
            this._dt3MonitorTimer = (this._dt3MonitorTimer || 0) + dt;
            if (this._dt3MonitorTimer >= 0.25 || dt === 0) {
                this._dt3MonitorTimer = 0;
                this.updateDT3Monitor();
            }
        }

        // 6. Force update world matrices recursively so cameras and headlights get correct coordinates immediately
        // Note: Redundant update removed to save performance.
    }

    buildDT1Train() {
        const S = TRAIN_SCALE;
        const carLength = 18.575; // meters per carriage (37.15m / 2)

        for (let i = 0; i < 4; i++) {
            const { length: carLength, startOffset: carOffsetZ } = this.getCarriageProperties(i);
            
            // Carriage has driving cab if it's even index at front, odd index at rear
            const hasFrontCab = (i % 2 === 0);
            const hasRearCab = (i % 2 === 1);
            
            const carGroup = new THREE.Group();
            carGroup.position.set(0, 0.465 * S, carOffsetZ * S);
            carGroup.scale.set(S, S, S);
            this.group.add(carGroup);
            this.carriages.push(carGroup);

            // Hollow carriage body panels
            let bodyLength = 18.275;
            let bodyPosZ = -carLength / 2;
            
            if (hasFrontCab) {
                bodyLength = 16.985; // starts back from local Z = 0 (cab 1.44m)
                bodyPosZ = -9.9325; // centered between -1.44 and -18.425
            } else if (hasRearCab) {
                bodyLength = 16.985; // starts back from local Z = -18.575 (cab 1.44m)
                bodyPosZ = -8.6425; // centered between -0.15 and -17.135
            }

            const wallMaterial = this.materials.bodyRedDT1;
            const whiteMaterial = this.materials.bodyWhite;
            const chassisMaterial = this.materials.bodyGrey;
            const roofMaterial = this.materials.dt1Roof;
            const floorMaterial = this.materials.dt1Floor;
            const glassMaterial = this.materials.windowGlass;

            // Calculate layout with consistent ~320mm pillars (exactly 314mm to fit 16.985m body)
            const p = 0.314;
            const w = 1.435;
            const d = 1.745;
            const dHalf = d / 2;
            const sectionEnd = p + w + p; // 2.063
            const sectionMid = p + w + p + w + p; // 3.812

            let doorPositionsZ;
            let int1_end, int4_start;

            if (hasFrontCab) {
                int1_end = -1.44;
                int4_start = -18.425;
                const d1 = int1_end - sectionEnd - dHalf;
                const d2 = d1 - dHalf - sectionMid - dHalf;
                const d3 = d2 - dHalf - sectionMid - dHalf;
                doorPositionsZ = [d1, d2, d3];
            } else {
                int1_end = -0.15;
                int4_start = -17.135;
                const d1 = int1_end - sectionEnd - dHalf;
                const d2 = d1 - dHalf - sectionMid - dHalf;
                const d3 = d2 - dHalf - sectionMid - dHalf;
                doorPositionsZ = [d1, d2, d3];
            }

            // Floor (Breite 2.90m -> 2.88m box)
            const floorGeom = this.geometries.dt1Floor.clone();
            this.applyBoxUVs(floorGeom, 2.88, 0.05, bodyLength, 1.0);
            const floor = new THREE.Mesh(floorGeom, floorMaterial);
            floor.scale.z = bodyLength;
            floor.position.set(0, 0.375, bodyPosZ);
            carGroup.add(floor);

            // Side Walls build helper
            const buildDT1SideWallsForSide = (xSign) => {
                const intervals = [
                    { zMin: doorPositionsZ[0] + dHalf, zMax: int1_end },
                    { zMin: doorPositionsZ[1] + dHalf, zMax: doorPositionsZ[0] - dHalf },
                    { zMin: doorPositionsZ[2] + dHalf, zMax: doorPositionsZ[1] - dHalf },
                    { zMin: int4_start, zMax: doorPositionsZ[2] - dHalf }
                ];

                intervals.forEach(interval => {
                    const z1 = Math.min(interval.zMin, interval.zMax);
                    const z2 = Math.max(interval.zMin, interval.zMax);
                    const zLength = z2 - z1;
                    if (zLength <= 0.001) return;

                    const zCenter = (z1 + z2) / 2;
                    const wallX = xSign * 1.43;
                    const intX = xSign * 1.40;

                    // DT1 Lower Solid Red Wall: Y = 0.375 to 1.08 (height 0.705, centered Y = 0.7275)
                    const lowerRed = new THREE.Mesh(this.geometries.dt1LowerRed, wallMaterial);
                    lowerRed.scale.z = zLength;
                    lowerRed.position.set(wallX, 0.7275, zCenter);
                    carGroup.add(lowerRed);

                    // White horizontal accent band below windows: Y = 1.08 to 1.20 (height 0.12, centered Y = 1.14)
                    const whiteBand = new THREE.Mesh(this.geometries.dt1WhiteBand, whiteMaterial);
                    whiteBand.scale.z = zLength;
                    whiteBand.position.set(wallX, 1.14, zCenter);
                    carGroup.add(whiteBand);

                    // Top solid red wall above windows: Y = 2.45 to 2.775 (height 0.325, centered Y = 2.6125)
                    const topRed = new THREE.Mesh(this.geometries.dt1TopRed, wallMaterial);
                    topRed.scale.z = zLength;
                    topRed.position.set(wallX, 2.6125, zCenter);
                    carGroup.add(topRed);

                    // --- Interior Wall Linings (Retro Golden Wood Panels) ---
                    const intBottom = new THREE.Mesh(this.geometries.dt1IntBottom, this.materials.dt1Wall);
                    intBottom.scale.z = zLength;
                    intBottom.position.set(intX, 0.8625, zCenter);
                    carGroup.add(intBottom);

                    const intTop = new THREE.Mesh(this.geometries.dt1IntTop, this.materials.dt1Wall);
                    intTop.scale.z = zLength;
                    intTop.position.set(intX, 2.5125, zCenter);
                    carGroup.add(intTop);

                    // Windows and Red Pillars: Y = 1.20 to 2.45
                    // Bottom rail (red): Y = 1.20 to 1.35 (height 0.15, centered Y = 1.275)
                    const bottomRail = new THREE.Mesh(this.geometries.dt1BottomRail, wallMaterial);
                    bottomRail.scale.z = zLength;
                    bottomRail.position.set(wallX, 1.275, zCenter);
                    carGroup.add(bottomRail);

                    // Top rail (red): Y = 2.25 to 2.45 (height 0.2, centered Y = 2.35)
                    const topRail = new THREE.Mesh(this.geometries.dt1TopRail, wallMaterial);
                    topRail.scale.z = zLength;
                    topRail.position.set(wallX, 2.35, zCenter);
                    carGroup.add(topRail);

                    // Windows & pillars: Y = 1.35 to 2.25 (height 0.9)
                    let windows = [];
                    let pillars = [];

                    if (zLength >= 3.8) {
                        const wWidth = 1.435;
                        const midPillar = 0.32; // Realistic 320mm gap between windows for DT1
                        const totalW = 2 * wWidth + midPillar;
                        const sidePillar = (zLength - totalW) / 2;

                        windows.push({ start: z1 + sidePillar, end: z1 + sidePillar + wWidth });
                        windows.push({ start: z1 + sidePillar + wWidth + midPillar, end: z1 + sidePillar + wWidth + midPillar + wWidth });

                        pillars.push({ start: z1, end: z1 + sidePillar });
                        pillars.push({ start: z1 + sidePillar + wWidth, end: z1 + sidePillar + wWidth + midPillar });
                        pillars.push({ start: z1 + sidePillar + wWidth + midPillar + wWidth, end: z2 });
                    } else if (zLength >= 2.0) {
                        const wWidth = 1.435;
                        windows.push({ start: zCenter - wWidth/2, end: zCenter + wWidth/2 });
                        pillars.push({ start: z1, end: zCenter - wWidth/2 });
                        pillars.push({ start: zCenter + wWidth/2, end: z2 });
                    } else {
                        pillars.push({ start: z1, end: z2 });
                    }

                    windows.forEach(w => {
                        const wWidth = w.end - w.start;
                        const wCenter = (w.start + w.end) / 2;
                        const glassGeom = this.createRoundedBoxGeometry(wWidth, 0.93, 0.02, 0.08);
                        glassGeom.rotateY(Math.PI / 2);
                        const glass = new THREE.Mesh(glassGeom, glassMaterial);
                        glass.position.set(wallX, 1.80, wCenter);
                        carGroup.add(glass);

                        const bezelGeom = this.createRoundedFrameGeometry(wWidth + 0.03, 0.93, 0.025, 0.095, 0.02);
                        bezelGeom.rotateY(Math.PI / 2);
                        const bezel = new THREE.Mesh(bezelGeom, this.materials.chromeMetal);
                        bezel.position.set(wallX, 1.80, wCenter);
                        carGroup.add(bezel);
                    });

                    pillars.forEach(p => {
                        const pWidth = p.end - p.start;
                        const pCenter = (p.start + p.end) / 2;
                        if (pWidth <= 0.001) return;
                        const pillar = new THREE.Mesh(this.geometries.dt1Pillar, wallMaterial);
                        pillar.scale.z = pWidth;
                        pillar.position.set(wallX, 1.80, pCenter);
                        carGroup.add(pillar);

                        const intPillar = new THREE.Mesh(this.geometries.dt1IntPillar, this.materials.dt1Wall);
                        intPillar.scale.z = pWidth;
                        intPillar.position.set(intX, 1.80, pCenter);
                        carGroup.add(intPillar);
                    });
                });
            };

            buildDT1SideWallsForSide(-1);
            buildDT1SideWallsForSide(1);


            // Light Gray Roof (Slightly curved/taller) - Center at 2.815, Height 0.08 -> Top at 2.855
            const roof = new THREE.Mesh(this.geometries.dt1Roof, roofMaterial);
            roof.scale.z = bodyLength;
            roof.position.set(0, 2.815, bodyPosZ);
            carGroup.add(roof);

            const ceilingLining = new THREE.Mesh(this.geometries.dt1Ceiling, this.materials.dt1Ceiling);
            ceilingLining.scale.z = bodyLength;
            ceilingLining.position.set(0, 2.77, bodyPosZ);
            carGroup.add(ceilingLining);

            const chassis = new THREE.Mesh(this.geometries.dt1Chassis, chassisMaterial);
            chassis.scale.z = bodyLength;
            chassis.position.set(0, 0.34, bodyPosZ);
            carGroup.add(chassis);

            // Continuous ceiling light strips parallel to side walls (15cm x 15cm)
            const lightStripGeom = new THREE.BoxGeometry(0.15, 0.15, 1.0);
            for (let xSign of [-1, 1]) {
                const fixture = new THREE.Mesh(lightStripGeom, this.materials.lightGlowWarm);
                fixture.scale.z = bodyLength;
                // Positioned flush with inner walls (wall is at +/- 1.40, half-width is 0.075)
                // Center Y: 2.77 (ceiling) - 0.075 (half height) = 2.695
                fixture.position.set(xSign * 1.325, 2.695, bodyPosZ);
                carGroup.add(fixture);
            }

            // Slanted cove panels between door top (2.45m) and lamp inner bottom edge (2.62m, 1.25m)
            const slantDX = 1.40 - 1.25; // 0.15
            const slantDY = 2.62 - 2.45; // 0.17
            const slantW = Math.sqrt(slantDX * slantDX + slantDY * slantDY);
            const slantAngle = Math.atan2(slantDY, slantDX);
            const slantPanelGeom = new THREE.BoxGeometry(slantW, 0.01, 1.0);
            for (let xSign of [-1, 1]) {
                const slant = new THREE.Mesh(slantPanelGeom, this.materials.dt1Slant);
                slant.scale.z = bodyLength;
                // Center between (1.40, 2.45) and (1.25, 2.62)
                slant.position.set(xSign * 1.325, 2.535, bodyPosZ);
                slant.rotation.z = -xSign * slantAngle;
                carGroup.add(slant);
            }

            this.buildDT1TransverseSeats(carGroup, bodyPosZ, bodyLength, hasFrontCab, hasRearCab, doorPositionsZ);

            if (hasFrontCab) {
                this.buildDT1CabEnd(carGroup, true, i);
                this.buildDT1Cockpit(carGroup, 0, 1, i);
            }
            if (hasRearCab) {
                this.buildDT1CabEnd(carGroup, false, i);
                this.buildDT1Cockpit(carGroup, -carLength, -1, i);
            }

            this.buildBogie(carGroup, doorPositionsZ[0] + 0.425, true, hasFrontCab ? -1 : 0);
            this.buildBogie(carGroup, doorPositionsZ[2] - 0.425, true, hasRearCab ? 1 : 0);

            // DT1 Underbody installations (equipment boxes and orange container)
            this.buildDT1Underbody(carGroup, i);

            doorPositionsZ.forEach(dz => {
                this.createDT1DoorPair(carGroup, -1.44, dz, i, 'left');
                this.createDT1DoorPair(carGroup, 1.44, dz, i, 'right');

                // Vertical handrails in the middle of each entrance area, aligned with the aisle edge of the seats
                for (let xSign of [-1, 1]) {
                    const poleX = xSign * 0.425;
                    const poleH = 2.77 - 0.375;
                    const poleY = (2.77 + 0.375) / 2;
                    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, poleH, 8), this.materials.dt1Handrail);
                    pole.geometry.rotateX(Math.PI / 2);
                    pole.rotation.x = Math.PI / 2;
                    pole.position.set(poleX, poleY, dz);
                    carGroup.add(pole);
                }

                for (let xSign of [-1, 1]) {
                    const posX = xSign * 1.43;
                    const doorTopRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.325, 1.745), wallMaterial);
                    doorTopRed.position.set(posX, 2.6125, dz);
                    const doorTopCream = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.325, 1.745), this.materials.dt1Wall);
                    doorTopCream.position.set(xSign * 1.40, 2.6125, dz);
                    carGroup.add(doorTopRed, doorTopCream);
                }
            });

            if (i === 1 || i === 3) {
                this.buildDT1EndWall(carGroup, -0.15);
            }
            if (i === 0 || i === 2) {
                this.buildDT1EndWall(carGroup, -18.425);
            }
        }
    }

    buildDT1EndWall(carGroup, zOffset) {
        const wallMat = this.materials.dt1Wall;
        const chromeMat = this.materials.chromeMetal;
        const glassMat = this.materials.windowGlass;

        const wallGroup = new THREE.Group();
        wallGroup.position.set(0, 0, zOffset);
        carGroup.add(wallGroup);

        // End wall spans X = -1.435 to 1.435, Y = 0.375 to 2.775
        const wallThickness = 0.04;

        // Side pillars next to the windows
        const pillarWidth = 0.32;
        const leftWall = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, 2.40, wallThickness), wallMat);
        leftWall.position.set(-1.435 + pillarWidth/2, 1.575, 0);

        const rightWall = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, 2.40, wallThickness), wallMat);
        rightWall.position.set(1.435 - pillarWidth/2, 1.575, 0);

        // Center pillar between the two square windows
        const centerPillarWidth = 0.37;
        const windowWidth = 0.93;
        const windowHeight = 0.93;
        const centerPillar = new THREE.Mesh(new THREE.BoxGeometry(centerPillarWidth, windowHeight, wallThickness), wallMat);
        centerPillar.position.set(0, 1.80, 0);

        // Bottom wood wall under windows
        const bottomWall = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.975, wallThickness), wallMat);
        bottomWall.position.set(0, 0.8625, 0);

        // Top wood wall above windows
        const topWall = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.525, wallThickness), wallMat);
        topWall.position.set(0, 2.5125, 0);

        wallGroup.add(leftWall, rightWall, centerPillar, bottomWall, topWall);

        // Two square window glass panes
        const windowRadius = 0.08;
        const windowGlassGeom = this.createRoundedBoxGeometry(windowWidth, windowHeight, 0.02, windowRadius);

        const windowL = new THREE.Mesh(windowGlassGeom, glassMat);
        windowL.position.set(-(windowWidth/2 + centerPillarWidth/2), 1.80, 0);

        const windowR = new THREE.Mesh(windowGlassGeom, glassMat);
        windowR.position.set(windowWidth/2 + centerPillarWidth/2, 1.80, 0);

        wallGroup.add(windowL, windowR);

        // Chrome rounded bezel frames (hollow frames for consistent rounding and transparency)
        const bezelRadius = windowRadius + 0.015;
        const bezelGeom = this.createRoundedFrameGeometry(windowWidth + 0.03, windowHeight + 0.03, 0.025, bezelRadius, 0.03);

        const bezelL = new THREE.Mesh(bezelGeom, chromeMat);
        bezelL.position.set(windowL.position.x, 1.80, 0.01);

        const bezelR = new THREE.Mesh(bezelGeom, chromeMat);
        bezelR.position.set(windowR.position.x, 1.80, 0.01);

        wallGroup.add(bezelL, bezelR);
    }

    buildDT1TransverseSeats(carGroup, bodyPosZ, bodyLength, hasFrontCab, hasRearCab, doorPositionsZ) {
        const seatColor = this.seatVariant === 'red' ? this.materials.dt1SeatRed : this.materials.dt1SeatBlue;
        const woodMat = this.materials.dt1Wall;
        
        // Transverse double seats (width 1.00m on X, depth 0.45m on Z)
        const seatWidth = 1.00;
        const cushionGeom = new THREE.BoxGeometry(seatWidth, 0.06, 0.45);
        const backrestGeom = new THREE.BoxGeometry(seatWidth, 0.55, 0.04);
        const supportGeom = new THREE.BoxGeometry(seatWidth, 0.12, 0.45);

        const buildDT1SeatRow = (xOffset, z, dirZ, hasPartition = false) => {
            const xSign = xOffset > 0 ? 1 : -1;
            const xPos = xOffset;

            // Seat support box (wood)
            const support = new THREE.Mesh(supportGeom, woodMat);
            support.position.set(xPos, 0.655, z);
            carGroup.add(support);

            // Blue Cushion
            const cushion = new THREE.Mesh(cushionGeom, seatColor);
            cushion.position.set(xPos, 0.745, z);
            carGroup.add(cushion);

            // Blue Backrest (tilted backwards)
            const backrest = new THREE.Mesh(backrestGeom, seatColor);
            backrest.position.set(xPos, 0.97, z - dirZ * 0.22);
            backrest.rotation.x = -dirZ * 0.15; // Inverted and increased tilt
            carGroup.add(backrest);

            // Backrest wood backing plate
            const backrestBacking = new THREE.Mesh(new THREE.BoxGeometry(seatWidth, 0.57, 0.02), woodMat);
            backrestBacking.position.set(xPos, 0.97, z - dirZ * 0.24);
            backrestBacking.rotation.x = -dirZ * 0.15; // Match backrest tilt
            carGroup.add(backrestBacking);

            // New vertical handrail at the inward-facing upper corner of the seat, going to the ceiling
            const aisleX = xSign * 0.425;
            const backrestZ = z - dirZ * 0.24;
            const poleH = 2.77 - 1.245;
            const poleY = (2.77 + 1.245) / 2;
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, poleH, 8), this.materials.dt1Handrail);
            pole.geometry.rotateX(Math.PI / 2);
            pole.rotation.x = Math.PI / 2;
            pole.position.set(aisleX, poleY, backrestZ);
            carGroup.add(pole);

            // Horizontal grab bar at 1.80m height, going outwards to the wall
            const horizBarLen = Math.abs(xSign * 1.40 - aisleX);
            const horizBar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, horizBarLen, 8), this.materials.dt1Handrail);
            horizBar.geometry.rotateZ(Math.PI / 2);
            horizBar.position.set((aisleX + xSign * 1.40) / 2, 1.80, backrestZ);
            carGroup.add(horizBar);

            if (hasPartition) {
                // Glass pane between seat top, wall, vertical and horizontal bars
                const glassW = Math.abs(xSign * 1.40 - aisleX) - 0.02;
                const glassH = 1.80 - 1.245 - 0.02;
                const glassGeom = new THREE.BoxGeometry(glassW, glassH, 0.008);
                const glass = new THREE.Mesh(glassGeom, this.materials.dt1PartitionGlass);
                glass.position.set((aisleX + xSign * 1.40) / 2, (1.245 + 1.80) / 2, backrestZ);
                carGroup.add(glass);

                // Metal clamps (2 top, 2 side)
                const clampGeom = new THREE.BoxGeometry(0.035, 0.035, 0.035);
                const clampMat = this.materials.chromeMetal;

                // Top clamps
                for (let ox of [0.25 * glassW, 0.75 * glassW]) {
                    const clamp = new THREE.Mesh(clampGeom, clampMat);
                    clamp.position.set(aisleX + xSign * ox, 1.80, backrestZ);
                    carGroup.add(clamp);
                }
                // Side clamps
                for (let oy of [0.15, 0.40]) {
                    const clamp = new THREE.Mesh(clampGeom, clampMat);
                    clamp.position.set(aisleX, 1.245 + oy, backrestZ);
                    carGroup.add(clamp);
                }
            }
        };

        const buildDT1SeatBay = (zCenter, partFront = false, partRear = false) => {
            // Left side double seats facing each other (aisle edge is at X = -0.40)
            buildDT1SeatRow(-0.925, zCenter - 0.55, 1, partFront);
            buildDT1SeatRow(-0.925, zCenter + 0.55, -1, partRear);

            // Right side double seats facing each other (aisle edge is at X = 0.40)
            buildDT1SeatRow(0.925, zCenter - 0.55, 1, partFront);
            buildDT1SeatRow(0.925, zCenter + 0.55, -1, partRear);
        };

        // Place bays of seats in the spaces between doors:
        const p = 0.314;
        const w = 1.435;
        const dHalf = 1.745 / 2;
        
        // Front Space
        const int1_end = hasFrontCab ? -1.44 : -0.15;
        const frontSpaceLength = Math.abs(int1_end - (doorPositionsZ[0] + dHalf));
        if (frontSpaceLength > 2.0) {
            buildDT1SeatBay(int1_end - p - w/2, true, false);
        }

        // Middle Space A: between Doors 1 & 2
        const gap12_start = doorPositionsZ[0] - dHalf;
        buildDT1SeatBay(gap12_start - p - w/2, false, true);
        buildDT1SeatBay(gap12_start - p - w - p - w/2, true, false);

        // Middle Space B: between Doors 2 & 3
        const gap23_start = doorPositionsZ[1] - dHalf;
        buildDT1SeatBay(gap23_start - p - w/2, false, true);
        buildDT1SeatBay(gap23_start - p - w - p - w/2, true, false);

        // Rear Space
        const innerEnd = hasFrontCab ? -18.425 : -17.135;
        const rearSpaceLength = Math.abs(innerEnd - (doorPositionsZ[2] - dHalf));
        if (rearSpaceLength > 2.0) {
            buildDT1SeatBay(innerEnd + p + w/2, false, true);
        }
    }

    createDT1DoorPair(carGroup, xOffset, zOffset, carIdx, side) {
        const leafWidth = 0.8725; // 1745 / 2 / 1000
        const doorHeight = 2.075;
        const doorYCenter = 1.4125;
        const closedOffset = leafWidth / 2;

        const doorL = new THREE.Group();
        doorL.position.set(xOffset, doorYCenter, zOffset - closedOffset);
        
        const doorR = new THREE.Group();
        doorR.position.set(xOffset, doorYCenter, zOffset + closedOffset);
        
        const wallMaterial = this.materials.bodyRedDT1;
        const woodMaterial = this.materials.dt1Wall;
        // Same material as the passenger side windows (by user request) — the
        // merge-domain box-test mismatch on door leaves (their own pivoting
        // domain, not the carriage frame) is accepted as-is here.
        const glassMaterial = this.materials.windowGlass;
        const insideSign = (side === 'left') ? 1 : -1;

        const buildDT1DoorLeaf = (leafGroup, isLeft) => {
            // Door spans Local Y relative to doorYCenter
            const leafGeomWidth = leafWidth - 0.03;
            const horizontalWidth = leafGeomWidth - 0.16;

            // 1. Solid bottom half (aligned to windows: Y=0.375 to 1.08, height 0.705)
            const bottomOuter = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.705, leafGeomWidth), wallMaterial);
            bottomOuter.position.set(-insideSign * 0.005, -0.685, 0);

            // White accent band on doors (Y=1.08 to 1.20, height 0.12)
            const doorWhiteBand = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, leafGeomWidth), this.materials.bodyWhite);
            doorWhiteBand.position.set(-insideSign * 0.005, -0.2725, 0);
            leafGroup.add(doorWhiteBand);

            const bottomInner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.825, leafGeomWidth), woodMaterial);
            bottomInner.position.set(insideSign * 0.005, -0.625, 0);
            leafGroup.add(bottomOuter, bottomInner);

            // 2. Upper window frame (Y=1.20 to 2.45, height 1.25)
            const frameL_outer = new THREE.Mesh(new THREE.BoxGeometry(0.01, 1.25, 0.08), wallMaterial);
            frameL_outer.position.set(-insideSign * 0.005, 0.4125, -leafGeomWidth/2 + 0.04);
            const frameL_inner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 1.25, 0.08), woodMaterial);
            frameL_inner.position.set(insideSign * 0.005, 0.4125, -leafGeomWidth/2 + 0.04);

            const frameR_outer = new THREE.Mesh(new THREE.BoxGeometry(0.01, 1.25, 0.08), wallMaterial);
            frameR_outer.position.set(-insideSign * 0.005, 0.4125, leafGeomWidth/2 - 0.04);
            const frameR_inner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 1.25, 0.08), woodMaterial);
            frameR_inner.position.set(insideSign * 0.005, 0.4125, leafGeomWidth/2 - 0.04);

            const frameB_outer = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.15, horizontalWidth), wallMaterial);
            frameB_outer.position.set(-insideSign * 0.005, -0.1375, 0);
            const frameB_inner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.15, horizontalWidth), woodMaterial);
            frameB_inner.position.set(insideSign * 0.005, -0.1375, 0);

            const frameT_outer = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.20, horizontalWidth), wallMaterial);
            frameT_outer.position.set(-insideSign * 0.005, 0.9375, 0);
            const frameT_inner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.20, horizontalWidth), woodMaterial);
            frameT_inner.position.set(insideSign * 0.005, 0.9375, 0);

            leafGroup.add(frameL_outer, frameL_inner, frameR_outer, frameR_inner, frameB_outer, frameB_inner, frameT_outer, frameT_inner);

            const glassGeom = this.createRoundedBoxGeometry(horizontalWidth, 0.93, 0.01, 0.06);
            glassGeom.rotateY(Math.PI / 2);
            const glass = new THREE.Mesh(glassGeom, glassMaterial);
            glass.position.set(0, 0.3875, 0);

            const bezelGeom = this.createRoundedFrameGeometry(horizontalWidth + 0.02, 0.93, 0.015, 0.07, 0.02);
            bezelGeom.rotateY(Math.PI / 2);
            const bezel = new THREE.Mesh(bezelGeom, this.materials.chromeMetal);
            bezel.position.set(0, 0.3875, 0);

            leafGroup.add(glass, bezel);

            // 3. Static dark-gray rubber lip on the meeting edge (outside face)
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(0.008, doorHeight - 0.02, 0.016),
                this.materials.dt1DoorRubberLip
            );
            const stripZ = isLeft ? (closedOffset - 0.009) : (-closedOffset + 0.009);
            const stripX = 0.011 * Math.sign(xOffset);
            strip.position.set(stripX, 0.05, stripZ);
            leafGroup.add(strip);
            return strip;
        };

        const stripL = buildDT1DoorLeaf(doorL, true);
        const stripR = buildDT1DoorLeaf(doorR, false);

        carGroup.add(doorL, doorR);

        this.doors.push({
            meshL: doorL,
            meshR: doorR,
            stripL: stripL,
            stripR: stripR,
            baseZ: zOffset,
            carIdx: carIdx,
            side: side,
            xClosed: xOffset,
            closedOffset: closedOffset
        });
    }

    buildDT1CabEnd(carGroup, isFront, carIdx) {
        const carLength = 18.575;
        const cabZ = isFront ? 0 : -carLength;
        const cabDir = isFront ? 1 : -1;

        // Only add SpotLights for the outer ends (Car 0 front, Car 3 rear)
        const isOuterEnd = (carIdx === 0 && isFront) || (carIdx === 3 && !isFront);

        // Bumper Skirt
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.18, 0.24), this.materials.bodyGrey);
        bumper.position.set(0, 0.25, cabZ + cabDir * 0.25);
        carGroup.add(bumper);

        // Coupler (Scharfenbergkupplung)
        const couplerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8), this.materials.chromeMetal);
        couplerShaft.geometry.rotateX(Math.PI / 2);
        couplerShaft.position.set(0, 0.25, cabZ + cabDir * 0.45);
        
        const couplerHead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), this.materials.chromeMetal);
        couplerHead.position.set(0, 0.25, cabZ + cabDir * 0.62);
        carGroup.add(couplerShaft, couplerHead);

        // Front face group - flat, vertical (no backward slant)
        const faceGroup = new THREE.Group();
        faceGroup.position.set(0, 0.35, cabZ + cabDir * 0.22);

        if (!isFront) {
            faceGroup.rotation.y = Math.PI;
        }

        const slantAngle = 0; // front plate is dead vertical; kept as a param for createDT1TwistedCornerGeometry
        carGroup.add(faceGroup);

        // 1. Red face plate (flat center, 2.50m) with two rounded windshield cutouts.
        // The rounded corner columns connecting this flat plate to the side flanks
        // are built further down (twisted red/white bands + curved glass).
        this.createDT1FrontGeometries();
        for (const plateGeom of this.geometries.dt1FacePlate) {
            faceGroup.add(new THREE.Mesh(plateGeom, this.materials.bodyRedDT1));

            // Interior lining for the front plate (grey metal look)
            // Offset 2.5cm inward to stay inside the 4cm red plate
            const plateInt = new THREE.Mesh(plateGeom, this.materials.cockpitInteriorDark);
            plateInt.position.z = -0.025;
            faceGroup.add(plateInt);
        }

        // 2. Single flat windshield pane spanning the full flat width (no
        // dividing pillars), each side continuing into a curved pane that
        // wraps 90 degrees around the rounded cockpit corner.
        const G = this.geometries;
        const paneCenterY = G.dt1PaneY + G.dt1PaneH / 2;

        const midGlass = new THREE.Mesh(G.dt1WindshieldPane, this.materials.windshieldGlass);
        midGlass.position.set(0, paneCenterY, 0.10);
        faceGroup.add(midGlass);

        // Thin red divider lines, 718mm either side of center, proud of the
        // glass's own outer face (glass spans z 0.09-0.11; starting the divider
        // at 0.11 instead of straddling it avoids the two coplanar red/glass
        // faces that were z-fighting at z=0.11)
        for (const dx of [-0.718, 0.718]) {
            const divider = new THREE.Mesh(new THREE.BoxGeometry(0.02, G.dt1PaneH, 0.01), this.materials.bodyRedDT1);
            divider.position.set(dx, paneCenterY, 0.115);

            // Interior counterpart for the divider line
            const dividerInt = new THREE.Mesh(new THREE.BoxGeometry(0.02, G.dt1PaneH, 0.01), this.materials.cockpitInteriorDark);
            dividerInt.position.set(dx, paneCenterY, 0.085);

            faceGroup.add(divider, dividerInt);
        }

        for (const sx of [-1, 1]) {
            // Curved pane wrapping the rounded corner, connecting the flat
            // windshield pane to the flank's side window (same twisted-blend
            // technique as the opaque corner bands below, added directly to
            // carGroup for the same reason).
            const cornerGlass = new THREE.Mesh(
                this.createDT1TwistedCornerGeometry(sx, isFront, cabZ, G.dt1FlatHalf, G.dt1ZFront, G.dt1Rc, -0.02, G.dt1PaneY, G.dt1PaneY + G.dt1PaneH, slantAngle),
                this.materials.windshieldGlass
            );
            carGroup.add(cornerGlass);

            // Opaque corner bands twisting from the slanted front plate into the
            // vertical cab flank, stacked to match the flank's own bands exactly:
            // red skirt, white stripe, a red sliver up to the windshield glass
            // corner, then red again above it up to the roofline. Built directly
            // in carGroup space (not a faceGroup/flankGroup child) since the twist
            // already bakes in each group's own position/rotation once - adding it
            // under either group would apply that transform a second time.
            //
            // The last two entries close the interior wall lining across the
            // corner too (matching the flank's own intBottom/intTop, inset -0.03
            // like those): without them the wood lining simply stopped at the
            // flank's front edge, so from inside the cab there was a bare gap at
            // the curve before the exterior red band's backface picked up again -
            // exactly the "gap lower than the red crossbar" seam.
            const cornerBands = [
                { y0: 0, y1: 0.73, rOff: 0, mat: this.materials.bodyRedDT1 }, // skirt
                { y0: 0.73, y1: 0.85, rOff: 0.005, mat: this.materials.bodyWhite }, // accent stripe
                { y0: 0.85, y1: G.dt1PaneY, rOff: 0, mat: this.materials.bodyRedDT1 }, // up to the glass corner
                { y0: G.dt1PaneY + G.dt1PaneH, y1: 2.425, rOff: 0, mat: this.materials.bodyRedDT1 }, // glass corner up to the roofline
                { y0: 0, y1: G.dt1PaneY, rOff: -0.03, mat: this.materials.cockpitInteriorDark }, // interior lining, lower
                { y0: G.dt1PaneY + G.dt1PaneH, y1: 2.425, rOff: -0.03, mat: this.materials.cockpitInteriorDark } // interior lining, upper
            ];
            for (const band of cornerBands) {
                const cornerMesh = new THREE.Mesh(
                    this.createDT1TwistedCornerGeometry(sx, isFront, cabZ, G.dt1FlatHalf, G.dt1ZFront, G.dt1Rc, band.rOff, band.y0, band.y1, slantAngle),
                    band.mat
                );
                carGroup.add(cornerMesh);
            }
        }

        // 3. White wrap-around accent band; continues around the corner columns
        // (their middle strip) at the body side band height (Y = 1.08 to 1.20 global)
        const whiteStrip = new THREE.Mesh(new THREE.BoxGeometry(2.50, 0.12, 0.13), this.materials.bodyWhite);
        whiteStrip.position.set(0, 0.79, 0.06);
        faceGroup.add(whiteStrip);


        // 4. Destination roller sign in a light-gray rounded frame, slightly
        // higher above the windshield than before for a cleaner look.
        const destMat = this.createDT1DestinationSignMaterial();
        const destY = G.dt1PaneY + G.dt1PaneH + 0.26;
        const destFrameMat = cheapMaterial({ color: '#d8dde3', roughness: 0.85, metalness: 0.05 });
        const destFrame = new THREE.Mesh(this.createRoundedFrameGeometry(1.54, 0.30, 0.02, 0.08, 0.03), destFrameMat);
        destFrame.position.set(0, destY, 0.118);
        const destMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 0.24), destMat);
        destMesh.position.set(0, destY, 0.129);
        destMesh.renderOrder = 10;
        destFrame.renderOrder = 9;
        faceGroup.add(destFrame, destMesh);

        // Flat central headlight above the destination display, at the top edge
        // of the cockpit front (mirrors the G1's own top-center headlight strip;
        // white running light only, no red tail-light variant, same as there).
        // faceH (roofline) is 2.425. Position restored to the original 2.38
        // (a taller pane needs the same Y as before, not moved up); "taller" was
        // applied as a bigger height dimension on the housing/lens instead.
        const topLightY = 2.38;
        const topHousing = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.05), this.materials.bodyDarkGrey);
        topHousing.position.set(0, topLightY, 0.115);
        faceGroup.add(topHousing);

        const topLight = new THREE.Group();
        const topLens = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.02), this.materials.lightGlowWarm);
        topLens.position.set(0, topLightY, 0.145);
        topLight.add(topLens);
        const topGlow = new THREE.Sprite(this.materials.glowSpriteWhite.clone());
        topGlow.scale.set(0.75, 0.75, 1.0);
        topGlow.position.set(0, topLightY, 0.15);
        topLight.add(topGlow);
        faceGroup.add(topLight);

        // 5. Car number on the lower red panel (white, lower left like the original)
        const numberMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.15), this.getDecalMaterial('522'));
        numberMesh.position.set(-0.82, 0.24, 0.125);
        faceGroup.add(numberMesh);

        // 6. Rectangular twin lamp units just below the accent band. The dark housings
        // are permanent; only the lens pairs (white head / red tail) are toggled.
        // Sized down 1/4 from the originals (0.50x0.22x0.05 housing, 0.17x0.15x0.02
        // lens, 0.115 lens spacing) - unit position (sx*0.88) is unchanged.
        const housingGeom = new THREE.BoxGeometry(0.375, 0.165, 0.0375);
        for (const sx of [-1, 1]) {
            const housing = new THREE.Mesh(housingGeom, this.materials.bodyDarkGrey);
            housing.position.set(sx * 0.88, 0.50, 0.115);
            faceGroup.add(housing);
        }

        const lensGeom = new THREE.BoxGeometry(0.1275, 0.1125, 0.015);
        const buildDT1Headlight = (xSign, colorMat, spriteMat) => {
            const group = new THREE.Group();

            for (const o of [-0.08625, 0.08625]) {
                const lens = new THREE.Mesh(lensGeom, colorMat);
                lens.position.set(xSign * 0.88 + o, 0.50, 0.145);
                group.add(lens);
            }

            // Additive glow sprite
            const glowSprite = new THREE.Sprite(spriteMat.clone());
            glowSprite.scale.set(0.9, 0.9, 1.0);
            glowSprite.position.set(xSign * 0.88, 0.50, 0.15);
            group.add(glowSprite);

            return group;
        };

        // SpotLights (same as G1 for performance/consistency)
        const buildHeadSpotlight = (isWhite, cabDir) => {
            const color = isWhite ? 0xffcc66 : 0xff2200;
            const intensity = isWhite ? 3.5 : 1.2;
            const spot = new THREE.SpotLight(color, intensity, 40.0, Math.PI / 6, 0.5, 1.5);
            spot.position.set(0, 0.42, 0.0);
            // Target in front of the face (faceGroup is already rotated, so always point +Z)
            spot.target.position.set(0, -0.3, 20);
            return spot;
        };

        const spotWhite = buildHeadSpotlight(true, cabDir);
        const spotRed   = buildHeadSpotlight(false, cabDir);

        if (isOuterEnd) {
            faceGroup.add(spotWhite, spotWhite.target);
            faceGroup.add(spotRed,   spotRed.target);
        }

        const headLWhite = buildDT1Headlight(-1, this.materials.lightGlowWarm, this.materials.glowSpriteWhite);
        const headLRed   = buildDT1Headlight(-1, this.materials.lightGlowRed,   this.materials.glowSpriteRed);
        const headRWhite = buildDT1Headlight( 1, this.materials.lightGlowWarm, this.materials.glowSpriteWhite);
        const headRRed   = buildDT1Headlight( 1, this.materials.lightGlowRed,   this.materials.glowSpriteRed);

        faceGroup.add(headLWhite, headLRed, headRWhite, headRRed);

        if (isFront) {
            this.lights.frontWhite.push(headLWhite, headRWhite, topLight);
            if (isOuterEnd) this.lights.frontWhite.push(spotWhite);
            this.lights.frontRed.push(headLRed, headRRed);
            if (isOuterEnd) this.lights.frontRed.push(spotRed);
        } else {
            this.lights.rearWhite.push(headLWhite, headRWhite, topLight);
            if (isOuterEnd) this.lights.rearWhite.push(spotWhite);
            this.lights.rearRed.push(headLRed, headRRed);
            if (isOuterEnd) this.lights.rearRed.push(spotRed);
        }
    }

    buildDT1Cockpit(carGroup, noseZ, cabDir, carIdx) {
        const cockpitGroup = new THREE.Group();
        carGroup.add(cockpitGroup);
        const unscaledWidth = 2.82;

        const consoleDarkGrey = cheapMaterial({ color: '#2b2e35', roughness: 0.8, metalness: 0.2 });
        const deskMat = cheapMaterial({ color: '#5a5a58', roughness: 0.8 });

        // Vertical back wall bulkhead (grey metal look)
        // Width narrowed to 2.81m to fit inside; Height reduced to 0.85m and lifted to start at Y=0.40 (floor)
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.81, 0.85, 0.02), this.materials.cockpitTrim);
        backWall.position.set(0, 0.825, noseZ - cabDir * 0.01);
        cockpitGroup.add(backWall);

        // Horizontal desk plate. Moved 30cm forward.
        const deskTopY = this.geometries.dt1PaneY + 0.35;

        // Custom shape for the desk to fit the rounded window
        const deskShape = new THREE.Shape();
        const dBackY = 0.31;  // Local Z = -0.31 (facing driver)
        const dFrontY = -0.29; // Local Z = 0.29 (facing window)
        const dHalf = 1.38;   // Slightly narrower to clear side walls
        // Window curve parameters from createDT1FrontGeometries: flat part half-width 1.25m,
        // corner radius 0.192m, nose position faceZOffset 0.22m.
        const x0w = 1.25, rcw = 0.192, fzOff = 0.22, czw = 0.12 - 0.192;
        const getZWin = (x) => {
            const absX = Math.abs(x);
            const margin = 0.03; // 3cm safety margin to stay inside the faceted window mesh
            if (absX <= x0w) return fzOff + 0.12 - margin;
            const a = Math.asin(Math.min(1, (absX - x0w) / rcw));
            const t = a / (Math.PI / 2);
            // Ruled surface interpolation matches createDT1TwistedCornerGeometry
            return (fzOff + (czw + rcw * Math.cos(a)) - margin) * (1 - t);
        };

        deskShape.moveTo(-dHalf, dBackY);
        for (let x = -dHalf; x <= dHalf; x += 0.01) {
            // Desk ends at the window or at its max depth, whichever is closer to the driver.
            // Shape Y maps to -Z in world space.
            deskShape.lineTo(x, Math.max(dFrontY, -getZWin(x)));
        }
        deskShape.lineTo(dHalf, dBackY);
        deskShape.closePath();

        const deskGeom = new THREE.ExtrudeGeometry(deskShape, { depth: 0.02, bevelEnabled: false });
        deskGeom.rotateX(-Math.PI / 2);
        const deskPlate = new THREE.Mesh(deskGeom, deskMat);
        // Position at noseZ, and rotate for rear cab
        deskPlate.position.set(0, deskTopY - 0.01, noseZ);
        if (cabDir === -1) deskPlate.rotation.y = Math.PI;
        cockpitGroup.add(deskPlate);

        const deskLift = deskTopY - 0.01 - 1.13; // 1.13 was the old desk center height

        // Slanted panel layout for dashboard
        const panelWidth = 0.40;
        const panelHeight = 0.33; // 50% higher (was 0.22)
        const panelThickness = 0.08;
        const panelGeom = new THREE.BoxGeometry(panelWidth, panelHeight, panelThickness);
        const panelMat = cheapMaterial({ color: '#747472', roughness: 0.7, metalness: 0.2 });

        const cameraZ = noseZ - cabDir * 1.2;
        const R = 1.3; // moved 30cm forward (was 1.0)
        const W_spacing = 0.37;

        const panelConfigs = [
            { idx: -2, name: 'panel1' }, // Left analog screen
            { idx: -1, name: 'panel2' }, // Center console
            { idx: 0,  name: 'panel3' }, // Speedometer analogue dial
            { idx: 1,  name: 'panel4' }, // Knobs
            { idx: 2,  name: 'panel5' }  // Right indicator lights screen
        ];

        const panelMeshes = {};
        const posY = 1.23 + deskLift;
        const panelZ = cameraZ + cabDir * R; // same depth for every panel (was the idx=0 depth)

        panelConfigs.forEach(cfg => {
            const mesh = new THREE.Mesh(panelGeom, panelMat);
            const posX = cabDir * cfg.idx * W_spacing;

            mesh.position.set(posX, posY, panelZ);
            mesh.rotation.order = 'YXZ';
            mesh.rotation.x = cabDir * Math.PI / 4; // tilted back towards driver; larger angle = flatter/more horizontal (rotation.x=0 would stand fully upright)

            cockpitGroup.add(mesh);
            panelMeshes[cfg.name] = mesh;
        });

        this.populateDT1Panels(panelMeshes, cabDir);

        // Single light-grey holder for both driving levers with slots
        const holderMat = cheapMaterial({ color: '#bbbbbb', roughness: 0.6 });
        const holderH = 0.04;
        const holder = new THREE.Mesh(new THREE.BoxGeometry(0.32, holderH, 0.22), holderMat);
        holder.position.set(cabDir * -0.4, 1.14 + deskLift + holderH / 2, noseZ - cabDir * 0.18);
        cockpitGroup.add(holder);

        const slotMat = cheapMaterial({ color: '#1a1a1a', roughness: 0.9 });
        [-0.5, -0.3].forEach(sx => {
            const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.18), slotMat);
            slot.position.set(cabDir * sx, 1.14 + deskLift + holderH + 0.001, noseZ - cabDir * 0.18);
            cockpitGroup.add(slot);
        });

        // Speedometer Dial Face on Panel 3 (Center)
        const speedDialCanvas = document.createElement('canvas');
        speedDialCanvas.width = 256;
        speedDialCanvas.height = 256;
        const sdCtx = speedDialCanvas.getContext('2d');
        sdCtx.fillStyle = '#000000'; // Black background
        sdCtx.fillRect(0, 0, 256, 256);
        
        sdCtx.strokeStyle = '#cccccc';
        sdCtx.lineWidth = 6;
        sdCtx.beginPath();
        sdCtx.arc(128, 128, 100, Math.PI * 0.75, Math.PI * 2.25);
        sdCtx.stroke();
        
        sdCtx.fillStyle = '#ffffff';
        sdCtx.font = 'bold 24px Arial';
        sdCtx.textAlign = 'center';
        sdCtx.textBaseline = 'middle';
        for (let speed = 0; speed <= 90; speed += 10) {
            const angle = Math.PI * 0.75 + (speed / 90) * Math.PI * 1.5;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            sdCtx.strokeStyle = '#ffffff';
            sdCtx.lineWidth = 4;
            sdCtx.beginPath();
            sdCtx.moveTo(128 + cos * 90, 128 + sin * 90);
            sdCtx.lineTo(128 + cos * 100, 128 + 100 * sin);
            sdCtx.stroke();
            
            const textX = 128 + cos * 68;
            const textY = 128 + sin * 68;
            sdCtx.fillText(speed.toString(), textX, textY);
        }
        
        sdCtx.strokeStyle = '#ff3300';
        sdCtx.lineWidth = 6;
        const limitAngle = Math.PI * 0.75 + (70 / 90) * Math.PI * 1.5;
        sdCtx.beginPath();
        sdCtx.moveTo(128 + Math.cos(limitAngle) * 85, 128 + Math.sin(limitAngle) * 85);
        sdCtx.lineTo(128 + Math.cos(limitAngle) * 100, 128 + Math.sin(limitAngle) * 100);
        sdCtx.stroke();

        sdCtx.font = 'bold 18px Arial';
        sdCtx.fillStyle = '#888888';
        sdCtx.fillText('km/h', 128, 175);
        
        const speedDialTex = new THREE.CanvasTexture(speedDialCanvas);
        speedDialTex.colorSpace = THREE.SRGBColorSpace;
        const speedDialMat = new THREE.MeshBasicMaterial({ map: speedDialTex, fog: false });
        
        const speedDialGeom = new THREE.CircleGeometry(0.09, 32);
        const speedDialMesh = new THREE.Mesh(speedDialGeom, speedDialMat);
        speedDialMesh.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        speedDialMesh.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes['panel3'].add(speedDialMesh);

        // Speedometer Needle on Speed Dial Mesh (so it inherits Y rotation and tilts correctly)
        const needleGroup = new THREE.Group();
        needleGroup.position.set(0, 0, 0.004);
        speedDialMesh.add(needleGroup);

        const needleMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.006, 0.075, 0.002),
            new THREE.MeshBasicMaterial({ color: 0xff3300, fog: false })
        );
        needleMesh.geometry.translate(0, 0.03, 0);
        needleGroup.add(needleMesh);
        
        // Set initial rotation (0 km/h)
        needleGroup.rotation.z = Math.PI * 0.75;
        this.speedNeedles.push({ mesh: needleGroup });

        // Center Cap Pin
        const capGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.004, 16);
        capGeom.rotateX(Math.PI / 2);
        const capMat = new THREE.MeshBasicMaterial({ color: '#1e293b', fog: false });
        const cap = new THREE.Mesh(capGeom, capMat);
        cap.position.set(0, 0, 0.005);
        speedDialMesh.add(cap);

        // Physical Retro Driving Handle (Fahrschalterrad / Lever) - now two levers.
        // Sits on the desk, so it rises with it too.
        const buildLever = (xPos, type) => {
            const lGrp = new THREE.Group();
            lGrp.position.set(cabDir * xPos, 1.14 + deskLift, noseZ - cabDir * 0.18);
            cockpitGroup.add(lGrp);

            const handleRod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), this.materials.chromeMetal);
            handleRod.geometry.translate(0, 0.08, 0);

            // Knob directly on top of the stick
            const handleBall = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), cheapMaterial({ color: '#111111', roughness: 0.9 }));
            handleBall.position.set(0, 0.16, 0);

            const rGrp = new THREE.Group();
            rGrp.add(handleRod, handleBall);
            lGrp.add(rGrp);

            this.throttleLevers.push({ mesh: rGrp, cabDir: cabDir, invert: true, type: type });
        };

        buildLever(-0.5, 'gas');
        buildLever(-0.3, 'brake');

        // Driver's seat: more ergonomic and aesthetic design with a texture fade
        this.buildDT1DriverSeat(cockpitGroup, noseZ, cabDir);

        // Hollow Cab Enclosures (Side walls, floor, roof cover)
        const cockFloorGeom = new THREE.BoxGeometry(unscaledWidth, 0.05, 1.44);
        const cockFloor = new THREE.Mesh(cockFloorGeom, this.materials.dt1Floor);
        cockFloor.position.set(0, 0.375, noseZ - cabDir * 0.72);
        cockpitGroup.add(cockFloor);

        // Cab flanks: built in a "front cab" local frame (nose at local Z = 0,
        // cab interior receding toward -Z) then mirrored 180 degrees about Y for
        // the rear cab. This keeps the driver door's hinge/swing direction correct
        // on both ends without re-deriving cabDir-aware trig for every point.
        const flankGroup = new THREE.Group();
        flankGroup.position.set(0, 0, noseZ);
        if (cabDir === -1) flankGroup.rotation.y = Math.PI;
        cockpitGroup.add(flankGroup);

        // Window occupies the front portion of the flank (nearest the windshield);
        // the driver door occupies the rear portion (nearest the saloon partition),
        // matching the reference photo.
        const winLen = 0.70;
        const gapLen = 0.02;
        const doorFrontZ = -(winLen + gapLen); // hinge edge of the door

        // The side window must be the exact same height (and world Y position) as
        // the front windshield pane so the curved corner glass connects the two
        // without a step. createDT1FrontGeometries() is idempotent (guarded by
        // dt1FacePlate), so this is safe regardless of call order.
        this.createDT1FrontGeometries();
        const G = this.geometries;
        const cabWinY0 = G.dt1PaneY + 0.35; // world Y, bottom edge (matches faceGroup's 0.35 pivot offset)
        const cabWinY1 = G.dt1PaneY + G.dt1PaneH + 0.35; // world Y, top edge
        const cabWinH = G.dt1PaneH;
        const cabWinYc = (cabWinY0 + cabWinY1) / 2;

        // Builds the red/white livery band stack (skirt, rails, roof edge) for a
        // given Z span, so the identical cross-section can be instanced once for
        // the static window zone and once more inside the door pivot (so the
        // door's skirt/rails swing with it instead of staying behind as a static
        // wall slice). Rail heights adjoining the window opening are derived from
        // cabWinY0/cabWinY1 so the cutout lines up with the front pane exactly.
        const buildBandStack = (posX, zCenter, zLen) => {
            const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, cabWinY0 - 1.2, zLen), this.materials.bodyRedDT1);
            bottomRail.position.set(posX, (1.2 + cabWinY0) / 2, zCenter);
            const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.45 - cabWinY1, zLen), this.materials.bodyRedDT1);
            topRail.position.set(posX, (cabWinY1 + 2.45) / 2, zCenter);
            const topRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.325, zLen), this.materials.bodyRedDT1);
            topRed.position.set(posX, 2.6125, zCenter);
            const bottomRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.705, zLen), this.materials.bodyRedDT1);
            bottomRed.position.set(posX, 0.7275, zCenter);
            const midWhite = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, zLen), this.materials.bodyWhite);
            midWhite.position.set(posX, 1.14, zCenter);
            return [bottomRed, midWhite, bottomRail, topRail, topRed];
        };
        const buildIntLining = (posX, zCenter, zLen) => {
            const intBottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, cabWinY0 - 0.375, zLen), this.materials.cockpitInteriorDark);
            intBottom.position.set(posX, (0.375 + cabWinY0) / 2, zCenter);
            const intTop = new THREE.Mesh(new THREE.BoxGeometry(0.01, 2.775 - cabWinY1, zLen), this.materials.cockpitInteriorDark);
            intTop.position.set(posX, (cabWinY1 + 2.775) / 2, zCenter);
            return [intBottom, intTop];
        };

        for (let xSign of [-1, 1]) {
            const posX = xSign * 1.43;
            const staticLen = winLen + gapLen; // window zone, nearest the nose (static)
            const staticCenterZ = -staticLen / 2;
            const doorLen = 1.435 - staticLen; // remaining flank length swings with the door
            const doorCenterZLocal = -doorLen / 2;

            // Static window-zone livery bands + the cab window itself
            flankGroup.add(...buildBandStack(posX, staticCenterZ, staticLen));
            flankGroup.add(...buildIntLining(xSign * 1.40, staticCenterZ, staticLen));
            // A zero-thickness plane instead of a thin box: windowGlass is
            // transparent + DoubleSide + depthWrite:false, so a boxed pane shows
            // its own front AND back face at almost the same depth - Three.js
            // doesn't sort triangles within one mesh, so those two near-coincident
            // faces swap draw order as the camera moves (the flicker/"overlap"
            // reported here). A single plane has only one surface, so it can't
            // fight with itself.
            const sideWinGeom = new THREE.PlaneGeometry(staticLen, cabWinH);
            sideWinGeom.rotateY(Math.PI / 2);
            const sideWin = new THREE.Mesh(sideWinGeom, this.materials.windowGlass);
            sideWin.position.set(xSign * 1.44, cabWinYc, staticCenterZ);
            flankGroup.add(sideWin);

            // NOTE: a static "doorway reveal" jamb (mirroring the G1 cab door) used
            // to sit here at doorFrontZ, world X ~xSign*1.4-1.45. It isn't needed:
            // the door leaf's own frame pieces below (hingeStile for the window
            // band, lowerPanel/topRailD for the bands above/below it) already sit
            // at almost the same X (xSign*1.408-1.448, via doorPivot) and fully
            // cover this same Z boundary whenever the door is closed - the two
            // reds were coincident there, which is what was z-fighting on both
            // the side window's rear edge and the door itself. Removed rather
            // than re-offset, since any Z shift big enough to clear the door's
            // frame pieces (which span the whole doorLen when closed) would have
            // to move past the point where it stops representing this boundary.

            // Driver's cab door: a full-height hinged slice of the flank (skirt,
            // rails, roof edge and a glazed insert), hinged at the front edge and
            // swinging outward as one rigid unit, animated via this.cabDoors
            // (same mechanism as the G1 driver door, toggled with F).
            const winZ0 = -0.06, winZ1 = -(doorLen - 0.06);
            const winY0 = 1.42, winY1 = 2.18;
            const doorPivot = new THREE.Group();
            doorPivot.position.set(xSign * 1.428, 0, doorFrontZ);

            doorPivot.add(...buildBandStack(0, doorCenterZLocal, doorLen));
            doorPivot.add(...buildIntLining(-xSign * 0.03, doorCenterZLocal, doorLen));

            const topRailD = new THREE.Mesh(new THREE.BoxGeometry(0.04, cabWinY1 - winY1, doorLen), this.materials.bodyRedDT1);
            topRailD.position.set(0, (cabWinY1 + winY1) / 2, -doorLen / 2);
            const lowerPanel = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY0 - cabWinY0, doorLen), this.materials.bodyRedDT1);
            lowerPanel.position.set(0, (cabWinY0 + winY0) / 2, -doorLen / 2);
            const hingeStile = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY1 - winY0, -winZ0), this.materials.bodyRedDT1);
            hingeStile.position.set(0, (winY0 + winY1) / 2, winZ0 / 2);
            const latchStile = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY1 - winY0, doorLen + winZ1), this.materials.bodyRedDT1);
            latchStile.position.set(0, (winY0 + winY1) / 2, (winZ1 - doorLen) / 2);
            // Same zero-thickness-plane treatment as sideWin above, for the same
            // reason: a boxed pane's own front/back faces were z-fighting here.
            const doorGlassGeom = new THREE.PlaneGeometry(winZ0 - winZ1, winY1 - winY0);
            doorGlassGeom.rotateY(Math.PI / 2);
            const doorGlass = new THREE.Mesh(doorGlassGeom, this.materials.windowGlass);
            doorGlass.position.set(0, (winY0 + winY1) / 2, (winZ0 + winZ1) / 2);
            const handleOut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.035), this.materials.chromeMetal);
            handleOut.position.set(xSign * 0.026, 1.30, winZ1 + 0.04);
            const handleIn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.035), this.materials.chromeMetal);
            handleIn.position.set(-xSign * 0.036, 1.30, winZ1 + 0.04);
            doorPivot.add(topRailD, lowerPanel, hingeStile, latchStile, doorGlass, handleOut, handleIn);
            flankGroup.add(doorPivot);

            const side = ((cabDir === 1) === (xSign < 0)) ? 'left' : 'right';
            this.cabDoors.push({ pivot: doorPivot, sign: xSign, side, carIdx });
        }

        // Roof/ceiling extend all the way to the front plate's own outer face
        // (faceGroup sits at cabDir*0.22 further out than the flank, and the
        // plate itself protrudes another zFront=0.12 beyond that pivot - 0.34m
        // total), not just to the flank's front edge (z=0) - otherwise there's an
        // uncovered gap above the plate. Built in a mirrored group (like
        // flankGroup) rather than a symmetric box, since the front corners are
        // now rounded to match the body's own corner radius and a plain
        // "noseZ - cabDir*x" placement can't orient an asymmetric shape for both
        // cab directions.
        const roofGroup = new THREE.Group();
        roofGroup.position.set(0, 0, noseZ);
        if (cabDir === -1) roofGroup.rotation.y = Math.PI;
        cockpitGroup.add(roofGroup);

        const faceOffset = 0.22; // matches faceGroup.position.z's cabDir*0.22 in buildDT1CabEnd
        const roofRearZ = -1.44;

        // flankHalf = 1.41 matches the wagon roof's own half-width (dt1Roof box
        // is 2.82 wide), so the cab roof sits flush with it at their shared
        // seam (roofRearZ) instead of overhanging it.
        const cabRoof = new THREE.Mesh(
            this.createDT1RoofGeometry(G.dt1FlatHalf, G.dt1Rc, faceOffset, G.dt1ZFront, roofRearZ, 0.08, 1.41),
            this.materials.dt1Roof
        );
        cabRoof.position.set(0, 2.815, 0);
        roofGroup.add(cabRoof);

        // Ceiling lining sits 0.01m inboard of the roof (same corner curvature,
        // slightly smaller flatHalf), so a thin reveal of roof shows all around.
        // flankHalf = 1.40 matches the wagon ceiling lining's own half-width
        // (dt1Ceiling box is 2.80 wide) for the same flush-seam reason as above.
        const cabCeilingLining = new THREE.Mesh(
            this.createDT1RoofGeometry(G.dt1FlatHalf - 0.01, G.dt1Rc, faceOffset, G.dt1ZFront, roofRearZ, 0.01, 1.40),
            this.materials.cockpitCeiling
        );
        cabCeilingLining.position.set(0, 2.77, 0);
        roofGroup.add(cabCeilingLining);

        // Cabin Rear Wall partition (retro golden wood grain panels on cabin side, light grey on cockpit side)
        const partitionWallMat = this.materials.dt1Wall;
        const cockpitWallMat = this.materials.interiorWallG1;
        const frameLineMat = this.materials.bodyDarkGrey;
        const chromeMat = this.materials.chromeMetal;

        const buildPartitionMesh = (w, h, x, y, z) => {
            const group = new THREE.Group();
            group.position.set(x, y, z);

            // Grey side (facing cockpit)
            const grey = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cockpitWallMat);
            grey.position.z = cabDir * 0.025;
            grey.rotation.y = (cabDir === 1) ? 0 : Math.PI;

            // Wood side (facing passenger cabin)
            const wood = new THREE.Mesh(new THREE.PlaneGeometry(w, h), partitionWallMat);
            wood.position.z = -cabDir * 0.025;
            wood.rotation.y = (cabDir === 1) ? Math.PI : 0;

            // Edge filler
            const fill = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.048), partitionWallMat);

            group.add(grey, wood, fill);
            return group;
        };

        const partPosZ = noseZ - cabDir * 1.44;
        const partitionL = buildPartitionMesh(1.01, 2.075, -0.905, 1.4125, partPosZ);
        const partitionR = buildPartitionMesh(1.01, 2.075, 0.905, 1.4125, partPosZ);
        const partitionTop = buildPartitionMesh(2.82, 0.325, 0, 2.6125, partPosZ);
        
        // Cabin door (dual-sided: grey/frame on cockpit, wood on cabin)
        const cabinDoorGroup = new THREE.Group();
        cabinDoorGroup.position.set(0, 1.4125, partPosZ);

        // Grey side + dark frame line (2mm border) - facing COCKPIT
        const doorFrame = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.075), frameLineMat);
        doorFrame.position.z = cabDir * 0.0245;
        doorFrame.rotation.y = (cabDir === 1) ? 0 : Math.PI;

        const doorGrey = new THREE.Mesh(new THREE.PlaneGeometry(0.796, 2.071), cockpitWallMat);
        doorGrey.position.z = cabDir * 0.025;
        doorGrey.rotation.y = (cabDir === 1) ? 0 : Math.PI;

        // Wood side - facing PASSENGER CABIN
        const doorWood = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.075), partitionWallMat);
        doorWood.position.z = -cabDir * 0.025;
        doorWood.rotation.y = (cabDir === 1) ? Math.PI : 0;

        const doorFill = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.075, 0.048), partitionWallMat);
        cabinDoorGroup.add(doorWood, doorFrame, doorGrey, doorFill);

        // Door handles (Klinken) on both sides at ergonomic height (~1.1m from floor)
        const handleGeom = new THREE.BoxGeometry(0.12, 0.02, 0.03);
        const handleY = 1.48 - 1.4125;

        const handleCockpit = new THREE.Mesh(handleGeom, chromeMat);
        handleCockpit.position.set(-0.32, handleY, cabDir * 0.045);

        const handleCabin = new THREE.Mesh(handleGeom, chromeMat);
        handleCabin.position.set(-0.32, handleY, -cabDir * 0.045);

        cabinDoorGroup.add(handleCockpit, handleCabin);
        cockpitGroup.add(cabinDoorGroup);
        cockpitGroup.add(partitionL, partitionR, partitionTop);

        // Interior station display removed for DT1.
    }

    // Canvas-based upholstery material with a green gradient fade and
    // subtle "retro" quilting pattern for the DT1 cockpit chair.
    getDT1CockpitSeatMaterial() {
        if (this._dt1CockpitSeatMat) return this._dt1CockpitSeatMat;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, '#2d4a2d'); // slightly brighter green top
        grad.addColorStop(1, '#1a2e1a'); // dark green bottom
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);

        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 128; i += 16) {
            ctx.beginPath();
            ctx.moveTo(0, i); ctx.lineTo(128, i);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(i, 0); ctx.lineTo(i, 128);
            ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

        this._dt1CockpitSeatMat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
        return this._dt1CockpitSeatMat;
    }

    // Ergonomic driver's chair for the DT1: features a rounded cushion,
    // segmented backrest with lumbar support, a separate headrest and
    // integrated armrests. Replaces the old three-box placeholder.
    buildDT1DriverSeat(cockpitGroup, noseZ, cabDir) {
        const seatMat = this.getDT1CockpitSeatMaterial();
        const frameMat = cheapMaterial({ color: '#333333', roughness: 0.6, metalness: 0.3 });

        const seatGroup = new THREE.Group();
        // Positioned slightly off-center and retracted for legroom
        seatGroup.position.set(cabDir * -0.25, 0.38, noseZ - cabDir * 0.88);
        cockpitGroup.add(seatGroup);

        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 8), this.materials.chromeMetal);
        pedestal.position.y = 0.225;
        seatGroup.add(pedestal);

        const cushionGeom = this.createRoundedBoxGeometry(0.48, 0.10, 0.50, 0.06);
        const cushion = new THREE.Mesh(cushionGeom, seatMat);
        cushion.position.y = 0.48;
        seatGroup.add(cushion);

        const backrestGroup = new THREE.Group();
        backrestGroup.position.set(0, 0.52, -cabDir * 0.20);
        backrestGroup.rotation.x = -cabDir * 0.15;
        seatGroup.add(backrestGroup);

        const lowerBackGeom = this.createRoundedBoxGeometry(0.44, 0.40, 0.08, 0.06);
        const lowerBack = new THREE.Mesh(lowerBackGeom, seatMat);
        lowerBack.position.y = 0.20;
        backrestGroup.add(lowerBack);

        const armPadGeom = this.createRoundedBoxGeometry(0.06, 0.04, 0.28, 0.02);
        for (const ax of [-1, 1]) {
            const armSupport = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), frameMat);
            armSupport.position.set(ax * 0.26, 0.58, -0.05);
            const armPad = new THREE.Mesh(armPadGeom, seatMat);
            armPad.position.set(ax * 0.26, 0.67, -0.05);
            seatGroup.add(armSupport, armPad);
        }
    }

    drawDT1LeftScreen(screen) {
        const ctx = screen.leftCtx;
        const width = screen.leftCanvas.width;
        const height = screen.leftCanvas.height;

        ctx.fillStyle = '#14171d';
        ctx.fillRect(0, 0, width, height);

        // Draw HBL (Hauptluftbehälter) Pressure Dial (Left)
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(64, 64, 42, Math.PI * 0.75, Math.PI * 2.25);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HBL', 64, 64 - 15);

        ctx.strokeStyle = '#94a3b8';
        for (let p = 0; p <= 12; p += 2) {
            const angle = Math.PI * 0.75 + (p / 12) * Math.PI * 1.5;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(64 + cos * 36, 64 + sin * 36);
            ctx.lineTo(64 + cos * 42, 64 + sin * 42);
            ctx.stroke();
        }

        const hblPressure = 8.5;
        const hblAngle = Math.PI * 0.75 + (hblPressure / 12) * Math.PI * 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(64, 64);
        ctx.lineTo(64 + Math.cos(hblAngle) * 35, 64 + Math.sin(hblAngle) * 35);
        ctx.stroke();

        // Draw BZ (Bremszylinder) Pressure Dial (Right)
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(192, 64, 42, Math.PI * 0.75, Math.PI * 2.25);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.fillText('BZ', 192, 64 - 15);

        for (let p = 0; p <= 6; p += 1) {
            const angle = Math.PI * 0.75 + (p / 6) * Math.PI * 1.5;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(192 + cos * 36, 64 + sin * 36);
            ctx.lineTo(192 + cos * 42, 64 + sin * 42);
            ctx.stroke();
        }

        const bzPressure = this.sim.brakeCylinderPressure;
        const bzAngle = Math.PI * 0.75 + (bzPressure / 6) * Math.PI * 1.5;
        ctx.strokeStyle = '#ff3300';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(192, 64);
        ctx.lineTo(192 + Math.cos(bzAngle) * 35, 64 + Math.sin(bzAngle) * 35);
        ctx.stroke();

        screen.leftTexture.needsUpdate = true;
    }

    drawDT1RightScreen(screen) {
        const ctx = screen.rightCtx;
        const width = screen.rightCanvas.width;
        const height = screen.rightCanvas.height;

        ctx.fillStyle = '#14171d';
        ctx.fillRect(0, 0, width, height);

        const drawIndicator = (x, y, label, active, colorActive, colorInactive) => {
            ctx.fillStyle = active ? colorActive : colorInactive;
            ctx.fillRect(x, y, 100, 40);
            
            ctx.strokeStyle = '#2b303c';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, 100, 40);

            ctx.fillStyle = active ? '#ffffff' : '#4b5563';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + 50, y + 20);
        };

        let doorsActive = false;
        let doorsColor = '#1e3a1f';
        let doorsLabel = 'TÜREN ZU';

        if (this.sim.doorProgress > 0 || this.sim.doorsOpen) {
            doorsActive = true;
            doorsLabel = 'TÜREN OFFEN';
            const blink = (Math.floor(Date.now() / 250) % 2 === 0);
            doorsColor = blink ? '#b91c1c' : '#7f1d1d';
        } else {
            doorsColor = '#15803d';
            doorsActive = true;
        }
        drawIndicator(20, 16, doorsLabel, doorsActive, doorsColor, '#1e3a1f');

        const atoActive = this.sim.atoMode;
        drawIndicator(136, 16, 'AUTOPILOT', atoActive, '#1d4ed8', '#1e293b');

        const sifaActive = this.sim.sifaWarning;
        drawIndicator(20, 72, 'SIFA WARN', sifaActive, '#eab308', '#3f2b0f');

        const emergencyActive = this.sim.emergencyBrake;
        drawIndicator(136, 72, 'NOTBREMSE', emergencyActive, '#b91c1c', '#4c0519');

        screen.rightTexture.needsUpdate = true;
    }

    // Tiny static cubemap (6x 64px canvases) standing in for the lit car
    // interior: warm ceiling light strips up top, muted wall band, dark
    // seat-red/floor tones below. Deliberately soft and generic so it reads
    // as "interior mirrored in the pane" for G1 and DT1 alike, from any car
    // orientation — it is never re-rendered.
    createInteriorEnvMap() {
        const size = 64;
        const makeFace = (draw) => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            draw(canvas.getContext('2d'));
            return canvas;
        };

        // Side faces (±X/±Z): ceiling glow at the top edge, light strip just
        // below it, wall band in the middle, seats/floor fading out at the
        // bottom. Cube faces have +Y at the canvas top (flipY is off).
        const sideFace = (seed) => makeFace((ctx) => {
            const g = ctx.createLinearGradient(0, 0, 0, size);
            g.addColorStop(0.00, '#8a7f6e');
            g.addColorStop(0.22, '#55503f');
            g.addColorStop(0.45, '#2e2b26');
            g.addColorStop(0.72, '#241416');
            g.addColorStop(1.00, '#151011');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
            // Bright warm light strip along the ceiling line
            const s = ctx.createLinearGradient(0, size * 0.10, 0, size * 0.26);
            s.addColorStop(0.0, 'rgba(255,240,210,0)');
            s.addColorStop(0.5, 'rgba(255,240,210,0.9)');
            s.addColorStop(1.0, 'rgba(255,240,210,0)');
            ctx.fillStyle = s;
            ctx.fillRect(0, size * 0.10, size, size * 0.16);
            // Faint dark verticals (pillars/handrails) so the reflection shows
            // some parallax as the view direction changes
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            for (let i = 0; i < 3; i++) {
                const x = ((seed * 13 + i * 23) % 52) + 6;
                ctx.fillRect(x, size * 0.28, 4, size * 0.5);
            }
        });

        // Top face (+Y): ceiling with two warm light strips running lengthwise
        const topFace = makeFace((ctx) => {
            ctx.fillStyle = '#6e675c';
            ctx.fillRect(0, 0, size, size);
            for (const x of [size * 0.30, size * 0.70]) {
                const s = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
                s.addColorStop(0.0, 'rgba(255,240,205,0)');
                s.addColorStop(0.5, 'rgba(255,244,214,1)');
                s.addColorStop(1.0, 'rgba(255,240,205,0)');
                ctx.fillStyle = s;
                ctx.fillRect(x - 7, 0, 14, size);
            }
        });

        // Bottom face (-Y): dark floor with a hint of seat red
        const bottomFace = makeFace((ctx) => {
            const g = ctx.createLinearGradient(0, 0, 0, size);
            g.addColorStop(0, '#1d1416');
            g.addColorStop(1, '#120e0f');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
        });

        const tex = new THREE.CubeTexture([
            sideFace(1), sideFace(2), topFace, bottomFace, sideFace(3), sideFace(4)
        ]);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
    }

    // Cheap faux-reflective glass: one static cubemap sample plus a fresnel
    // ramp per fragment, no lighting. Premultiplied-alpha blending keeps the
    // old near-clear tint behavior (dst*(1-a) + tint*a) while the reflection
    // is added on top, so it stays visible despite the tiny opacity —
    // strongest at grazing angles and against the dark tunnel, washed out in
    // bright stations, like real window reflections.
    //
    // Parallax (BPCEM, box-projected cubemap): a plain cubemap lookup assumes
    // the reflected interior is infinitely far away, so walking through the
    // car wouldn't move the reflection. Instead the reflection ray is
    // intersected with the car-interior AABB (uBoxMin/uBoxMax) and the cube
    // is sampled toward that hit point as seen from the bake probe
    // (uProbePos). Everything runs in the glass mesh's merge-domain frame
    // (≈ the carriage frame, geometry is baked root-relative by
    // mergeStaticMeshes), so the box follows the car through curves; uBakeRot
    // rotates the final direction into the cubemap's world-aligned capture
    // frame. Still zero extra passes and one texture tap — the box test is a
    // handful of ALU ops, and nothing needs updating in the render loop
    // (cameraPosition is a three.js built-in uniform).
    createFauxGlassMaterial({ tint = '#ffffff', opacity = 0.02, reflectivity = 0.30, fresnelBase = 0.25 } = {}) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uEnvMap: { value: this.interiorEnvMap },
                uTint: { value: new THREE.Color(tint).multiplyScalar(0.5) }, // dimmed 50% like cheapMaterial
                uOpacity: { value: opacity },
                uReflectivity: { value: reflectivity },
                uFresnelBase: { value: fresnelBase },
                // Car interior box + probe in domain-local coords (car origin
                // sits at the leading end: z runs 0..-carLength); real values
                // are set by bakeInteriorEnvMap() per train type.
                uBoxMin: { value: new THREE.Vector3(-1.45, 0.90, -18.0) },
                uBoxMax: { value: new THREE.Vector3(1.45, 2.90, 0.0) },
                uProbePos: { value: new THREE.Vector3(0, 1.70, -9.0) },
                uBakeRot: { value: new THREE.Matrix3() },
                // Planar mirror pass (side windows of the camera's car only,
                // fed per frame by updatePlanarReflections; plane w=1e9 keeps
                // the weight at 0 until then)
                uMirrorTexL: { value: null },
                uMirrorTexR: { value: null },
                uMirrorMatL: { value: new THREE.Matrix4() },
                uMirrorMatR: { value: new THREE.Matrix4() },
                uMirrorPlaneL: { value: new THREE.Vector4(0, 0, 0, 1e9) },
                uMirrorPlaneR: { value: new THREE.Vector4(0, 0, 0, 1e9) },
                uMirrorStrength: { value: 0 }
            },
            vertexShader: `
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uTint;
                uniform float uOpacity;
                uniform float uReflectivity;
                uniform float uFresnelBase;
                uniform sampler2D uMirrorTexL;
                uniform sampler2D uMirrorTexR;
                uniform mat4 uMirrorMatL;
                uniform mat4 uMirrorMatR;
                uniform vec4 uMirrorPlaneL;
                uniform vec4 uMirrorPlaneR;
                uniform float uMirrorStrength;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                    vec3 n = normalize(vWorldNormal);
                    vec3 v = normalize(vWorldPos - cameraPosition);
                    float facing = abs(dot(v, n));
                    float fres = uFresnelBase + (1.0 - uFresnelBase) * pow(1.0 - facing, 3.0);
                    vec3 refl = vec3(0.0);
                    if (uReflectivity > 0.0) {
                        vec3 reflColor = vec3(0.0);
                        // Real planar mirror of the current car, blended over by distance to the two side-window planes
                        float dL = abs(dot(uMirrorPlaneL.xyz, vWorldPos) + uMirrorPlaneL.w);
                        float dR = abs(dot(uMirrorPlaneR.xyz, vWorldPos) + uMirrorPlaneR.w);
                        float wL = uMirrorStrength * clamp(1.0 - dL * 2.0, 0.0, 1.0);
                        float wR = uMirrorStrength * clamp(1.0 - dR * 2.0, 0.0, 1.0);
                        if (wL > 0.0) {
                            vec4 pc = uMirrorMatL * vec4(vWorldPos, 1.0);
                            if (pc.w > 0.0) reflColor = mix(reflColor, texture2D(uMirrorTexL, pc.xy / pc.w).rgb, wL);
                        }
                        if (wR > 0.0) {
                            vec4 pc = uMirrorMatR * vec4(vWorldPos, 1.0);
                            if (pc.w > 0.0) reflColor = mix(reflColor, texture2D(uMirrorTexR, pc.xy / pc.w).rgb, wR);
                        }
                        refl = reflColor * (uReflectivity * fres);
                    }
                    // premultiplied output: tint*alpha plus additive reflection
                    gl_FragColor = vec4(uTint * uOpacity + refl, uOpacity);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            depthWrite: false,
            side: THREE.DoubleSide,
            // These panes sit recessed a few mm behind their surrounding cutout
            // (frame/mask rim), by design close enough that depth-buffer
            // precision alone isn't reliable at grazing angles - it read as
            // z-fighting flicker all around the frame edge, not just at one
            // corner. A polygon depth offset pushes the glass fragments
            // slightly further from the camera than their true depth, so the
            // opaque frame in front of them always wins the depth test
            // instead of the two swapping per pixel/per frame.
            polygonOffset: true,
            polygonOffsetFactor: 4,
            polygonOffsetUnits: 4
        });
    }

    // One-time snapshot of the REAL interior for the faux glass reflections:
    // renders the scene into a small cube target from eye height inside a
    // middle car, then swaps it into all glass materials. Static afterwards —
    // never updated per frame. Call after the scene is fully built (and again
    // after a train type switch); warmUpRenderer() in main.js does both.
    bakeInteriorEnvMap(renderer, scene) {
        if (!this.carriages || this.carriages.length === 0) return;

        if (!this.interiorEnvBakeTarget) {
            this.interiorEnvBakeTarget = new THREE.WebGLCubeRenderTarget(256, {
                generateMipmaps: true,
                minFilter: THREE.LinearMipmapLinearFilter
            });
            this.interiorEnvBakeTarget.texture.colorSpace = THREE.SRGBColorSpace;
        }
        const rt = this.interiorEnvBakeTarget;

        // Probe at eye height in the middle of car 2, expressed in car-local
        // coords. IMPORTANT: the car origin sits at the LEADING END at rail
        // level (local z runs 0..-carLength, cf. passengerLocalPos z=-9), so
        // the mid-car probe is at z = -carLength/2 — a probe at z=0 would sit
        // inside the end wall/bellows and bake garbage. The window band spans
        // y 1.20-2.55, so 1.70 sees lights above and seats below. The same
        // local point doubles as the BPCEM probe position in the shader.
        const probeLocal = new THREE.Vector3(0, 1.70, -this.carLength / 2);
        const car = this.carriages[Math.min(1, this.carriages.length - 1)];
        car.updateMatrixWorld(true);
        const cubeCam = new THREE.CubeCamera(0.1, 200, rt);
        cubeCam.position.copy(probeLocal).applyMatrix4(car.matrixWorld);

        // While rendering INTO the cube target it must not be bound as a
        // sampler on the glass (WebGL feedback loop): point the glass at the
        // procedural stand-in and mute its reflections for the bake, so the
        // panes bake as plain near-clear tint.
        const glassMats = this.glassMaterials();
        const savedRefl = glassMats.map(m => m.uniforms.uReflectivity.value);
        for (const m of glassMats) {
            m.uniforms.uEnvMap.value = this.proceduralEnvMap;
            m.uniforms.uReflectivity.value = 0;
        }

        cubeCam.update(renderer, scene);

        // BPCEM parameters: the car-interior AABB in domain-local coords
        // (x = interior half width, y = floor..ceiling, z = 0..-carLength
        // matching the end-origin car frame), the probe the cube was captured
        // from, and the capture rotation — the cube faces are world-axis
        // aligned at bake time, so local reflection directions must be
        // rotated into that frame before sampling.
        const boxMin = new THREE.Vector3(-1.40, 0.90, -this.carLength);
        const boxMax = new THREE.Vector3(1.40, 2.90, 0);
        const bakeRot = new THREE.Matrix3().setFromMatrix4(car.matrixWorld);

        glassMats.forEach((m, i) => {
            m.uniforms.uReflectivity.value = savedRefl[i];
            m.uniforms.uEnvMap.value = rt.texture;
            m.uniforms.uBoxMin.value.copy(boxMin);
            m.uniforms.uBoxMax.value.copy(boxMax);
            m.uniforms.uProbePos.value.copy(probeLocal);
            m.uniforms.uBakeRot.value.copy(bakeRot);
        });
        this.interiorEnvMap = rt.texture;
    }

    glassMaterials() {
        return ['windowGlass', 'cabWindowGlass', 'windshieldGlass', 'partitionGlass']
            .map(name => this.materials[name])
            .filter(Boolean);
    }

    initPlanarMirrors() {
        this.mirror = {
            // Half-res-ish targets are plenty: the mirror image is dimmed by
            // fresnel/reflectivity anyway, softness reads as glass.
            targets: [
                new THREE.WebGLRenderTarget(1024, 576),
                new THREE.WebGLRenderTarget(1024, 576)
            ],
            // Parking spot for the glass samplers while the targets are being
            // rendered (never sampled with weight > 0)
            dummyTex: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1),
            virtualCam: new THREE.PerspectiveCamera(),
            planes: [new THREE.Vector4(), new THREE.Vector4()],
            matrices: [new THREE.Matrix4(), new THREE.Matrix4()]
        };
        this.mirror.dummyTex.needsUpdate = true;
    }

    // Real planar reflections for the side windows: renders the camera's
    // current carriage mirrored across each side-window plane into two small
    // render targets (oblique near-plane clipping like THREE.Reflector) and
    // feeds them to the glass shader, which blends them over the static
    // cubemap by plane distance. Runs only for in-train cameras — two extra
    // low-res renders of ONE merged carriage (~90 draw calls each), nothing
    // else. Exterior cameras cost nothing: strength goes to 0 and only the
    // static cubemap path remains.
    updatePlanarReflections(renderer, camera, enabled) {
        const glassMats = this.glassMaterials();
        if (glassMats.length === 0) return;
        if (!enabled || this.carriages.length === 0) {
            for (const m of glassMats) m.uniforms.uMirrorStrength.value = 0;
            return;
        }
        if (!this.mirror) this.initPlanarMirrors();
        const M = this.mirror;

        // Carriage the camera is in = nearest car-center (origin is at the
        // car end, so offset by -carLength/2 before comparing)
        camera.getWorldPosition(_mirCamPos);
        let car = this.carriages[0];
        let best = Infinity;
        for (const c of this.carriages) {
            _mirTmp.set(0, 0, -this.carLength / 2).applyMatrix4(c.matrixWorld);
            const d = _mirTmp.distanceToSquared(_mirCamPos);
            if (d < best) { best = d; car = c; }
        }
        car.updateMatrixWorld(true);

        // The glass must not sample the mirror targets while they are being
        // rendered into (WebGL feedback loop): park the samplers on a dummy.
        // Reflections are muted entirely for the pass — glass seen INSIDE a
        // mirror image must not show reflections of its own, that reads as
        // overdone double-mirroring.
        const savedRefl = glassMats.map(m => m.uniforms.uReflectivity.value);
        for (const m of glassMats) {
            m.uniforms.uMirrorStrength.value = 0;
            m.uniforms.uReflectivity.value = 0;
            m.uniforms.uMirrorTexL.value = M.dummyTex;
            m.uniforms.uMirrorTexR.value = M.dummyTex;
        }

        _mirRot.extractRotation(car.matrixWorld);
        let anyOk = false;
        for (let i = 0; i < 2; i++) {
            const sign = i === 0 ? -1 : 1;
            // Side-window plane: glass sits at local x = ±1.43, mid-height,
            // mid-length; normal points inward (toward the camera)
            _mirPoint.set(sign * 1.43, 1.85, -this.carLength / 2).applyMatrix4(car.matrixWorld);
            _mirNormal.set(-sign, 0, 0).applyMatrix4(_mirRot).normalize();
            const ok = this.renderMirrorSide(renderer, camera, car, M.targets[i], _mirPoint, _mirNormal, M.matrices[i]);
            if (ok) {
                _mirPlane.setFromNormalAndCoplanarPoint(_mirNormal, _mirPoint);
                M.planes[i].set(_mirNormal.x, _mirNormal.y, _mirNormal.z, _mirPlane.constant);
                anyOk = true;
            } else {
                M.planes[i].set(0, 0, 0, 1e9); // weight 0 in the shader
            }
        }

        glassMats.forEach((m, i) => {
            m.uniforms.uReflectivity.value = savedRefl[i];
            m.uniforms.uMirrorTexL.value = M.targets[0].texture;
            m.uniforms.uMirrorTexR.value = M.targets[1].texture;
            m.uniforms.uMirrorMatL.value.copy(M.matrices[0]);
            m.uniforms.uMirrorMatR.value.copy(M.matrices[1]);
            m.uniforms.uMirrorPlaneL.value.copy(M.planes[0]);
            m.uniforms.uMirrorPlaneR.value.copy(M.planes[1]);
            m.uniforms.uMirrorStrength.value = anyOk ? 1 : 0;
        });
    }

    // One mirrored render of `root` across the plane (point, normal) into rt.
    // Mirror-camera construction and oblique near-plane clipping ported from
    // three.js' Reflector: the clip plane culls everything on the far side of
    // the glass (tunnel wall etc.), the texture matrix maps world positions
    // to reflection UVs and is taken BEFORE the oblique tweak.
    renderMirrorSide(renderer, camera, root, rt, point, normal, outMatrix) {
        _mirView.subVectors(point, _mirCamPos);
        if (_mirView.dot(normal) > 0) return false; // camera behind this pane

        _mirView.reflect(normal).negate().add(point);

        const vcam = this.mirror.virtualCam;
        _mirRotCam.extractRotation(camera.matrixWorld);
        _mirLook.set(0, 0, -1).applyMatrix4(_mirRotCam).add(_mirCamPos);
        _mirTarget.subVectors(point, _mirLook).reflect(normal).negate().add(point);
        vcam.position.copy(_mirView);
        vcam.up.set(0, 1, 0).applyMatrix4(_mirRotCam).reflect(normal);
        vcam.lookAt(_mirTarget);
        vcam.far = camera.far;
        vcam.updateMatrixWorld();
        vcam.projectionMatrix.copy(camera.projectionMatrix);

        // World -> reflection-UV matrix (NDC brought into [0,1])
        outMatrix.set(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.5, 0.0, 0.5,
            0.0, 0.0, 0.5, 0.5,
            0.0, 0.0, 0.0, 1.0
        );
        outMatrix.multiply(vcam.projectionMatrix);
        outMatrix.multiply(vcam.matrixWorldInverse);

        // Oblique near plane = the glass plane, in the mirror camera's frame
        _mirPlane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(vcam.matrixWorldInverse);
        _mirClip.set(_mirPlane.normal.x, _mirPlane.normal.y, _mirPlane.normal.z, _mirPlane.constant);
        const pm = vcam.projectionMatrix;
        _mirQ.x = (Math.sign(_mirClip.x) + pm.elements[8]) / pm.elements[0];
        _mirQ.y = (Math.sign(_mirClip.y) + pm.elements[9]) / pm.elements[5];
        _mirQ.z = -1.0;
        _mirQ.w = (1.0 + pm.elements[10]) / pm.elements[14];
        _mirClip.multiplyScalar(2.0 / _mirClip.dot(_mirQ));
        pm.elements[2] = _mirClip.x;
        pm.elements[6] = _mirClip.y;
        pm.elements[10] = _mirClip.z + 1.0 - 0.003; // small clip bias
        pm.elements[14] = _mirClip.w;

        const prevRT = renderer.getRenderTarget();
        renderer.getClearColor(_mirClearColor);
        const prevAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 0); // empty = black = no reflection
        if (renderer.autoClear === false) renderer.clear();
        renderer.render(root, vcam);
        renderer.setClearColor(_mirClearColor, prevAlpha);
        renderer.setRenderTarget(prevRT);
        return true;
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);

        return new THREE.CanvasTexture(canvas);
    }

    createWoodTexture(baseColor = '#c27d38', grainColor = '#8c5016') {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Base wood color
        ctx.fillStyle = baseColor; // nice golden oak/chestnut wood
        ctx.fillRect(0, 0, 128, 128);
        
        // Draw wavy grain lines
        ctx.strokeStyle = grainColor;
        for (let y = 0; y < 128; y += 4) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineWidth = 0.5 + Math.random() * 1.5;
            ctx.globalAlpha = 0.15 + Math.random() * 0.15;
            for (let x = 0; x <= 128; x += 16) {
                const wave = Math.sin(x / 20 + y / 10) * 3;
                ctx.lineTo(x, y + wave);
            }
            ctx.stroke();
        }
        
        ctx.globalAlpha = 1.0;
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        return texture;
    }

    createDT1FloorMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Grundfarbe
        ctx.fillStyle = '#4E4F4A';
        ctx.fillRect(0, 0, 512, 512);

        // Gesprenkelte kurze Längsstreifen
        const colors = ['#5F5C4D', '#898A82'];
        for (let i = 0; i < 8000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const length = 4 + Math.random() * 12;
            const width = 1 + Math.random() * 1.5;

            ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
            ctx.globalAlpha = 0.3 + Math.random() * 0.4;
            ctx.fillRect(x, y, width, length);
        }

        ctx.globalAlpha = 1.0;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);

        return new THREE.MeshBasicMaterial({
            map: texture,
            fog: false
        });
    }

    createHandrailGradientTexture(color1 = '#8C8575', color2 = '#73695A') {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 32, 0);
        grad.addColorStop(0, color1);
        grad.addColorStop(0.5, color2);
        grad.addColorStop(1, color1);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createWallCeilingFilletTexture(color1 = '#524F50', color2 = '#C1BFC5') {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 32);
        grad.addColorStop(0, color1);
        grad.addColorStop(1, color2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createSeatGradientTexture(color1 = '#393C43', color2 = '#0F1628') {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 32);
        grad.addColorStop(0, color1);
        grad.addColorStop(1, color2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createBellowsTexture(direction) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        // Dark base fold color
        ctx.fillStyle = '#141619';
        ctx.fillRect(0, 0, 64, 64);
        
        // Light fold peak stripes
        ctx.fillStyle = '#2c2f35';
        if (direction === 'vertical') {
            ctx.fillRect(16, 0, 16, 64);
            ctx.fillRect(48, 0, 16, 64);
        } else {
            ctx.fillRect(0, 16, 64, 16);
            ctx.fillRect(0, 48, 64, 16);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }

    // Appends a rounded rectangle (separate bottom/top corner radii) to a THREE.Path
    traceRoundedRect(path, x1, y1, x2, y2, rBot, rTop) {
        path.moveTo(x1 + rBot, y1);
        path.lineTo(x2 - rBot, y1);
        path.quadraticCurveTo(x2, y1, x2, y1 + rBot);
        path.lineTo(x2, y2 - rTop);
        path.quadraticCurveTo(x2, y2, x2 - rTop, y2);
        path.lineTo(x1 + rTop, y2);
        path.quadraticCurveTo(x1, y2, x1, y2 - rTop);
        path.lineTo(x1, y1 + rBot);
        path.quadraticCurveTo(x1, y1, x1 + rBot, y1);
        return path;
    }

    // --- G1 front profile helpers -------------------------------------------
    // Centerline z of the front fascia by height: the kink (foremost point) sits
    // at y = 0.95, just BELOW the headlights; above it nose and windshield form
    // one continuously raked plane, then an arc pulls back over the roof.
    g1FrontProfileZ(y) {
        if (y <= 0.95) return 0.46 - (0.95 - y) * 0.7;
        if (y <= 2.48) return 0.46 - (y - 0.95) * (0.26 / 1.53);
        const t = Math.min(1, (y - 2.48) / 0.40);
        return 0.20 - 0.25 * (0.4 * t + 0.6 * t * t);
    }

    g1FrontProfileSlope(y) {
        if (y <= 0.95) return 0.7;
        if (y <= 2.48) return -0.26 / 1.53;
        const t = Math.min(1, (y - 2.48) / 0.40);
        return -(0.25 + 0.75 * t);
    }

    // Full front surface: profile plus a slight horizontal convexity (the face
    // bulges ~4.5cm at the center relative to the outer edges)
    g1FrontZ(x, y) {
        return this.g1FrontProfileZ(y) - 0.03125 * x * x;
    }

    // Piecewise-linear interpolation over [[y, value], ...] samples
    g1Interp(pts, y) {
        if (y <= pts[0][0]) return pts[0][1];
        for (let i = 1; i < pts.length; i++) {
            if (y <= pts[i][0]) {
                const [y0, v0] = pts[i - 1], [y1, v1] = pts[i];
                return v0 + (v1 - v0) * (y - y0) / (y1 - y0);
            }
        }
        return pts[pts.length - 1][1];
    }

    // Crease line where the flat front plane folds into the red side bevels.
    // Constant 1.23 for every height, matching the mask/maskNose panels'
    // own width (they're now uniformly 1.23 throughout, see createG1FrontGeometries)
    // instead of stepping from 1.25 to 1.23 partway up - that step used to
    // leave the bevel's front edge sitting proud of the mask below y=1.52.
    g1CreaseX(y) {
        return 1.23;
    }

    // Rear edge of the side bevels = front edge of the black cab flank panels.
    // The bevels are a constant ~22cm wide band at ~45 degrees: they trail the
    // front surface at the crease by a fixed 22cm - this holds for any y, so
    // the bevel keeps that same width (and inherits the front crease's own
    // kink at y=0.95) all the way down, instead of freezing/narrowing below a
    // clamp. All callers pass y >= 0.57 already except the bevel's own rows,
    // which now rely on exactly this unclamped behavior.
    g1SideFrontZ(y) {
        return this.g1FrontZ(this.g1CreaseX(y), y) - 0.22;
    }

    // flankPts' own real edge in the y=0.40-0.95 lower band (piecewise linear
    // through its own points: 0.033 at 0.40, 0.085 at 0.57, 0.211 at 0.95),
    // used both by the bevel below the kink (to enclose the flank exactly)
    // and by maskNose (to stay flush with the bevel's own inner edge there).
    g1FlankLowerZ(y) {
        return this.g1Interp([[0.40, 0.033], [0.57, 0.085], [0.95, 0.211]], y);
    }

    // Bevel width at the kink (front crease minus g1FlankLowerZ(0.95)) - the
    // bevel's front edge below the kink is g1FlankLowerZ(y) + this, so it
    // stays exactly this thick all the way down instead of narrowing.
    g1KinkWidth() {
        return this.g1FrontZ(this.g1CreaseX(0.95), 0.95) - this.g1FlankLowerZ(0.95);
    }

    // Shears an XY-plane geometry onto the front surface (z += g1FrontZ(x,y) + off)
    // and fixes the normals analytically for the shear.
    // yOverride: if given, uses this fixed y (instead of each vertex's own y)
    // just for the g1FrontZ/slope lookup, while the vertex keeps its real Y
    // position - freezes the shear to a flat panel at that reference height's
    // depth instead of following the curve (used for maskNose, see below).
    // zFunc: if given, replaces g1FrontZ(x, zy) entirely (x is passed through
    // unused unless zFunc itself wants it) - used for maskNose to follow the
    // bevel's own g1FlankLowerZ(y)+g1KinkWidth() curve instead of g1FrontZ, so
    // the two stay flush with each other below the kink.
    shearG1FrontGeometry(geom, zOffset = 0, yOverride = null, zFunc = null) {
        const pos = geom.attributes.position;
        const nor = geom.attributes.normal;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i);
            const zy = yOverride !== null ? yOverride : y;
            const z = zFunc ? zFunc(x, zy) : this.g1FrontZ(x, zy);
            pos.setZ(i, pos.getZ(i) + z + zOffset);
            if (nor) {
                const fx = zFunc ? 0 : -0.0625 * x;
                const fy = (yOverride !== null || zFunc) ? 0 : this.g1FrontProfileSlope(y);
                const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
                const vx = nx - nz * fx, vy = ny - nz * fy;
                const len = Math.hypot(vx, vy, nz) || 1;
                nor.setXYZ(i, vx / len, vy / len, nz / len);
            }
        }
        pos.needsUpdate = true;
        if (nor) nor.needsUpdate = true;
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        return geom;
    }

    // Flat ruled bevel strip from the fascia crease into the body side (per side).
    // Non-indexed so the blunt mid-height kink stays a crisp edge. Bottom row
    // is 0.40, matching the flank panel's own bottom edge (flankPts) and the
    // bottom of the flank's red stripe (g1CabRedStripeL/R, y 0.40-0.60) - the
    // flank already reaches that low, so extending only the bevel down to
    // meet it (rather than also stretching the flank further, which looked
    // like a separately added black plate) is a safe, seamless match.
    createG1BevelGeometry(sign) {
        const rows = [0.40, 0.57, 0.95, 1.42, 1.52, 1.56, 1.95, 2.48, 2.62, 2.75, 2.88];
        const pos = [];
        // Above the kink (y>=0.95), g1SideFrontZ's formula happens to closely
        // track flankPts' own hand-authored values already (e.g. 0.111 vs
        // 0.11 at y=1.42), so the bevel already encloses the flank properly
        // there with the normal, formula-based front edge too. Below it,
        // flankPts is flat/hand-tuned in a way the formula doesn't follow (it
        // would give -0.19 at y=0.40 vs flankPts' actual 0.033) - g1FlankLowerZ
        // uses flankPts' exact values instead, so the rear edge encloses the
        // flank exactly. The front edge below the kink is then derived as
        // "g1FlankLowerZ(y) + g1KinkWidth()" instead of following g1FrontZ
        // directly - that keeps the strip exactly as thick below the kink as
        // it is right at it, continuous with the formula-based side at
        // y=0.95 (maskNose below uses these same two methods to stay flush
        // with this edge).
        const kinkWidth = this.g1KinkWidth();
        const F = (y) => {
            const cx = this.g1CreaseX(y);
            if (y < 0.95) return [sign * cx, y, this.g1FlankLowerZ(y) + kinkWidth];
            return [sign * cx, y, this.g1FrontZ(cx, y)];
        };
        const R = (y) => {
            if (y < 0.95) return [sign * 1.45, y, this.g1FlankLowerZ(y)];
            return [sign * 1.45, y, this.g1SideFrontZ(y)];
        };
        for (let i = 0; i < rows.length - 1; i++) {
            const f0 = F(rows[i]), f1 = F(rows[i + 1]);
            const r0 = R(rows[i]), r1 = R(rows[i + 1]);
            if (sign > 0) pos.push(...f0, ...r0, ...f1, ...r0, ...r1, ...f1);
            else pos.push(...f0, ...f1, ...r0, ...r0, ...f1, ...r1);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        return geo;
    }

    // Appends a closed polygon with rounded corners to a THREE.Path/Shape
    traceRoundedPoly(path, pts, r) {
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const [px, py] = pts[(i + n - 1) % n];
            const [cx, cy] = pts[i];
            const [qx, qy] = pts[(i + 1) % n];
            let dinX = cx - px, dinY = cy - py;
            let dl = Math.hypot(dinX, dinY) || 1; dinX /= dl; dinY /= dl;
            let doutX = qx - cx, doutY = qy - cy;
            dl = Math.hypot(doutX, doutY) || 1; doutX /= dl; doutY /= dl;
            const inX = cx - dinX * r, inY = cy - dinY * r;
            const outX = cx + doutX * r, outY = cy + doutY * r;
            if (i === 0) path.moveTo(inX, inY); else path.lineTo(inX, inY);
            path.quadraticCurveTo(cx, cy, outX, outY);
        }
        path.closePath();
        return path;
    }

    // Thin extruded plate standing in a body side wall, built from (z, y) points.
    // sign: -1 left / +1 right; xBase: inner face |x|;
    // opts: { round, hole, holeR, holes: [{ pts, r }] }
    createG1SidePlateGeometry(pts, sign, depth, xBase, opts = {}) {
        const mapped = pts.map(([z, y]) => [-sign * z, y]);
        if (sign < 0) mapped.reverse();
        const shape = new THREE.Shape();
        if (opts.round) {
            this.traceRoundedPoly(shape, mapped, opts.round);
        } else {
            shape.moveTo(mapped[0][0], mapped[0][1]);
            for (let i = 1; i < mapped.length; i++) shape.lineTo(mapped[i][0], mapped[i][1]);
            shape.closePath();
        }
        const holes = opts.holes || (opts.hole ? [{ pts: opts.hole, r: opts.holeR }] : []);
        for (const hole of holes) {
            const mh = hole.pts.map(([z, y]) => [-sign * z, y]);
            if (sign < 0) mh.reverse();
            shape.holes.push(this.traceRoundedPoly(new THREE.Path(), mh, hole.r || 0.05));
        }
        const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
        geom.rotateY(sign < 0 ? -Math.PI / 2 : Math.PI / 2);
        geom.translate(sign * xBase, 0, 0);
        return geom;
    }

    // G1 transverse (X-axis) entry-area ceiling lamp: a single solid bar swept
    // along the mathematical parabola z(x) = dir*bow*(x/halfWidth)^2 (vertex
    // at x=0, both ends bowing toward +dir as they reach the car's side
    // walls). Built as one continuous ring-swept box (same top/bottom/side/
    // end-cap technique as StationModel.buildSweptBar) instead of chained
    // straight segments, so it reads as a single cast piece with no facet
    // seams - the ring normal at each sample is the true curve normal
    // (perpendicular to the analytic tangent dz/dx), not a per-segment secant
    // approximation.
    createG1CurvedTransverseLampGeometry(dir, halfWidth, bow, thickness = 0.15, height = 0.02, segments = 24) {
        const hw = thickness / 2, hh = height / 2;
        const rings = [];
        for (let r = 0; r <= segments; r++) {
            const x = -halfWidth + (2 * halfWidth) * r / segments;
            const z = dir * bow * (x / halfWidth) ** 2;
            const slope = dir * bow * 2 * x / (halfWidth * halfWidth); // dz/dx
            const tlen = Math.hypot(1, slope);
            const nX = -slope / tlen, nZ = 1 / tlen; // in-plane normal, perpendicular to the tangent
            const mk = (lat, y) => new THREE.Vector3(x + nX * lat, y, z + nZ * lat);
            rings.push({ bl: mk(-hw, -hh), br: mk(hw, -hh), tr: mk(hw, hh), tl: mk(-hw, hh) });
        }
        const pos = [];
        const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        const quad = (p0, p1, p2, p3) => { tri(p0, p1, p2); tri(p0, p2, p3); };
        for (let r = 0; r < segments; r++) {
            const A = rings[r], B = rings[r + 1];
            quad(A.tl, A.tr, B.tr, B.tl); // top
            quad(A.br, A.bl, B.bl, B.br); // bottom
            quad(A.bl, A.tl, B.tl, B.bl); // -lat side
            quad(A.tr, A.br, B.br, B.tr); // +lat side
        }
        const c0 = rings[0], cN = rings[segments];
        quad(c0.bl, c0.br, c0.tr, c0.tl); // start cap
        quad(cN.tl, cN.tr, cN.br, cN.bl); // end cap
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        return g;
    }

    buildG1CurvedTransverseLamp(carGroup, baseZ, dir, halfWidth = 0.6375, bow = 0.20) {
        const lamp = new THREE.Mesh(
            this.createG1CurvedTransverseLampGeometry(dir, halfWidth, bow),
            this.materials.lightGlowWhite
        );
        lamp.position.set(0, 2.80, baseZ);
        carGroup.add(lamp);
    }

    // G1 rounded coving connecting the side wall to the ceiling, running the
    // full car length. Convex quarter-ellipse centered on the sharp wall/
    // ceiling corner (wallX, ceilingY) - it bulges outward into the cabin
    // (like a rounded trim bead applied over the corner) rather than hugging
    // the corner in a recessed cove. Starts flush with the wall at the
    // door-top height and ends flush with the ceiling 60cm in from the wall.
    // An ellipse (not a circle) since the vertical rise (door top to ceiling)
    // and the 60cm horizontal protrusion aren't equal. The color fade is
    // baked into the map (createWallCeilingFilletTexture), sampled via v=t;
    // MeshBasicMaterial is unlit so no normals are needed for shading - only
    // DoubleSide for visibility regardless of winding.
    createG1WallCeilingFilletGeometry(sign, segments = 12) {
        const wallX = 1.40, doorTopY = 2.45, ceilingY = 2.846, protrusion = 0.60;
        const rx = protrusion, ry = ceilingY - doorTopY;
        const pos = [], uv = [], idx = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const a = t * Math.PI / 2;
            const x = sign * (wallX - rx * Math.sin(a));
            const y = ceilingY - ry * Math.cos(a);
            for (const z of [-0.5, 0.5]) {
                pos.push(x, y, z);
                uv.push(z + 0.5, t);
            }
        }
        for (let i = 0; i < segments; i++) {
            const b = i * 2;
            if (sign > 0) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
            else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setIndex(idx);
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        return g;
    }

    // Vertical quarter-round corner column: outward-facing ruled strip sweeping
    // from the flat front plane (alpha=0) 90 degrees into the body side plane.
    // sign: +1 right / -1 left; x0: flat half width; zFront: front plane z;
    // rc: corner radius; rOff: radial offset for proud trim bands; y0..y1: height band.
    createCornerArcGeometry(sign, x0, zFront, rc, rOff, y0, y1, segments = 7) {
        const r = rc + rOff;
        const cz = zFront - rc;
        const pos = [], norm = [], idx = [];
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI / 2;
            const nx = Math.sin(a), nz = Math.cos(a);
            const X = sign * (x0 + r * nx), Z = cz + r * nz;
            pos.push(X, y0, Z, X, y1, Z);
            norm.push(sign * nx, 0, nz, sign * nx, 0, nz);
        }
        for (let i = 0; i < segments; i++) {
            const b = i * 2;
            if (sign > 0) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
            else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setIndex(idx);
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
        return g;
    }

    // DT1 corner band connecting the front plate to the cab flank. The front
    // face (faceGroup) sits slightly further out than the flank (offset by
    // cabDir * 0.22, see faceZOffset) and is a flat plate - normally vertical,
    // but rotation.x/slantAngle is kept as a parameter in case a slant is ever
    // reintroduced. A rigid corner arc (like createCornerArcGeometry) can only
    // exactly match ONE anchor plane; built naively against the front plate it
    // leaves a gap against the flank (or vice versa).
    //
    // Fix: build every vertex TWICE - once with the exact transform the front
    // plate would receive (faceGroup's position + rotation.x + rotation.y), once
    // with the exact transform the flank receives (flankGroup's position +
    // rotation.y only, no tilt) - then lerp between the two per vertex, blending
    // from 0 (front edge, arc angle 0) to 1 (flank edge, arc angle 90) in lockstep
    // with the sweep angle. Both endpoints are then EXACT matches by
    // construction, guaranteeing a seamless join on both sides. Returned geometry
    // is expressed directly in carGroup-local space (NOT a faceGroup/flankGroup
    // child) since neither group's own transform should be applied a second time
    // on top of this.
    createDT1TwistedCornerGeometry(sign, isFront, cabZ, x0, zFront, rc, rOff, y0, y1, slantAngle, segments = 14) {
        const cabDir = isFront ? 1 : -1;
        const phi = isFront ? -slantAngle : slantAngle;
        const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
        const r = rc + rOff;
        const cz = zFront - rc;
        const faceZOffset = cabZ + cabDir * 0.22; // faceGroup.position.z

        const pos = [], uv = [], idx = [];
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI / 2;
            const t = i / segments; // 0 at the front plate edge, 1 at the flank edge
            const xLocal = x0 + r * Math.sin(a);
            const zLocal = cz + r * Math.cos(a); // local Z within faceGroup's (pre-tilt) frame
            const worldX = cabDir * sign * xLocal; // unaffected by the X-axis tilt

            for (const y of [y0, y1]) {
                // Exact front-plate transform (matches faceGroup's rotation.x + rotation.y).
                // THREE's Euler 'XYZ' order composes rotation.y first, then rotation.x
                // (v' = Rx(phi) * Ry(yaw) * v) - the yaw mirror (cabDir) therefore only
                // touches the zLocal term, never the plain y term.
                const frontY = 0.35 + y * cosPhi - cabDir * zLocal * sinPhi;
                const frontZ = faceZOffset + y * sinPhi + cabDir * zLocal * cosPhi;

                // Exact flank transform (vertical, only the yaw mirror applies)
                const sideY = 0.35 + y;
                const sideZ = cabZ;

                pos.push(worldX, frontY * (1 - t) + sideY * t, frontZ * (1 - t) + sideZ * t);
                // Planar UV along the sweep (u) and the height band (v); without this,
                // textured materials (e.g. dt1Wall's wood grain on the interior lining
                // corner pieces) have no UVs to sample and render garbled/overlapping.
                uv.push(t, (y - y0) / (y1 - y0));
            }
        }
        for (let i = 0; i < segments; i++) {
            const b = i * 2;
            if (sign > 0) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
            else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setIndex(idx);
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        return g;
    }

    // Lazily builds the cached G1 front/cab geometries (shared by both cab ends).
    // Local space: origin at the cab end on the carriage floor line, +Y up,
    // +Z pointing outwards. The nose profile, windshield rake and the slight
    // horizontal convexity are baked in via shearG1FrontGeometry.
    createG1FrontGeometries() {
        if (this.geometries.g1MaskNose && this.geometries.g1PillarTrimL) return;
        const G = this.geometries;

        // --- Gloss-black mask, recessed 6mm, reaching from just above the skirt
        // to the roof line. Built as stacked panels whose seams sit exactly on
        // the profile kink (y 0.95) and the roof-arc start (y 2.48): earcut only
        // samples boundary vertices, so kinks inside a panel would be flattened.
        // (a) nose slice below the kink - full width, uniform (no red corners
        // showing past it) and, at x=1.23, matching the width the mask panel
        // above uses for most of its own height (it's only 1.25 briefly right
        // at the seam, y 0.95-1.42) - it used to be 1.25 throughout, which
        // read as visibly wider/boxier than the mask panel above it. Bottom
        // edge extended down to y=0.40 (the flank's own bottom edge, matching
        // where the red side stripe also starts) - this used to stop at 0.60,
        // with a separate flat red strip (fasciaU) filling y 0.40-0.60 below
        // it, but that read as a stray red crossbar under the black mask;
        // removed in favor of just letting the mask itself reach down that
        // far instead. Sheared using the bevel's own g1FlankLowerZ(y) +
        // g1KinkWidth() curve (not the plain g1FrontZ profile) so this panel's
        // edge stays flush with the bevel's inner edge the whole way down -
        // g1FrontZ diverges from that below the kink (it's tuned for the
        // mask/windshield curve above, not this lower band), which used to
        // leave a gap between the two.
        const maskNose = new THREE.Shape();
        maskNose.moveTo(-1.23, 0.40);
        maskNose.lineTo(1.23, 0.40);
        maskNose.lineTo(1.23, 0.95);
        maskNose.lineTo(-1.23, 0.95);
        maskNose.closePath();
        let geom = new THREE.ExtrudeGeometry(maskNose, { depth: 0.06, bevelEnabled: false, curveSegments: 10 });
        geom.translate(0, 0, -0.06);
        const kinkWidth = this.g1KinkWidth();
        G.g1MaskNose = this.shearG1FrontGeometry(geom, -0.006, null, (x, y) => this.g1FlankLowerZ(y) + kinkWidth);

        // (b) main panel with the sharp-cornered windshield cutout (>= 5cm
        // inside the outline everywhere - earcut drops touching holes). Lower
        // corners (y 0.95, 1.42) at 1.23, matching the rest of this panel's
        // own width (used from y=1.56 all the way to the roof) instead of the
        // wider 1.25 they used to sit at, which - together with maskNose right
        // below using the same 1.25 - made the whole lower half of the front
        // read as visibly wider than the section around the windshield. The
        // bevel's own front crease (g1CreaseX) still resolves to 1.25 at this
        // height, so there is a hairline gap against this panel's edge here
        // too, same trade-off as maskNose.
        const mask = new THREE.Shape();
        mask.moveTo(-1.23, 0.95);
        mask.lineTo(1.23, 0.95);
        mask.lineTo(1.23, 1.42);
        mask.lineTo(1.23, 1.56);
        mask.lineTo(1.23, 2.62);
        mask.lineTo(0.60, 2.62);
        mask.lineTo(0, 2.62);
        mask.lineTo(-0.60, 2.62);
        mask.lineTo(-1.23, 2.62);
        mask.lineTo(-1.23, 1.56);
        mask.lineTo(-1.23, 1.42);
        mask.closePath();
        const wsHole = new THREE.Path();
        wsHole.moveTo(-1.15, 1.42);
        wsHole.lineTo(1.15, 1.42);
        wsHole.lineTo(1.18, 1.56);
        wsHole.lineTo(1.18, 2.57);
        wsHole.lineTo(-1.18, 2.57);
        wsHole.lineTo(-1.18, 1.56);
        wsHole.closePath();
        mask.holes.push(wsHole);
        geom = new THREE.ExtrudeGeometry(mask, { depth: 0.06, bevelEnabled: false, curveSegments: 10 });
        geom.translate(0, 0, -0.06);
        G.g1Mask = this.shearG1FrontGeometry(geom, -0.006);

        // (c) display band and (d) top slice over the roof arc (split at 2.68
        // to keep the arc chords close to the true curve)
        const maskBand = new THREE.Shape();
        maskBand.moveTo(-1.23, 2.62);
        maskBand.lineTo(-0.60, 2.62);
        maskBand.lineTo(0, 2.62);
        maskBand.lineTo(0.60, 2.62);
        maskBand.lineTo(1.23, 2.62);
        maskBand.lineTo(1.23, 2.85);
        maskBand.lineTo(0.60, 2.85);
        maskBand.lineTo(0, 2.85);
        maskBand.lineTo(-0.60, 2.85);
        maskBand.lineTo(-1.23, 2.85);
        maskBand.closePath();
        geom = new THREE.ExtrudeGeometry(maskBand, { depth: 0.06, bevelEnabled: false, curveSegments: 10 });
        geom.translate(0, 0, -0.06);
        G.g1MaskBand = this.shearG1FrontGeometry(geom, -0.006);

        const maskTop = new THREE.Shape();
        maskTop.moveTo(-1.23, 2.85);
        maskTop.lineTo(-0.60, 2.85);
        maskTop.lineTo(0, 2.85);
        maskTop.lineTo(0.60, 2.85);
        maskTop.lineTo(1.23, 2.85);
        maskTop.lineTo(1.23, 2.90);
        maskTop.lineTo(0.60, 2.90);
        maskTop.lineTo(0, 2.90);
        maskTop.lineTo(-0.60, 2.90);
        maskTop.lineTo(-1.23, 2.90);
        maskTop.closePath();
        geom = new THREE.ExtrudeGeometry(maskTop, { depth: 0.06, bevelEnabled: false, curveSegments: 10 });
        geom.translate(0, 0, -0.06);
        G.g1MaskTop = this.shearG1FrontGeometry(geom, -0.006);

        // --- Windshield glass: sharp rectangle, 3cm larger than the cutout
        // (rim hides in the mask), sitting nearly flush in the front surface
        const wsGlass = new THREE.Shape();
        wsGlass.moveTo(-1.21, 1.38);
        wsGlass.lineTo(1.21, 1.38);
        wsGlass.lineTo(1.21, 2.61);
        wsGlass.lineTo(-1.21, 2.61);
        wsGlass.closePath();
        geom = new THREE.ExtrudeGeometry(wsGlass, { depth: 0.015, bevelEnabled: false, curveSegments: 10 });
        geom.translate(0, 0, -0.015);
        G.g1Windshield = this.shearG1FrontGeometry(geom, -0.010);

        // --- Destination display, slightly proud on the band above the windshield.
        // 2420mm wide (matching the windshield width); Y unchanged since 2.735 already
        // sits at the bottom of the display band, just above the windshield's own
        // top edge (2.61).
        geom = new THREE.PlaneGeometry(2.42, 0.23, 8, 2);
        geom.translate(0, 2.735, 0);
        G.g1DestPlane = this.shearG1FrontGeometry(geom, -0.002);

        // --- Red side bevels
        G.g1BevelL = this.createG1BevelGeometry(-1);
        G.g1BevelR = this.createG1BevelGeometry(1);

        // --- Skirt block: vertical prism with hard chamfered corners (plan shape,
        // shape.y = -z), extruded upwards from y 0.13 to 0.65 (sitting low so the
        // black nose kink has room above it). The rear corners stay 4mm inboard
        // of the body side so no coplanar faces fight. Rear corners' depth
        // pulled from z=-0.34 to z=-0.15 (shape.y 0.34 -> 0.15): the cockpit's
        // interior back wall sits at z=-0.20 (see backWall in buildCockpit),
        // and this block's Y range (0.13-0.65) overlaps the wall's own
        // (0.40-1.35), so the old, deeper rear corners poked through it into
        // the cockpit. 0.05m of clearance keeps it in front of the wall.
        const skirt = new THREE.Shape();
        skirt.moveTo(-1.446, 0.15);
        skirt.lineTo(-1.446, 0.12);
        skirt.lineTo(-1.38, 0.06);
        skirt.lineTo(-0.80, -0.30);
        skirt.lineTo(0.80, -0.30);
        skirt.lineTo(1.38, 0.06);
        skirt.lineTo(1.446, 0.12);
        skirt.lineTo(1.446, 0.15);
        skirt.closePath();
        geom = new THREE.ExtrudeGeometry(skirt, { depth: 0.52, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, 0.13, 0);
        G.g1Skirt = geom;

        // --- Interior A-pillar trim strips: ruled surfaces from the windshield
        // side edge back to the cab side window front edge (DoubleSide material,
        // so winding does not matter)
        const pillarRows = [1.30, 1.70, 2.10, 2.45, 2.88];
        const buildPillarTrim = (sign) => {
            const pos = [];
            const F = (y) => [sign * 1.21, y, this.g1FrontZ(1.21, y) - 0.06];
            const R = (y) => [sign * 1.385, y, this.g1SideFrontZ(y) - 0.02];
            for (let i = 0; i < pillarRows.length - 1; i++) {
                const f0 = F(pillarRows[i]), f1 = F(pillarRows[i + 1]);
                const r0 = R(pillarRows[i]), r1 = R(pillarRows[i + 1]);
                pos.push(...f0, ...r0, ...f1, ...r0, ...r1, ...f1);
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.computeVertexNormals();
            return g;
        };
        G.g1PillarTrimL = buildPillarTrim(-1);
        G.g1PillarTrimR = buildPillarTrim(1);

        // --- Cab roof cap: plan shape following the brow arc and the bevel sweep
        const cap = new THREE.Shape();
        cap.moveTo(-1.45, 1.90);
        cap.lineTo(-1.45, 0.32);
        cap.lineTo(-1.23, 0.117);
        cap.lineTo(-0.60, 0.0813);
        cap.lineTo(0, 0.07);
        cap.lineTo(0.60, 0.0813);
        cap.lineTo(1.23, 0.117);
        cap.lineTo(1.45, 0.32);
        cap.lineTo(1.45, 1.90);
        cap.closePath();
        geom = new THREE.ExtrudeGeometry(cap, { depth: 0.05, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, 2.851, 0);
        G.g1CabRoofCap = geom;

        // --- Cab flank panels (gloss black) with the trapezoid driver window and
        // the driver-door cutout; front edge hugs the bevel rear edge, rear edge
        // meets the body window band flush at z = -1.90 so the gloss-black band
        // runs continuously from the A-pillar into the passenger area. Bottom-
        // front corner moved from (0.085, 0.40) to (0.033, 0.40) to match
        // redStripePts' own bottom corner exactly - the flank used to poke out
        // past the red stripe there (which now recedes along a straight,
        // steeper incline), showing as a small black triangle at that edge.
        const flankPts = [
            [0.033, 0.40], [0.085, 0.57], [0.211, 0.95], [0.11, 1.42], [0.085, 1.60],
            [-0.047, 2.48], [-0.117, 2.65], [-0.183, 2.75], [-0.268, 2.85],
            [-1.90, 2.85], [-1.90, 0.40]
        ];
        // Front edge (bottom-front -> top-front) is raked at the same angle as
        // the front plate's own windshield slant (g1FrontProfileSlope is a
        // constant -0.26/1.53 across this whole Y range, 0.95 < y <= 2.48). The
        // rear edge is a true vertical (90 degrees to the horizontal top/bottom
        // edges, held at the bottom-rear Z) instead of its own independent rake.
        // The whole window is then pushed forward so its front edge sits a flat
        // 5cm behind the flank's own leading edge - g1SideFrontZ(y) is the same
        // curve flankPts's front boundary was sampled from ("the end of the side
        // plate") - instead of the much larger ad-hoc gap it had before.
        const winFrontSlope = this.g1FrontProfileSlope(1.8);

        const winBottomY = 1.46, winTopY = 2.28;
        const winOrigBottomZ = -0.08, winOrigRearZ = -0.88;
        const winShift = (this.g1SideFrontZ(winBottomY) - 0.05) - winOrigBottomZ;
        const winBottomZ = winOrigBottomZ + winShift;
        const winRearZ = winOrigRearZ + winShift;
        const winTopFrontZ = winOrigBottomZ + winFrontSlope * (winTopY - winBottomY) + winShift;
        const winPts = [[winBottomZ, winBottomY], [winRearZ, winBottomY], [winRearZ, winTopY], [winTopFrontZ, winTopY]];
        // Real driver door width = 700mm (z -1.11 to -1.81), height increased to 2.55
        const doorHolePts = [[-1.11, 0.60], [-1.81, 0.60], [-1.81, 2.55], [-1.11, 2.55]];
        const flankHoles = [{ pts: winPts, r: 0.06 }, { pts: doorHolePts, r: 0.04 }];
        G.g1CabSideL = this.createG1SidePlateGeometry(flankPts, -1, 0.05, 1.40, { holes: flankHoles });
        G.g1CabSideR = this.createG1SidePlateGeometry(flankPts, 1, 0.05, 1.40, { holes: flankHoles });

        const glassBottomY = 1.41, glassTopY = 2.33;
        const glassOrigRearZ = -0.93;
        const glassShift = (this.g1SideFrontZ(glassBottomY) - 0.05) - (-0.03);
        const glassRearZ = glassOrigRearZ + glassShift;
        // The front boundary used to sample g1SideFrontZ independently at the
        // glass's own (lower) bottom Y, instead of following the window
        // hole's own raked line (winBottomZ/winFrontSlope). That put the
        // glass pane's bottom-front corner a few mm PAST the hole's own front
        // edge - poking into the solid flank material there instead of
        // staying recessed behind it - which z-fought with the frame right
        // at that corner. Anchor it to the hole's own line instead, pulled
        // back by a small uniform recess, so it stays behind the cutout
        // along the whole rake (top corner inherits the same recess via the
        // shared slope term, same as before).
        const glassRecess = 0.02;
        const glassBottomZ = winBottomZ + winFrontSlope * (winBottomY - glassBottomY) - glassRecess;
        const glassTopFrontZ = glassBottomZ + winFrontSlope * (glassTopY - glassBottomY);
        const winGlassPts = [[glassBottomZ, glassBottomY], [glassRearZ, glassBottomY], [glassRearZ, glassTopY], [glassTopFrontZ, glassTopY]];
        G.g1CabGlassL = this.createG1SidePlateGeometry(winGlassPts, -1, 0.02, 1.405, { round: 0.09 });
        G.g1CabGlassR = this.createG1SidePlateGeometry(winGlassPts, 1, 0.02, 1.405, { round: 0.09 });

        // --- Red livery on the cab flank (per reference photo): the body's red
        // bottom stripe (y 0.40-0.60) continues forward to the nose bevel, and a
        // red wedge fills the white-band zone between the cab door and the white
        // band's diagonal front edge (45 degrees, top corner at the door's rear
        // edge, running down-rearwards past the body joint at z = -1.90).
        // band's diagonal front edge.
        const redStripePts = [[0.033, 0.599], [0.033, 0.40], [-1.90, 0.40], [-1.90, 0.599]];
        G.g1CabRedStripeL = this.createG1SidePlateGeometry(redStripePts, -1, 0.052, 1.402);
        G.g1CabRedStripeR = this.createG1SidePlateGeometry(redStripePts, 1, 0.052, 1.402);

        // Skirt stripe under the red stripe on the cab: Y = 0.00 to 0.40 (color #53565f)
        const skirtStripePts = [[0.033, 0.40], [-0.10, 0.00], [-1.90, 0.00], [-1.90, 0.40]];
        G.g1CabSkirtStripeL = this.createG1SidePlateGeometry(skirtStripePts, -1, 0.052, 1.402);
        G.g1CabSkirtStripeR = this.createG1SidePlateGeometry(skirtStripePts, 1, 0.052, 1.402);

        // White band segment behind the door (horizontal, Y = 0.60 to 1.20)
        const whiteRearPts = [[-1.90, 1.20], [-1.81, 1.20], [-1.81, 0.60], [-1.90, 0.60]];
        G.g1CabWhiteRearL = this.createG1SidePlateGeometry(whiteRearPts, -1, 0.052, 1.402);
        G.g1CabWhiteRearR = this.createG1SidePlateGeometry(whiteRearPts, 1, 0.052, 1.402);

        // Red triangle in front of the door (slanted, Y = 0.60 to 1.20, z from -1.11 to -0.51)
        const redWedgePts = [[-1.11, 1.20], [-0.51, 0.60], [-0.51, 1.20]];
        G.g1CabRedWedgeL = this.createG1SidePlateGeometry(redWedgePts, -1, 0.052, 1.402);
        G.g1CabRedWedgeR = this.createG1SidePlateGeometry(redWedgePts, 1, 0.052, 1.402);

        // White triangle in front of the door (slanted, Y = 0.60 to 1.20, z from -1.11 to -0.51)
        const whiteTriPts = [[-1.11, 0.60], [-0.51, 0.60], [-1.11, 1.20]];
        G.g1CabWhiteTriL = this.createG1SidePlateGeometry(whiteTriPts, -1, 0.052, 1.402);
        G.g1CabWhiteTriR = this.createG1SidePlateGeometry(whiteTriPts, 1, 0.052, 1.402);

        // --- Red roof-edge strip across the cab flank (continues the side stripe)
        const stripPts = [[-0.076, 2.55], [-0.117, 2.65], [-0.183, 2.75], [-0.268, 2.85], [-1.90, 2.85], [-1.90, 2.55]];
        G.g1CabTopStripL = this.createG1SidePlateGeometry(stripPts, -1, 0.052, 1.402);
        G.g1CabTopStripR = this.createG1SidePlateGeometry(stripPts, 1, 0.052, 1.402);
    }

    // Lazily builds the cached DT1 front geometries (shared by all four cab ends).
    // Flat center plate + rounded corner columns; the white accent band wraps
    // around the corners via radially offset arc strips.
    createDT1FrontGeometries() {
        if (this.geometries.dt1FacePlate) return;
        // faceH = 2.425 puts the plate's top edge at world Y 2.775 (0.35 pivot +
        // 2.425), flush with the cab roof's underside (cabRoof at Y 2.815, height
        // 0.08 -> underside 2.775) - matches the corner band's own roofline stop
        // (see the 2.425 upper bound on the fourth cornerBands entry).
        const flatHalf = 1.25, faceH = 2.425, zFront = 0.12, rc = 0.192;

        // Three-pane windshield: top edge sits 560mm below the roof line (roof
        // top at global Y 2.855, faceGroup pivot at global Y 0.35 -> local 1.945).
        // Middle pane: 1585 x 985mm. The two outer panes share its height, start
        // flush against it (thin pillar between) and continue flat to the corner
        // radius, then wrap 90 degrees around the rounded corner into the side.
        const paneH = 0.985;
        const paneTopY = 1.945;
        const paneY = paneTopY - paneH;
        const midHalfW = 1.585 / 2;
        const pillarW = 0.05;
        const sideFlatX0 = midHalfW + pillarW;
        const sideFlatX1 = flatHalf;

        // The windshield cutout spans the full flat width (no pillars between
        // the former middle/outer panes), reaching all the way to the plate's
        // left/right edges. Since the cutout is open to both side edges it is
        // not an interior hole (THREE.Shape holes must stay clear of the outer
        // contour, see the earcut-hole-clearance note) - instead the plate is
        // built as two separate slabs, below and above the window band.
        // Plate thickness matches the side wall panels (0.04, see bottomRail/topRail
        // etc. in buildDT1Cockpit's buildBandStack) instead of the much thicker
        // 0.18 it used before; front face position (zFront) is unchanged, only the
        // back face moves forward.
        const plateThickness = 0.04;
        const extrudeOpts = { depth: plateThickness, bevelEnabled: false, curveSegments: 8 };
        const bottomShape = new THREE.Shape();
        bottomShape.moveTo(-flatHalf, 0);
        bottomShape.lineTo(flatHalf, 0);
        bottomShape.lineTo(flatHalf, paneY);
        bottomShape.lineTo(-flatHalf, paneY);
        const topShape = new THREE.Shape();
        topShape.moveTo(-flatHalf, paneY + paneH);
        topShape.lineTo(flatHalf, paneY + paneH);
        topShape.lineTo(flatHalf, faceH);
        topShape.lineTo(-flatHalf, faceH);
        const bottomGeom = new THREE.ExtrudeGeometry(bottomShape, extrudeOpts);
        bottomGeom.translate(0, 0, zFront - plateThickness);
        const topGeom = new THREE.ExtrudeGeometry(topShape, extrudeOpts);
        topGeom.translate(0, 0, zFront - plateThickness);
        this.geometries.dt1FacePlate = [bottomGeom, topGeom];

        // Opaque body corner bands (red skirt + white stripe) are NOT cached here:
        // unlike the flat plate/glass (which ride on faceGroup's rigid rotation
        // and are shared between both cab ends via that group's mirroring), the
        // corner must twist from the slanted front plate to the vertical flank -
        // a per-vertex blend that depends on isFront/cabDir. See
        // createDT1TwistedCornerGeometry, built directly in buildDT1CabEnd.
        this.geometries.dt1FlatHalf = flatHalf;
        this.geometries.dt1ZFront = zFront;
        this.geometries.dt1Rc = rc;

        // The curved windshield glass wrapping the rounded corner is NOT cached
        // here either, for the same reason as the corner bands above: it must
        // connect the front pane to the flank's own window opening, which is a
        // per-cab-end twisted blend (createDT1TwistedCornerGeometry), not a rigid
        // shape shared via faceGroup's mirroring.

        // Glass pane oversized only top/bottom, where the rim genuinely hides
        // behind solid plate (bottomShape/topShape extend past paneY/paneY+paneH
        // there). NOT oversized left/right: beyond x = ±flatHalf there is no
        // plate anymore, only the corner glass starting immediately at that same
        // edge - any horizontal overhang there would float past the plate into
        // the corner glass's own area, doubling up two transparent layers (which
        // reads as visibly more opaque) instead of sitting flush against it. No
        // rounding either, so this edge butts the corner glass's straight start
        // edge exactly instead of curving away from it.
        this.geometries.dt1WindshieldPane = new THREE.BoxGeometry(sideFlatX1 * 2, paneH + 0.08, 0.02);

        this.geometries.dt1PaneY = paneY;
        this.geometries.dt1PaneH = paneH;
        this.geometries.dt1MidHalfW = midHalfW;
        this.geometries.dt1SideFlatX0 = sideFlatX0;
        this.geometries.dt1SideFlatX1 = sideFlatX1;
    }

    // Text decal (canvas texture) for car numbers and lettering, cached per text/color
    getDecalMaterial(text, color = '#f2f2f2', wide = false) {
        if (!this._decalMats) this._decalMats = {};
        const key = text + '|' + color;
        if (this._decalMats[key]) return this._decalMats[key];
        const canvas = document.createElement('canvas');
        canvas.width = wide ? 256 : 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = color;
        ctx.font = wide ? 'bold 34px sans-serif' : 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, 32);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', transparent: true, fog: false });
        this._decalMats[key] = mat;
        return mat;
    }

    createRoundedBoxGeometry(width, height, depth, radius) {
        const shape = new THREE.Shape();
        const x = -width / 2;
        const y = -height / 2;
        shape.moveTo(x + radius, y);
        shape.lineTo(x + width - radius, y);
        shape.quadraticCurveTo(x + width, y, x + width, y + radius);
        shape.lineTo(x + width, y + height - radius);
        shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        shape.lineTo(x + radius, y + height);
        shape.quadraticCurveTo(x, y + height, x, y + height - radius);
        shape.lineTo(x, y + radius);
        shape.quadraticCurveTo(x, y, x + radius, y);

        const extrudeSettings = {
            depth: depth,
            bevelEnabled: false
        };
        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geom.center(); // Center the geometry around (0,0,0)
        return geom;
    }

    // DT1 roof/ceiling-lining plan shape: a flat horizontal cap, full width at
    // the rear (butting the partition, square corners), with the FRONT two
    // corners tracing the SAME Z-path the actually-rendered corner takes at the
    // roofline (createDT1TwistedCornerGeometry's top edge), not a plain circular
    // arc. The twisted corner isn't a rigid arc: with the front plate at
    // faceOffset (cabDir*0.22) further out than the flank, its Z trace at a
    // given arc angle a (t = a / (pi/2)) is
    //   Z(a) = (1 - t) * (faceOffset + zFront - rc + rc*cos(a))
    // which lerps from the front plate's edge (a=0, t=0: Z = faceOffset+zFront)
    // down to the flank's own front edge (a=90, t=1: Z=0).
    // X is NOT taken straight from that same corner radius (flatHalf + rc):
    // that traces the twisted corner BAND's own outer skin, which sits ~3cm
    // further out than the carbody's actual roof half-width (the dt1Roof/
    // dt1Ceiling box geometries the wagon roof uses), so a cab roof built on
    // flatHalf+rc alone oversticks past the wagon roof at their shared seam
    // instead of sitting flush with it. Instead X blends from flatHalf (nose
    // tip, a=0) to the caller-supplied flankHalf (a=90, matching the actual
    // wagon roof/ceiling half-width) using the same sin(a) sweep, so the flank
    // portion (z=0 back to zRear, i.e. the whole cab roof length) sits at
    // exactly flankHalf - flush with the wagon roof it butts up against.
    createDT1RoofGeometry(flatHalf, rc, faceOffset, zFront, zRear, thickness, flankHalf, segments = 12) {
        const halfWidth = flankHalf;
        const cz = zFront - rc;
        const dx = flankHalf - flatHalf;

        const shape = new THREE.Shape();
        shape.moveTo(-halfWidth, zRear);
        shape.lineTo(halfWidth, zRear);
        shape.lineTo(halfWidth, 0); // a = 90deg (matches the flank's own front edge, z=0)

        // Right corner: from a=90 (flank edge) down to a=0 (front plate tip)
        for (let i = 1; i <= segments; i++) {
            const a = (Math.PI / 2) * (1 - i / segments);
            const t = a / (Math.PI / 2);
            const x = flatHalf + dx * Math.sin(a);
            const z = (1 - t) * (faceOffset + cz + rc * Math.cos(a));
            shape.lineTo(x, z);
        }

        shape.lineTo(-flatHalf, faceOffset + zFront); // flat front edge, matching the plate's own flat width

        // Left corner: mirrored, from a=0 (front tip) back up to a=90 (flank edge)
        for (let i = 1; i <= segments; i++) {
            const a = (Math.PI / 2) * (i / segments);
            const t = a / (Math.PI / 2);
            const x = flatHalf + dx * Math.sin(a);
            const z = (1 - t) * (faceOffset + cz + rc * Math.cos(a));
            shape.lineTo(-x, z);
        }

        shape.lineTo(-halfWidth, zRear);
        shape.closePath();

        const geom = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8 });
        geom.rotateX(Math.PI / 2); // (x, y, z) -> (x, -z, y): extrude depth becomes height, shape's Z becomes world Z
        geom.translate(0, thickness / 2, 0); // re-center the height range around 0, matching a centered BoxGeometry
        return geom;
    }

    createRoundedFrameGeometry(width, height, depth, radius, frameWidth) {
        const shape = new THREE.Shape();
        const x = -width / 2;
        const y = -height / 2;
        // Outer boundary
        shape.moveTo(x + radius, y);
        shape.lineTo(x + width - radius, y);
        shape.quadraticCurveTo(x + width, y, x + width, y + radius);
        shape.lineTo(x + width, y + height - radius);
        shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        shape.lineTo(x + radius, y + height);
        shape.quadraticCurveTo(x, y + height, x, y + height - radius);
        shape.lineTo(x, y + radius);
        shape.quadraticCurveTo(x, y, x + radius, y);

        // Inner hole
        const hole = new THREE.Path();
        const hx = -width / 2 + frameWidth;
        const hy = -height / 2 + frameWidth;
        const hw = width - 2 * frameWidth;
        const hh = height - 2 * frameWidth;
        const hr = Math.max(0.001, radius - frameWidth);
        
        hole.moveTo(hx + hr, hy);
        hole.lineTo(hx + hw - hr, hy);
        hole.quadraticCurveTo(hx + hw, hy, hx + hw, hy + hr);
        hole.lineTo(hx + hw, hy + hh - hr);
        hole.quadraticCurveTo(hx + hw, hy + hh, hx + hw - hr, hy + hh);
        hole.lineTo(hx + hr, hy + hh);
        hole.quadraticCurveTo(hx, hy + hh, hx, hy + hh - hr);
        hole.lineTo(hx, hy + hr);
        hole.quadraticCurveTo(hx, hy, hx + hr, hy);
        
        shape.holes.push(hole);

        const extrudeSettings = {
            depth: depth,
            bevelEnabled: false
        };
        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geom.center();
        return geom;
    }

    buildDT3Train() {
        const S = TRAIN_SCALE;
        const carLength = 19.0425;
        const bellowsLen = G1_BELLOWS_LEN;

        for (let i = 0; i < 2; i++) {
            const { length: _, startOffset: carOffsetZ } = this.getCarriageProperties(i);
            
            const carGroup = new THREE.Group();
            carGroup.position.set(0, 0.465 * S, carOffsetZ);
            carGroup.scale.set(S, S, S);
            this.group.add(carGroup);
            this.carriages.push(carGroup);

            // 1. Floor
            const floorMaterial = this.materials.floorGrey;
            const floorGeom = new THREE.BoxGeometry(2.80, 0.05, carLength);
            this.applyBoxUVs(floorGeom, 2.80, 0.05, carLength, 2.0);
            const floor = new THREE.Mesh(floorGeom, floorMaterial);
            floor.position.set(0, 0.375, -carLength / 2);
            carGroup.add(floor);

            // 2. Ceiling & Roof (Truncated at front ends to not overlap at the fronts)
            const roofLen = 17.8425;
            const roofPosZ = (i === 0) ? -10.12125 : -8.92125;

            const ceilingGeom = new THREE.BoxGeometry(2.80, 0.02, roofLen);
            const ceiling = new THREE.Mesh(ceilingGeom, this.materials.bodyWhite);
            ceiling.position.set(0, 2.84, roofPosZ);
            carGroup.add(ceiling);

            const roofGeom = new THREE.BoxGeometry(2.86, 0.06, roofLen);
            const roof = new THREE.Mesh(roofGeom, this.materials.dt3Red);
            roof.position.set(0, 2.871, roofPosZ);
            carGroup.add(roof);

            // Recessed LED lights
            const lightGeom = new THREE.BoxGeometry(0.1, 0.01, roofLen - 1.0);
            const lightL = new THREE.Mesh(lightGeom, this.materials.lightGlowWhite);
            lightL.position.set(-0.6, 2.83, roofPosZ);
            const lightR = new THREE.Mesh(lightGeom, this.materials.lightGlowWhite);
            lightR.position.set(0.6, 2.83, roofPosZ);
            carGroup.add(lightL, lightR);

            // 3. Side Walls
            const bounds = this.getDT3BodyZBounds(i);
            const doorEdges = this.getDT3DoorEdges(i);
            const intervals = [
                { zMin: doorEdges[0].lead, zMax: bounds.front },
                { zMin: doorEdges[1].lead, zMax: doorEdges[0].trail },
                { zMin: doorEdges[2].lead, zMax: doorEdges[1].trail },
                { zMin: bounds.rear,       zMax: doorEdges[2].trail }
            ];
            const dt3Windows = this.getDT3Windows(i);

            const buildSideWallsForSide = (xSign) => {
                intervals.forEach((interval) => {
                    const z1 = Math.min(interval.zMin, interval.zMax);
                    const z2 = Math.max(interval.zMin, interval.zMax);
                    const zLength = z2 - z1;
                    if (zLength <= 0.001) return;

                    const zCenter = (z1 + z2) / 2;
                    const wallX = xSign * 1.43;
                    const intX = xSign * 1.40;

                    // Bottom grey skirt: Y = 0.0 to 0.40
                    const bottomGrey = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.40, zLength), this.materials.skirtGrey);
                    bottomGrey.position.set(wallX, 0.20, zCenter);
                    carGroup.add(bottomGrey);

                    // Bottom red stripe: Y = 0.40 to 0.625 (height 0.225, centered Y = 0.5125)
                    const bottomRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.225, zLength), this.materials.dt3Red);
                    bottomRed.position.set(wallX, 0.5125, zCenter);
                    carGroup.add(bottomRed);

                    // Lower white wall below windows: Y = 0.625 to 1.335 (height 0.71, centered Y = 0.98)
                    const lowerWhite = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.71, zLength), this.materials.dt3WhiteOuter);
                    lowerWhite.position.set(wallX, 0.98, zCenter);
                    carGroup.add(lowerWhite);

                    // Upper white wall above windows: Y = 2.265 to 2.55 (height 0.285, centered Y = 2.4075)
                    const upperWhite = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.285, zLength), this.materials.dt3WhiteOuter);
                    upperWhite.position.set(wallX, 2.4075, zCenter);
                    carGroup.add(upperWhite);

                    // Top red stripe: Y = 2.55 to 2.85 (height 0.30, centered Y = 2.70)
                    const topRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, zLength), this.materials.dt3Red);
                    topRed.position.set(wallX, 2.70, zCenter);
                    carGroup.add(topRed);

                    // Interior wall linings
                    const intBottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.935, zLength), this.materials.dt3WhiteInner);
                    intBottom.position.set(intX, 0.8675, zCenter);
                    carGroup.add(intBottom);

                    const intTop = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.585, zLength), this.materials.dt3WhiteInner);
                    intTop.position.set(intX, 2.5575, zCenter);
                    carGroup.add(intTop);

                    // Filter windows in this interval
                    const windows = dt3Windows
                        .filter(w => w.start >= z1 - 0.01 && w.end <= z2 + 0.01)
                        .sort((a, b) => a.start - b.start);

                    let pillars = [];
                    let cursor = z1;
                    windows.forEach(w => {
                        if (w.start - cursor > 0.001) pillars.push({ start: cursor, end: w.start });
                        cursor = w.end;
                    });
                    if (z2 - cursor > 0.001) pillars.push({ start: cursor, end: z2 });

                    // Build window glass and bezel
                    windows.forEach(w => {
                        const wWidth = w.end - w.start;
                        const wCenter = (w.start + w.end) / 2;
                        const glassGeom = this.createRoundedBoxGeometry(wWidth, 0.93, 0.02, 0.08);
                        glassGeom.rotateY(Math.PI / 2);
                        const glass = new THREE.Mesh(glassGeom, this.materials.windowGlass);
                        glass.position.set(xSign * 1.435, 1.80, wCenter);
                        carGroup.add(glass);

                        const bezelGeom = this.createRoundedFrameGeometry(wWidth + 0.03, 0.93, 0.025, 0.095, 0.02);
                        bezelGeom.rotateY(Math.PI / 2);
                        const bezel = new THREE.Mesh(bezelGeom, this.materials.bodyGrey);
                        bezel.position.set(wallX, 1.80, wCenter);
                        carGroup.add(bezel);
                    });

                    // Build pillars
                    pillars.forEach(p => {
                        const pWidth = p.end - p.start;
                        const pCenter = (p.start + p.end) / 2;
                        if (pWidth <= 0.001) return;
                        const pillarOuter = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.93, pWidth), this.materials.dt3WhiteOuter);
                        pillarOuter.position.set(wallX, 1.80, pCenter);
                        const pillarInner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.93, pWidth), this.materials.dt3WhiteInner);
                        pillarInner.position.set(intX, 1.80, pCenter);
                        carGroup.add(pillarOuter, pillarInner);
                    });
                });
            };

            buildSideWallsForSide(-1);
            buildSideWallsForSide(1);

            // 4. Doors (Double sliding doors)
            const buildDT3Door = (doorIdx, zCenter) => {
                const doorHeight = 2.15;
                const leafWidth = 0.8725;
                const closedOffset = 0.43625;

                const buildLeaf = (isLeft, xSign) => {
                    const leafGroup = new THREE.Group();
                    const t = 0.01; // half-thickness for each side
                    const xOffsetOuter = xSign * 0.005;
                    const xOffsetInner = -xSign * 0.005;

                    // Window parameters (DT3 pointed window, 10cm gap to edges)
                    const wW = 0.6725;
                    const wH_vert = 0.93;
                    const wP = 0.20; // additional slant depth
                    const wR = 0.06; // top radius
                    const wY_top = 0.79; // Y of window top
                    const wY_bot_outer = -0.14; // Y of outer bottom corner
                    const wY_bot_gap = -0.14 - wP; // Y of gap-side bottom corner

                    const sideW = 0.1; // 10cm gap at edges
                    // Slant down towards Outer Side (away from door gap)
                    const zGap = isLeft ? 0.38625 : -0.38625;
                    const zOuter = isLeft ? -0.38625 : 0.38625;

                    // Outer panels (thickness 0.01, shifted outwards)
                    const panelLOuter = new THREE.Mesh(new THREE.BoxGeometry(t, wH_vert + wP, sideW), this.materials.dt3WhiteOuter);
                    panelLOuter.position.set(xOffsetOuter, (wY_top + wY_bot_gap) / 2, zOuter); // Outer side is longer

                    const panelROuter = new THREE.Mesh(new THREE.BoxGeometry(t, wH_vert, sideW), this.materials.dt3WhiteOuter);
                    panelROuter.position.set(xOffsetOuter, 0.325, zGap); // Gap side is shorter

                    const panelTopOuter = new THREE.Mesh(new THREE.BoxGeometry(t, 0.285, 0.8725), this.materials.dt3WhiteOuter);
                    panelTopOuter.position.set(xOffsetOuter, 0.9325, 0);

                    const panelStripeOuter = new THREE.Mesh(new THREE.BoxGeometry(t, 0.225, 0.8725), this.materials.dt3Red);
                    panelStripeOuter.position.set(xOffsetOuter, -0.9625, 0);

                    // Bottom panel with slanted top cutout
                    const bpShape = new THREE.Shape();
                    const bp_yBot = -0.85;
                    const bp_zOuter = -leafWidth/2;
                    const bp_zGap = leafWidth/2;
                    const bp_winZOuter = -wW/2;
                    const bp_winZGap = wW/2;

                    if (isLeft) {
                        // Slant down towards Outer (-Z)
                        bpShape.moveTo(bp_zOuter, wY_bot_gap);
                        bpShape.lineTo(bp_winZOuter, wY_bot_gap);
                        bpShape.lineTo(bp_winZGap, wY_bot_outer);
                        bpShape.lineTo(bp_zGap, wY_bot_outer);
                        bpShape.lineTo(bp_zGap, bp_yBot);
                        bpShape.lineTo(bp_zOuter, bp_yBot);
                    } else {
                        // Slant down towards Outer (+Z)
                        bpShape.moveTo(bp_zGap, wY_bot_gap);
                        bpShape.lineTo(bp_winZGap, wY_bot_gap);
                        bpShape.lineTo(bp_winZOuter, wY_bot_outer);
                        bpShape.lineTo(bp_zOuter, wY_bot_outer);
                        bpShape.lineTo(bp_zOuter, bp_yBot);
                        bpShape.lineTo(bp_zGap, bp_yBot);
                    }
                    bpShape.closePath();

                    const whiteBottomGeomOuter = new THREE.ExtrudeGeometry(bpShape, { depth: t, bevelEnabled: false });
                    whiteBottomGeomOuter.translate(0, 0, -t/2);
                    whiteBottomGeomOuter.rotateY(Math.PI / 2);
                    const panelBottomOuter = new THREE.Mesh(whiteBottomGeomOuter, this.materials.dt3WhiteOuter);
                    panelBottomOuter.position.set(xOffsetOuter, 0, 0);

                    // Inner panels (thickness 0.01, shifted inwards, using dt3DoorInner)
                    const panelLInner = new THREE.Mesh(new THREE.BoxGeometry(t, wH_vert + wP, sideW), this.materials.dt3DoorInner);
                    panelLInner.position.set(xOffsetInner, (wY_top + wY_bot_gap) / 2, zOuter);

                    const panelRInner = new THREE.Mesh(new THREE.BoxGeometry(t, wH_vert, sideW), this.materials.dt3DoorInner);
                    panelRInner.position.set(xOffsetInner, 0.325, zGap);

                    const panelTopInner = new THREE.Mesh(new THREE.BoxGeometry(t, 0.285, 0.8725), this.materials.dt3DoorInner);
                    panelTopInner.position.set(xOffsetInner, 0.9325, 0);

                    const panelStripeInner = new THREE.Mesh(new THREE.BoxGeometry(t, 0.225, 0.8725), this.materials.dt3DoorInner);
                    panelStripeInner.position.set(xOffsetInner, -0.9625, 0);

                    const panelBottomInner = new THREE.Mesh(whiteBottomGeomOuter, this.materials.dt3DoorInner);
                    panelBottomInner.position.set(xOffsetInner, 0, 0);

                    // Glass (pointed window) - slightly oversized to prevent hairline gaps
                    const gO = 0.01;
                    const glassShape = new THREE.Shape();
                    glassShape.moveTo(-wW/2 - gO + wR, wY_top + gO);
                    glassShape.lineTo(wW/2 + gO - wR, wY_top + gO);
                    glassShape.quadraticCurveTo(wW/2 + gO, wY_top + gO, wW/2 + gO, wY_top + gO - wR);
                    if (isLeft) {
                        glassShape.lineTo(wW/2 + gO, wY_bot_outer - gO);
                        glassShape.lineTo(-wW/2 - gO, wY_bot_gap - gO);
                    } else {
                        glassShape.lineTo(wW/2 + gO, wY_bot_gap - gO);
                        glassShape.lineTo(-wW/2 - gO, wY_bot_outer - gO);
                    }
                    glassShape.lineTo(-wW/2 - gO, wY_top + gO - wR);
                    glassShape.quadraticCurveTo(-wW/2 - gO, wY_top + gO, -wW/2 - gO + wR, wY_top + gO);
                    glassShape.closePath();

                    const glassGeom = new THREE.ExtrudeGeometry(glassShape, { depth: 0.006, bevelEnabled: false });
                    glassGeom.rotateY(Math.PI / 2);
                    const glass = new THREE.Mesh(glassGeom, this.materials.windowGlass);
                    glass.position.set(0, 0, 0);

                    // Bezel (black bezel around window)
                    const bO = 0.035; // increased offset to 3.5cm
                    const bezelShape = new THREE.Shape();
                    // Outer boundary: Rectangular at top corners to safely cover panel corners
                    bezelShape.moveTo(-wW/2 - bO, wY_top + bO);
                    bezelShape.lineTo(wW/2 + bO, wY_top + bO);
                    if (isLeft) {
                        bezelShape.lineTo(wW/2 + bO, wY_bot_outer - bO);
                        bezelShape.lineTo(-wW/2 - bO, wY_bot_gap - bO);
                    } else {
                        bezelShape.lineTo(wW/2 + bO, wY_bot_gap - bO);
                        bezelShape.lineTo(-wW/2 - bO, wY_bot_outer - bO);
                    }
                    bezelShape.closePath();

                    const hole = new THREE.Path();
                    hole.moveTo(-wW/2 + wR, wY_top);
                    hole.lineTo(wW/2 - wR, wY_top);
                    hole.quadraticCurveTo(wW/2, wY_top, wW/2, wY_top - wR);
                    if (isLeft) {
                        hole.lineTo(wW/2, wY_bot_outer);
                        hole.lineTo(-wW/2, wY_bot_gap);
                    } else {
                        hole.lineTo(wW/2, wY_bot_gap);
                        hole.lineTo(-wW/2, wY_bot_outer);
                    }
                    hole.lineTo(-wW/2, wY_top - wR);
                    hole.quadraticCurveTo(-wW/2, wY_top, -wW/2 + wR, wY_top);
                    bezelShape.holes.push(hole);

                    const bD = 0.035; // 3.5cm deep
                    const bezelGeom = new THREE.ExtrudeGeometry(bezelShape, { depth: bD, bevelEnabled: false });
                    bezelGeom.translate(0, 0, -bD/2);
                    bezelGeom.rotateY(Math.PI / 2);
                    const bezel = new THREE.Mesh(bezelGeom, this.materials.bodyGlossBlack);
                    bezel.position.set(0, 0, 0);

                    leafGroup.add(
                        panelLOuter, panelROuter, panelTopOuter, panelStripeOuter, panelBottomOuter,
                        panelLInner, panelRInner, panelTopInner, panelStripeInner, panelBottomInner,
                        glass, bezel
                    );
                    return leafGroup;
                };

                for (const xSign of [-1, 1]) {
                    const doorL = buildLeaf(true, xSign);
                    const doorR = buildLeaf(false, xSign);

                    doorL.position.set(xSign * 1.43, 1.475, zCenter - closedOffset);
                    doorR.position.set(xSign * 1.43, 1.475, zCenter + closedOffset);
                    carGroup.add(doorL, doorR);


                    this.doors.push({
                        meshL: doorL,
                        meshR: doorR,
                        baseZ: zCenter,
                        carIdx: i,
                        side: xSign > 0 ? 'right' : 'left',
                        xClosed: xSign * 1.43,
                        closedOffset: closedOffset
                    });

                    // Add red wall panel above the doors on the exterior to continue the top red stripe
                    const doorTopWall = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 1.745), this.materials.dt3Red);
                    doorTopWall.position.set(xSign * 1.43, 2.70, zCenter);
                    
                    const doorTopWallInt = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.30, 1.745), this.materials.dt3WhiteInner);
                    doorTopWallInt.position.set(xSign * 1.40, 2.70, zCenter);

                    carGroup.add(doorTopWall, doorTopWallInt);
                }
            };

            const doorPositionsZ = (i === 0) ? 
                [-4.3755, -9.9325, -15.4895] : 
                [-3.553, -9.11, -14.667];

            doorPositionsZ.forEach((zCenter, idx) => {
                buildDT3Door(idx, zCenter);
            });

            // 5. Articulation bellows
            if (i === 0) {
                this.buildBellowsHalf(carGroup, -(carLength - bellowsLen), -carLength, 'rear');
            } else if (i === 1) {
                this.buildBellowsHalf(carGroup, -bellowsLen, 0, 'front');
            }

            // 6. Bogies
            this.buildBogie(carGroup, -carLength / 2 + 6.0, (i === 0));
            this.buildBogie(carGroup, -carLength / 2 - 6.0, (i === 1));

            // 7. Interior Benches and Poles
            const buildDT3Benches = () => {
                if (i === 0) {
                    this.buildTransverseSeats(carGroup, -2.4715, 1.6);
                    this.buildTransverseSeats(carGroup, -7.154, 3.2);
                    this.buildTransverseSeats(carGroup, -12.711, 3.2);
                    this.buildTransverseSeats(carGroup, -17.70225, 2.0);
                } else {
                    this.buildTransverseSeats(carGroup, -1.34025, 2.0);
                    this.buildTransverseSeats(carGroup, -6.3315, 3.2);
                    this.buildTransverseSeats(carGroup, -11.8885, 3.2);
                    this.buildTransverseSeats(carGroup, -16.571, 1.6);
                }
            };
            buildDT3Benches();

            // Add vertical poles, sleeves, and room partitions next to doors and center aisle (G1-style, hellgrau)
            const minZ = bounds.rear;
            const maxZ = bounds.front;
            this.buildInteriorPolesAndDividers(carGroup, minZ, maxZ, i);

            // Ceiling grab rails completely removed per user request

            // 8. Nose
            const isFront = (i === 0);
            this.buildDT3Nose(carGroup, isFront, i);
        }
    }

    buildDT3Nose(carGroup, isFront, carIdx) {
        const carLength = 19.0425;
        const noseGroup = new THREE.Group();

        if (isFront) {
            noseGroup.position.set(0, 0, 0);
        } else {
            noseGroup.position.set(0, 0, -carLength);
            noseGroup.rotation.y = Math.PI;
        }
        carGroup.add(noseGroup);

        // 1. Bumper / Skirt
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.35, 0.25), this.materials.bodyGrey);
        bumper.position.set(0, 0.175, 0.05);
        noseGroup.add(bumper);

        // Coupler
        const couplerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8), this.materials.chromeMetal);
        couplerShaft.geometry.rotateX(Math.PI / 2);
        couplerShaft.position.set(0, 0.175, 0.25);
        
        const couplerHead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), this.materials.chromeMetal);
        couplerHead.position.set(0, 0.175, 0.42);
        noseGroup.add(couplerShaft, couplerHead);

        // 2. Lower Red Front Panel (extended upwards to Y = 1.335 to meet the normal-height windshield)
        const thetaLower = -0.197;
        const lowerFront = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.95, 0.05), this.materials.dt3Red);
        lowerFront.position.set(0, 0.8675, -0.09);
        lowerFront.rotation.x = thetaLower;
        noseGroup.add(lowerFront);

        // Headlight capsules (consisting of a 20 cm outer and a 10 cm inner round light, 20 cm below windshield)
        const buildLowerHeadlights = (xSign) => {
            const group = new THREE.Group();
            group.position.set(0, 1.135, -0.1435);
            group.rotation.x = thetaLower;
            
            // Large Headlight (outside) - 10 cm from the outer edge (outer edge is at 1.33)
            const largeX = xSign * 1.23;
            const largeBase = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.015, 16), this.materials.chromeMetal);
            largeBase.geometry.rotateX(Math.PI / 2);
            largeBase.position.set(largeX, 0, 0.0325);
            
            const largeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 16), this.materials.lightGlowWhite);
            largeLens.geometry.rotateX(Math.PI / 2);
            largeLens.position.set(largeX, 0, 0.0425);
            
            // Additive white glow sprite for large headlight
            const largeGlow = new THREE.Sprite(this.materials.glowSpriteWhite.clone());
            largeGlow.scale.set(0.8, 0.8, 1.0);
            largeGlow.position.set(largeX, 0, 0.0525);
            
            group.add(largeBase, largeLens, largeGlow);
            
            // Small Headlight (inside) - next to the large one towards the center, shifted 5 cm lower
            const smallX = xSign * 1.06;
            const smallBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16), this.materials.chromeMetal);
            smallBase.geometry.rotateX(Math.PI / 2);
            smallBase.position.set(smallX, -0.05, 0.0325);
            
            const smallLensWhite = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16), this.materials.lightGlowWhite);
            smallLensWhite.geometry.rotateX(Math.PI / 2);
            smallLensWhite.position.set(smallX, -0.05, 0.0425);
            
            const smallLensRed = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16), this.materials.lightGlowRed);
            smallLensRed.geometry.rotateX(Math.PI / 2);
            smallLensRed.position.set(smallX, -0.05, 0.0425);
            
            // Additive glow sprites for small headlight (white and red)
            const smallGlowWhite = new THREE.Sprite(this.materials.glowSpriteWhite.clone());
            smallGlowWhite.scale.set(0.4, 0.4, 1.0);
            smallGlowWhite.position.set(smallX, -0.05, 0.0525);
            
            const smallGlowRed = new THREE.Sprite(this.materials.glowSpriteRed.clone());
            smallGlowRed.scale.set(0.4, 0.4, 1.0);
            smallGlowRed.position.set(smallX, -0.05, 0.0525);
            
            group.add(smallBase, smallLensWhite, smallLensRed, smallGlowWhite, smallGlowRed);
            noseGroup.add(group);
            
            // Register lights for interactive toggle
            if (isFront) {
                this.lights.frontWhite.push(largeLens, largeGlow, smallLensWhite, smallGlowWhite);
                this.lights.frontRed.push(smallLensRed, smallGlowRed);
            } else {
                this.lights.rearWhite.push(largeLens, largeGlow, smallLensWhite, smallGlowWhite);
                this.lights.rearRed.push(smallLensRed, smallGlowRed);
            }
        };
        buildLowerHeadlights(-1);
        buildLowerHeadlights(1);


        // 3. Windshield (Uses non-reflective windshieldGlass, adjusted to match normal window height)
        const thetaWindshield = -0.205;
        const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.95, 0.02), this.materials.windshieldGlass);
        windshield.position.set(0, 1.80, -0.285);
        windshield.rotation.x = thetaWindshield;
        noseGroup.add(windshield);

        // Black borders around windshield
        const leftBorder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.03), this.materials.bodyGlossBlack);
        leftBorder.position.set(-1.38, 1.80, -0.285);
        leftBorder.rotation.x = thetaWindshield;
        
        const rightBorder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.03), this.materials.bodyGlossBlack);
        rightBorder.position.set(1.38, 1.80, -0.285);
        rightBorder.rotation.x = thetaWindshield;

        const bottomBorder = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.05, 0.03), this.materials.bodyGlossBlack);
        bottomBorder.position.set(0, 1.335, -0.19);

        const topBorder = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.05, 0.034), this.materials.bodyGlossBlack);
        topBorder.position.set(0, 2.265, -0.376);

        noseGroup.add(leftBorder, rightBorder, bottomBorder, topBorder);

        // 4. Top Red Cap (Flat, flush with main roof)
        const topCap = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.06, 0.78), this.materials.dt3Red);
        topCap.position.set(0, 2.871, -0.81);
        topCap.rotation.x = 0;
        
        // Front wall above windshield to fill the vertical gap (extended downwards to y = 2.265)
        const frontWall = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.585, 0.03), this.dt3DestMat);
        frontWall.position.set(0, 2.5575, -0.42);
        
        // Interior lining wall behind the destination display to prevent mirroring on the inside
        const frontWallInt = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.585, 0.01), this.materials.dt3WhiteInner);
        frontWallInt.position.set(0, 2.5575, -0.44);
        
        noseGroup.add(topCap, frontWall, frontWallInt);

        // Upper Square Headlight (10 cm below the upper edge of the destination board)
        const upperBase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), this.materials.chromeMetal);
        upperBase.position.set(0, 2.75, -0.41);
        
        const upperLens = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.01), this.materials.lightGlowWhite);
        upperLens.position.set(0, 2.75, -0.395);
        
        // Additive white glow sprite for upper headlight
        const upperGlow = new THREE.Sprite(this.materials.glowSpriteWhite.clone());
        upperGlow.scale.set(0.5, 0.5, 1.0);
        upperGlow.position.set(0, 2.75, -0.385);
        
        noseGroup.add(upperBase, upperLens, upperGlow);
        
        // Register upper headlight and its glow sprite
        if (isFront) {
            this.lights.frontWhite.push(upperLens, upperGlow);
        } else {
            this.lights.rearWhite.push(upperLens, upperGlow);
        }

        // SpotLights (same as G1 for performance/consistency, casting light onto the tracks)
        const buildHeadSpotlight = (isWhiteColor) => {
            const color = isWhiteColor ? 0xfff5e0 : 0xff2200;
            const intensity = isWhiteColor ? 4.5 : 1.2;
            const spot = new THREE.SpotLight(color, intensity, 40.0, Math.PI / 6, 0.5, 1.5);
            // Positioned at the nose center Y = 1.135, pointing forward along positive Z
            spot.position.set(0, 1.135, 0.20);
            // Target points slightly downwards in front of the face
            spot.target.position.set(0, 0.45, 20);
            return spot;
        };

        const spotWhite = buildHeadSpotlight(true);
        const spotRed   = buildHeadSpotlight(false);

        noseGroup.add(spotWhite, spotWhite.target);
        noseGroup.add(spotRed, spotRed.target);

        // Register spotlights for interactive toggling
        if (isFront) {
            this.lights.frontWhite.push(spotWhite);
            this.lights.frontRed.push(spotRed);
        } else {
            this.lights.rearWhite.push(spotWhite);
            this.lights.rearRed.push(spotRed);
        }

        // 5. Nose Side Walls (Custom paint scheme with diagonal split extending to the first side window)
        const redShape = new THREE.Shape();
        redShape.moveTo(0.04, 0.625);
        redShape.lineTo(0.40, 2.85); // slanted front edge
        redShape.lineTo(1.754, 2.85); // top edge extended to 1.754
        redShape.lineTo(1.754, 2.55); // top red stripe boundary
        redShape.lineTo(1.754, 2.55); // diagonal line top at Z = 1.754
        redShape.lineTo(1.354, 0.625); // diagonal line bottom at Z = 1.354
        redShape.closePath();

        const whiteShape = new THREE.Shape();
        whiteShape.moveTo(1.354, 0.625);
        whiteShape.lineTo(1.754, 0.625);
        whiteShape.lineTo(1.754, 2.55);
        whiteShape.closePath();

        const bottomRedShape = new THREE.Shape();
        bottomRedShape.moveTo(0.00, 0.40);
        bottomRedShape.lineTo(1.754, 0.40);
        bottomRedShape.lineTo(1.754, 0.625);
        bottomRedShape.lineTo(0.04, 0.625);
        bottomRedShape.closePath();

        const skirtShape = new THREE.Shape();
        skirtShape.moveTo(0.10, 0.00);
        skirtShape.lineTo(1.754, 0.00);
        skirtShape.lineTo(1.754, 0.40);
        skirtShape.lineTo(0.00, 0.40);
        skirtShape.closePath();

        const redGeom = new THREE.ShapeGeometry(redShape);
        const whiteGeom = new THREE.ShapeGeometry(whiteShape);
        const bottomRedGeom = new THREE.ShapeGeometry(bottomRedShape);
        const skirtGeom = new THREE.ShapeGeometry(skirtShape);

        for (const xSign of [-1, 1]) {
            const sideGroup = new THREE.Group();
            sideGroup.position.set(xSign * 1.431, 0, 0); // 1 mm shift to prevent Z-fighting with front mask/top cap
            sideGroup.rotation.y = Math.PI / 2;

            const redMesh = new THREE.Mesh(redGeom, this.materials.dt3Red);
            const whiteMesh = new THREE.Mesh(whiteGeom, this.materials.dt3WhiteOuter);
            const bottomRedMesh = new THREE.Mesh(bottomRedGeom, this.materials.dt3Red);
            const skirtMesh = new THREE.Mesh(skirtGeom, this.materials.skirtGrey);

            sideGroup.add(redMesh, whiteMesh, bottomRedMesh, skirtMesh);
            noseGroup.add(sideGroup);
        }


        // Interior wall lining for the carriage extension region (Z = -1.20 to -1.754)
        for (const xSign of [-1, 1]) {
            const intX = xSign * 1.40;
            const zCenter = -1.477;
            const zLength = 0.554;

            const intBottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.935, zLength), this.materials.dt3WhiteInner);
            intBottom.position.set(intX, 0.8675, zCenter);

            const intTop = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.585, zLength), this.materials.dt3WhiteInner);
            intTop.position.set(intX, 2.5575, zCenter);

            const intPillar = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.93, zLength), this.materials.dt3WhiteInner);
            intPillar.position.set(intX, 1.80, zCenter);

            noseGroup.add(intBottom, intTop, intPillar);
        }

        // 7. Interior Front View Shelf / Dashboard
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.02, 0.5), this.materials.bodyGrey);
        shelf.position.set(0, 1.2, -0.4);
        
        const shelfCover = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.8, 0.02), this.materials.dt3WhiteInner);
        shelfCover.position.set(0, 0.8, -0.65);
        
        noseGroup.add(shelf, shelfCover);

        // Build provisional monitor on the shelf (facing the passenger cabin)
        const monitorGroup = new THREE.Group();
        monitorGroup.position.set(0, 1.21, -0.4);
        monitorGroup.rotation.x = 0.35; // tilt forward to face the driver/cabin
        
        // Casing: black box
        const casing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.38, 0.05), this.materials.bodyGlossBlack);
        casing.position.set(0, 0.19, 0);
        monitorGroup.add(casing);
        
        // Screen plane: facing negative Z (toward passenger cabin)
        const screenGeom = new THREE.PlaneGeometry(0.48, 0.34);
        const screenMesh = new THREE.Mesh(screenGeom, this.dt3MonitorMat);
        screenMesh.position.set(0, 0.19, -0.026);
        screenMesh.rotation.y = Math.PI; // Face negative Z
        monitorGroup.add(screenMesh);
        
        // Stand: support block under the casing
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), this.materials.bodyGrey);
        stand.position.set(0, 0.015, 0);
        monitorGroup.add(stand);
        
        noseGroup.add(monitorGroup);
    }

    getDT3BodyZBounds(i) {
        const carLength = 19.0425;
        const bellowsLen = G1_BELLOWS_LEN;
        if (i === 0) {
            return { front: -1.754, rear: -(carLength - bellowsLen) };
        } else {
            return { front: -bellowsLen, rear: -(carLength - 1.754) };
        }
    }
}
