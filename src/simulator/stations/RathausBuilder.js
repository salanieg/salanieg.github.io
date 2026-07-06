import * as THREE from 'three';
import { StationBuilder } from './StationBuilder.js?v=67';

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
        const { j } = segmentData;
        if (j !== 0) return; // ground/vault/lights are built ONCE, continuously, below

        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;
        const spacing = this.spacing; // station's own fixed gap (radius stays constant along the platform)
        const groundWidth = spacing + 2.8;
        const tubeCenterL = spacing / 4 + 1.2;
        const tubeCenterR = -tubeCenterL;
        const tubeRadius = tubeCenterL; // They touch exactly at X=0

        // Track bed, as one continuous swept slab instead of per-10m boxes. buildSweptBar's
        // top-face U is normalised 0..1 across the width, so bake the width-wise tile density
        // into repeat.x instead (matching the ~1-tile-per-1.2m convention used for V/Hmeters).
        const groundMat = this.materials.ballast.clone();
        groundMat.map = this.materials.ballast.map.clone();
        groundMat.map.wrapS = groundMat.map.wrapT = THREE.RepeatWrapping;
        groundMat.map.repeat.set(groundWidth / 1.2, 1);
        this.model.buildSweptBar(this.group, sA, sB, () => groundWidth / 2,
            this.centerPos.y - 0.47, this.centerPos.y - 0.57, [groundMat, groundMat], 1.2);

        // Cylindrical vaults (tubes), as a continuous swept half-circle profile — this is what
        // makes the tube follow the curve instead of meeting at an angle every 10m. Profile:
        // x = R*cos(phi), y = R*sin(phi), phi:0..PI — dome opening downward, matching the
        // original cylinder's net shape after its YXZ transform (theta = phi + PI/2).
        const arcSteps = 32;
        const vaultArc = [];
        for (let k = 0; k <= arcSteps; k++) {
            const phi = Math.PI * k / arcSteps;
            vaultArc.push({ x: tubeRadius * Math.cos(phi), y: tubeRadius * Math.sin(phi) });
        }
        this.model.buildSweptProfile(this.group, sA, sB, vaultArc, this.centerPos.y + 0.865, () => tubeCenterL, this.vaultMat, 5);
        this.model.buildSweptProfile(this.group, sA, sB, vaultArc, this.centerPos.y + 0.865, () => tubeCenterR, this.vaultMat, 5);

        // Continuous light strips + discrete hanger rods (kept at the same spacing as the
        // original per-segment pairs: two hangers per this.subLen segment, at local z = +-1.5m).
        const lightW = 0.4;
        const lightH = 0.1;
        const hangerLen = 1.0;
        const lightY = 0.865 + tubeRadius - hangerLen;
        const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const casingMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
        const hangerMat = new THREE.MeshLambertMaterial({ color: '#94a3b8' });
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
        const tubeRadius = tubeCenterL; // Fixed! Matches main tubes so mural is placed correctly.
        const muralRadius = tubeRadius - 0.05; // slightly inside
        const sA = this.station.position - this.platLength / 2;
        const sB = this.station.position + this.platLength / 2;

        // Mural band: the outer quarter of each tube's own cylindrical surface (the half-vault
        // spans theta PI/2..3PI/2 i.e. phi 0..PI in our x=R*cos(phi),y=R*sin(phi) convention;
        // the mural covers just its outer half: phi 0..PI/2 for the left tube's outward side,
        // phi PI/2..PI for the right tube's outward side), swept continuously.
        const steps = 16;
        const muralProfileLeft = [], muralProfileRight = [];
        for (let k = 0; k <= steps; k++) {
            const phiL = (Math.PI / 2) * k / steps;
            muralProfileLeft.push({ x: muralRadius * Math.cos(phiL), y: muralRadius * Math.sin(phiL) });
            const phiR = Math.PI / 2 + (Math.PI / 2) * k / steps;
            muralProfileRight.push({ x: muralRadius * Math.cos(phiR), y: muralRadius * Math.sin(phiR) });
        }
        // buildSweptProfile forces the cloned material's texture.repeat to (1,1), so the baked
        // UV alone must reproduce muralTex's own repeat=(10,1) over the original 5m segment
        // (density 10/5 = 2 repeats/metre) -> tileU = 1/2 = 0.5 (NOT the original geometry's
        // own subLen-based value, which no longer applies once repeat is reset).
        this.model.buildSweptProfile(this.group, sA, sB, muralProfileLeft, this.centerPos.y + 0.865, () => tubeCenterL, this.muralMat, 0.5);
        this.model.buildSweptProfile(this.group, sA, sB, muralProfileRight, this.centerPos.y + 0.865, () => tubeCenterR, this.muralMat, 0.5);

        // Wall stripe (station nameplate band), same curved-surface treatment, at head height
        // (2.1m to 2.5m absolute, i.e. dyBottom/dyTop above the 0.865 baseline).
        if (!this.stripeMat) {
            this.stripeMat = this.model.createWallStripeMaterial("Rathaus", '#e2e8f0', '#16a34a'); // light gray bg, dark green text
            this.stripeMat.side = THREE.DoubleSide; // Make visible from the inside
        }
        const stripeRadius = muralRadius - 0.02; // Slightly closer to track
        const dyBottom = 2.1 - 0.865;
        const dyTop = 2.5 - 0.865;
        const thetaStart = Math.acos(-dyBottom / stripeRadius);
        const thetaEnd = Math.acos(-dyTop / stripeRadius);
        const stripeProfileLeft = [];
        for (let k = 0; k <= steps; k++) {
            const theta = thetaStart + (thetaEnd - thetaStart) * k / steps;
            stripeProfileLeft.push({ x: stripeRadius * Math.sin(theta), y: -stripeRadius * Math.cos(theta) });
        }
        const stripeProfileRight = stripeProfileLeft.map(p => ({ x: -p.x, y: p.y })); // mirror image
        // createWallStripeMaterial calibrates itself so "a single repeat covers 2.1m" (see its
        // own comment) — with repeat forced to (1,1) by buildSweptProfile, tileU=2.1 reproduces
        // that density directly (using this.platLength here made the text stretch huge over the
        // whole wall instead of repeating every ~2.1m).
        this.model.buildSweptProfile(this.group, sA, sB, stripeProfileLeft, this.centerPos.y + 0.865, () => tubeCenterL, this.stripeMat, 2.1);
        this.model.buildSweptProfile(this.group, sA, sB, stripeProfileRight, this.centerPos.y + 0.865, () => tubeCenterR, this.stripeMat, 2.1);
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
