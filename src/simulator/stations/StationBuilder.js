import * as THREE from 'three';

export class StationBuilder {
    constructor(model, station) {
        this.model = model;
        this.station = station;
        this.group = new THREE.Group();
        this.sim = model.sim;
        this.materials = model.materials;
        this.sharedGeometries = model.sharedGeometries;

        this.centerPos = this.sim.getTrackPosition(station.position);
        const centerTangent = this.sim.getTrackTangent(station.position);
        this.centerAngle = Math.atan2(centerTangent.x, centerTangent.z);
        this.spacing = this.sim.getTrackSpacing(station.position);

        this.group.position.copy(this.centerPos);
        this.group.rotation.y = this.centerAngle;
        this.group.updateMatrixWorld(true);

        const S_len = 1.0; // Bahnsteig-Längsmaßstab: 1 Einheit = 1 Meter
        this.subLen = 5.0 * S_len;
        // Platform length is taken from the geojson (station.halfLength) and snapped to
        // a whole number of 5 m segments so the deck/wall sub-segmentation stays aligned.
        this.numSub = Math.max(8, Math.round((2 * station.halfLength) / this.subLen));
        this.platLength = this.numSub * this.subLen;
        this.platTopY = 0.865;   // Bahnsteig-OK auf Zugboden-Höhe (ebener Einstieg, 1:1)
        this.platHeight = 1.165; // Deck von Boden (-0.30) bis 0.865
        this.platCenterY = 0.2825;
        this.isSideStation = station.side;
        this.isScharfreiterring = (station.name === "Scharfreiterring");

        this.wallPresets = {
            "Maximilianstraße": {
                bottomColor: '#f8fafc',
                bottomGrout: '#94a3b8',
                topColor: '#3a9c35',
                topGrout: '#d1d5db',
                stripeBg: '#ffffff',
                stripeText: '#1b5e20'
            },
            "Langwasser Süd": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#acb6bf',
                topGrout: '#7e8a93',
                stripeBg: '#184763',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Gemeinschaftshaus": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#acb6bf',
                topGrout: '#7e8a93',
                stripeBg: '#41525a',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Langwasser Mitte": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#acb6bf',
                topGrout: '#7e8a93',
                stripeBg: '#51301b',
                stripeText: '#ffffff',
                flatTiles: true
            }
        };
    }

    build() {
        this.setupMaterials();

        for (let j = 0; j < this.numSub; j++) {
            const localZ_mid = -this.platLength / 2 + j * this.subLen + this.subLen / 2;
            const s_mid = this.station.position + localZ_mid;

            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());

            const segmentData = {
                j, localZ_mid, s_mid, pos, tangent, normal, spacing, rotY, localPos
            };

            this.buildSegmentGroundAndCeiling(segmentData);
            this.buildSegmentPlatform(segmentData);
            this.buildSegmentOuterWalls(segmentData);
        }

        this.buildPillars();
        this.buildBenches();
        this.buildSignsAndBoards();
        this.buildStairs();
        this.buildPointLights();
        this.buildStandardDetails();

        return this.group;
    }

    setupMaterials() {}
    buildSegmentGroundAndCeiling(segmentData) {}
    buildSegmentPlatform(segmentData) {
        const { j, localPos, spacing, rotY } = segmentData;
        const group = this.group;

        // Common dimensions
        const trackX = spacing / 2;
        const platEdgeX = trackX - 1.54; // Platform edge at 1.54m from track center (for 2.90m wide train)
        const platWidth = this.isSideStation ? 4.0 : 9.0;
        const platTopY = this.platTopY;
        const platHeight = this.platHeight;

        const geom = new THREE.BoxGeometry(platWidth, platHeight, this.subLen);
        const platMat = this.materials.platform;

        if (this.isSideStation) {
            // Side platforms: two platforms on the outside of the tracks
            const leftPlat = new THREE.Mesh(geom, platMat);
            leftPlat.position.set(-platEdgeX - platWidth / 2, this.platCenterY, localPos.z);
            leftPlat.rotation.y = rotY;
            group.add(leftPlat);

            const rightPlat = new THREE.Mesh(geom, platMat);
            rightPlat.position.set(platEdgeX + platWidth / 2, this.platCenterY, localPos.z);
            rightPlat.rotation.y = rotY;
            group.add(rightPlat);
        } else {
            // Island platform: one platform between the tracks
            const platform = new THREE.Mesh(geom, platMat);
            platform.position.set(localPos.x, this.platCenterY, localPos.z);
            platform.rotation.y = rotY;
            group.add(platform);
        }
    }

    buildSegmentOuterWalls(segmentData) {}
    buildPillars() {}
    buildBenches() {}
    buildSignsAndBoards() {}
    buildStairs() {
        if (this.station.type !== 'underground') return;

        const station = this.station;
        const group = this.group;
        const centerPos = this.centerPos;
        const centerAngle = this.centerAngle;

        const isRound = (station.name === "Rathaus" || station.name === "Lorenzkirche");

        const wallMat = this.createRoughConcreteMaterial();

        const stairTex = this.createStairTexture();
        const stepMat = new THREE.MeshLambertMaterial({ map: stairTex });

        const escStripeTex = this.createEscalatorStripeTexture();
        const escStepMat = new THREE.MeshLambertMaterial({ map: escStripeTex });

        const handrailMat = new THREE.MeshBasicMaterial({ color: '#111111' });
        const glassMat = new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.6 });

        this.doorWidth = 0.8; // "Zutritt nur für Personal" doors, outer edge flush with the platform edge
        const stairHalfWidth = 2.3; // Half-width of the stair/escalator envelope (matches glass balustrade extent)

        // Transverse Walls at the ends
        const transWallDepth = 0.4;
        const transWallWidth = 10.0; // Wide enough to cover the outer main tube
        const transWallHeight = 7.0;

        const transWallGeom = new THREE.BoxGeometry(transWallWidth, transWallHeight, transWallDepth);

        // Each end of the platform can sit at a different local track spacing (the two ends
        // are not mirror images of each other — they curve independently towards their own
        // tunnel portal), so every end-specific construction (wall cutouts, doors) must use the
        // spacing sampled AT THAT END, not the station-center spacing used for the platform deck.
        const s_neg = station.position - this.platLength / 2;
        const s_pos = station.position + this.platLength / 2;
        const spacing_neg = this.sim.getTrackSpacing(s_neg);
        const spacing_pos = this.sim.getTrackSpacing(s_pos);
        const trackX_neg = spacing_neg / 2;
        const trackX_pos = spacing_pos / 2;
        const platEdgeX_neg = trackX_neg - 1.54;
        const platEdgeX_pos = trackX_pos - 1.54;

        // Calculate curvature for both ends of the station
        // Negative Z end (Langwasser Süd direction)
        const pos_neg = this.sim.getTrackPosition(s_neg);
        const dummyNeg = new THREE.Object3D();
        dummyNeg.position.copy(centerPos);
        dummyNeg.rotation.y = centerAngle;
        dummyNeg.updateMatrixWorld();
        const localPos_neg = dummyNeg.worldToLocal(pos_neg.clone());
        let curvatureA_neg = localPos_neg.x / (localPos_neg.z * localPos_neg.z);
        if (isNaN(curvatureA_neg) || !isFinite(curvatureA_neg)) curvatureA_neg = 0;

        // Positive Z end (Hardhöhe direction)
        const pos_pos = this.sim.getTrackPosition(s_pos);
        const dummyPos = new THREE.Object3D();
        dummyPos.position.copy(centerPos);
        dummyPos.rotation.y = centerAngle;
        dummyPos.updateMatrixWorld();
        const localPos_pos = dummyPos.worldToLocal(pos_pos.clone());
        let curvatureA_pos = localPos_pos.x / (localPos_pos.z * localPos_pos.z);
        if (isNaN(curvatureA_pos) || !isFinite(curvatureA_pos)) curvatureA_pos = 0;

        const transWallMatNeg = this.createRoughConcreteMaterial();
        transWallMatNeg.side = THREE.DoubleSide;

        const transWallMatPos = this.createRoughConcreteMaterial();
        transWallMatPos.side = THREE.DoubleSide;

        const compileTransWallMaterial = (mat, curvValue, endKey, trackXVal, platEdgeXVal) => {
            mat.onBeforeCompile = (shader) => {
                shader.uniforms.uCenterPos = { value: centerPos };
                shader.uniforms.uCenterAngle = { value: centerAngle };
                shader.uniforms.uTrackX = { value: trackXVal };
                shader.uniforms.uCurvatureA = { value: curvValue };
                
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
                    uniform float uTrackX;
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
                    
                    // Apply curvature correction to align with shifted geometry
                    localX = localX - uCurvatureA * localZ * localZ;
                    
                    float localY = offset.y;
                    float absX = abs(localX);
                    
                    // 1. Train Cutout (only on track side of platform edge)
                    if (absX >= ${platEdgeXVal.toFixed(3)}) {
                        float dx = absX - uTrackX;
                        float dy = localY - 1.13; // center of generous tunnel circle
                        if (dx*dx + dy*dy < 2.6*2.6 && localY > 1.13) discard;
                        if (abs(dx) < 2.6 && localY <= 1.13) discard;
                    }

                    // 2. Door Cutout
                    float doorX1 = ${platEdgeXVal.toFixed(3)} - ${this.doorWidth.toFixed(3)};
                    float doorX2 = ${platEdgeXVal.toFixed(3)};
                    if (absX > doorX1 && absX < doorX2 && localY > 0.80 && localY < 2.55) discard;
                    `
                );
            };

            mat.customProgramCacheKey = () => {
                return station.name + isRound.toString() + trackXVal.toString() + endKey;
            };
        };

        compileTransWallMaterial(transWallMatNeg, curvatureA_neg, "Neg", trackX_neg, platEdgeX_neg);
        compileTransWallMaterial(transWallMatPos, curvatureA_pos, "Pos", trackX_pos, platEdgeX_pos);

        const createStairsAndEscalator = (zStart, zDir) => {
            const stairGroup = new THREE.Group();
            
            const stepDepth = 0.3;
            const stepHeight = 0.16;
            const numSteps = 28; // height = 4.48m

            const rampLength = Math.sqrt(Math.pow(numSteps * stepDepth, 2) + Math.pow(numSteps * stepHeight, 2));
            const rampAngle = Math.atan2(numSteps * stepHeight, numSteps * stepDepth);
            const rotX = -zDir * rampAngle;

            const midZ = zDir * (numSteps * stepDepth / 2);
            const midY = (numSteps * stepHeight / 2);

            // 1. Enclosing Light Gray Concrete Walls
            const wallDepth = numSteps * stepDepth;
            const wallHeight = 7.0; // Reach ceiling
            const wallGeom = new THREE.BoxGeometry(0.4, wallHeight, wallDepth);
            
            const lWall = new THREE.Mesh(wallGeom, wallMat);
            lWall.position.set(-2.3, wallHeight/2, midZ);
            
            const rWall = new THREE.Mesh(wallGeom, wallMat);
            rWall.position.set(2.3, wallHeight/2, midZ);
            stairGroup.add(lWall, rWall);

            // 2. Stairs in the middle
            const stairWidth = 2.0;
            const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
            for (let i = 0; i < numSteps; i++) {
                const step = new THREE.Mesh(stairGeom, stepMat);
                step.position.set(
                    0.0, 
                    i * stepHeight + stepHeight/2, 
                    zDir * (i * stepDepth + stepDepth/2) 
                );
                stairGroup.add(step);
            }
            
            // 3. Double Escalators (with steps)
            const escWidth = 1.1;
            const escRampGeom = new THREE.BoxGeometry(escWidth, 0.1, rampLength);
            
            // Left escalator casing - lowered by 15cm so the steps stick out
            const escL = new THREE.Mesh(escRampGeom, escStepMat);
            escL.position.set(-1.55, midY - 0.15, midZ);
            escL.rotation.x = rotX;
            
            // Right escalator casing - lowered by 15cm so the steps stick out
            const escR = new THREE.Mesh(escRampGeom, escStepMat);
            escR.position.set(1.55, midY - 0.15, midZ);
            escR.rotation.x = rotX;
            
            stairGroup.add(escL, escR);

            // Left & Right escalator steps
            const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
            for (let i = 0; i < numSteps; i++) {
                // Left escalator step
                const stepL = new THREE.Mesh(escStepGeom, escStepMat);
                stepL.position.set(
                    -1.55,
                    i * stepHeight + stepHeight/2,
                    zDir * (i * stepDepth + stepDepth/2)
                );
                stairGroup.add(stepL);

                // Right escalator step
                const stepR = new THREE.Mesh(escStepGeom, escStepMat);
                stepR.position.set(
                    1.55,
                    i * stepHeight + stepHeight/2,
                    zDir * (i * stepDepth + stepDepth/2)
                );
                stairGroup.add(stepR);
            }
            
            // 4. Escalator Glass Balustrades
            const glassGeom = new THREE.BoxGeometry(0.05, 0.9, rampLength);
            
            const glassL1 = new THREE.Mesh(glassGeom, glassMat);
            glassL1.position.set(-2.05, midY + 0.45, midZ);
            glassL1.rotation.x = rotX;
            
            const glassL2 = new THREE.Mesh(glassGeom, glassMat);
            glassL2.position.set(-1.05, midY + 0.45, midZ);
            glassL2.rotation.x = rotX;
            
            const glassR1 = new THREE.Mesh(glassGeom, glassMat);
            glassR1.position.set(1.05, midY + 0.45, midZ);
            glassR1.rotation.x = rotX;
            
            const glassR2 = new THREE.Mesh(glassGeom, glassMat);
            glassR2.position.set(2.05, midY + 0.45, midZ);
            glassR2.rotation.x = rotX;
            
            stairGroup.add(glassL1, glassL2, glassR1, glassR2);
            
            // 5. Escalator Handrails
            const railGeom = new THREE.BoxGeometry(0.1, 0.1, rampLength);
            
            const railL1 = new THREE.Mesh(railGeom, handrailMat);
            railL1.position.set(-2.05, midY + 0.9, midZ);
            railL1.rotation.x = rotX;
            
            const railL2 = new THREE.Mesh(railGeom, handrailMat);
            railL2.position.set(-1.05, midY + 0.9, midZ);
            railL2.rotation.x = rotX;
            
            const railR1 = new THREE.Mesh(railGeom, handrailMat);
            railR1.position.set(1.05, midY + 0.9, midZ);
            railR1.rotation.x = rotX;
            
            const railR2 = new THREE.Mesh(railGeom, handrailMat);
            railR2.position.set(2.05, midY + 0.9, midZ);
            railR2.rotation.x = rotX;
            
            stairGroup.add(railL1, railL2, railR1, railR2);
            
            const s_start = station.position + zStart;
            const pos = this.sim.getTrackPosition(s_start);
            const tangent = this.sim.getTrackTangent(s_start);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());
            
            stairGroup.position.copy(localPos);
            stairGroup.position.y = 0.865;
            stairGroup.rotation.y = rotY;
            
            this.group.add(stairGroup);
        };
        
        // Create Canvas Texture for Glass Door
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = 'rgba(150, 180, 200, 0.4)';
        ctx.fillRect(0, 0, 512, 1024);
        
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 20;
        ctx.strokeRect(10, 10, 492, 1004);
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(56, 400, 400, 120);
        
        ctx.fillStyle = '#cc0000';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Zutritt nur', 256, 440);
        ctx.fillText('für Personal!', 256, 480);
        
        const doorTex = new THREE.CanvasTexture(canvas);
        const doorMat = new THREE.MeshBasicMaterial({ 
            map: doorTex, 
            transparent: true,
            side: THREE.DoubleSide
        });
        
        const doorGeom = new THREE.PlaneGeometry(this.doorWidth, 2.0);

        const placeTransverseWalls = (zStart, zDir, mat, platEdgeXVal) => {
            const twGroup = new THREE.Group();

            // Door's inner edge (towards the stairs); its outer edge sits flush on the platform edge.
            const doorInnerX = platEdgeXVal - this.doorWidth;
            // The big shader-cut wall must never reach past the stair envelope, so clamp its inner
            // edge outward if the door doesn't leave enough room.
            const bigWallInnerX = Math.max(doorInnerX, stairHalfWidth);
            // Plain filler wall exactly closing the gap between the stairs and the door's inner edge.
            const fillerWidth = Math.max(0, bigWallInnerX - stairHalfWidth);

            const tWallL = new THREE.Mesh(transWallGeom, mat);
            tWallL.position.set(-bigWallInnerX - transWallWidth/2, transWallHeight/2 + 0.865, 0); // 0 in twGroup is Z=45

            const tWallR = new THREE.Mesh(transWallGeom, mat);
            tWallR.position.set(bigWallInnerX + transWallWidth/2, transWallHeight/2 + 0.865, 0);

            const doorXCenter = platEdgeXVal - this.doorWidth / 2;
            const doorL = new THREE.Mesh(doorGeom, doorMat);
            doorL.position.set(-doorXCenter, 0.865 + 1.0, zDir * 0.05); // slight Z offset to prevent z-fighting

            const doorR = new THREE.Mesh(doorGeom, doorMat);
            doorR.position.set(doorXCenter, 0.865 + 1.0, zDir * 0.05);

            if (zDir === 1) {
                doorL.rotation.y = Math.PI;
                doorR.rotation.y = Math.PI;
            }

            twGroup.add(tWallL, tWallR, doorL, doorR);

            if (fillerWidth > 0) {
                const fillerGeom = new THREE.BoxGeometry(fillerWidth, transWallHeight, transWallDepth);
                const fillerCenterX = (stairHalfWidth + bigWallInnerX) / 2;
                const fillerL = new THREE.Mesh(fillerGeom, wallMat);
                fillerL.position.set(-fillerCenterX, transWallHeight/2 + 0.865, 0);
                const fillerR = new THREE.Mesh(fillerGeom, wallMat);
                fillerR.position.set(fillerCenterX, transWallHeight/2 + 0.865, 0);
                twGroup.add(fillerL, fillerR);
            }
            
            const s_start = station.position + zStart;
            const pos = this.sim.getTrackPosition(s_start);
            const tangent = this.sim.getTrackTangent(s_start);
            const rotY = Math.atan2(tangent.x, tangent.z) - this.centerAngle;
            const localPos = this.group.worldToLocal(pos.clone());
            
            twGroup.position.copy(localPos);
            twGroup.rotation.y = rotY;
            
            this.group.add(twGroup);
        };
        
        createStairsAndEscalator(-this.platLength / 2, -1);
        createStairsAndEscalator(this.platLength / 2, 1);

        placeTransverseWalls(-this.platLength / 2, -1, transWallMatNeg, platEdgeX_neg);
        placeTransverseWalls(this.platLength / 2, 1, transWallMatPos, platEdgeX_pos);
    }

    createStairTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Base stone-gray color
        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, 0, 128, 128);

        // Add some noise grain for stone texture
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            const diff = (Math.random() - 0.5) * 20;
            const val = Math.floor(100 + diff);
            ctx.fillStyle = `rgb(${val},${val},${val})`;
            ctx.globalAlpha = 0.08;
            ctx.fillRect(x, y, 1.5, 1.5);
        }
        ctx.globalAlpha = 1.0;

        // Front safety warning stripe (bright yellow) - made smaller/thinner (8px)
        ctx.fillStyle = '#eab308'; // Tailwind yellow-500
        ctx.fillRect(0, 0, 128, 8);

        // Dark anti-slip strip behind the warning stripe - made smaller/thinner (6px)
        ctx.fillStyle = '#1e293b'; // slate-800
        ctx.fillRect(0, 8, 128, 6);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createEscalatorStripeTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Draw thin stripes parallel to travel direction (V axis, i.e. vertical lines on canvas) - stripeWidth reduced to 2 for smaller texture
        const stripeWidth = 2;
        for (let x = 0; x < 64; x += stripeWidth) {
            ctx.fillStyle = (x % (stripeWidth * 2) === 0) ? '#475569' : '#94a3b8';
            ctx.fillRect(x, 0, stripeWidth, 64);
            
            // Add subtle 3D highlight and shadow for grooves
            ctx.fillStyle = '#334155';
            ctx.fillRect(x, 0, 1, 64);
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(x + stripeWidth - 1, 0, 1, 64);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createRoughConcreteMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Base color: light grey concrete (somewhat brighter)
        ctx.fillStyle = '#b0b0b0'; 
        ctx.fillRect(0, 0, 256, 256);
        
        // Add subtle organic patches for concrete texture
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const radius = 20 + Math.random() * 40;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
            const isDark = Math.random() > 0.5;
            const alpha = 0.05 + Math.random() * 0.08;
            grad.addColorStop(0, isDark ? `rgba(100,100,100,${alpha})` : `rgba(235,235,235,${alpha})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // High-frequency fine concrete grain noise
        const numGrains = 4000;
        for (let i = 0; i < numGrains; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1.0 + Math.random() * 1.5;
            
            const rand = Math.random();
            if (rand < 0.4) {
                ctx.fillStyle = '#8e8e8e'; // dark speckles
            } else if (rand < 0.8) {
                ctx.fillStyle = '#d2d2d2'; // light speckles
            } else {
                ctx.fillStyle = '#a0a0a0'; // mid speckles
            }
            
            ctx.globalAlpha = 0.12;
            ctx.fillRect(x, y, size, size);
        }
        ctx.globalAlpha = 1.0;
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        
        // Generate bump map canvas for rough surface
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 256;
        bumpCanvas.height = 256;
        const bCtx = bumpCanvas.getContext('2d');
        
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, 256, 256);
        
        bCtx.globalAlpha = 0.25;
        for (let i = 0; i < 3000; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1 + Math.random() * 2;
            bCtx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
            bCtx.fillRect(x, y, size, size);
        }
        bCtx.globalAlpha = 1.0;
        
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.ClampToEdgeWrapping;
        bumpTexture.wrapT = THREE.ClampToEdgeWrapping;
        bumpTexture.repeat.set(1, 1);
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.008
        });
    }

    buildPointLights() {}
    buildStandardDetails() {}
}

