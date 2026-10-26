/**
 * Amrumer Leuchtturm (Lighthouse of Amrum)
 * Ultra-präzise, performante & begehbare 3D-Nachbildung auf der Mansion-Insel.
 * 
 * Behebt:
 * - Exakte mathematische Winkelausrichtung aller Zylinder-Ausschnitte (Three.js CylinderGeometry hat 90°-Versatz zu atan2).
 * - Vollständig begehbarer, hohler historischer Eingangsvorbau (keine soliden Blöcke).
 * - Wendeltreppe: 172 ebene, radial geführte Stufen (InstancedMesh) ohne Verdrehung.
 * - Oben: Echter, offener Türausschnitt im Turmschaft und Laternenring für nahtlosen Übergang Treppe <-> Galerie <-> Laterne.
 * - Wände besitzen DoubleSide & Kameraschutz gegen jedes Wand-Clipping.
 * - Drüberspringen über das Galerie-Geländer möglich.
 */

import * as THREE from 'three';

export const LIGHTHOUSE_CONFIG = {
    x: 280.0,
    y: -44.5,
    z: 811.0,
    totalHeight: 42.2,
    shaftHeight: 34.0,
    baseRadius: 3.5,
    topRadius: 2.25,
    galleryRadius: 3.5,
    lanternRadius: 2.2,
    lanternHeight: 3.5,
    domeRadius: 2.25,
    // Eingang zeigt Richtung Südwesten / Hauptgebäude der Mansion-Insel
    doorAngle: -1.936,
    // Austrittstür oben zur Galerie auf der gegenüberliegenden Seite
    exitAngle: -1.936 + Math.PI
};

/**
 * Erzeugt den vollständigen Amrumer Leuchtturm als performante THREE.Group
 */
