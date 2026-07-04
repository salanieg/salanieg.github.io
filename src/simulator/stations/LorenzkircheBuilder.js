import * as THREE from 'three';
import { StationBuilder } from './StationBuilder.js?v=67';

export class LorenzkircheBuilder extends StationBuilder {
    setupMaterials() {
        // Concrete material for the vault
        const concCanvas = document.createElement('canvas');
        concCanvas.width = 512;
        concCanvas.height = 512;
        const ctx = concCanvas.getContext('2d');
        ctx.fillStyle = '#8c867b'; // Warm concrete base
        ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 5000; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#7a7469' : '#9e988d';
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            ctx.fillRect(x, y, 2, 2);
        }
        const concTex = new THREE.CanvasTexture(concCanvas);
        concTex.wrapS = THREE.RepeatWrapping;
        concTex.wrapT = THREE.RepeatWrapping;
        concTex.repeat.set(10, 10);

        // Ceiling vault material with custom shader to cut the 3 doorways (same as Rathaus)
        this.vaultMat = new THREE.MeshLambertMaterial({ map: concTex, color: 0xffffff, side: THREE.DoubleSide });

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
        const floorTex = new THREE.CanvasTexture(floorCanvas);
        floorTex.wrapS = THREE.RepeatWrapping;
        floorTex.wrapT = THREE.RepeatWrapping;
        floorTex.repeat.set(20, 5);
        this.floorMat = new THREE.MeshLambertMaterial({ map: floorTex });

        // Aluminum panels for lower platform walls (30m repeating pattern)
        const panelCanvas = document.createElement('canvas');
        panelCanvas.width = 3000;
        panelCanvas.height = 512;
        const pctx = panelCanvas.getContext('2d');

        // Base color
        pctx.fillStyle = '#9ca3af';
        pctx.fillRect(0, 0, 3000, 512);

        // Panel gaps every 2m (200px)
        pctx.fillStyle = '#6b7280';
        for (let x = 0; x < 3000; x += 200) {
            pctx.fillRect(x + 194, 0, 6, 512);
        }

        // Draw LORENZKIRCHE text in the middle (at 15m mark)
        pctx.fillStyle = '#111827';
        pctx.font = 'bold 80px sans-serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        pctx.fillText('LORENZKIRCHE', 1500, 256);

        const panelTex = new THREE.CanvasTexture(panelCanvas);
        panelTex.wrapS = THREE.RepeatWrapping;
        panelTex.wrapT = THREE.RepeatWrapping;
        // The texture spans 30m. A 10m segment should cover 1/3 of the texture.
        panelTex.repeat.set(10.0 / 30.0, 1);

        this.panelMat = new THREE.MeshLambertMaterial({ map: panelTex, side: THREE.DoubleSide });

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

        const rosTex = new THREE.CanvasTexture(rosCanvas);
        this.rosetteMat = new THREE.MeshLambertMaterial({ map: rosTex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
    }

    buildSegmentGroundAndCeiling(segmentData) {
        const { j, pos, normal, spacing, rotY, localPos } = segmentData;
        const groundWidth = spacing + 2.8;

        // Correctly scaled ballast material for the station track bed
        const groundMat = this.materials.ballast.clone();
        groundMat.map = this.materials.ballast.map.clone();
        groundMat.map.repeat.set(groundWidth, this.subLen);

        const groundMesh = new THREE.Mesh(new THREE.BoxGeometry(groundWidth, 0.1, this.subLen), groundMat);
        groundMesh.position.copy(localPos);
        groundMesh.position.y = -0.52;
        groundMesh.rotation.y = rotY;
        this.group.add(groundMesh);

        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL;
        const vaultGeomR = new THREE.CylinderGeometry(tubeRadius, tubeRadius, this.subLen, 128, 1, true, Math.PI / 2, Math.PI);
        const vaultGeomL = vaultGeomR;

        const vaultR = new THREE.Mesh(vaultGeomR, this.vaultMat);
        vaultR.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterR);
        vaultR.position.y = 0.865;
        vaultR.rotation.order = 'YXZ';
        vaultR.rotation.set(Math.PI / 2, 0, 0);
        vaultR.rotation.y = rotY;

        const vaultL = new THREE.Mesh(vaultGeomL, this.vaultMat);
        vaultL.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterL);
        vaultL.position.y = 0.865;
        vaultL.rotation.order = 'YXZ';
        vaultL.rotation.set(Math.PI / 2, 0, 0);
        vaultL.rotation.y = rotY;

