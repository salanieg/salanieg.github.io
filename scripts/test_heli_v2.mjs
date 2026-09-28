import * as THREE from 'three';

// Mock DOM
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
                        createRadialGradient() { return { addColorStop() {} }; }
                    };
                }
            };
        }
        return {};
    }
};

const scene = new THREE.Scene();
const seats = [];
const seatMeshes = [];
const heliPassengerSeats = [];

let heliGroup = null;
let heliMainRotorGroup = null;
let heliTailRotorGroup = null;

// Flugphysik State (Arcade)
let heliPos = new THREE.Vector3(0, 0.45, 36.0);
let heliVelocity = new THREE.Vector3(0, 0, 0);
let heliPitch = 0.0;
let heliRoll = 0.0;
let heliYaw = Math.PI;
let heliRpm = 0.0;
let isFlyingHelicopter = false;

const heliMoveState = {
    forward: false,   // W
    backward: false,  // S
    left: false,      // A
    right: false,     // D
    ascend: false,    // Space
    descend: false,   // Shift
    yawLeft: false,   // Q
    yawRight: false   // E
};

function buildCleanHelicopter() {
    heliGroup = new THREE.Group();
    heliGroup.name = "AW169_SERVERAUFSICHT";

    // Materialien
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.1 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.3 });
    const matCrimson = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, metalness: 0.1 });
    const matMetal = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.2, metalness: 0.8 });
    const matBlade = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.2 });
    const matSeat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.7, metalness: 0.1 });
    
    // Nicht getöntes, kristallklares Glas für maximale Cockpit-Sicht
    const matClearGlass = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.02,
        metalness: 0.05,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    // 1. Rumpfboden (Floor)
    const floorGeo = new THREE.BoxGeometry(2.1, 0.10, 5.2);
    const floorMesh = new THREE.Mesh(floorGeo, matDark);
    floorMesh.position.set(0, 0.45, 0.3);
    heliGroup.add(floorMesh);

    // Rumpfdach (Ceiling)
    const roofGeo = new THREE.BoxGeometry(2.1, 0.10, 4.4);
    const roofMesh = new THREE.Mesh(roofGeo, matWhite);
    roofMesh.position.set(0, 2.05, 0.0);
    heliGroup.add(roofMesh);

    // Heckwand der Kabine (Rear Bulkhead)
    const rearWallGeo = new THREE.BoxGeometry(2.1, 1.5, 0.10);
    const rearWall = new THREE.Mesh(rearWallGeo, matWhite);
    rearWall.position.set(0, 1.25, -2.2);
    heliGroup.add(rearWall);

    // 2. Unterer Rumpfkörper (Belly Sponson)
    const bellyGeo = new THREE.BoxGeometry(2.15, 0.25, 4.8);
    const belly = new THREE.Mesh(bellyGeo, matDark);
    belly.position.set(0, 0.32, 0.3);
    heliGroup.add(belly);

    // 3. Cockpit Panorama-Glas & Nase
    // Große klare Front-Windschutzscheibe (stark geneigt für Aerodynamik & freie Rundumsicht)
    const windshieldGeo = new THREE.BoxGeometry(2.02, 1.45, 0.06);
    windshieldGeo.rotateX(-0.48);
    const windshield = new THREE.Mesh(windshieldGeo, matClearGlass);
    windshield.position.set(0, 1.38, 2.38);
    heliGroup.add(windshield);

    // Dach-Sichtfenster (Überkopf-Verglasung für freie Sicht nach oben)
    const overheadGlassGeo = new THREE.BoxGeometry(1.85, 0.06, 0.95);
    const overheadGlass = new THREE.Mesh(overheadGlassGeo, matClearGlass);
    overheadGlass.position.set(0, 2.06, 1.85);
    heliGroup.add(overheadGlass);

    // Unteres Kinnfenster (Chin Window für Blick auf Helipad / Landung)
    const chinGlassGeo = new THREE.BoxGeometry(1.85, 0.40, 0.06);
    chinGlassGeo.rotateX(0.25);
    const chinGlass = new THREE.Mesh(chinGlassGeo, matClearGlass);
    chinGlass.position.set(0, 0.68, 2.78);
    heliGroup.add(chinGlass);

    // Abgerundete Kanzelnase (Vorderer Stoßfänger unter der Scheibe)
    const noseGeo = new THREE.BoxGeometry(2.1, 0.40, 0.65);
    const nose = new THREE.Mesh(noseGeo, matWhite);
    nose.position.set(0, 0.68, 2.5);
    heliGroup.add(nose);

    // Seitenfenster Cockpit & Kabine (durchgehend transparent)
    [-1.04, 1.04].forEach(x => {
        // Große klare Seitenscheibe
        const sideWindowGeo = new THREE.BoxGeometry(0.04, 1.15, 3.8);
        const sideWindow = new THREE.Mesh(sideWindowGeo, matClearGlass);
        sideWindow.position.set(x, 1.35, 0.3);
        heliGroup.add(sideWindow);

        // Untere Kabinen-Außenwand mit Serveraufsicht-Lackierung
        const sidePanelGeo = new THREE.BoxGeometry(0.06, 0.35, 4.2);
        const sidePanel = new THREE.Mesh(sidePanelGeo, matWhite);
        sidePanel.position.set(x, 0.65, 0.1);
        heliGroup.add(sidePanel);

        // A-Säule / Fensterstrebe vorne
        const aPillarGeo = new THREE.BoxGeometry(0.06, 1.5, 0.08);
        aPillarGeo.rotateX(-0.48);
        const aPillar = new THREE.Mesh(aPillarGeo, matDark);
        aPillar.position.set(x, 1.38, 2.38);
        heliGroup.add(aPillar);
    });

    // 4. Cockpit Armaturenbrett (Dashboard) - flach & tief platziert, versperrt NICHT die Sicht!
    const dashGeo = new THREE.BoxGeometry(1.7, 0.32, 0.45);
    dashGeo.rotateX(-0.25);
    const dash = new THREE.Mesh(dashGeo, matDark);
    dash.position.set(0, 0.88, 2.35);
    heliGroup.add(dash);

    // 5. PILOTENSITZ & COPILOTENSITZ
    [-0.48, 0.48].forEach((x, idx) => {
        const isPilot = idx === 1; // Rechter Sitz = Pilot
        const seatGroup = new THREE.Group();
        seatGroup.position.set(x, 0.52, 1.85);

        const sBase = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.14, 0.48), matSeat);
        seatGroup.add(sBase);

        const sBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.68, 0.10), matSeat);
        sBack.position.set(0, 0.38, -0.22);
        seatGroup.add(sBack);

        const sHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.20, 0.08), matSeat);
        sHead.position.set(0, 0.76, -0.22);
        seatGroup.add(sHead);

        heliGroup.add(seatGroup);
    });

    // Steuerknüppel (Cyclic Stick)
    const stickGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8);
    const stick = new THREE.Mesh(stickGeo, matMetal);
    stick.position.set(0.48, 0.72, 2.15);
    heliGroup.add(stick);

    // 6. PASSAGIERKABINE: 2 GEGENÜBERLIEGENDE 3ER-SITZREIHEN (VIS-À-VIS)
    // Sitzbreite pro Person: ~0.50m (Gesamt 3er-Bank: 1.65m)
    // Reihe 1: Vordere Sitzreihe (Position z = +0.95), Passagiere blicken nach HINTEN (Richtung -Z)
    // Reihe 2: Hintere Sitzreihe (Position z = -0.75), Passagiere blicken nach VORNE (Richtung +Z)
    const rowConfigs = [
        { rowName: "Reihe Vorne (Rückwärts)", zPos: 0.95, lookDirZ: -1.0, backOffsetZ: 0.22 },
        { rowName: "Reihe Hinten (Vorwärts)", zPos: -0.75, lookDirZ: 1.0, backOffsetZ: -0.22 }
    ];

    const seatXOffsets = [-0.62, 0.0, 0.62]; // Links, Mitte, Rechts

    rowConfigs.forEach((rc, rIdx) => {
        // Sitzbank-Untergestell
        const benchBaseGeo = new THREE.BoxGeometry(1.85, 0.15, 0.52);
        const benchBase = new THREE.Mesh(benchBaseGeo, matDark);
        benchBase.position.set(0, 0.54, rc.zPos);
        heliGroup.add(benchBase);

        // Durchgehende Rückenlehne
        const benchBackGeo = new THREE.BoxGeometry(1.85, 0.68, 0.10);
        const benchBack = new THREE.Mesh(benchBackGeo, matSeat);
        benchBack.position.set(0, 0.90, rc.zPos + rc.backOffsetZ);
        heliGroup.add(benchBack);

        // Die 3 einzelnen Sitzplätze auf der Bank
        seatXOffsets.forEach((xPos, sIdx) => {
            const seatCushionGeo = new THREE.BoxGeometry(0.52, 0.12, 0.46);
            const seatCushion = new THREE.Mesh(seatCushionGeo, matSeat);
            seatCushion.position.set(xPos, 0.62, rc.zPos);
            heliGroup.add(seatCushion);

            // Als interaktiven Sitz registrieren
            const localSitPos = new THREE.Vector3(xPos, 0.95, rc.zPos);
            const localLookDir = new THREE.Vector3(0, 0, rc.lookDirZ);
            const seatName = `Helikopter Sitz ${rIdx === 0 ? 'V' : 'H'}${sIdx + 1}`;
            
            const seatObj = {
                name: seatName,
                isHeliSeat: true,
                localPos: localSitPos.clone(),
                localLookDir: localLookDir.clone(),
                sitPos: localSitPos.clone(),
                lookDir: localLookDir.clone(),
                mesh: seatCushion
            };
            seatCushion.userData.isSeat = true;
            seatCushion.userData.seat = seatObj;
            seatCushion.userData.isHeliSeat = true;
            seats.push(seatObj);
            seatMeshes.push(seatCushion);
            heliPassengerSeats.push(seatObj);
        });
    });

    // 7. LANDER-KUFEN (SKIDS) - Robust, symmetrisch und perfekt ausgerichtet
    [-1.05, 1.05].forEach(x => {
        // Horizontale Hauptkufe entlang der Z-Achse
        const skidGeo = new THREE.CylinderGeometry(0.045, 0.045, 4.6, 12);
        skidGeo.rotateX(Math.PI / 2);
        const skid = new THREE.Mesh(skidGeo, matMetal);
        skid.position.set(x, 0.08, 0.4);
        heliGroup.add(skid);

        // Nach oben gebogene Spitzen vorne und hinten
        const frontTipGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.65, 10);
        frontTipGeo.rotateX(Math.PI / 2 + 0.35);
        const frontTip = new THREE.Mesh(frontTipGeo, matMetal);
        frontTip.position.set(x, 0.18, 2.85);
        heliGroup.add(frontTip);

        // 2 Vertikale Verbindungsstreben zum Rumpf
        [-0.8, 1.6].forEach(z => {
            const strutGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.40, 8);
            const strut = new THREE.Mesh(strutGeo, matMetal);
            strut.position.set(x, 0.28, z);
            heliGroup.add(strut);
        });
    });

    // 8. TRIEBWERK & ROTORMAST (Dach)
    const cowlGeo = new THREE.BoxGeometry(1.5, 0.45, 2.2);
    const cowling = new THREE.Mesh(cowlGeo, matWhite);
    cowling.position.set(0, 2.30, 0.1);
    heliGroup.add(cowling);

    // Hauptrotor-Gruppe
    heliMainRotorGroup = new THREE.Group();
    heliMainRotorGroup.position.set(0, 2.65, 0.2);
    heliGroup.add(heliMainRotorGroup);

    const mastGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16);
    const mast = new THREE.Mesh(mastGeo, matMetal);
    heliMainRotorGroup.add(mast);

    const hubGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.16, 12);
    hubGeo.position = new THREE.Vector3(0, 0.2, 0);
    const hub = new THREE.Mesh(hubGeo, matMetal);
    hub.position.set(0, 0.2, 0);
    heliMainRotorGroup.add(hub);

    // 4 Hauptrotorblätter (perfekt horizontal in der XZ-Ebene)
    for (let i = 0; i < 4; i++) {
        const bladeArm = new THREE.Group();
        bladeArm.rotation.y = i * (Math.PI / 2);

        // Rotorblatt (4.8m lang)
        const bladeGeo = new THREE.BoxGeometry(0.22, 0.025, 4.6);
        const blade = new THREE.Mesh(bladeGeo, matBlade);
        blade.position.set(0, 0.2, 2.5);
        bladeArm.add(blade);

        // Rote Sicherheitsspitze
        const tipGeo = new THREE.BoxGeometry(0.222, 0.026, 0.6);
        const tip = new THREE.Mesh(tipGeo, matCrimson);
        tip.position.set(0, 0.2, 4.5);
        bladeArm.add(tip);

        heliMainRotorGroup.add(bladeArm);
    }

    // 9. HECKAUSLEGER (TAIL BOOM) & HECKROTOR
    const boomGeo = new THREE.CylinderGeometry(0.12, 0.38, 5.4, 16);
    boomGeo.rotateX(Math.PI / 2);
    const boom = new THREE.Mesh(boomGeo, matWhite);
    boom.position.set(0, 1.45, -4.8);
    heliGroup.add(boom);

    // Heckflosse
    const finGeo = new THREE.BoxGeometry(0.08, 1.6, 0.85);
    const fin = new THREE.Mesh(finGeo, matWhite);
    fin.position.set(0, 2.15, -7.4);
    fin.rotation.x = -0.35;
    heliGroup.add(fin);

    // Heckrotor (rechts montiert an Steuerbord, rotiert um die X-Achse)
    heliTailRotorGroup = new THREE.Group();
    heliTailRotorGroup.position.set(0.14, 2.25, -7.5);
    heliGroup.add(heliTailRotorGroup);

    const tHubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8);
    tHubGeo.rotateZ(Math.PI / 2);
    const tHub = new THREE.Mesh(tHubGeo, matMetal);
    heliTailRotorGroup.add(tHub);

    for (let i = 0; i < 2; i++) {
        const tBladeArm = new THREE.Group();
        tBladeArm.rotation.x = i * (Math.PI / 2);

        const tBladeGeo = new THREE.BoxGeometry(0.02, 1.5, 0.12);
        const tBlade = new THREE.Mesh(tBladeGeo, matBlade);
        tBladeArm.add(tBlade);

        heliTailRotorGroup.add(tBladeArm);
    }

    // Hitbox für Einstieg
    const hitBox = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 6.0), new THREE.MeshBasicMaterial({ visible: false }));
    hitBox.position.set(0, 1.3, 0.5);
    hitBox.userData = { isHelicopter: true };
    heliGroup.add(hitBox);

    heliGroup.position.copy(heliPos);
    heliGroup.rotation.set(0, heliYaw, 0);
    scene.add(heliGroup);

    return heliGroup;
}

