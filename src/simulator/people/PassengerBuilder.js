import * as THREE from 'three';

export class PassengerBuilder {
    constructor() {
        this.materials = {};
    }

    getMaterial(colorHex) {
        if (!this.materials[colorHex]) {
            this.materials[colorHex] = new THREE.MeshLambertMaterial({ color: colorHex });
        }
        return this.materials[colorHex];
    }

    createCharacter(options) {
        const group = new THREE.Group();

        const skinMat = this.getMaterial(options.skinColor || '#ffdbac');
        const hairMat = this.getMaterial(options.hairColor || '#edd18c');
        const shoesMat = this.getMaterial(options.shoesColor || '#111111');
        const shirtMat = this.getMaterial(options.shirtColor || '#fa8072');
        const pantsMat = this.getMaterial(options.pantsColor || '#555555');

        // Bounding box: X: [-0.25, 0.25], Y: [0, 1.0], Z: [-0.15, 0.15]
        
        // 1. Shoes
        const shoeGeom = new THREE.BoxGeometry(0.1, 0.05, 0.14);
        const shoeL = new THREE.Mesh(shoeGeom, shoesMat);
        shoeL.position.set(-0.06, 0.025, 0.02);
        const shoeR = new THREE.Mesh(shoeGeom, shoesMat);
        shoeR.position.set(0.06, 0.025, 0.02);
        group.add(shoeL, shoeR);

        // 2. Legs (Total Y: [0.0, 0.45])
        if (options.pantsStyle === 'shorts') {
            // Upper leg is pantsColor (Y: [0.25, 0.45]), lower leg is skinColor (Y: [0.05, 0.25])
            const upperLegGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
            const lowerLegGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
            
            const upperL = new THREE.Mesh(upperLegGeom, pantsMat);
            upperL.position.set(-0.06, 0.35, 0);
            const lowerL = new THREE.Mesh(lowerLegGeom, skinMat);
            lowerL.position.set(-0.06, 0.15, 0);

            const upperR = new THREE.Mesh(upperLegGeom, pantsMat);
            upperR.position.set(0.06, 0.35, 0);
            const lowerR = new THREE.Mesh(lowerLegGeom, skinMat);
            lowerR.position.set(0.06, 0.15, 0);

            group.add(upperL, lowerL, upperR, lowerR);
        } else if (options.pantsStyle === 'skirt') {
            // Legs are skinColor (Y: [0.05, 0.45])
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, skinMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, skinMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);

            // Skirt box (Y: [0.33, 0.55])
            const skirtGeom = new THREE.BoxGeometry(0.24, 0.22, 0.16);
            const skirtMesh = new THREE.Mesh(skirtGeom, pantsMat);
            skirtMesh.position.set(0, 0.44, 0);
            group.add(skirtMesh);
        } else if (options.pantsStyle === 'dress') {
            // Legs are skinColor (Y: [0.05, 0.45])
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, skinMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, skinMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);