export function createAmrumLighthouse(options = {}) {
    const config = Object.assign({}, LIGHTHOUSE_CONFIG, options);
    const lighthouseGroup = new THREE.Group();
    lighthouseGroup.name = "AmrumLighthouse";
    lighthouseGroup.position.set(config.x, config.y, config.z);

    const wallMeshes = [];

    // ── MATERIALIEN (DoubleSide für verlässlichen Kameraschutz & Raycasting) ──
    const whiteMat = new THREE.MeshStandardMaterial({
        color: 0xf4f4f5,
        roughness: 0.45,
        metalness: 0.04,
        side: THREE.DoubleSide
    });

    const redMat = new THREE.MeshStandardMaterial({
        color: 0xba1d1d, // Ikonisches Amrum-Leuchtturmrot
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide
    });

    const graniteMat = new THREE.MeshStandardMaterial({
        color: 0x3f3f46,
        roughness: 0.85,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    const ironMat = new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.35,
        metalness: 0.8,
        side: THREE.DoubleSide
    });

    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.3,
        metalness: 0.85
    });

    const domeMat = new THREE.MeshStandardMaterial({
        color: 0x27272a,
        roughness: 0.4,
        metalness: 0.7,
        side: THREE.DoubleSide
    });

    const glassMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        roughness: 0.05,
        metalness: 0.08,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    // ── 1. FUNDAMENT & BODENPLATTE ──
    const foundationGeo = new THREE.CylinderGeometry(config.baseRadius + 0.6, config.baseRadius + 0.9, 2.4, 32);
    const foundationMesh = new THREE.Mesh(foundationGeo, graniteMat);
    foundationMesh.position.y = -1.1;
    foundationMesh.receiveShadow = true;
    lighthouseGroup.add(foundationMesh);

    // Innerer Steinboden
    const floorGeo = new THREE.CircleGeometry(config.baseRadius - 0.05, 32);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMesh = new THREE.Mesh(floorGeo, graniteMat);
    floorMesh.position.y = 0.02;
    floorMesh.receiveShadow = true;
    lighthouseGroup.add(floorMesh);

    // ── 2. HOHLER, BEGEHBARER HISTORISCHER EINGANGSVORBAU ──
    const doorAng = config.doorAngle;
    const porchWidth = 2.6;
    const porchDepth = 2.4;
    const porchHeight = 3.2;
    const wallThick = 0.28;

    const porchGroup = new THREE.Group();
    // Vorbau wird am Schaftfuß bei doorAngle platziert
    const porchDist = config.baseRadius + porchDepth * 0.5 - 0.2;
    porchGroup.position.set(
        Math.cos(doorAng) * porchDist,
        0,
        Math.sin(doorAng) * porchDist
    );
    // Ausrichtung: +Z zeigt nach außen (weg vom Turm), -Z zeigt ins Turminnere
    porchGroup.rotation.y = Math.PI / 2 - doorAng;

    // Vorbau-Boden
    const porchFloorGeo = new THREE.PlaneGeometry(porchWidth, porchDepth);
    porchFloorGeo.rotateX(-Math.PI / 2);
    const porchFloor = new THREE.Mesh(porchFloorGeo, graniteMat);
    porchFloor.position.y = 0.02;
    porchGroup.add(porchFloor);

    // Linke Wand (-X)
    const leftWallGeo = new THREE.BoxGeometry(wallThick, porchHeight, porchDepth);
    const leftWall = new THREE.Mesh(leftWallGeo, redMat);
    leftWall.position.set(-porchWidth * 0.5 + wallThick * 0.5, porchHeight * 0.5, 0);
    porchGroup.add(leftWall);
    wallMeshes.push(leftWall);

    // Rechte Wand (+X)
    const rightWallGeo = new THREE.BoxGeometry(wallThick, porchHeight, porchDepth);
    const rightWall = new THREE.Mesh(rightWallGeo, redMat);
    rightWall.position.set(porchWidth * 0.5 - wallThick * 0.5, porchHeight * 0.5, 0);
    porchGroup.add(rightWall);
    wallMeshes.push(rightWall);

    // Vorderwand (+Z) mit breiter offener Bogen-Türöffnung
    const doorOpenW = 1.35;
    const doorOpenH = 2.35;
    const frontPostW = (porchWidth - doorOpenW) * 0.5;

    // Linker Türpfeiler
    const frontLeftPost = new THREE.Mesh(new THREE.BoxGeometry(frontPostW, porchHeight, wallThick), redMat);
    frontLeftPost.position.set(-porchWidth * 0.5 + frontPostW * 0.5, porchHeight * 0.5, porchDepth * 0.5 - wallThick * 0.5);
    porchGroup.add(frontLeftPost);
    wallMeshes.push(frontLeftPost);

    // Rechter Türpfeiler
    const frontRightPost = new THREE.Mesh(new THREE.BoxGeometry(frontPostW, porchHeight, wallThick), redMat);
    frontRightPost.position.set(porchWidth * 0.5 - frontPostW * 0.5, porchHeight * 0.5, porchDepth * 0.5 - wallThick * 0.5);
    porchGroup.add(frontRightPost);
    wallMeshes.push(frontRightPost);

    // Sturz über der Tür
    const lintelH = porchHeight - doorOpenH;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorOpenW, lintelH, wallThick), redMat);
    lintel.position.set(0, doorOpenH + lintelH * 0.5, porchDepth * 0.5 - wallThick * 0.5);
    porchGroup.add(lintel);
    wallMeshes.push(lintel);

    // Weißes Ziergesims über dem Eingang
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(porchWidth + 0.25, 0.22, porchDepth + 0.25), whiteMat);
    cornice.position.y = porchHeight;
    porchGroup.add(cornice);

    // Giebeldach (Satteldach über dem Vorbau)
    const roofGeo = new THREE.ConeGeometry(porchWidth * 0.75, 1.15, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, domeMat);
    roof.position.y = porchHeight + 0.58;
    porchGroup.add(roof);

    // Messing-Laterne über dem Portal
    const porchLamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.35, 0.24), brassMat);
    porchLamp.position.set(0, doorOpenH + 0.4, porchDepth * 0.5 + 0.15);
    porchGroup.add(porchLamp);

    lighthouseGroup.add(porchGroup);

    // 3 breite Granitstufen vor dem Vorbau
    for (let s = 0; s < 3; s++) {
        const sDist = config.baseRadius + porchDepth + 0.15 + s * 0.42;
        const sWidth = porchWidth + 0.6 - s * 0.15;
        const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(sWidth, 0.18, 0.44), graniteMat);
        stepMesh.position.set(
            Math.cos(doorAng) * sDist,
            0.08 - s * 0.16,
            Math.sin(doorAng) * sDist
        );
        stepMesh.rotation.y = Math.PI / 2 - doorAng;
        stepMesh.receiveShadow = true;
        lighthouseGroup.add(stepMesh);
    }

    // ── 3. TURMSCHAFT MIT PRÄZISEN CYLINDERGEOMETRY-AUSSCHNITTEN ──
    // WICHTIG: In Three.js CylinderGeometry gilt u = PI/2 - MathAngle!
    const BAND_COUNT = 5;
    const bandHeight = config.shaftHeight / BAND_COUNT; // 6.8 m
    const bandMaterials = [whiteMat, redMat, whiteMat, redMat, whiteMat];

    // Ausschnitt für den Eingang im unteren Band (Band 0)
    const doorArc = 0.52; // ca. 30 Grad Öffnung
    const uDoor = Math.PI / 2 - doorAng;
    const doorThetaStart = uDoor + doorArc * 0.5;
    const doorThetaLength = Math.PI * 2 - doorArc;

    // Ausschnitt für den Galerie-Austritt im oberen Band (Band 4)
    const exitAng = config.exitAngle;
    const exitArc = 0.58;
    const uExit = Math.PI / 2 - exitAng;
    const exitThetaStart = uExit + exitArc * 0.5;
    const exitThetaLength = Math.PI * 2 - exitArc;

    for (let i = 0; i < BAND_COUNT; i++) {
        const yBottom = i * bandHeight;
        const yTop = (i + 1) * bandHeight;
        const rBottom = config.baseRadius - (config.baseRadius - config.topRadius) * (yBottom / config.shaftHeight);
        const rTop = config.baseRadius - (config.baseRadius - config.topRadius) * (yTop / config.shaftHeight);
        const midY = (yBottom + yTop) / 2;

        let outerGeo;
        if (i === 0) {
            // Band 0: Eingangsausschnitt
            outerGeo = new THREE.CylinderGeometry(rTop, rBottom, bandHeight, 32, 1, true, doorThetaStart, doorThetaLength);
        } else if (i === BAND_COUNT - 1) {
            // Band 4: Galerie-Austrittsausschnitt
            outerGeo = new THREE.CylinderGeometry(rTop, rBottom, bandHeight, 32, 1, true, exitThetaStart, exitThetaLength);
        } else {
            // Mittlere Bänder: Volle Zylinder
            outerGeo = new THREE.CylinderGeometry(rTop, rBottom, bandHeight, 32, 1, true);
        }

        const outerMesh = new THREE.Mesh(outerGeo, bandMaterials[i]);
        outerMesh.position.y = midY;
        lighthouseGroup.add(outerMesh);
        wallMeshes.push(outerMesh);
    }

    // Kragsteine unter der Galerie
    const bracketCount = 16;
    const bracketGeo = new THREE.BoxGeometry(0.16, 0.85, 0.55);
    for (let b = 0; b < bracketCount; b++) {
        const bAng = (b / bracketCount) * Math.PI * 2;
        const bMesh = new THREE.Mesh(bracketGeo, graniteMat);
        bMesh.position.set(
            Math.cos(bAng) * (config.topRadius + 0.22),
            config.shaftHeight - 0.42,
            Math.sin(bAng) * (config.topRadius + 0.22)
        );
        bMesh.rotation.y = Math.PI / 2 - bAng;
        lighthouseGroup.add(bMesh);
    }

    // ── 4. WENDELTREPPE (172 EBENE, RADIAL AUSGERICHTETE STUFEN VIA INSTANCEDMESH) ──
    const spindleRadius = 0.28;
    const spindleGeo = new THREE.CylinderGeometry(spindleRadius, 0.32, config.shaftHeight + 0.8, 16);
    const spindleMesh = new THREE.Mesh(spindleGeo, ironMat);
    spindleMesh.position.y = (config.shaftHeight + 0.8) / 2;
    lighthouseGroup.add(spindleMesh);
    wallMeshes.push(spindleMesh);

    const TOTAL_STEPS = 172;
    // Wendeltreppe führt in exakt 7.43 Umdrehungen vom Eingang direkt vor die Austrittstür
    const stairStartAngle = doorAng + 0.40;
    const totalStairAngle = 7 * Math.PI * 2 + (Math.PI - 0.40);
    const stairTopHeight = 33.6; // Mündet bündig am oberen Austrittspodest
    const stepRise = stairTopHeight / TOTAL_STEPS;
    const stepAngleDelta = totalStairAngle / TOTAL_STEPS;

    // Radiale Stufe: Länge 1.55m, Dicke 7cm, Tritt-Tiefe 30cm
    const stepLength = 1.55;
    const stepGeo = new THREE.BoxGeometry(stepLength, 0.07, 0.30);
    const stepInstancedMesh = new THREE.InstancedMesh(stepGeo, ironMat, TOTAL_STEPS);
    stepInstancedMesh.receiveShadow = true;

    const dummyMatrix = new THREE.Matrix4();
    const dummyPos = new THREE.Vector3();
    const dummyQuat = new THREE.Quaternion();
    const dummyScale = new THREE.Vector3(1, 1, 1);
    const euler = new THREE.Euler();

    for (let s = 0; s < TOTAL_STEPS; s++) {
        const sH = s * stepRise;
        const sAng = stairStartAngle + s * stepAngleDelta;
        const rMid = spindleRadius + stepLength * 0.5;

        dummyPos.set(
            Math.cos(sAng) * rMid,
            sH + 0.05,
            Math.sin(sAng) * rMid
        );

        // EXAKTE RADIALE AUSRICHTUNG:
        // Lokale X-Achse verläuft radial (cos, sin), Z ist die ebene Trittfläche
        euler.set(0, -sAng, 0);
        dummyQuat.setFromEuler(euler);

        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        stepInstancedMesh.setMatrixAt(s, dummyMatrix);
    }
    stepInstancedMesh.instanceMatrix.needsUpdate = true;
    lighthouseGroup.add(stepInstancedMesh);

    // ── 5. OBERES TREPPENAUSTRITTSPODEST & VERBINDUNG ZUR GALERIE & LATERNE ──
    const galleryY = config.shaftHeight; // 34.0 m

    // Oberes Treppenpodest (y = 34.15m) mit großem offenen Ausschnitt für das Treppenhaus
    // Das Podest überdeckt nur den Bereich vor der Austrittstür (Winkel von exitAng - 0.45 bis exitAng + 1.45)
    // Die restlichen ~250° bleiben vollständig offen für die Wendeltreppe!
    const angStart = exitAng - 0.45;
    const angEnd = exitAng + 1.45;
    const uLanding1 = Math.PI / 2 - angEnd;
    const uLanding2 = Math.PI / 2 - angStart;
    const topLandingGeo = new THREE.CylinderGeometry(
        config.topRadius - 0.05, config.topRadius - 0.05, 0.25, 20, 1, false,
        uLanding1, uLanding2 - uLanding1
    );
    const topLanding = new THREE.Mesh(topLandingGeo, ironMat);
    topLanding.position.y = galleryY + 0.125;
    lighthouseGroup.add(topLanding);

    // Schutzgeländer am Rand des Treppenhausausschnitts auf dem Podest
    const topRailingGroup = new THREE.Group();
    const landingRailingH = 1.05;
    const landingRailGeo = new THREE.BoxGeometry(config.topRadius - 0.5, 0.05, 0.05);
    const landingRail = new THREE.Mesh(landingRailGeo, ironMat);
    const rMidRail = (0.45 + config.topRadius - 0.05) * 0.5;
    landingRail.position.set(Math.cos(angEnd) * rMidRail, galleryY + 0.25 + landingRailingH, Math.sin(angEnd) * rMidRail);
    landingRail.rotation.y = Math.PI / 2 - angEnd;
    topRailingGroup.add(landingRail);

    const railPost1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, landingRailingH, 6), ironMat);
    railPost1.position.set(Math.cos(angEnd) * 0.5, galleryY + 0.25 + landingRailingH * 0.5, Math.sin(angEnd) * 0.5);
    topRailingGroup.add(railPost1);

    const railPost2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, landingRailingH, 6), ironMat);
    railPost2.position.set(Math.cos(angEnd) * (config.topRadius - 0.15), galleryY + 0.25 + landingRailingH * 0.5, Math.sin(angEnd) * (config.topRadius - 0.15));
    topRailingGroup.add(railPost2);

    lighthouseGroup.add(topRailingGroup);

    // Offener Türrahmen am Galerie-Austritt
    const exitDoorFrame = new THREE.Group();
    exitDoorFrame.position.set(Math.cos(exitAng) * (config.topRadius - 0.05), galleryY + 1.1, Math.sin(exitAng) * (config.topRadius - 0.05));
    exitDoorFrame.rotation.y = Math.PI / 2 - exitAng;

    // Pfeiler links & rechts
    const postGeo = new THREE.BoxGeometry(0.18, 2.2, 0.35);
    const postL = new THREE.Mesh(postGeo, ironMat);
    postL.position.x = -0.55;
    exitDoorFrame.add(postL);
    wallMeshes.push(postL);

    const postR = new THREE.Mesh(postGeo, ironMat);
    postR.position.x = 0.55;
    exitDoorFrame.add(postR);
    wallMeshes.push(postR);

    // Sturz über der Tür
    const doorTop = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.25, 0.35), ironMat);
    doorTop.position.y = 1.0;
    exitDoorFrame.add(doorTop);
    wallMeshes.push(doorTop);

    lighthouseGroup.add(exitDoorFrame);

    // ── 6. GALERIE-PLATTFORM MIT AUSSICHTSRUNDGANG ──
    // Äußerer Plattform-Kranz
    const platformGeo = new THREE.CylinderGeometry(config.galleryRadius, config.galleryRadius, 0.5, 32);
    const platformMesh = new THREE.Mesh(platformGeo, graniteMat);
    platformMesh.position.y = galleryY + 0.25;
    platformMesh.receiveShadow = true;
    lighthouseGroup.add(platformMesh);

    // Gehweg-Ring oben auf der Plattform (Rundgang)
    const walkwayGeo = new THREE.RingGeometry(config.topRadius + 0.02, config.galleryRadius - 0.05, 32);
    walkwayGeo.rotateX(-Math.PI / 2);
    const walkway = new THREE.Mesh(walkwayGeo, ironMat);
    walkway.position.y = galleryY + 0.505;
    lighthouseGroup.add(walkway);

    // Galerie-Geländer
    const railingH = 1.15;
    const railingR = config.galleryRadius - 0.12;

    const topRailGeo = new THREE.TorusGeometry(railingR, 0.035, 6, 32);
    topRailGeo.rotateX(Math.PI / 2);
    const topRail = new THREE.Mesh(topRailGeo, ironMat);
    topRail.position.y = galleryY + 0.5 + railingH;
    lighthouseGroup.add(topRail);

    const midRailGeo = new THREE.TorusGeometry(railingR, 0.02, 6, 32);
    midRailGeo.rotateX(Math.PI / 2);
    const midRail = new THREE.Mesh(midRailGeo, ironMat);
    midRail.position.y = galleryY + 0.5 + railingH * 0.5;
    lighthouseGroup.add(midRail);

    // Geländerpfosten (InstancedMesh)
    const railPostCount = 32;
    const postCylGeo = new THREE.CylinderGeometry(0.025, 0.025, railingH, 6);
    const postInstanced = new THREE.InstancedMesh(postCylGeo, ironMat, railPostCount);
    for (let rp = 0; rp < railPostCount; rp++) {
        const rpAng = (rp / railPostCount) * Math.PI * 2;
        dummyPos.set(Math.cos(rpAng) * railingR, galleryY + 0.5 + railingH * 0.5, Math.sin(rpAng) * railingR);
        dummyMatrix.makeTranslation(dummyPos.x, dummyPos.y, dummyPos.z);
        postInstanced.setMatrixAt(rp, dummyMatrix);
    }
    postInstanced.instanceMatrix.needsUpdate = true;
    lighthouseGroup.add(postInstanced);

    // ── 7. LATERNE & GLASRAUM (BEGEHBARER ZUGANG VIA 2 STUFEN) ──
    const lanternBaseY = galleryY + 0.5;

    // Brüstungsmauer des Laternenhauses mit offener Tür am Austritt
    const parapetGeo = new THREE.CylinderGeometry(
        config.lanternRadius, config.lanternRadius, 0.7, 32, 1, false,
        exitThetaStart, exitThetaLength
    );
    const parapetMesh = new THREE.Mesh(parapetGeo, ironMat);
    parapetMesh.position.y = lanternBaseY + 0.35;
    lighthouseGroup.add(parapetMesh);
    wallMeshes.push(parapetMesh);

    // Boden im Laternenraum (y = 34.8 m)
    const lanternFloorGeo = new THREE.CircleGeometry(config.lanternRadius - 0.05, 24);
    lanternFloorGeo.rotateX(-Math.PI / 2);
    const lanternFloor = new THREE.Mesh(lanternFloorGeo, ironMat);
    lanternFloor.position.y = lanternBaseY + 0.35;
    lighthouseGroup.add(lanternFloor);

    // 2 Stufen vom Podest hinauf in den Laternenraum
    for (let ls = 0; ls < 2; ls++) {
        const lStep = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.32), ironMat);
        const lDist = config.topRadius - 0.15 - ls * 0.32;
        lStep.position.set(
            Math.cos(exitAng + 0.5) * lDist,
            galleryY + 0.08 + ls * 0.18,
            Math.sin(exitAng + 0.5) * lDist
        );
        lStep.rotation.y = Math.PI / 2 - (exitAng + 0.5);
        lighthouseGroup.add(lStep);
    }

    // Transparenter Glaszylinder
    const glassGeo = new THREE.CylinderGeometry(config.lanternRadius, config.lanternRadius, config.lanternHeight, 24, 1, true);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.y = lanternBaseY + config.lanternHeight * 0.5;
    lighthouseGroup.add(glassMesh);

    // Laternen-Glassprossen
    const glassStrutsCount = 12;
    const strutGeo = new THREE.CylinderGeometry(0.025, 0.025, config.lanternHeight, 6);
    const strutInstanced = new THREE.InstancedMesh(strutGeo, ironMat, glassStrutsCount);
    for (let gs = 0; gs < glassStrutsCount; gs++) {
        const gsAng = (gs / glassStrutsCount) * Math.PI * 2;
        dummyPos.set(Math.cos(gsAng) * config.lanternRadius, lanternBaseY + config.lanternHeight * 0.5, Math.sin(gsAng) * config.lanternRadius);
        dummyMatrix.makeTranslation(dummyPos.x, dummyPos.y, dummyPos.z);
        strutInstanced.setMatrixAt(gs, dummyMatrix);
    }
    strutInstanced.instanceMatrix.needsUpdate = true;
    lighthouseGroup.add(strutInstanced);

    // ── 8. KUPPEL & SPITZE ──
    const domeBaseY = lanternBaseY + config.lanternHeight;

    const domeGeo = new THREE.SphereGeometry(config.domeRadius, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.y = domeBaseY;
    lighthouseGroup.add(domeMesh);

    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), brassMat);
    ballMesh.position.y = domeBaseY + config.domeRadius + 0.25;
    lighthouseGroup.add(ballMesh);

    const spireMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 1.4, 6), brassMat);
    spireMesh.position.y = domeBaseY + config.domeRadius + 1.0;
    lighthouseGroup.add(spireMesh);

    // ── 9. DREHENDES LEUCHTFEUER (Ultra-performant: 0 Shader-Overhead) ──
    const beaconY = lanternBaseY + config.lanternHeight * 0.52;

    const beaconPivot = new THREE.Group();
    beaconPivot.name = "AmrumBeaconPivot";
    beaconPivot.position.set(0, beaconY, 0);
    lighthouseGroup.add(beaconPivot);

    const lensCase = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.8, 16), brassMat);
    beaconPivot.add(lensCase);

    const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff6cf }));
    beaconPivot.add(lampMesh);

    // Warmes Laternenlicht
    const lanternWarmLight = new THREE.PointLight(0xffdf94, 0.8, 8.0);
    beaconPivot.add(lanternWarmLight);

    const spotLights = [];
    const beamMeshes = [];

    // Schlanke volumetrische Lichtkegel (additives Basic-Material)
    const beamLength = 80.0;
    const beamGeo = new THREE.CylinderGeometry(14.0, 0.5, beamLength, 16, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, beamLength * 0.5);

    const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfff7d4,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    [0, Math.PI].forEach((dirAngle) => {
        const spot = new THREE.SpotLight(0xfff7db, 6.0, 110, 0.22, 0.4, 1.2);
        spot.castShadow = false;

        const target = new THREE.Object3D();
        target.position.set(Math.cos(dirAngle) * 40, 0, Math.sin(dirAngle) * 40);
        beaconPivot.add(target);
        spot.target = target;
        beaconPivot.add(spot);
        spotLights.push(spot);

        const coneMesh = new THREE.Mesh(beamGeo, beamMat);
        coneMesh.rotation.y = -dirAngle + Math.PI / 2;
        beaconPivot.add(coneMesh);
        beamMeshes.push(coneMesh);
    });

    return {
        group: lighthouseGroup,
        beaconPivot,
        spotLights,
        beamMeshes,
        wallMeshes,
        config,
        update: function(delta) {
            if (beaconPivot) {
                beaconPivot.rotation.y += delta * 0.72;
            }
        }
    };
}

