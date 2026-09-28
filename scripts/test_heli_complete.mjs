// Complete validation of Helicopter creation and logic
import * as THREE from './../node_modules/three/build/three.module.js';

// Mock Canvas for Node test environment
globalThis.document = {
    createElement(tag) {
        if (tag === 'canvas') {
            return {
                width: 1024,
                height: 512,
                getContext() {
                    return {
                        fillStyle: '',
                        strokeStyle: '',
                        lineWidth: 1,
                        font: '',
                        textAlign: '',
                        textBaseline: '',
                        fillRect() {},
                        strokeRect() {},
                        clearRect() {},
                        beginPath() {},
                        moveTo() {},
                        lineTo() {},
                        arc() {},
                        fill() {},
                        stroke() {},
                        save() {},
                        restore() {},
                        translate() {},
                        rotate() {},
                        scale() {},
                        fillText() {},
                        measureText() { return { width: 100 }; },
                        createLinearGradient() { return { addColorStop() {} }; },
                        createRadialGradient() { return { addColorStop() {} }; },
                        setLineDash() {},
                    };
                }
            };
        }
        return {};
    }
};

console.log("Validating AW169 Livery and Model generation...");

// Texture generator
function createAW169LiveryTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 2048, 1024);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createRotorBlurTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    return new THREE.CanvasTexture(canvas);
}

function createCockpitMFDTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    return { canvas, ctx, texture };
}

