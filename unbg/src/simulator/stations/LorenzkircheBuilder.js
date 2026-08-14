// ============================================================================
// LorenzkircheBuilder.js — Sonderarchitektur der Station Lorenzkirche
// (Gewölbe-Röhre mit Rosetten und Querröhren). Überschreibt die
// StationBuilder-Hooks; Dispatch per Stationsname in StationModel.buildStation.
// ============================================================================
import * as THREE from 'three';
import { StationBuilder } from './StationBuilder.js?v=69';
import { tagCanvasTextureSRGBKeepLook } from '../TextureUtils.js';

export class LorenzkircheBuilder extends StationBuilder {
    setupMaterials() {
        // Concrete material for the vault: Enhanced for a more "plastic" / 3D look
        const concCanvas = document.createElement('canvas');
        concCanvas.width = 512;
        concCanvas.height = 512;
        const ctx = concCanvas.getContext('2d');
        ctx.fillStyle = '#8c867b'; // Warm concrete base
        ctx.fillRect(0, 0, 512, 512);

        // Larger procedural patches for surface variation
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const r = 40 + Math.random() * 80;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            const isDark = Math.random() > 0.5;
            grad.addColorStop(0, isDark ? 'rgba(100,95,85,0.15)' : 'rgba(160,155,145,0.15)');
            grad.addColorStop(1, 'rgba(140,134,123,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Finer detail noise
        for (let i = 0; i < 8000; i++) {
            const val = Math.random();
            ctx.fillStyle = val > 0.7 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            ctx.fillRect(x, y, 1.5, 1.5);
        }

        const concTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(concCanvas));
        concTex.wrapS = THREE.RepeatWrapping;
        concTex.wrapT = THREE.RepeatWrapping;
        concTex.repeat.set(8, 8); // Tiling scale for the vault

        // Bump map for plasticity
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 512;
        bumpCanvas.height = 512;
        const bctx = bumpCanvas.getContext('2d');
        bctx.fillStyle = '#808080'; // Mid-grey
        bctx.fillRect(0, 0, 512, 512);
        bctx.globalAlpha = 0.2;
        for (let i = 0; i < 5000; i++) {
            bctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
            bctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
        }

        const bumpTex = new THREE.CanvasTexture(bumpCanvas);
        bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
        bumpTex.repeat.set(8, 8);

        // Ceiling vault material
        this.vaultMat = new THREE.MeshLambertMaterial({
            map: concTex,
            bumpMap: bumpTex,
            bumpScale: 0.012,
            color: 0xffffff,
            side: THREE.DoubleSide
        });

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
                    // 1. Round passages in the middle
                    float dz1 = localZ - (-25.0);
                    float dz2 = localZ - (0.0);
                    float dz3 = localZ - (25.0);
                    
                    if (abs(localX) < 5.0) {
                        if (dz1*dz1 + dy*dy < r*r) discard;
                        if (dz2*dz2 + dy*dy < r*r) discard;
                        if (dz3*dz3 + dy*dy < r*r) discard;
                    }
                    
                    // 2. Straight cutouts at the ends for stairs. Threshold derived from
                    // THIS station's own platLength/2 minus a 4m inset (matches the
                    // originally hardcoded 41.0, since Lorenzkirche's platLength/2 is
                    // 45) instead of a fixed constant — see RathausBuilder for why a
                    // copy-pasted constant broke on a station with a different length.
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

        // Reddish Terra Cotta floor
        const floorCanvas = document.createElement('canvas');
        floorCanvas.width = 256;
        floorCanvas.height = 256;
        const fctx = floorCanvas.getContext('2d');
        fctx.fillStyle = '#8b4535';
        fctx.fillRect(0, 0, 256, 256);
        for(let i=0; i<300; i++) {
            fctx.fillStyle = Math.random() > 0.5 ? '#9c4d3b' : '#733729';
            fctx.fillRect(Math.random()*256, Math.random()*256, 4, 4);
        }
        const floorTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(floorCanvas));
        floorTex.wrapS = THREE.RepeatWrapping;
        floorTex.wrapT = THREE.RepeatWrapping;
        floorTex.repeat.set(20, 5);
        this.floorMat = new THREE.MeshLambertMaterial({ map: floorTex });

        // Aluminum panels removed - now building two text materials for correctly oriented station names
        const buildTextMat = (isMirrored) => {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 1024, 128);

            ctx.save();
            if (isMirrored) {
                // Flip the text on the canvas to compensate for the reversed UV mapping on one side
                ctx.translate(1024, 0);
                ctx.scale(-1, 1);
            }

            ctx.fillStyle = '#111827';
            ctx.font = 'bold 84px "Jost Regular", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Horizontal row logic: text repeat handled by tileU below.
            // One centered text instance per repeat unit.
            ctx.save();
            ctx.scale(0.7, 1.0); // condensed text look
            ctx.fillText('LORENZKIRCHE', 512 / 0.7, 64);
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.5;
            ctx.strokeText('LORENZKIRCHE', 512 / 0.7, 64);
            ctx.restore();

