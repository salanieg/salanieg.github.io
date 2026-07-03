import * as THREE from 'three';
import { StationBuilder } from './StationBuilder.js?v=39';

export class RathausBuilder extends StationBuilder {
    setupMaterials() {
        // Outer mural material (Procedural blue-white noise for now)
        const muralCanvas = document.createElement('canvas');
        muralCanvas.width = 512;
        muralCanvas.height = 512;
        const ctx = muralCanvas.getContext('2d');

        // Base white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 512, 512);

        // Draw some abstract blue "city" patterns
        ctx.fillStyle = '#1e40af'; // deep blue
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const w = 10 + Math.random() * 40;
            const h = 10 + Math.random() * 80;
            ctx.globalAlpha = 0.3 + Math.random() * 0.5;
            ctx.fillRect(x, y, w, h);

            // Add some red accents like in the photo
            if (Math.random() > 0.9) {
                ctx.fillStyle = '#dc2626';
                ctx.fillRect(x + w/4, y + h/4, w/2, h/2);
                ctx.fillStyle = '#1e40af';
            }
        }

        const muralTex = new THREE.CanvasTexture(muralCanvas);
        muralTex.wrapS = THREE.RepeatWrapping;
        muralTex.wrapT = THREE.RepeatWrapping;
        muralTex.repeat.set(10, 1); // stretch along the wall

        this.muralMat = new THREE.MeshLambertMaterial({
            map: muralTex,
            color: 0xffffff,
            side: THREE.DoubleSide
        });

        // Simple white panel material for inner walls
        this.whitePanelMat = new THREE.MeshLambertMaterial({ color: '#f8fafc' });

        // Dark marble/stone floor for platform
        const floorCanvas = document.createElement('canvas');
        floorCanvas.width = 256;
        floorCanvas.height = 256;
        const fctx = floorCanvas.getContext('2d');
        fctx.fillStyle = '#3f4645';
        fctx.fillRect(0, 0, 256, 256);
        for(let i=0; i<100; i++) {
            fctx.fillStyle = Math.random() > 0.5 ? '#4b5563' : '#374151';
            fctx.beginPath();
            fctx.arc(Math.random()*256, Math.random()*256, Math.random()*10, 0, Math.PI*2);
            fctx.fill();
        }
        const floorTex = new THREE.CanvasTexture(floorCanvas);
        floorTex.wrapS = THREE.RepeatWrapping;
        floorTex.wrapT = THREE.RepeatWrapping;
        floorTex.repeat.set(20, 5);
        this.floorMat = new THREE.MeshLambertMaterial({ map: floorTex });

        // Ceiling vault material with custom shader to cut the 3 doorways
        this.vaultMat = new THREE.MeshLambertMaterial({ color: '#f1f5f9', side: THREE.DoubleSide });

        const holeRadius = 2.5;
        const holeY = 0.865 + 1.5; // 1.5m straight wall before arch starts

        this.vaultMat = new THREE.MeshLambertMaterial({ color: '#f1f5f9', side: THREE.DoubleSide });

        const pos_end = this.sim.getTrackPosition(this.station.position + this.platLength / 2);
        // We temporarily set up a dummy object to use worldToLocal safely without relying on this.group's current state
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

                    // 2. Straight cutouts at the ends for stairs
                    if (localZ < -41.0 || localZ > 41.0) {
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

        this.crossTubeMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0', side: THREE.DoubleSide });
        this.blendeMat = new THREE.MeshLambertMaterial({ color: '#1e293b', side: THREE.DoubleSide });

    }

    buildSegmentGroundAndCeiling(segmentData) {
        const { j, pos, normal, spacing, rotY, localPos } = segmentData;
        const groundWidth = spacing + 2.8;

        // Correctly scaled ballast material for the station track bed
        const groundMat = this.materials.ballast.clone();
        groundMat.map = this.materials.ballast.map.clone();
        groundMat.map.repeat.set(groundWidth, this.subLen);

        // Ground (Track bed)
        const groundMesh = new THREE.Mesh(new THREE.BoxGeometry(groundWidth, 0.1, this.subLen), groundMat);
        groundMesh.position.copy(localPos);
        groundMesh.position.y = -0.52;
        groundMesh.rotation.y = rotY;
        this.group.add(groundMesh);

        // Cylindrical Vaults (Tubes)
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL; // They touch exactly at X=0
        const vaultGeomR = new THREE.CylinderGeometry(tubeRadius, tubeRadius, this.subLen, 128, 1, true, Math.PI / 2, Math.PI);
        const vaultGeomL = vaultGeomR;

        const vaultR = new THREE.Mesh(vaultGeomR, this.vaultMat);
        vaultR.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterR);
        vaultR.position.y = 0.865;
        vaultR.rotation.order = 'YXZ';
        vaultR.rotation.set(Math.PI / 2, 0, 0);
        vaultR.rotation.y = rotY;