/**
 * Mathematische Boden- und Treppenhöhe für den Spieler.
 * Gewährleistet lückenlose Begehbarkeit ohne Fall-Glitches.
 */
export function getLighthouseFloorY(x, yFeet, z, config = LIGHTHOUSE_CONFIG) {
    const dx = x - config.x;
    const dz = z - config.z;
    const r = Math.sqrt(dx * dx + dz * dz);

    if (r > 7.5) return null;

    const baseFloorY = config.y;
    const galleryFloorY = config.y + config.shaftHeight + 0.5; // -10.0m (hRel = 34.5)
    const lanternFloorY = galleryFloorY + 0.35;               // -9.65m (hRel = 34.85)

    const playerAngle = Math.atan2(dz, dx);
    let dDoor = Math.abs(playerAngle - config.doorAngle);
    while (dDoor > Math.PI) dDoor = Math.abs(dDoor - 2 * Math.PI);

    let dExit = Math.abs(playerAngle - config.exitAngle);
    while (dExit > Math.PI) dExit = Math.abs(dExit - 2 * Math.PI);

    const hRel = yFeet - baseFloorY;

    // 1. Eingangstreppe vor dem Vorbau (r: 5.6 bis 7.4)
    if (r >= 5.6 && r <= 7.4 && dDoor < 0.38) {
        const stepT = (7.4 - r) / (7.4 - 5.6);
        return baseFloorY - 0.50 + stepT * 0.50;
    }

    // 2. Im Eingangsvorbau (r: 3.0 bis 5.7)
    if (r >= 3.0 && r <= 5.7 && dDoor < 0.38) {
        if (hRel >= -0.6 && hRel <= 3.2) {
            return baseFloorY;
        }
    }

    // 3. Galerie-Rundgang, Austrittstür & Laternenhaus (oben)
    if (hRel >= 32.8 && hRel <= 38.0) {
        // Auf dem Galerie-Balkon Rundgang
        if (r >= config.topRadius && r <= config.galleryRadius + 0.1) {
            return galleryFloorY;
        }
        // Im Austritts-Portal / Schwelle (Verbindung zwischen Galerie und oberem Podest)
        if (dExit < 0.40) {
            if (r >= config.topRadius - 0.3) {
                return galleryFloorY;
            } else if (r >= 0.8) {
                // Sanfter Übergang vom Galerieboden (34.5) zum Austrittspodest (34.15)
                const t = (r - 0.8) / (config.topRadius - 0.3 - 0.8);
                return baseFloorY + 34.15 + t * 0.35;
            }
        }
        // Im Laternenhaus
        if (r < config.lanternRadius && hRel >= 34.2) {
            return lanternFloorY;
        }
    }

    // 4. Wendeltreppe & Turmschaft-Innenraum (Erdgeschoss bis oberes Treppenpodest)
    if (r <= 3.35 && hRel >= -0.2 && hRel <= 35.5) {
        // Erdgeschoss-Boden
        if (hRel < 0.4) {
            return baseFloorY;
        }

        const stairStartAngle = config.doorAngle + 0.40;
        const totalStairAngle = 7 * Math.PI * 2 + (Math.PI - 0.40);
        const stairTopHeight = 33.6;
        const totalTurns = totalStairAngle / (Math.PI * 2);
        const turnHeight = stairTopHeight / totalTurns; // ~4.52 m
        const c = stairTopHeight / totalStairAngle;

        let relAng = playerAngle - stairStartAngle;
        while (relAng < 0) relAng += Math.PI * 2;
        while (relAng >= Math.PI * 2) relAng -= Math.PI * 2;

        const estTurn = Math.round((hRel - relAng * c) / turnHeight);
        const k = Math.max(0, Math.min(Math.floor(totalTurns), estTurn));
        const stairY = baseFloorY + k * turnHeight + relAng * c;

        // Wenn oben beim Austrittspodest angekommen
        if (hRel >= 33.4 && (k >= 7 || stairY >= baseFloorY + 33.4)) {
            // Auf dem Podest (Austrittsbereich)
            return baseFloorY + 34.15;
        }

        // Großzügige Schwellenüberdeckung (verhindert jedes Durchfallen)
        if (Math.abs(yFeet - stairY) < turnHeight * 0.60) {
            return Math.min(baseFloorY + 34.15, Math.max(baseFloorY, stairY));
        }

        if (hRel < 1.0) {
            return baseFloorY;
        }
    }

    return null;
}

