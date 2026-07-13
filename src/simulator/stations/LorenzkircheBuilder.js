import * as THREE from 'three';
import { StationBuilder } from './StationBuilder.js?v=67';
import { tagCanvasTextureSRGBKeepLook } from '../TextureUtils.js';

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
        const concTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(concCanvas));
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
        pctx.font = 'bold 100px "Jost Regular", sans-serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        pctx.fillText('LORENZKIRCHE', 1500, 256);
        pctx.strokeStyle = '#111827';
        pctx.lineWidth = 2.0;
        pctx.strokeText('LORENZKIRCHE', 1500, 256);

        const panelTex = tagCanvasTextureSRGBKeepLook(new THREE.CanvasTexture(panelCanvas));
        panelTex.anisotropy = 8;
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
        const arcSteps = 32;
        const vaultArc = [];
        for (let k = 0; k <= arcSteps; k++) {
            const phi = Math.PI * k / arcSteps;
            vaultArc.push({ x: tubeRadius * Math.cos(phi), y: tubeRadius * Math.sin(phi) });
        }
        this.model.buildSweptProfile(this.group, sA, sB, vaultArc, this.centerPos.y + 0.865, () => tubeCenterL, this.vaultMat, 5);
        this.model.buildSweptProfile(this.group, sA, sB, vaultArc, this.centerPos.y + 0.865, () => tubeCenterR, this.vaultMat, 5);

        // Light strips (continuous casing + glow), and their discrete hanger rods (real
        // periodic fixtures, kept at the same spacing/positions as the original per-segment
        // pairs: two hangers per 10m... per this.subLen segment, at local z = +-1.5m).
        const lightW = 0.4;
        const lightH = 0.1;
        const hangerLen = 1.0;
        const lightY = 0.865 + tubeRadius - hangerLen;
        const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const casingMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
        const hangerMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });
        const hangerGeom = new THREE.CylinderGeometry(0.02, 0.02, hangerLen, 8);

        [tubeCenterL, tubeCenterR].forEach(centerX => {
            this.model.buildSweptBar(this.group, sA, sB, () => lightW / 2,
                this.centerPos.y + lightY + 0.1, this.centerPos.y + lightY - 0.05, [casingMat, casingMat], 1.2, () => centerX);
            this.model.buildSweptBar(this.group, sA, sB, () => (lightW - 0.05) / 2,
                this.centerPos.y + lightY + 0.025, this.centerPos.y + lightY - 0.075, [lightMat, lightMat], 1.2, () => centerX);

            for (let jj = 0; jj < this.numSub; jj++) {
                const s_mid = sA + (jj + 0.5) * this.subLen;
                [1.5, -1.5].forEach(zOffset => {
                    const s = s_mid + zOffset;
                    const pos = this.sim.getTrackPosition(s);
                    const tangent = this.sim.getTrackTangent(s);
                    const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
                    const hanger = new THREE.Mesh(hangerGeom, hangerMat);
                    hanger.position.copy(this.group.worldToLocal(pos.clone().addScaledVector(new THREE.Vector3(-tangent.z, 0, tangent.x), centerX)));
                    hanger.position.y = lightY + hangerLen / 2;
                    hanger.rotation.y = rotY;
                    this.group.add(hanger);
                });
            }
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
        if (j !== 0) return; // built once, continuously, for the whole platform

        const spacing = this.spacing;
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL;
        const panelRadius = tubeRadius - 0.02; // Slightly inside the concrete

        // Curved wall panel (a low band of the tube's own cylindrical surface, from floor to
        // 2.5m), swept continuously so it follows the true curve instead of meeting at an
        // angle every segment. thetaStart/End solve the SAME "y = -R*cos(theta)" relation the
        // original per-segment cylinder slice used, so y still runs from 0 (floor) to 2.5m.
        const thetaStart = Math.acos(0);              // dyBottom = 0
        const thetaEnd = Math.acos(-2.5 / panelRadius); // dyTop = 2.5
        const panelSteps = 16;
        const panelProfileL = [];
        for (let k = 0; k <= panelSteps; k++) {
            const theta = thetaStart + (thetaEnd - thetaStart) * k / panelSteps;
            panelProfileL.push({ x: panelRadius * Math.sin(theta), y: -panelRadius * Math.cos(theta) });
        }
        const panelProfileR = panelProfileL.map(p => ({ x: -p.x, y: p.y })); // mirror image

        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;
        // tileU=30 matches the original texture's 30m repeat (with the "LORENZKIRCHE" text at
        // its 15m mark), so the text still appears at roughly the platform's own centre.
        this.model.buildSweptProfile(this.group, sA, sB, panelProfileL, this.centerPos.y + 0.865, () => tubeCenterL, this.panelMat, 30);
        this.model.buildSweptProfile(this.group, sA, sB, panelProfileR, this.centerPos.y + 0.865, () => tubeCenterR, this.panelMat, 30);
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