            // Dress skirt part (Y: [0.33, 0.59])
            const skirtGeom = new THREE.BoxGeometry(0.24, 0.26, 0.16);
            const dressMesh = new THREE.Mesh(skirtGeom, shirtMat);
            dressMesh.position.set(0, 0.46, 0);
            group.add(dressMesh);
        } else {
            // Pants style 'long' (Y: [0.05, 0.45] is pantsColor)
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(-0.06, 0.25, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0.06, 0.25, 0);
            group.add(legL, legR);
        }

        // 3. Torso (Total Y: [0.45, 0.80])
        if (options.pantsStyle === 'dress') {
            const torsoGeom = new THREE.BoxGeometry(0.22, 0.35, 0.13);
            const torsoMesh = new THREE.Mesh(torsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.625, 0);
            group.add(torsoMesh);
        } else if (options.shirtStyle === 'crop') {
            // Upper torso is shirtMat (Y: [0.60, 0.80]), lower torso is skinMat (Y: [0.45, 0.60])
            const upperTorsoGeom = new THREE.BoxGeometry(0.22, 0.2, 0.13);
            const lowerTorsoGeom = new THREE.BoxGeometry(0.22, 0.15, 0.13);
            
            const upperTorso = new THREE.Mesh(upperTorsoGeom, shirtMat);
            upperTorso.position.set(0, 0.70, 0);
            const lowerTorso = new THREE.Mesh(lowerTorsoGeom, skinMat);
            lowerTorso.position.set(0, 0.525, 0);
            
            group.add(upperTorso, lowerTorso);
        } else {
            // Standard T-shirt/shirt (Y: [0.45, 0.80] is shirtMat)
            const torsoGeom = new THREE.BoxGeometry(0.22, 0.35, 0.13);
            const torsoMesh = new THREE.Mesh(torsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.625, 0);
            group.add(torsoMesh);
        }

        // 4. Back Decal (Orange square on back of torso for Mann)
        if (options.backDecal === 'orange_square') {
            const decalGeom = new THREE.BoxGeometry(0.12, 0.12, 0.015);
            const orangeMat = this.getMaterial('#ff6600');
            const decal = new THREE.Mesh(decalGeom, orangeMat);
            decal.position.set(0, 0.65, -0.066);
            group.add(decal);
        }

        // 5. Neck (Y: [0.80, 0.83])
        const neckGeom = new THREE.BoxGeometry(0.05, 0.03, 0.05);
        const neck = new THREE.Mesh(neckGeom, skinMat);
        neck.position.set(0, 0.815, 0);
        group.add(neck);

        // 6. Head (Y: [0.83, 0.98])
        const headGeom = new THREE.BoxGeometry(0.14, 0.15, 0.14);
        const head = new THREE.Mesh(headGeom, skinMat);
        head.position.set(0, 0.905, 0);
        group.add(head);

        // 7. Hair (Off-dimensioned cap + back to prevent Z-fighting)
        // Cap top face is at Y = 0.99 (head top is at Y = 0.98) to completely prevent top-face Z-flickering.
        // Cap width is 0.152, back hair width is 0.150, strands width is 0.022 (outer at 0.077) to prevent side-face conflicts.
        const hairCapGeom = new THREE.BoxGeometry(0.152, 0.09, 0.16);
        const cap = new THREE.Mesh(hairCapGeom, hairMat);
        cap.position.set(0, 0.945, -0.008);
        group.add(cap);

        if (options.hairStyle === 'ponytail') {
            // Back hair covering top-to-bottom of head back
            const backHairGeom = new THREE.BoxGeometry(0.150, 0.12, 0.05);
            const back = new THREE.Mesh(backHairGeom, hairMat);
            back.position.set(0, 0.88, -0.065);

            // Ponytail (Zopf) extending back
            const zopfGeom = new THREE.BoxGeometry(0.04, 0.06, 0.08);
            const zopf = new THREE.Mesh(zopfGeom, hairMat);
            zopf.position.set(0, 0.90, -0.13);

            // Hair band
            const bandGeom = new THREE.BoxGeometry(0.046, 0.046, 0.015);
            const band = new THREE.Mesh(bandGeom, this.getMaterial('#111111'));
            band.position.set(0, 0.90, -0.095);

            group.add(back, zopf, band);
        } else if (options.hairStyle === 'long') {
            // Long hair split into:
            // 1. Back hair slab (Z = -0.07, spans Z [-0.091, -0.049])
            const backHairGeom = new THREE.BoxGeometry(0.150, 0.22, 0.042);
            const back = new THREE.Mesh(backHairGeom, hairMat);
            back.position.set(0, 0.81, -0.07);

            // 2. Left side strand (hangs next to face, X = -0.066, spans Z [-0.055, 0.035])
            const strandGeom = new THREE.BoxGeometry(0.022, 0.22, 0.09);
            const strandL = new THREE.Mesh(strandGeom, hairMat);
            strandL.position.set(-0.066, 0.81, -0.01);

            // 3. Right side strand (hangs next to face, X = 0.066, spans Z [-0.055, 0.035])
            const strandR = new THREE.Mesh(strandGeom, hairMat);
            strandR.position.set(0.066, 0.81, -0.01);

            group.add(back, strandL, strandR);
        } else {
            // Short hair covering back of head
            const backHairGeom = new THREE.BoxGeometry(0.150, 0.08, 0.05);
            const back = new THREE.Mesh(backHairGeom, hairMat);
            back.position.set(0, 0.88, -0.065);

            group.add(back);
        }

        // 8. Arms (Total Y: [0.48, 0.80])
        let armLMat = skinMat;
        let armRMat = skinMat;

        if (options.shirtStyle === 'long_sleeve') {
            armLMat = shirtMat;
            armRMat = shirtMat;
        }

        if (options.shirtStyle === 'tshirt') {
            // Upper arm is shirtMat (Y: [0.70, 0.80]), lower arm is skinMat (Y: [0.48, 0.70])
            const upperArmGeom = new THREE.BoxGeometry(0.06, 0.1, 0.06);
            const lowerArmGeom = new THREE.BoxGeometry(0.05, 0.22, 0.05);

            const upperArmL = new THREE.Mesh(upperArmGeom, shirtMat);
            upperArmL.position.set(-0.145, 0.75, 0);
            const lowerArmL = new THREE.Mesh(lowerArmGeom, skinMat);
            lowerArmL.position.set(-0.145, 0.59, 0);

            const upperArmR = new THREE.Mesh(upperArmGeom, shirtMat);
            upperArmR.position.set(0.145, 0.75, 0);
            const lowerArmR = new THREE.Mesh(lowerArmGeom, skinMat);
            lowerArmR.position.set(0.145, 0.59, 0);

            group.add(upperArmL, lowerArmL, upperArmR, lowerArmR);
        } else {
            // Long sleeve or sleeveless/dress
            const armGeom = new THREE.BoxGeometry(0.06, 0.32, 0.06);
            const armL = new THREE.Mesh(armGeom, armLMat);
            armL.position.set(-0.145, 0.64, 0);
            const armR = new THREE.Mesh(armGeom, armRMat);
            armR.position.set(0.145, 0.64, 0);
            group.add(armL, armR);
        }

        // 9. Accessories (Sunglasses for Frau 2)
        if (options.sunglasses) {
            const glassesGeom = new THREE.BoxGeometry(0.148, 0.03, 0.015);
            const glassesMat = this.getMaterial('#222222');
            const glasses = new THREE.Mesh(glassesGeom, glassesMat);
            glasses.position.set(0, 0.905, 0.071);
            group.add(glasses);
        }

        // Scale entire group to match target height (bounding box is 1.0 high)
        const scale = options.height || 1.80;
        group.scale.set(scale, scale, scale);

        return group;
    }
}
