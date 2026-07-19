// ============================================================================
// RathausBuilder.js — Sonderarchitektur der Station Rathaus (Fürth):
// Wandmosaik/Mural und Querröhren. Überschreibt die StationBuilder-Hooks;
// Dispatch per Stationsname in StationModel.buildStation.
// ============================================================================
import * as THREE from 'three';
import { StationBuilder } from './StationBuilder.js?v=69';
import { tagCanvasTextureSRGBKeepLook } from '../TextureUtils.js';

export class RathausBuilder extends StationBuilder {
    setupMaterials() {
        // Wandbild (Kunstwerk): blaue Häuserzeilen und Straßen in korrekter
        // Ein-Punkt-Perspektive, zum Horizont hin kleiner werdend. 5% der
        // Häuser rot, 5% gelb. Hintergrund bleibt transparent, damit die
        // Röhrentextur als "Himmel" durchscheint.
        const muralCanvas = document.createElement('canvas');
        muralCanvas.width = 1024;
        muralCanvas.height = 1024;
        const ctx = muralCanvas.getContext('2d');
        ctx.clearRect(0, 0, 1024, 1024);

        // Deterministic helper for mural generation
        let seed = 42;
        const rand = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };

        // Leichte Luftaufnahme (Schrägluftbild) wie beim echten Fürther
        // Wandbild: Kamera in eyeY Metern Höhe, um "pitch" nach unten geneigt,
        // Blick über ein gedrehtes Straßennetz aus Blockrandbebauung. fx ist
        // gegenüber fy gestaucht, weil der quadratische Canvas auf eine
        // 15 m x ~8.1 m große Wandkachel gemappt wird (Anisotropie-Ausgleich).
        const fy = 520, fx = 281, eyeY = 150, cy = 500;
        const pitch = 38 * Math.PI / 180;
        const cosA = Math.cos(pitch), sinA = Math.sin(pitch);
        const P = (x, y, z) => {
            const dy = eyeY - y;
            const zc = z * cosA + dy * sinA;
            return [512 + x * fx / zc, cy + (dy * cosA - z * sinA) * fy / zc];
        };
        const depth = (x, y, z) => z * cosA + (eyeY - y) * sinA;
        const poly = (pts, fill, alpha = 1) => {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = fill;
            ctx.beginPath();
            pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        };
        // Dachring mit Innenhof-Loch (evenodd)
        const ringPoly = (outer, inner, fill, alpha = 1) => {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = fill;
            ctx.beginPath();
            outer.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
            ctx.closePath();
            inner.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
            ctx.closePath();
            ctx.fill('evenodd');
            ctx.globalAlpha = 1;
        };

        // Papierhintergrund des Drucks; oberhalb des Horizonts (~y=94) bleibt
        // der Canvas transparent, dort scheint die Röhrentextur durch
        ctx.fillStyle = 'rgba(240,242,237,0.95)';
        ctx.fillRect(0, 88, 1024, 1024 - 88);

        // Gebäudefarben: 90% Blautöne, 5% rot, 5% gelb
        const pickColor = () => {
            const c = rand();
            if (c < 0.05) return { h: 2, s: 62, l: 46 };
            if (c < 0.10) return { h: 46, s: 78, l: 55 };
            return { h: 213 + rand() * 22, s: 50 + rand() * 25, l: 38 + rand() * 22 };
        };
        const hsl = (c, lMul = 1) => `hsl(${Math.round(c.h)}, ${Math.round(c.s)}%, ${Math.round(Math.min(92, c.l * lMul))}%)`;

        // Straßennetz: um beta gedrehtes Blockraster (Block 46 m, Straße 9 m),
        // jede 5. Straße etwas breiter (Hauptachsen). Die Drehung lässt die
        // Straßenzüge diagonal durchs Bild laufen wie auf dem Vorbild.
        const beta = 24 * Math.PI / 180, cosB = Math.cos(beta), sinB = Math.sin(beta);
        const W = (u, v) => [u * cosB - v * sinB, u * sinB + v * cosB + 60];
        const blockPitch = 46, halfStreet = 4.5;