/**
 * Analytische Wand-, Spindel- und Geländer-Kollision.
 * Hält den Spieler im 1st-Person-Modus immer min. 30 cm von der Außenwand fern
 * und ermöglicht das Drüberspringen über das Galerie-Geländer.
 */
export function handleLighthouseCollision(playerPos, config = LIGHTHOUSE_CONFIG) {
    const dx = playerPos.x - config.x;
    const dz = playerPos.z - config.z;
    const r = Math.sqrt(dx * dx + dz * dz);

    if (r > 7.5) return;

    const yFeet = playerPos.y - 1.70; // EYE_HEIGHT
    const baseFloorY = config.y;
    const galleryFloorY = config.y + config.shaftHeight + 0.5;
    const playerAngle = Math.atan2(dz, dx);

    let dDoor = Math.abs(playerAngle - config.doorAngle);
    while (dDoor > Math.PI) dDoor = Math.abs(dDoor - 2 * Math.PI);

    let dExit = Math.abs(playerAngle - config.exitAngle);
    while (dExit > Math.PI) dExit = Math.abs(dExit - 2 * Math.PI);

    // A. AUF DER GALERIE (Aussichtsplattform)
    if (yFeet >= galleryFloorY - 0.6 && yFeet <= galleryFloorY + 3.0) {
        const railingR = config.galleryRadius - 0.12;
        const railingTopY = galleryFloorY + 1.10;

        // Wenn der Spieler springt (yFeet >= railingTopY), darf er drüberspringen!
        if (yFeet < railingTopY) {
            if (r > railingR && r < 4.8) {
                playerPos.x = config.x + Math.cos(playerAngle) * railingR;
                playerPos.z = config.z + Math.sin(playerAngle) * railingR;
            }
        }

        // Inneres Laternenhaus (mit freiem Durchgang an der Austrittstür)
        const minWalkR = config.lanternRadius + 0.12;
        if (r < minWalkR && dExit > 0.40 && yFeet < galleryFloorY + 0.3) {
            playerPos.x = config.x + Math.cos(playerAngle) * minWalkR;
            playerPos.z = config.z + Math.sin(playerAngle) * minWalkR;
        }
        return;
    }

    // B. IM EINGANGSVORBAU & VOR DER TÜR (analytische Box-Kollision)
    const cosDoor = Math.cos(config.doorAngle);
    const sinDoor = Math.sin(config.doorAngle);
    const radialDist = dx * cosDoor + dz * sinDoor;     // Vorbau-Tiefe (3.5 = Turmwand, 5.7 = Front)
    const tangentDist = -dx * sinDoor + dz * cosDoor;   // Vorbau-Breite (-1.3 bis +1.3)

    if (radialDist >= 3.2 && radialDist <= 6.2 && yFeet < baseFloorY + 3.2) {
        const halfInnerW = 0.98;
        if (tangentDist < -halfInnerW && radialDist <= 5.6) {
            const correctedT = -halfInnerW;
            playerPos.x = config.x + cosDoor * radialDist - sinDoor * correctedT;
            playerPos.z = config.z + sinDoor * radialDist + cosDoor * correctedT;
            return;
        }
        if (tangentDist > halfInnerW && radialDist <= 5.6) {
            const correctedT = halfInnerW;
            playerPos.x = config.x + cosDoor * radialDist - sinDoor * correctedT;
            playerPos.z = config.z + sinDoor * radialDist + cosDoor * correctedT;
            return;
        }
        if (radialDist >= 5.55 && radialDist <= 5.85) {
            if (Math.abs(tangentDist) > 0.65) {
                const pushRadial = 5.9;
                playerPos.x = config.x + cosDoor * pushRadial - sinDoor * tangentDist;
                playerPos.z = config.z + sinDoor * pushRadial + cosDoor * tangentDist;
                return;
            }
        }
        return;
    }

    // C. AM TURMSCHAFT & WENDELTREPPE
    const h = Math.max(0, Math.min(config.shaftHeight, yFeet - baseFloorY));
    const rOuter = config.baseRadius - (config.baseRadius - config.topRadius) * (h / config.shaftHeight);
    const rInner = rOuter - 0.28;

    // Durchgang unten am Eingang
    const isAtDoorLevel = (h >= -0.2 && h <= 3.2);
    if (isAtDoorLevel && dDoor < 0.32) {
        return;
    }

    // Durchgang oben an der Austrittstür zur Galerie
    const isAtExitLevel = (h >= 33.0);
    if (isAtExitLevel && dExit < 0.35) {
        return;
    }

    // Kameraschutz / Wandschutz im Turminneren:
    // Der Spieler bleibt min. 30 cm von der Außenwand fern -> Kamera kann niemals durch die Wand glitchen!
    const safeInnerR = rInner - 0.30;
    if (r > safeInnerR && r < rOuter + 0.35) {
        if (r < rInner + 0.05) {
            playerPos.x = config.x + Math.cos(playerAngle) * safeInnerR;
            playerPos.z = config.z + Math.sin(playerAngle) * safeInnerR;
        } else {
            playerPos.x = config.x + Math.cos(playerAngle) * (rOuter + 0.35);
            playerPos.z = config.z + Math.sin(playerAngle) * (rOuter + 0.35);
        }
    } else if (r < 0.48 && h > 0.3 && h < config.shaftHeight - 0.5) {
        // Schutz vor der mittleren Eisenspindel
        playerPos.x = config.x + Math.cos(playerAngle) * 0.50;
        playerPos.z = config.z + Math.sin(playerAngle) * 0.50;
    }
}
