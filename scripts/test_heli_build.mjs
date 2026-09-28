import * as THREE from 'three';

// Mock DOM & Canvas
global.document = {
    createElement(tag) {
        if (tag === 'canvas') {
            return {
                width: 0,
                height: 0,
                getContext() {
                    return {
                        fillStyle: '',
                        strokeStyle: '',
                        lineWidth: 1,
                        setLineDash() {},
                        fillRect() {},
                        strokeRect() {},
                        fillText() {},
                        beginPath() {},
                        moveTo() {},
                        lineTo() {},
                        arc() {},
                        stroke() {},
                        fill() {},
                        closePath() {},
                        save() {},
                        restore() {},
                        translate() {},
                        rotate() {},
                        rect() {},
                        clip() {},
                        createRadialGradient() {
                            return { addColorStop() {} };
                        }
                    };
                }
            };
        }
        return {};
    }
};

let heliGroup = null;
let heliMainRotorGroup = null;
let heliTailRotorGroup = null;
let heliBlurDiscMesh = null;
let heliTailBlurMesh = null;
let heliCyclicStick = null;
let heliCollectiveLever = null;
let heliMfdCanvas = null;
let heliMfdContext = null;
let heliMfdTexture = null;
let heliStrobeLight = null;
let heliBeaconLight = null;
let heliSearchLight = null;
let heliRemotePilotMesh = null;
let heliHitBox = null;
let helipadMesh = null;

let isFlyingHelicopter = false;
let isHeliFirstPerson = true;
let heliEngineRunning = false;
const HELI_GEAR_Y = 0.45;
let heliPos = new THREE.Vector3(0, 0.45, 36.0);
let heliVelocity = new THREE.Vector3(0, 0, 0);
let heliPitch = 0.0;
let heliRoll = 0.0;
let heliYaw = Math.PI;
let heliRpm = 0.0;
let heliCollective = 0.0;
let heliPilotUid = null;
let heliPilotNick = null;

let remoteHeliTargetPos = new THREE.Vector3(0, 0.45, 36.0);
let remoteHeliTargetPitch = 0.0;
let remoteHeliTargetYaw = Math.PI;
let remoteHeliTargetRoll = 0.0;
let lastHeliNetworkSend = 0;
let lastMfdUpdateTime = 0;

const scene = new THREE.Scene();

function createAW169LiveryTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    return new THREE.CanvasTexture(canvas);
}

function createRotorBlurTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    return new THREE.CanvasTexture(canvas);
}

function createCockpitMFDTexture() {
    heliMfdCanvas = document.createElement("canvas");
    heliMfdCanvas.width = 1024;
    heliMfdCanvas.height = 512;
    heliMfdContext = heliMfdCanvas.getContext("2d");
    heliMfdTexture = new THREE.CanvasTexture(heliMfdCanvas);
    updateCockpitMFDs(0, 0, Math.PI, 0, 0, 0, 0);
    return heliMfdTexture;
}

function updateCockpitMFDs(pitch, roll, yaw, rpm, collective, altitude, speed) {
    if (!heliMfdContext) return;
    if (heliMfdTexture) heliMfdTexture.needsUpdate = true;
}

function buildHelipad() {
    const padGeo = new THREE.CylinderGeometry(7.0, 7.0, 0.04, 48);
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const padTex = new THREE.CanvasTexture(canvas);
    const padMat = new THREE.MeshStandardMaterial({ map: padTex });
    helipadMesh = new THREE.Mesh(padGeo, padMat);
    helipadMesh.position.set(0, 0.015, 36.0);
    scene.add(helipadMesh);

    const ledGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x22c55e });
    for (let i = 0; i < 8; i++) {
        const ang = i * ((Math.PI * 2) / 8);
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.set(Math.cos(ang) * 6.8, 0.07, 36.0 + Math.sin(ang) * 6.8);
        scene.add(led);
    }
    const padLight = new THREE.PointLight(0x22c55e, 1.2, 18, 1.5);
    padLight.position.set(0, 1.2, 36.0);
    scene.add(padLight);
}