// Arcade Flugphysik Simulation
function updateArcadeFlight(delta) {
    const SPEED_HORIZONTAL = 28.0; // m/s
    const SPEED_VERTICAL = 12.0;   // m/s
    const YAW_RATE = 1.8;          // rad/s

    // 1. Rotor-Hochlauf
    const targetRpm = isFlyingHelicopter ? 1.0 : 0.0;
    heliRpm += (targetRpm - heliRpm) * Math.min(1.0, delta * 3.0);

    if (isFlyingHelicopter) {
        // Gieren (Q / E)
        if (heliMoveState.yawLeft) heliYaw += YAW_RATE * delta;
        if (heliMoveState.yawRight) heliYaw -= YAW_RATE * delta;

        // Horizontale Bewegung (WASD im lokalen Helikopter-Koordinatensystem)
        // Vorwärts = +Z im Heli-Raum
        const fwdDir = new THREE.Vector3(Math.sin(heliYaw), 0, Math.cos(heliYaw));
        const rightDir = new THREE.Vector3(fwdDir.z, 0, -fwdDir.x);

        let targetVelX = 0;
        let targetVelZ = 0;
        let targetPitch = 0.0;
        let targetRoll = 0.0;

        if (heliMoveState.forward) {
            targetVelX += fwdDir.x * SPEED_HORIZONTAL;
            targetVelZ += fwdDir.z * SPEED_HORIZONTAL;
            targetPitch = -0.16; // Nase sanft nach unten
        }
        if (heliMoveState.backward) {
            targetVelX -= fwdDir.x * (SPEED_HORIZONTAL * 0.6);
            targetVelZ -= fwdDir.z * (SPEED_HORIZONTAL * 0.6);
            targetPitch = 0.12;  // Nase sanft nach oben
        }
        if (heliMoveState.left) {
            targetVelX -= rightDir.x * (SPEED_HORIZONTAL * 0.8);
            targetVelZ -= rightDir.z * (SPEED_HORIZONTAL * 0.8);
            targetRoll = 0.18;   // Nach links neigen
        }
        if (heliMoveState.right) {
            targetVelX += rightDir.x * (SPEED_HORIZONTAL * 0.8);
            targetVelZ += rightDir.z * (SPEED_HORIZONTAL * 0.8);
            targetRoll = -0.18;  // Nach rechts neigen
        }

        // Vertikale Bewegung (Leertaste = Steigen, Shift = Sinken)
        let targetVelY = 0;
        if (heliMoveState.ascend) targetVelY = SPEED_VERTICAL;
        if (heliMoveState.descend) targetVelY = -SPEED_VERTICAL;

        // Weiche Interpolation (Auto-Hover Trägheit)
        heliVelocity.x = THREE.MathUtils.damp(heliVelocity.x, targetVelX, 5.0, delta);
        heliVelocity.z = THREE.MathUtils.damp(heliVelocity.z, targetVelZ, 5.0, delta);
        heliVelocity.y = THREE.MathUtils.damp(heliVelocity.y, targetVelY, 6.0, delta);

        heliPitch = THREE.MathUtils.damp(heliPitch, targetPitch, 6.0, delta);
        heliRoll = THREE.MathUtils.damp(heliRoll, targetRoll, 6.0, delta);
    } else {
        // Nicht geflogen: dämpfen
        heliVelocity.set(0, 0, 0);
        heliPitch = THREE.MathUtils.damp(heliPitch, 0, 8.0, delta);
        heliRoll = THREE.MathUtils.damp(heliRoll, 0, 8.0, delta);
    }

    // Position aktualisieren
    heliPos.addScaledVector(heliVelocity, delta);

    // Mindesthöhe (Bodenkollision)
    const groundY = 0.0;
    const minY = groundY + 0.45;
    if (heliPos.y <= minY) {
        heliPos.y = minY;
        if (heliVelocity.y < 0) heliVelocity.y = 0;
    }

    if (heliGroup) {
        heliGroup.position.copy(heliPos);
        heliGroup.rotation.set(heliPitch, heliYaw, heliRoll, "YXZ");
    }

    // Rotoren drehen
    if (heliMainRotorGroup) heliMainRotorGroup.rotation.y += heliRpm * 35.0 * delta;
    if (heliTailRotorGroup) heliTailRotorGroup.rotation.x += heliRpm * 110.0 * delta;

    // Dynamische Aktualisierung aller Passagiersitze im Raum!
    heliPassengerSeats.forEach(seat => {
        const worldSitPos = seat.localPos.clone().applyEuler(heliGroup.rotation).add(heliGroup.position);
        seat.sitPos.copy(worldSitPos);
        const worldLookDir = seat.localLookDir.clone().applyEuler(heliGroup.rotation);
        seat.lookDir.copy(worldLookDir);
    });
}

// Tests durchführen
try {
    buildCleanHelicopter();
    console.log("Helicopter successfully constructed!");
    console.log("Total seats registered:", seats.length);
    console.log("Passenger seats registered:", heliPassengerSeats.length);

    isFlyingHelicopter = true;
    heliMoveState.forward = true;
    heliMoveState.ascend = true;

    for (let step = 0; step < 60; step++) {
        updateArcadeFlight(0.016);
    }

    console.log("Flight simulation after 60 steps:");
    console.log("heliPos:", heliPos.x.toFixed(2), heliPos.y.toFixed(2), heliPos.z.toFixed(2));
    console.log("Passenger Seat 0 world sitPos:", heliPassengerSeats[0].sitPos.x.toFixed(2), heliPassengerSeats[0].sitPos.y.toFixed(2), heliPassengerSeats[0].sitPos.z.toFixed(2));
    console.log("All tests passed successfully!");
} catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
}
