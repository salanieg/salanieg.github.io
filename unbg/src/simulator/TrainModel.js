import * as THREE from 'three';

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

// Längsmaßstab des Zugmodells: 1 Einheit = 1 Meter (zuvor 0.7075-Stauchung, jetzt 1:1 zur Welt).
const TRAIN_SCALE = 1.0;

// G1: real Faltenbalg (gangway bellows) length per car end, 401mm.
const G1_BELLOWS_LEN = 0.401;

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
        
        // Shared materials
        this.materials = {
            bodyRedG1: new THREE.MeshStandardMaterial({ color: '#c21d2c', metalness: 0.1, roughness: 0.3, side: THREE.DoubleSide }), // Nuremberg G1 Red; DoubleSide so the side bevels read from inside the cab too
            bodyRedDT1: new THREE.MeshStandardMaterial({ color: '#ac3333', metalness: 0.1, roughness: 0.3, side: THREE.DoubleSide }), // Nuremberg DT1 Red; DoubleSide so the twisted nose corner reads from inside the cab too
            bodyWhite: new THREE.MeshStandardMaterial({ color: '#e6e8eb', metalness: 0.1, roughness: 0.4, side: THREE.DoubleSide }), // Off-white middle stripe; DoubleSide so the twisted nose corner reads from inside the cab too
            bodyDarkGrey: new THREE.MeshStandardMaterial({ color: '#1c1e22', metalness: 0.2, roughness: 0.6 }), // Window band and roof
            bodyGlossBlack: new THREE.MeshStandardMaterial({ color: '#0b0d10', metalness: 0.4, roughness: 0.25 }), // G1 glossy black front mask
            bodyGrey: new THREE.MeshStandardMaterial({ color: '#2e3033', metalness: 0.3, roughness: 0.5 }), // Underframe
            bodyBumperGrey: new THREE.MeshStandardMaterial({ color: '#43474d', metalness: 0.35, roughness: 0.55 }), // G1 front skirt block
            cabDoorGrey: new THREE.MeshStandardMaterial({ color: '#1a1c20', metalness: 0.3, roughness: 0.35 }), // G1 cab door on the black flank
            cockpitTrim: new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.85, side: THREE.DoubleSide }), // G1 interior A-pillar trim
            floorGrey: this.createFloorMaterial(),
            fabricRed: this.createFabricMaterial(),
            cockpitFloor: new THREE.MeshStandardMaterial({ color: '#bcbcbc', metalness: 0.1, roughness: 0.8 }),
            windowGlass: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
            cabWindowGlass: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }), // match standard window transparency
            windshieldGlass: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
            wheel: new THREE.MeshStandardMaterial({ color: '#111111', metalness: 0.8, roughness: 0.6 }),
            lightGlowWhite: new THREE.MeshBasicMaterial({ color: 0xffffff }),
            lightGlowRed: new THREE.MeshBasicMaterial({ color: 0xcc0000 }),
            chromeMetal: new THREE.MeshStandardMaterial({ color: '#cccccc', metalness: 0.95, roughness: 0.1 }), // Chrome logo & coupler
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
            dt1Roof: new THREE.MeshLambertMaterial({ color: '#c5c7cb', side: THREE.DoubleSide }), // retro light gray roof; DoubleSide since the rounded-corner roof geometry's winding isn't guaranteed to face up
            dt1Floor: new THREE.MeshLambertMaterial({ color: '#4a2711' }), // retro brown floor
            dt1SeatBlue: new THREE.MeshLambertMaterial({ color: '#2a3c54' }), // retro dark blue seats (Image 2)
            dt1SeatGreen: new THREE.MeshLambertMaterial({ color: '#1a2e1a' }), // driver seat (dark green/black)
            dt1Wall: new THREE.MeshLambertMaterial({ map: this.createWoodTexture(), side: THREE.DoubleSide }) // retro golden wood panels (Image 2); DoubleSide so it doesn't vanish when viewed from inside the cab
        };

        this.trainType = 'G1';
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

    setTrainModel(type) {
        if (this.trainType === type) return;
        this.trainType = type;
        
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
        this.lights = {
            frontWhite: [],
            frontRed: [],
            rearWhite: [],
            rearRed: []
        };
        this.carriages = [];
        this.lastDisplayText = "";
        
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
        } else {
            this.carLength = 19.270 * S;
            this.carWidth = 2.90 * S;
            this.buildG1Train();
        }
    }

    getCarriageProperties(i) {
        if (this.trainType === 'G1') {
            // Real-world G1 dimensions (incl. Faltenbalg/gangway bellows):
            // cockpit cars (0/3) = 19.270m, middle cars (1/2) = 18.815m
            const lengths = [19.270, 18.815, 18.815, 19.270];
            const startOffsets = [0, -19.270, -38.085, -56.900];
            return { length: lengths[i], startOffset: startOffsets[i] };
        } else {
            const carLength = 18.575;
            const middleGapOffset = 1.24;
            const startOffset = -i * carLength - (i >= 2 ? middleGapOffset : 0);
            return { length: carLength, startOffset: startOffset };
        }
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
            const whiteMaterial = this.materials.bodyWhite;
            const darkGreyMaterial = this.materials.bodyGlossBlack; // G1 window band is glossy black (see photos)
            const roofMaterial = this.materials.bodyDarkGrey;
            const floorMaterial = this.materials.floorGrey;
            const glassMaterial = this.materials.windowGlass;
 
            // Floor
            const floorGeom = new THREE.BoxGeometry(2.88, 0.05, bodyLength);
            this.applyBoxUVs(floorGeom, 2.88, 0.05, bodyLength, 2.0); // 2.0 scale = 0.5m tiles
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
                    const intBottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.825, zLength), whiteMaterial);
                    intBottom.position.set(xSign * 1.40, 0.7875, zCenter);
                    carGroup.add(intBottom);
 
                    // Top interior panel (covers Y = 2.55 to 2.85)
                    const intTop = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.30, zLength), whiteMaterial);
                    intTop.position.set(xSign * 1.40, 2.70, zCenter);
                    carGroup.add(intTop);
 
                    // Window band: Y = 1.20 to 2.55 (height 1.35)
                    // Bottom rail: split into outer (dark grey) and inner (white/hellgrau)
                    const bottomRailOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, zLength), darkGreyMaterial);
                    bottomRailOuter.position.set(xSign * 1.44, 1.275, zCenter);
                    const bottomRailInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, zLength), whiteMaterial);
                    bottomRailInner.position.set(xSign * 1.41, 1.275, zCenter);
                    carGroup.add(bottomRailOuter, bottomRailInner);
 
                    // Top rail: split into outer (dark grey) and inner (white/hellgrau)
                    const topRailOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.20, zLength), darkGreyMaterial);
                    topRailOuter.position.set(xSign * 1.44, 2.45, zCenter);
                    const topRailInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.20, zLength), whiteMaterial);
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
                        glass.position.set(xSign * 1.43, 1.85, wCenter);
                        carGroup.add(glass);

                        const frameLeftOuter = new THREE.Mesh(new THREE.BoxGeometry(0.02, wHeight, 0.05), darkGreyMaterial);
                        frameLeftOuter.position.set(xSign * 1.44, 1.85, w.start);
                        const frameLeftInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, wHeight, 0.05), whiteMaterial);
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
                        const pillarInner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.00, pWidth), whiteMaterial);
                        pillarInner.position.set(xSign * 1.41, 1.85, pCenter);
                        carGroup.add(pillarOuter, pillarInner);
                    });
                });
            };
 
            buildSideWallsForSide(-1);
            buildSideWallsForSide(1);

            // VAG Side Logo
            if (isFrontCab || isRearCab) {
                const logoCanvas = document.createElement('canvas');
                logoCanvas.width = 128;
                logoCanvas.height = 64;
                const logoCtx = logoCanvas.getContext('2d');
                logoCtx.fillStyle = 'rgba(255,255,255,0)';
                logoCtx.clearRect(0, 0, 128, 64);
                logoCtx.fillStyle = '#1c1e22';
                logoCtx.font = 'bold 36px sans-serif';
                logoCtx.textAlign = 'center';
                logoCtx.textBaseline = 'middle';
                logoCtx.fillText('VAG', 64, 32);

                const logoTex = new THREE.CanvasTexture(logoCanvas);
                logoTex.colorSpace = THREE.SRGBColorSpace;
                const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, side: THREE.DoubleSide });

                const logoZ = isFrontCab ? -4.39 : -14.88;

                const logoLGeom = new THREE.PlaneGeometry(0.3, 0.15);
                const logoL = new THREE.Mesh(logoLGeom, logoMat);
                logoL.position.set(-1.085, 0.90, logoZ);
                logoL.rotation.y = -Math.PI / 2;
                carGroup.add(logoL);

                const logoR = logoL.clone();
                logoR.position.x = 1.085;
                logoR.rotation.y = Math.PI / 2;
                carGroup.add(logoR);
            }

            // Roof (Red/Flatter) - height 0.05, centered Y = 2.876 (Y = 2.851 to 2.901)
            const roofGeom = new THREE.BoxGeometry(2.82, 0.05, bodyLength);
            const roof = new THREE.Mesh(roofGeom, this.materials.bodyRedG1);
            roof.position.set(0, 2.876, bodyPosZ);
            carGroup.add(roof);
 
            // Underside Ceiling lining (White) - height 0.01, Y = 2.846
            const ceilingLiningGeom = new THREE.BoxGeometry(2.80, 0.01, bodyLength);
            const ceilingLining = new THREE.Mesh(ceilingLiningGeom, this.materials.bodyWhite);
            ceilingLining.position.set(0, 2.846, bodyPosZ);
            carGroup.add(ceilingLining);
 
            // Underframe/Chassis (Grey) - height 0.08, centered Y = 0.34 (Y = 0.30 to 0.38)
            const chassisGeom = new THREE.BoxGeometry(2.86, 0.08, bodyLength);
            const chassis = new THREE.Mesh(chassisGeom, this.materials.bodyGrey);
            chassis.position.set(0, 0.34, bodyPosZ);
            carGroup.add(chassis);

            // Visual Glowing Ceiling Light Fixtures (split left and right)
            const lightCount = 5;
            for (let j = 0; j < lightCount; j++) {
                const zRatio = (j + 0.5) / lightCount;
                const fixtureZ = bodyPosZ - bodyLength / 2 + zRatio * bodyLength;

                const fixtureGeom = new THREE.BoxGeometry(0.15, 0.02, 2.0);

                const fixtureL = new THREE.Mesh(fixtureGeom, this.materials.lightGlowWhite);
                fixtureL.position.set(-0.6, 2.80, fixtureZ);

                const fixtureR = new THREE.Mesh(fixtureGeom, this.materials.lightGlowWhite);
                fixtureR.position.set(0.6, 2.80, fixtureZ);

                carGroup.add(fixtureL, fixtureR);
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
                    if (cfg.panelIdx === 2) {
                        // Replace one of the long bench pairs per carriage with facing transverse seats
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
            this.buildBogie(carGroup, -carLength / 2 + 6.0);
            this.buildBogie(carGroup, -carLength / 2 - 6.0);
 
            // 5. Build passenger doors (3 doors per side)
            const doorPositionsZ = this.getG1DoorPositions(i);
            doorPositionsZ.forEach(dz => {
                this.createDoorPair(carGroup, -1.44, dz, i, 'left');
                this.createDoorPair(carGroup, 1.44, dz, i, 'right');
 
                // Fill the gap above doors (Y = 2.45 to 2.85)
                for (let xSign of [-1, 1]) {
                    const posX = xSign * 1.43;
                    // Gloss black band above door: Y = 2.45 to 2.55 (height 0.10)
                    const doorTopGrey = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 1.636), this.materials.bodyGlossBlack);
                    doorTopGrey.position.set(posX, 2.50, dz);
                    // Red top stripe: Y = 2.55 to 2.85 (height 0.30)
                    const doorTopRed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.30, 1.636), this.materials.bodyRedG1);
                    doorTopRed.position.set(posX, 2.70, dz);
                    carGroup.add(doorTopGrey, doorTopRed);

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

    buildSeatBench(carGroup, xOffset, zOffset, length) {
        const seatColor = this.materials.fabricRed;
        const xSign = xOffset > 0 ? 1 : -1;
        const isG1 = (this.trainType === 'G1');
        
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
            const bottomShell = new THREE.Mesh(bottomShellGeom, this.materials.bodyWhite);
            bottomShell.position.set(xWall - xSign * (seatDepth / 2), 0.72, seatZ);
 
            // White back shell
            const backShell = new THREE.Mesh(backShellGeom, this.materials.bodyWhite);
            backShell.position.set(xWall - xSign * 0.01, 1.06, seatZ);
 
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
        const cushionColor = this.materials.fabricRed;
        const xSign = xOffset > 0 ? 1 : -1;
        const isG1 = (this.trainType === 'G1');
 
        const geom = new THREE.BoxGeometry(0.08, 0.20, length);
        this.applyBoxUVs(geom, 0.08, 0.20, length, 10);
 
        const cushion = new THREE.Mesh(geom, cushionColor);
        const cushionX = xSign * (isG1 ? 1.36 : 1.01);
        cushion.position.set(cushionX, 1.22, zOffset);
        carGroup.add(cushion);
    }

    buildTransverseSeats(carGroup, zOffset, length) {
        const seatColor = this.materials.fabricRed;
        const whiteMat = this.materials.bodyWhite;
        const isG1 = (this.trainType === 'G1');
 
        // Two bays of length 1.6m each
        const bayLength = length / 2; // 1.6m
        const bay1Center = zOffset - bayLength / 2;
        const bay2Center = zOffset + bayLength / 2;
 
        // Dimensions
        const seatW = isG1 ? 0.46 : 0.40; // width along X
        const seatD = isG1 ? 0.46 : 0.42; // depth along Z - increased!
        const shellW = isG1 ? 0.48 : 0.42;
        const shellD = isG1 ? 0.48 : 0.44; // depth along Z - increased!
 
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
 
            const support = new THREE.Mesh(
                new THREE.BoxGeometry(rowWidth, 0.12, seatD),
                whiteMat
            );
            support.position.set(centerX, 0.66, z - dirZ * 0.01);
            carGroup.add(support);
 
            xPositions.forEach(x => {
                // White bottom shell
                const bottomShell = new THREE.Mesh(bottomShellGeom, whiteMat);
                bottomShell.position.set(x, 0.72, z - dirZ * 0.01);
 
                // White back shell
                const backShell = new THREE.Mesh(backShellGeom, whiteMat);
                backShell.position.set(x, 1.06, z - dirZ * (shellD / 2 + 0.01));
 
                // Red cushion
                const cushion = new THREE.Mesh(cushionGeom, seatColor);
                cushion.position.set(x, 0.76, z - dirZ * 0.01);
 
                // Red backrest
                const backrest = new THREE.Mesh(backrestGeom, seatColor);
                backrest.position.set(x, 1.04, z - dirZ * (seatD / 2 - 0.01));
 
                carGroup.add(bottomShell, backShell, cushion, backrest);
            });
        };
 
        // --- Bay 1 (Center at z = -13.3) ---
        // Left side (4 seats): 2 seats at z = -13.85 facing +Z, 2 seats at z = -12.75 facing -Z
        buildRow([-0.73, -1.15], bay1Center - 0.55, 1);
        buildRow([-0.73, -1.15], bay1Center + 0.55, -1);
 
        // Right side (3 seats): 1 seat at z = -13.85 facing +Z (back to semicircle), 2 seats at z = -12.75 facing -Z
        buildRow([1.15], bay1Center - 0.55, 1);
        buildRow([0.73, 1.15], bay1Center + 0.55, -1);
 
        // --- Bay 2 (Center at z = -11.7) ---
        // Left side (4 seats): 2 seats facing +Z, 2 seats facing -Z
        buildRow([-0.73, -1.15], bay2Center - 0.55, 1);
        buildRow([-0.73, -1.15], bay2Center + 0.55, -1);
 
        // Right side (3 seats): 2 seats facing +Z, 1 seat facing -Z (back to semicircle)
        buildRow([0.73, 1.15], bay2Center - 0.55, 1);
        buildRow([1.15], bay2Center + 0.55, -1);
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

        // 6. Chrome VAG roundel centered on the black nose
        const emblemGeom = new THREE.CylinderGeometry(0.10, 0.10, 0.02, 24);
        emblemGeom.rotateX(Math.PI / 2);
        const emblem = new THREE.Mesh(emblemGeom, this.materials.chromeMetal);
        emblem.position.set(0, 1.13, this.g1FrontZ(0, 1.13) + 0.002);
        faceGroup.add(emblem);

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
            const spot = new THREE.SpotLight(color, intensity, 40.0, Math.PI / 14, 0.25, 1.5);
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
        const consoleDarkGrey = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.8, metalness: 0.2 }); // console desk body
        const panelMediumGrey = new THREE.MeshStandardMaterial({ color: '#383c44', roughness: 0.7 });
        const transparentGlass = new THREE.MeshBasicMaterial({ color: '#aabbcc', transparent: true, opacity: 0.08, depthWrite: false });

        // 1. Create Dynamic Canvases for Screens
        const leftCanvas = document.createElement('canvas');
        leftCanvas.width = 512;
        leftCanvas.height = 256;
        const leftCtx = leftCanvas.getContext('2d');
        const leftTexture = new THREE.CanvasTexture(leftCanvas);
        leftTexture.colorSpace = THREE.SRGBColorSpace;
        const leftMat = new THREE.MeshBasicMaterial({ map: leftTexture });

        const rightCanvas = document.createElement('canvas');
        rightCanvas.width = 512;
        rightCanvas.height = 256;
        const rightCtx = rightCanvas.getContext('2d');
        const rightTexture = new THREE.CanvasTexture(rightCanvas);
        rightTexture.colorSpace = THREE.SRGBColorSpace;
        const rightMat = new THREE.MeshBasicMaterial({ map: rightTexture });

        const midCanvas = document.createElement('canvas');
        midCanvas.width = 512;
        midCanvas.height = 256; // Full height (same as others)
        const midCtx = midCanvas.getContext('2d');
        const midTexture = new THREE.CanvasTexture(midCanvas);
        midTexture.colorSpace = THREE.SRGBColorSpace;
        const midMat = new THREE.MeshBasicMaterial({ map: midTexture });

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
        const panelMat = new THREE.MeshStandardMaterial({ color: '#2c303a', roughness: 0.7, metalness: 0.2 }); // Slate grey casing

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
        const deskMat = new THREE.MeshStandardMaterial({ color: '#1e222b', roughness: 0.8 });
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
        const tachoDialMat = new THREE.MeshBasicMaterial({ map: tachoTexture, transparent: true });

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
        const needleMat = new THREE.MeshBasicMaterial({ color: '#ccff00' }); // fluorescent light green
        const needle = new THREE.Mesh(needleGeom, needleMat);
        needleGroup.add(needle);

        // Center cap pin
        const capGeom = new THREE.CylinderGeometry(0.0133, 0.0133, 0.0067, 16);
        capGeom.rotateX(Math.PI / 2);
        const capMat = new THREE.MeshBasicMaterial({ color: '#1e293b' });
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
            const manoMat = new THREE.MeshBasicMaterial({ map: manoTexture, transparent: true });
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
                const nMesh = new THREE.Mesh(nGeom, new THREE.MeshBasicMaterial({ color: color }));
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
            const v10Mat = new THREE.MeshBasicMaterial({ map: v10Texture, transparent: true });
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
            const vNeedle = new THREE.Mesh(vNeedleGeom, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
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
        const cockFloor = new THREE.Mesh(cockFloorGeom, this.materials.floorGrey);
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
            const redWedge = new THREE.Mesh(sign < 0 ? G.g1CabRedWedgeL : G.g1CabRedWedgeR, this.materials.bodyRedG1);
            const whiteTri = new THREE.Mesh(sign < 0 ? G.g1CabWhiteTriL : G.g1CabWhiteTriR, this.materials.bodyWhite);
            const topStrip = new THREE.Mesh(sign < 0 ? G.g1CabTopStripL : G.g1CabTopStripR, this.materials.bodyRedG1);
            sideGroup.add(flank, flankGlass, redStripe, redWedge, whiteTri, topStrip);

            // Doorway reveal: jambs, header and sill lining the flank cutout so
            // the opening has visible depth when the door swings out
            const jambF = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.80, 0.03), this.materials.cockpitTrim);
            jambF.position.set(sign * 1.425, 1.50, -1.125);
            const jambR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.80, 0.03), this.materials.cockpitTrim);
            jambR.position.set(sign * 1.425, 1.50, -1.795);
            const header = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.67), this.materials.cockpitTrim);
            header.position.set(sign * 1.425, 2.385, -1.46);
            const sill = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.67), this.materials.cabDoorGrey);
            sill.position.set(sign * 1.425, 0.615, -1.46);
            sideGroup.add(jambF, jambR, header, sill);

            // Driver door: 700mm-wide leaf built as a real frame (top rail, lower
            // panel, hinge/latch stiles) around an open window cutout, so the
            // glass pane is genuinely see-through instead of an opaque overlay.
            // Hinged at the front edge, swinging outwards (animated via this.cabDoors).
            const doorW = 0.70; // real driver door width: 700mm
            const winZ0 = -0.08, winZ1 = -(doorW - 0.07); // hinge/latch margins
            const winY0 = 1.14, winY1 = 2.30; // top/bottom margins
            const doorPivot = new THREE.Group();
            doorPivot.position.set(sign * 1.428, 0, -1.11);

            const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.39 - winY1, doorW), this.materials.bodyGlossBlack);
            topRail.position.set(0, (2.39 + winY1) / 2, -doorW / 2);
            const lowerPanel = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY0 - 0.61, doorW), this.materials.bodyGlossBlack);
            lowerPanel.position.set(0, (0.61 + winY0) / 2, -doorW / 2);
            const hingeStile = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY1 - winY0, -winZ0), this.materials.bodyGlossBlack);
            hingeStile.position.set(0, (winY0 + winY1) / 2, winZ0 / 2);
            const latchStile = new THREE.Mesh(new THREE.BoxGeometry(0.04, winY1 - winY0, doorW + winZ1), this.materials.bodyGlossBlack);
            latchStile.position.set(0, (winY0 + winY1) / 2, (winZ1 - doorW) / 2);
            const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.03, winY1 - winY0, winZ0 - winZ1), this.materials.cabWindowGlass);
            doorGlass.position.set(0, (winY0 + winY1) / 2, (winZ0 + winZ1) / 2);
            const whiteAccent = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.10, doorW - 0.06), this.materials.bodyWhite);
            whiteAccent.position.set(sign * 0.026, winY0 - 0.15, -doorW / 2);
            const handleOut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.035), this.materials.chromeMetal);
            handleOut.position.set(sign * 0.026, 1.10, winZ1 + 0.04);
            const handleIn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.035), this.materials.chromeMetal);
            handleIn.position.set(-sign * 0.036, 1.10, winZ1 + 0.04);
            doorPivot.add(topRail, lowerPanel, hingeStile, latchStile, doorGlass, whiteAccent, handleOut, handleIn);
            sideGroup.add(doorPivot);
            const side = ((cabDir === 1) === (sign < 0)) ? 'left' : 'right';
            this.cabDoors.push({ pivot: doorPivot, sign, side, carIdx });

            // Interior linings above/below the cab side windows (ending at the
            // doorway cutout so they never block the opening)
            const liningBottom = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.06, 0.90), this.materials.bodyWhite);
            liningBottom.position.set(sign * 1.393, 0.92, -0.66);
            // starts behind the swept-back A-pillar bevel so it cannot poke through
            const liningTop = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.38, 1.15), this.materials.bodyWhite);
            liningTop.position.set(sign * 1.393, 2.64, -1.20);
            sideGroup.add(liningBottom, liningTop);
        }

        // Cab roof: red plan-shaped cap following the brow arc and bevel sweep
        sideGroup.add(new THREE.Mesh(G.g1CabRoofCap, this.materials.bodyRedG1));

        // Cab Underside Ceiling lining (White)
        const cabCeilingLining = new THREE.Mesh(new THREE.BoxGeometry(2.78, 0.01, 1.12), this.materials.bodyWhite);
        cabCeilingLining.position.set(0, 2.83, -1.32);
        sideGroup.add(cabCeilingLining);

        // 10. Cabin Rear Wall partition (Rückwand)
        const partitionGlassMat = new THREE.MeshBasicMaterial({
            color: '#ffffff',
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const partitionWallMat = new THREE.MeshStandardMaterial({ color: '#cfd8dc', roughness: 0.9 });
        const interiorWidth = unscaledWidth - 0.12; // 2.78m for G1, stays strictly inside the interior walls
        const partitionH = (this.trainType === 'G1') ? 2.075 : 1.60;
        const partitionY = (this.trainType === 'G1') ? 1.4125 : 1.20;
        const partitionW = (interiorWidth - 0.79) / 2;
        const partitionOffset = interiorWidth / 2 - partitionW / 2;
 
        const partitionLGeom = new THREE.BoxGeometry(partitionW, partitionH, 0.035);
        const partitionL = new THREE.Mesh(partitionLGeom, partitionGlassMat);
        partitionL.position.set(-partitionOffset, partitionY, noseZ - cabDir * 1.90);
        
        const partitionRGeom = new THREE.BoxGeometry(partitionW, partitionH, 0.035);
        const partitionR = new THREE.Mesh(partitionRGeom, partitionGlassMat);
        partitionR.position.set(partitionOffset, partitionY, noseZ - cabDir * 1.90);
        
        const partitionTopH = (this.trainType === 'G1') ? 0.40 : 0.30;
        const partitionTopY = (this.trainType === 'G1') ? 2.65 : 2.15;
        const partitionTopGeom = new THREE.BoxGeometry(interiorWidth, partitionTopH, 0.05);
        const partitionTop = new THREE.Mesh(partitionTopGeom, partitionWallMat);
        partitionTop.position.set(0, partitionTopY, noseZ - cabDir * 1.90);
        
        const cabinDoorGeom = new THREE.BoxGeometry(0.79, partitionH, 0.045);
        const cabinDoor = new THREE.Mesh(cabinDoorGeom, this.materials.bodyRedG1);
        cabinDoor.position.set(0, partitionY, noseZ - cabDir * 1.90);

        // Add a light grey handle (Klinke) on the left side of the door
        const handleGeom = new THREE.BoxGeometry(0.04, 0.02, 0.12);
        const handleMat = new THREE.MeshStandardMaterial({ color: '#cccccc', metalness: 0.5, roughness: 0.5 });
        const handle = new THREE.Mesh(handleGeom, handleMat);
        handle.position.set(-0.37, partitionY + 0.05, noseZ - cabDir * (1.90 - 0.03));

        cockpitGroup.add(partitionL, partitionR, partitionTop, cabinDoor, handle);

        // 11. Station display above the cockpit door (passenger side)
        const signOffset = -cabDir * 0.04;
        const displayZ = (noseZ - cabDir * 1.90) + signOffset;
        const displayY = (this.trainType === 'G1') ? 2.62 : 2.12;

        const displayBacking = new THREE.Mesh(
            new THREE.BoxGeometry(1.02, 0.14, 0.03),
            this.materials.bodyDarkGrey
        );
        displayBacking.position.set(0, displayY, displayZ);
        cockpitGroup.add(displayBacking);

        const displayScreen = new THREE.Mesh(
            new THREE.PlaneGeometry(1.0, 0.12),
            this.interiorDisplayMat
        );
        displayScreen.position.set(0, displayY, displayZ + signOffset * 0.4);
        displayScreen.rotation.y = (cabDir === 1) ? Math.PI : 0;
        cockpitGroup.add(displayScreen);
        this.interiorDisplays.push(displayScreen);

        // 12. Add Radio to cockpit floor (bottom right)
        this.buildRadio(cockpitGroup, noseZ, cabDir, carIdx);

        // 13. Driver's seat: dark grey ergonomic chair with a padded/quilted
        // cushion texture and a tall backrest (with a separate headrest lobe),
        // sitting far enough behind the dashboard/desk for legroom.
        this.buildG1DriverSeat(cockpitGroup, noseZ, cabDir);
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
        // No separate "color" tint here: MeshStandardMaterial multiplies map
        // by color, and the previous dark grey color (#43474d) over the
        // already-dark canvas (#33363b) multiplied down to near-black,
        // hiding the stitch pattern almost entirely. Leaving color at the
        // material's white default lets the texture's own tones show.
        this._g1SeatCushionMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
        return this._g1SeatCushionMat;
    }

    buildG1DriverSeat(cockpitGroup, noseZ, cabDir) {
        const cushionMat = this.getG1SeatCushionMaterial();
        const frameMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.6, metalness: 0.4 });

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

    buildRadio(cockpitGroup, noseZ, cabDir, carIdx) {
        const isG1 = (this.trainType === 'G1');
        const unscaledWidth = isG1 ? 2.90 : 2.20;

        const radioGroup = new THREE.Group();
        // Position: Bottom Right floor of cockpit from driver's perspective
        // Driver looks towards noseZ.
        // For cabDir=1 (forward), driver looks towards +Z, right is -X.
        // For cabDir=-1 (reverse), driver looks towards -Z, right is +X.
        const radioX = (cabDir === 1) ? -0.8 : 0.8;
        const radioZ = noseZ - cabDir * 1.0; // Place it under the dashboard area
        radioGroup.position.set(radioX, 0.45, radioZ);

        // Rotation: 45 degrees towards the driver
        // Driver is at approx Z = noseZ - cabDir * 1.45 (behind the radio)
        // We want the front (+Z in local radio space) to face the driver.
        if (cabDir === 1) {
            // Forward cab: Radio is at Z=1.0, Driver is at Z=1.45.
            // Rotating by PI/4 faces it back-right.
            // Adding PI makes it face mostly back (towards driver).
            radioGroup.rotation.y = Math.PI - Math.PI / 4;
        } else {
            // Reverse cab: Radio is at Z=-1.0, Driver is at Z=-1.45.
            // Facing forward-left towards the driver.
            radioGroup.rotation.y = Math.PI / 4;
        }

        cockpitGroup.add(radioGroup);

        // Body: Orange as requested
        const bodyGeom = new THREE.BoxGeometry(0.20, 0.14, 0.10);
        const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffa500', roughness: 0.6, metalness: 0.1 });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.userData.isRadio = true; // Tag for raycasting
        radioGroup.add(body);

        // Antenna: Thin and longer as requested
        const antennaGeom = new THREE.CylinderGeometry(0.003, 0.003, 0.45, 8);
        const antenna = new THREE.Mesh(antennaGeom, this.materials.chromeMetal);
        antenna.position.set(-0.08, 0.25, 0);
        antenna.rotation.z = -0.15;
        radioGroup.add(antenna);

        // Handle (Black bar above buttons)
        const handleGeom = new THREE.BoxGeometry(0.12, 0.01, 0.02);
        const handleMat = new THREE.MeshStandardMaterial({ color: '#222222' });
        const handle = new THREE.Mesh(handleGeom, handleMat);
        handle.position.set(0, 0.075, 0);
        radioGroup.add(handle);

        // Buttons (3 small cylinders)
        const buttonGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8);
        buttonGeom.rotateX(Math.PI / 2);
        const buttonMat = new THREE.MeshStandardMaterial({ color: '#222222' });
        for (let i = 0; i < 3; i++) {
            const btn = new THREE.Mesh(buttonGeom, buttonMat);
            btn.position.set(-0.05 + i * 0.05, 0.03, 0.051);
            radioGroup.add(btn);
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
        const matRed = new THREE.MeshStandardMaterial({ color: '#d00000', roughness: 0.5 });
        const matRedGlow = new THREE.MeshBasicMaterial({ color: '#ff4444' });
        const matYellow = new THREE.MeshStandardMaterial({ color: '#e0a000', roughness: 0.5 });
        const matYellowGlow = new THREE.MeshBasicMaterial({ color: '#ffcc00' });
        const matWhite = new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.5 });
        const matWhiteGlow = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const matGreen = new THREE.MeshStandardMaterial({ color: '#00a000', roughness: 0.5 });
        const matGreenGlow = new THREE.MeshBasicMaterial({ color: '#44ff44' });
        const matBlack = new THREE.MeshStandardMaterial({ color: '#101010', roughness: 0.8 });
        const matGrey = new THREE.MeshStandardMaterial({ color: '#808080', roughness: 0.6, metalness: 0.4 });
        const matSilver = new THREE.MeshStandardMaterial({ color: '#aaaaaa', roughness: 0.3, metalness: 0.7 });

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

    buildBogie(carGroup, zOffset) {
        const S = TRAIN_SCALE;
        const isG1 = (this.trainType === 'G1');
        const axleOffset = 1.05 * S; // 2.1m Radstand für beide Züge
        const bogieFrameWidth = isG1 ? 2.5 * S : 2.5 * S;
        const wheelX = 0.7175;
 
        const bogieFrameGeom = new THREE.BoxGeometry(1.8 * S, 0.10 * S, bogieFrameWidth);
        const frame = new THREE.Mesh(bogieFrameGeom, this.materials.bodyGrey);
        frame.position.set(0, -0.2494, zOffset);
        carGroup.add(frame);
 
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
        const glassMaterial = this.materials.windowGlass;
        const greyMaterial = this.materials.bodyGrey;
 
        const buildDoorLeaf = (leafGroup, isLeft) => {
            const frameEdgeOffset = leafWidth / 2 - 0.05;
            const horizontalWidth = leafWidth - 0.20;
            const halfH = doorHeight / 2;
            const quarterH = doorHeight / 4;
 
            // 1. Lower window:
            const lowerFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.02, halfH, 0.10), darkGreyMaterial);
            lowerFrameL.position.set(0, -quarterH, -frameEdgeOffset);
            
            const lowerFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.02, halfH, 0.10), darkGreyMaterial);
            lowerFrameR.position.set(0, -quarterH, frameEdgeOffset);
 
            const lowerFrameB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            lowerFrameB.position.set(0, -halfH + 0.05, 0);
 
            const lowerFrameT = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            lowerFrameT.position.set(0, 0.00, 0);
 
            const lowerGlass = new THREE.Mesh(new THREE.BoxGeometry(0.01, halfH - 0.20, horizontalWidth), glassMaterial);
            lowerGlass.position.set(0, -quarterH, 0);
 
            leafGroup.add(lowerFrameL, lowerFrameR, lowerFrameB, lowerFrameT, lowerGlass);
 
            // 2. Upper window:
            const upperFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.02, halfH, 0.10), darkGreyMaterial);
            upperFrameL.position.set(0, quarterH, -frameEdgeOffset);
            
            const upperFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.02, halfH, 0.10), darkGreyMaterial);
            upperFrameR.position.set(0, quarterH, frameEdgeOffset);
 
            const upperFrameB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            upperFrameB.position.set(0, 0.10, 0);
 
            const upperFrameT = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, horizontalWidth), darkGreyMaterial);
            upperFrameT.position.set(0, halfH - 0.05, 0);
 
            const upperGlass = new THREE.Mesh(new THREE.BoxGeometry(0.01, halfH - 0.20, horizontalWidth), glassMaterial);
            upperGlass.position.set(0, quarterH, 0);
 
            leafGroup.add(upperFrameL, upperFrameR, upperFrameB, upperFrameT, upperGlass);
 
            // 3. Illuminated door strip on the meeting edge (outside face)
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(0.005, doorHeight - 0.02, 0.012),
                new THREE.MeshBasicMaterial({ color: 0xff0000 })
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
        const width = screen.leftCanvas.width;
        const height = screen.leftCanvas.height;

        // Clear background
        ctx.fillStyle = '#0c0f12';
        ctx.fillRect(0, 0, width, height);

        // Draw border
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, width - 4, height - 4);

        // Header
        ctx.fillStyle = '#00ff66';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('SYSTEM', 15, 20);

        // Line separator
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(15, 25);
        ctx.lineTo(240, 25);
        ctx.stroke();

        // Content
        ctx.font = '11px monospace';
        
        // ATO Mode
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('MODUS', 15, 38);
        if (this.sim.atoMode) {
            ctx.fillStyle = '#00ff66';
            ctx.fillText('AUTONOM', 90, 38);
        } else {
            ctx.fillStyle = '#00ff66';
            ctx.fillText('MANUELL', 90, 38);
        }

        // Doors
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('TÜREN', 15, 56);
        if (this.sim.doorProgress > 0 || this.sim.doorsOpen) {
            ctx.fillStyle = '#ff3333';
            ctx.fillText(this.sim.doorState === 1 ? 'ÖFFNEN...' : (this.sim.doorState === 3 ? 'SCHLIESSEN...' : 'GEÖFFNET'), 90, 56);
        } else {
            ctx.fillStyle = '#00ff66';
            ctx.fillText('VERRIEGELT', 90, 56);
        }

        // Emergency Brake / Sifa
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('SICHERHEIT', 15, 74);
        if (this.sim.emergencyBrake) {
            ctx.fillStyle = '#ff3333';
            ctx.fillText('NOTBREMSE AKTIV', 90, 74);
        } else {
            ctx.fillStyle = '#00ff66';
            ctx.fillText('SIFA OK', 90, 74);
        }

        // Traction Force (KRAFT) display
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('KRAFT', 15, 92);
        const forcePercent = Math.max(0, this.sim.throttle) * 100;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${forcePercent.toFixed(0)} %`, 78, 92);

        // Traction Force bar (0 to 100%)
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(145, 83, 80, 10);

        // Vertical indicator line showing current force request
        const forceX = 145 + (forcePercent / 100) * 80;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(forceX - 1, 81, 2, 14);

        // Brake deceleration display (BREMSE)
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('BREMSE', 15, 110);
        const decel = Math.max(0, -this.sim.acceleration);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${decel.toFixed(2)} m/s²`, 78, 110);

        // Deceleration bar (0 to 3.5, with red background ab 2.0)
        const normalWidth = (2.0 / 3.5) * 80;
        const redWidth = (1.5 / 3.5) * 80;

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(145, 101, normalWidth, 10);

        ctx.fillStyle = '#b91c1c'; // Red background for 2.0 to 3.5 range
        ctx.fillRect(145 + normalWidth, 101, redWidth, 10);

        // Vertical indicator line showing current brake deceleration
        const brakeX = 145 + (Math.min(3.5, decel) / 3.5) * 80;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(brakeX - 1, 99, 2, 14);

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
        const destination = isReversing ? "Langwasser Süd" : "Hardhöhe";

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
        ctx.fillText("Linie U1", 15, 35);
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

        // Clear background
        ctx.fillStyle = '#0c0f12';
        ctx.fillRect(0, 0, width, height);

        // --- Kopfzeile (Statusleiste) ---
        ctx.fillStyle = '#1a1d22';
        ctx.fillRect(0, 0, width, 25);

        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('485', 10, 18);

        const now = new Date();
        const days = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
        const dateStr = `${days[now.getDay()]} ${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        ctx.textAlign = 'right';
        ctx.fillText(dateStr, width - 10, 18);

        // --- Zeile 1 (Karteireiter) ---
        const tabWidth = (width - 20) / 4;
        const drawTab = (x, label) => {
            ctx.fillStyle = '#4a4d52';
            ctx.fillRect(x, 30, tabWidth - 2, 25);
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
            // Rounded corners approximation
            ctx.beginPath();
            ctx.roundRect(x, y, btnWidth - 4, 30, 5);
            ctx.fill();
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

        // --- Zeile 3 (Untere Tastenreihe) ---
        const row3Labels = ['ZF', 'ELA', 'FGZ', 'RLS'];
        for (let i = 0; i < 4; i++) {
            drawBtn(10 + i * btnWidth, 105, row3Labels[i], '#4a4d52');
        }

        // --- Zeile 4 (Informationsleiste / Ticker) ---
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, 150, width, 40);

        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'left';
        const tickerText = '...örung im Bereich Innenstadt: Li. 43 und 44 fahrt in Ri. Passauer Str      ';
        const textMetrics = ctx.measureText(tickerText);
        const tickerOffset = (Date.now() / 50) % textMetrics.width;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 150, width, 40);
        ctx.clip();
        ctx.fillText(tickerText, 10 - tickerOffset, 175);
        ctx.fillText(tickerText, 10 - tickerOffset + textMetrics.width, 175);
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

        ctx.fillStyle = '#6b7280';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Legende', 80, height - 15);
        ctx.fillText('Hinweise', 140, height - 15);

        ctx.font = '9px sans-serif';
        ctx.fillText('Ortsnummer', 220, height - 20);
        ctx.fillText('umschalten', 220, height - 10);

        ctx.textAlign = 'right';
        ctx.fillText('Einstellungen', width - 10, height - 15);

        screen.rightTexture.needsUpdate = true;
    }

    createDestinationSignMaterial() {
        if (this.destScreenMat) return this.destScreenMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ffffff'; // White text
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("U1 Fürth Hardhöhe", canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        
        this.destScreenMat = new THREE.MeshBasicMaterial({ map: texture });
        return this.destScreenMat;
    }

    updateDestinationSign(isReversing) {
        if (!this.destScreenMat || !this.destScreenMat.map) return;
        if (this.lastReversing === isReversing) return;
        this.lastReversing = isReversing;
        
        const canvas = this.destScreenMat.map.image;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#ffffff'; // White text
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const text = isReversing ? "U1 Langwasser Süd" : "U1 Fürth Hardhöhe";
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        
        this.destScreenMat.map.needsUpdate = true;
    }

    createInteriorDisplayMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        
        this.interiorDisplayMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        return this.interiorDisplayMat;
    }

    updateInteriorDisplays(text) {
        if (!this.interiorDisplayMat || !this.interiorDisplayMat.map) return;
        const canvas = this.interiorDisplayMat.map.image;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#ffffff'; // White text color
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        
        this.interiorDisplayMat.map.needsUpdate = true;
    }

    createFabricMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Red background
        ctx.fillStyle = '#c62828';
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

        return new THREE.MeshStandardMaterial({
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

    createFloorMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Background: Light grey (slightly darker than wall #e6e8eb)
        ctx.fillStyle = '#bcbcbc';
        ctx.fillRect(0, 0, 512, 512);

        // Add tiny random triangles (fast white and fast black)
        for (let i = 0; i < 4000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const size = 0.5 + Math.random() * 2;
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

        return new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.1,
            roughness: 0.8
        });
    }

    playAnnouncementChime() {
        // Dreiklang: F4 (349 Hz) → A4 (440 Hz) → C5 (523 Hz, mit langem Nachklang)
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();

            const playTone = (freq, startTime, duration, decayTime, gain = 0.35) => {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.connect(env);
                env.connect(ctx.destination);

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);

                env.gain.setValueAtTime(0, startTime);
                env.gain.linearRampToValueAtTime(gain, startTime + 0.012); // fast attack
                env.gain.setValueAtTime(gain, startTime + duration);
                env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + decayTime);

                osc.start(startTime);
                osc.stop(startTime + duration + decayTime + 0.05);
            };

            const now = ctx.currentTime;
            playTone(349.23, now + 0.00, 0.20, 0.05);          // F4 – kurz
            playTone(440.00, now + 0.22, 0.20, 0.05);          // A4 – kurz
            playTone(523.25, now + 0.44, 0.20, 2.50, 0.40);   // C5 – langsamer Ausklang
        } catch (e) {
            // AudioContext not available (e.g. test environment) – silently skip
        }
    }

    buildInteriorPolesAndDividers(carGroup, minZ, maxZ, carIndex) {
        const isG1 = (this.trainType === 'G1');
        const poleH = isG1 ? 2.41 : 1.91;
        const poleY = isG1 ? 1.585 : 1.335;
        const sleeveY = isG1 ? 1.50 : 1.25;
        const torusY = isG1 ? 1.45 : 1.20;
        const armrestY = isG1 ? 1.38 : 1.13;
        const torusX = isG1 ? 1.40 : 1.08;
        const armrestX = isG1 ? 1.10 : 0.855;
 
        const poleGeom = new THREE.CylinderGeometry(0.015, 0.015, poleH, 8);
        const chromeMat = this.materials.chromeMetal;
        const sleeveColor = isG1 ? this.materials.bodyRedG1 : this.materials.bodyRedDT1;
 
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
 
        const centerPolesZ = isG1 ? this.getG1DoorPositions(carIndex) : [-3.5, -9.5, -15.5];
        centerPolesZ.forEach(pz => {
            if (pz >= minZ && pz <= maxZ) {
                addPole(0, pz);
            }
        });
 
        let vestibulePolesZ = [];
        if (isG1) {
            const doors = this.getG1DoorPositions(carIndex);
            doors.forEach(dz => {
                vestibulePolesZ.push(dz + 0.818);
                vestibulePolesZ.push(dz - 0.818);
            });
        } else {
            vestibulePolesZ = [-2.8, -4.2, -8.8, -10.2, -14.8, -16.2];
        }
 
        vestibulePolesZ.forEach(pz => {
            if (pz >= minZ && pz <= maxZ) {
                // Semicircle partitions
                const torusL = new THREE.Mesh(torusGeom, chromeMat);
                torusL.position.set(-torusX, torusY, pz);
                torusL.rotation.z = -Math.PI / 2;
                carGroup.add(torusL);
 
                const torusR = new THREE.Mesh(torusGeom, chromeMat);
                torusR.position.set(torusX, torusY, pz);
                torusR.rotation.z = Math.PI / 2;
                carGroup.add(torusR);
 
                // Red leaning cushions oriented transverse (along X) inside the semicircles
                for (let xSign of [-1, 1]) {
                    const armrest = new THREE.Mesh(armrestGeom, this.materials.fabricRed);
                    armrest.position.set(xSign * armrestX, armrestY, pz);
                    armrest.rotation.x = Math.PI / 2;
                    carGroup.add(armrest);
                }
            }
        });
    }

    buildBellowsHalf(carGroup, startZ, endZ, type) {
        const isG1 = (this.trainType === 'G1');
        const wallMat = this.materials.bodyWhite;
        const bellowsMat = this.materials.bodyDarkGrey;
 
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
 
        const bellowsFloorGeom = new THREE.BoxGeometry(openWidth, 0.01, absDz);
        this.applyBoxUVs(bellowsFloorGeom, openWidth, 0.01, absDz, 2.0);
        const bellowsFloor = new THREE.Mesh(
            bellowsFloorGeom,
            this.materials.floorGrey
        );
        bellowsFloor.position.set(0, 0.385, startZ + dz / 2);
        carGroup.add(bellowsFloor);
 
        const signOffset = type === 'front' ? -0.04 : 0.04;
        const displayY = isG1 ? 2.62 : 2.12;
        const displayBacking = new THREE.Mesh(
            new THREE.BoxGeometry(1.02, 0.14, 0.03),
            this.materials.bodyDarkGrey
        );
        displayBacking.position.set(0, displayY, startZ + signOffset);
        carGroup.add(displayBacking);
 
        const displayScreen = new THREE.Mesh(
            new THREE.PlaneGeometry(1.0, 0.12),
            this.interiorDisplayMat
        );
        displayScreen.position.set(0, displayY, startZ + signOffset * 1.4);
        displayScreen.rotation.y = type === 'front' ? Math.PI : 0;
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

    update(dt) {
        // 1. Update overall train group position and orientation along 3D curve
        const trainDist = this.sim.position;
        const reversing = this.sim.isReversing;
        const isG1 = (this.trainType === 'G1');
        const S = TRAIN_SCALE;
        const carLength = (isG1 ? 19.270 : 18.575) * S;

        const pos = this.sim.getTrackPosition(trainDist);
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
            const k = reversing ? (3 - i) : i; // carriage index relative to leading end
            
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
        const nextStation = this.sim.stations[this.sim.displayNextStationIdx];
        const nextStationName = nextStation ? nextStation.name : "Terminal";
        const displayText = "U1 " + nextStationName;
        if (displayText !== this.lastDisplayText) {
            this.lastDisplayText = displayText;
            this.updateInteriorDisplays(displayText);
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

            if (isActiveSide) {
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
                door.stripL.material.color.setHex(color);
                door.stripL.visible = visible;
            }
            if (door.stripR) {
                door.stripR.material.color.setHex(color);
                door.stripR.visible = visible;
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
            const targetLeverRot = - throttle * 0.45 * lever.cabDir;
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
            const floor = new THREE.Mesh(this.geometries.dt1Floor, floorMaterial);
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

            if (hasFrontCab || hasRearCab) {
                const logoCanvas = document.createElement('canvas');
                logoCanvas.width = 128; logoCanvas.height = 64;
                const logoCtx = logoCanvas.getContext('2d');
                logoCtx.fillStyle = 'rgba(255,255,255,0)';
                logoCtx.clearRect(0, 0, 128, 64);
                logoCtx.fillStyle = '#ffffff';
                logoCtx.font = 'bold 36px sans-serif';
                logoCtx.textAlign = 'center';
                logoCtx.textBaseline = 'middle';
                logoCtx.fillText('VAG', 64, 32);

                const logoTex = new THREE.CanvasTexture(logoCanvas);
                logoTex.colorSpace = THREE.SRGBColorSpace;
                const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, side: THREE.DoubleSide });

                const logoZ = hasFrontCab ? -4.25 : -14.325;
                const logoL = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), logoMat);
                logoL.position.set(-1.435, 0.7275, logoZ);
                logoL.rotation.y = -Math.PI / 2;
                carGroup.add(logoL);
                const logoR = logoL.clone();
                logoR.position.x = 1.435;
                logoR.rotation.y = Math.PI / 2;
                carGroup.add(logoR);
            }

            // Light Gray Roof (Slightly curved/taller) - Center at 2.815, Height 0.08 -> Top at 2.855
            const roof = new THREE.Mesh(this.geometries.dt1Roof, roofMaterial);
            roof.scale.z = bodyLength;
            roof.position.set(0, 2.815, bodyPosZ);
            carGroup.add(roof);

            const ceilingLining = new THREE.Mesh(this.geometries.dt1Ceiling, this.materials.bodyWhite);
            ceilingLining.scale.z = bodyLength;
            ceilingLining.position.set(0, 2.77, bodyPosZ);
            carGroup.add(ceilingLining);

            const chassis = new THREE.Mesh(this.geometries.dt1Chassis, chassisMaterial);
            chassis.scale.z = bodyLength;
            chassis.position.set(0, 0.34, bodyPosZ);
            carGroup.add(chassis);

            const lightCount = 6;
            for (let j = 0; j < lightCount; j++) {
                const zRatio = (j + 0.5) / lightCount;
                const fixtureZ = bodyPosZ - bodyLength / 2 + zRatio * bodyLength;
                const fixture = new THREE.Mesh(this.geometries.dt1LightFixture, this.materials.lightGlowWhite);
                fixture.position.set(0, 2.76, fixtureZ);
                carGroup.add(fixture);
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

            this.buildBogie(carGroup, doorPositionsZ[0] + 0.425);
            this.buildBogie(carGroup, doorPositionsZ[2] - 0.425);

            doorPositionsZ.forEach(dz => {
                this.createDT1DoorPair(carGroup, -1.44, dz, i, 'left');
                this.createDT1DoorPair(carGroup, 1.44, dz, i, 'right');

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
        const seatColor = this.materials.dt1SeatBlue;
        const woodMat = this.materials.dt1Wall;
        
        // Transverse double seats (width 1.00m on X, depth 0.45m on Z)
        const seatWidth = 1.00;
        const cushionGeom = new THREE.BoxGeometry(seatWidth, 0.06, 0.45);
        const backrestGeom = new THREE.BoxGeometry(seatWidth, 0.55, 0.04);
        const supportGeom = new THREE.BoxGeometry(seatWidth, 0.12, 0.45);

        const buildDT1SeatRow = (xOffset, z, dirZ) => {
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

            // Blue Backrest (slightly inclined)
            const backrest = new THREE.Mesh(backrestGeom, seatColor);
            backrest.position.set(xPos, 0.97, z - dirZ * 0.22);
            backrest.rotation.x = dirZ * 0.05;
            carGroup.add(backrest);

            // Backrest wood backing plate
            const backrestBacking = new THREE.Mesh(new THREE.BoxGeometry(seatWidth, 0.57, 0.02), woodMat);
            backrestBacking.position.set(xPos, 0.97, z - dirZ * 0.24);
            backrestBacking.rotation.x = dirZ * 0.05;
            carGroup.add(backrestBacking);

            // Grab handle on top of backrest (retro metal rail along X)
            const handleGeom = new THREE.CylinderGeometry(0.01, 0.01, seatWidth, 8);
            handleGeom.rotateZ(Math.PI / 2);
            const handle = new THREE.Mesh(handleGeom, this.materials.chromeMetal);
            handle.position.set(xPos, 1.21, z - dirZ * 0.25);
            carGroup.add(handle);

            // Vertical grab pole next to the seat row at the aisle edge (keeps gangway open)
            const partitionX = xSign * 0.40;
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.40, 8), this.materials.chromeMetal);
            pole.geometry.rotateX(Math.PI / 2); // align vertical
            pole.rotation.x = Math.PI / 2;
            pole.position.set(partitionX, 1.575, z + dirZ * 0.225);
            carGroup.add(pole);
        };

        const buildDT1SeatBay = (zCenter) => {
            // Left side double seats facing each other (aisle edge is at X = -0.40)
            buildDT1SeatRow(-0.925, zCenter - 0.55, 1);
            buildDT1SeatRow(-0.925, zCenter + 0.55, -1);

            // Right side double seats facing each other (aisle edge is at X = 0.40)
            buildDT1SeatRow(0.925, zCenter - 0.55, 1);
            buildDT1SeatRow(0.925, zCenter + 0.55, -1);
        };

        // Place bays of seats in the spaces between doors:
        const p = 0.314;
        const w = 1.435;
        const dHalf = 1.745 / 2;
        
        // Front Space
        const int1_end = hasFrontCab ? -1.44 : -0.15;
        const frontSpaceLength = Math.abs(int1_end - (doorPositionsZ[0] + dHalf));
        if (frontSpaceLength > 2.0) {
            buildDT1SeatBay(int1_end - p - w/2);
        }

        // Middle Space A: between Doors 1 & 2
        const gap12_start = doorPositionsZ[0] - dHalf;
        buildDT1SeatBay(gap12_start - p - w/2);
        buildDT1SeatBay(gap12_start - p - w - p - w/2);

        // Middle Space B: between Doors 2 & 3
        const gap23_start = doorPositionsZ[1] - dHalf;
        buildDT1SeatBay(gap23_start - p - w/2);
        buildDT1SeatBay(gap23_start - p - w - p - w/2);

        // Rear Space
        const innerEnd = hasFrontCab ? -18.425 : -17.135;
        const rearSpaceLength = Math.abs(innerEnd - (doorPositionsZ[2] - dHalf));
        if (rearSpaceLength > 2.0) {
            buildDT1SeatBay(innerEnd + p + w/2);
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

            // 3. Illuminated door strip on the meeting edge (outside face)
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(0.005, doorHeight - 0.02, 0.012),
                new THREE.MeshBasicMaterial({ color: 0xff0000 })
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
            faceGroup.add(divider);
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
                { y0: 0, y1: G.dt1PaneY, rOff: -0.03, mat: this.materials.dt1Wall }, // interior lining, lower
                { y0: G.dt1PaneY + G.dt1PaneH, y1: 2.425, rOff: -0.03, mat: this.materials.dt1Wall } // interior lining, upper
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

        // www.vag.de lettering on the accent band, left of center like the original
        const vagMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.075), this.getDecalMaterial('www.vag.de', '#8b1f24', true));
        vagMesh.position.set(-0.55, 0.79, 0.1265);
        faceGroup.add(vagMesh);

        // 4. Destination roller sign in a dark bezel, 1435mm wide, sitting just
        // above the windshield's own top edge (G.dt1PaneY + G.dt1PaneH, local to
        // faceGroup) rather than high up near the roofline.
        const destMat = this.createDestinationSignMaterial();
        const destY = G.dt1PaneY + G.dt1PaneH + 0.15; // 0.02 gap above the pane + half the frame height (0.13)
        const destFrame = new THREE.Mesh(new THREE.BoxGeometry(1.495, 0.26, 0.02), this.materials.bodyDarkGrey);
        destFrame.position.set(0, destY, 0.115);
        const destMesh = new THREE.Mesh(new THREE.BoxGeometry(1.435, 0.22, 0.02), destMat);
        destMesh.position.set(0, destY, 0.13);
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
        const topLens = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.02), this.materials.lightGlowWhite);
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
            const color = isWhite ? 0xfff5e0 : 0xff2200;
            const intensity = isWhite ? 4.5 : 1.2;
            const spot = new THREE.SpotLight(color, intensity, 40.0, Math.PI / 14, 0.25, 1.5);
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

        const headLWhite = buildDT1Headlight(-1, this.materials.lightGlowWhite, this.materials.glowSpriteWhite);
        const headLRed   = buildDT1Headlight(-1, this.materials.lightGlowRed,   this.materials.glowSpriteRed);
        const headRWhite = buildDT1Headlight( 1, this.materials.lightGlowWhite, this.materials.glowSpriteWhite);
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

        const consoleDarkGrey = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.8, metalness: 0.2 });
        const deskMat = new THREE.MeshStandardMaterial({ color: '#5d879b', roughness: 0.8 });

        // 1. Create Dynamic Canvases for retro analogue dashboard
        const leftCanvas = document.createElement('canvas');
        leftCanvas.width = 256;
        leftCanvas.height = 128;
        const leftCtx = leftCanvas.getContext('2d');
        const leftTexture = new THREE.CanvasTexture(leftCanvas);
        leftTexture.colorSpace = THREE.SRGBColorSpace;
        const leftMat = new THREE.MeshBasicMaterial({ map: leftTexture });

        const rightCanvas = document.createElement('canvas');
        rightCanvas.width = 256;
        rightCanvas.height = 128;
        const rightCtx = rightCanvas.getContext('2d');
        const rightTexture = new THREE.CanvasTexture(rightCanvas);
        rightTexture.colorSpace = THREE.SRGBColorSpace;
        const rightMat = new THREE.MeshBasicMaterial({ map: rightTexture });

        const screenObj = {
            carIdx: carIdx,
            cabDir: cabDir,
            leftCanvas,
            leftCtx,
            leftTexture,
            rightCanvas,
            rightCtx,
            rightTexture,
            isDT1: true
        };
        this.dashboardScreens.push(screenObj);
        
        // Render initial retro screen frames
        this.drawDT1LeftScreen(screenObj);
        this.drawDT1RightScreen(screenObj);

        // Vertical back wall bulkhead (grey)
        // Width narrowed to 2.81m to fit inside; Height reduced to 0.85m and lifted to start at Y=0.40 (floor)
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.81, 0.85, 0.02), new THREE.MeshStandardMaterial({ color: '#7a8086', roughness: 0.9 }));
        backWall.position.set(0, 0.825, noseZ - cabDir * 0.01);
        cockpitGroup.add(backWall);

        // Horizontal desk plate. Raised so its top surface sits flush with the
        // cab window's sill (matches the front windshield / side window cutout
        // bottom, dt1PaneY + 0.35 world Y - see cabWinY0 in buildDT1Cockpit's
        // flank code below); the dashboard panels are raised by the same amount
        // so they keep sitting on the desk exactly as before.
        const deskTopY = this.geometries.dt1PaneY + 0.35;
        const deskLift = deskTopY - 0.01 - 1.13; // 1.13 was the old desk center height
        // Width kept clear of the interior wall lining (buildIntLining sits at
        // xSign*1.40, spanning 1.395-1.405): at the old 2.81m width the desk's
        // own half-width (1.405) reached exactly into that lining panel's
        // footprint, and the desk's Y/Z range at that edge sat fully inside the
        // lining's own Y/Z range too - the two materials were overlapping in a
        // real volume there, not just touching. 2.78m keeps a 5mm clearance.
        const deskPlate = new THREE.Mesh(new THREE.BoxGeometry(2.78, 0.02, 0.6), deskMat);
        deskPlate.position.set(0, deskTopY - 0.01, noseZ - cabDir * 0.31);
        cockpitGroup.add(deskPlate);

        // Slanted panel layout for dashboard
        const panelWidth = 0.40;
        const panelHeight = 0.22;
        const panelThickness = 0.08;
        const panelGeom = new THREE.BoxGeometry(panelWidth, panelHeight, panelThickness);
        const panelMat = new THREE.MeshStandardMaterial({ color: '#5d879b', roughness: 0.7, metalness: 0.2 });

        const cameraZ = noseZ - cabDir * 1.2;
        const R = 1.0; // pushed to the far end of the desk (near the windshield), away from the driver's seat at cabDir*0.72 further back
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

        if (this.trainType === 'G1') {
            this.populateG1Panel2(panelMeshes.panel2, cabDir);
        }

        const screenWidth = 0.36;
        const screenHeight = 0.18;
        const screenGeom = new THREE.PlaneGeometry(screenWidth, screenHeight);

        // Left Screen (on panel1)
        const leftScreenMesh = new THREE.Mesh(screenGeom, leftMat);
        leftScreenMesh.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        leftScreenMesh.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes['panel1'].add(leftScreenMesh);

        // Right Screen (on panel5)
        const rightScreenMesh = new THREE.Mesh(screenGeom, rightMat);
        rightScreenMesh.position.set(0, 0, -cabDir * (panelThickness / 2 + 0.002));
        rightScreenMesh.rotation.y = (cabDir === 1) ? Math.PI : 0;
        panelMeshes['panel5'].add(rightScreenMesh);

        // Speedometer Dial Face on Panel 3 (Center)
        const speedDialCanvas = document.createElement('canvas');
        speedDialCanvas.width = 256;
        speedDialCanvas.height = 256;
        const sdCtx = speedDialCanvas.getContext('2d');
        sdCtx.fillStyle = '#111317';
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
        const speedDialMat = new THREE.MeshBasicMaterial({ map: speedDialTex });
        
        const speedDialGeom = new THREE.PlaneGeometry(0.18, 0.18);
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
            new THREE.MeshBasicMaterial({ color: 0xff3300 })
        );
        needleMesh.geometry.translate(0, 0.03, 0);
        needleGroup.add(needleMesh);
        
        // Set initial rotation (0 km/h)
        needleGroup.rotation.z = Math.PI * 0.75;
        this.speedNeedles.push({ mesh: needleGroup });

        // Center Cap Pin
        const capGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.004, 16);
        capGeom.rotateX(Math.PI / 2);
        const capMat = new THREE.MeshBasicMaterial({ color: '#1e293b' });
        const cap = new THREE.Mesh(capGeom, capMat);
        cap.position.set(0, 0, 0.005);
        speedDialMesh.add(cap);

        // Physical Retro Driving Handle (Fahrschalterrad / Lever) - sits on the desk,
        // so it rises with it too (1.14 was the old desk top height)
        const leverGroup = new THREE.Group();
        leverGroup.position.set(-0.55, 1.14 + deskLift, noseZ - cabDir * 0.38);
        cockpitGroup.add(leverGroup);

        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.06, 12), consoleDarkGrey);
        base.position.y = 0.03;
        leverGroup.add(base);

        const handleRod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), this.materials.chromeMetal);
        handleRod.geometry.translate(0, 0.08, 0);
        handleRod.rotation.z = 0.3;
        
        const handleBall = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 }));
        handleBall.position.set(-0.024, 0.16, 0);
        
        const rodGroup = new THREE.Group();
        rodGroup.add(handleRod, handleBall);
        leverGroup.add(rodGroup);

        this.throttleLevers.push({ mesh: rodGroup, cabDir: cabDir });

        // Driver's seat
        const seatGroup = new THREE.Group();
        seatGroup.position.set(-0.25, 0.38, noseZ - cabDir * 0.72);
        cockpitGroup.add(seatGroup);

        const seatPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8), this.materials.chromeMetal);
        seatPedestal.position.y = 0.225;
        
        const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.44), this.materials.dt1SeatGreen);
        seatBase.position.y = 0.48;
        
        // Seat backrest always positioned behind the driver based on cabDir
        const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.06), this.materials.dt1SeatGreen);
        seatBack.position.set(0, 0.70, -cabDir * 0.19);
        
        seatGroup.add(seatPedestal, seatBase, seatBack);

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
            const intBottom = new THREE.Mesh(new THREE.BoxGeometry(0.01, cabWinY0 - 0.375, zLen), this.materials.dt1Wall);
            intBottom.position.set(posX, (0.375 + cabWinY0) / 2, zCenter);
            const intTop = new THREE.Mesh(new THREE.BoxGeometry(0.01, 2.775 - cabWinY1, zLen), this.materials.dt1Wall);
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
            this.materials.bodyWhite
        );
        cabCeilingLining.position.set(0, 2.77, 0);
        roofGroup.add(cabCeilingLining);

        // Cabin Rear Wall partition (retro golden wood grain panels)
        const partitionWallMat = this.materials.dt1Wall;
        const chromeMat = this.materials.chromeMetal;

        const partitionL = new THREE.Mesh(new THREE.BoxGeometry(1.01, 2.075, 0.05), partitionWallMat);
        partitionL.position.set(-0.905, 1.4125, noseZ - cabDir * 1.44);
        
        const partitionR = new THREE.Mesh(new THREE.BoxGeometry(1.01, 2.075, 0.05), partitionWallMat);
        partitionR.position.set(0.905, 1.4125, noseZ - cabDir * 1.44);
        
        const partitionTop = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.325, 0.05), partitionWallMat);
        partitionTop.position.set(0, 2.6125, noseZ - cabDir * 1.44);
        
        // Wood cabin door with rounded window
        const cabinDoorGroup = new THREE.Group();
        cabinDoorGroup.position.set(0, 1.4125, noseZ - cabDir * 1.44);
        cockpitGroup.add(cabinDoorGroup);

        // Door frame panels (wood)
        const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.075, 0.05), partitionWallMat);
        doorL.position.set(-0.29, 0, 0);
        const doorR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.075, 0.05), partitionWallMat);
        doorR.position.set(0.29, 0, 0);
        const doorB = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.0, 0.05), partitionWallMat);
        doorB.position.set(0, -0.5375, 0);
        const doorT = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.175, 0.05), partitionWallMat);
        doorT.position.set(0, 0.95, 0);
        cabinDoorGroup.add(doorL, doorR, doorB, doorT);

        // Rounded door glass
        const doorGlassGeom = this.createRoundedBoxGeometry(0.36, 0.90, 0.02, 0.06);
        const doorGlass = new THREE.Mesh(doorGlassGeom, this.materials.windowGlass);
        doorGlass.position.set(0, 0.4125, 0);
        cabinDoorGroup.add(doorGlass);

        // Chrome bezel (hollow frame geometry to ensure transparency)
        const doorBezelGeom = this.createRoundedFrameGeometry(0.38, 0.66, 0.025, 0.07, 0.02);
        const doorBezel = new THREE.Mesh(doorBezelGeom, chromeMat);
        doorBezel.position.set(0, 0.32, 0.005);
        cabinDoorGroup.add(doorBezel);

        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.12), chromeMat);
        handle.position.set(-0.37, 1.25, noseZ - cabDir * (1.44 - 0.03));

        cockpitGroup.add(partitionL, partitionR, partitionTop, handle);

        // Station display above the cockpit door (passenger side)
        const signOffset = -cabDir * 0.04;
        const displayZ = (noseZ - cabDir * 1.44) + signOffset;

        const displayBacking = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, 0.03), this.materials.bodyDarkGrey);
        displayBacking.position.set(0, 2.12, displayZ);
        cockpitGroup.add(displayBacking);

        const displayScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.12), this.interiorDisplayMat);
        displayScreen.position.set(0, 2.12, displayZ + signOffset * 0.4);
        displayScreen.rotation.y = (cabDir === 1) ? Math.PI : 0;
        cockpitGroup.add(displayScreen);
        this.interiorDisplays.push(displayScreen);
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

    createWoodTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Base wood color
        ctx.fillStyle = '#c27d38'; // nice golden oak/chestnut wood
        ctx.fillRect(0, 0, 128, 128);
        
        // Draw wavy grain lines
        ctx.strokeStyle = '#8c5016';
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
        if (this.geometries.g1MaskNose) return;
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
        // 1435mm wide (real-world display width); Y unchanged since 2.735 already
        // sits at the bottom of the display band, just above the windshield's own
        // top edge (2.61).
        geom = new THREE.PlaneGeometry(1.435, 0.23, 8, 2);
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
        const pillarRows = [1.30, 1.70, 2.10, 2.45];
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
        // Real driver door width = 700mm (z -1.11 to -1.81)
        const doorHolePts = [[-1.11, 0.60], [-1.81, 0.60], [-1.81, 2.40], [-1.11, 2.40]];
        const flankHoles = [{ pts: winPts, r: 0.06 }, { pts: doorHolePts, r: 0.04 }];
        G.g1CabSideL = this.createG1SidePlateGeometry(flankPts, -1, 0.05, 1.40, { holes: flankHoles });
        G.g1CabSideR = this.createG1SidePlateGeometry(flankPts, 1, 0.05, 1.40, { holes: flankHoles });

        const glassBottomY = 1.41, glassTopY = 2.33;
        const glassOrigBottomZ = -0.03, glassOrigRearZ = -0.93;
        const glassShift = (this.g1SideFrontZ(glassBottomY) - 0.05) - glassOrigBottomZ;
        const glassBottomZ = glassOrigBottomZ + glassShift;
        const glassRearZ = glassOrigRearZ + glassShift;
        const glassTopFrontZ = glassOrigBottomZ + winFrontSlope * (glassTopY - glassBottomY) + glassShift;
        const winGlassPts = [[glassBottomZ, glassBottomY], [glassRearZ, glassBottomY], [glassRearZ, glassTopY], [glassTopFrontZ, glassTopY]];
        G.g1CabGlassL = this.createG1SidePlateGeometry(winGlassPts, -1, 0.02, 1.405, { round: 0.09 });
        G.g1CabGlassR = this.createG1SidePlateGeometry(winGlassPts, 1, 0.02, 1.405, { round: 0.09 });

        // --- Red livery on the cab flank (per reference photo): the body's red
        // bottom stripe (y 0.40-0.60) continues forward to the nose bevel, and a
        // red wedge fills the white-band zone between the cab door and the white
        // band's diagonal front edge (45 degrees, top corner at the door's rear
        // edge, running down-rearwards past the body joint at z = -1.90).
        // Front tip is a single straight cut, top-anchored: (0.0995, 0.60)
        // sits flush on flankPts' own value there, and the bottom corner
        // follows flankPts' rising-segment slope (~0.33, from (0.085, 0.57)
        // to (0.211, 0.95)) down from that anchor, landing at z=0.033 at
        // y=0.40 - slightly behind flankPts' own value there (0.085), since
        // flankPts flattens out below y=0.57 while this line keeps the same
        // incline all the way down.
        const redStripePts = [[0.0995, 0.60], [0.033, 0.40], [-1.90, 0.40], [-1.90, 0.60]];
        G.g1CabRedStripeL = this.createG1SidePlateGeometry(redStripePts, -1, 0.052, 1.402);
        G.g1CabRedStripeR = this.createG1SidePlateGeometry(redStripePts, 1, 0.052, 1.402);

        const redWedgePts = [[-1.81, 1.20], [-1.81, 0.60], [-2.41, 0.60]];
        G.g1CabRedWedgeL = this.createG1SidePlateGeometry(redWedgePts, -1, 0.052, 1.402);
        G.g1CabRedWedgeR = this.createG1SidePlateGeometry(redWedgePts, 1, 0.052, 1.402);

        // White sliver completing the white band between the diagonal cut and the
        // body panel joint at z = -1.90
        const whiteTriPts = [[-1.81, 1.20], [-1.90, 1.11], [-1.90, 1.20]];
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
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
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
}