function buildAW169Helicopter() {
    heliGroup = new THREE.Group();
    heliGroup.name = "AW169_SERVERAUFSICHT";

    const liveryTex = createAW169LiveryTexture();
    const blurTex = createRotorBlurTexture();
    const mfdTex = createCockpitMFDTexture();

    const matGlossWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc });
    const matLivery = new THREE.MeshStandardMaterial({ map: liveryTex });
    const matDarkGraphite = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    const matCrimson = new THREE.MeshStandardMaterial({ color: 0xdc2626 });
    const matTitanium = new THREE.MeshStandardMaterial({ color: 0x475569 });
    const matCanopyGlass = new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.36 });
    const matCanopyFrame = new THREE.MeshStandardMaterial({ color: 0x0f172a });
    const matRotorBlade = new THREE.MeshStandardMaterial({ color: 0x111827 });
    const matYellowTip = new THREE.MeshStandardMaterial({ color: 0xfacc15 });
    const matTireRubber = new THREE.MeshStandardMaterial({ color: 0x1c1917 });
    const matAlloyRim = new THREE.MeshStandardMaterial({ color: 0xcbd5e1 });
    const matSeatLeather = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    const matMFD = new THREE.MeshStandardMaterial({ map: mfdTex });
    const matBlurDisc = new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, opacity: 0.0 });

    const cabinGeo = new THREE.BoxGeometry(2.25, 1.85, 4.0);
    const cabin = new THREE.Mesh(cabinGeo, matLivery);
    cabin.position.set(0, 1.35, 0.4);
    heliGroup.add(cabin);

    const bellyGeo = new THREE.BoxGeometry(2.1, 0.32, 3.8);
    const belly = new THREE.Mesh(bellyGeo, matDarkGraphite);
    belly.position.set(0, 0.48, 0.4);
    heliGroup.add(belly);

    const noseGroup = new THREE.Group();
    noseGroup.position.set(0, 1.18, 2.4);
    const noseConeGeo = new THREE.ConeGeometry(1.05, 2.0, 24);
    noseConeGeo.rotateX(Math.PI / 2);
    const noseCone = new THREE.Mesh(noseConeGeo, matGlossWhite);
    noseCone.scale.set(1.07, 0.85, 1.0);
    noseCone.position.set(0, 0, 1.0);
    noseGroup.add(noseCone);

    const radomeGeo = new THREE.SphereGeometry(0.24, 18, 18);
    const radome = new THREE.Mesh(radomeGeo, matDarkGraphite);
    radome.position.set(0, -0.05, 2.02);
    noseGroup.add(radome);

    [-0.45, 0.45].forEach(sideX => {
        const chinGeo = new THREE.BoxGeometry(0.38, 0.32, 0.65);
        const chinWin = new THREE.Mesh(chinGeo, matCanopyGlass);
        chinWin.position.set(sideX, -0.22, 1.15);
        chinWin.rotation.x = 0.28;
        noseGroup.add(chinWin);
    });
    heliGroup.add(noseGroup);

    const canopyGeo = new THREE.BoxGeometry(2.16, 0.95, 2.15);
    const canopy = new THREE.Mesh(canopyGeo, matCanopyGlass);
    canopy.position.set(0, 1.84, 1.85);
    canopy.rotation.x = -0.16;
    heliGroup.add(canopy);

    const frameGeo = new THREE.BoxGeometry(0.08, 0.98, 2.18);
    const centerFrame = new THREE.Mesh(frameGeo, matCanopyFrame);
    centerFrame.position.set(0, 1.84, 1.85);
    centerFrame.rotation.x = -0.16;
    heliGroup.add(centerFrame);

    const doghouseGeo = new THREE.BoxGeometry(1.68, 0.65, 3.1);
    const doghouse = new THREE.Mesh(doghouseGeo, matGlossWhite);
    doghouse.position.set(0, 2.45, 0.1);
    heliGroup.add(doghouse);

    [-0.48, 0.48].forEach(x => {
        const intakeGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.45, 18);
        intakeGeo.rotateX(Math.PI / 2);
        const intake = new THREE.Mesh(intakeGeo, matDarkGraphite);
        intake.position.set(x, 2.50, 1.62);
        heliGroup.add(intake);

        const spinnerGeo = new THREE.ConeGeometry(0.08, 0.24, 12);
        spinnerGeo.rotateX(Math.PI / 2);
        const spinner = new THREE.Mesh(spinnerGeo, matTitanium);
        spinner.position.set(x, 2.50, 1.70);
        heliGroup.add(spinner);
    });

    [-0.42, 0.42].forEach(x => {
        const exhaustGeo = new THREE.CylinderGeometry(0.18, 0.21, 0.65, 18);
        exhaustGeo.rotateX(Math.PI / 2);
        const exhaust = new THREE.Mesh(exhaustGeo, matTitanium);
        exhaust.position.set(x, 2.42, -1.48);
        exhaust.rotation.x = 0.28;
        exhaust.rotation.y = x > 0 ? 0.35 : -0.35;
        heliGroup.add(exhaust);
    });

    const boomGeo = new THREE.CylinderGeometry(0.22, 0.58, 7.2, 18);
    boomGeo.rotateX(Math.PI / 2);
    const boom = new THREE.Mesh(boomGeo, matGlossWhite);
    boom.position.set(0, 1.48, -5.2);
    heliGroup.add(boom);

    const finGeo = new THREE.BoxGeometry(0.18, 2.3, 1.55);
    const fin = new THREE.Mesh(finGeo, matGlossWhite);
    fin.position.set(0, 2.52, -8.78);
    fin.rotation.x = -0.38;
    heliGroup.add(fin);

    const stabGeo = new THREE.BoxGeometry(2.8, 0.08, 0.54);
    const stab = new THREE.Mesh(stabGeo, matGlossWhite);
    stab.position.set(0, 1.48, -7.4);
    heliGroup.add(stab);

    [-1.4, 1.4].forEach(x => {
        const endplateGeo = new THREE.BoxGeometry(0.06, 0.78, 0.50);
        const endplate = new THREE.Mesh(endplateGeo, matCrimson);
        endplate.position.set(x, 1.48, -7.4);
        endplate.rotation.z = x > 0 ? -0.28 : 0.28;
        heliGroup.add(endplate);
    });

    const skidGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8);
    skidGeo.rotateX(Math.PI / 4);
    const skid = new THREE.Mesh(skidGeo, matTitanium);
    skid.position.set(0, 0.65, -8.6);
    heliGroup.add(skid);

    heliMainRotorGroup = new THREE.Group();
    heliMainRotorGroup.position.set(0, 3.32, 0.45);
    heliGroup.add(heliMainRotorGroup);

    const mastGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.72, 16);
    const mast = new THREE.Mesh(mastGeo, matTitanium);
    mast.position.set(0, -0.25, 0);
    heliMainRotorGroup.add(mast);

    const hubGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.24, 10);
    heliMainRotorGroup.add(new THREE.Mesh(hubGeo, matTitanium));

    for (let i = 0; i < 5; i++) {
        const bladeArm = new THREE.Group();
        bladeArm.rotation.y = i * ((Math.PI * 2) / 5);

        const hingeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.38, 8);
        hingeGeo.rotateZ(Math.PI / 2);
        const hinge = new THREE.Mesh(hingeGeo, matTitanium);
        hinge.position.set(0, 0, 0.42);
        bladeArm.add(hinge);

        const bladeBodyGeo = new THREE.BoxGeometry(0.32, 0.038, 4.6);
        const bladeBody = new THREE.Mesh(bladeBodyGeo, matRotorBlade);
        bladeBody.position.set(0, 0, 2.85);
        bladeArm.add(bladeBody);

        const redBandGeo = new THREE.BoxGeometry(0.322, 0.039, 0.15);
        const redBand = new THREE.Mesh(redBandGeo, matCrimson);
        redBand.position.set(0, 0, 5.0);
        bladeArm.add(redBand);

        const tipGeo = new THREE.BoxGeometry(0.32, 0.038, 0.65);
        const tip = new THREE.Mesh(tipGeo, matYellowTip);
        tip.position.set(0, 0, 5.35);
        bladeArm.add(tip);

        heliMainRotorGroup.add(bladeArm);
    }

    const blurDiscGeo = new THREE.CircleGeometry(5.72, 36);
    blurDiscGeo.rotateX(-Math.PI / 2);
    heliBlurDiscMesh = new THREE.Mesh(blurDiscGeo, matBlurDisc);
    heliBlurDiscMesh.position.set(0, 0.06, 0);
    heliMainRotorGroup.add(heliBlurDiscMesh);

    heliTailRotorGroup = new THREE.Group();
    heliTailRotorGroup.position.set(0.28, 3.08, -9.18);
    heliGroup.add(heliTailRotorGroup);

    const tHubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.15, 8);
    tHubGeo.rotateZ(Math.PI / 2);
    heliTailRotorGroup.add(new THREE.Mesh(tHubGeo, matTitanium));

    for (let i = 0; i < 4; i++) {
        const tArm = new THREE.Group();
        tArm.rotation.x = i * (Math.PI / 2);

        const tBladeGeo = new THREE.BoxGeometry(0.035, 0.95, 0.14);
        const tBlade = new THREE.Mesh(tBladeGeo, matRotorBlade);
        tBlade.position.set(0, 0.48, 0);
        tArm.add(tBlade);

        const tTipGeo = new THREE.BoxGeometry(0.036, 0.22, 0.14);
        const tTip = new THREE.Mesh(tTipGeo, matYellowTip);
        tTip.position.set(0, 0.92, 0);
        tArm.add(tTip);

        heliTailRotorGroup.add(tArm);
    }

    const tBlurGeo = new THREE.CircleGeometry(1.05, 24);
    tBlurGeo.rotateY(Math.PI / 2);
    heliTailBlurMesh = new THREE.Mesh(tBlurGeo, matBlurDisc.clone());
    heliTailRotorGroup.add(heliTailBlurMesh);

    [-1.25, 1.25].forEach(x => {
        const sponsonGeo = new THREE.BoxGeometry(0.52, 0.48, 2.3);
        const sponson = new THREE.Mesh(sponsonGeo, matGlossWhite);
        sponson.position.set(x, 0.55, 0.2);
        heliGroup.add(sponson);

        const strutGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8);
        const strut = new THREE.Mesh(strutGeo, matTitanium);
        strut.position.set(x, 0.35, 0.2);
        heliGroup.add(strut);

        const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 18);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheel = new THREE.Mesh(wheelGeo, matTireRubber);
        wheel.position.set(x, 0.24, 0.2);
        heliGroup.add(wheel);

        const rimGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.17, 12);
        rimGeo.rotateZ(Math.PI / 2);
        const rim = new THREE.Mesh(rimGeo, matAlloyRim);
        rim.position.set(x, 0.24, 0.2);
        heliGroup.add(rim);
    });

    const nStrutGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8);
    const nStrut = new THREE.Mesh(nStrutGeo, matTitanium);
    nStrut.position.set(0, 0.32, 3.35);
    heliGroup.add(nStrut);

    [-0.12, 0.12].forEach(x => {
        const nWheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.10, 16);
        nWheelGeo.rotateZ(Math.PI / 2);
        const nWheel = new THREE.Mesh(nWheelGeo, matTireRubber);
        nWheel.position.set(x, 0.18, 3.35);
        heliGroup.add(nWheel);
    });

    const cockpitGroup = new THREE.Group();
    const floorGeo = new THREE.BoxGeometry(2.1, 0.08, 2.2);
    const cFloor = new THREE.Mesh(floorGeo, matDarkGraphite);
    cFloor.position.set(0, 0.65, 2.3);
    cockpitGroup.add(cFloor);

    const bulkheadGeo = new THREE.BoxGeometry(2.1, 1.5, 0.1);
    const bulkhead = new THREE.Mesh(bulkheadGeo, matDarkGraphite);
    bulkhead.position.set(0, 1.4, 1.25);
    cockpitGroup.add(bulkhead);

    [-0.45, 0.45].forEach(x => {
        const seatGroup = new THREE.Group();
        seatGroup.position.set(x, 0.72, 2.35);
        const baseGeo = new THREE.BoxGeometry(0.52, 0.16, 0.55);
        seatGroup.add(new THREE.Mesh(baseGeo, matSeatLeather));
        const backGeo = new THREE.BoxGeometry(0.50, 0.75, 0.12);
        const back = new THREE.Mesh(backGeo, matSeatLeather);
        back.position.set(0, 0.40, -0.22);
        seatGroup.add(back);
        const headGeo = new THREE.BoxGeometry(0.28, 0.22, 0.10);
        const head = new THREE.Mesh(headGeo, matSeatLeather);
        head.position.set(0, 0.82, -0.22);
        seatGroup.add(head);
        cockpitGroup.add(seatGroup);
    });

    const panelGeo = new THREE.BoxGeometry(1.65, 0.52, 0.15);
    const panel = new THREE.Mesh(panelGeo, matDarkGraphite);
    panel.position.set(0, 1.25, 3.15);
    panel.rotation.x = -0.25;
    cockpitGroup.add(panel);

    const mfdScreenGeo = new THREE.PlaneGeometry(1.52, 0.45);
    const mfdScreen = new THREE.Mesh(mfdScreenGeo, matMFD);
    mfdScreen.position.set(0, 1.26, 3.23);
    mfdScreen.rotation.x = -0.25;
    cockpitGroup.add(mfdScreen);

    heliCyclicStick = new THREE.Group();
    heliCyclicStick.position.set(0.45, 0.75, 2.75);
    const stickGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8);
    const stick = new THREE.Mesh(stickGeo, matTitanium);
    stick.position.set(0, 0.22, 0);
    heliCyclicStick.add(stick);
    const gripGeo = new THREE.BoxGeometry(0.06, 0.12, 0.08);
    const grip = new THREE.Mesh(gripGeo, matDarkGraphite);
    grip.position.set(0, 0.44, 0);
    heliCyclicStick.add(grip);
    cockpitGroup.add(heliCyclicStick);

    heliCollectiveLever = new THREE.Group();
    heliCollectiveLever.position.set(0.12, 0.75, 2.35);
    const leverGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8);
    leverGeo.rotateX(Math.PI / 4);
    const lever = new THREE.Mesh(leverGeo, matTitanium);
    lever.position.set(0, 0.12, 0.12);
    heliCollectiveLever.add(lever);
    cockpitGroup.add(heliCollectiveLever);

    heliRemotePilotMesh = new THREE.Group();
    heliRemotePilotMesh.position.set(0.45, 0.85, 2.35);
    const rPilotTorso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.50, 0.28), new THREE.MeshStandardMaterial({ color: 0x3b82f6 }));
    rPilotTorso.position.set(0, 0.25, 0);
    heliRemotePilotMesh.add(rPilotTorso);
    const rPilotHead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
    rPilotHead.position.set(0, 0.60, 0);
    heliRemotePilotMesh.add(rPilotHead);
    heliRemotePilotMesh.visible = false;
    cockpitGroup.add(heliRemotePilotMesh);

    heliGroup.add(cockpitGroup);

    const redNavGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const redNav = new THREE.Mesh(redNavGeo, new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    redNav.position.set(-1.48, 0.60, 0.2);
    heliGroup.add(redNav);

    const greenNavGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const greenNav = new THREE.Mesh(greenNavGeo, new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    greenNav.position.set(1.48, 0.60, 0.2);
    heliGroup.add(greenNav);

    const strobeGeo = new THREE.SphereGeometry(0.06, 8, 8);
    heliStrobeLight = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    heliStrobeLight.position.set(0, 3.65, -9.45);
    heliGroup.add(heliStrobeLight);

    const beaconGeo = new THREE.SphereGeometry(0.06, 8, 8);
    heliBeaconLight = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xdc2626 }));
    heliBeaconLight.position.set(0, 0.36, 0.4);
    heliGroup.add(heliBeaconLight);

    heliSearchLight = new THREE.SpotLight(0xfffaed, 0, 120, Math.PI / 6, 0.35, 1.2);
    heliSearchLight.position.set(0, 0.45, 3.8);
    heliSearchLight.target.position.set(0, -10.0, 35.0);
    heliGroup.add(heliSearchLight);
    heliGroup.add(heliSearchLight.target);

    const hitBoxGeo = new THREE.BoxGeometry(3.5, 3.2, 8.5);
    const hitBoxMat = new THREE.MeshBasicMaterial({ visible: false });
    heliHitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
    heliHitBox.position.set(0, 1.8, 0.8);
    heliHitBox.userData = { isHelicopter: true };
    heliGroup.add(heliHitBox);

    heliGroup.position.copy(heliPos);
    heliGroup.rotation.set(0, heliYaw, 0);

    scene.add(heliGroup);
    return heliGroup;
}

try {
    console.log("Testing buildHelipad()...");
    buildHelipad();
    console.log("buildHelipad() success!");

    console.log("Testing buildAW169Helicopter()...");
    buildAW169Helicopter();
    console.log("buildAW169Helicopter() success!");
    console.log("Total objects in scene:", scene.children.length);
} catch (err) {
    console.error("FAILED with error:", err);
    process.exit(1);
}
