// Node test script to verify AW169 3D model geometry construction
import * as THREE from './../node_modules/three/build/three.module.js';

console.log("Testing AW169 3D Model Hierarchy...");

function buildTestAW169() {
    const heliGroup = new THREE.Group();
    heliGroup.name = "AW169_Helicopter";

    // Dummy materials for geometry test
    const matWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const matGlass = new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.5 });
    const matBlade = new THREE.MeshBasicMaterial({ color: 0x111111 });

    // 1. Cabin Fuselage
    const cabinGeo = new THREE.BoxGeometry(2.2, 1.8, 3.8);
    const cabin = new THREE.Mesh(cabinGeo, matWhite);
    cabin.position.set(0, 1.35, 0.4);
    heliGroup.add(cabin);

    // 2. Nose Cone
    const noseGeo = new THREE.ConeGeometry(1.0, 2.0, 16);
    noseGeo.rotateX(Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, matWhite);
    nose.position.set(0, 1.15, 3.3);
    nose.scale.set(1.1, 0.85, 1.0);
    heliGroup.add(nose);

    // 3. Tail Boom
    const boomGeo = new THREE.CylinderGeometry(0.22, 0.55, 7.2, 16);
    boomGeo.rotateX(Math.PI / 2);
    const boom = new THREE.Mesh(boomGeo, matWhite);
    boom.position.set(0, 1.45, -5.1);
    heliGroup.add(boom);

    // 4. Vertical Fin
    const finGeo = new THREE.BoxGeometry(0.18, 2.2, 1.4);
    const fin = new THREE.Mesh(finGeo, matWhite);
    fin.position.set(0, 2.45, -8.7);
    fin.rotation.x = -0.35; // swept fin
    heliGroup.add(fin);

    // 5. Horizontal Stabilizer with Canted Endplates
    const stabGeo = new THREE.BoxGeometry(2.6, 0.08, 0.5);
    const stab = new THREE.Mesh(stabGeo, matWhite);
    stab.position.set(0, 1.45, -7.4);
    heliGroup.add(stab);

    [-1.3, 1.3].forEach(sideX => {
        const endplateGeo = new THREE.BoxGeometry(0.06, 0.7, 0.45);
        const endplate = new THREE.Mesh(endplateGeo, matWhite);
        endplate.position.set(sideX, 1.45, -7.4);
        endplate.rotation.z = sideX > 0 ? -0.25 : 0.25;
        heliGroup.add(endplate);
    });

    // 6. 5-Blade Main Rotor
    const mainRotorGroup = new THREE.Group();
    mainRotorGroup.position.set(0, 3.25, 0.45);
    heliGroup.add(mainRotorGroup);

    const hubGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.25, 10);
    mainRotorGroup.add(new THREE.Mesh(hubGeo, matBlade));

    for (let i = 0; i < 5; i++) {
        const bladeArm = new THREE.Group();
        bladeArm.rotation.y = i * (Math.PI * 2 / 5);

        const bladeGeo = new THREE.BoxGeometry(0.32, 0.04, 5.5);
        const blade = new THREE.Mesh(bladeGeo, matBlade);
        blade.position.set(0, 0, 2.85);
        bladeArm.add(blade);

        mainRotorGroup.add(bladeArm);
    }

    // 7. 4-Blade Tail Rotor
    const tailRotorGroup = new THREE.Group();
    tailRotorGroup.position.set(0.25, 3.0, -9.1);
    heliGroup.add(tailRotorGroup);

    for (let i = 0; i < 4; i++) {
        const bladeArm = new THREE.Group();
        bladeArm.rotation.x = i * (Math.PI / 2);

        const tBladeGeo = new THREE.BoxGeometry(0.04, 1.0, 0.16);
        const tBlade = new THREE.Mesh(tBladeGeo, matBlade);
        tBlade.position.set(0, 0.5, 0);
        bladeArm.add(tBlade);

        tailRotorGroup.add(bladeArm);
    }

    // 8. Sponsons and Landing Wheels
    [-1.25, 1.25].forEach(sideX => {
        const sponsonGeo = new THREE.BoxGeometry(0.5, 0.45, 2.2);
        const sponson = new THREE.Mesh(sponsonGeo, matWhite);
        sponson.position.set(sideX, 0.55, 0.2);
        heliGroup.add(sponson);

        const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.15, 16);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheel = new THREE.Mesh(wheelGeo, matBlade);
        wheel.position.set(sideX, 0.24, 0.2);
        heliGroup.add(wheel);
    });

    // Nose wheel
    const noseWheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.16, 16);
    noseWheelGeo.rotateZ(Math.PI / 2);
    const noseWheel = new THREE.Mesh(noseWheelGeo, matBlade);
    noseWheel.position.set(0, 0.18, 3.2);
    heliGroup.add(noseWheel);

    console.log(`Total children in heliGroup: ${heliGroup.children.length}`);
    return heliGroup;
}

const heli = buildTestAW169();
console.log("PASS: AW169 3D model assembled successfully!");