        this.group.add(vaultL, vaultR);

        const lightW = 0.4;
        const lightH = 0.1;
        const hangerLen = 1.0;
        const lightY = 0.865 + tubeRadius - hangerLen;

        const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const casingMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
        const hangerMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });
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
        const tubeRadius = tubeCenterL;

        const panelRadius = tubeRadius - 0.02; // Slightly inside the concrete

        const dyBottom = 0.0; // From floor
        const dyTop = 2.5;    // Up to 2.5m
        const thetaL_start = Math.acos(-dyBottom / panelRadius);
        const thetaL_end = Math.acos(-dyTop / panelRadius);
        const panelGeomOuterLeft = new THREE.CylinderGeometry(panelRadius, panelRadius, this.subLen, 16, 1, true, thetaL_start, thetaL_end - thetaL_start);

        const thetaR_start = Math.PI * 2 - thetaL_end;
        const thetaR_end = Math.PI * 2 - thetaL_start;
        const panelGeomOuterRight = new THREE.CylinderGeometry(panelRadius, panelRadius, this.subLen, 16, 1, true, thetaR_start, thetaR_end - thetaR_start);

        const globalZ = (j + 0.5 - this.numSub / 2) * this.subLen;

        const setUVs = (geom, invertU) => {
            const uv = geom.attributes.uv;
            const pos = geom.attributes.position;
            // The segment is this.subLen (10m) long. globalZ gives us its absolute position.
            // We want the 30m texture to map continuously across all segments.
            for (let i = 0; i < uv.count; i++) {
                const y = pos.getY(i);
                const localZ = y; // -5 to +5
                const absoluteZ = globalZ + localZ; // The true world Z position relative to station center

                // Map absoluteZ to U coordinate.
                // Since the texture covers 30m and we use repeat.set(10/30, 1),
                // U should go from 0 to 1 across the 10m segment.
                // Actually, if we use repeat.set, the geometry UV should just be the world position scaled!
                // Wait, if repeat is set to 10/30, then a UV of 0 to 1 will map to 0 to 0.33 of the texture.
                // It's easier to NOT use repeat.set, and just map absoluteZ directly to U!
                let u_new = absoluteZ / 30.0;

                if (invertU) u_new = -u_new; // Reverse for the other side

                const v_new = uv.getX(i); // Height
                uv.setXY(i, u_new, v_new);
            }
        };

        setUVs(panelGeomOuterLeft, false);
        setUVs(panelGeomOuterRight, true);

        const panelR = new THREE.Mesh(panelGeomOuterRight, this.panelMat);
        panelR.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterR);
        panelR.position.y = 0.865;
        panelR.rotation.order = 'YXZ';
        panelR.rotation.set(Math.PI / 2, 0, 0);
        panelR.rotation.y = rotY;

        const panelL = new THREE.Mesh(panelGeomOuterLeft, this.panelMat);
        panelL.position.copy(localPos).addScaledVector(new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY)), tubeCenterL);
        panelL.position.y = 0.865;
        panelL.rotation.order = 'YXZ';
        panelL.rotation.set(Math.PI / 2, 0, 0);
        panelL.rotation.y = rotY;

        this.group.add(panelR, panelL);
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
        // Center for Left outer wall (+X) = PI/2 + PI/6 = 2*PI/3
        // Center for Right outer wall (-X) = -PI/2 - PI/6 = -2*PI/3 (or 4*PI/3)

        const rosGeomL = new THREE.CylinderGeometry(tubeRadius - 0.05, tubeRadius - 0.05, rosetteRadius * 2, 32, 1, true, 2*Math.PI/3 - arc/2, arc);
        const rosGeomR = new THREE.CylinderGeometry(tubeRadius - 0.05, tubeRadius - 0.05, rosetteRadius * 2, 32, 1, true, -2*Math.PI/3 - arc/2, arc);

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
            const passageMat = new THREE.MeshLambertMaterial({ color: '#475569', side: THREE.DoubleSide });
            
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