            ctx.restore();

            const tex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(canvas));
            tex.anisotropy = 8;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
            // Set keepWrapAndRepeat and calculate vertical repeat later when arc length is known
            mat.userData = { keepWrapAndRepeat: true };
            return mat;
        };

        // Mirroring check: tubeCenterL is positive.
        this.textMatL = buildTextMat(true);
        this.textMatR = buildTextMat(false);

        // Rosette Material
        const rosCanvas = document.createElement('canvas');
        rosCanvas.width = 512;
        rosCanvas.height = 512;
        const rctx = rosCanvas.getContext('2d');
        // Transparent background instead of dark grey square
        rctx.clearRect(0, 0, 512, 512);

        rctx.fillStyle = '#1f2937';
        rctx.beginPath();
        rctx.arc(256, 256, 256, 0, Math.PI*2);
        rctx.fill();

        rctx.strokeStyle = '#374151';
        rctx.lineWidth = 15;
        for (let i = 0; i < 24; i++) {
            const angle = (i / 24) * Math.PI * 2;
            rctx.beginPath();
            rctx.moveTo(256, 256);
            rctx.lineTo(256 + Math.cos(angle)*256, 256 + Math.sin(angle)*256);
            rctx.stroke();
        }
        rctx.beginPath();
        rctx.arc(256, 256, 128, 0, Math.PI*2);
        rctx.stroke();
        rctx.beginPath();
        rctx.arc(256, 256, 64, 0, Math.PI*2);
        rctx.stroke();

        const rosTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(rosCanvas));
        this.rosetteMat = new THREE.MeshLambertMaterial({ map: rosTex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
    }

    buildSegmentGroundAndCeiling(segmentData) {
        const { j } = segmentData;
        if (j !== 0) return; // ground/vault/lights are built ONCE, continuously, below

        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;
        const spacing = this.spacing; // station's own fixed gap (radius stays constant along the platform)
        const groundWidth = spacing + 2.8;
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL;

        // Track bed, as one continuous swept slab instead of per-10m boxes. buildSweptBar's
        // top-face U is normalised 0..1 across the width (not metric), so bake the width-wise
        // tile density into repeat.x instead (matching the ~1-tile-per-1.2m convention used
        // for V via Hmeters below).
        const groundMat = this.materials.ballast.clone();
        groundMat.map = this.materials.ballast.map.clone();
        groundMat.map.wrapS = groundMat.map.wrapT = THREE.RepeatWrapping;
        groundMat.map.repeat.set(groundWidth / 1.2, 1);
        this.model.buildSweptBar(this.group, sA, sB, () => groundWidth / 2,
            this.centerPos.y - 0.47, this.centerPos.y - 0.57, [groundMat, groundMat], 1.2);

        // Vault (dome arch over each track), as a continuous swept half-circle profile —
        // this is what makes the tube follow the curve instead of meeting at an angle every
        // 10m. Profile: x = R*cos(phi), y = R*sin(phi), phi:0..PI — traces from the right
        // spring-point up over the top and down to the left spring-point (a dome opening
        // downward), matching the original cylinder's net shape after its YXZ transform.
        // Extended past the OUTER spring point (phi<0 for the left tube, >PI for the
        // right) so the tube surface continues below platform-top level down to the
        // ground slab/Gleisbett (covering the area previously occupied by panels).
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
        this.model.buildSweptProfile(this.group, sA, sB, mkVaultArc(-phiExt, Math.PI), this.centerPos.y + 0.865, () => tubeCenterL, this.vaultMat, 5);
        this.model.buildSweptProfile(this.group, sA, sB, mkVaultArc(0, Math.PI + phiExt), this.centerPos.y + 0.865, () => tubeCenterR, this.vaultMat, 5);

        // Standard barrel light channel (Wöhrder-Wiese-Modell, see
        // StationModel.buildBarrelLights): one barrel per vault, hung from the
        // tube crown, mirrored to both tubes via the ± offFn convention.
        this.model.buildBarrelLights(this.group, {
            startS: sA + 3.0,
            endS: sB - 3.0,
            axisY: 0.865 + tubeRadius - 1.0,
            centerPosY: this.centerPos.y,
            centerAngle: this.centerAngle,
            offFn: () => tubeCenterL,
            ceilY: 0.865 + tubeRadius,
            label: this.station.name,
        });
    }

    buildSegmentPlatform(segmentData) {
        const { j } = segmentData;
        if (j !== 0) return; // built once, continuously, for the whole platform
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
        const textRadius = tubeRadius - 0.01;

        // Narrow curved band for the station name labels (shifted another 30cm down: from y = 1.1 to 1.6)
        const yTop = 1.6, yBot = 1.1;
        const thetaBot = Math.acos(-yBot / textRadius);
        const thetaTop = Math.acos(-yTop / textRadius);

        const textProfileL = [];
        const nSteps = 8;
        for (let k = 0; k <= nSteps; k++) {
            const th = thetaBot + (thetaTop - thetaBot) * k / nSteps;
            textProfileL.push({ x: textRadius * Math.sin(th), y: -textRadius * Math.cos(th) });
        }
        const textProfileR = textProfileL.map(p => ({ x: -p.x, y: p.y }));

        // Calculate arc length to fix the clipping issue (V-mapping)
        let arcLen = 0;
        for (let i = 1; i < textProfileL.length; i++) {
            arcLen += Math.hypot(textProfileL[i].x - textProfileL[i-1].x, textProfileL[i].y - textProfileL[i-1].y);
        }

        // Adjust vertical repeat so the full texture height fits the narrow geometry band
        this.textMatL.map.repeat.y = 1 / arcLen;
        this.textMatR.map.repeat.y = 1 / arcLen;
        this.textMatL.map.needsUpdate = true;
        this.textMatR.map.needsUpdate = true;

        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;

        // tileU = 4.0 for the requested 4m horizontal spacing
        this.model.buildSweptProfile(this.group, sA, sB, textProfileL, this.centerPos.y + 0.865, () => tubeCenterL, this.textMatL, 4.0);
        this.model.buildSweptProfile(this.group, sA, sB, textProfileR, this.centerPos.y + 0.865, () => tubeCenterR, this.textMatR, 4.0);
    }

    buildPillars() {
        this.buildCrossTubes();
        this.buildRosettes();
    }

    buildRosettes() {
        const spacing = this.spacing;
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL;
        const rosetteRadius = 2.2;

        // The arc length is (rosetteRadius * 2) / tubeRadius
        const arc = (rosetteRadius * 2) / tubeRadius;

        // The rosette is located at y = 0.865 + tubeRadius * 0.5
        // In the X/Y plane (with cylinder along Y), +X is left, -X is right.
        // Wait, standard cylinder is along Y. We rotate it to Z.
        // theta = 0 is -Y. theta = PI/2 is +X.
        // y = 0.865 + tubeRadius * 0.5 -> this is tubeRadius * 0.5 above the center (0.865)
        // So sin(angle_from_horizontal) = 0.5 -> angle = 30 degrees (PI/6)
        // Center for Left outer wall (+X) = PI/2 + angle_from_horizontal
        // angle_from_horizontal reduced from PI/6 (30 deg) to PI/10 (18 deg) to move it lower
        const angleFromHoriz = Math.PI / 10;
        const rosGeomL = new THREE.CylinderGeometry(tubeRadius - 0.05, tubeRadius - 0.05, rosetteRadius * 2, 32, 1, true, Math.PI/2 + angleFromHoriz - arc/2, arc);
        const rosGeomR = new THREE.CylinderGeometry(tubeRadius - 0.05, tubeRadius - 0.05, rosetteRadius * 2, 32, 1, true, -Math.PI/2 - angleFromHoriz - arc/2, arc);

        const placeRosette = (zPos, isLeft) => {
            const s_mid = this.station.position + zPos;
            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());

            const geom = isLeft ? rosGeomL : rosGeomR;
            const ros = new THREE.Mesh(geom, this.rosetteMat);

            const rX = isLeft ? tubeCenterL : tubeCenterR;

            // Place exactly at the tube center!
            ros.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), rX);
            ros.position.y = 0.865; // Center of the tube
            
            // Apply the same rotation as the vault
            ros.rotation.order = 'YXZ';
            ros.rotation.set(Math.PI / 2, 0, 0);
            ros.rotation.y = rotY;
            
            this.group.add(ros);
        };

        // Place them every 12 meters
        for (let z = -36; z <= 36; z += 12) {
            if (Math.abs(z) === 0 || Math.abs(z) === 24) continue; // Skip where the cross tubes are!
            placeRosette(z, true);
            placeRosette(z, false);
        }
    }

    buildCrossTubes() {
        const archLength = 8.0;
        const tubeRadius = this.spacing / 4 + 1.2;
        const r = 4.5;

        const buildTube = (zPos) => {
            const crossGroup = new THREE.Group();

            const s_mid = this.station.position + zPos;
            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());

            const crossGeom = this.getCutCrossTubeGeom(archLength, r);
            
            // LambertMaterial so passages react realistically to SpotLight headlights
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

            const crossTube = new THREE.Mesh(crossGeom, passageMat);
            crossTube.position.copy(localPos);
            crossTube.rotation.y = rotY;
            crossGroup.add(crossTube);

            // PointLight removed to prevent expensive WebGL recompilation on teleport
            this.group.add(crossGroup);

            // Benches removed by user request
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