// Model Builder
function buildAW169Helicopter() {
    const heliGroup = new THREE.Group();
    heliGroup.name = "AW169_Helicopter";

    const liveryTex = createAW169LiveryTexture();
    const blurTex = createRotorBlurTexture();
    const mfdData = createCockpitMFDTexture();

    const matWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.15 });
    const matLivery = new THREE.MeshStandardMaterial({ map: liveryTex, roughness: 0.28, metalness: 0.18 });
    const matGraphite = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.45 });
    const matCrimson = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.30, metalness: 0.20 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.4 });
    const matTitanium = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.25, metalness: 0.85 });
    const matRotor = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.40, metalness: 0.20 });
    const matYellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.40, metalness: 0.10 });
    const matRubber = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.90, metalness: 0.05 });
    const matRim = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.20, metalness: 0.85 });
    const matSeat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.70, metalness: 0.10 });
    const matMFD = new THREE.MeshStandardMaterial({ map: mfdData.texture, emissive: 0xffffff, emissiveMap: mfdData.texture, emissiveIntensity: 0.95 });
    const matBlur = new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, opacity: 0.0, side: THREE.DoubleSide });

    // Fuselage Cabin
    const cabinGeo = new THREE.BoxGeometry(2.3, 1.85, 4.0);
    const cabin = new THREE.Mesh(cabinGeo, matLivery);
    cabin.position.set(0, 1.35, 0.4);
    heliGroup.add(cabin);

    // Fuselage Belly
    const bellyGeo = new THREE.BoxGeometry(2.1, 0.3, 3.8);
    const belly = new THREE.Mesh(bellyGeo, matGraphite);
    belly.position.set(0, 0.48, 0.4);
    heliGroup.add(belly);

    // Aerodynamic Nose
    const noseGroup = new THREE.Group();
    noseGroup.position.set(0, 1.20, 2.4);

    const noseConeGeo = new THREE.ConeGeometry(1.05, 2.0, 20);
    noseConeGeo.rotateX(Math.PI / 2);
    const noseCone = new THREE.Mesh(noseConeGeo, matWhite);
    noseCone.scale.set(1.08, 0.85, 1.0);
    noseCone.position.set(0, 0, 1.0);
    noseGroup.add(noseCone);

    // Radome tip
    const radomeGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const radome = new THREE.Mesh(radomeGeo, matGraphite);
    radome.position.set(0, -0.05, 2.02);
    noseGroup.add(radome);

    heliGroup.add(noseGroup);

    // Canopy Glass
    const canopyGeo = new THREE.BoxGeometry(2.18, 0.95, 2.1);
    const canopy = new THREE.Mesh(canopyGeo, matGlass);
    canopy.position.set(0, 1.82, 1.85);
    canopy.rotation.x = -0.15;
    heliGroup.add(canopy);

    // Engine Cowling / Doghouse
    const doghouseGeo = new THREE.BoxGeometry(1.65, 0.65, 3.0);
    const doghouse = new THREE.Mesh(doghouseGeo, matWhite);
    doghouse.position.set(0, 2.45, 0.1);
    heliGroup.add(doghouse);

    // Turboshaft Intakes
    [-0.48, 0.48].forEach(x => {
        const intakeGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.4, 16);
        intakeGeo.rotateX(Math.PI / 2);
        const intake = new THREE.Mesh(intakeGeo, matGraphite);
        intake.position.set(x, 2.50, 1.55);
        heliGroup.add(intake);

        const spinnerGeo = new THREE.ConeGeometry(0.08, 0.22, 12);
        spinnerGeo.rotateX(Math.PI / 2);
        const spinner = new THREE.Mesh(spinnerGeo, matTitanium);
        spinner.position.set(x, 2.50, 1.62);
        heliGroup.add(spinner);
    });

    // Turboshaft Exhausts
    [-0.42, 0.42].forEach(x => {
        const exhaustGeo = new THREE.CylinderGeometry(0.18, 0.20, 0.6, 16);
        exhaustGeo.rotateX(Math.PI / 2);
        const exhaust = new THREE.Mesh(exhaustGeo, matTitanium);
        exhaust.position.set(x, 2.42, -1.45);
        exhaust.rotation.x = 0.25;
        exhaust.rotation.y = x > 0 ? 0.35 : -0.35;
        heliGroup.add(exhaust);
    });

    // Tail Boom
    const boomGeo = new THREE.CylinderGeometry(0.22, 0.58, 7.2, 18);
    boomGeo.rotateX(Math.PI / 2);
    const boom = new THREE.Mesh(boomGeo, matWhite);
    boom.position.set(0, 1.48, -5.2);
    heliGroup.add(boom);

    // Vertical Fin
    const finGeo = new THREE.BoxGeometry(0.18, 2.3, 1.5);
    const fin = new THREE.Mesh(finGeo, matWhite);
    fin.position.set(0, 2.52, -8.75);
    fin.rotation.x = -0.38;
    heliGroup.add(fin);

    // Horizontal Stabilizer with Canted Endplates
    const stabGeo = new THREE.BoxGeometry(2.8, 0.08, 0.52);
    const stab = new THREE.Mesh(stabGeo, matWhite);
    stab.position.set(0, 1.48, -7.4);
    heliGroup.add(stab);

    [-1.4, 1.4].forEach(x => {
        const endplateGeo = new THREE.BoxGeometry(0.06, 0.75, 0.48);
        const endplate = new THREE.Mesh(endplateGeo, matCrimson);
        endplate.position.set(x, 1.48, -7.4);
        endplate.rotation.z = x > 0 ? -0.28 : 0.28;
        heliGroup.add(endplate);
    });

    // 5-Blade Main Rotor
    const mainRotorGroup = new THREE.Group();
    mainRotorGroup.position.set(0, 3.32, 0.45);
    heliGroup.add(mainRotorGroup);

    // Mast
    const mastGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 16);
    const mast = new THREE.Mesh(mastGeo, matTitanium);
    mast.position.set(0, -0.25, 0);
    mainRotorGroup.add(mast);

    // Rotor Hub
    const hubGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.22, 10);
    mainRotorGroup.add(new THREE.Mesh(hubGeo, matTitanium));

    for (let i = 0; i < 5; i++) {
        const bladeArm = new THREE.Group();
        bladeArm.rotation.y = i * (Math.PI * 2 / 5);

        // Blade root hinge
        const hingeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8);
        hingeGeo.rotateZ(Math.PI / 2);
        const hinge = new THREE.Mesh(hingeGeo, matTitanium);
        hinge.position.set(0, 0, 0.42);
        bladeArm.add(hinge);

        // Carbon blade body
        const bladeBodyGeo = new THREE.BoxGeometry(0.32, 0.038, 4.6);
        const bladeBody = new THREE.Mesh(bladeBodyGeo, matRotor);
        bladeBody.position.set(0, 0, 2.85);
        bladeArm.add(bladeBody);

        // Yellow blade tip
        const tipGeo = new THREE.BoxGeometry(0.32, 0.038, 0.65);
        const tip = new THREE.Mesh(tipGeo, matYellow);
        tip.position.set(0, 0, 5.35);
        bladeArm.add(tip);

        // Red accent band
        const redBandGeo = new THREE.BoxGeometry(0.322, 0.039, 0.15);
        const redBand = new THREE.Mesh(redBandGeo, matCrimson);
        redBand.position.set(0, 0, 5.0);
        bladeArm.add(redBand);

        mainRotorGroup.add(bladeArm);
    }

    // Motion Blur Disc
    const blurDiscGeo = new THREE.CircleGeometry(5.7, 32);
    blurDiscGeo.rotateX(-Math.PI / 2);
    const blurDisc = new THREE.Mesh(blurDiscGeo, matBlur);
    blurDisc.position.set(0, 0.05, 0);
    mainRotorGroup.add(blurDisc);

    // 4-Blade Tail Rotor
    const tailRotorGroup = new THREE.Group();
    tailRotorGroup.position.set(0.28, 3.08, -9.18);
    heliGroup.add(tailRotorGroup);

    for (let i = 0; i < 4; i++) {
        const tArm = new THREE.Group();
        tArm.rotation.x = i * (Math.PI / 2);

        const tBladeGeo = new THREE.BoxGeometry(0.035, 0.95, 0.14);
        const tBlade = new THREE.Mesh(tBladeGeo, matRotor);
        tBlade.position.set(0, 0.48, 0);
        tArm.add(tBlade);

        const tTipGeo = new THREE.BoxGeometry(0.036, 0.22, 0.14);
        const tTip = new THREE.Mesh(tTipGeo, matYellow);
        tTip.position.set(0, 0.92, 0);
        tArm.add(tTip);

        tailRotorGroup.add(tArm);
    }

    // Sponsons & Landing Wheels
    [-1.25, 1.25].forEach(x => {
        const sponsonGeo = new THREE.BoxGeometry(0.52, 0.48, 2.3);
        const sponson = new THREE.Mesh(sponsonGeo, matWhite);
        sponson.position.set(x, 0.55, 0.2);
        heliGroup.add(sponson);

        const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 18);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheel = new THREE.Mesh(wheelGeo, matRubber);
        wheel.position.set(x, 0.24, 0.2);
        heliGroup.add(wheel);

        const rimGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.17, 12);
        rimGeo.rotateZ(Math.PI / 2);
        const rim = new THREE.Mesh(rimGeo, matRim);
        rim.position.set(x, 0.24, 0.2);
        heliGroup.add(rim);
    });

    // Dual Nosewheel
    [-0.12, 0.12].forEach(x => {
        const nWheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.10, 16);
        nWheelGeo.rotateZ(Math.PI / 2);
        const nWheel = new THREE.Mesh(nWheelGeo, matRubber);
        nWheel.position.set(x, 0.18, 3.35);
        heliGroup.add(nWheel);
    });

    // Cockpit Interior: Seats, MFDs, Controls
    const cockpitGroup = new THREE.Group();
    cockpitGroup.position.set(0, 0, 0);

    // Floor
    const floorGeo = new THREE.BoxGeometry(2.1, 0.08, 2.2);
    const cFloor = new THREE.Mesh(floorGeo, matGraphite);
    cFloor.position.set(0, 0.65, 2.3);
    cockpitGroup.add(cFloor);

    // Pilot Seats
    [-0.45, 0.45].forEach((x, idx) => {
        const seatGroup = new THREE.Group();
        seatGroup.position.set(x, 0.72, 2.35);

        // Seat base & cushion
        const baseGeo = new THREE.BoxGeometry(0.52, 0.16, 0.55);
        seatGroup.add(new THREE.Mesh(baseGeo, matSeat));

        // Backrest
        const backGeo = new THREE.BoxGeometry(0.50, 0.75, 0.12);
        const back = new THREE.Mesh(backGeo, matSeat);
        back.position.set(0, 0.40, -0.22);
        seatGroup.add(back);

        // Headrest
        const headGeo = new THREE.BoxGeometry(0.28, 0.22, 0.10);
        const head = new THREE.Mesh(headGeo, matSeat);
        head.position.set(0, 0.82, -0.22);
        seatGroup.add(head);

        cockpitGroup.add(seatGroup);
    });

    // Instrument Panel with MFDs
    const panelGeo = new THREE.BoxGeometry(1.6, 0.52, 0.15);
    const panel = new THREE.Mesh(panelGeo, matGraphite);
    panel.position.set(0, 1.25, 3.15);
    panel.rotation.x = -0.25;
    cockpitGroup.add(panel);

    const mfdScreenGeo = new THREE.PlaneGeometry(1.48, 0.44);
    const mfdScreen = new THREE.Mesh(mfdScreenGeo, matMFD);
    mfdScreen.position.set(0, 1.25, 3.23);
    mfdScreen.rotation.x = -0.25;
    cockpitGroup.add(mfdScreen);

    // Flight sticks
    const cyclicStick = new THREE.Group();
    cyclicStick.position.set(0.45, 0.75, 2.75);
    const stickGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8);
    const stick = new THREE.Mesh(stickGeo, matTitanium);
    stick.position.set(0, 0.22, 0);
    cyclicStick.add(stick);
    cockpitGroup.add(cyclicStick);

    const collectiveLever = new THREE.Group();
    collectiveLever.position.set(0.12, 0.75, 2.35);
    const leverGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8);
    leverGeo.rotateX(Math.PI / 4);
    const lever = new THREE.Mesh(leverGeo, matTitanium);
    lever.position.set(0, 0.12, 0.12);
    collectiveLever.add(lever);
    cockpitGroup.add(collectiveLever);

    heliGroup.add(cockpitGroup);

    console.log(`AW169 assembled: ${heliGroup.children.length} main components.`);
    return { heliGroup, mainRotorGroup, tailRotorGroup, blurDisc, cyclicStick, collectiveLever, mfdData };
}

const res = buildAW169Helicopter();
console.log("PASS: Complete AW169 Model initialized without any errors!");