        // Left tube: starts from outer edge to inner intersection (X=0)
        const vaultL = new THREE.Mesh(vaultGeomL, this.vaultMat);
        vaultL.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterL);
        vaultL.position.y = 0.865;
        vaultL.rotation.order = 'YXZ';
        vaultL.rotation.set(Math.PI / 2, 0, 0);
        vaultL.rotation.y = rotY;

        this.group.add(vaultL, vaultR);

        // Continuous light strips hanging from the apex of each tube
        const lightW = 0.4;
        const lightH = 0.1;
        const hangerLen = 1.0;
        const lightY = 0.865 + tubeRadius - hangerLen;

        const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const casingMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
        const hangerMat = new THREE.MeshLambertMaterial({ color: '#94a3b8' });
        const hangerGeom = new THREE.CylinderGeometry(0.02, 0.02, hangerLen, 8);

        const buildLight = (centerX) => {
            const casing = new THREE.Mesh(new THREE.BoxGeometry(lightW, lightH + 0.05, this.subLen), casingMat);
            casing.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), centerX);
            casing.position.y = lightY + 0.025;
            casing.rotation.y = rotY;

            const glow = new THREE.Mesh(new THREE.BoxGeometry(lightW - 0.05, lightH, this.subLen), lightMat);
            glow.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), centerX);
            glow.position.y = lightY - 0.025;
            glow.rotation.y = rotY;

            this.group.add(casing, glow);

            const addHanger = (zOffset) => {
                const hanger = new THREE.Mesh(hangerGeom, hangerMat);
                hanger.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), centerX);
                hanger.position.y = lightY + hangerLen/2;
                hanger.position.addScaledVector(new THREE.Vector3(-Math.sin(rotY), 0, Math.cos(rotY)), zOffset);
                this.group.add(hanger);
            };
            addHanger(1.5);
            addHanger(-1.5);
        };

        buildLight(tubeCenterL);
        buildLight(tubeCenterR);
    }

    buildSegmentPlatform(segmentData) {
        const { rotY, localPos, j } = segmentData;
        const platWidth = this.spacing - 3.08;

        const geom = new THREE.BoxGeometry(platWidth, this.platHeight, this.subLen);
        this.model.adjustPlatformUVs(geom, j, this.subLen, 1.2);

        const platMat = this.model.getPlatformMaterials(this.station, platWidth, true, true);
        const plat = new THREE.Mesh(geom, platMat);
        plat.position.copy(localPos);
        plat.position.y = this.platCenterY;
        plat.rotation.y = rotY;
        this.group.add(plat);
    }

    buildSegmentOuterWalls(segmentData) {
        const { j, pos, normal, spacing, rotY, localPos } = segmentData;

        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL; // Fixed! Matches main tubes so mural is placed correctly.

        const muralRadius = tubeRadius - 0.05; // slightly inside

        // Track side is the outer quadrant of the half cylinder.
        // The half cylinder goes from PI/2 (+X) to 3*PI/2 (-X), with apex at PI (+Y).
        // Right track is at negative X. The outer wall is further negative X. So the mural is from PI to 3*PI/2.
        // Left track is at positive X. The outer wall is further positive X. So the mural is from PI/2 to PI.

        const muralGeomOuterRight = new THREE.CylinderGeometry(muralRadius, muralRadius, this.subLen, 16, 1, true, Math.PI, Math.PI / 2);
        const muralGeomOuterLeft = new THREE.CylinderGeometry(muralRadius, muralRadius, this.subLen, 16, 1, true, Math.PI / 2, Math.PI / 2);

        // Right Track Mural (Negative X side)
        const muralR = new THREE.Mesh(muralGeomOuterRight, this.muralMat);
        muralR.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterR);
        muralR.position.y = 0.865;
        muralR.rotation.order = 'YXZ';
        muralR.rotation.set(Math.PI / 2, 0, 0);
        muralR.rotation.y = rotY;

        // Left Track Mural (Positive X side)
        const muralL = new THREE.Mesh(muralGeomOuterLeft, this.muralMat);
        muralL.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterL);
        muralL.position.y = 0.865;
        muralL.rotation.order = 'YXZ';
        muralL.rotation.set(Math.PI / 2, 0, 0);
        muralL.rotation.y = rotY;

        this.group.add(muralR, muralL);

        // Wall stripe
        if (!this.stripeMat) {
            this.stripeMat = this.model.createWallStripeMaterial("Rathaus", '#e2e8f0', '#16a34a'); // light gray bg, dark green text
            this.stripeMat.side = THREE.DoubleSide; // Make visible from the inside
        }

        const stripeRadius = muralRadius - 0.02; // Slightly closer to track
        const dyBottom = 1.8 - 0.865;
        const dyTop = 2.2 - 0.865;
        const thetaL_start = Math.acos(-dyBottom / stripeRadius);
        const thetaL_end = Math.acos(-dyTop / stripeRadius);
        const stripeGeomOuterLeft = new THREE.CylinderGeometry(stripeRadius, stripeRadius, this.subLen, 16, 1, true, thetaL_start, thetaL_end - thetaL_start);

        const thetaR_start = Math.PI * 2 - thetaL_end;
        const thetaR_end = Math.PI * 2 - thetaL_start;
        const stripeGeomOuterRight = new THREE.CylinderGeometry(stripeRadius, stripeRadius, this.subLen, 16, 1, true, thetaR_start, thetaR_end - thetaR_start);

        const uScale = 1.0 / this.platLength;

        const swapUVsL = (geom) => {
            const uv = geom.attributes.uv;
            const pos = geom.attributes.position;
            for (let i = 0; i < uv.count; i++) {
                const y = pos.getY(i);
                const globalZ = (j + 0.5 - this.numSub / 2) * this.subLen - y;
                const u_new = -globalZ * uScale;
                const v_new = uv.getX(i);
                uv.setXY(i, u_new, v_new);
            }
        };
        swapUVsL(stripeGeomOuterLeft);

        const swapUVsR = (geom) => {
            const uv = geom.attributes.uv;
            const pos = geom.attributes.position;
            for (let i = 0; i < uv.count; i++) {
                const y = pos.getY(i);
                const globalZ = (j + 0.5 - this.numSub / 2) * this.subLen - y;
                const u_new = globalZ * uScale;
                const v_new = 1.0 - uv.getX(i);
                uv.setXY(i, u_new, v_new);
            }
        };
        swapUVsR(stripeGeomOuterRight);

        const stripeR = new THREE.Mesh(stripeGeomOuterRight, this.stripeMat);
        stripeR.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterR);
        stripeR.position.y = 0.865;
        stripeR.rotation.order = 'YXZ';
        stripeR.rotation.set(Math.PI / 2, 0, 0);
        stripeR.rotation.y = rotY;
        
        const stripeL = new THREE.Mesh(stripeGeomOuterLeft, this.stripeMat);
        stripeL.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterL);
        stripeL.position.y = 0.865;
        stripeL.rotation.order = 'YXZ';
        stripeL.rotation.set(Math.PI / 2, 0, 0);
        stripeL.rotation.y = rotY;
        
        this.group.add(stripeR, stripeL);
    }

    buildPillars() {
        this.buildCrossTubes();
    }

    buildCrossTubes() {
        const archLength = 8.0; // WIDER so it intersects the main tubes
        const tubeRadius = this.spacing / 4 + 1.2;
        const r = 4.5; // Massive passages

        const buildTube = (zPos) => {
            const crossGroup = new THREE.Group();

            const s_mid = this.station.position + zPos;
            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());

            const crossGeom = this.getCutCrossTubeGeom(archLength, r);
            
            // LambertMaterial so passages react realistically to SpotLight headlights
            const passageMat = new THREE.MeshLambertMaterial({ color: '#475569', side: THREE.DoubleSide });
            
            // Pixel-perfect shader clipping to perfectly merge with the main tubes
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
        };

        buildTube(-25);
        buildTube(0);
        buildTube(25);
    }

    getCutCrossTubeGeom(archLength, r) {
        if (!this.cutCrossTubeGeom) {
            // Half cylinder to act as a semi-circular passage ceiling.
            // Shader handles perfect clipping.
            const geom = new THREE.CylinderGeometry(r, r, archLength, 128, 1, true, 0, Math.PI);

            // Reorient the cylinder so its axis is X and it arches upwards in Y
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
