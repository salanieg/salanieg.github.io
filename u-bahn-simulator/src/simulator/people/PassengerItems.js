// ============================================================================
// PassengerItems.js ? Prozedurale Gegenstaende fuer Fahrgaeste (1:1 Voxel-Design)
// Vollstaendig Z-Fighting-frei: Keine koplanaren oder penetrierenden Detailflaechen!
// ============================================================================
import * as THREE from 'three';

export function buildPassengerItem(builder, group, item, skinMat, customHR, customHL) {
    const hR = customHR ? customHR.clone() : new THREE.Vector3(0.145, 0.48, 0.05);
    const hL = customHL ? customHL.clone() : new THREE.Vector3(-0.145, 0.48, 0.05);

    switch (item) {
        // --- 1. SPEISEN & GETRAENKE ---
        case 'kaffeebecher': {
            const cup = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.06), builder.getMaterial('#f8fafc'));
            cup.position.set(hR.x, hR.y + 0.01, hR.z);
            const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.04, 0.066), builder.getMaterial('#854d0e'));
            sleeve.position.set(hR.x, hR.y, hR.z);
            const lid = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.015, 0.066), builder.getMaterial('#18181b'));
            lid.position.set(hR.x, hR.y + 0.053, hR.z);
            group.add(cup, sleeve, lid);
            break;
        }
        case 'coffeetogo': {
            const cup = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.095, 0.06), builder.getMaterial('#ffffff'));
            cup.position.set(hR.x, hR.y + 0.01, hR.z);
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.03, 0.066), builder.getMaterial('#00704a'));
            band.position.set(hR.x, hR.y + 0.015, hR.z);
            const lid = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.015, 0.066), builder.getMaterial('#f1f5f9'));
            lid.position.set(hR.x, hR.y + 0.056, hR.z);
            group.add(cup, band, lid);
            break;
        }
        case 'bierdose': {
            const can = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.10, 0.055), builder.getMaterial('#15803d'));
            can.position.set(hR.x, hR.y + 0.01, hR.z);
            const rimTop = new THREE.Mesh(new THREE.BoxGeometry(0.053, 0.01, 0.053), builder.getMaterial('#cbd5e1'));
            rimTop.position.set(hR.x, hR.y + 0.063, hR.z);
            const rimBot = new THREE.Mesh(new THREE.BoxGeometry(0.053, 0.008, 0.053), builder.getMaterial('#cbd5e1'));
            rimBot.position.set(hR.x, hR.y - 0.043, hR.z);
            const tab = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.003, 0.022), builder.getMaterial('#e2e8f0'));
            tab.position.set(hR.x, hR.y + 0.069, hR.z);
            group.add(can, rimTop, rimBot, tab);
            break;
        }
        case 'bierflasche': {
            const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.050, 0.11, 0.050), builder.getMaterial('#78350f'));
            bottle.position.set(hR.x, hR.y, hR.z);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.06, 0.022), builder.getMaterial('#78350f'));
            neck.position.set(hR.x, hR.y + 0.08, hR.z);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.01, 0.026), builder.getMaterial('#f59e0b'));
            cap.position.set(hR.x, hR.y + 0.113, hR.z);
            const label = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.05, 0.056), builder.getMaterial('#fef3c7'));
            label.position.set(hR.x, hR.y - 0.01, hR.z);
            group.add(bottle, neck, cap, label);
            break;
        }
        case 'craftbeer': {
            const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.050, 0.11, 0.050), builder.getMaterial('#1c1917'));
            bottle.position.set(hR.x, hR.y, hR.z);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.06, 0.022), builder.getMaterial('#1c1917'));
            neck.position.set(hR.x, hR.y + 0.08, hR.z);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.01, 0.026), builder.getMaterial('#cbd5e1'));
            cap.position.set(hR.x, hR.y + 0.113, hR.z);
            const label = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.05, 0.056), builder.getMaterial('#ea580c'));
            label.position.set(hR.x, hR.y - 0.01, hR.z);
            group.add(bottle, neck, cap, label);
            break;
        }
        case 'bierkrug': {
            const mug = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.075), builder.getMaterial('#cbd5e1'));
            mug.position.set(hR.x, hR.y + 0.015, hR.z);
            const foam = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.03, 0.078), builder.getMaterial('#ffffff'));
            foam.position.set(hR.x, hR.y + 0.075, hR.z);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.08, 0.035), builder.getMaterial('#cbd5e1'));
            handle.position.set(hR.x - 0.046, hR.y + 0.015, hR.z);
            group.add(mug, foam, handle);
            break;
        }
        case 'trinkflasche': {
            const bottle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.055), builder.getMaterial('#0284c7'));
            bottle.position.set(hR.x, hR.y, hR.z);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.025, 0.048), builder.getMaterial('#18181b'));
            cap.position.set(hR.x, hR.y + 0.075, hR.z);
            const spout = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.02), builder.getMaterial('#cbd5e1'));
            spout.position.set(hR.x, hR.y + 0.093, hR.z);
            group.add(bottle, cap, spout);
            break;
        }
        case 'thermoskanne': {
            const flask = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.06), builder.getMaterial('#94a3b8'));
            flask.position.set(hR.x, hR.y + 0.015, hR.z);
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.04, 0.066), builder.getMaterial('#18181b'));
            band.position.set(hR.x, hR.y + 0.01, hR.z);
            const cupLid = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.035, 0.064), builder.getMaterial('#cbd5e1'));
            cupLid.position.set(hR.x, hR.y + 0.115, hR.z);
            group.add(flask, band, cupLid);
            break;
        }
        case 'energy': {
            const can = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.045), builder.getMaterial('#1d4ed8'));
            can.position.set(hR.x, hR.y + 0.01, hR.z);
            const silverTop = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.03, 0.046), builder.getMaterial('#cbd5e1'));
            silverTop.position.set(hR.x, hR.y + 0.045, hR.z);
            const tab = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.02), builder.getMaterial('#ffffff'));
            tab.position.set(hR.x, hR.y + 0.068, hR.z);
            group.add(can, silverTop, tab);
            break;
        }
        case 'pommes': {
            const cup = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.045), builder.getMaterial('#dc2626'));
            cup.position.set(hR.x, hR.y + 0.01, hR.z + 0.01);
            cup.rotation.x = -Math.PI / 10;
            const fryMat = builder.getMaterial('#facc15');
            for (let i = 0; i < 5; i++) {
                const fry = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.045, 0.009), fryMat);
                fry.position.set(hR.x + (i - 2) * 0.009, hR.y + 0.055 + (i % 2) * 0.008, hR.z + 0.01);
                fry.rotation.x = -Math.PI / 10;
                group.add(fry);
            }
            const ketchup = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.015), builder.getMaterial('#b91c1c'));
            ketchup.position.set(hR.x, hR.y + 0.065, hR.z + 0.02);
            group.add(cup, ketchup);
            break;
        }
        case 'bratwurst': {
            const roll = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.12), builder.getMaterial('#d97706'));
            roll.position.set(hR.x, hR.y + 0.01, hR.z);
            const wurst = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.18), builder.getMaterial('#78350f'));
            wurst.position.set(hR.x, hR.y + 0.026, hR.z);
            const senf = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.006, 0.13), builder.getMaterial('#eab308'));
            senf.position.set(hR.x, hR.y + 0.043, hR.z);
            group.add(roll, wurst, senf);
            break;
        }
        case 'stadionwurst': {
            const bun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.12), builder.getMaterial('#d97706'));
            bun.position.set(hR.x, hR.y + 0.01, hR.z);
            const sausage = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.18), builder.getMaterial('#78350f'));
            sausage.position.set(hR.x, hR.y + 0.026, hR.z);
            const mustard = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.006, 0.13), builder.getMaterial('#eab308'));
            mustard.position.set(hR.x, hR.y + 0.043, hR.z);
            group.add(bun, sausage, mustard);
            break;
        }
        case 'breze': {
            const bColor = builder.getMaterial('#92400e');
            const saltMat = builder.getMaterial('#ffffff');
            const arch = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.022), bColor);
            arch.position.set(hR.x, hR.y + 0.01, hR.z);
            const armL = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.075, 0.018), bColor);
            armL.position.set(hR.x - 0.035, hR.y + 0.04, hR.z);
            armL.rotation.z = -0.3;
            const armR = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.075, 0.018), bColor);
            armR.position.set(hR.x + 0.035, hR.y + 0.04, hR.z);
            armR.rotation.z = 0.3;
            const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.008), saltMat);
            s1.position.set(hR.x - 0.02, hR.y + 0.01, hR.z + 0.016);
            const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.008), saltMat);
            s2.position.set(hR.x + 0.02, hR.y + 0.01, hR.z + 0.016);
            group.add(arch, armL, armR, s1, s2);
            break;
        }
        case 'doener': {
            const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.045), builder.getMaterial('#fef08a'));
            pocket.position.set(hR.x, hR.y + 0.02, hR.z);
            pocket.rotation.x = -Math.PI / 8;
            const foil = new THREE.Mesh(new THREE.BoxGeometry(0.118, 0.055, 0.052), builder.getMaterial('#cbd5e1'));
            foil.position.set(pocket.position.x, pocket.position.y - 0.03, pocket.position.z);
            foil.rotation.copy(pocket.rotation);
            const salad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.035), builder.getMaterial('#22c55e'));
            salad.position.set(pocket.position.x, pocket.position.y + 0.055, pocket.position.z);
            salad.rotation.copy(pocket.rotation);
            const tomato = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.02), builder.getMaterial('#ef4444'));
            tomato.position.set(pocket.position.x + 0.02, pocket.position.y + 0.065, pocket.position.z);
            tomato.rotation.copy(pocket.rotation);
            group.add(pocket, foil, salad, tomato);
            break;
        }
        case 'brotzeitdose': {
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.055, 0.09), builder.getMaterial('#0284c7'));
            box.position.set(hR.x, hR.y, hR.z);
            const lid = new THREE.Mesh(new THREE.BoxGeometry(0.136, 0.015, 0.096), builder.getMaterial('#f8fafc'));
            lid.position.set(hR.x, hR.y + 0.035, hR.z);
            group.add(box, lid);
            break;
        }
        case 'lebkuchenherz': {
            const heart = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.018), builder.getMaterial('#451a03'));
            heart.position.set(hR.x, hR.y + 0.02, hR.z);
            const icing = new THREE.Mesh(new THREE.BoxGeometry(0.138, 0.138, 0.005), builder.getMaterial('#ffffff'));
            icing.position.set(hR.x, hR.y + 0.02, hR.z + 0.011);
            const textStripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.004), builder.getMaterial('#facc15'));
            textStripe.position.set(hR.x, hR.y + 0.02, hR.z + 0.014);
            group.add(heart, icing, textStripe);
            break;
        }

        // --- 2. ELEKTRONIK & FOTO ---
        case 'smartphone': {
            const phoneGroup = new THREE.Group();
            phoneGroup.position.set(hR.x, hR.y, hR.z + 0.02);
            phoneGroup.rotation.x = -Math.PI / 5;

            const phone = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.008), builder.getMaterial('#18181b'));
            const screen = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.098, 0.002), builder.getMaterial('#7dd3fc'));
            screen.position.set(0, 0, 0.005);
            const cam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.002), builder.getMaterial('#18181b'));
            cam.position.set(-0.015, 0.035, -0.005);

            phoneGroup.add(phone, screen, cam);
            group.add(phoneGroup);
            break;
        }
        case 'tablet': {
            const tabGroup = new THREE.Group();
            tabGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            tabGroup.rotation.x = -Math.PI / 5;

            const tabBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.19, 0.008), builder.getMaterial('#18181b'));
            const tabScreen = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.176, 0.002), builder.getMaterial('#e0f2fe'));
            tabScreen.position.set(0, 0, 0.005);

            tabGroup.add(tabBody, tabScreen);
            group.add(tabGroup);
            break;
        }
        case 'ereader': {
            const erGroup = new THREE.Group();
            erGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            erGroup.rotation.x = -Math.PI / 5;

            const erBody = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.008), builder.getMaterial('#4b5563'));
            const erScreen = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.13, 0.002), builder.getMaterial('#f5f5f4'));
            erScreen.position.set(0, 0, 0.005);

            erGroup.add(erBody, erScreen);
            group.add(erGroup);
            break;
        }
        case 'laptop': {
            const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.13), builder.getMaterial('#cbd5e1'));
            base.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.01, (hR.z + hL.z) / 2 + 0.04);
            const kb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.003, 0.08), builder.getMaterial('#18181b'));
            kb.position.set(base.position.x, base.position.y + 0.0075, base.position.z - 0.01);
            
            const lidGroup = new THREE.Group();
            lidGroup.position.set(base.position.x, base.position.y + 0.006, base.position.z - 0.065);
            lidGroup.rotation.x = -Math.PI / 8;
            const screenLid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.008), builder.getMaterial('#94a3b8'));
            screenLid.position.set(0, 0.065, 0);
            const display = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.002), builder.getMaterial('#f8fafc'));
            display.position.set(0, 0.065, 0.005);
            lidGroup.add(screenLid, display);

            group.add(base, kb, lidGroup);
            break;
        }
        case 'fotoapparat': {
            const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.065, 0.035), builder.getMaterial('#cbd5e1'));
            camBody.position.set(hR.x, hR.y, hR.z + 0.03);
            const camLeather = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.045, 0.038), builder.getMaterial('#18181b'));
            camLeather.position.set(hR.x, hR.y - 0.005, hR.z + 0.03);
            const camLens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 8), builder.getMaterial('#18181b'));
            camLens.position.set(hR.x, hR.y - 0.005, hR.z + 0.055);
            camLens.rotation.x = Math.PI / 2;
            const camGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004), builder.getMaterial('#0284c7'));
            camGlass.position.set(hR.x, hR.y - 0.005, hR.z + 0.069);
            camGlass.rotation.x = Math.PI / 2;
            group.add(camBody, camLeather, camLens, camGlass);
            break;
        }
        case 'slr_camera': {
            const slrBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.055), builder.getMaterial('#18181b'));
            slrBody.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.03);
            const slrPrism = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.04), builder.getMaterial('#18181b'));
            slrPrism.position.set(slrBody.position.x, slrBody.position.y + 0.05, slrBody.position.z);
            const slrLens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), builder.getMaterial('#09090b'));
            slrLens.position.set(slrBody.position.x, slrBody.position.y, slrBody.position.z + 0.055);
            slrLens.rotation.x = Math.PI / 2;
            const slrRing = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.015, 10), builder.getMaterial('#27272a'));
            slrRing.position.set(slrBody.position.x, slrBody.position.y, slrBody.position.z + 0.055);
            slrRing.rotation.x = Math.PI / 2;
            group.add(slrBody, slrPrism, slrLens, slrRing);
            break;
        }
        case 'action_cam': {
            const camCube = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.035), builder.getMaterial('#1e293b'));
            camCube.position.set(hR.x, hR.y + 0.09, hR.z + 0.02);
            const camLens2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.005), builder.getMaterial('#0284c7'));
            camLens2.position.set(hR.x, hR.y + 0.09, hR.z + 0.04);
            const gripPole = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.015), builder.getMaterial('#ea580c'));
            gripPole.position.set(hR.x, hR.y + 0.02, hR.z + 0.02);
            group.add(camCube, camLens2, gripPole);
            break;
        }
        case 'kopfhoerer': {
            const hBand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), builder.getMaterial('#18181b'));
            hBand.position.set(0, 0.81, 0);
            const cupL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.03), builder.getMaterial('#0284c7'));
            cupL.position.set(-0.09, 0.81, 0.04);
            const cupR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.03), builder.getMaterial('#0284c7'));
            cupR.position.set(0.09, 0.81, 0.04);
            group.add(hBand, cupL, cupR);
            break;
        }
        case 'lautsprecher': {
            const spk = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.065, 0.065), builder.getMaterial('#dc2626'));
            spk.position.set(hR.x, hR.y, hR.z);
            const capL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.07, 0.07), builder.getMaterial('#18181b'));
            capL.position.set(hR.x - 0.07, hR.y, hR.z);
            const capR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.07, 0.07), builder.getMaterial('#18181b'));
            capR.position.set(hR.x + 0.07, hR.y, hR.z);
            const grille = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.004), builder.getMaterial('#374151'));
            grille.position.set(hR.x, hR.y, hR.z + 0.035);
            group.add(spk, capL, capR, grille);
            break;
        }
        case 'taschenlampe': {
            const tGrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), builder.getMaterial('#18181b'));
            tGrip.position.set(hR.x, hR.y + 0.02, hR.z);
            tGrip.rotation.x = Math.PI / 4;
            const tHead = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), builder.getMaterial('#18181b'));
            tHead.position.set(hR.x, hR.y + 0.08, hR.z + 0.06);
            tHead.rotation.x = Math.PI / 4;
            const tLens = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.005, 0.042), builder.getMaterial('#fef08a'));
            tLens.position.set(hR.x, hR.y + 0.098, hR.z + 0.078);
            tLens.rotation.x = Math.PI / 4;
            group.add(tGrip, tHead, tLens);
            break;
        }
        case 'akkuschrauber': {
            const drillBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.14), builder.getMaterial('#15803d'));
            drillBody.position.set(hR.x, hR.y + 0.02, hR.z + 0.04);
            const drillGrip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.04), builder.getMaterial('#18181b'));
            drillGrip.position.set(hR.x, hR.y, hR.z);
            const battery = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.08), builder.getMaterial('#18181b'));
            battery.position.set(hR.x, hR.y - 0.05, hR.z);
            const chuck = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.06), builder.getMaterial('#cbd5e1'));
            chuck.position.set(hR.x, hR.y + 0.02, hR.z + 0.13);
            group.add(drillBody, drillGrip, battery, chuck);
            break;
        }
        case 'multimeter': {
            const mMeter = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.035), builder.getMaterial('#eab308'));
            mMeter.position.set(hR.x, hR.y + 0.01, hR.z);
            const mScreen = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.003), builder.getMaterial('#a3e635'));
            mScreen.position.set(hR.x, hR.y + 0.038, hR.z + 0.019);
            const mDial = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.004, 8), builder.getMaterial('#18181b'));
            mDial.position.set(hR.x, hR.y - 0.018, hR.z + 0.019);
            mDial.rotation.x = Math.PI / 2;
            group.add(mMeter, mScreen, mDial);
            break;
        }
        case 'knicklicht': {
            const stick = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.16, 0.015), builder.getMaterial('#22c55e'));
            stick.position.set(hR.x, hR.y + 0.04, hR.z);
            const hook = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.008), builder.getMaterial('#22c55e'));
            hook.position.set(hR.x, hR.y + 0.125, hR.z);
            group.add(stick, hook);
            break;
        }

        // --- 3. DOKUMENTE, BUECHER & PAPIER ---
        case 'buch': {
            const bGroup = new THREE.Group();
            bGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            bGroup.rotation.x = -Math.PI / 4;

            const cover = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.026), builder.getMaterial('#0f766e'));
            const pages = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.172, 0.022), builder.getMaterial('#ffffff'));
            pages.position.set(0.004, 0, 0.003);
            const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.09, 0.002), builder.getMaterial('#f59e0b'));
            ribbon.position.set(0, -0.05, 0.015);

            bGroup.add(cover, pages, ribbon);
            group.add(bGroup);
            break;
        }
        case 'schulbuch': {
            const sbGroup = new THREE.Group();
            sbGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            sbGroup.rotation.x = -Math.PI / 4;

            const cover = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.026), builder.getMaterial('#2563eb'));
            const pages = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.172, 0.022), builder.getMaterial('#ffffff'));
            pages.position.set(0.004, 0, 0.003);
            const badge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.003), builder.getMaterial('#facc15'));
            badge.position.set(0, 0, 0.015);

            sbGroup.add(cover, pages, badge);
            group.add(sbGroup);
            break;
        }
        case 'bgb': {
            const bgbGroup = new THREE.Group();
            bgbGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            bgbGroup.rotation.x = -Math.PI / 4;

            const cover = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.038), builder.getMaterial('#b91c1c'));
            const pages = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.162, 0.034), builder.getMaterial('#ffffff'));
            pages.position.set(0.003, 0, 0.003);
            const goldTitle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.022, 0.002), builder.getMaterial('#f59e0b'));
            goldTitle.position.set(0, 0.03, 0.021);

            bgbGroup.add(cover, pages, goldTitle);
            group.add(bgbGroup);
            break;
        }
        case 'quellekatalog': {
            const catGroup = new THREE.Group();
            catGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            catGroup.rotation.x = -Math.PI / 4;

            const cover = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.19, 0.048), builder.getMaterial('#facc15'));
            const pages = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.182, 0.044), builder.getMaterial('#f3f4f6'));
            pages.position.set(0.004, 0, 0.003);

            catGroup.add(cover, pages);
            group.add(catGroup);
            break;
        }
        case 'reisefuehrer': {
            const rGroup = new THREE.Group();
            rGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            rGroup.rotation.x = -Math.PI / 4;

            const guide = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.15, 0.022), builder.getMaterial('#ea580c'));
            const spine = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.154, 0.024), builder.getMaterial('#0284c7'));
            spine.position.set(-0.045, 0, 0);

            rGroup.add(guide, spine);
            group.add(rGroup);
            break;
        }
        case 'zeitung': {
            const pGroup = new THREE.Group();
            pGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            pGroup.rotation.x = -Math.PI / 5;

            const paper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.004), builder.getMaterial('#f1f5f9'));
            const headline = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.002), builder.getMaterial('#374151'));
            headline.position.set(0, 0.07, 0.0035);
            const column = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.002), builder.getMaterial('#475569'));
            column.position.set(0, -0.02, 0.0035);

            pGroup.add(paper, headline, column);
            group.add(pGroup);
            break;
        }
        case 'fahrplan': {
            const fpGroup = new THREE.Group();
            fpGroup.position.set(hR.x, hR.y + 0.03, hR.z + 0.04);
            fpGroup.rotation.x = -Math.PI / 4;

            const plan = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.004), builder.getMaterial('#ffffff'));
            const dbHeader = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.002), builder.getMaterial('#dc2626'));
            dbHeader.position.set(0, 0.055, 0.0035);
            const table = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.002), builder.getMaterial('#374151'));
            table.position.set(0, -0.015, 0.0035);

            fpGroup.add(plan, dbHeader, table);
            group.add(fpGroup);
            break;
        }
        case 'netzplan': {
            const npGroup = new THREE.Group();
            npGroup.position.set(hR.x, hR.y + 0.03, hR.z + 0.04);
            npGroup.rotation.x = -Math.PI / 4;

            const nMap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.004), builder.getMaterial('#ffffff'));
            const lineU1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.002), builder.getMaterial('#1d4ed8'));
            lineU1.position.set(0, 0.04, 0.0035);
            const lineU2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.002), builder.getMaterial('#dc2626'));
            lineU2.position.set(0, 0.01, 0.0035);
            const lineU3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.002), builder.getMaterial('#0d9488'));
            lineU3.position.set(0, -0.02, 0.0035);

            npGroup.add(nMap, lineU1, lineU2, lineU3);
            group.add(npGroup);
            break;
        }
        case 'stadtplan': {
            const smGroup = new THREE.Group();
            smGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            smGroup.rotation.x = -Math.PI / 5;

            const mMap = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.20, 0.004), builder.getMaterial('#fef9c3'));
            const river = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.002), builder.getMaterial('#38bdf8'));
            river.position.set(0, 0, 0.0035);

            smGroup.add(mMap, river);
            group.add(smGroup);
            break;
        }
        case 'notizblock': {
            const nbGroup = new THREE.Group();
            nbGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            nbGroup.rotation.x = -Math.PI / 4;

            const nBlock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.010), builder.getMaterial('#ffffff'));
            const nSpiral = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.012), builder.getMaterial('#94a3b8'));
            nSpiral.position.set(0, 0.065, 0);

            nbGroup.add(nBlock, nSpiral);
            group.add(nbGroup);
            break;
        }
        case 'schreibmappe': {
            const folder = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.025), builder.getMaterial('#18181b'));
            folder.position.set(hR.x, hR.y - 0.04, hR.z);
            const zip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.224, 0.027), builder.getMaterial('#cbd5e1'));
            zip.position.set(hR.x + 0.08, hR.y - 0.04, hR.z);
            group.add(folder, zip);
            break;
        }
        case 'klemmbrett': {
            const kbGroup = new THREE.Group();
            kbGroup.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.04);
            kbGroup.rotation.x = -Math.PI / 5;

            const board = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.22, 0.008), builder.getMaterial('#78350f'));
            const cPaper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.003), builder.getMaterial('#ffffff'));
            cPaper.position.set(0, -0.01, 0.006);
            const cClip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.012), builder.getMaterial('#cbd5e1'));
            cClip.position.set(0, 0.095, 0.008);

            kbGroup.add(board, cPaper, cClip);
            group.add(kbGroup);
            break;
        }
        case 'patientenakte': {
            const paGroup = new THREE.Group();
            paGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            paGroup.rotation.x = -Math.PI / 4;

            const mFolder = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.20, 0.008), builder.getMaterial('#fef08a'));
            const redCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.002), builder.getMaterial('#dc2626'));
            redCrossH.position.set(0.04, 0.06, 0.0055);
            const redCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.002), builder.getMaterial('#dc2626'));
            redCrossV.position.set(0.04, 0.06, 0.0055);

            paGroup.add(mFolder, redCrossH, redCrossV);
            group.add(paGroup);
            break;
        }
        case 'klassenarbeit': {
            const kaGroup = new THREE.Group();
            kaGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            kaGroup.rotation.x = -Math.PI / 4;

            const paperTest = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.004), builder.getMaterial('#ffffff'));
            const redGrade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.002), builder.getMaterial('#dc2626'));
            redGrade.position.set(0.035, 0.05, 0.0035);

            kaGroup.add(paperTest, redGrade);
            group.add(kaGroup);
            break;
        }
        case 'flyerstapel': {
            const fStack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.022, 0.11), builder.getMaterial('#ec4899'));
            fStack.position.set(hR.x, hR.y + 0.011, hR.z);
            const topFlyer = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.003, 0.106), builder.getMaterial('#fdf2f8'));
            topFlyer.position.set(hR.x, hR.y + 0.023, hR.z);
            group.add(fStack, topFlyer);
            break;
        }

        // --- 4. TASCHEN, KOFFER & BEHAELTER ---
        case 'aktenkoffer': {
            const caseBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.08), builder.getMaterial('#3e2723'));
            caseBox.position.set(hR.x, hR.y - 0.11, hR.z);
            const cHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.015), builder.getMaterial('#18181b'));
            cHandle.position.set(hR.x, hR.y - 0.01, hR.z);
            const lockL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.004), builder.getMaterial('#f59e0b'));
            lockL.position.set(hR.x - 0.08, hR.y - 0.06, hR.z + 0.043);
            const lockR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.004), builder.getMaterial('#f59e0b'));
            lockR.position.set(hR.x + 0.08, hR.y - 0.06, hR.z + 0.043);
            group.add(caseBox, cHandle, lockL, lockR);
            break;
        }
        case 'lederaktentasche': {
            const lBag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.07), builder.getMaterial('#9a3412'));
            lBag.position.set(hR.x, hR.y - 0.11, hR.z);
            const flap = new THREE.Mesh(new THREE.BoxGeometry(0.244, 0.09, 0.074), builder.getMaterial('#7c2d12'));
            flap.position.set(hR.x, hR.y - 0.07, hR.z);
            const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 0.004), builder.getMaterial('#f59e0b'));
            b1.position.set(hR.x - 0.06, hR.y - 0.10, hR.z + 0.040);
            const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 0.004), builder.getMaterial('#f59e0b'));
            b2.position.set(hR.x + 0.06, hR.y - 0.10, hR.z + 0.040);
            const lHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.015), builder.getMaterial('#7c2d12'));
            lHandle.position.set(hR.x, hR.y - 0.01, hR.z);
            group.add(lBag, flap, b1, b2, lHandle);
            break;
        }
        case 'werkzeugkoffer': {
            const toolBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.12), builder.getMaterial('#1e40af'));
            toolBox.position.set(hR.x, hR.y - 0.10, hR.z);
            const tHandle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.02), builder.getMaterial('#cbd5e1'));
            tHandle.position.set(hR.x, hR.y - 0.01, hR.z);
            const latchL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 0.004), builder.getMaterial('#cbd5e1'));
            latchL.position.set(hR.x - 0.07, hR.y - 0.05, hR.z + 0.063);
            const latchR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 0.004), builder.getMaterial('#cbd5e1'));
            latchR.position.set(hR.x + 0.07, hR.y - 0.05, hR.z + 0.063);
            group.add(toolBox, tHandle, latchL, latchR);
            break;
        }
        case 'sporttasche': {
            const duffel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.12), builder.getMaterial('#1e3a8a'));
            duffel.position.set(hR.x, hR.y - 0.09, hR.z);
            const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.128, 0.128), builder.getMaterial('#ffffff'));
            s1.position.set(hR.x - 0.05, hR.y - 0.09, hR.z);
            const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.128, 0.128), builder.getMaterial('#ffffff'));
            s2.position.set(hR.x + 0.05, hR.y - 0.09, hR.z);
            const dStrap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.015), builder.getMaterial('#18181b'));
            dStrap.position.set(hR.x, hR.y - 0.01, hR.z);
            group.add(duffel, s1, s2, dStrap);
            break;
        }
        case 'schulranzen': {
            const packBody = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.24, 0.11), builder.getMaterial('#eab308'));
            packBody.position.set(0, 0.62, -0.11);
            const flapTop = new THREE.Mesh(new THREE.BoxGeometry(0.206, 0.08, 0.116), builder.getMaterial('#ca8a04'));
            flapTop.position.set(0, 0.70, -0.11);
            const refStripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.003), builder.getMaterial('#e2e8f0'));
            refStripe.position.set(0, 0.58, -0.170);
            const refOrange1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.003), builder.getMaterial('#ea580c'));
            refOrange1.position.set(-0.07, 0.63, -0.170);
            const refOrange2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.003), builder.getMaterial('#ea580c'));
            refOrange2.position.set(0.07, 0.63, -0.170);
            group.add(packBody, flapTop, refStripe, refOrange1, refOrange2);
            break;
        }
        case 'paket': {
            const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.18), builder.getMaterial('#d2b48c'));
            parcel.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.08);
            const tapeH = new THREE.Mesh(new THREE.BoxGeometry(0.204, 0.025, 0.184), builder.getMaterial('#854d0e'));
            tapeH.position.copy(parcel.position);
            const tapeV = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.164, 0.184), builder.getMaterial('#854d0e'));
            tapeV.position.copy(parcel.position);
            const labelP = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.003), builder.getMaterial('#ffffff'));
            labelP.position.set(parcel.position.x, parcel.position.y + 0.02, parcel.position.z + 0.093);
            group.add(parcel, tapeH, tapeV, labelP);
            break;
        }
        case 'flachpaket': {
            const flatBox = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.42), builder.getMaterial('#d2b48c'));
            flatBox.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.01, (hR.z + hL.z) / 2 + 0.05);
            const fStrap1 = new THREE.Mesh(new THREE.BoxGeometry(0.184, 0.064, 0.015), builder.getMaterial('#18181b'));
            fStrap1.position.set(flatBox.position.x, flatBox.position.y, flatBox.position.z - 0.10);
            const fStrap2 = new THREE.Mesh(new THREE.BoxGeometry(0.184, 0.064, 0.015), builder.getMaterial('#18181b'));
            fStrap2.position.set(flatBox.position.x, flatBox.position.y, flatBox.position.z + 0.10);
            group.add(flatBox, fStrap1, fStrap2);
            break;
        }
        case 'schuhkarton': {
            const sBox = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.24), builder.getMaterial('#ea580c'));
            sBox.position.set(hR.x, hR.y - 0.03, hR.z + 0.05);
            const sLid = new THREE.Mesh(new THREE.BoxGeometry(0.168, 0.03, 0.248), builder.getMaterial('#c2410c'));
            sLid.position.set(sBox.position.x, sBox.position.y + 0.045, sBox.position.z);
            const sLogo = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.003), builder.getMaterial('#ffffff'));
            sLogo.position.set(sBox.position.x, sBox.position.y, sBox.position.z + 0.123);
            group.add(sBox, sLid, sLogo);
            break;
        }
        case 'koffer': {
            const suitcase = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 0.15), builder.getMaterial('#18181b'));
            suitcase.position.set(hR.x + 0.04, 0.22, hR.z);
            const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), builder.getMaterial('#71717a'));
            w1.position.set(suitcase.position.x - 0.08, 0.02, suitcase.position.z - 0.05);
            const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), builder.getMaterial('#71717a'));
            w2.position.set(suitcase.position.x + 0.08, 0.02, suitcase.position.z - 0.05);
            const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), builder.getMaterial('#71717a'));
            w3.position.set(suitcase.position.x - 0.08, 0.02, suitcase.position.z + 0.05);
            const w4 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), builder.getMaterial('#71717a'));
            w4.position.set(suitcase.position.x + 0.08, 0.02, suitcase.position.z + 0.05);
            const handlePole = new THREE.Mesh(new THREE.BoxGeometry(0.08, hR.y - 0.41, 0.015), builder.getMaterial('#cbd5e1'));
            handlePole.position.set(suitcase.position.x, (0.41 + hR.y) / 2, suitcase.position.z);
            const handleGrip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.02), builder.getMaterial('#18181b'));
            handleGrip.position.set(suitcase.position.x, hR.y, suitcase.position.z);
            group.add(suitcase, w1, w2, w3, w4, handlePole, handleGrip);
            break;
        }
        case 'einkaufstueten': {
            const bag1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.08), builder.getMaterial('#f8fafc'));
            bag1.position.set(hR.x, hR.y - 0.12, hR.z);
            const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.01), builder.getMaterial('#ea580c'));
            h1.position.set(hR.x, hR.y - 0.01, hR.z);
            const bag2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.08), builder.getMaterial('#f8fafc'));
            bag2.position.set(hL.x, hL.y - 0.12, hL.z);
            const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.01), builder.getMaterial('#ea580c'));
            h2.position.set(hL.x, hL.y - 0.01, hL.z);
            group.add(bag1, h1, bag2, h2);
            break;
        }
        case 'frakta': {
            const fBag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.20, 0.14), builder.getMaterial('#1d4ed8'));
            fBag.position.set(hL.x, hL.y - 0.12, hL.z);
            const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.144), builder.getMaterial('#facc15'));
            strap1.position.set(hL.x - 0.06, hL.y - 0.05, hL.z);
            const strap2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.144), builder.getMaterial('#facc15'));
            strap2.position.set(hL.x + 0.06, hL.y - 0.05, hL.z);
            group.add(fBag, strap1, strap2);
            break;
        }
        case 'jutebeutel': {
            const tote = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.04), builder.getMaterial('#f5f5f4'));
            tote.position.set(hL.x, hL.y - 0.14, hL.z);
            const tHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.01), builder.getMaterial('#e7e5e4'));
            tHandle.position.set(hL.x, hL.y - 0.02, hL.z);
            const tPrint = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.003), builder.getMaterial('#15803d'));
            tPrint.position.set(hL.x, hL.y - 0.14, hL.z + 0.023);
            group.add(tote, tHandle, tPrint);
            break;
        }
        case 'wickeltasche': {
            const dBag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.09), builder.getMaterial('#64748b'));
            dBag.position.set(hR.x, hR.y - 0.11, hR.z);
            const dPocket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.015), builder.getMaterial('#94a3b8'));
            dPocket.position.set(hR.x, hR.y - 0.13, hR.z + 0.052);
            const dHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.015), builder.getMaterial('#334155'));
            dHandle.position.set(hR.x, hR.y - 0.01, hR.z);
            group.add(dBag, dPocket, dHandle);
            break;
        }
        case 'boutiquetuete': {
            const bBag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.07), builder.getMaterial('#09090b'));
            bBag.position.set(hR.x, hR.y - 0.11, hR.z);
            const bHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.01), builder.getMaterial('#f59e0b'));
            bHandle.position.set(hR.x, hR.y - 0.01, hR.z);
            const bRibbon = new THREE.Mesh(new THREE.BoxGeometry(0.144, 0.02, 0.074), builder.getMaterial('#f59e0b'));
            bRibbon.position.set(hR.x, hR.y - 0.10, hR.z);
            group.add(bBag, bHandle, bRibbon);
            break;
        }
        case 'einkaufsnetz': {
            const net = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.12), builder.getMaterial('#cbd5e1'));
            net.position.set(hR.x, hR.y - 0.12, hR.z);
            const apple = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), builder.getMaterial('#dc2626'));
            apple.position.set(hR.x - 0.03, hR.y - 0.10, hR.z);
            const orange = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), builder.getMaterial('#ea580c'));
            orange.position.set(hR.x + 0.03, hR.y - 0.11, hR.z);
            const netHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.01), builder.getMaterial('#94a3b8'));
            netHandle.position.set(hR.x, hR.y - 0.01, hR.z);
            group.add(net, apple, orange, netHandle);
            break;
        }
        case 'rucksack_gross': {
            const rBase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.15), builder.getMaterial('#047857'));
            rBase.position.set(0, 0.60, -0.13);
            const rFlap = new THREE.Mesh(new THREE.BoxGeometry(0.226, 0.10, 0.156), builder.getMaterial('#065f46'));
            rFlap.position.set(0, 0.74, -0.13);
            const matRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 8), builder.getMaterial('#0284c7'));
            matRoll.position.set(0, 0.81, -0.13);
            matRoll.rotation.z = Math.PI / 2;
            group.add(rBase, rFlap, matRoll);
            break;
        }

        // --- 5. MOBILITAET, ALLTAG, SPORT & FAN ---
        case 'wanderstock': {
            const tip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.015), builder.getMaterial('#71717a'));
            tip.position.set(hR.x + 0.05, 0.015, hR.z + 0.05);
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, hR.y - 0.03, 0.02), builder.getMaterial('#78350f'));
            shaft.position.set(hR.x + 0.05, (0.03 + hR.y) / 2, hR.z + 0.05);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.05), builder.getMaterial('#451a03'));
            handle.position.set(hR.x + 0.05, hR.y + 0.02, hR.z + 0.05);
            group.add(tip, shaft, handle);
            break;
        }
        case 'kruecke': {
            const tip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), builder.getMaterial('#18181b'));
            tip.position.set(hR.x + 0.05, 0.015, hR.z + 0.05);
            const pole = new THREE.Mesh(new THREE.BoxGeometry(0.02, hR.y - 0.03, 0.02), builder.getMaterial('#cbd5e1'));
            pole.position.set(hR.x + 0.05, (0.03 + hR.y) / 2, hR.z + 0.05);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.08), builder.getMaterial('#18181b'));
            grip.position.set(hR.x + 0.05, hR.y, hR.z + 0.05);
            const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.03), builder.getMaterial('#18181b'));
            cuff.position.set(hR.x + 0.05, hR.y + 0.14, hR.z + 0.05);
            group.add(tip, pole, grip, cuff);
            break;
        }
        case 'rollator': {
            const wMat = builder.getMaterial('#18181b');
            const fMat = builder.getMaterial('#dc2626');
            const gMat = builder.getMaterial('#374151');
            const wFL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8), wMat);
            wFL.position.set(-0.20, 0.035, 0.35); wFL.rotation.z = Math.PI / 2;
            const wFR = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8), wMat);
            wFR.position.set(0.20, 0.035, 0.35); wFR.rotation.z = Math.PI / 2;
            const wBL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8), wMat);
            wBL.position.set(-0.20, 0.035, 0.10); wBL.rotation.z = Math.PI / 2;
            const wBR = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8), wMat);
            wBR.position.set(0.20, 0.035, 0.10); wBR.rotation.z = Math.PI / 2;
            const legFL = new THREE.Mesh(new THREE.BoxGeometry(0.025, hL.y - 0.035, 0.025), fMat);
            legFL.position.set(-0.18, (0.035 + hL.y) / 2, 0.22);
            const legFR = new THREE.Mesh(new THREE.BoxGeometry(0.025, hR.y - 0.035, 0.025), fMat);
            legFR.position.set(0.18, (0.035 + hR.y) / 2, 0.22);
            const crossSeat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.18), gMat);
            crossSeat.position.set(0, 0.35, 0.22);
            const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.03, 0.03), gMat);
            hBar.position.set(0, hR.y, 0.22);
            group.add(wFL, wFR, wBL, wBR, legFL, legFR, crossSeat, hBar);
            break;
        }
        case 'kinderwagen': {
            const wMat = builder.getMaterial('#18181b');
            const fMat = builder.getMaterial('#94a3b8');
            const bMat = builder.getMaterial('#0284c7');
            const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 8), wMat);
            w1.position.set(-0.20, 0.04, 0.45); w1.rotation.z = Math.PI / 2;
            const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 8), wMat);
            w2.position.set(0.20, 0.04, 0.45); w2.rotation.z = Math.PI / 2;
            const w3 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 8), wMat);
            w3.position.set(-0.20, 0.04, 0.15); w3.rotation.z = Math.PI / 2;
            const w4 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 8), wMat);
            w4.position.set(0.20, 0.04, 0.15); w4.rotation.z = Math.PI / 2;
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.40), fMat);
            chassis.position.set(0, 0.12, 0.30);
            const tub = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, 0.45), bMat);
            tub.position.set(0, 0.32, 0.30);
            const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.15, 0.22), builder.getMaterial('#0369a1'));
            canopy.position.set(0, 0.48, 0.20);
            const barL = new THREE.Mesh(new THREE.BoxGeometry(0.02, hL.y - 0.12, 0.02), fMat);
            barL.position.set(-0.16, (0.12 + hL.y) / 2, (0.30 + hL.z) / 2);
            const barR = new THREE.Mesh(new THREE.BoxGeometry(0.02, hR.y - 0.12, 0.02), fMat);
            barR.position.set(0.16, (0.12 + hR.y) / 2, (0.30 + hR.z) / 2);
            const pushGrip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.03), builder.getMaterial('#18181b'));
            pushGrip.position.set(0, (hL.y + hR.y) / 2, (hL.z + hR.z) / 2);
            group.add(w1, w2, w3, w4, chassis, tub, canopy, barL, barR, pushGrip);
            break;
        }
        case 'hundeleine': {
            // Dog group - original beloved dog model with line leash
            const dogGroup = new THREE.Group();
            const dogMat = builder.getMaterial('#8b5a2b'); // brown dog
            const earMat = builder.getMaterial('#5c4033'); // dark brown ears
            const noseMat = builder.getMaterial('#111111'); // black nose
            
            // Body
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.36), dogMat);
            body.position.set(0, 0.16, 0);
            dogGroup.add(body);
            
            // Head
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), dogMat);
            head.position.set(0, 0.28, 0.16);
            dogGroup.add(head);
            
            // Nose
            const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), noseMat);
            nose.position.set(0, 0.28, 0.26);
            dogGroup.add(nose);

            // Ears
            const earL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), earMat);
            earL.position.set(-0.084, 0.30, 0.12);
            const earR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), earMat);
            earR.position.set(0.084, 0.30, 0.12);
            dogGroup.add(earL, earR);

            // Legs
            const legGeom = new THREE.BoxGeometry(0.05, 0.12, 0.05);
            const legFL = new THREE.Mesh(legGeom, dogMat);
            legFL.position.set(-0.07, 0.06, 0.12);
            const legFR = new THREE.Mesh(legGeom, dogMat);
            legFR.position.set(0.07, 0.06, 0.12);
            const legBL = new THREE.Mesh(legGeom, dogMat);
            legBL.position.set(-0.07, 0.06, -0.12);
            const legBR = new THREE.Mesh(legGeom, dogMat);
            legBR.position.set(0.07, 0.06, -0.12);
            dogGroup.add(legFL, legFR, legBL, legBR);
            
            // Tail
            const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), dogMat);
            tail.position.set(0, 0.26, -0.18);
            tail.rotation.x = -Math.PI / 4;
            dogGroup.add(tail);

            // Position dog on ground
            dogGroup.position.set(0.35, 0.0, 0.50);
            group.add(dogGroup);
            
            // Thin black line leash directly connecting hand and dog's neck
            const points = [
                new THREE.Vector3(hR.x, hR.y, hR.z),
                new THREE.Vector3(0.35, 0.28, 0.58)
            ];
            const leashGeom = new THREE.BufferGeometry().setFromPoints(points);
            const leash = new THREE.Line(leashGeom, new THREE.LineBasicMaterial({ color: 0x111111 }));
            group.add(leash);
            break;
        }
        case 'skateboard': {
            const deck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.014, 0.54), builder.getMaterial('#f59e0b'));
            deck.position.set(hR.x, hR.y - 0.08, hR.z);
            deck.rotation.set(0.3, 0.2, 0.4);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.003, 0.53), builder.getMaterial('#18181b'));
            grip.position.set(0, 0.009, 0);
            deck.add(grip);
            const tMat = builder.getMaterial('#cbd5e1');
            const truck1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.03), tMat);
            truck1.position.set(0, -0.017, -0.16);
            const truck2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.03), tMat);
            truck2.position.set(0, -0.017, 0.16);
            deck.add(truck1, truck2);
            const whMat = builder.getMaterial('#dc2626');
            const wh1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), whMat);
            wh1.position.set(-0.08, -0.025, -0.16); wh1.rotation.z = Math.PI / 2;
            const wh2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), whMat);
            wh2.position.set(0.08, -0.025, -0.16); wh2.rotation.z = Math.PI / 2;
            const wh3 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), whMat);
            wh3.position.set(-0.08, -0.025, 0.16); wh3.rotation.z = Math.PI / 2;
            const wh4 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), whMat);
            wh4.position.set(0.08, -0.025, 0.16); wh4.rotation.z = Math.PI / 2;
            deck.add(wh1, wh2, wh3, wh4);
            group.add(deck);
            break;
        }
        case 'gitarre': {
            const gBody = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.28, 0.07), builder.getMaterial('#b45309'));
            gBody.position.set(0, 0.62, -0.12);
            gBody.rotation.z = -0.35;
            const soundHole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.003, 8), builder.getMaterial('#18181b'));
            soundHole.position.set(0, 0.03, 0.037); soundHole.rotation.x = Math.PI / 2;
            const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.004), builder.getMaterial('#78350f'));
            bridge.position.set(0, -0.06, 0.037);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.03), builder.getMaterial('#d97706'));
            neck.position.set(0, 0.26, 0);
            const fretboard = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.004), builder.getMaterial('#18181b'));
            fretboard.position.set(0, 0.26, 0.017);
            const headstock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.03), builder.getMaterial('#b45309'));
            headstock.position.set(0, 0.42, 0);
            gBody.add(soundHole, bridge, neck, fretboard, headstock);
            group.add(gBody);
            break;
        }
        case 'angelrute': {
            const rGrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), builder.getMaterial('#d97706'));
            rGrip.position.set(hR.x, hR.y, hR.z);
            const rReel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), builder.getMaterial('#18181b'));
            rReel.position.set(hR.x + 0.03, hR.y - 0.04, hR.z);
            const rRod = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.20, 0.012), builder.getMaterial('#1e293b'));
            rRod.position.set(hR.x, hR.y + 0.60, hR.z);
            group.add(rGrip, rReel, rRod);
            break;
        }
        case 'regenschirm_zu': {
            const uGrip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.04), builder.getMaterial('#78350f'));
            uGrip.position.set(hR.x, hR.y, hR.z);
            const uBody = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.50, 0.035), builder.getMaterial('#18181b'));
            uBody.position.set(hR.x, hR.y - 0.20, hR.z);
            const uTip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), builder.getMaterial('#cbd5e1'));
            uTip.position.set(hR.x, hR.y - 0.46, hR.z);
            group.add(uGrip, uBody, uTip);
            break;
        }
        case 'regenschirm_auf': {
            const uShaft = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.60, 0.015), builder.getMaterial('#cbd5e1'));
            uShaft.position.set(hR.x, hR.y + 0.30, hR.z);
            const uCanopy = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.16, 8), builder.getMaterial('#1e40af'));
            uCanopy.position.set(hR.x, hR.y + 0.60, hR.z);
            group.add(uShaft, uCanopy);
            break;
        }
        case 'blumen_obst': {
            const basket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.10), builder.getMaterial('#854d0e'));
            basket.position.set(hR.x, hR.y - 0.05, hR.z);
            const fl1 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), builder.getMaterial('#ec4899'));
            fl1.position.set(hR.x - 0.03, hR.y, hR.z);
            const fl2 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), builder.getMaterial('#eab308'));
            fl2.position.set(hR.x + 0.03, hR.y, hR.z);
            const fl3 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), builder.getMaterial('#dc2626'));
            fl3.position.set(hR.x, hR.y + 0.01, hR.z + 0.02);
            group.add(basket, fl1, fl2, fl3);
            break;
        }
        case 'schluessel_etui': {
            const etui = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.02), builder.getMaterial('#78350f'));
            etui.position.set(hR.x, hR.y - 0.01, hR.z);
            const key = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.005), builder.getMaterial('#cbd5e1'));
            key.position.set(hR.x, hR.y - 0.055, hR.z);
            group.add(etui, key);
            break;
        }
        case 'geodreieck': {
            const gGroup = new THREE.Group();
            gGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            gGroup.rotation.x = -Math.PI / 4;

            const triangle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.003), builder.getMaterial('#e0f2fe'));
            const lines = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.008, 0.002), builder.getMaterial('#18181b'));
            lines.position.set(0, -0.025, 0.0025);

            gGroup.add(triangle, lines);
            group.add(gGroup);
            break;
        }
        case 'fahrkarte': {
            const tGroup = new THREE.Group();
            tGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            tGroup.rotation.x = -Math.PI / 4;

            const ticket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.003), builder.getMaterial('#ffffff'));
            const magStripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 0.002), builder.getMaterial('#18181b'));
            magStripe.position.set(0, -0.012, 0.0025);

            tGroup.add(ticket, magStripe);
            group.add(tGroup);
            break;
        }
        case 'konzertticket': {
            const ktGroup = new THREE.Group();
            ktGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            ktGroup.rotation.x = -Math.PI / 4;

            const kTicket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.003), builder.getMaterial('#18181b'));
            const holo = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.002), builder.getMaterial('#e2e8f0'));
            holo.position.set(0, 0.04, 0.0025);

            ktGroup.add(kTicket, holo);
            group.add(ktGroup);
            break;
        }
        case 'zwei_tickets': {
            const ztGroup = new THREE.Group();
            ztGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            ztGroup.rotation.x = -Math.PI / 4;

            const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.003), builder.getMaterial('#18181b'));
            const bStripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.002), builder.getMaterial('#a855f7'));
            bStripe.position.set(0, 0.04, 0.0025);
            const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.003), builder.getMaterial('#334155'));
            t2.position.set(0.02, -0.01, -0.004);

            ztGroup.add(t1, bStripe, t2);
            group.add(ztGroup);
            break;
        }
        case 'wartemarke': {
            const wmGroup = new THREE.Group();
            wmGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            wmGroup.rotation.x = -Math.PI / 4;

            const slip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.003), builder.getMaterial('#f8fafc'));
            const num = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.002), builder.getMaterial('#dc2626'));
            num.position.set(0, 0, 0.0025);

            wmGroup.add(slip, num);
            group.add(wmGroup);
            break;
        }
        case 'sticker': {
            const stGroup = new THREE.Group();
            stGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            stGroup.rotation.x = -Math.PI / 4;

            const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.003), builder.getMaterial('#ffffff'));
            const st1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.002), builder.getMaterial('#ef4444'));
            st1.position.set(-0.02, 0.03, 0.0025);
            const st2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.002), builder.getMaterial('#3b82f6'));
            st2.position.set(0.02, -0.03, 0.0025);

            stGroup.add(sheet, st1, st2);
            group.add(stGroup);
            break;
        }
        case 'brillenetui': {
            const caseObj = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.05), builder.getMaterial('#374151'));
            caseObj.position.set(hR.x, hR.y, hR.z);
            const rim = new THREE.Mesh(new THREE.BoxGeometry(0.124, 0.006, 0.054), builder.getMaterial('#cbd5e1'));
            rim.position.set(hR.x, hR.y, hR.z);
            group.add(caseObj, rim);
            break;
        }
        case 'taschenuhr': {
            const pWatch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.008), builder.getMaterial('#f59e0b'));
            pWatch.position.set(hR.x, hR.y, hR.z);
            const pDial = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.002), builder.getMaterial('#ffffff'));
            pDial.position.set(hR.x, hR.y, hR.z + 0.005);
            group.add(pWatch, pDial);
            break;
        }
        case 'armbanduhr': {
            const aBand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.025, 0.055), builder.getMaterial('#1c1917'));
            aBand.position.set(hL.x, hL.y, hL.z);
            const aCase = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.006), builder.getMaterial('#cbd5e1'));
            aCase.position.set(hL.x, hL.y, hL.z + 0.029);
            const aDial = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.002), builder.getMaterial('#ffffff'));
            aDial.position.set(hL.x, hL.y, hL.z + 0.033);
            group.add(aBand, aCase, aDial);
            break;
        }
        case 'pulsuhr': {
            const wBand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.025, 0.055), builder.getMaterial('#0f172a'));
            wBand.position.set(hL.x, hL.y, hL.z);
            const wCase = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.038, 0.006), builder.getMaterial('#0f172a'));
            wCase.position.set(hL.x, hL.y, hL.z + 0.029);
            const wScreen = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.032, 0.002), builder.getMaterial('#06b6d4'));
            wScreen.position.set(hL.x, hL.y, hL.z + 0.033);
            group.add(wBand, wCase, wScreen);
            break;
        }
        case 'autoschluessel': {
            const fob = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.065, 0.012), builder.getMaterial('#18181b'));
            fob.position.set(hR.x, hR.y, hR.z);
            const btn1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.002), builder.getMaterial('#cbd5e1'));
            btn1.position.set(hR.x, hR.y + 0.015, hR.z + 0.007);
            const btn2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.002), builder.getMaterial('#cbd5e1'));
            btn2.position.set(hR.x, hR.y - 0.015, hR.z + 0.007);
            group.add(fob, btn1, btn2);
            break;
        }
        case 'stethoskop': {
            const tube = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.03), builder.getMaterial('#18181b'));
            tube.position.set(0, 0.70, 0.06);
            const dia = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 8), builder.getMaterial('#cbd5e1'));
            dia.position.set(0.04, 0.63, 0.082);
            dia.rotation.x = Math.PI / 2;
            group.add(tube, dia);
            break;
        }
        case 'kleeblatt_pin': {
            const pin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), builder.getMaterial('#15803d'));
            pin.position.set(0.06, 0.70, 0.082);
            group.add(pin);
            break;
        }
        case 'besucherausweis': {
            const bLanyard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.02), builder.getMaterial('#1d4ed8'));
            bLanyard.position.set(0, 0.71, 0.06);
            const bBadge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.004), builder.getMaterial('#ffffff'));
            bBadge.position.set(0, 0.61, 0.082);
            const bHeader = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.002), builder.getMaterial('#1d4ed8'));
            bHeader.position.set(0, 0.64, 0.085);
            group.add(bLanyard, bBadge, bHeader);
            break;
        }
        case 'lanyard': {
            const lLanyard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.02), builder.getMaterial('#059669'));
            lLanyard.position.set(0, 0.71, 0.06);
            const lBadge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.004), builder.getMaterial('#ffffff'));
            lBadge.position.set(0, 0.61, 0.082);
            group.add(lLanyard, lBadge);
            break;
        }
        case 'kleeblatt_fahne': {
            const pole = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.60, 0.015), builder.getMaterial('#ffffff'));
            pole.position.set(hR.x, hR.y + 0.20, hR.z);
            const flag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.004), builder.getMaterial('#15803d'));
            flag.position.set(hR.x + 0.12, hR.y + 0.38, hR.z);
            const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.006), builder.getMaterial('#ffffff'));
            emblem.position.set(hR.x + 0.12, hR.y + 0.38, hR.z);
            group.add(pole, flag, emblem);
            break;
        }
        case 'nackenhoernchen': {
            const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.16), builder.getMaterial('#3b82f6'));
            pillow.position.set(0, 0.80, 0.02);
            group.add(pillow);
            break;
        }
        
        case 'stahlhelm': {
            const dome = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.20), builder.getMaterial('#475569'));
            dome.position.set(hR.x, hR.y - 0.04, hR.z);
            const rim = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.02, 0.22), builder.getMaterial('#334155'));
            rim.position.set(hR.x, hR.y - 0.10, hR.z);
            group.add(dome, rim);
            break;
        }
        case 'giesskanne': {
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.14), builder.getMaterial('#16a34a'));
            body.position.set(hR.x, hR.y - 0.06, hR.z);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, 0.16), builder.getMaterial('#15803d'));
            handle.position.set(hR.x, hR.y + 0.04, hR.z);
            const spout = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.18), builder.getMaterial('#15803d'));
            spout.position.set(hR.x, hR.y - 0.02, hR.z + 0.14);
            spout.rotation.x = Math.PI / 6;
            const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.015, 8), builder.getMaterial('#cbd5e1'));
            rose.position.set(hR.x, hR.y + 0.03, hR.z + 0.22);
            rose.rotation.x = Math.PI / 3;
            group.add(body, handle, spout, rose);
            break;
        }
        case 'schluesselbund': {
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.005, 8), builder.getMaterial('#cbd5e1'));
            ring.position.set(hR.x, hR.y, hR.z);
            ring.rotation.x = Math.PI / 2;
            const k1 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.004), builder.getMaterial('#94a3b8'));
            k1.position.set(hR.x - 0.01, hR.y - 0.025, hR.z);
            const k2 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.004), builder.getMaterial('#f59e0b'));
            k2.position.set(hR.x + 0.01, hR.y - 0.028, hR.z);
            group.add(ring, k1, k2);
            break;
        }
        case 'tennisball': {
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), builder.getMaterial('#bef264'));
            ball.position.set(hR.x, hR.y, hR.z);
            const seam = new THREE.Mesh(new THREE.BoxGeometry(0.063, 0.004, 0.063), builder.getMaterial('#ffffff'));
            seam.position.set(hR.x, hR.y, hR.z);
            seam.rotation.set(0.7, 0.5, 0.3);
            group.add(ball, seam);
            break;
        }
        case 'fahrradhelm': {
            const fHelm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.24), builder.getMaterial('#ef4444'));
            fHelm.position.set(hR.x, hR.y - 0.05, hR.z);
            const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.08), builder.getMaterial('#18181b'));
            visor.position.set(hR.x, hR.y - 0.09, hR.z + 0.12);
            group.add(fHelm, visor);
            break;
        }
        case 'regenschirm':
        case 'regenschirm_holz': {
            const uGrip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.04), builder.getMaterial('#78350f'));
            uGrip.position.set(hR.x, hR.y, hR.z);
            const uBody = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.50, 0.035), builder.getMaterial('#18181b'));
            uBody.position.set(hR.x, hR.y - 0.20, hR.z);
            const uTip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), builder.getMaterial('#cbd5e1'));
            uTip.position.set(hR.x, hR.y - 0.46, hR.z);
            group.add(uGrip, uBody, uTip);
            break;
        }
        case 'schere': {
            const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.004), builder.getMaterial('#cbd5e1'));
            b1.position.set(hR.x, hR.y + 0.02, hR.z);
            b1.rotation.z = 0.25;
            const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.004), builder.getMaterial('#cbd5e1'));
            b2.position.set(hR.x, hR.y + 0.02, hR.z);
            b2.rotation.z = -0.25;
            const loopL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), builder.getMaterial('#18181b'));
            loopL.position.set(hR.x - 0.02, hR.y - 0.04, hR.z);
            const loopR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), builder.getMaterial('#18181b'));
            loopR.position.set(hR.x + 0.02, hR.y - 0.04, hR.z);
            group.add(b1, b2, loopL, loopR);
            break;
        }
        case 'vogelfutter': {
            const bag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.06), builder.getMaterial('#78350f'));
            bag.position.set(hR.x, hR.y - 0.02, hR.z);
            const seed = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.04), builder.getMaterial('#facc15'));
            seed.position.set(hR.x, hR.y + 0.045, hR.z);
            group.add(bag, seed);
            break;
        }
        case 'jonglierbaelle': {
            const bMat1 = builder.getMaterial('#ef4444');
            const bMat2 = builder.getMaterial('#eab308');
            const bMat3 = builder.getMaterial('#3b82f6');
            const jb1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), bMat1);
            jb1.position.set(hR.x, hR.y + 0.02, hR.z);
            const jb2 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), bMat2);
            jb2.position.set(hL.x, hL.y + 0.02, hL.z);
            const jb3 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), bMat3);
            jb3.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.14, (hR.z + hL.z) / 2);
            group.add(jb1, jb2, jb3);
            break;
        }
        case 'retrohandtasche': {
            const rBag = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.06), builder.getMaterial('#831843'));
            rBag.position.set(hR.x, hR.y - 0.09, hR.z);
            const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.015), builder.getMaterial('#f59e0b'));
            clasp.position.set(hR.x, hR.y - 0.015, hR.z);
            const rHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.01), builder.getMaterial('#f59e0b'));
            rHandle.position.set(hR.x, hR.y, hR.z);
            group.add(rBag, clasp, rHandle);
            break;
        }
        case 'palette': {
            const pal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.006), builder.getMaterial('#d97706'));
            pal.position.set(hL.x, hL.y + 0.02, hL.z + 0.03);
            pal.rotation.x = -Math.PI / 4;
            const cRed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), builder.getMaterial('#ef4444'));
            cRed.position.set(hL.x - 0.04, hL.y + 0.04, hL.z + 0.04);
            const cBlue = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), builder.getMaterial('#3b82f6'));
            cBlue.position.set(hL.x + 0.04, hL.y + 0.04, hL.z + 0.04);
            const cYellow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), builder.getMaterial('#eab308'));
            cYellow.position.set(hL.x, hL.y + 0.06, hL.z + 0.04);
            group.add(pal, cRed, cBlue, cYellow);
            break;
        }
        case 'motorradhandschuhe': {
            const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.04), builder.getMaterial('#18181b'));
            g1.position.set(hR.x, hR.y - 0.04, hR.z);
            const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.04), builder.getMaterial('#18181b'));
            g2.position.set(hR.x + 0.04, hR.y - 0.05, hR.z);
            group.add(g1, g2);
            break;
        }
        case 'zollstock': {
            const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.015), builder.getMaterial('#facc15'));
            ruler.position.set(hR.x, hR.y + 0.05, hR.z);
            const metalEnds = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.015, 0.017), builder.getMaterial('#94a3b8'));
            metalEnds.position.set(hR.x, hR.y + 0.165, hR.z);
            group.add(ruler, metalEnds);
            break;
        }
        case 'einweggrill': {
            const tray = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.18), builder.getMaterial('#cbd5e1'));
            tray.position.set((hR.x + hL.x) / 2, Math.max(hR.y, hL.y) + 0.02, (hR.z + hL.z) / 2 + 0.05);
            const grid = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.005, 0.17), builder.getMaterial('#475569'));
            grid.position.set(tray.position.x, tray.position.y + 0.028, tray.position.z);
            group.add(tray, grid);
            break;
        }
        case 'schraubenschluessel': {
            const wrench = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.008), builder.getMaterial('#94a3b8'));
            wrench.position.set(hR.x, hR.y + 0.02, hR.z);
            const headW = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.01), builder.getMaterial('#94a3b8'));
            headW.position.set(hR.x, hR.y + 0.10, hR.z);
            group.add(wrench, headW);
            break;
        }
        case 'fernglas': {
            const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.12, 8), builder.getMaterial('#18181b'));
            b1.position.set(hR.x - 0.03, hR.y, hR.z);
            b1.rotation.x = Math.PI / 2;
            const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.12, 8), builder.getMaterial('#18181b'));
            b2.position.set(hR.x + 0.03, hR.y, hR.z);
            b2.rotation.x = Math.PI / 2;
            const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.03), builder.getMaterial('#334155'));
            bridge.position.set(hR.x, hR.y, hR.z);
            group.add(b1, b2, bridge);
            break;
        }
        case 'zwei_anhaenger': {
            const ringZ = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 8), builder.getMaterial('#cbd5e1'));
            ringZ.position.set(hR.x, hR.y, hR.z);
            ringZ.rotation.x = Math.PI / 2;
            const tagRed = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.004), builder.getMaterial('#dc2626'));
            tagRed.position.set(hR.x - 0.015, hR.y - 0.035, hR.z);
            const tagGreen = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.004), builder.getMaterial('#16a34a'));
            tagGreen.position.set(hR.x + 0.015, hR.y - 0.035, hR.z);
            group.add(ringZ, tagRed, tagGreen);
            break;
        }
        case 'tuerknauf': {
            const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), builder.getMaterial('#f59e0b'));
            knob.position.set(hR.x, hR.y, hR.z);
            const spindle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), builder.getMaterial('#94a3b8'));
            spindle.position.set(hR.x, hR.y - 0.035, hR.z);
            group.add(knob, spindle);
            break;
        }
        case 'baecker_tuete': {
            const bag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.08), builder.getMaterial('#d2b48c'));
            bag.position.set(hR.x, hR.y - 0.04, hR.z);
            const topFold = new THREE.Mesh(new THREE.BoxGeometry(0.124, 0.03, 0.04), builder.getMaterial('#b8976c'));
            topFold.position.set(hR.x, hR.y + 0.06, hR.z);
            group.add(bag, topFold);
            break;
        }
        case 'navigesp': {
            const navGroup = new THREE.Group();
            navGroup.position.set(hR.x, hR.y + 0.02, hR.z + 0.03);
            navGroup.rotation.x = -Math.PI / 4;

            const nCase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.016), builder.getMaterial('#18181b'));
            const nScreen = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.065, 0.003), builder.getMaterial('#06b6d4'));
            nScreen.position.set(0, 0, 0.009);

            navGroup.add(nCase, nScreen);
            group.add(navGroup);
            break;
        }
        case 'rosenstrauss': {
            const wrap = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 6), builder.getMaterial('#d2b48c'));
            wrap.position.set(hR.x, hR.y + 0.04, hR.z);
            wrap.rotation.x = Math.PI;
            const rMat = builder.getMaterial('#dc2626');
            const r1 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), rMat);
            r1.position.set(hR.x - 0.025, hR.y + 0.17, hR.z);
            const r2 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), rMat);
            r2.position.set(hR.x + 0.025, hR.y + 0.17, hR.z);
            const r3 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), rMat);
            r3.position.set(hR.x, hR.y + 0.19, hR.z + 0.02);
            group.add(wrap, r1, r2, r3);
            break;
        }

default: {
            // Unbekannter Gegenstand: unauffaellige Handtasche/Etui
            const fallback = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), builder.getMaterial('#374151'));
            fallback.position.set(hR.x, hR.y - 0.05, hR.z);
            group.add(fallback);
            break;
        }
    }
}