        const blocks = [];
        for (let iu = -60; iu <= 60; iu++) {
            for (let iv = -14; iv <= 60; iv++) {
                const avU = ((iu % 5) + 5) % 5 === 0 ? 3.5 : 0;
                const avV = ((iv % 5) + 5) % 5 === 0 ? 3.5 : 0;
                const u0 = iu * blockPitch + halfStreet + avU;
                const v0 = iv * blockPitch + halfStreet + avV;
                const u1 = (iu + 1) * blockPitch - halfStreet;
                const v1 = (iv + 1) * blockPitch - halfStreet;
                const [bx, bz] = W((u0 + u1) / 2, (v0 + v1) / 2);
                if (bz < 20 || bz > 2400) continue;
                const [scx, scy] = P(bx, 0, bz);
                if (scx < -60 || scx > 1084 || scy < 80) continue;
                blocks.push({ u0, v0, u1, v1, z: bz, d: depth(bx, 0, bz) });
            }
        }
        // Maler-Reihenfolge: strikt von hinten nach vorne
        blocks.sort((a, b) => b.d - a.d);

        // Projiziert einen Quader-Grundriss; null, wenn er die Kachelnaht
        // schneiden würde (die Kachel wiederholt sich alle 15 m)
        const project = (u0, v0, u1, v1, h) => {
            const corners = [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)];
            const roof = corners.map(([x, z]) => P(x, h, z));
            const base = corners.map(([x, z]) => P(x, 0, z));
            let minX = Infinity, maxX = -Infinity;
            for (const p of roof) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); }
            for (const p of base) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); }
            if (minX < 4 || maxX > 1020) return null;
            return { corners, roof, base };
        };
        const drawSides = (pr, c, fade) => {
            // Seitenflächen von hinten nach vorne, dann deckt das Dach den Rest
            const faces = [0, 1, 2, 3].map(i => {
                const j = (i + 1) % 4;
                return {
                    d: (depth(pr.corners[i][0], 0, pr.corners[i][1]) + depth(pr.corners[j][0], 0, pr.corners[j][1])) / 2,
                    pts: [pr.base[i], pr.base[j], pr.roof[j], pr.roof[i]]
                };
            });
            faces.sort((a, b) => b.d - a.d);
            for (const f of faces) poly(f.pts, hsl(c, 0.6), fade);
        };
        const roofLines = (pr, c, fade) => {
            // feine Firstlinien als "Radierungs"-Textur auf nahen Dächern
            ctx.globalAlpha = fade * 0.3;
            ctx.strokeStyle = hsl(c, 0.45);
            ctx.lineWidth = 1;
            for (const f of [0.35, 0.65]) {
                const a = [pr.roof[0][0] + (pr.roof[3][0] - pr.roof[0][0]) * f, pr.roof[0][1] + (pr.roof[3][1] - pr.roof[0][1]) * f];
                const b = [pr.roof[1][0] + (pr.roof[2][0] - pr.roof[1][0]) * f, pr.roof[1][1] + (pr.roof[2][1] - pr.roof[1][1]) * f];
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        };

        for (const B of blocks) {
            const fade = Math.max(0.4, Math.min(1, 1 - (B.z - 500) / 2600));
            if (B.z > 600) {
                // Fernbereich: nur Dachflächen, stark vereinfacht
                const c = pickColor();
                const pr = project(B.u0, B.v0, B.u1, B.v1, 10 + rand() * 10);
                if (pr) poly(pr.roof, hsl(c), fade * 0.85);
                continue;
            }
            if (rand() < 0.55) {
                // Blockrandbebauung mit Innenhof
                const c = pickColor();
                const h = 11 + rand() * 7;
                const t = 9 + rand() * 3;
                const pr = project(B.u0, B.v0, B.u1, B.v1, h);
                if (!pr) continue;
                drawSides(pr, c, fade);
                const inner = [W(B.u0 + t, B.v0 + t), W(B.u1 - t, B.v0 + t), W(B.u1 - t, B.v1 - t), W(B.u0 + t, B.v1 - t)]
                    .map(([x, z]) => P(x, h, z));
                ringPoly(pr.roof, inner, hsl(c), fade);
                if (B.z < 400) roofLines(pr, c, fade);
            } else {
                // 2-3 Einzelgebäude im Block
                const n = 2 + (rand() < 0.4 ? 1 : 0);
                const vertical = rand() < 0.5;
                const gap = 3;
                for (let k = 0; k < n; k++) {
                    const c = pickColor();
                    const h = 10 + rand() * 12;
                    const f0 = k / n, f1 = (k + 1) / n;
                    const su0 = vertical ? B.u0 + (B.u1 - B.u0) * f0 + (k ? gap / 2 : 0) : B.u0;
                    const su1 = vertical ? B.u0 + (B.u1 - B.u0) * f1 - (k < n - 1 ? gap / 2 : 0) : B.u1;
                    const sv0 = vertical ? B.v0 : B.v0 + (B.v1 - B.v0) * f0 + (k ? gap / 2 : 0);
                    const sv1 = vertical ? B.v1 : B.v0 + (B.v1 - B.v0) * f1 - (k < n - 1 ? gap / 2 : 0);
                    const pr = project(su0, sv0, su1, sv1, h);
                    if (!pr) continue;
                    drawSides(pr, c, fade);
                    poly(pr.roof, hsl(c), fade);
                    if (B.z < 400) roofLines(pr, c, fade);
                }
            }
        }

        // Dunst zum Horizont: die Stadt läuft weich in den Papierton aus
        const haze = ctx.createLinearGradient(0, 86, 0, 230);
        haze.addColorStop(0, 'rgba(240,242,237,0.95)');
        haze.addColorStop(1, 'rgba(240,242,237,0)');
        ctx.fillStyle = haze;
        ctx.fillRect(0, 86, 1024, 144);

        const muralTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(muralCanvas));
        muralTex.wrapS = THREE.RepeatWrapping;
        muralTex.wrapT = THREE.RepeatWrapping;
        muralTex.repeat.set(1, 1);

        this.muralMat = new THREE.MeshLambertMaterial({
            map: muralTex,
            transparent: true,
            opacity: 1.0, // base opacity is full
            alphaTest: 0.01, // discard fully transparent pixels
            color: 0xffffff,
            side: THREE.DoubleSide
        });

        // Map covering full profile: V=0 is bottom (ground), V=1 is top (sky)
        const tubeRadius = (this.spacing / 4 + 1.2);
        const profileLength = (Math.PI / 2) * tubeRadius;
        muralTex.repeat.set(1, 1 / profileLength);
        this.muralMat.userData.keepWrapAndRepeat = true;

        // Röhrentextur: Grundton #B4BFBF, alle 4 m ein durchgehender vertikaler
        // (d.h. quer zur Fahrtrichtung um die Röhre umlaufender) hellgrauer
        // Streifen. U = Meter/4 (tileU=4 beim Sweep), V ist einfarbig.
        const tubeCanvas = document.createElement('canvas');
        tubeCanvas.width = 512;
        tubeCanvas.height = 4;
        const tctx = tubeCanvas.getContext('2d');
        tctx.fillStyle = '#B4BFBF';
        tctx.fillRect(0, 0, 512, 4);
        tctx.fillStyle = '#555555'; // dunkelgrauer Streifen, 0.25 m breit
        tctx.fillRect(240, 0, 32, 4);
        tctx.fillStyle = 'rgba(85,85,85,0.5)'; // weiche Kanten
        tctx.fillRect(238, 0, 2, 4);
        tctx.fillRect(272, 0, 2, 4);
        this.tubeTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(tubeCanvas));
        this.tubeTex.wrapS = this.tubeTex.wrapT = THREE.RepeatWrapping;

        // Gewölbematerial trägt die Röhrentextur; der Custom-Shader unten
        // schneidet weiterhin die 3 Durchgänge und die Portale aus.
        this.vaultMat = new THREE.MeshLambertMaterial({ map: this.tubeTex, side: THREE.DoubleSide });

        const pos_end = this.sim.getTrackPosition(this.station.position + this.platLength / 2);
        const dummy = new THREE.Object3D();
        dummy.position.copy(this.centerPos);
        dummy.rotation.y = this.centerAngle;
        dummy.updateMatrixWorld();
        const localPos_end = dummy.worldToLocal(pos_end.clone());
        this.curvatureA = localPos_end.x / (localPos_end.z * localPos_end.z);
        
        this.vaultMat.onBeforeCompile = (shader) => {
            shader.uniforms.uCenterPos = { value: this.centerPos };
            shader.uniforms.uCenterAngle = { value: this.centerAngle };
            shader.uniforms.uCurvatureA = { value: this.curvatureA };
            
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

                // Adjust localX for track curvature!
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

                    if (localZ < -${(this.platLength / 2 - 4.0).toFixed(3)} || localZ > ${(this.platLength / 2 - 4.0).toFixed(3)}) {
                        if (abs(localX) < 2.5) {
                            discard;
                        }
                    }
                }
                `
            );
        };

        this.vaultMat.customProgramCacheKey = () => {
            return this.station.name + '_vaultMat';
        };

    }

    buildSegmentGroundAndCeiling(segmentData) {
        const { j } = segmentData;
        if (j !== 0) return;

        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;
        const spacing = this.spacing;
        const groundWidth = spacing + 2.8;
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL;

        const groundMat = this.materials.ballast.clone();
        groundMat.map = this.materials.ballast.map.clone();
        groundMat.map.wrapS = groundMat.map.wrapT = THREE.RepeatWrapping;
        groundMat.map.repeat.set(groundWidth / 1.2, 1);
        this.model.buildSweptBar(this.group, sA, sB, () => groundWidth / 2,
            this.centerPos.y - 0.47, this.centerPos.y - 0.57, [groundMat, groundMat], 1.2);

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
        // tileU = 4: eine Texturkachel = 4 m -> Streifenraster der Röhrentextur
        this.model.buildSweptProfile(this.group, sA, sB, mkVaultArc(-phiExt, Math.PI), this.centerPos.y + 0.865, () => tubeCenterL, this.vaultMat, 4);
        this.model.buildSweptProfile(this.group, sA, sB, mkVaultArc(0, Math.PI + phiExt), this.centerPos.y + 0.865, () => tubeCenterR, this.vaultMat, 4);

        this.model.buildBarrelLights(this.group, {
            startS: sA + 3.0,
            endS: sB - 3.0,
            axisY: 3.775,
            centerPosY: this.centerPos.y,
            centerAngle: this.centerAngle,
            offFn: () => tubeCenterL,
            ceilY: 0.865 + tubeRadius,
            label: this.station.name,
        });
    }

    buildSegmentPlatform(segmentData) {
        const { j } = segmentData;
        if (j !== 0) return;
        const platWidth = this.spacing - 3.08;
        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;
        const platMat = this.model.getPlatformMaterials(this.station, platWidth, true, true);
        this.model.buildSweptBar(this.group, sA, sB, () => platWidth / 2,
            this.centerPos.y + this.platTopY, this.centerPos.y + this.platTopY - this.platHeight,
            [platMat[0], platMat[2]], 1.2);
    }

    buildSegmentOuterWalls(segmentData) {
        const { j } = segmentData;
        if (j !== 0) return;

        const spacing = this.spacing;
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL;
        const muralRadius = tubeRadius - 0.05;
        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;

        const steps = 16;
        const muralProfileLeft = [], muralProfileRight = [];
        for (let k = 0; k <= steps; k++) {
            const phiL = (Math.PI / 2) * k / steps;
            muralProfileLeft.push({ x: muralRadius * Math.cos(phiL), y: muralRadius * Math.sin(phiL) });
            // Corrected: Right side also from ground (phi=PI) up to ceiling (phi=PI/2)
            const phiR = Math.PI - (Math.PI / 2) * k / steps;
            muralProfileRight.push({ x: muralRadius * Math.cos(phiR), y: muralRadius * Math.sin(phiR) });
        }

        // buildSweptProfile maps point order to V.
        // Use keepWrapAndRepeat to ensure the vertical repeat (1/profileLength) is preserved.
        // Both now start at floor and end at ceiling -> Houses point UP.
        this.model.buildSweptProfile(this.group, sA, sB, muralProfileLeft, this.centerPos.y + 0.865, () => tubeCenterL, this.muralMat, 15.0);
        this.model.buildSweptProfile(this.group, sA, sB, muralProfileRight, this.centerPos.y + 0.865, () => tubeCenterR, this.muralMat, 15.0);

        const stripeRadius = muralRadius - 0.02;
        const dyBottom = 2.1 - 0.865;
        const dyTop = 2.5 - 0.865;
        const thetaStart = Math.acos(-dyBottom / stripeRadius);
        const thetaEnd = Math.acos(-dyTop / stripeRadius);
        // Bogenhöhe des Bands in Metern — bestimmt das V-Repeat der Textur
        const bandArc = Math.abs(thetaEnd - thetaStart) * stripeRadius;

        if (!this.stripeMat) {
            // Stationsband: Grund #AFB4B7, Schriftzug "Rathaus" (keine
            // Versalien) in #29392F, Zwischenlinien in #6B6E67. Bewusst NICHT
            // createWallStripeMaterial: das schreibt in Großbuchstaben und
            // sein repeat wird beim Sweep-Klonen verworfen.
            const bandCanvas = document.createElement('canvas');
            bandCanvas.width = 384;
            bandCanvas.height = 64;
            const bctx = bandCanvas.getContext('2d');
            bctx.fillStyle = '#AFB4B7';
            bctx.fillRect(0, 0, 384, 64);

            bctx.font = 'bold 33px "Jost Regular", "Geist", "Inter", "Segoe UI", sans-serif';
            const condense = 0.72; // leicht schmal laufende Schrift wie überall
            const textW = bctx.measureText('Rathaus').width * condense;

            // Zwischenlinien entfernt auf Userwunsch
            // bctx.fillStyle = '#6B6E67';
            // bctx.fillRect(0, 30, 192 - textW / 2 - 14, 4);
            // bctx.fillRect(192 + textW / 2 + 14, 30, 384 - (192 + textW / 2 + 14), 4);

            bctx.fillStyle = '#29392F';
            bctx.textAlign = 'center';
            bctx.textBaseline = 'middle';
            bctx.save();
            bctx.translate(192, 32);
            bctx.scale(condense, 1);
            bctx.fillText('Rathaus', 0, 0);
            bctx.restore();

            // U: eine Kachel pro 2.1 m (tileU beim Sweep). V läuft in der
            // Sweep-Geometrie über die Bogenhöhe in METERN, deshalb 1/bandArc —
            // ohne das wird nur der untere Canvas-Streifen gesampelt (alter
            // Anzeige-Bug). keepWrapAndRepeat schützt das Repeat vorm Klonen.
            // Auf der -x-Wand steht der Betrachter andersherum zur U-Richtung:
            // negatives repeat.x spiegelt die Textur zurück, damit die Schrift
            // dort nicht seitenverkehrt erscheint (vgl. buildSweptWall-Fix).
            const mkBandMat = (mirror) => {
                const tex = new THREE.CanvasTexture(bandCanvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = 8;
                tex.wrapS = THREE.RepeatWrapping;
                tex.repeat.set(mirror ? -1 : 1, 1 / bandArc);
                const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
                mat.userData.keepWrapAndRepeat = true;
                return mat;
            };
            this.stripeMat = mkBandMat(false);
            this.stripeMatMirror = mkBandMat(true);
        }

        const stripeProfileLeft = [];
        for (let k = 0; k <= steps; k++) {
            const theta = thetaStart + (thetaEnd - thetaStart) * k / steps;
            stripeProfileLeft.push({ x: stripeRadius * Math.sin(theta), y: -stripeRadius * Math.cos(theta) });
        }
        const stripeProfileRight = stripeProfileLeft.map(p => ({ x: -p.x, y: p.y }));
        this.model.buildSweptProfile(this.group, sA, sB, stripeProfileLeft, this.centerPos.y + 0.865, () => tubeCenterL, this.stripeMatMirror, 2.1);
        this.model.buildSweptProfile(this.group, sA, sB, stripeProfileRight, this.centerPos.y + 0.865, () => tubeCenterR, this.stripeMat, 2.1);
    }

    buildPillars() {
        this.buildCrossTubes();
    }

    buildCrossTubes() {
        const archLength = 8.0;
        const tubeRadius = this.spacing / 4 + 1.2;
        const r = 4.5;

        // Ein gemeinsames Material für alle drei Querröhren: dunkelgrauer
        // Grundton (wie Lorenzkirche); der Shader schneidet die
        // Überschneidung mit den Hauptröhren weg.
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
                float tR = ${tubeRadius.toFixed(5)};
                float dy = vLocalPosForClip.y - 0.865;
                float distL = (vLocalPosForClip.x - tR) * (vLocalPosForClip.x - tR) + dy * dy;
                float distR = (vLocalPosForClip.x + tR) * (vLocalPosForClip.x + tR) + dy * dy;
                if (distL < tR * tR || distR < tR * tR) {
                    discard;
                }
                `
            );
        };
        passageMat.customProgramCacheKey = () => this.station.name + '_crossTubeMat';

        const buildTube = (zPos) => {
            const s_mid = this.station.position + zPos;
            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());
            const crossGeom = this.getCutCrossTubeGeom(archLength, r);

            const crossTube = new THREE.Mesh(crossGeom, passageMat);
            crossTube.position.copy(localPos);
            crossTube.rotation.y = rotY;
            this.group.add(crossTube);
        };

        buildTube(-25);
        buildTube(0);
        buildTube(25);
    }

    getCutCrossTubeGeom(archLength, r) {
        if (!this.cutCrossTubeGeom) {
            const geom = new THREE.CylinderGeometry(r, r, archLength, 128, 1, true, 0, Math.PI);
            const matrix = new THREE.Matrix4();
            matrix.set(
                0, 1, 0, 0,
                1, 0, 0, 0.865,
                0, 0, -1, 0,
                0, 0, 0, 1
            );
            geom.applyMatrix4(matrix);
            this.cutCrossTubeGeom = geom;
        }
        return this.cutCrossTubeGeom;
    }
}
