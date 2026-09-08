// ============================================================================
// StationBuilder.js — Basisklasse für Stations-Sonderarchitektur. Der generische
// Stationsbau lebt in StationModel.buildStation; diese Klasse liefert das
// Template-Method-Gerüst (build() ruft setupMaterials/buildSegment*/
// buildPillars/... auf), das Rathaus-/LorenzkircheBuilder überschreiben.
//
// KI-LANDKARTE:
//   - Neue Sonderstation: Subklasse anlegen (Muster: RathausBuilder), in
//     StationModel.buildStation den Namens-Dispatch ergänzen.
//   - Treppen/Rolltreppen inkl. GPU-Stufenanimation: buildStairs +
//     setupEscalatorMaterial (Vertex-Shader-Injektion unten) — die Uniform
//     uEscalatorTime wird über den gepatchten StationModel.tick getrieben.
//   - Gemeinsame Texturen: createStairTexture/createRoughConcreteMaterial/
//     createDurchgangVerbotenTexture/createEscalatorStripeTexture.
// ============================================================================
import * as THREE from 'three';

/**
 * Shared logic for GPU-accelerated escalator animation.
 * Moves the periodic step movement from CPU matrix updates to a Vertex Shader.
 */
const ESCALATOR_SHADER_INJECTION = {
    uniforms: {
        uEscalatorTime: { value: 0 }
    },
    vertexShader: {
        header: `
            attribute vec3 aEscalatorDir;
            uniform float uEscalatorTime;
        `,
        main: `
            // The fractional part of time creates the periodic jump: once a step has
            // moved exactly one unit, it jumps back to its start, but since all
            // steps are identical, the belt appears to move continuously.
            float progress = fract(uEscalatorTime);

            // Invert progress if the direction vector is negative (DOWN instead of UP)
            // We use the length of the vector to detect direction sign.
            if (length(aEscalatorDir) > 0.0) {
                 transformed += aEscalatorDir * progress;
            }
        `
    }
};

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
                bottomGrout: '#777A8B',
                topColor: '#6FB464',
                topGrout: '#777A8B',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Bärenschanze": {
                bottomColor: '#f8fafc',
                bottomGrout: '#777A8B',
                topColor: '#396296',
                topGrout: '#777A8B',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Gostenhof": {
                bottomColor: '#f8fafc',
                bottomGrout: '#777A8B',
                topColor: '#BA7C00',
                topGrout: '#777A8B',
                stripeBg: '#ffffff',
                stripeText: '#000000'
            },
            "Langwasser Süd": {
                bottomColor: '#41525a',
                bottomGrout: '#777A8B',
                topColor: '#acb6bf',
                topGrout: '#777A8B',
                stripeBg: '#184763',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Gemeinschaftshaus": {
                bottomColor: '#41525a',
                bottomGrout: '#777A8B',
                topColor: '#acb6bf',
                topGrout: '#777A8B',
                stripeBg: '#41525a',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Langwasser Mitte": {
                bottomColor: '#41525a',
                bottomGrout: '#777A8B',
                topColor: '#acb6bf',
                topGrout: '#777A8B',
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

        // Spawn passengers
        this.model.spawnPassengersForStation(this.station, this.group);

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
    buildBenches() {
        this.model.addBenchesToStation(this.station, this.group, 1.0, this.platLength, this.platTopY, this.centerAngle);
    }
    buildSignsAndBoards() {}
    buildStairs() {
        if (this.station.type !== 'underground' && this.station.name !== 'Messe') return;

        const station = this.station;
        const group = this.group;
        const centerPos = this.centerPos;
        const centerAngle = this.centerAngle;

        const isRound = (station.name === "Rathaus" || station.name === "Lorenzkirche");

        const wallMat = this.createRoughConcreteMaterial();
        wallMat.side = THREE.DoubleSide;

        const stairTex = this.createStairTexture();
        const stepMat = new THREE.MeshLambertMaterial({ map: stairTex });

        const escStripeTex = this.createEscalatorStripeTexture();
        const escStepMat = new THREE.MeshLambertMaterial({ map: escStripeTex });

        const handrailMat = new THREE.MeshBasicMaterial({ color: '#111111' });
        const glassMat = new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.6 });

        // Light-grey balustrade sides with a subtle horizontal lighter gradient
        const edelstahlMat = StationBuilder.createBalustradeMaterial();
        const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffe0', side: THREE.DoubleSide });

        const createEscalatorGeometries = (rampLength, thickness, height, railWidth, railHeight) => {
            const r = height / 2;
            const halfW = rampLength / 2;

            // 1. Balustrade Shape (extended straight part to full rampLength)
            const balShape = new THREE.Shape();
            balShape.moveTo(-halfW, -r);
            balShape.lineTo(halfW, -r);
            balShape.absarc(halfW, 0, r, -Math.PI / 2, Math.PI / 2, false);
            balShape.lineTo(-halfW, r);
            balShape.absarc(-halfW, 0, r, Math.PI / 2, 3 * Math.PI / 2, false);

            const balExtrudeSettings = {
                depth: thickness,
                bevelEnabled: false,
                steps: 1
            };
            const balustradeGeom = new THREE.ExtrudeGeometry(balShape, balExtrudeSettings);
            balustradeGeom.translate(0, 0, -thickness / 2);
            balustradeGeom.rotateY(Math.PI / 2);

            // 2. Handrail Shape with Hole (extended straight part to full rampLength)
            const railShape = new THREE.Shape();
            const t = railHeight;
            // Outer boundary (CCW)
            railShape.moveTo(-halfW, -r - t);
            railShape.lineTo(halfW, -r - t);
            railShape.absarc(halfW, 0, r + t, -Math.PI / 2, Math.PI / 2, false);
            railShape.lineTo(-halfW, r + t);
            railShape.absarc(-halfW, 0, r + t, Math.PI / 2, 3 * Math.PI / 2, false);

            // Inner boundary / Hole (CW)
            const holePath = new THREE.Path();
            holePath.moveTo(-halfW, r);
            holePath.lineTo(halfW, r);
            holePath.absarc(halfW, 0, r, Math.PI / 2, -Math.PI / 2, true);
            holePath.lineTo(-halfW, -r);
            holePath.absarc(-halfW, 0, r, -Math.PI / 2, Math.PI / 2, true);

            railShape.holes.push(holePath);

            const railExtrudeSettings = {
                depth: railWidth,
                bevelEnabled: false,
                steps: 1
            };
            const handrailGeom = new THREE.ExtrudeGeometry(railShape, railExtrudeSettings);
            handrailGeom.translate(0, 0, -railWidth / 2);
            handrailGeom.rotateY(Math.PI / 2);

            // 3. 2D Pill Lamp Geometry (Flat Shape in Z-Y plane)
            const L_lamp = 0.27;
            const H_lamp = 0.09;
            const rl = H_lamp / 2;
            const hw = L_lamp / 2;
            
            const lampShape = new THREE.Shape();
            lampShape.moveTo(-hw + rl, -rl);
            lampShape.lineTo(hw - rl, -rl);
            lampShape.absarc(hw - rl, 0, rl, -Math.PI / 2, Math.PI / 2, false);
            lampShape.lineTo(-hw + rl, rl);
            lampShape.absarc(-hw + rl, 0, rl, Math.PI / 2, 3 * Math.PI / 2, false);

            const lampGeom = new THREE.ShapeGeometry(lampShape);
            lampGeom.rotateY(Math.PI / 2); // Rotate to lie in Z-Y plane

            return { balustradeGeom, handrailGeom, lampGeom };
        };

        this.doorWidth = 0.8; // "Zutritt nur für Personal" doors, outer edge flush with the platform edge

        // Transverse Walls at the ends
        const transWallDepth = 0.4;
        const transWallWidth = 10.0; // Wide enough to cover the outer main tube
        const isMaxStyle = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
        const baseHeight = (station.name === "Rathenauplatz") ? 9.185 : (isMaxStyle ? 7.84 : 7.0);
        const transWallHeight = (station.name === "Rathenauplatz") ? 10.38 : (isRound ? baseHeight : (baseHeight + 1.195));

        const transWallGeom = new THREE.BoxGeometry(transWallWidth, transWallHeight, transWallDepth);

        // For Rathaus/Lorenzkirche (bespoke, built entirely from this.platLength — a 5 m-
        // rounded value) the stairs must dock to that same rounded length. Every other,
        // "legacy" station's actual deck is a single continuous swept mesh built in
        // StationModel.buildStation spanning the true, UNROUNDED station.halfLength — so
        // anchoring stairs to this.platLength/2 there was off by up to ~2.5 m, leaving a
        // visible gap between the platform edge and the end wall/stairs.
        const endHalfLength = (station.name === "Messe") ? 6.6 : (isRound ? (this.platLength / 2) : station.halfLength);

        const getEndAnchor = (zDir) => {
            const offset = (station.name === "Messe") ? (zDir === -1 ? 0.0 : 40.0) : (zDir * endHalfLength);
            const s = station.position + offset;
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
                        if (dx < 1.83 && localY < 4.0) discard;
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
        const stairWallHeight = (station.name === "Rathenauplatz") ? 10.38 : (isMaxStyle ? 7.84 : 7.0); // Reach ceiling
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

            // Extend the escalator physically by 2 steps at each end to bury the loop-around
            const numVisibleSteps = numSteps;
            const numTotalSteps = numVisibleSteps + 4;

            const rampLength = Math.sqrt(Math.pow(numVisibleSteps * stepDepth, 2) + Math.pow(numVisibleSteps * stepHeight, 2));
            const rampAngle = Math.atan2(numVisibleSteps * stepHeight, numVisibleSteps * stepDepth);
            const rotX = -zDir * rampAngle;

            const midZ = zDir * (numVisibleSteps * stepDepth / 2);
            const midY = (numVisibleSteps * stepHeight / 2);

            // 1. Enclosing Light Gray Concrete Walls (geometry built once above; only its
            // per-end Z position depends on zDir)
            const wallMidZ = midZ - zDir * stairWallOverlap / 2;

            if (this.station.name !== "Messe") {
                const lWall = new THREE.Mesh(stairWallGeom, wallMat);
                lWall.position.set(-2.3, stairWallHeight/2, wallMidZ);

                const rWall = new THREE.Mesh(stairWallGeom, wallMat);
                rWall.position.set(2.3, stairWallHeight/2, wallMidZ);
                stairGroup.add(lWall, rWall);

                // Roof/Ceiling over the inclined stairwell shaft: closes the upper void above the escalators
                const shaftCeilGeom = new THREE.BoxGeometry(5.0, 0.4, stairWallDepth + stairWallOverlap);
                const shaftCeil = new THREE.Mesh(shaftCeilGeom, wallMat);
                shaftCeil.position.set(0, stairWallHeight + 0.2, wallMidZ);
                stairGroup.add(shaftCeil);

                // Shaft neon light fixtures mounted under the shaft ceiling in a strictly regular 2.4m sequence
                const lampPitch = 2.4;
                for (let d = 2.0; d < stairWallDepth - 0.5; d += lampPitch) {
                    const fixture = this.createNeonFixture(1.8, 'z');
                    fixture.position.set(0, stairWallHeight - 0.02, zDir * d);
                    stairGroup.add(fixture);
                }
            }

            // 2. Stairs in the middle + escalator steps as TWO InstancedMeshes instead of
            // 3*numSteps (~95) individual meshes. Frustum culling stays ON: three r160
            // auto-computes the instance-aware bounding sphere on first cull.
            const stairWidth = 2.0;
            const stairGeom = new THREE.BoxGeometry(stairWidth, stepHeight, stepDepth);
            const escWidth = 1.0; // Narrowed from 1.1 to 1.0 to fit inside balustrades
            const escStepGeom = new THREE.BoxGeometry(escWidth, stepHeight, stepDepth);
            const stairInst = new THREE.InstancedMesh(stairGeom, stepMat, numVisibleSteps);
            const escInst = new THREE.InstancedMesh(escStepGeom, escStepMat, 2 * numTotalSteps);

            // GPU Animation: Add direction attribute to escalator steps
            const dirAttr = new Float32Array(2 * numTotalSteps * 3);
            for (let i = 0; i < numTotalSteps; i++) {
                // Left lane: UP (perInstanceDir[0] = 1) -> vector is (0, stepHeight, zDir * stepDepth)
                dirAttr[(2 * i) * 3 + 0] = 0;
                dirAttr[(2 * i) * 3 + 1] = stepHeight;
                dirAttr[(2 * i) * 3 + 2] = zDir * stepDepth;

                // Right lane: DOWN (perInstanceDir[1] = -1) -> vector is (0, -stepHeight, -zDir * stepDepth)
                dirAttr[(2 * i + 1) * 3 + 0] = 0;
                dirAttr[(2 * i + 1) * 3 + 1] = -stepHeight;
                dirAttr[(2 * i + 1) * 3 + 2] = -zDir * stepDepth;
            }
            escStepGeom.setAttribute('aEscalatorDir', new THREE.InstancedBufferAttribute(dirAttr, 3));
            StationBuilder.setupEscalatorMaterial(escStepMat, this.model);

            const stepMatrix = new THREE.Matrix4();
            for (let i = 0; i < numVisibleSteps; i++) {
                const sy = i * stepHeight + stepHeight / 2;
                const sz = zDir * (i * stepDepth + stepDepth / 2);
                stairInst.setMatrixAt(i, stepMatrix.makeTranslation(0, sy, sz));
            }
            // Escalator steps: start 2 steps earlier (-2) and end 2 steps later (numVisibleSteps + 2)
            for (let i = 0; i < numTotalSteps; i++) {
                const stepIdx = i - 2;
                const sy = stepIdx * stepHeight + stepHeight / 2;
                const sz = zDir * (stepIdx * stepDepth + stepDepth / 2);
                escInst.setMatrixAt(2 * i, stepMatrix.makeTranslation(-1.55, sy, sz));
                escInst.setMatrixAt(2 * i + 1, stepMatrix.makeTranslation(1.55, sy, sz));
            }
            stairInst.instanceMatrix.needsUpdate = true;
            escInst.instanceMatrix.needsUpdate = true;
            stairGroup.add(stairInst, escInst);

            // GPU Animation: Mark as escalator for proximity-based sound
            escInst.userData.isEscalator = true;

            // Registering with the model is no longer needed for animation as it's now handled by the shader.
            // We still register it if we want to keep track of all escalators for other purposes.
            this.model.registerEscalator(escInst, { numTotalSteps });

            // Ensure instances are not culled when their origin is off-screen
            escInst.computeBoundingSphere();
            if (escInst.boundingSphere) escInst.boundingSphere.radius *= 5;

            // 3. Double Escalators (ramp casings under the steps)
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
            
            // 4. Escalator Stainless Steel Balustrades
            const thickness = 0.05;
            const height = 0.9;
            const railWidth = 0.1;
            const railHeight = 0.1;
            const { balustradeGeom, handrailGeom, lampGeom } = createEscalatorGeometries(rampLength, thickness, height, railWidth, railHeight);
            
            const glassL1 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassL1.position.set(-2.05, midY + 0.45, midZ);
            glassL1.rotation.x = rotX;
            
            const glassL2 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassL2.position.set(-1.05, midY + 0.45, midZ);
            glassL2.rotation.x = rotX;
            
            const glassR1 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassR1.position.set(1.05, midY + 0.45, midZ);
            glassR1.rotation.x = rotX;
            
            const glassR2 = new THREE.Mesh(balustradeGeom, edelstahlMat);
            glassR2.position.set(2.05, midY + 0.45, midZ);
            glassR2.rotation.x = rotX;
            
            // Add pill-shaped lamps to the inside of the balustrades
            const addLamps = (mesh, dirX) => {
                const r = height / 2;
                const halfW = rampLength / 2;
                for (let z = -halfW + 1.0; z <= halfW - 1.0; z += 1.5) {
                    const lamp = new THREE.Mesh(lampGeom, lampMat);
                    lamp.position.set(dirX * (thickness / 2 + 0.001), 0.3 - r, z);
                    mesh.add(lamp);
                }
            };
            addLamps(glassL1, 1);
            addLamps(glassL2, -1);
            addLamps(glassR1, 1);
            addLamps(glassR2, -1);
            
            stairGroup.add(glassL1, glassL2, glassR1, glassR2);
            
            // 5. Escalator Handrails (Closed loops, positioned at the same Y center as balustrades)
            const railL1 = new THREE.Mesh(handrailGeom, handrailMat);
            railL1.position.set(-2.05, midY + 0.45, midZ);
            railL1.rotation.x = rotX;
            
            const railL2 = new THREE.Mesh(handrailGeom, handrailMat);
            railL2.position.set(-1.05, midY + 0.45, midZ);
            railL2.rotation.x = rotX;
            
            const railR1 = new THREE.Mesh(handrailGeom, handrailMat);
            railR1.position.set(1.05, midY + 0.45, midZ);
            railR1.rotation.x = rotX;
            
            const railR2 = new THREE.Mesh(handrailGeom, handrailMat);
            railR2.position.set(2.05, midY + 0.45, midZ);
            railR2.rotation.x = rotX;
            
            stairGroup.add(railL1, railL2, railR1, railR2);

            // Upper mezzanine corridor / distribution hall at top of stairs & escalators:
            if (this.station.name !== "Messe") {
                this.buildUpperMezzanine(stairGroup, zDir, numSteps, stepDepth, stepHeight, stairWallHeight, stairWallDepth, wallMat, stepMat);
            }

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
        const gateMat = new THREE.MeshLambertMaterial({ color: '#3f4448' });

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
        const signalBackMat = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
        const signalLampGeom = new THREE.SphereGeometry(signalLampRadius, 12, 8);
        const signalOffMat = new THREE.MeshLambertMaterial({ color: '#2a2a2a' });
        const signalGreenMat = new THREE.MeshLambertMaterial({ color: '#0aff5a', emissive: '#0aff5a', emissiveIntensity: 1.8 });
        const signalRedMat = new THREE.MeshLambertMaterial({ color: '#ff2020', emissive: '#ff2020', emissiveIntensity: 1.8 });
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

            const transWallY = isRound ? (transWallHeight / 2 + 0.865) : (baseHeight / 2 - 0.5975);

            const tWallL = new THREE.Mesh(transWallGeom, mat);
            tWallL.position.set(-doorInnerX - transWallWidth/2, transWallY, 0); // 0 in twGroup is Z=45

            const tWallR = new THREE.Mesh(transWallGeom, mat);
            tWallR.position.set(doorInnerX + transWallWidth/2, transWallY, 0);

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
                fillerL.position.set(-fillerCenterX, transWallY, 0);
                const fillerR = new THREE.Mesh(fillerGeom, wallMat);
                fillerR.position.set(fillerCenterX, transWallY, 0);
                twGroup.add(fillerL, fillerR);
            }

            const localPos = this.group.worldToLocal(anchor.edgePos.clone());

            twGroup.position.copy(localPos);
            twGroup.rotation.y = anchor.rotY;

            this.group.add(twGroup);
        };

        if (station.name === "Messe") {
            createStairsAndEscalator(1, anchorNeg);  // climbs from 0.0 to 8.4
            createStairsAndEscalator(-1, anchorPos); // climbs from 40.0 to 31.6
        } else {
            createStairsAndEscalator(-1, anchorNeg);
            createStairsAndEscalator(1, anchorPos);
        }

        if (station.name !== "Messe") {
            placeTransverseWalls(-1, transWallMatNeg, platEdgeX_neg, anchorNeg);
            placeTransverseWalls(1, transWallMatPos, platEdgeX_pos, anchorPos);
        }
    }

    createDurchgangVerbotenTexture() {
        if (StationBuilder._sharedDurchgangTex) return StationBuilder._sharedDurchgangTex;
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
        StationBuilder._sharedDurchgangTex = texture;
        return texture;
    }

    createStairTexture() {
        if (StationBuilder._sharedStairTex) return StationBuilder._sharedStairTex;
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
        StationBuilder._sharedStairTex = texture;
        return texture;
    }

    static setupEscalatorMaterial(material, model) {
        // Prevent multiple injections into the same material
        if (material.userData.escalatorSetupDone) return;
        material.userData.escalatorSetupDone = true;

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uEscalatorTime = ESCALATOR_SHADER_INJECTION.uniforms.uEscalatorTime;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>\n${ESCALATOR_SHADER_INJECTION.vertexShader.header}`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>\n${ESCALATOR_SHADER_INJECTION.vertexShader.main}`
            );
        };
        // Ensure the uniform is updated by the StationModel/TrackManager tick
        if (model && !model.userData.escalatorUniformHooked) {
            model.userData.escalatorUniformHooked = true;
            const originalTick = model.tick;
            model.tick = function(dt, time) {
                originalTick.call(this, dt, time);
                ESCALATOR_SHADER_INJECTION.uniforms.uEscalatorTime.value = this.escalatorTime || 0;
            };
        }
    }

    // Standard-Balustradenmaterial aller Rolltreppen: helle Lambert-Gradient-Textur.
    // Bewusst KEIN metallisches MeshStandardMaterial — ohne Environment-Map rendert
    // hohe metalness fast schwarz (gleicher Effekt wie bei den Mülleimern, siehe
    // StationModel-Konstruktor).
    static createBalustradeMaterial() {
        if (StationBuilder._sharedBalustradeMat) return StationBuilder._sharedBalustradeMat;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 4;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 128, 0);
        grad.addColorStop(0.0, '#c8cdd2');   // slightly darker edge
        grad.addColorStop(0.3, '#dde0e4');   // lighter centre-left
        grad.addColorStop(0.5, '#e8eaed');   // lightest highlight in the middle
        grad.addColorStop(0.7, '#dde0e4');   // lighter centre-right
        grad.addColorStop(1.0, '#c8cdd2');   // slightly darker edge
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 4);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        StationBuilder._sharedBalustradeMat = new THREE.MeshLambertMaterial({ map: texture });
        return StationBuilder._sharedBalustradeMat;
    }

    createEscalatorStripeTexture() {
        if (StationBuilder._sharedEscalatorStripeTex) return StationBuilder._sharedEscalatorStripeTex;
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
        StationBuilder._sharedEscalatorStripeTex = texture;
        return texture;
    }

    static getRoughConcreteTextures() {
        if (StationBuilder._sharedConcreteMap && StationBuilder._sharedConcreteBumpMap) {
            return { map: StationBuilder._sharedConcreteMap, bumpMap: StationBuilder._sharedConcreteBumpMap };
        }
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

        StationBuilder._sharedConcreteMap = texture;
        StationBuilder._sharedConcreteBumpMap = bumpTexture;
        return { map: texture, bumpMap: bumpTexture };
    }

    createRoughConcreteMaterial() {
        const { map, bumpMap } = StationBuilder.getRoughConcreteTextures();
        return new THREE.MeshLambertMaterial({
            map: map,
            bumpMap: bumpMap,
            bumpScale: 0.008
        });
    }

    buildPointLights() {}
    buildStandardDetails() {
        this.model.addTrashCansToStation(this.station, this.group, 1.0, this.platLength, this.platTopY, this.centerAngle);
    }

    createNeonFixture(length = 2.0, orientation = 'z') {
        const fixtureGroup = new THREE.Group();

        if (!StationBuilder._neonHouseMat) {
            StationBuilder._neonHouseMat = new THREE.MeshLambertMaterial({ color: '#25282c' });
        }
        if (!StationBuilder._neonDiffMat) {
            StationBuilder._neonDiffMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        }

        // Metal housing channel (anthracite casing)
        const isX = (orientation === 'x');
        const houseWidth = isX ? length : 0.22;
        const houseDepth = isX ? 0.22 : length;
        const houseGeom = new THREE.BoxGeometry(houseWidth, 0.05, houseDepth);
        const house = new THREE.Mesh(houseGeom, StationBuilder._neonHouseMat);
        house.position.y = -0.025;

        // Clean white fluorescent/LED diffuser lens (flush inside housing)
        const diffWidth = isX ? Math.max(0.1, length - 0.08) : 0.12;
        const diffDepth = isX ? 0.12 : Math.max(0.1, length - 0.08);
        const diffGeom = new THREE.BoxGeometry(diffWidth, 0.025, diffDepth);
        const diff = new THREE.Mesh(diffGeom, StationBuilder._neonDiffMat);
        diff.position.y = -0.05;

        fixtureGroup.add(house, diff);
        return fixtureGroup;
    }

    createMinimalistExitSignTexture() {
        if (StationBuilder._sharedExitSignTex) return StationBuilder._sharedExitSignTex;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Pure crisp white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 512, 128);

        // Thin minimalist black border
        ctx.strokeStyle = '#1e2022';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 504, 120);

        // Crisp solid black typography & arrows
        ctx.fillStyle = '#111315';
        ctx.textBaseline = 'middle';

        // Left Arrow
        ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('←', 52, 64);

        // Center Word: Ausgang
        ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('Ausgang', 256, 64);

        // Right Arrow
        ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('→', 460, 64);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        StationBuilder._sharedExitSignTex = texture;
        return texture;
    }

    createMezzaninePosterTexture() {
        if (StationBuilder._sharedPosterTex) return StationBuilder._sharedPosterTex;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 384;
        const ctx = canvas.getContext('2d');

        // Poster background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 256, 384);

        // Header
        ctx.fillStyle = '#e11d48';
        ctx.fillRect(16, 16, 224, 48);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VAG Nürnberg', 128, 40);

        // Subtitle
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('U-Bahn Netz', 128, 100);

        // Lines U1, U2, U3
        const lineColors = ['#e11d48', '#2563eb', '#059669'];
        const lineNames = ['U1 Langwasser - Fürth', 'U2 Röthenbach - Flughafen', 'U3 Grossreuth - Nordwestring'];
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = lineColors[i];
            ctx.fillRect(24, 145 + i * 52, 36, 26);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`U${i+1}`, 42, 158 + i * 52);

            ctx.fillStyle = '#cbd5e1';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(lineNames[i], 68, 158 + i * 52);
        }

        // Footer
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(16, 330, 224, 36);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Mobilität für alle', 128, 348);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        StationBuilder._sharedPosterTex = texture;
        return texture;
    }

    createLightGreyTileMaterial() {
        if (StationBuilder._sharedTileMat) return StationBuilder._sharedTileMat;
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Grout base color (neutral mid-grey grout)
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(0, 0, 512, 512);

        // 8 rows of tiles (each 64px tall), 4 columns of tiles (each 128px wide -> 2:1 subway aspect ratio)
        const rowH = 64;
        const colW = 128;
        const grout = 3;

        for (let row = 0; row < 8; row++) {
            const y = row * rowH;
            const xOffset = (row % 2 === 1) ? colW / 2 : 0;
            for (let col = -1; col < 5; col++) {
                const x = col * colW + xOffset;
                const tileW = colW - grout;
                const tileH = rowH - grout;

                // Tile base: light grey ceramic with tiny subtle variation
                const v = 222 + Math.floor(Math.sin(row * 13 + col * 7) * 5);
                ctx.fillStyle = `rgb(${v},${v+2},${v+5})`;
                ctx.fillRect(x + grout, y + grout, tileW, tileH);

                // Subtle ceramic bevel highlight on top & left edges
                ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.fillRect(x + grout, y + grout, tileW, 1.5);
                ctx.fillRect(x + grout, y + grout, 1.5, tileH);

                // Subtle ceramic bevel shadow on bottom & right edges
                ctx.fillStyle = 'rgba(160, 165, 175, 0.4)';
                ctx.fillRect(x + grout, y + grout + tileH - 1.5, tileW, 1.5);
                ctx.fillRect(x + grout + tileW - 1.5, y + grout, 1.5, tileH);
            }
        }

        // Bump map canvas for physical tile bevel depth
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 512;
        bumpCanvas.height = 512;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#000000'; // Recessed grout is black
        bCtx.fillRect(0, 0, 512, 512);

        for (let row = 0; row < 8; row++) {
            const y = row * rowH;
            const xOffset = (row % 2 === 1) ? colW / 2 : 0;
            for (let col = -1; col < 5; col++) {
                const x = col * colW + xOffset;
                const tileW = colW - grout;
                const tileH = rowH - grout;
                bCtx.fillStyle = '#ffffff'; // Elevated tile face is white
                bCtx.fillRect(x + grout + 1, y + grout + 1, tileW - 2, tileH - 2);
            }
        }

        const tileTex = new THREE.CanvasTexture(canvas);
        tileTex.wrapS = THREE.RepeatWrapping;
        tileTex.wrapT = THREE.RepeatWrapping;
        tileTex.colorSpace = THREE.SRGBColorSpace;

        const bumpTex = new THREE.CanvasTexture(bumpCanvas);
        bumpTex.wrapS = THREE.RepeatWrapping;
        bumpTex.wrapT = THREE.RepeatWrapping;

        StationBuilder._sharedTileMat = new THREE.MeshLambertMaterial({
            map: tileTex,
            bumpMap: bumpTex,
            bumpScale: 0.012
        });
        return StationBuilder._sharedTileMat;
    }

    createLightGreyFloorMaterial() {
        if (StationBuilder._sharedFloorMat) return StationBuilder._sharedFloorMat;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Darker grout
        ctx.fillStyle = '#7a818c';
        ctx.fillRect(0, 0, 256, 256);

        // 4x4 square floor tiles (64px each)
        const size = 64;
        const grout = 3;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const x = c * size;
                const y = r * size;
                const v = 205 + Math.floor(Math.sin(r * 11 + c * 17) * 4);
                ctx.fillStyle = `rgb(${v},${v+2},${v+4})`;
                ctx.fillRect(x + grout, y + grout, size - grout, size - grout);
            }
        }

        const floorTex = new THREE.CanvasTexture(canvas);
        floorTex.wrapS = THREE.RepeatWrapping;
        floorTex.wrapT = THREE.RepeatWrapping;
        floorTex.colorSpace = THREE.SRGBColorSpace;

        StationBuilder._sharedFloorMat = new THREE.MeshLambertMaterial({
            map: floorTex
        });
        return StationBuilder._sharedFloorMat;
    }

    scaleBoxUVs(geom, width, height, depth, unitSize = 1.2) {
        const uv = geom.attributes.uv;
        if (!uv) return;
        // ±X faces (0..7): span depth (U) and height (V)
        for (let i = 0; i < 8; i++) {
            uv.setXY(i, uv.getX(i) * (depth / unitSize), uv.getY(i) * (height / unitSize));
        }
        // ±Y faces (8..15): span width (U) and depth (V)
        for (let i = 8; i < 16; i++) {
            uv.setXY(i, uv.getX(i) * (width / unitSize), uv.getY(i) * (depth / unitSize));
        }
        // ±Z faces (16..23): span width (U) and height (V)
        for (let i = 16; i < 24; i++) {
            uv.setXY(i, uv.getX(i) * (width / unitSize), uv.getY(i) * (height / unitSize));
        }
        uv.needsUpdate = true;
    }

    buildUpperMezzanine(stairGroup, zDir, numSteps, stepDepth, stepHeight, stairWallHeight, stairWallDepth, wallMat, stepMat) {
        const tileMat = this.createLightGreyTileMaterial();
        const floorMat = this.createLightGreyFloorMaterial();

        const topY = numSteps * stepHeight;
        const corridorCeilY = (this.station && this.station.name === "Rathenauplatz") ? (topY + 2.8) : stairWallHeight;
        const corridorHeight = corridorCeilY - topY;

        // Dimensions of the T-junction mezzanine:
        // Approach corridor (starts at escalator landing, runs forward):
        const approachDepth = 4.0;
        const landingStartZ = zDir * stairWallDepth;
        const crossStartZ = landingStartZ + zDir * approachDepth;
        const approachMidZ = landingStartZ + zDir * (approachDepth / 2);

        // Cross corridor (Querflur: runs left and right):
        const crossDepth = 3.2;
        const crossEndZ = crossStartZ + zDir * crossDepth;
        const crossMidZ = crossStartZ + zDir * (crossDepth / 2);
        const crossHalfWidth = 6.2; // Spans from X = -6.2m to +6.2m (12.4m total width)
        const approachInnerHalfWidth = 2.1; // Walkway between X = -2.1 and +2.1 (4.2m width)

        // 1. Approach Corridor Floor & Cross Corridor Floor (tiled in light grey)
        const floorThick = 0.2;
        const appFloorGeom = new THREE.BoxGeometry(4.2, floorThick, approachDepth);
        this.scaleBoxUVs(appFloorGeom, 4.2, floorThick, approachDepth, 1.2);
        const appFloor = new THREE.Mesh(appFloorGeom, floorMat);
        appFloor.position.set(0, topY - floorThick / 2, approachMidZ);

        const crossFloorWidth = crossHalfWidth * 2;
        const crossFloorGeom = new THREE.BoxGeometry(crossFloorWidth, floorThick, crossDepth);
        this.scaleBoxUVs(crossFloorGeom, crossFloorWidth, floorThick, crossDepth, 1.2);
        const crossFloor = new THREE.Mesh(crossFloorGeom, floorMat);
        crossFloor.position.set(0, topY - floorThick / 2, crossMidZ);

        stairGroup.add(appFloor, crossFloor);

        // 2. Escalator Comb Plates (transition from steps to floor tiles)
        const combGeom = new THREE.BoxGeometry(1.05, 0.02, 0.4);
        if (!StationBuilder._mezzanineCombMat) {
            StationBuilder._mezzanineCombMat = new THREE.MeshLambertMaterial({ color: '#334155' });
        }
        const combMat = StationBuilder._mezzanineCombMat;
        const combL = new THREE.Mesh(combGeom, combMat);
        combL.position.set(-1.55, topY + 0.01, landingStartZ + zDir * 0.2);
        const combR = new THREE.Mesh(combGeom, combMat);
        combR.position.set(1.55, topY + 0.01, landingStartZ + zDir * 0.2);
        stairGroup.add(combL, combR);

        // 3. Approach Corridor Side Walls (tiled in light grey)
        const appWallGeom = new THREE.BoxGeometry(0.4, corridorHeight, approachDepth);
        this.scaleBoxUVs(appWallGeom, 0.4, corridorHeight, approachDepth, 1.2);
        const appWallL = new THREE.Mesh(appWallGeom, tileMat);
        appWallL.position.set(-2.3, topY + corridorHeight / 2, approachMidZ);
        const appWallR = new THREE.Mesh(appWallGeom, tileMat);
        appWallR.position.set(2.3, topY + corridorHeight / 2, approachMidZ);
        stairGroup.add(appWallL, appWallR);

        // 4. Cross Corridor Walls (all tiled in light grey)
        // 4a. Back Wall: full-width wall facing the approach corridor
        const backWallWidth = crossFloorWidth + 0.4;
        const backWallGeom = new THREE.BoxGeometry(backWallWidth, corridorHeight, 0.4);
        this.scaleBoxUVs(backWallGeom, backWallWidth, corridorHeight, 0.4, 1.2);
        const backWall = new THREE.Mesh(backWallGeom, tileMat);
        backWall.position.set(0, topY + corridorHeight / 2, crossEndZ + zDir * 0.2);
        stairGroup.add(backWall);

        // 4b. End Cap Walls (left & right ends of the cross corridor)
        const endCapGeom = new THREE.BoxGeometry(0.4, corridorHeight, crossDepth);
        this.scaleBoxUVs(endCapGeom, 0.4, corridorHeight, crossDepth, 1.2);
        const endCapL = new THREE.Mesh(endCapGeom, tileMat);
        endCapL.position.set(-crossHalfWidth - 0.2, topY + corridorHeight / 2, crossMidZ);
        const endCapR = new THREE.Mesh(endCapGeom, tileMat);
        endCapR.position.set(crossHalfWidth + 0.2, topY + corridorHeight / 2, crossMidZ);
        stairGroup.add(endCapL, endCapR);

        // 4c. Front Return Walls (on either side of the entrance from the approach corridor)
        const frontWallWidth = crossHalfWidth - approachInnerHalfWidth; // (6.2 - 2.1 = 4.1m)
        const frontWallGeom = new THREE.BoxGeometry(frontWallWidth, corridorHeight, 0.4);
        this.scaleBoxUVs(frontWallGeom, frontWallWidth, corridorHeight, 0.4, 1.2);
        const frontWallL = new THREE.Mesh(frontWallGeom, tileMat);
        frontWallL.position.set(-(approachInnerHalfWidth + frontWallWidth / 2), topY + corridorHeight / 2, crossStartZ - zDir * 0.2);
        const frontWallR = new THREE.Mesh(frontWallGeom, tileMat);
        frontWallR.position.set(approachInnerHalfWidth + frontWallWidth / 2, topY + corridorHeight / 2, crossStartZ - zDir * 0.2);
        stairGroup.add(frontWallL, frontWallR);

        // 5. Ceilings (enclosing the top completely)
        const appCeilGeom = new THREE.BoxGeometry(5.0, 0.4, approachDepth);
        const appCeil = new THREE.Mesh(appCeilGeom, wallMat);
        appCeil.position.set(0, corridorCeilY + 0.2, approachMidZ);

        const crossCeilGeom = new THREE.BoxGeometry(crossFloorWidth + 0.8, 0.4, crossDepth + 0.8);
        const crossCeil = new THREE.Mesh(crossCeilGeom, wallMat);
        crossCeil.position.set(0, corridorCeilY + 0.2, crossMidZ);
        stairGroup.add(appCeil, crossCeil);

        // 6. Transition Bulkhead (if corridorCeilY < stairWallHeight, e.g. Rathenauplatz)
        if (stairWallHeight > corridorCeilY + 0.05) {
            const bulkHeight = stairWallHeight - corridorCeilY;
            const bulkGeom = new THREE.BoxGeometry(5.0, bulkHeight, 0.4);
            const bulkMesh = new THREE.Mesh(bulkGeom, wallMat);
            bulkMesh.position.set(0, corridorCeilY + bulkHeight / 2, landingStartZ - zDir * 0.2);
            stairGroup.add(bulkMesh);
        }

        // 7. Baseboards (Sockelleisten) along all tiled walls
        if (!StationBuilder._mezzanineBaseboardMat) {
            StationBuilder._mezzanineBaseboardMat = new THREE.MeshLambertMaterial({ color: '#26282b' });
        }
        const baseboardMat = StationBuilder._mezzanineBaseboardMat;
        const bbY = topY + 0.05;
        const bbH = 0.1;

        // Approach side baseboards
        const bbAppGeom = new THREE.BoxGeometry(0.04, bbH, approachDepth);
        const bbAppL = new THREE.Mesh(bbAppGeom, baseboardMat);
        bbAppL.position.set(-2.08, bbY, approachMidZ);
        const bbAppR = new THREE.Mesh(bbAppGeom, baseboardMat);
        bbAppR.position.set(2.08, bbY, approachMidZ);

        // Cross corridor baseboards
        const bbBackGeom = new THREE.BoxGeometry(crossFloorWidth, bbH, 0.04);
        const bbBack = new THREE.Mesh(bbBackGeom, baseboardMat);
        bbBack.position.set(0, bbY, crossEndZ - zDir * 0.02);

        const bbEndGeom = new THREE.BoxGeometry(0.04, bbH, crossDepth);
        const bbEndL = new THREE.Mesh(bbEndGeom, baseboardMat);
        bbEndL.position.set(-crossHalfWidth + 0.02, bbY, crossMidZ);
        const bbEndR = new THREE.Mesh(bbEndGeom, baseboardMat);
        bbEndR.position.set(crossHalfWidth - 0.02, bbY, crossMidZ);

        const bbFrontGeom = new THREE.BoxGeometry(frontWallWidth, bbH, 0.04);
        const bbFrontL = new THREE.Mesh(bbFrontGeom, baseboardMat);
        bbFrontL.position.set(-(approachInnerHalfWidth + frontWallWidth / 2), bbY, crossStartZ + zDir * 0.02);
        const bbFrontR = new THREE.Mesh(bbFrontGeom, baseboardMat);
        bbFrontR.position.set(approachInnerHalfWidth + frontWallWidth / 2, bbY, crossStartZ + zDir * 0.02);

        stairGroup.add(bbAppL, bbAppR, bbBack, bbEndL, bbEndR, bbFrontL, bbFrontR);

        // 8. Regular, Rhythmic Neon Light Fixtures
        // Continuation of the 2.4m sequence from the escalator shaft into the approach corridor:
        // Shaft lamps were at d = 2.0, 4.4, 6.8 (with d < stairWallDepth).
        // The first corridor lamp is at d = 6.8 + 2.4 - stairWallDepth = 0.8m past landing.
        // The second corridor lamp is at d = 0.8 + 2.4 = 3.2m past landing.
        const lampPitch = 2.4;
        let lastShaftD = 2.0;
        while (lastShaftD + lampPitch < stairWallDepth - 0.5) {
            lastShaftD += lampPitch;
        }
        let dCorr = lastShaftD + lampPitch - stairWallDepth;
        while (dCorr < approachDepth) {
            const fixture = this.createNeonFixture(1.8, 'z');
            fixture.position.set(0, corridorCeilY - 0.02, landingStartZ + zDir * dCorr);
            stairGroup.add(fixture);
            dCorr += lampPitch;
        }

        // Cross corridor ceiling fixtures (spanning left, center, right along the transverse hallway):
        const crossCenterFix = this.createNeonFixture(2.0, 'x');
        crossCenterFix.position.set(0, corridorCeilY - 0.02, crossMidZ);

        const crossLeftFix = this.createNeonFixture(2.0, 'x');
        crossLeftFix.position.set(-4.0, corridorCeilY - 0.02, crossMidZ);

        const crossRightFix = this.createNeonFixture(2.0, 'x');
        crossRightFix.position.set(4.0, corridorCeilY - 0.02, crossMidZ);

        stairGroup.add(crossCenterFix, crossLeftFix, crossRightFix);

        // 9. Minimalist White Exit Sign ("←  Ausgang  →")
        if (!StationBuilder._mezzanineSignMat) {
            const signTex = this.createMinimalistExitSignTexture();
            StationBuilder._mezzanineSignMat = new THREE.MeshBasicMaterial({ map: signTex });
        }
        if (!StationBuilder._mezzanineSignFrameMat) {
            StationBuilder._mezzanineSignFrameMat = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
        }
        const signMat = StationBuilder._mezzanineSignMat;
        const signFrameMat = StationBuilder._mezzanineSignFrameMat;
        const signBoxMat = [signFrameMat, signFrameMat, signFrameMat, signFrameMat, signMat, signMat];
        const signGeom = new THREE.BoxGeometry(2.0, 0.42, 0.04);
        const signMesh = new THREE.Mesh(signGeom, signBoxMat);
        const signY = corridorCeilY - 0.32;
        const signZ = landingStartZ + zDir * 2.0; // Suspended halfway between approach lamps
        signMesh.position.set(0, signY, signZ);
        stairGroup.add(signMesh);

        // Suspension rods for the exit sign
        if (!StationBuilder._mezzanineRodMat) {
            StationBuilder._mezzanineRodMat = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
        }
        const rodMat = StationBuilder._mezzanineRodMat;
        const rodHeight = Math.max(0.1, corridorCeilY - (signY + 0.21));
        const rodGeom = new THREE.CylinderGeometry(0.012, 0.012, rodHeight, 8);
        const rodL = new THREE.Mesh(rodGeom, rodMat);
        rodL.position.set(-0.7, corridorCeilY - rodHeight / 2, signZ);
        const rodR = new THREE.Mesh(rodGeom, rodMat);
        rodR.position.set(0.7, corridorCeilY - rodHeight / 2, signZ);
        stairGroup.add(rodL, rodR);

        // 10. Information / Network Poster on Approach Side Wall
        if (!StationBuilder._mezzaninePosterMat) {
            const posterTex = this.createMezzaninePosterTexture();
            StationBuilder._mezzaninePosterMat = new THREE.MeshLambertMaterial({ map: posterTex });
        }
        const posterMat = StationBuilder._mezzaninePosterMat;
        const posterGeom = new THREE.PlaneGeometry(1.2, 1.7);
        const posterMesh = new THREE.Mesh(posterGeom, posterMat);
        posterMesh.position.set(-2.08, topY + 1.35, landingStartZ + zDir * 2.0);
        posterMesh.rotation.y = Math.PI / 2;
        stairGroup.add(posterMesh);
    }
}

