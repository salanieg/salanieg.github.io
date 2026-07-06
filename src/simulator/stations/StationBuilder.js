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
                topColor: '#6FB464',
                topGrout: '#94a3b8',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Bärenschanze": {
                bottomColor: '#f8fafc',
                bottomGrout: '#94a3b8',
                topColor: '#1f799e',
                topGrout: '#94a3b8',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Gostenhof": {
                bottomColor: '#f8fafc',
                bottomGrout: '#94a3b8',
                topColor: '#e0bf04',
                topGrout: '#94a3b8',
                stripeBg: '#ffffff',
                stripeText: '#000000'
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

        // Transverse Walls at the ends
        const transWallDepth = 0.4;
        const transWallWidth = 10.0; // Wide enough to cover the outer main tube
        const isMaxStyle = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
        const transWallHeight = isMaxStyle ? 7.84 : 7.0;

        const transWallGeom = new THREE.BoxGeometry(transWallWidth, transWallHeight, transWallDepth);

        // For Rathaus/Lorenzkirche (bespoke, built entirely from this.platLength — a 5 m-
        // rounded value) the stairs must dock to that same rounded length. Every other,
        // "legacy" station's actual deck is a single continuous swept mesh built in
        // StationModel.buildStation spanning the true, UNROUNDED station.halfLength — so
        // anchoring stairs to this.platLength/2 there was off by up to ~2.5 m, leaving a
        // visible gap between the platform edge and the end wall/stairs.
        const endHalfLength = isRound ? (this.platLength / 2) : station.halfLength;

        const getEndAnchor = (zDir) => {
            const s = station.position + zDir * endHalfLength;
            const edgePos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
            const spacing = this.sim.getTrackSpacing(s);
            return { edgePos, rotY, spacing };
        };

        const anchorNeg = getEndAnchor(-1);
        const anchorPos = getEndAnchor(1);

        const trackX_neg = anchorNeg.spacing / 2;
        const trackX_pos = anchorPos.spacing / 2;
        const platEdgeX_neg = trackX_neg - 1.54;
        const platEdgeX_pos = trackX_pos - 1.54;

        // Calculate curvature for both ends of the station, anchored at the same point the
        // walls/stairs are placed at, so the cutout shape lines up with the actual geometry.
        const dummyNeg = new THREE.Object3D();
        dummyNeg.position.copy(centerPos);
        dummyNeg.rotation.y = centerAngle;
        dummyNeg.updateMatrixWorld();
        const localPos_neg = dummyNeg.worldToLocal(anchorNeg.edgePos.clone());
        let curvatureA_neg = localPos_neg.x / (localPos_neg.z * localPos_neg.z);
        if (isNaN(curvatureA_neg) || !isFinite(curvatureA_neg)) curvatureA_neg = 0;

        const dummyPos = new THREE.Object3D();
        dummyPos.position.copy(centerPos);
        dummyPos.rotation.y = centerAngle;
        dummyPos.updateMatrixWorld();
        const localPos_pos = dummyPos.worldToLocal(anchorPos.edgePos.clone());
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
                    
                    // Train Cutout (only on track side of platform edge). Rathaus/Lorenzkirche
                    // keep their round bespoke tunnel mouth; every other, generic station gets a
                    // flat-topped opening instead.
                    if (absX >= ${platEdgeXVal.toFixed(3)}) {
                        float dx = absX - uTrackX;
                        ${isRound ? `
                        float dy = localY - 1.4; // center of generous tunnel circle
                        if (dx*dx + dy*dy < 2.6*2.6 && localY > 1.4) discard;
                        if (abs(dx) < 2.6 && localY <= 1.4) discard;
                        ` : `
                        if (abs(dx) < 2.6 && localY < 4.0) discard;
                        `}
                    }

                    // Gate recess: the trackside wall mesh is 0.4m thick and would otherwise bury
                    // the barrier gate (which sits only 0.05m proud of it) entirely inside solid
                    // concrete. Cut the wall away across the gate's exact footprint so the gate is
                    // actually visible instead of hidden inside the wall.
                    //
                    // Root cause of the recurring "Lücke": this recess was left unbounded in
                    // height, while the train cutout right next to it (absX >= platEdgeXVal) is
                    // capped at a fixed height (the tunnel arch/flat lintel). Two regions sharing
                    // an edge but with different height caps produces a vertical step exactly at
                    // that shared edge — solid wall floating above the cap on one side, open sky
                    // on the other. No amount of moving *where* that edge sits fixes it, since the
                    // step just relocates with it; the caps themselves have to match. So the gate
                    // recess is now capped at the exact same height the train cutout reaches at
                    // that boundary (x = platEdgeXVal), for both the round arch and the flat top.
                    float gateX1 = ${platEdgeXVal.toFixed(3)} - ${this.doorWidth.toFixed(3)};
                    float gateX2 = ${platEdgeXVal.toFixed(3)};
                    float gateCapY = ${(isRound ? (1.4 + Math.sqrt(2.6 * 2.6 - 1.54 * 1.54)) : 4.0).toFixed(3)};
                    if (absX > gateX1 && absX < gateX2 && localY > 0.80 && localY < gateCapY) discard;
                    `
                );
            };

            mat.customProgramCacheKey = () => {
                return station.name + isRound.toString() + trackXVal.toString() + endKey;
            };
        };

        compileTransWallMaterial(transWallMatNeg, curvatureA_neg, "Neg", trackX_neg, platEdgeX_neg);
        compileTransWallMaterial(transWallMatPos, curvatureA_pos, "Pos", trackX_pos, platEdgeX_pos);

        // Stair enclosure wall geometry: identical for both platform ends (no zDir/anchor
        // dependence), so build + UV-fix it once here instead of once per end inside
        // createStairsAndEscalator below.
        const numSteps = isMaxStyle ? 33 : 28;
        const stairWallDepth = numSteps * 0.3; // numSteps * stepDepth
        const stairWallHeight = isMaxStyle ? 7.84 : 7.0; // Reach ceiling
        // The transverse (end) wall is 0.4m thick, centered on this same anchor (Z=0), so it
        // extends transWallDepth/2 past Z=0 towards the platform. The stair enclosure wall used
        // to stop exactly at Z=0 (the transverse wall's centre), only overlapping half its
        // thickness — leaving a half-thickness step where the two should be flush. Extend the
        // enclosure wall past Z=0 by that same half-thickness so it fully spans through to the
        // transverse wall's far face.
        const stairWallOverlap = transWallDepth / 2;
        const stairWallGeom = new THREE.BoxGeometry(0.4, stairWallHeight, stairWallDepth + stairWallOverlap);
        // BoxGeometry lays its 24 UV-mapped vertices out per face in a fixed order: px(0-3),
        // nx(4-7), py(8-11), ny(12-15), pz(16-19), nz(20-23).
        const stairWallUv = stairWallGeom.attributes.uv;
        // ±X faces (px/nx, indices 0-7): the wall's visible long sides, height x depth. U maps to
        // depth/Z here, so rescale it to match the original stairWallDepth's texel density instead
        // of the concrete grain looking very slightly zoomed on the lengthened wall.
        const stairWallUScale = (stairWallDepth + stairWallOverlap) / stairWallDepth;
        for (let i = 0; i < 8; i++) stairWallUv.setX(i, stairWallUv.getX(i) * stairWallUScale);
        // ±Z faces (pz/nz, indices 16-23): the thin end caps, width x height — one of which now
        // faces the platform since the wall was extended flush against the transverse wall. U maps
        // to width (only 0.4m) here; left at the default 0..1 range it stretches a full square
        // texture across a razor-thin face, looking badly squished. Shrink U to match the real
        // width/height aspect ratio so the grain size matches the surrounding walls.
        const stairWallCapUScale = 0.4 / stairWallHeight;
        for (let i = 16; i < 24; i++) stairWallUv.setX(i, stairWallUv.getX(i) * stairWallCapUScale);
        stairWallUv.needsUpdate = true;

        const createStairsAndEscalator = (zDir, anchor) => {
            const stairGroup = new THREE.Group();

            const stepDepth = 0.3;
            const stepHeight = 0.16;
            // numSteps is closed over from the outer scope to keep walls and steps in sync

            const rampLength = Math.sqrt(Math.pow(numSteps * stepDepth, 2) + Math.pow(numSteps * stepHeight, 2));
            const rampAngle = Math.atan2(numSteps * stepHeight, numSteps * stepDepth);
            const rotX = -zDir * rampAngle;

            const midZ = zDir * (numSteps * stepDepth / 2);
            const midY = (numSteps * stepHeight / 2);

            // 1. Enclosing Light Gray Concrete Walls (geometry built once above; only its
            // per-end Z position depends on zDir)
            const wallMidZ = midZ - zDir * stairWallOverlap / 2;

            const lWall = new THREE.Mesh(stairWallGeom, wallMat);
            lWall.position.set(-2.3, stairWallHeight/2, wallMidZ);

            const rWall = new THREE.Mesh(stairWallGeom, wallMat);
            rWall.position.set(2.3, stairWallHeight/2, wallMidZ);
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

            const localPos = this.group.worldToLocal(anchor.edgePos.clone());

            stairGroup.position.copy(localPos);
            stairGroup.position.y = 0.865;
            stairGroup.rotation.y = anchor.rotY;

            this.group.add(stairGroup);
        };
        
        // "Durchgang verboten" plaque mounted on the gate barrier (see createGateInstance below).
        const plaqueTex = this.createDurchgangVerbotenTexture();
        const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex, side: THREE.DoubleSide });
        const plaqueGeom = new THREE.PlaneGeometry(0.5, 0.5);

        // Barrier gate: 80cm wide x 80cm tall railing with a mid-height crossbar and a second
        // one along the top, replacing the old glass door in the wall opening.
        const gateHeight = 0.8;
        const postThickness = 0.05;
        const postGeom = new THREE.BoxGeometry(postThickness, gateHeight, postThickness);
        const crossbarGeom = new THREE.BoxGeometry(this.doorWidth, 0.06, postThickness);
        const gateMat = new THREE.MeshStandardMaterial({ color: '#3f4448', metalness: 0.6, roughness: 0.4 });

        const createGateInstance = () => {
            const gateGroup = new THREE.Group();

            const postL = new THREE.Mesh(postGeom, gateMat);
            postL.position.set(-this.doorWidth / 2 + postThickness / 2, gateHeight / 2, 0);
            const postR = new THREE.Mesh(postGeom, gateMat);
            postR.position.set(this.doorWidth / 2 - postThickness / 2, gateHeight / 2, 0);

            const crossbarMid = new THREE.Mesh(crossbarGeom, gateMat);
            crossbarMid.position.set(0, gateHeight / 2, 0);

            const crossbarTop = new THREE.Mesh(crossbarGeom, gateMat);
            crossbarTop.position.set(0, gateHeight - 0.03, 0);

            const plaque = new THREE.Mesh(plaqueGeom, plaqueMat);
            plaque.position.set(0, gateHeight / 2, postThickness / 2 + 0.02);

            gateGroup.add(postL, postR, crossbarMid, crossbarTop, plaque);
            return gateGroup;
        };

        // U-Bahn signal: 3 stacked lamps on a wall-mounted bracket arm. The lamp facing the
        // direction of travel (i.e. the side a train actually approaches the platform from at
        // that end) shows green on top; the other side shows red on the bottom lamp instead, each
        // with a matching glow halo. Every lamp is shaded by a small visor hood.
        const signalLampRadius = 0.06;
        const signalLampSpacing = 0.18;
        const signalArmLength = 0.15;
        const signalArmGeom = new THREE.BoxGeometry(0.08, 0.08, signalArmLength);
        const signalBackGeom = new THREE.BoxGeometry(0.2, signalLampSpacing * 2 + 0.24, 0.06);
        const signalBackMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 });
        const signalLampGeom = new THREE.SphereGeometry(signalLampRadius, 12, 8);
        const signalOffMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a' });
        const signalGreenMat = new THREE.MeshStandardMaterial({ color: '#0aff5a', emissive: '#0aff5a', emissiveIntensity: 1.8 });
        const signalRedMat = new THREE.MeshStandardMaterial({ color: '#ff2020', emissive: '#ff2020', emissiveIntensity: 1.8 });
        const signalVisorGeom = new THREE.BoxGeometry(0.18, 0.02, 0.12);
        const signalGlowGeom = new THREE.SphereGeometry(signalLampRadius * 2.4, 12, 8);
        const signalGlowMatGreen = new THREE.MeshBasicMaterial({ color: '#0aff5a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
        const signalGlowMatRed = new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });

        // zDir is baked in directly (rather than relying on a 180° group flip like the gate does)
        // so the mounting arm reliably extends the same way on both ends. mountDir = -zDir points
        // back towards the platform side of the wall (zDir itself points away from the platform,
        // into the tunnel — mounting the fixture that way made it hang facing away from the
        // platform, on the wrong face of the wall). The arm starts flush on the wall's actual
        // platform-facing surface (transWallDepth/2 from centre) instead of the wall's centre
        // line, so the fixture isn't half-buried inside the solid wall.
        const createSignalInstance = (zDir, isGreen) => {
            const mountDir = -zDir;
            const wallFaceZ = mountDir * (transWallDepth / 2);
            const sigGroup = new THREE.Group();

            // Mounting arm: bolts the signal box to the wall face instead of leaving it floating.
            const arm = new THREE.Mesh(signalArmGeom, signalBackMat);
            arm.position.set(0, 0, wallFaceZ + mountDir * signalArmLength / 2);
            sigGroup.add(arm);

            const boxZ = wallFaceZ + mountDir * signalArmLength;
            const back = new THREE.Mesh(signalBackGeom, signalBackMat);
            back.position.set(0, 0, boxZ);
            sigGroup.add(back);

            const litIndex = isGreen ? 0 : 2; // top lamp for green (direction of travel), bottom for red
            const litMat = isGreen ? signalGreenMat : signalRedMat;
            const glowMat = isGreen ? signalGlowMatGreen : signalGlowMatRed;

            for (let i = 0; i < 3; i++) {
                const y = (1 - i) * signalLampSpacing; // i=0 is the top lamp
                const lampMat = i === litIndex ? litMat : signalOffMat;
                const lamp = new THREE.Mesh(signalLampGeom, lampMat);
                lamp.position.set(0, y, boxZ + mountDir * 0.04);
                sigGroup.add(lamp);

                const visor = new THREE.Mesh(signalVisorGeom, signalBackMat);
                visor.position.set(0, y + signalLampRadius + 0.01, boxZ + mountDir * 0.07);
                sigGroup.add(visor);

                if (i === litIndex) {
                    const glow = new THREE.Mesh(signalGlowGeom, glowMat);
                    glow.position.set(0, y, boxZ + mountDir * 0.04);
                    sigGroup.add(glow);
                }
            }

            return sigGroup;
        };

        // Outer face of the stair enclosure's own side wall (centered at x=±2.3, 0.4m thick —
        // see lWall/rWall in createStairsAndEscalator), i.e. the point the filler wall below
        // must butt flush against.
        const stairWallOuterX = 2.3 + 0.2;

        const placeTransverseWalls = (zDir, mat, platEdgeXVal, anchor) => {
            const twGroup = new THREE.Group();

            // Gate stays exactly where it was: outer edge flush on the platform edge. The
            // trackside wall and the filler both butt against the gate's escalator-side strut
            // (doorInnerX) — the gate itself sits strictly between doorInnerX and platEdgeXVal,
            // never overlapped by either wall piece.
            const doorInnerX = platEdgeXVal - this.doorWidth;

            const tWallL = new THREE.Mesh(transWallGeom, mat);
            tWallL.position.set(-doorInnerX - transWallWidth/2, transWallHeight/2 + 0.865, 0); // 0 in twGroup is Z=45

            const tWallR = new THREE.Mesh(transWallGeom, mat);
            tWallR.position.set(doorInnerX + transWallWidth/2, transWallHeight/2 + 0.865, 0);

            const doorXCenter = platEdgeXVal - this.doorWidth / 2;
            const gateL = createGateInstance();
            gateL.position.set(-doorXCenter, 0.865, zDir * 0.05); // slight Z offset to prevent z-fighting

            const gateR = createGateInstance();
            gateR.position.set(doorXCenter, 0.865, zDir * 0.05);

            if (zDir === 1) {
                gateL.rotation.y = Math.PI;
                gateR.rotation.y = Math.PI;
            }

            // U-Bahn signal, 1.7m above the gate's top edge (gate top = 0.865 + gateHeight 0.8),
            // wall-mounted at the portal wall's edge (the trackside wall's inner boundary,
            // doorInnerX — solid filler wall sits right behind it there, unlike further out at
            // platEdgeXVal where the wall is cut away for the train/gate openings).
            //
            // Which side shows green depends on which end this is: getTrackXOffset() puts a
            // forward-travelling (non-reversing) train on the +X side and a reversing train on
            // -X, so a train ARRIVING at the "Neg" end (zDir=-1) is travelling forward (+X, right
            // side green), while a train arriving at the "Pos" end (zDir=1) is reversing (-X,
            // left side green). The other side shows red on the bottom lamp instead.
            const signalY = 0.865 + gateHeight + 1.7;
            const isGreenR = zDir === -1;
            const signalL = createSignalInstance(zDir, !isGreenR);
            signalL.position.set(-doorInnerX, signalY, 0);
            const signalR = createSignalInstance(zDir, isGreenR);
            signalR.position.set(doorInnerX, signalY, 0);

            twGroup.add(tWallL, tWallR, gateL, gateR, signalL, signalR);

            // Flush filler wall between the stair enclosure's outer wall face and the gate's
            // escalator-side strut — closes exactly that gap, never touching the gate itself.
            const fillerWidth = Math.max(0, doorInnerX - stairWallOuterX);
            if (fillerWidth > 0) {
                const fillerGeom = new THREE.BoxGeometry(fillerWidth, transWallHeight, transWallDepth);
                // Rescale U so the texel density matches transWallGeom's fixed-width texture
                // instead of stretching the same canvas over a station-dependent width.
                const uv = fillerGeom.attributes.uv;
                const uScale = fillerWidth / transWallWidth;
                for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uScale);
                uv.needsUpdate = true;
                const fillerCenterX = (stairWallOuterX + doorInnerX) / 2;
                const fillerL = new THREE.Mesh(fillerGeom, wallMat);
                fillerL.position.set(-fillerCenterX, transWallHeight/2 + 0.865, 0);
                const fillerR = new THREE.Mesh(fillerGeom, wallMat);
                fillerR.position.set(fillerCenterX, transWallHeight/2 + 0.865, 0);
                twGroup.add(fillerL, fillerR);
            }

            const localPos = this.group.worldToLocal(anchor.edgePos.clone());

            twGroup.position.copy(localPos);
            twGroup.rotation.y = anchor.rotY;

            this.group.add(twGroup);
        };

        createStairsAndEscalator(-1, anchorNeg);
        createStairsAndEscalator(1, anchorPos);

        placeTransverseWalls(-1, transWallMatNeg, platEdgeX_neg, anchorNeg);
        placeTransverseWalls(1, transWallMatPos, platEdgeX_pos, anchorPos);
    }

    createDurchgangVerbotenTexture() {
        // 50x50cm square plaque: the "Verbot der Einfahrt" no-entry sign (red circle, white
        // horizontal bar) with a black pedestrian silhouette standing in front of it, and
        // "Durchgang verboten" underneath.
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Plaque background
        ctx.fillStyle = '#f4f4f5';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = '#222222';
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, 502, 502);

        // No-entry sign: red circle, white ring, white horizontal bar
        const signCx = 256, signCy = 150, signR = 130;
        ctx.fillStyle = '#c8102e';
        ctx.beginPath();
        ctx.arc(signCx, signCy, signR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(signCx, signCy, signR - 10, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(signCx - 90, signCy - 26, 180, 52);

        // Black human silhouette standing in front of the sign
        ctx.fillStyle = '#000000';
        const hx = 256, hy = 230;
        // head
        ctx.beginPath();
        ctx.arc(hx, hy - 60, 28, 0, Math.PI * 2);
        ctx.fill();
        // body
        ctx.beginPath();
        ctx.moveTo(hx - 34, hy + 20);
        ctx.lineTo(hx - 22, hy - 30);
        ctx.lineTo(hx + 22, hy - 30);
        ctx.lineTo(hx + 34, hy + 20);
        ctx.closePath();
        ctx.fill();
        // arms
        ctx.beginPath();
        ctx.moveTo(hx - 22, hy - 25);
        ctx.lineTo(hx - 46, hy + 10);
        ctx.lineTo(hx - 36, hy + 16);
        ctx.lineTo(hx - 14, hy - 15);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(hx + 22, hy - 25);
        ctx.lineTo(hx + 46, hy + 10);
        ctx.lineTo(hx + 36, hy + 16);
        ctx.lineTo(hx + 14, hy - 15);
        ctx.closePath();
        ctx.fill();
        // legs
        ctx.beginPath();
        ctx.moveTo(hx - 20, hy + 20);
        ctx.lineTo(hx - 30, hy + 90);
        ctx.lineTo(hx - 10, hy + 90);
        ctx.lineTo(hx - 4, hy + 20);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(hx + 20, hy + 20);
        ctx.lineTo(hx + 30, hy + 90);
        ctx.lineTo(hx + 10, hy + 90);
        ctx.lineTo(hx + 4, hy + 20);
        ctx.closePath();
        ctx.fill();

        // Text
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 46px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Durchgang', 256, 400);
        ctx.fillText('verboten', 256, 452);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
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

