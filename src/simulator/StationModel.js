import * as THREE from 'three';
import { StationBuilder } from './stations/StationBuilder.js?v=67';
import { RathausBuilder } from './stations/RathausBuilder.js?v=45';
import { LorenzkircheBuilder } from './stations/LorenzkircheBuilder.js?v=45';
import { PassengerBuilder } from './people/PassengerBuilder.js';

export class StationModel {
    constructor(scene, simulation) {
        this.scene = scene;
        this.sim = simulation;
        
        // Culling configuration
        this.loadedStations = new Map(); // stationIndex -> boolean (is in scene)
        // Per-station culling distance by structural type: in the tunnel the view fades to
        // black within ~200m, so keeping underground stations resident 2km out only meant
        // 5-6 full station groups in the scene at once. Surface/elevated stations stay
        // visible much further along the open line, so they keep a generous distance.
        this.stationCullDist = this.sim.stations.map(st =>
            this.sim.getChunkType(st.position) === 'underground' ? 600 : 1300);
        this.platformMaterialsCache = new Map();
        
        // Shared materials
        this.materials = {
            platform: new THREE.MeshLambertMaterial({ color: '#888888' }), // concrete platform
            edgeStrip: new THREE.MeshLambertMaterial({ color: '#ffffff' }), // white safety stripe
            ceiling: new THREE.MeshLambertMaterial({ color: '#555555' }),
            bench: new THREE.MeshLambertMaterial({ color: '#4a2f13' }), // wooden benches
            pillar: new THREE.MeshLambertMaterial({ color: '#7f8c8d' }),
            passenger: new THREE.MeshLambertMaterial({ color: '#9c27b0' }), // colorful figures
            lightTube: new THREE.MeshBasicMaterial({ color: 0xffffff }), // shared emissive light tubes
            signEdge: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
            boardCasing: new THREE.MeshLambertMaterial({ color: '#d2d7db' }),
            boardHanger: new THREE.MeshLambertMaterial({ color: '#4a4a4a' }),
            yellowCabin: new THREE.MeshLambertMaterial({ color: '#eeb211' }),
            glassCabin: new THREE.MeshLambertMaterial({ color: '#aed6f1', transparent: true, opacity: 0.4 }),
            ballast: new THREE.MeshLambertMaterial({
                map: this.createBallastTexture()
            }),
            rail: new THREE.MeshLambertMaterial({ color: '#99aaad' }),
            sleeper: new THREE.MeshLambertMaterial({ color: '#5a3825' }),
            thirdRail: new THREE.MeshLambertMaterial({ color: '#cccccc' }),
            grayWallEdge: new THREE.MeshLambertMaterial({ color: '#666666' })
        };

        // Shared geometries for elements that repeat across stations
        this.sharedGeometries = {
            lightTube: (() => { 
                const g = new THREE.CylinderGeometry(0.05, 0.05, 3.0, 6);
                g.rotateX(Math.PI / 2);
                return g;
            })(),
            pillar: new THREE.CylinderGeometry(0.25, 0.25, 7.0, 8), // hoch genug, um durch die angehobene Decke zu reichen (Überstand verdeckt)
            bench: new THREE.BoxGeometry(0.6, 0.4, 2.5),
            stairs: new THREE.BoxGeometry(2.5, 3.0, 6.0),
            boardCasing: new THREE.BoxGeometry(2.53, 0.65, 0.25),
            boardHanger: new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6)
        };
        
        // Maximilianstraße custom ceiling material matching tunnel walls
        this.tunnelConcreteTexture = this.createTunnelConcreteTexture();
        this.maximilianstrasseCeilingMat = new THREE.MeshLambertMaterial({
            map: this.tunnelConcreteTexture,
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        // Cross-beams (Querstreben) and the upper concrete wall band above the tiles use the
        // same rough concrete texture as the tunnel entrance/portal walls and staircase walls
        // (StationBuilder.createRoughConcreteMaterial), NOT the dark tunnel-tube texture above —
        // the ceiling keeps that one, only these two elements switch.
        this.stationConcreteWallMat = this.createRoughConcreteMaterial();
        this.stationConcreteWallMat.side = THREE.DoubleSide;
        this.stationConcreteBeamMat = this.createRoughConcreteMaterial();
        this.stationConcreteBeamMat.side = THREE.DoubleSide;
        this.stationConcreteBeamMat.map.wrapS = this.stationConcreteBeamMat.map.wrapT = THREE.RepeatWrapping;
        this.stationConcreteBeamMat.map.repeat.set(4, 1);
        this.stationConcreteBeamMat.map.needsUpdate = true;
        if (this.stationConcreteBeamMat.bumpMap) {
            this.stationConcreteBeamMat.bumpMap.wrapS = this.stationConcreteBeamMat.bumpMap.wrapT = THREE.RepeatWrapping;
            this.stationConcreteBeamMat.bumpMap.repeat.set(4, 1);
            this.stationConcreteBeamMat.bumpMap.needsUpdate = true;
        }

        // Shared materials for trash cans (Mülleimer)
        this.materials.trashBody = new THREE.MeshStandardMaterial({
            map: this.createTrashCanTexture(),
            roughness: 0.25,
            metalness: 0.8
        });
        this.materials.trashLid = new THREE.MeshStandardMaterial({
            color: 0xd1d5db, // Light grey/silver
            roughness: 0.2,
            metalness: 0.85
        });
        this.materials.trashBag = new THREE.MeshStandardMaterial({
            color: 0x0055ff,
            roughness: 0.3,
            metalness: 0.1
        });
        this.materials.trashBag.userData = {};
        this.materials.trashBag.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uWind = { value: 0.1 };
            shader.vertexShader = `
                uniform float uTime;
                uniform float uWind;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                float wave = sin(position.x * 12.0 + uTime * 6.0) * cos(position.z * 12.0 + uTime * 4.0);
                transformed.y += wave * uWind * 0.03;
                transformed.x += wave * uWind * 0.01;
                transformed.z += wave * uWind * 0.01;
                `
            );
            this.materials.trashBag.userData.shader = shader;
        };

        // PRE-BUILD ALL 27 STATIONS ONCE AT STARTUP
        // This completely avoids building meshes, canvas textures, and materials in the render loop.
        this.stationsList = [];
        this.sim.stations.forEach((station, idx) => {
            const group = this.buildStation(station);
            this.stationsList.push(group);
        });
    }

    update(trainZ) {
        // Simple culling loop: add/remove pre-built stations from the scene (instantaneous)
        this.sim.stations.forEach((station, idx) => {
            const dist = Math.abs(trainZ - station.position);
            const isLoaded = this.loadedStations.has(idx);

            if (dist < this.stationCullDist[idx]) {
                if (!isLoaded) {
                    this.scene.add(this.stationsList[idx]);
                    this.loadedStations.set(idx, true);
                }
            } else {
                if (isLoaded) {
                    this.scene.remove(this.stationsList[idx]);
                    this.loadedStations.delete(idx);
                }
            }
        });

        // Update trash bag shader uniforms for wind ripple animation
        if (this.materials.trashBag && this.materials.trashBag.userData.shader) {
            this.materials.trashBag.userData.shader.uniforms.uTime.value = performance.now() * 0.001;
            
            // Calculate wind from train velocity & proximity
            let maxWind = 0.05; // base idle wind
            const trainSpeed = Math.abs(this.sim.speed);
            
            let closestDist = Infinity;
            this.sim.stations.forEach((station, idx) => {
                if (this.loadedStations.has(idx)) {
                    const dist = Math.abs(trainZ - station.position);
                    if (dist < closestDist) {
                        closestDist = dist;
                    }
                }
            });
            
            if (closestDist < 100) {
                const proximityFactor = Math.max(0, 1 - closestDist / 100);
                maxWind = 0.05 + proximityFactor * trainSpeed * 0.15;
            }
            
            this.materials.trashBag.userData.shader.uniforms.uWind.value = Math.min(1.0, maxWind);
        }
    }

    adjustPlatformUVs(geometry, j, subLen, H_meters) {
        const posAttr = geometry.attributes.position;
        const uvAttr = geometry.attributes.uv;
        let maxY = -Infinity;
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i);
            if (y > maxY) maxY = y;
        }
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i);
            if (Math.abs(y - maxY) < 0.001) {
                const z = posAttr.getZ(i); // goes from -subLen/2 to +subLen/2
                const absoluteZ = (j * subLen + subLen/2) + z;
                const v = absoluteZ / H_meters;
                uvAttr.setY(i, v);
            }
        }
        uvAttr.needsUpdate = true;
    }

    // Sweeps a solid rectangular cross-section along the track spline from arc sStart..sEnd,
    // producing ONE continuous BufferGeometry instead of per-5m boxes. The half-width is
    // sampled per ring via halfWidthFn(s) so the bar tapers smoothly with the inter-track gap.
    // Vertices are emitted in the station group's LOCAL frame. mats = [sideMat, topMat]:
    // the top face uses material group 1, all other faces group 0.
    // Top-face UV: U normalised 0..1 across the (tapering) width, V = arcLength / Hmeters
    // (matches adjustPlatformUVs so the floor texture tiles continuously along the platform).
    buildSweptBar(group, sStart, sEnd, halfWidthFn, topY, botY, mats, Hmeters, centerOffFn) {
        // topY/botY may be a plain number (flat) OR a function of s (e.g. a periodic zigzag
        // profile like Jakobinenstraße's folded wall/coping) — sampled per ring either way.
        const topYFn = typeof topY === 'function' ? topY : () => topY;
        const botYFn = typeof botY === 'function' ? botY : () => botY;
        const length = sEnd - sStart;
        const nSeg = Math.max(2, Math.ceil(length));   // ~1 m rings
        const rings = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const hw = halfWidthFn(s);
            const co = centerOffFn ? centerOffFn(s) : 0; // lateral centre offset from centerline
            const ty = topYFn(s), by = botYFn(s);
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            const mk = (lat, y) => group.worldToLocal(new THREE.Vector3(wp.x + nX * lat, y, wp.z + nZ * lat));
            rings.push({ bl: mk(co - hw, by), br: mk(co + hw, by), tr: mk(co + hw, ty), tl: mk(co - hw, ty), cum });
        }
        const pos = [], uv = [];
        let vCount = 0;
        const tri = (a, b, c, ua, ub, uc) => {
            pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
            vCount += 3;
        };
        const quad = (p0, p1, p2, p3, u0, u1, u2, u3) => { tri(p0, p1, p2, u0, u1, u2); tri(p0, p2, p3, u0, u2, u3); };
        // TOP face -> material group 1
        const topStart = vCount;
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1];
            const vA = A.cum / Hmeters, vB = B.cum / Hmeters;
            quad(A.tl, A.tr, B.tr, B.tl, [0, vA], [1, vA], [1, vB], [0, vB]);
        }
        const topCount = vCount - topStart;
        // SIDES + BOTTOM + end caps -> material group 0
        const sideStart = vCount;
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1];
            const vA = A.cum, vB = B.cum;
            quad(A.bl, A.tl, B.tl, B.bl, [0, vA], [1, vA], [1, vB], [0, vB]); // left
            quad(A.tr, A.br, B.br, B.tr, [0, vA], [1, vA], [1, vB], [0, vB]); // right
            quad(A.br, A.bl, B.bl, B.br, [0, vA], [1, vA], [1, vB], [0, vB]); // bottom
        }
        const c0 = rings[0], cN = rings[nSeg];
        quad(c0.bl, c0.br, c0.tr, c0.tl, [0, 0], [1, 0], [1, 1], [0, 1]);
        quad(cN.tl, cN.tr, cN.br, cN.bl, [0, 0], [1, 0], [1, 1], [0, 1]);
        const sideCount = vCount - sideStart;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.addGroup(topStart, topCount, 1);
        geom.addGroup(sideStart, sideCount, 0);
        geom.computeVertexNormals();
        // DoubleSide so winding never produces invisible faces on either curl direction.
        // NOTE: Material.clone() does NOT copy onBeforeCompile/customProgramCacheKey (they are
        // plain function properties, not part of Three.js's copyable material state) — carry
        // them over manually, otherwise any shader-hook-based cutout (e.g. Lorenzkirche/Rathaus
        // vault passages) silently stops working on the cloned material.
        const meshMats = mats.map(m => {
            const c = m.clone();
            c.side = THREE.DoubleSide;
            if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
            if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;
            return c;
        });
        const mesh = new THREE.Mesh(geom, meshMats);
        group.add(mesh);
        return mesh;
    }

    // Sweeps a single vertical wall RIBBON (one tiled face) along the track from sStart..sEnd
    // at lateral offset offFn(s), spanning world Y [yBotW, yTopW]. UVs are baked metric:
    // U = arcLength / tileU (so a tiled texture repeats every tileU metres along the wall),
    // V interpolates vBot..vTop (caller passes either metric values for tiling textures, or
    // 0..1 for a single-image band like the station-name stripe). The base material's map is
    // cloned with repeat (1,1) / offset (0,0) / RepeatWrapping so only the baked UVs tile it.
    buildSweptWall(group, sStart, sEnd, offFn, yBotW, yTopW, baseMat, tileU, vBot, vTop, nSegOverride, vMetricScale) {
        // yBotW/yTopW may be a plain number (flat top/bottom) OR a function of s — e.g. a
        // periodic zigzag profile like Jakobinenstraße's folded wall/coping. For a periodic
        // profile, pass nSegOverride so rings land exactly on the pattern's own breakpoints
        // (e.g. a multiple of the period) — otherwise the default ~1m/ring default resolution
        // aliases against a short period and the peaks come out uneven ("phase noise").
        //
        // vMetricScale (optional): when yTopW/yBotW VARIES with s (e.g. a zigzag top edge), the
        // default vBot..vTop-per-ring interpolation stretches the texture to fill whatever the
        // LOCAL ring height happens to be — so a horizontal grout line ends up following the
        // zigzag instead of staying level ("Textur folgt den Dreieck-Streckungen"). Passing
        // vMetricScale switches V to an ABSOLUTE-world-Y mapping (V = worldY * vMetricScale,
        // ignoring vBot/vTop) so horizontal texture features stay at a constant world height and
        // the varying top edge just clips across the (unstretched) texture, like a real wall
        // whose roofline cuts across horizontal masonry courses.
        const yBotFn = typeof yBotW === 'function' ? yBotW : () => yBotW;
        const yTopFn = typeof yTopW === 'function' ? yTopW : () => yTopW;
        const length = sEnd - sStart;
        const nSeg = nSegOverride || Math.max(2, Math.ceil(length));
        const bots = [], tops = [], us = [], vBots = [], vTops = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = offFn(s);
            const yb = yBotFn(s), yt = yTopFn(s);
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            bots.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * off, yb, wp.z + nZ * off)));
            tops.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * off, yt, wp.z + nZ * off)));
            us.push(cum / tileU);
            if (vMetricScale) { vBots.push(yb * vMetricScale); vTops.push(yt * vMetricScale); }
            else { vBots.push(vBot); vTops.push(vTop); }
        }
        // The two side walls have viewers standing on opposite sides of the track (facing each
        // other), so a single "u increases with distance along s" rule reads correctly for only
        // one of them — the other's viewer is looking the opposite way down the platform, so to
        // them it reads backwards. This is a viewing-direction effect, not a face-winding one
        // (the material is DoubleSide, so winding never changes what's visible — only which
        // world position maps to which u does). Mirror u for the negative-offset side (the
        // Langwasser-Süd-direction side, same sign convention as the destination boards) so its
        // text reads the right way round too.
        if (offFn((sStart + sEnd) / 2) > 0) {
            const totalU = cum / tileU;
            for (let i = 0; i < us.length; i++) us[i] = totalU - us[i];
        }
        const pos = [], uv = [];
        const tri = (a, b, c, ua, ub, uc) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); };
        for (let r = 0; r < nSeg; r++) {
            const bl = bots[r], tl = tops[r], br = bots[r + 1], tr = tops[r + 1];
            const uL = us[r], uR = us[r + 1];
            const vB0 = vBots[r], vB1 = vBots[r + 1], vT0 = vTops[r], vT1 = vTops[r + 1];
            tri(bl, br, tr, [uL, vB0], [uR, vB1], [uR, vT1]);
            tri(bl, tr, tl, [uL, vB0], [uR, vT1], [uL, vT0]);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mat = baseMat.clone();
        mat.side = THREE.DoubleSide;
        // Material.clone() does NOT copy onBeforeCompile/customProgramCacheKey — see buildSweptBar.
        if (baseMat.onBeforeCompile) mat.onBeforeCompile = baseMat.onBeforeCompile;
        if (baseMat.customProgramCacheKey) mat.customProgramCacheKey = baseMat.customProgramCacheKey;
        if (baseMat.map) { mat.map = baseMat.map.clone(); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.repeat.set(1, 1); mat.map.offset.set(0, 0); mat.map.needsUpdate = true; }
        if (baseMat.bumpMap) { mat.bumpMap = baseMat.bumpMap.clone(); mat.bumpMap.wrapS = mat.bumpMap.wrapT = THREE.RepeatWrapping; mat.bumpMap.repeat.set(1, 1); mat.bumpMap.offset.set(0, 0); }
        const mesh = new THREE.Mesh(geom, mat);
        group.add(mesh);
        return mesh;
    }

    // Sweeps an ARBITRARY open cross-section profile along the track (e.g. a half-circle vault,
    // a folded roof). profilePts = [{x,y}, ...] in the lateral(x)/height(y) plane, relative to
    // lateral centre offFn(s) and to the station floor (world Y = cyW + y). Connects consecutive
    // rings into a continuous surface. U = arcLen/tileU, V = normalised distance along the
    // profile, so a texture maps along the profile. Solid colours ignore UVs.
    buildSweptProfile(group, sStart, sEnd, profilePts, cyW, offFn, material, tileU) {
        const length = sEnd - sStart;
        const nSeg = Math.max(2, Math.ceil(length));
        const P = profilePts.length;
        const rings = [], us = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = offFn ? offFn(s) : 0;
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            const ring = [];
            for (const pt of profilePts) {
                const lat = off + pt.x;
                ring.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * lat, cyW + pt.y, wp.z + nZ * lat)));
            }
            rings.push(ring); us.push(cum / tileU);
        }
        const vs = [0];
        for (let p = 1; p < P; p++) { const dx = profilePts[p].x - profilePts[p - 1].x, dy = profilePts[p].y - profilePts[p - 1].y; vs.push(vs[p - 1] + Math.hypot(dx, dy)); }
        const pos = [], uv = [];
        const tri = (a, b, c, ua, ub, uc) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); };
        for (let r = 0; r < nSeg; r++) {
            const A = rings[r], B = rings[r + 1], uA = us[r], uB = us[r + 1];
            for (let p = 0; p < P - 1; p++) {
                tri(A[p], A[p + 1], B[p + 1], [uA, vs[p]], [uA, vs[p + 1]], [uB, vs[p + 1]]);
                tri(A[p], B[p + 1], B[p], [uA, vs[p]], [uB, vs[p + 1]], [uB, vs[p]]);
            }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mat = material.clone();
        mat.side = THREE.DoubleSide;
        // Material.clone() does NOT copy onBeforeCompile/customProgramCacheKey — see buildSweptBar.
        // This is what silently dropped Lorenzkirche/Rathaus's shader-based vault passage cutouts.
        if (material.onBeforeCompile) mat.onBeforeCompile = material.onBeforeCompile;
        if (material.customProgramCacheKey) mat.customProgramCacheKey = material.customProgramCacheKey;
        if (material.map) {
            mat.map = material.map.clone();
            if (material.userData && material.userData.keepWrapAndRepeat) {
                mat.map.wrapS = material.map.wrapS;
                mat.map.wrapT = material.map.wrapT;
                mat.map.repeat.copy(material.map.repeat);
                mat.map.offset.copy(material.map.offset);
            } else {
                mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
                mat.map.repeat.set(1, 1);
                mat.map.offset.set(0, 0);
            }
            mat.map.needsUpdate = true;
        }
        const mesh = new THREE.Mesh(geom, mat);
        group.add(mesh);
        return mesh;
    }

    getPlatformMaterials(station, platWidth, hasLeftStripe, hasRightStripe) {
        const cacheKey = `${station.name}_${platWidth.toFixed(3)}_${hasLeftStripe}_${hasRightStripe}`;
        if (this.platformMaterialsCache.has(cacheKey)) {
            return this.platformMaterialsCache.get(cacheKey);
        }

        const topMat = this.createPlatformTopMaterial(station, platWidth, hasLeftStripe, hasRightStripe);
        
        let sideColor = '#888888';
        if (station.name === "Lorenzkirche") {
            sideColor = '#8b4535';
        } else if (station.name === "Rathaus") {
            sideColor = '#3f4645';
        } else if (station.name === "Hardhöhe") {
            sideColor = '#f1f5f9';
        }

        const sideMat = new THREE.MeshLambertMaterial({ color: sideColor });
        const mats = [
            sideMat, // right (X+)
            sideMat, // left (X-)
            topMat,  // top (Y+)
            sideMat, // bottom (Y-)
            sideMat, // front (Z+)
            sideMat  // back (Z-)
        ];

        this.platformMaterialsCache.set(cacheKey, mats);
        return mats;
    }

    createPlatformTopMaterial(station, platWidth, hasLeftStripe, hasRightStripe) {
        const stationFloorConfigs = {
            "default": {
                tileColor: '#909291',
                groutColor: '#171918',
                tileSize: 0.3,
                offset: true,
                weatheredEdges: false,
                terracotta: false,
                stripGap: 0.2,
                stripeW: 0.6,
                blindW: 0.4,
                blindColor: '#1d201f',
                weatheredStripe: true
            },
            "Scharfreiterring": { weatheredEdges: true },
            "Langwasser Nord": { weatheredEdges: true },
            "Messe": { weatheredEdges: true },
            "Bauernfeindstraße": { weatheredEdges: true },
            "Lorenzkirche": {
                tileColor: '#8b4535',
                groutColor: '#451a03',
                terracotta: true,
                weatheredStripe: true
            },
            "Jakobinenstraße": {
                offset: false
            },
            "Fürth Hauptbahnhof": {
                offset: false
            },
            "Rathaus": {
                tileSize: 0.4,
                offset: false,
                rotated: true,
                marbling: true,
                tileColor: '#757980',
                groutColor: '#1a1d1c',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Stadthalle": {
                tileSize: 0.4,
                offset: false,
                tileColor: '#b97a70',
                groutColor: '#5a342e',
                terracotta: true,
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Klinikum": {
                tileSize: 0.4,
                offset: false,
                tileColor: '#757980',
                groutColor: '#555555',
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                weatheredStripe: false
            },
            "Hardhöhe": {
                tileSize: 0.4,
                offset: false,
                stripeW: 0.6,
                blindW: 0.4,
                stripGap: 0.0,
                alternatingBands: true,
                weatheredStripe: false,
                tileColor: '#757980'
            }
        };

        const config = Object.assign({}, stationFloorConfigs["default"]);
        const spec = stationFloorConfigs[station.name];
        if (spec) {
            Object.assign(config, spec);
        }

        const pixelsPerMeter = 100;
        const W_pixels = Math.round(platWidth * pixelsPerMeter);
        const H_meters = config.alternatingBands ? 4.0 : 1.2;
        const H_pixels = Math.round(H_meters * pixelsPerMeter);

        const canvas = document.createElement('canvas');
        canvas.width = W_pixels;
        canvas.height = H_pixels;
        const cCtx = canvas.getContext('2d');

        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = W_pixels;
        bumpCanvas.height = H_pixels;
        const bCtx = bumpCanvas.getContext('2d');

        // Draw background grout
        cCtx.fillStyle = config.groutColor;
        cCtx.fillRect(0, 0, W_pixels, H_pixels);

        bCtx.fillStyle = '#000000';
        bCtx.fillRect(0, 0, W_pixels, H_pixels);

        const tileSizePx = config.tileSize * pixelsPerMeter;

        if (config.rotated) {
            cCtx.save();
            cCtx.translate(W_pixels / 2, H_pixels / 2);
            cCtx.rotate(Math.PI / 4);

            bCtx.save();
            bCtx.translate(W_pixels / 2, H_pixels / 2);
            bCtx.rotate(Math.PI / 4);

            const limit = Math.max(W_pixels, H_pixels) * 2;
            for (let y = -limit; y < limit; y += tileSizePx) {
                for (let x = -limit; x < limit; x += tileSizePx) {
                    this.drawSingleTile(cCtx, bCtx, x, y, tileSizePx, config);
                }
            }
            cCtx.restore();
            bCtx.restore();
        } else {
            const rows = Math.round(H_pixels / tileSizePx);
            const cols = Math.ceil(W_pixels / tileSizePx) + 2;
            for (let r = 0; r < rows; r++) {
                const y = r * tileSizePx;
                const isOffsetRow = config.offset && (r % 2 === 1);
                const offsetPx = isOffsetRow ? (tileSizePx / 2) : 0;

                for (let c = -1; c < cols; c++) {
                    const x = c * tileSizePx + offsetPx;
                    let tileColor = config.tileColor;
                    let groutColor = config.groutColor;

                    if (config.alternatingBands) {
                        if (r >= 5) {
                            tileColor = '#909291';
                            groutColor = '#4b5563';
                        } else {
                            tileColor = '#757980';
                            groutColor = '#374151';
                        }
                    }

                    this.drawSingleTile(cCtx, bCtx, x, y, tileSizePx, config, tileColor, groutColor);
                }
            }
        }

        // Draw overlays
        const drawStripeAndBlind = (isLeft) => {
            const stripeW_px = config.stripeW * pixelsPerMeter;
            const gapW_px = config.stripGap * pixelsPerMeter;
            const blindW_px = config.blindW * pixelsPerMeter;

            const stripeLeft = isLeft ? 0 : (W_pixels - stripeW_px);
            const blindLeft = isLeft ? (stripeW_px + gapW_px) : (W_pixels - stripeW_px - gapW_px - blindW_px);

            // 1. Draw Safety Stripe
            cCtx.fillStyle = config.weatheredStripe ? '#eaeaea' : '#f8fafc';
            cCtx.fillRect(stripeLeft, 0, stripeW_px, H_pixels);

            bCtx.fillStyle = '#ffffff';
            bCtx.fillRect(stripeLeft, 0, stripeW_px, H_pixels);

            if (config.weatheredStripe) {
                // Add weathering spots (increased opacity and count)
                cCtx.fillStyle = 'rgba(0, 0, 0, 0.28)';
                for (let i = 0; i < 40; i++) {
                    const wx = stripeLeft + Math.random() * stripeW_px;
                    const wy = Math.random() * H_pixels;
                    const wSize = 1 + Math.random() * 2.5;
                    cCtx.fillRect(wx, wy, wSize, wSize);
                }
                // Add edge wear
                cCtx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                for (let i = 0; i < 20; i++) {
                    const wx = isLeft ? (stripeW_px - 2 + Math.random() * 2) : (stripeLeft + Math.random() * 2);
                    cCtx.fillRect(wx, Math.random() * H_pixels, 1.5, 2 + Math.random() * 5);
                }
            }

            // 2. Draw Tactile Blind Stripe
            const blindColor = config.blindColor || '#2d3130';
            cCtx.fillStyle = blindColor;
            cCtx.fillRect(blindLeft, 0, blindW_px, H_pixels);

            bCtx.fillStyle = '#e6e6e6';
            bCtx.fillRect(blindLeft, 0, blindW_px, H_pixels);

            const step = 4; // draw a groove every 4 pixels (4 cm)
            const numRibs = Math.floor(blindW_px / step);
            const startOffset = (blindW_px - (numRibs - 1) * step) / 2;

            for (let r = 0; r < numRibs; r++) {
                const rx = blindLeft + startOffset + r * step;

                // Draw dark groove (black)
                cCtx.strokeStyle = '#050505';
                cCtx.lineWidth = 1.5;
                cCtx.beginPath();
                cCtx.moveTo(rx, 0);
                cCtx.lineTo(rx, H_pixels);
                cCtx.stroke();

                // Draw light rib highlight (light grey) for high 3D contrast
                cCtx.strokeStyle = '#555f5c';
                cCtx.lineWidth = 1.0;
                cCtx.beginPath();
                cCtx.moveTo(rx + 1.2, 0);
                cCtx.lineTo(rx + 1.2, H_pixels);
                cCtx.stroke();

                bCtx.fillStyle = '#111111';
                bCtx.fillRect(rx - 1, 0, 2, H_pixels);
            }
        };

        if (hasLeftStripe) drawStripeAndBlind(true);
        if (hasRightStripe) drawStripeAndBlind(false);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.ClampToEdgeWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;

        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.015
        });
    }

    drawSingleTile(cCtx, bCtx, x, y, size, config, customColor, customGrout) {
        const border = 0.5;
        const tileW = size - border * 2;
        const tileH = size - border * 2;
        const tileX = x + border;
        const tileY = y + border;

        let color = customColor || config.tileColor;
        cCtx.fillStyle = color;
        cCtx.fillRect(tileX, tileY, tileW, tileH);

        bCtx.fillStyle = '#ffffff';
        bCtx.fillRect(tileX, tileY, tileW, tileH);

        if (config.terracotta) {
            cCtx.save();
            cCtx.beginPath();
            cCtx.rect(tileX, tileY, tileW, tileH);
            cCtx.clip();
            for (let i = 0; i < 8; i++) {
                cCtx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
                cCtx.fillRect(tileX + Math.random() * tileW, tileY + Math.random() * tileH, 2, 2);
            }
            cCtx.restore();
        }

        if (config.marbling) {
            cCtx.save();
            cCtx.beginPath();
            cCtx.rect(tileX, tileY, tileW, tileH);
            cCtx.clip();

            cCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)';
            cCtx.lineWidth = 1 + Math.random();
            cCtx.beginPath();
            cCtx.moveTo(tileX + Math.random() * tileW, tileY);
            cCtx.bezierCurveTo(
                tileX + Math.random() * tileW, tileY + tileH * 0.33,
                tileX + Math.random() * tileW, tileY + tileH * 0.66,
                tileX + Math.random() * tileW, tileY + tileH
            );
            cCtx.stroke();
            cCtx.restore();
        }

        if (config.weatheredEdges) {
            cCtx.save();
            cCtx.strokeStyle = '#757980';
            cCtx.lineWidth = 3.0;
            cCtx.strokeRect(tileX + 1.5, tileY + 1.5, tileW - 3.0, tileH - 3.0);

            // Add organic weathering spots along tile borders for high contrast
            cCtx.fillStyle = '#757980';
            cCtx.globalAlpha = 0.6;
            for (let i = 0; i < 6; i++) {
                const edge = Math.floor(Math.random() * 4);
                let sx, sy;
                if (edge === 0) { // top
                    sx = tileX + Math.random() * tileW;
                    sy = tileY + Math.random() * 5;
                } else if (edge === 1) { // bottom
                    sx = tileX + Math.random() * tileW;
                    sy = tileY + tileH - Math.random() * 5;
                } else if (edge === 2) { // left
                    sx = tileX + Math.random() * 5;
                    sy = tileY + Math.random() * tileH;
                } else { // right
                    sx = tileX + tileW - Math.random() * 5;
                    sy = tileY + Math.random() * tileH;
                }
                const sSize = 1.5 + Math.random() * 2.5;
                cCtx.fillRect(sx - sSize/2, sy - sSize/2, sSize, sSize);
            }
            cCtx.restore();
        }
    }

    buildStation(station) {
        // --- MODULAR ARCHITECTURE HOOK ---
        // Each station will eventually have its own Builder class in src/simulator/stations/
        // if (station.name === "Aufseßplatz") return new AufsessplatzBuilder(this, station).build(); // Example for future
        if (station.name === "Rathaus") return new RathausBuilder(this, station).build();
        if (station.name === "Lorenzkirche") return new LorenzkircheBuilder(this, station).build();
        // Plärrer is a bespoke stacked station built entirely in TrackManager.buildPlaerrer
        // (two levels, offset platforms, hall, diverging tubes); skip the generic station.
        if (station.name === "Plärrer") return new THREE.Group();
        
        // --- LEGACY FALLBACK ---
        const stationGroup = new THREE.Group();
        
        const centerPos = this.sim.getTrackPosition(station.position);
        const centerTangent = this.sim.getTrackTangent(station.position);
        const centerAngle = Math.atan2(centerTangent.x, centerTangent.z);
        const spacing = this.sim.getTrackSpacing(station.position);

        stationGroup.position.copy(centerPos);
        stationGroup.rotation.y = centerAngle;
        stationGroup.updateMatrixWorld(true);

        const platLength = 2 * station.halfLength; // platform length (m) from the geojson spread
        const platTopY = 0.865;   // Bahnsteig-OK auf Zugboden-Höhe (ebener Einstieg, 1:1)
        const platHeight = 1.165; // Deck von Boden (-0.30) bis 0.865
        const platCenterY = 0.2825;
        const isSideStation = station.side;
        const isScharfreiterring = (station.name === "Scharfreiterring");
        // const signMaterial = this.createStationSignMaterial(station.name);
        // const signGeom = new THREE.BoxGeometry(0.08, 0.6, 2.0); 

        let eberhardshofRoofMat = null;
        let eberhardshofTubeGeom = null;
        if (station.name === "Eberhardshof") {
            eberhardshofRoofMat = new THREE.MeshLambertMaterial({
                color: '#a8a29e', // concrete stone-grey
                
                
                side: THREE.DoubleSide
            });
            eberhardshofTubeGeom = new THREE.CylinderGeometry(1.25, 1.25, 5.0, 16, 1, true, 0, Math.PI);
            eberhardshofTubeGeom.rotateY(-Math.PI / 2);
            eberhardshofTubeGeom.rotateX(Math.PI / 2);
        }

        let jakobinenstrasseSandstoneMat = null;
        let jakobinenstrasseCeilingLightMat = null;
        let jakobinenstrasseCeilingDarkMat = null;
        let jakobinenstrasseTextMat = null;

        let aufsessplatzRedTileMat = null;
        let aufsessplatzWhiteTileMat = null;
        let aufsessplatzStripeMat = null;
        let aufsessplatzCeilingGeom = null;
        let aufsessplatzCeilingLightMat = null;
        let aufsessplatzCeilingDarkMat = null;

        if (station.name === "Jakobinenstraße") {
            jakobinenstrasseSandstoneMat = this.createSandstoneMaterial();
            jakobinenstrasseCeilingLightMat = new THREE.MeshLambertMaterial({ color: '#d1d5db' });
            jakobinenstrasseCeilingDarkMat = new THREE.MeshLambertMaterial({ color: '#9ca3af' });

            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#27272a';
            ctx.font = 'bold 80px "Jost Regular", "Outfit", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("JAKOBINENSTRASSE", canvas.width / 2, canvas.height / 2);
            ctx.strokeStyle = '#27272a';
            ctx.lineWidth = 2.0;
            ctx.strokeText("JAKOBINENSTRASSE", canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            jakobinenstrasseTextMat = new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true
            });
        } else if (station.name === "Aufseßplatz") {
            aufsessplatzRedTileMat = this.createTiledMaterial('#ff5f38', '#7a1a08', 0.15);
            aufsessplatzWhiteTileMat = this.createTiledMaterial('#fcfcfc', '#7a1a08', 0.15);
            aufsessplatzStripeMat = this.createWallStripeMaterial("Aufseßplatz", '#ff5f38', '#ffffff');
        }

        // Slat ceiling in the Aufseßplatz look, shared by the three Langwasser-branch
        // stations as well. The plates between the slat field and the side walls use the
        // rough concrete of the tunnel portals / Plärrer walls (not plain dark grey).
        const hasSlatCeiling = ["Aufseßplatz", "Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte"].includes(station.name);
        let slatCeilingConcreteMat = null;
        if (hasSlatCeiling) {
            // Slat texture canvas: 80% slat (#e2e8f0), 20% gap (#111111)
            const canvasSlat = document.createElement('canvas');
            canvasSlat.width = 16;
            canvasSlat.height = 128;
            const ctxSlat = canvasSlat.getContext('2d');
            const slatH = Math.round(128 * 0.8);
            ctxSlat.fillStyle = '#e2e8f0';
            ctxSlat.fillRect(0, 0, 16, slatH);
            ctxSlat.fillStyle = '#111111';
            ctxSlat.fillRect(0, slatH, 16, 128 - slatH);

            const slatTex = new THREE.CanvasTexture(canvasSlat);
            slatTex.wrapS = THREE.RepeatWrapping;
            slatTex.wrapT = THREE.RepeatWrapping;
            slatTex.colorSpace = THREE.SRGBColorSpace;
            slatTex.anisotropy = 8;
            slatTex.repeat.set(1, 5); // 5 repeats per meter -> repeats every 0.2 meters

            aufsessplatzCeilingLightMat = new THREE.MeshLambertMaterial({
                map: slatTex,
                side: THREE.DoubleSide
            });
            aufsessplatzCeilingDarkMat = new THREE.MeshLambertMaterial({ color: '#111111' });

            // Rough concrete for the side plates, tiled every 10m along the sweep (same
            // recipe as the Plärrer ceiling clone — buildSweptBar's material clone shares
            // this texture instance, so the repeat survives).
            slatCeilingConcreteMat = this.stationConcreteWallMat.clone();
            slatCeilingConcreteMat.map = this.stationConcreteWallMat.map.clone();
            slatCeilingConcreteMat.map.wrapS = slatCeilingConcreteMat.map.wrapT = THREE.RepeatWrapping;
            slatCeilingConcreteMat.map.repeat.set(1, 0.1);
            slatCeilingConcreteMat.map.needsUpdate = true;
            if (slatCeilingConcreteMat.bumpMap) {
                slatCeilingConcreteMat.bumpMap = this.stationConcreteWallMat.bumpMap.clone();
                slatCeilingConcreteMat.bumpMap.wrapS = slatCeilingConcreteMat.bumpMap.wrapT = THREE.RepeatWrapping;
                slatCeilingConcreteMat.bumpMap.repeat.set(1, 0.1);
                slatCeilingConcreteMat.bumpMap.needsUpdate = true;
            }
        }

        const wallPresets = {
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
                topColor: '#ffffff',
                topGrout: '#7e8a93',
                stripeBg: '#184763',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Gemeinschaftshaus": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#ffffff',
                topGrout: '#7e8a93',
                stripeBg: '#41525a',
                stripeText: '#ffffff',
                flatTiles: true
            },
            "Langwasser Mitte": {
                bottomColor: '#41525a',
                bottomGrout: '#222d32',
                topColor: '#ffffff',
                topGrout: '#7e8a93',
                stripeBg: '#51301b',
                stripeText: '#ffffff',
                flatTiles: true
            }
        };

        let wallTextMat = null;
        if (station.name === "Hardhöhe") {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#4b5563'; // medium-dark grey
            ctx.font = 'bold 90px "Jost Regular", "Outfit", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("HARDHÖHE", canvas.width / 2, canvas.height / 2);
            ctx.strokeStyle = '#4b5563';
            ctx.lineWidth = 2.0;
            ctx.strokeText("HARDHÖHE", canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            wallTextMat = new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true
            });
        } 

        const schPlatHalfWidth = 2.98; 
        const schPlatCenter = 4.21; 
        const schInnerEdge = schPlatCenter - schPlatHalfWidth; 
        const schOuterEdge = schPlatCenter + schPlatHalfWidth; 
        const schTrackCenter = schInnerEdge; 
        const schThirdRailX = schTrackCenter + 1.1;
        const schBallastWidth = schThirdRailX * 2;

        const isSpecialLangwasser = false;
        const S_len = 1.0; // Bahnsteig-Längsmaßstab: 1 Einheit = 1 Meter

        // Subdivide platform and walls into 5m segments spanning the geojson platform length
        const subLen = 5.0 * S_len;
        const numSub = Math.max(8, Math.round(platLength / subLen));

        for (let j = 0; j < numSub; j++) {
            const localZ_mid = -(numSub * subLen) / 2 + j * subLen + subLen / 2;
            const s_mid = station.position + localZ_mid;

            const pos = this.sim.getTrackPosition(s_mid);
            const tangent = this.sim.getTrackTangent(s_mid);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s_mid);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
            const localPos = stationGroup.worldToLocal(pos.clone());

            // 1. Ground & Ceiling
            const localSchPlatHalfWidth = 3.5;
            const localSchPlatCenter = spacing / 2 - 5.03;
            const localSchTrackCenter = Math.max(1.23, spacing / 2 - 10.06);

            if (isScharfreiterring) {
                // Twin floor + ceiling slabs (solid) as continuous swept bars, built once.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const cy = centerPos.y;
                    const off = (s) => this.sim.getTrackSpacing(s) / 2 - 5.03;
                    const flr = [this.materials.platform, this.materials.platform];
                    const cel = [this.materials.ceiling, this.materials.ceiling];
                    for (const sign of [1, -1]) {
                        this.buildSweptBar(stationGroup, sA, sB, () => localSchPlatHalfWidth, cy - 0.32, cy - 0.42, flr, 1.2, (s) => sign * off(s));
                        this.buildSweptBar(stationGroup, sA, sB, () => localSchPlatHalfWidth, cy + 4.76, cy + 4.56, cel, 1.2, (s) => sign * off(s));
                    }
                }
            } else if (station.name === "Hardhöhe") {
                const groundWidth = spacing + 2.6; // double track tunnel width
                const platWidth = spacing - 3.08; // platform width (Kante +0.43 m für vollbreiten Zug)
                const trackWidth = (groundWidth - platWidth) / 2; // track bed width on each side
                
                // Track direction and normal vectors
                const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));

                // 1. Floor: track beds (ballast) as continuous swept strips, built once.
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const cy = centerPos.y;
                    const bedProfile = [{ x: -trackWidth / 2, y: -0.375 }, { x: trackWidth / 2, y: -0.375 }];
                    const bedOff = (s) => (this.sim.getTrackSpacing(s) - 3.08 + trackWidth) / 2; // (platWidth+trackWidth)/2
                    this.buildSweptProfile(stationGroup, sA, sB, bedProfile, cy, (s) => -bedOff(s), this.materials.ballast, 1);
                    this.buildSweptProfile(stationGroup, sA, sB, bedProfile, cy, (s) => bedOff(s), this.materials.ballast, 1);
                }

                // 2. Ceiling (high steel-blue, 4.8m, with daylight inlets):
                const ceilMatBlue = new THREE.MeshLambertMaterial({ color: '#3a5f78' }); // steel-blue
                const ceilMatConcrete = new THREE.MeshLambertMaterial({ color: '#cccccc' }); // light concrete for skylight

                const hasSkylight = (j >= 2 && j <= 15 && j % 2 === 0);
                if (hasSkylight) {
                    const ceilW = (groundWidth - 3.5) / 2;
                    const ceilL = new THREE.Mesh(new THREE.BoxGeometry(ceilW, 0.2, subLen), ceilMatBlue);
                    ceilL.position.copy(localPos).addScaledVector(localNorm, -(groundWidth + 3.5) / 4);
                    ceilL.position.y = 4.8;
                    ceilL.rotation.y = rotY;
                    
                    const ceilR = new THREE.Mesh(new THREE.BoxGeometry(ceilW, 0.2, subLen), ceilMatBlue);
                    ceilR.position.copy(localPos).addScaledVector(localNorm, (groundWidth + 3.5) / 4);
                    ceilR.position.y = 4.8;
                    ceilR.rotation.y = rotY;
                    
                    const ceilF = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 0.75), ceilMatBlue);
                    ceilF.position.copy(localPos).addScaledVector(localDir, -2.125);
                    ceilF.position.y = 4.8;
                    ceilF.rotation.y = rotY;
                    
                    const ceilB = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 0.75), ceilMatBlue);
                    ceilB.position.copy(localPos).addScaledVector(localDir, 2.125);
                    ceilB.position.y = 4.8;
                    ceilB.rotation.y = rotY;
                    
                    stationGroup.add(ceilL, ceilR, ceilF, ceilB);
                    
                    // Recessed skylight walls (from y=4.8 to y=5.6):
                    const recWL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 3.5), ceilMatConcrete);
                    recWL.position.copy(localPos).addScaledVector(localNorm, -1.75);
                    recWL.position.y = 5.2;
                    recWL.rotation.y = rotY;
                    
                    const recWR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 3.5), ceilMatConcrete);
                    recWR.position.copy(localPos).addScaledVector(localNorm, 1.75);
                    recWR.position.y = 5.2;
                    recWR.rotation.y = rotY;
                    
                    const recWF = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.1), ceilMatConcrete);
                    recWF.position.copy(localPos).addScaledVector(localDir, -1.75);
                    recWF.position.y = 5.2;
                    recWF.rotation.y = rotY;
                    
                    const recWB = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.8, 0.1), ceilMatConcrete);
                    recWB.position.copy(localPos).addScaledVector(localDir, 1.75);
                    recWB.position.y = 5.2;
                    recWB.rotation.y = rotY;
                    
                    // Skylight basic cap:
                    const skylightMat = new THREE.MeshBasicMaterial({ color: '#e0f2fe' });
                    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 3.5), skylightMat);
                    cap.position.copy(localPos);
                    cap.position.y = 5.6;
                    cap.rotation.y = rotY;
                    
                    stationGroup.add(recWL, recWR, recWF, recWB, cap);
                } else {
                    const ceilSolid = new THREE.Mesh(new THREE.BoxGeometry(groundWidth, 0.2, subLen), ceilMatBlue);
                    ceilSolid.position.copy(localPos);
                    ceilSolid.position.y = 4.8;
                    ceilSolid.rotation.y = rotY;
                    stationGroup.add(ceilSolid);
                }
                
                // 3. Continuous light strips and hangers:
                const lightOff = spacing / 2 - 1.185;
                const lightY = 3.8;
                
                const lightDuctMat = new THREE.MeshLambertMaterial({ color: '#334155' });
                const lightEmissiveMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
                const hangerMat = new THREE.MeshLambertMaterial({ color: '#64748b' });
                
                const posLightL = pos.clone().addScaledVector(normal, -lightOff);
                const posLightR = pos.clone().addScaledVector(normal, lightOff);
                
                const localLightL = stationGroup.worldToLocal(posLightL);
                const localLightR = stationGroup.worldToLocal(posLightR);
                
                const ductL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, subLen), lightDuctMat);
                ductL.position.copy(localLightL);
                ductL.position.y = lightY;
                ductL.rotation.y = rotY;
                
                const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, subLen), lightEmissiveMat);
                glowL.position.copy(localLightL);
                glowL.position.y = lightY - 0.04;
                glowL.rotation.y = rotY;
                
                const ductR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, subLen), lightDuctMat);
                ductR.position.copy(localLightR);
                ductR.position.y = lightY;
                ductR.rotation.y = rotY;
                
                const glowR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, subLen), lightEmissiveMat);
                glowR.position.copy(localLightR);
                glowR.position.y = lightY - 0.04;
                glowR.rotation.y = rotY;
                
                stationGroup.add(ductL, glowL, ductR, glowR);
                
                const rodGeom = new THREE.CylinderGeometry(0.015, 0.015, 4.8 - lightY, 6);
                
                const rodL1 = new THREE.Mesh(rodGeom, hangerMat);
                rodL1.position.copy(localLightL).addScaledVector(localDir, -1.5);
                rodL1.position.y = lightY + (4.8 - lightY) / 2;
                rodL1.rotation.y = rotY;
                
                const rodL2 = new THREE.Mesh(rodGeom, hangerMat);
                rodL2.position.copy(localLightL).addScaledVector(localDir, 1.5);
                rodL2.position.y = lightY + (4.8 - lightY) / 2;
                rodL2.rotation.y = rotY;
                
                const rodR1 = new THREE.Mesh(rodGeom, hangerMat);
                rodR1.position.copy(localLightR).addScaledVector(localDir, -1.5);
                rodR1.position.y = lightY + (4.8 - lightY) / 2;
                rodR1.rotation.y = rotY;
                
                const rodR2 = new THREE.Mesh(rodGeom, hangerMat);
                rodR2.position.copy(localLightR).addScaledVector(localDir, 1.5);
                rodR2.position.y = lightY + (4.8 - lightY) / 2;
                rodR2.rotation.y = rotY;
                
                stationGroup.add(rodL1, rodL2, rodR1, rodR2);
                
                // 4. Slanted ceiling panels (5 rows on each side, only at j = 7, 9, 11, 13)
                const artIndices = [7, 9, 11, 13];
                if (artIndices.includes(j)) {
                    const panelWidth = 1.0;
                    const panelLen = 5.2;
                    const panelMatLighterBlue = new THREE.MeshLambertMaterial({ color: '#5180a4' });
                    
                    // Left Track Ceiling Panels - facing platform
                    const xStartL = -spacing / 2 - 1.4;
                    const xEndL = -spacing / 2 + 1.185;
                    const stepL = (xEndL - xStartL) / 5;
                    
                    for (let r = 0; r < 5; r++) {
                        const x_r = xStartL + (r + 0.5) * stepL;
                        const y_r = 4.65 - r * 0.08; // steps down from left wall to platform
                        
                        const panelPos = localPos.clone().addScaledVector(localNorm, x_r);
                        panelPos.y = y_r;
                        
                        const panel = new THREE.Mesh(new THREE.BoxGeometry(panelWidth, 0.02, panelLen), panelMatLighterBlue);
                        panel.position.copy(panelPos);
                        panel.rotation.set(0, rotY, -0.65); // slant towards platform
                        stationGroup.add(panel);
                    }
                    
                    // Right Track Ceiling Panels - facing platform
                    const xStartR = spacing / 2 - 1.185;
                    const xEndR = spacing / 2 + 1.4;
                    const stepR = (xEndR - xStartR) / 5;
                    
                    for (let r = 0; r < 5; r++) {
                        const x_r = xStartR + (r + 0.5) * stepR;
                        const y_r = 4.65 - (4 - r) * 0.08; // steps down from right wall to platform
                        
                        const panelPos = localPos.clone().addScaledVector(localNorm, x_r);
                        panelPos.y = y_r;
                        
                        const panel = new THREE.Mesh(new THREE.BoxGeometry(panelWidth, 0.02, panelLen), panelMatLighterBlue);
                        panel.position.copy(panelPos);
                        panel.rotation.set(0, rotY, 0.65); // slant towards platform
                        stationGroup.add(panel);
                    }
                }
            } else {
                const groundWidth = isSideStation ? (spacing + 11.1) : (spacing + 3.66);
                // Floor as ONE continuous swept slab (solid colour -> no UV concerns), built once
                // on j===0, tapering with the inter-track gap. Replaces the per-5m boxes.
                if (j === 0) {
                    const gHalfW = (s) => (this.sim.getTrackSpacing(s) + (isSideStation ? 11.1 : 3.66)) / 2;
                    this.buildSweptBar(stationGroup, station.position - platLength / 2, station.position + platLength / 2,
                        gHalfW, centerPos.y - 0.33, centerPos.y - 0.43,
                        [this.materials.platform, this.materials.platform], 1.2);
                }

                if (station.name === "Eberhardshof") {
                    // Central slab + 4 barrel vaults as continuous swept meshes, built once.
                    if (j === 0) {
                        const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                        const cy = centerPos.y;
                        // 1. central longitudinal slab (flat, solid)
                        this.buildSweptBar(stationGroup, sA, sB, () => 1.5, cy + 4.85, cy + 4.45, [this.materials.pillar, this.materials.pillar], 1.2);
                        // 2. four half-cylinder barrel vaults (semicircle cross-section swept along the track)
                        // half-circle opening UPWARD (concave up, like a trough): y dips below the rim
                        const arc = [];
                        for (let k = 0; k <= 16; k++) { const t = Math.PI * k / 16; arc.push({ x: 1.25 * Math.cos(t), y: 4.85 - 1.25 * Math.sin(t) }); }
                        [-3.75, -1.25, 1.25, 3.75].forEach(tx => {
                            this.buildSweptProfile(stationGroup, sA, sB, arc, cy, () => tx, eberhardshofRoofMat, 1e9);
                        });
                    }
                } else if (station.name === "Jakobinenstraße") {
                    const slopeAngle = Math.atan2(1.0, 1.25);
                    const plateOverlap = 0.08; // kleine Überlappung an den Knicklinien (Tälern), um Lücken zu schließen
                    const plateLength = Math.sqrt(1.25 * 1.25 + 1.0 * 1.0) + plateOverlap;
                    const plateWidth = groundWidth;

                    // Alternate ceiling segment colors: light vs dark concrete
                    const ceilMat = (j % 2 === 0) ? jakobinenstrasseCeilingLightMat : jakobinenstrasseCeilingDarkMat;

                    const p1aPosWorld = pos.clone().addScaledVector(tangent, -1.875);
                    const plate1a = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate1a.position.copy(stationGroup.worldToLocal(p1aPosWorld));
                    plate1a.position.y = 5.5; // shifted up
                    plate1a.rotation.set(-slopeAngle, rotY, 0, 'YXZ');

                    const p1bPosWorld = pos.clone().addScaledVector(tangent, -0.625);
                    const plate1b = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate1b.position.copy(stationGroup.worldToLocal(p1bPosWorld));
                    plate1b.position.y = 5.5;
                    plate1b.rotation.set(slopeAngle, rotY, 0, 'YXZ');
                    
                    const p2aPosWorld = pos.clone().addScaledVector(tangent, 0.625);
                    const plate2a = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate2a.position.copy(stationGroup.worldToLocal(p2aPosWorld));
                    plate2a.position.y = 5.5;
                    plate2a.rotation.set(-slopeAngle, rotY, 0, 'YXZ');

                    const p2bPosWorld = pos.clone().addScaledVector(tangent, 1.875);
                    const plate2b = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate2b.position.copy(stationGroup.worldToLocal(p2bPosWorld));
                    plate2b.position.y = 5.5;
                    plate2b.rotation.set(slopeAngle, rotY, 0, 'YXZ');

                    stationGroup.add(plate1a, plate1b, plate2a, plate2b);

                    // Concrete light girders + their neon tubes, swept continuously along the
                    // true curve (built once), instead of a straight 5m box per segment. The
                    // vertical rod hangers connecting girders to the folded ceiling peaks stay
                    // discrete (real periodic fixtures, at the same Z=+-1.25-per-house spacing).
                    const girderH = 0.25; // heightened from 0.12
                    const girderY = 3.775; // positioned so the neon tubes' bottom edge is flush with display boards (3.60m)
                    const girderMat = this.materials.boardHanger; // solid dark color
                    const lightOffFn = (s) => this.sim.getTrackSpacing(s) / 2 - 1.185;
                    const tubeY = girderY - girderH / 2 - 0.035; // hang slightly below the bottom of the girder
                    const ceilHangerY = 6.0; // peak of the two houses is at y = 6.0m
                    const girderTopY = girderY + girderH / 2;
                    const hangerLen = ceilHangerY - girderTopY;
                    const hangerY = (ceilHangerY + girderTopY) / 2;
                    const hangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 8);

                    if (j === 0) {
                        const R2 = station.position - (numSub * subLen) / 2;
                        const gsA = R2, gsB = R2 + numSub * subLen;
                        const girderMats = [girderMat, girderMat];
                        const tubeMats = [this.materials.lightTube, this.materials.lightTube];
                        for (const sign of [1, -1]) {
                            this.buildSweptBar(stationGroup, gsA, gsB, () => 0.125, centerPos.y + girderY + girderH / 2, centerPos.y + girderY - girderH / 2, girderMats, 1.2, (s) => sign * lightOffFn(s));
                            this.buildSweptBar(stationGroup, gsA, gsB, () => 0.015, centerPos.y + tubeY + 0.015, centerPos.y + tubeY - 0.015, tubeMats, 1.2, (s) => sign * (lightOffFn(s) - 0.05));
                            this.buildSweptBar(stationGroup, gsA, gsB, () => 0.015, centerPos.y + tubeY + 0.015, centerPos.y + tubeY - 0.015, tubeMats, 1.2, (s) => sign * (lightOffFn(s) + 0.05));
                        }

                        for (let jj = 0; jj < numSub; jj++) {
                            const s_mid = gsA + (jj + 0.5) * subLen;
                            [-1.25, 1.25].forEach(tOff => {
                                const s = s_mid + tOff;
                                const hPos = this.sim.getTrackPosition(s);
                                const hTan = this.sim.getTrackTangent(s);
                                const hRotY = Math.atan2(hTan.x, hTan.z) - centerAngle;
                                const hNormal = new THREE.Vector3(-hTan.z, 0, hTan.x);
                                const hOff = lightOffFn(s);
                                [1, -1].forEach(sign => {
                                    const hanger = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                                    hanger.position.copy(stationGroup.worldToLocal(hPos.clone().addScaledVector(hNormal, sign * hOff)));
                                    hanger.position.y = hangerY;
                                    hanger.rotation.y = hRotY;
                                    stationGroup.add(hanger);
                                });
                            });
                        }
                    }
                } else {
                    const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
                    const isLwNord = (station.name === "Langwasser Nord");
                    const ceilY = isMax ? 5.84 : 4.66; // Decke quer-mitskaliert (×1.4134) für 1×-Profil
                    const ceilW = isLwNord ? (spacing - 2.22) : groundWidth;

                    if (hasSlatCeiling) {
                        // Dark background plate + rough-concrete side plates + slats as continuous
                        // swept slabs (built once on j===0). This aligns the slat texture with the
                        // station curve. Shared by Aufseßplatz + the three Langwasser-branch stations;
                        // the plates between slat field and side walls use the tunnel-portal concrete.
                        if (j === 0) {
                            const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                            const cy = centerPos.y;
                            const bpHalf = (s) => (this.sim.getTrackSpacing(s) - 2.8) / 2;
                            const tDist = (s) => this.sim.getTrackSpacing(s) / 2 + 0.215; // 3.23m plate, half 1.615
                            const plateMats = [slatCeilingConcreteMat, slatCeilingConcreteMat];
                            this.buildSweptBar(stationGroup, sA, sB, bpHalf, cy + 4.595, cy + 4.585, [aufsessplatzCeilingDarkMat, aufsessplatzCeilingDarkMat], 1.2);
                            this.buildSweptBar(stationGroup, sA, sB, () => 1.615, cy + 4.595, cy + 4.585, plateMats, 1.2, (s) => -tDist(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => 1.615, cy + 4.595, cy + 4.585, plateMats, 1.2, (s) => tDist(s));

                            // 3. Slat texture ceiling swept bar
                            this.buildSweptBar(stationGroup, sA, sB, bpHalf, cy + 4.58, cy + 4.57, [aufsessplatzCeilingLightMat, aufsessplatzCeilingDarkMat], 1.2);
                        }
                    } else if (station.name !== "Plärrer") {
                        // Plärrer's flat ceiling is omitted: its bespoke hall (TrackManager
                        // buildPlaerrer) opens up to the surface skylights instead.
                        // Ceiling as ONE continuous swept slab (solid colour), built once on j===0.
                        if (j === 0) {
                            const cHalfW = (s) => (isLwNord ? (this.sim.getTrackSpacing(s) - 2.22)
                                                            : (this.sim.getTrackSpacing(s) + (isSideStation ? 11.1 : 3.66))) / 2;
                            let ceilMat = isMax ? this.maximilianstrasseCeilingMat : this.materials.ceiling;
                            if (station.name === "Messe") {
                                this.materials.messeBlue = this.materials.messeBlue || new THREE.MeshLambertMaterial({ color: '#3a92d8' });
                                ceilMat = this.materials.messeBlue;
                            }

                            if (station.name === "Messe") {
                                const sStart = station.position - platLength / 2;
                                const sEnd = station.position + platLength / 2;

                                // Left side roof slab (closed track/platform side)
                                this.buildSweptBar(stationGroup, sStart, sEnd,
                                    (s) => (cHalfW(s) - 2.3) / 2, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], 1.2, (s) => -(cHalfW(s) + 2.3) / 2);

                                // Right side roof slab (closed track/platform side)
                                this.buildSweptBar(stationGroup, sStart, sEnd,
                                    (s) => (cHalfW(s) - 2.3) / 2, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], 1.2, (s) => (cHalfW(s) + 2.3) / 2);

                                // Center roof slab (with cutouts for escalators)
                                // Section 1: Langwasser outer end
                                this.buildSweptBar(stationGroup, sStart, station.position + 0.0,
                                    () => 2.3, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], 1.2, () => 0);

                                // Section 2: Concourse building zone
                                this.buildSweptBar(stationGroup, station.position + 8.4, station.position + 31.6,
                                    () => 2.3, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], 1.2, () => 0);

                                // Section 3: Fürth outer end
                                this.buildSweptBar(stationGroup, station.position + 40.0, sEnd,
                                    () => 2.3, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], 1.2, () => 0);

                                // Build longitudinal concrete beams connecting the pillars continuously
                                this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
                                const beamMats = [this.materials.messeConcrete, this.materials.messeConcrete];
                                const pillOffsetFn = (s) => (this.sim.getTrackSpacing(s) - 3.08) / 2 - 4.0;
                                const cy = centerPos.y;

                                this.buildSweptBar(stationGroup, sStart, sEnd, () => 0.25, cy + ceilY - 0.1, cy + ceilY - 0.1 - 0.45, beamMats, 1.2, (s) => -pillOffsetFn(s));
                                this.buildSweptBar(stationGroup, sStart, sEnd, () => 0.25, cy + ceilY - 0.1, cy + ceilY - 0.1 - 0.45, beamMats, 1.2, (s) => pillOffsetFn(s));
                            } else {
                                const sA = station.position - platLength / 2;
                                const sB = station.position + platLength / 2;
                                this.buildSweptBar(stationGroup, sA, sB,
                                    cHalfW, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                    [ceilMat, ceilMat], isMax ? 2.4 : 1.2);
                            }
                        }
                        if (station.name === "Messe") {
                            // Build a transverse concrete beam at each segment center, skipping the two cutout slots
                            if (!(localZ_mid > 0.0 && localZ_mid < 8.4) && !(localZ_mid > 31.6 && localZ_mid < 40.0)) {
                                this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
                                const beamWidth = spacing + 3.6;
                                const beamHeight = 0.45;
                                const beamDepth = 0.5;
                                const beamGeom = new THREE.BoxGeometry(beamWidth, beamHeight, beamDepth);
                                const beam = new THREE.Mesh(beamGeom, this.materials.messeConcrete);
                                beam.position.copy(localPos);
                                beam.position.y = ceilY - 0.1 - beamHeight / 2;
                                beam.rotation.y = rotY;
                                stationGroup.add(beam);
                            }
                        }
                    }

                    // Continuous neon lighting parallel to platform edge, mounted directly to the ceiling
                    const targetStations = ["Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte", "Aufseßplatz", "Maffeiplatz"];
                    if (targetStations.includes(station.name)) {
                        const lightOff = spacing / 2 - 1.185;
                        const ductW = 0.2;
                        const ductH = 0.06;
                        const glowW = 0.12;
                        const glowH = 0.02;
                        
                        const ductY = ceilY - 0.1 - ductH / 2; // flush under ceiling bottom (ceiling bottom is at ceilY - 0.1)
                        const glowY = ductY - ductH / 2 - glowH / 2; // directly under the duct
                        
                        const lightDuctMat = new THREE.MeshLambertMaterial({ color: '#334155' });
                        const lightEmissiveMat = this.materials.lightTube; // shared emissive basic material

                        // Light ducts + glow strips as continuous swept bars (built once on j===0),
                        // so they flow smoothly along curves instead of stepping per segment.
                        if (j === 0) {
                            const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                            const offFn = (s) => this.sim.getTrackSpacing(s) / 2 - 1.185;
                            const dM = [lightDuctMat, lightDuctMat];
                            const gM = [lightEmissiveMat, lightEmissiveMat];
                            const dTop = centerPos.y + ductY + ductH / 2, dBot = centerPos.y + ductY - ductH / 2;
                            const gTop = centerPos.y + glowY + glowH / 2, gBot = centerPos.y + glowY - glowH / 2;
                            this.buildSweptBar(stationGroup, sA, sB, () => ductW / 2, dTop, dBot, dM, 1.2, (s) => -offFn(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => ductW / 2, dTop, dBot, dM, 1.2, (s) => offFn(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => glowW / 2, gTop, gBot, gM, 1.2, (s) => -offFn(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => glowW / 2, gTop, gBot, gM, 1.2, (s) => offFn(s));
                        }
                    }


                }
            }

            // 2. Platform Decks & Safety Strips  (each deck = one continuous swept mesh,
            //    built once on j===0; the lateral centre offset tracks the inter-track gap)
            if (isSideStation) {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offFn = (s) => this.sim.getTrackSpacing(s) / 2 + 3.54;
                    const hwFn = () => 2.0; // 4.0 m wide decks
                    const matsL = this.getPlatformMaterials(station, 4.0, true, false);
                    const matsR = this.getPlatformMaterials(station, 4.0, false, true);
                    this.buildSweptBar(stationGroup, sA, sB, hwFn, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [matsL[0], matsL[2]], 1.2, (s) => offFn(s));
                    this.buildSweptBar(stationGroup, sA, sB, hwFn, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [matsR[0], matsR[2]], 1.2, (s) => -offFn(s));
                }
            } else if (isScharfreiterring) {
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offFn = (s) => this.sim.getTrackSpacing(s) / 2 - 5.03; // localSchPlatCenter
                    const hwFn = () => localSchPlatHalfWidth; // 3.5
                    const mats6 = this.getPlatformMaterials(station, localSchPlatHalfWidth * 2, true, true);
                    this.buildSweptBar(stationGroup, sA, sB, hwFn, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [mats6[0], mats6[2]], 1.2, (s) => offFn(s));
                    this.buildSweptBar(stationGroup, sA, sB, hwFn, centerPos.y + platTopY, centerPos.y + platTopY - platHeight, [mats6[0], mats6[2]], 1.2, (s) => -offFn(s));
                }
            } else {
                // Island platform deck as ONE continuous swept mesh (smooth curve + per-vertex
                // taper that follows the inter-track gap), built once on the first iteration.
                // Replaces the old per-5m boxes that looked faceted/gappy on curves. The deck is
                // only present where the two tracks leave room for it (platWidth > 0); where they
                // overlap (e.g. Plärrer, single-mapped) there is no island platform.
                if (j === 0) {
                    const centerSpacing = this.sim.getTrackSpacing(station.position);
                    if (centerSpacing - 3.08 > 0) {
                        const H_meters = (station.name === "Hardhöhe") ? 4.0 : 1.2;
                        const mats6 = this.getPlatformMaterials(station, centerSpacing - 3.08, true, true);
                        const halfWidthFn = (s) => Math.max(0.05, (this.sim.getTrackSpacing(s) - 3.08) / 2);
                        this.buildSweptBar(
                            stationGroup,
                            station.position - platLength / 2,
                            station.position + platLength / 2,
                            halfWidthFn,
                            centerPos.y + platTopY,            // top y, relative to station elevation
                            centerPos.y + platTopY - platHeight, // bottom y
                            [mats6[0], mats6[2]], // [sideMat, topMat]
                            H_meters
                        );
                    }
                }
            }

            // 3. Outer Walls & Railings
            const rightWallX = isSideStation ? (-spacing / 2 - 5.55) : (-spacing / 2 - 1.83);
            const leftWallX = isSideStation ? (spacing / 2 + 5.55) : (spacing / 2 + 1.83);
            const posWallL = pos.clone().addScaledVector(normal, leftWallX);
            const posWallR = pos.clone().addScaledVector(normal, rightWallX);

            if (isScharfreiterring) {
                const wallDist = spacing / 2 + 1.83;
                const pL = pos.clone().addScaledVector(normal, -wallDist);
                const pR = pos.clone().addScaledVector(normal, wallDist);
                const localPL = stationGroup.worldToLocal(pL.clone());
                const localPR = stationGroup.worldToLocal(pR.clone());

                // Low concrete wall + its 2-bar handrail (left side), and the single-bar fence
                // (right side), as continuous swept bars, built once. The lateral offset tracks
                // the inter-track gap exactly like the rest of the station. Only the vertical
                // support posts below stay discrete (real fence posts are periodic fixtures).
                if (j === 0) {
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const pillarMats = [this.materials.pillar, this.materials.pillar];
                    const railMats = [this.materials.boardHanger, this.materials.boardHanger];
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.1, centerPos.y + 1.5, centerPos.y, pillarMats, 1.2, (s) => -offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.025, centerPos.y + 1.975, centerPos.y + 1.925, railMats, 1.2, (s) => -offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.025, centerPos.y + 2.425, centerPos.y + 2.375, railMats, 1.2, (s) => -offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.025, centerPos.y + 1.225, centerPos.y + 1.175, railMats, 1.2, (s) => offW(s));
                }

                // Vertical posts centered in each sub-segment
                const postL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), this.materials.boardHanger);
                postL.position.copy(localPL);
                postL.position.y = 1.95;
                postL.rotation.y = rotY;
                stationGroup.add(postL);

                const postR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.04), this.materials.boardHanger);
                postR.position.copy(localPR);
                postR.position.y = 0.6;
                postR.rotation.y = rotY;
                stationGroup.add(postR);



            } else if (station.name === "Eberhardshof") {
                const fencePositionsX = [-spacing / 2 - 1.83, spacing / 2 + 1.83];
                fencePositionsX.forEach(fx => {
                    // 3 horizontal rails
                    const railHeights = [0.1, 0.9, 1.7];
                    railHeights.forEach(ry => {
                        const rail = new THREE.Mesh(
                            new THREE.BoxGeometry(0.04, 0.04, subLen),
                            this.materials.boardHanger
                        );
                        const pWorld = pos.clone().addScaledVector(normal, fx);
                        rail.position.copy(stationGroup.worldToLocal(pWorld));
                        rail.position.y = ry;
                        rail.rotation.y = rotY;
                        stationGroup.add(rail);
                    });

                    // 4 vertical posts per 5m segment
                    const postOffsetsZ = [-1.875, -0.625, 0.625, 1.875];
                    postOffsetsZ.forEach(oz => {
                        const post = new THREE.Mesh(
                            new THREE.BoxGeometry(0.06, 1.8, 0.06),
                            this.materials.boardHanger
                        );
                        const pWorld = pos.clone()
                            .addScaledVector(normal, fx)
                            .addScaledVector(tangent, oz);
                        post.position.copy(stationGroup.worldToLocal(pWorld));
                        post.position.y = 0.9;
                        post.rotation.y = rotY;
                        stationGroup.add(post);
                    });
                });
            } else if (station.name === "Jakobinenstraße") {
                // 1. Sandstone "houses" wall + its dark coping band, swept continuously along
                // the true curve. The zigzag is a periodic function of ABSOLUTE arc position
                // (period 2.5m — the shape's own trough-peak-trough repeat), aligned so it still
                // reads as the same repeating house motif, but panels no longer meet at an angle
                // on curves. R is the grid origin (segment j=0's own start boundary), matching
                // exactly where the old per-5m panels used to begin.
                if (j === 0) {
                    const R = station.position - (numSub * subLen) / 2;
                    const period = 2.5;
                    const triWave = (s, vTrough, vPeak) => {
                        const t = (((s - R) % period) + period) % period;
                        const frac = Math.abs(t - period / 2) / (period / 2); // 0 at peak, 1 at trough
                        return vPeak - frac * (vPeak - vTrough);
                    };
                    const sA = R, sB = R + numSub * subLen;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const wallTop = (s) => centerPos.y + triWave(s, 4.77, 5.77);
                    const wallBot = centerPos.y - 0.38;
                    const fillBot = (s) => centerPos.y + triWave(s, 4.77, 5.77);
                    const fillTop = (s) => centerPos.y + triWave(s, 5.0, 6.0);
                    // Rings must land EXACTLY on the period's own quarter-points (trough/rise/
                    // peak/fall every 0.625m) so the zigzag comes out perfectly sharp and even
                    // instead of aliasing against the default ~1m/ring resolution ("ungleichmäßige
                    // Zacken"). numSub*subLen is always a multiple of 5, and 5/0.625=8, so this
                    // divides in exactly — no remainder/phase drift across the whole sweep.
                    const zigzagNSeg = numSub * 8;
                    // buildSweptWall forces the cloned material's texture.repeat to (1,1), so the
                    // baked UV alone must reproduce the real-world scale createSandstoneMaterial's
                    // canvas represents (texture.userData.worldW/worldH metres per tile):
                    // tileU = worldW (1 U-unit = 1 tile = worldW real metres along the wall).
                    // V uses vMetricScale=1/worldH (ABSOLUTE world Y, not normalised per-ring) so
                    // the horizontal courses stay level and only get clipped by the zigzag top
                    // edge, instead of stretching to fill each ring's local (varying) height —
                    // that stretching is what made the grout lines themselves look zigzagged.
                    const sandW = jakobinenstrasseSandstoneMat.map.userData.worldW;
                    const sandH = jakobinenstrasseSandstoneMat.map.userData.worldH;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        this.buildSweptWall(stationGroup, sA, sB, off, wallBot, wallTop, jakobinenstrasseSandstoneMat, sandW, 0, 0, zigzagNSeg, 1 / sandH);
                        this.buildSweptWall(stationGroup, sA, sB, off, fillBot, fillTop, this.materials.boardHanger, 1.2, 0, 1, zigzagNSeg);
                    }
                }

                // 2. Dark vertical columns at the segment end boundaries (z = 2.5)
                const pEndL = posWallL.clone().addScaledVector(normal, -0.101).addScaledVector(tangent, 2.5);
                const colL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colL.position.copy(stationGroup.worldToLocal(pEndL));
                colL.position.y = 4.01;
                colL.rotation.y = rotY;

                const pEndR = posWallR.clone().addScaledVector(normal, 0.101).addScaledVector(tangent, 2.5);
                const colR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colR.position.copy(stationGroup.worldToLocal(pEndR));
                colR.position.y = 4.01;
                colR.rotation.y = rotY;

                stationGroup.add(colL, colR);

                // 2b. Dark vertical column under the MIDDLE downward "Zacken" of each segment (z = 0)
                const pMidL = posWallL.clone().addScaledVector(normal, -0.101);
                const colMidL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colMidL.position.copy(stationGroup.worldToLocal(pMidL));
                colMidL.position.y = 4.01;
                colMidL.rotation.y = rotY;

                const pMidR = posWallR.clone().addScaledVector(normal, 0.101);
                const colMidR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colMidR.position.copy(stationGroup.worldToLocal(pMidR));
                colMidR.position.y = 4.01;
                colMidR.rotation.y = rotY;

                stationGroup.add(colMidL, colMidR);

                // For the very first segment (j === 0), also add columns at the start boundary (z = -2.5)
                if (j === 0) {
                    const pStartL = posWallL.clone().addScaledVector(normal, -0.101).addScaledVector(tangent, -2.5);
                    const colStartL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colStartL.position.copy(stationGroup.worldToLocal(pStartL));
                    colStartL.position.y = 4.01;
                    colStartL.rotation.y = rotY;

                    const pStartR = posWallR.clone().addScaledVector(normal, 0.101).addScaledVector(tangent, -2.5);
                    const colStartR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colStartR.position.copy(stationGroup.worldToLocal(pStartR));
                    colStartR.position.y = 4.01;
                    colStartR.rotation.y = rotY;

                    stationGroup.add(colStartL, colStartR);
                }



                // 5. Nameplate "JAKOBINENSTRASSE" under every second house (House 2 of each segment)
                if (j > 0 && j < numSub - 1) {
                    // Left wall text (facing tracks)
                    const textMeshL = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.5625), jakobinenstrasseTextMat);
                    const pTextL = posWallL.clone().addScaledVector(tangent, 1.25);
                    textMeshL.position.copy(stationGroup.worldToLocal(pTextL));
                    textMeshL.position.x += 0.11;
                    textMeshL.position.y = 2.21875; // Top edge 2.50m above track bed
                    textMeshL.rotation.set(0, rotY + Math.PI / 2, 0);

                    // Right wall text (facing tracks)
                    const textMeshR = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.5625), jakobinenstrasseTextMat);
                    const pTextR = posWallR.clone().addScaledVector(tangent, 1.25);
                    textMeshR.position.copy(stationGroup.worldToLocal(pTextR));
                    textMeshR.position.x -= 0.11;
                    textMeshR.position.y = 2.21875; // Top edge 2.50m above track bed
                    textMeshR.rotation.set(0, rotY - Math.PI / 2, 0);

                    stationGroup.add(textMeshL, textMeshR);
                }
            } else if (wallPresets[station.name]) {
                // Tiled 2-layer walls + name stripe as continuous swept ribbons, built once.
                if (j === 0) {
                    const preset = wallPresets[station.name];
                    const cacheKey = `tileMat_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = {
                            bottom: this.createTiledMaterial(preset.bottomColor, preset.bottomGrout, 0.2),
                            top: this.createTiledMaterial(preset.topColor, preset.topGrout, 0.15),
                            stripe: this.createWallStripeMaterial(station.name, preset.stripeBg, preset.stripeText)
                        };
                    }
                    const mats = this[cacheKey];
                    const repeatX = Math.round(platLength / (0.35 * (384 / 64)));
                    const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
                    const topHeight = isMax ? 5.0 : 3.7;
                    const hFactor = preset.flatTiles ? 0.6 : 1.2;
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02); // stripe sits just in front of the wall
                        if (isMax) {
                            // Tiled bottom: cy - 0.38 to cy + 1.10
                            this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 1.10, mats.bottom, 1.2, -0.38 / hFactor, 1.10 / hFactor);
                            // Tiled green top: cy + 1.10 to cy + 3.68 (height 2.58m, same height as lower green wall)
                            this.buildSweptWall(stationGroup, sA, sB, off, cy + 1.10, cy + 3.68, mats.top, 1.2, 1.1 / hFactor, 3.68 / hFactor);
                            // Stripe: cy + 2.28 to cy + 2.50
                            this.buildSweptWall(stationGroup, sA, sB, offS, cy + 2.28, cy + 2.50, mats.stripe, 90 / repeatX, 0, 1);
                            // Concrete upper wall: cy + 3.68 to cy + 5.84 (ceiling height, coarser concrete texture scale 2.4)
                            this.buildSweptWall(stationGroup, sA, sB, off, cy + 3.68, cy + 5.84, this.stationConcreteWallMat, 2.4, 3.68 / 2.4, 5.84 / 2.4);
                        } else {
                            this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 1.10, mats.bottom, 1.2, -0.38 / hFactor, 1.10 / hFactor);
                            this.buildSweptWall(stationGroup, sA, sB, off, cy + 1.10, cy + 1.10 + topHeight, mats.top, 1.2, 1.1 / hFactor, (1.1 + topHeight) / hFactor);
                            this.buildSweptWall(stationGroup, sA, sB, offS, cy + 2.28, cy + 2.50, mats.stripe, 90 / repeatX, 0, 1);
                        }
                    }
                }
            } else if (station.name === "Hardhöhe") {
                // Outer Walls for Hardhöhe (4.8m high, extended down to -0.38m):
                const localWallR = stationGroup.worldToLocal(posWallR.clone());
                const localWallL = stationGroup.worldToLocal(posWallL.clone());
                
                // Main concrete walls + beige tiled band as continuous swept slabs (solid
                // colours), built once on j===0. Art panels / text below stay discrete.
                if (j === 0) {
                    const concreteWallMat = new THREE.MeshLambertMaterial({ color: '#d4d4d8' });
                    const tileMat = new THREE.MeshLambertMaterial({ color: '#d1b894' });
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    const cw = [concreteWallMat, concreteWallMat];
                    const tb = [tileMat, tileMat];
                    for (const sign of [1, -1]) {
                        this.buildSweptBar(stationGroup, sA, sB, () => 0.1, cy + 4.8, cy - 0.38, cw, 1.2, (s) => sign * offW(s));
                        this.buildSweptBar(stationGroup, sA, sB, () => 0.02, cy + 0.90, cy - 0.38, tb, 1.2, (s) => sign * (offW(s) - 0.11));
                    }
                }
                
                // 2. Artistic panels or "HARDHÖHE" text (only at specific segments)
                // Wall panels in the middle of the station and closer together (j = 7, 9, 11, 13)
                const artIndices = [7, 9, 11, 13];
                const textIndices = [2, 4, 8, 10, 12, 14, 16];
                
                if (artIndices.includes(j)) {
                    const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                    
                    // LEFT WALL ART PANEL (at localWallR, positive X)
                    // Colorful background backing plate (dark backing)
                    const backingR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.5, 4.0), new THREE.MeshLambertMaterial({ color: '#1e293b' }));
                    backingR.position.copy(localWallR);
                    backingR.position.x -= 0.11;
                    backingR.position.y = 2.8;
                    backingR.rotation.y = rotY;
                    stationGroup.add(backingR);
                    
                    // Add vertical color stripes to represent the colourful artwork
                    const stripeColors = ['#ef4444', '#ea580c', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#eab308', '#22c55e', '#ef4444'];
                    const numStripes = 10;
                    const stripeW = 4.0 / numStripes;
                    
                    for (let i = 0; i < numStripes; i++) {
                        const stripeMat = new THREE.MeshLambertMaterial({ color: stripeColors[i] });
                        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.45, stripeW - 0.02), stripeMat);
                        const zOffset = -2.0 + (i + 0.5) * stripeW;
                        stripe.position.copy(backingR.position).addScaledVector(localDir, zOffset);
                        stripe.rotation.y = rotY;
                        stationGroup.add(stripe);
                    }
                    
                    // Louvers/slats in front of left art panel
                    const slatMat = new THREE.MeshLambertMaterial({ color: '#2a2d34' });
                    for (let sIdx = 0; sIdx < 12; sIdx++) {
                        const slatY = 1.65 + sIdx * 0.21;
                        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 4.0), slatMat);
                        slat.position.copy(localWallR);
                        slat.position.x -= 0.14; // in front of the art panel
                        slat.position.y = slatY;
                        slat.rotation.y = rotY;
                        stationGroup.add(slat);
                    }
                    
                    // RIGHT WALL ART PANEL (at localWallL, negative X)
                    const backingL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.5, 4.0), new THREE.MeshLambertMaterial({ color: '#1e293b' }));
                    backingL.position.copy(localWallL);
                    backingL.position.x += 0.11;
                    backingL.position.y = 2.8;
                    backingL.rotation.y = rotY;
                    stationGroup.add(backingL);
                    
                    for (let i = 0; i < numStripes; i++) {
                        const stripeMat = new THREE.MeshLambertMaterial({ color: stripeColors[numStripes - 1 - i] });
                        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.45, stripeW - 0.02), stripeMat);
                        const zOffset = -2.0 + (i + 0.5) * stripeW;
                        stripe.position.copy(backingL.position).addScaledVector(localDir, zOffset);
                        stripe.rotation.y = rotY;
                        stationGroup.add(stripe);
                    }
                    
                    for (let sIdx = 0; sIdx < 12; sIdx++) {
                        const slatY = 1.65 + sIdx * 0.21;
                        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 4.0), slatMat);
                        slat.position.copy(localWallL);
                        slat.position.x += 0.14; // in front of the art panel
                        slat.position.y = slatY;
                        slat.rotation.y = rotY;
                        stationGroup.add(slat);
                    }
                } else if (textIndices.includes(j)) {
                    // Place "HARDHÖHE" text on left wall (localWallR, positive X, facing negative X)
                    const textMeshR = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.625), wallTextMat);
                    textMeshR.position.copy(localWallR);
                    textMeshR.position.x -= 0.11;
                    textMeshR.position.y = 2.2;
                    textMeshR.rotation.set(0, rotY - Math.PI / 2, 0); // Face tracks
                    
                    // Place "HARDHÖHE" text on right wall (localWallL, negative X, facing positive X)
                    const textMeshL = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.625), wallTextMat);
                    textMeshL.position.copy(localWallL);
                    textMeshL.position.x += 0.11;
                    textMeshL.position.y = 2.2;
                    textMeshL.rotation.set(0, rotY + Math.PI / 2, 0); // Face tracks
                    
                    stationGroup.add(textMeshR, textMeshL);
                }
            } else if (station.name === "Aufseßplatz") {
                // Red/white tiled 3-layer walls + name stripe as continuous swept ribbons, once.
                if (j === 0) {
                    const repeatX = Math.round(platLength / (0.35 * (384 / 64)));
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 0.75, aufsessplatzRedTileMat, 1.2, -0.38 / 1.2, 0.75 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 0.75, cy + 3.46, aufsessplatzWhiteTileMat, 1.2, 0.75 / 1.2, 3.46 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 3.46, cy + 4.59, aufsessplatzRedTileMat, 1.2, 3.46 / 1.2, 4.59 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, offS, cy + 2.015, cy + 2.195, aufsessplatzStripeMat, 90 / repeatX, 0, 1);
                    }
                }
            } else {
                // Generic outer walls: solid colour, so one continuous swept slab per side
                // (built once on j===0), tapering its lateral offset with the inter-track gap.
                if (station.name !== "Langwasser Nord" && station.name !== "Messe" && j === 0) {
                    const wallMaterial = new THREE.MeshLambertMaterial({ color: station.color || '#333333' });
                    const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
                    const ceilYw = isMax ? 5.84 : 4.66;
                    const wallMats = [wallMaterial, wallMaterial];
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const wallInset = isSideStation ? 5.55 : 1.83;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + wallInset;
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.1, centerPos.y + ceilYw, centerPos.y - 0.38, wallMats, 1.2, (s) => offW(s));
                    this.buildSweptBar(stationGroup, sA, sB, () => 0.1, centerPos.y + ceilYw, centerPos.y - 0.38, wallMats, 1.2, (s) => -offW(s));
                }
            }
        }
 
        // 4. Pillars (every 15 meters by default: -37.5, -22.5, -7.5, 7.5, 22.5, 37.5)
        let stationPillarZ = [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5].map(z => z * S_len);
        if (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name)) {
            // 12 pillars in equal distance (from -33 to 33 with spacing 6m) to clear the escalators
            stationPillarZ = [-33, -27, -21, -15, -9, -3, 3, 9, 15, 21, 27, 33].map(z => z * S_len);
        } else if (station.name === "Aufseßplatz") {
            // 9 pillars in equal distance (from -32 to 32 with spacing 8m)
            stationPillarZ = [-32, -24, -16, -8, 0, 8, 16, 24, 32].map(z => z * S_len);
        }
        const tPillarTrunkGeom = new THREE.BoxGeometry(0.3, 2.75, 0.3);
        const tPillarBarGeom = new THREE.BoxGeometry(2.4, 0.25, 0.35);
 
        stationPillarZ.forEach((pz, idx) => {
            if (station.name === "Hardhöhe" || station.name === "Jakobinenstraße") return; // column-free!
            const isTiledExitStation = (station.name === "Maximilianstraße" ||
                                        station.name === "Bärenschanze" ||
                                        station.name === "Gostenhof" ||
                                        station.name === "Langwasser Süd" ||
                                        station.name === "Gemeinschaftshaus" ||
                                        station.name === "Langwasser Mitte");
            if (isTiledExitStation && (Math.abs(Math.abs(pz) - 37.5 * S_len) < 0.01)) return; // remove end pillars to clear escalators
            const s = station.position + pz;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;

            // Calculate target height and Y position for pillars
            const isMax = ["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name);
            let ceilY = isMax ? 5.84 : 4.66;
            if (hasSlatCeiling) ceilY = 4.59; // slat ceiling sits lower than the generic slab
            if (station.name === "Hardhöhe") ceilY = 4.8;
            if (station.name === "Eberhardshof") ceilY = 4.65;

            let pHeight = ceilY - 0.865;
            let pY = 0.865 + pHeight / 2;
            if (isMax) {
                pHeight = 3.295; // Shorter pillars: ends at 4.16 (ceiling 5.84 - beam height 1.68)
                pY = 0.865 + pHeight / 2;
            }

            if (isSideStation) {
                const pR = pos.clone().addScaledVector(normal, -spacing / 2 - 3.54);
                const cacheKey = `pillarGeom_side_${station.name}`;
                if (!this[cacheKey]) {
                    this[cacheKey] = new THREE.CylinderGeometry(0.25, 0.25, pHeight, 8);
                }
                const pillarR = new THREE.Mesh(this[cacheKey], this.materials.pillar);
                pillarR.position.copy(stationGroup.worldToLocal(pR));
                pillarR.position.y = pY;
                pillarR.rotation.y = rotY;

                const pL = pos.clone().addScaledVector(normal, spacing / 2 + 3.54);
                const pillarL = new THREE.Mesh(this[cacheKey], this.materials.pillar);
                pillarL.position.copy(stationGroup.worldToLocal(pL));
                pillarL.position.y = pY;
                pillarL.rotation.y = rotY;

                stationGroup.add(pillarR, pillarL);
            } else if (isScharfreiterring) {
                const localSchPlatCenter = spacing / 2 - 5.03;
                const pL = pos.clone().addScaledVector(normal, -localSchPlatCenter);

                const tHeight = 4.66 - 0.865;
                const tY = 0.865 + tHeight / 2;
                const trunkGeom = new THREE.BoxGeometry(0.3, tHeight, 0.3);

                const trunkL = new THREE.Mesh(trunkGeom, this.materials.pillar);
                const localPL = stationGroup.worldToLocal(pL.clone());
                trunkL.position.copy(localPL);
                trunkL.position.y = tY;
                trunkL.rotation.y = rotY;
                const barL = new THREE.Mesh(tPillarBarGeom, this.materials.pillar);
                barL.position.copy(localPL);
                barL.position.y = 4.66 - 0.125; // Flush with ceiling
                barL.rotation.y = rotY;

                const pR = pos.clone().addScaledVector(normal, localSchPlatCenter);
                const trunkR = new THREE.Mesh(trunkGeom, this.materials.pillar);
                const localPR = stationGroup.worldToLocal(pR.clone());
                trunkR.position.copy(localPR);
                trunkR.position.y = tY;
                trunkR.rotation.y = rotY;
                const barR = new THREE.Mesh(tPillarBarGeom, this.materials.pillar);
                barR.position.copy(localPR);
                barR.position.y = 4.66 - 0.125;
                barR.rotation.y = rotY;

                stationGroup.add(trunkL, barL, trunkR, barR);
            } else {
                if (station.name === "Eberhardshof") {
                    const cacheKey = `pillarGeom_${station.name}`;
                    const beamCacheKey = `beamGeom_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = {
                            geom: new THREE.CylinderGeometry(0.75, 0.75, pHeight, 24),
                            mat: this.createPebbleDashMaterial()
                        };
                        this[cacheKey].mat.map.repeat.set(1, pHeight / 2.25);
                    }
                    if (!this[beamCacheKey]) {
                        const beamShape = new THREE.Shape();
                        beamShape.moveTo(-5.0, 3.6);
                        beamShape.lineTo(-5.0, 5.0);
                        beamShape.quadraticCurveTo(-3.75, 2.5, -2.5, 5.0);
                        beamShape.quadraticCurveTo(-1.25, 2.5, 0.0, 5.0);
                        beamShape.quadraticCurveTo(1.25, 2.5, 2.5, 5.0);
                        beamShape.quadraticCurveTo(3.75, 2.5, 5.0, 5.0);
                        beamShape.lineTo(5.0, 3.6);
                        beamShape.quadraticCurveTo(0, 2.0, -5.0, 3.6);
                        beamShape.closePath();

                        const bGeom = new THREE.ExtrudeGeometry(beamShape, { depth: 0.6, bevelEnabled: false });
                        bGeom.translate(0, 0, -0.3);

                        this[beamCacheKey] = {
                            geom: bGeom,
                            mat: this.materials.pillar
                        };
                    }

                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);

                    const bData = this[beamCacheKey];
                    const beam = new THREE.Mesh(bData.geom, bData.mat);
                    beam.position.copy(stationGroup.worldToLocal(pos.clone()));
                    beam.position.y = 0;
                    beam.rotation.y = rotY;
                    stationGroup.add(beam);
                } else if (wallPresets[station.name]) {
                    const preset = wallPresets[station.name];
                    const cacheKey = `pillarGeom_${station.name}`;
                    const hPillFactor = preset.flatTiles ? 0.6597 : 1.3194;
                    const isSquareLangwasser = ["Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte"].includes(station.name);

                    if (!this[cacheKey]) {
                        if (isSquareLangwasser) {
                            const pWidth = 0.63; // 1/4 narrower than 0.84 diameter
                            this[cacheKey] = {
                                geom: new THREE.BoxGeometry(pWidth, pHeight, pWidth),
                                mat: this.createTiledMaterial(preset.topColor, preset.topGrout, 0.15)
                            };
                            this[cacheKey].mat.map.repeat.set(0.5, pHeight / hPillFactor);
                            if (this[cacheKey].mat.bumpMap) {
                                this[cacheKey].mat.bumpMap.repeat.set(0.5, pHeight / hPillFactor);
                            }
                        } else {
                            this[cacheKey] = {
                                geom: new THREE.CylinderGeometry(0.42, 0.42, pHeight, 16),
                                mat: this.createTiledMaterial(preset.topColor, preset.topGrout, 0.15)
                            };
                            this[cacheKey].mat.map.repeat.set(2, pHeight / hPillFactor);
                            if (this[cacheKey].mat.bumpMap) {
                                this[cacheKey].mat.bumpMap.repeat.set(2, pHeight / hPillFactor);
                            }
                        }
                    }
                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                } else if (station.name === "Aufseßplatz") {
                    const cacheKey = `pillarGeom_${station.name}`;
                    if (!this[cacheKey]) {
                        const geom = new THREE.CylinderGeometry(0.42, 0.42, pHeight, 16);
                        const mat = aufsessplatzRedTileMat.clone();
                        mat.map = aufsessplatzRedTileMat.map.clone();
                        mat.map.repeat.set(2, pHeight / 1.3194);
                        if (aufsessplatzRedTileMat.bumpMap) {
                            mat.bumpMap = aufsessplatzRedTileMat.bumpMap.clone();
                            mat.bumpMap.repeat.set(2, pHeight / 1.3194);
                        }
                        this[cacheKey] = { geom, mat };
                    }
                    const pData = this[cacheKey];
                    const pillar = new THREE.Mesh(pData.geom, pData.mat);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                } else if (station.name === "Messe") {
                    // Rectangular columns on both sides of the platform supporting the beams
                    this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
                    const beamHeight = 0.45;
                    const pillHeight = ceilY - 0.1 - beamHeight - 0.865;
                    const pillY = 0.865 + pillHeight / 2;
                    const cacheKey = `pillarGeom_messe`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = new THREE.BoxGeometry(0.5, pillHeight, 0.5);
                    }
                    const pillOffset = (spacing - 3.08) / 2 - 4.0;
                    
                    const pL = pos.clone().addScaledVector(normal, -pillOffset);
                    const pillarL = new THREE.Mesh(this[cacheKey], this.materials.messeConcrete);
                    pillarL.position.copy(stationGroup.worldToLocal(pL));
                    pillarL.position.y = pillY;
                    pillarL.rotation.y = rotY;

                    const pR = pos.clone().addScaledVector(normal, pillOffset);
                    const pillarR = new THREE.Mesh(this[cacheKey], this.materials.messeConcrete);
                    pillarR.position.copy(stationGroup.worldToLocal(pR));
                    pillarR.position.y = pillY;
                    pillarR.rotation.y = rotY;

                    stationGroup.add(pillarL, pillarR);
                } else {
                    const cacheKey = `pillarGeom_generic_${station.name}`;
                    if (!this[cacheKey]) {
                        this[cacheKey] = new THREE.CylinderGeometry(0.25, 0.25, pHeight, 8);
                    }
                    const pillar = new THREE.Mesh(this[cacheKey], this.materials.pillar);
                    pillar.position.copy(stationGroup.worldToLocal(pos.clone()));
                    pillar.position.y = pY;
                    pillar.rotation.y = rotY;
                    stationGroup.add(pillar);
                }
            }

            // Build cross-beams and lights for Maximilianstraße aligned with the pillars
            if (isMax) {
                const beamWidth = spacing + 3.66;
                const beamGeom = new THREE.BoxGeometry(beamWidth, 1.68, 0.84);
                const beam = new THREE.Mesh(beamGeom, this.stationConcreteBeamMat);
                
                const beamCenter = stationGroup.worldToLocal(pos.clone());
                beamCenter.y = 5.00;
                beam.position.copy(beamCenter);
                beam.rotation.y = rotY;
                stationGroup.add(beam);

                // Attach lights under the beam (Y = 4.10, which is just below the beam bottom 4.16)
                const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));
                const lightOffset = spacing > 8 ? 2.5 : 1.3;
                const addBeamLight = (xOffset) => {
                    const l = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l.position.copy(beamCenter).addScaledVector(localNorm, xOffset);
                    l.position.y = 4.10;
                    l.rotation.y = rotY + Math.PI / 2;
                    stationGroup.add(l);
                };
                addBeamLight(-lightOffset);
                addBeamLight(lightOffset);
            }
        });

        // Benches removed by user request (except custom benches in Hardhöhe)

        // Hardhöhe Custom Furniture
        if (station.name === "Hardhöhe") {
            const furnitureZ = [-20, 0, 20];
            const adZ = [-10, 10];
            
            const concreteMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
            const steelMat = new THREE.MeshLambertMaterial({ color: '#cbd5e1' });
            const lidMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });
            const yellowMat = new THREE.MeshLambertMaterial({ color: '#eab308' });
            const posterMat = new THREE.MeshLambertMaterial({ color: '#f8fafc' });
            
            const benchSeatGeom = new THREE.BoxGeometry(0.6, 0.08, 2.0);
            const benchLegGeom = new THREE.BoxGeometry(0.5, 0.36, 0.3);
            const canGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 12);
            const lidGeom = new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12);
            
            furnitureZ.forEach(bz => {
                const s = station.position + bz;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const spacing = this.sim.getTrackSpacing(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                
                const baseLocal = stationGroup.worldToLocal(pos.clone());
                
                // Seat
                const seat = new THREE.Mesh(benchSeatGeom, concreteMat);
                seat.position.copy(baseLocal);
                seat.position.y = 0.865 + 0.36 + 0.04;
                seat.rotation.y = rotY;
                
                // Two concrete legs
                const dirVec = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                
                const legL = new THREE.Mesh(benchLegGeom, concreteMat);
                legL.position.copy(baseLocal).addScaledVector(dirVec, -0.7);
                legL.position.y = 0.865 + 0.18;
                legL.rotation.y = rotY;
                
                const legR = new THREE.Mesh(benchLegGeom, concreteMat);
                legR.position.copy(baseLocal).addScaledVector(dirVec, 0.7);
                legR.position.y = 0.865 + 0.18;
                legR.rotation.y = rotY;
                
                // Trash can next to the bench
                const trashPos = baseLocal.clone().addScaledVector(dirVec, 1.4);
                
                const can = new THREE.Mesh(canGeom, steelMat);
                can.position.copy(trashPos);
                can.position.y = 0.865 + 0.35;
                can.rotation.y = rotY;
                
                const lid = new THREE.Mesh(lidGeom, lidMat);
                lid.position.copy(trashPos);
                lid.position.y = 0.865 + 0.7 + 0.025;
                lid.rotation.y = rotY;
                
                stationGroup.add(seat, legL, legR, can, lid);
            });
            
            const adBoardGeom = new THREE.BoxGeometry(0.12, 1.8, 1.3);
            const adPosterGeom = new THREE.BoxGeometry(0.14, 1.5, 1.1);
            
            adZ.forEach(az => {
                const s = station.position + az;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                
                const baseLocal = stationGroup.worldToLocal(pos.clone());
                
                // Yellow frame board
                const frame = new THREE.Mesh(adBoardGeom, yellowMat);
                frame.position.copy(baseLocal);
                frame.position.y = 0.865 + 0.9;
                frame.rotation.y = rotY;
                
                // Posters
                const poster = new THREE.Mesh(adPosterGeom, posterMat);
                poster.position.copy(baseLocal);
                poster.position.y = 0.865 + 0.9;
                poster.rotation.y = rotY;
                
                stationGroup.add(frame, poster);
            });
        }


        // Generic station name signs removed by user request

        // 6b. Hanging Departure Boards (Anzeigetafeln)
        const via1 = "über Lorenzkirche - Plärrer - Fürth";
        const via2 = "über Hasenbuck - Hbf. - Messe";
        
        const boardMatGleis1 = this.createDepartureBoardMaterial(1, "HARDHÖHE", via1);
        const boardMatGleis2 = this.createDepartureBoardMaterial(2, "LANGWASSER SÜD", via2);

        const materialsG1 = [
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            boardMatGleis1, 
            boardMatGleis1, 
        ];

        const materialsG2 = [
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            this.materials.boardCasing, 
            boardMatGleis2, 
            boardMatGleis2, 
        ];

        const blankBoardMat = this.createBlankDepartureBoardMaterial();
        const materialsBlank = [
            this.materials.boardCasing,
            this.materials.boardCasing,
            this.materials.boardCasing,
            this.materials.boardCasing,
            blankBoardMat,
            blankBoardMat
        ];

        const boardZ = (station.name === "Messe") ? [-42.5, -17.5, 42.5] : [-30, 0, 30]; 
        boardZ.forEach(bz => {
            const s = station.position + bz;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;

            const localSchPlatCenter = spacing / 2 - 5.03;

            const isLwNord = (station.name === "Langwasser Nord");
            const boardY = 3.925; // Unterkante bei 3.60m (3.60 + 0.65/2)
            const ceilY = (station.name === "Hardhöhe") ? 4.8 : (hasSlatCeiling ? 4.595 : (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name) ? 5.84 : 4.66));
            const hangerLen = ceilY - boardY;
            const hangerY = boardY + hangerLen / 2;
            const boardHangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 6);

            const scaleFactor = 1.0;
            const hangerOffset = 2.53 * 0.25;

            // Gleis 1 Board (Left Platform - Outer side facing active tracks)
            // Swapped directions: track 1 side board uses materialsG2 ("LANGWASSER SÜD")
            const g1X = isSideStation ? (-spacing / 2 - 3.205) : (isScharfreiterring ? -(localSchPlatCenter + 1.835) : (-spacing / 2 + 3.205));
            const p1 = pos.clone().addScaledVector(normal, g1X);
            const board1 = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsG2);
            board1.position.copy(stationGroup.worldToLocal(p1.clone()));
            board1.position.y = boardY;
            board1.rotation.y = rotY;
            board1.scale.set(scaleFactor, scaleFactor, scaleFactor);
            stationGroup.add(board1);

            const hanger1L = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p1H1 = p1.clone().addScaledVector(normal, -hangerOffset);
            hanger1L.position.copy(stationGroup.worldToLocal(p1H1));
            hanger1L.position.y = hangerY;
            hanger1L.rotation.y = rotY;

            const hanger1R = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p1H2 = p1.clone().addScaledVector(normal, hangerOffset);
            hanger1R.position.copy(stationGroup.worldToLocal(p1H2));
            hanger1R.position.y = hangerY;
            hanger1R.rotation.y = rotY;
            stationGroup.add(hanger1L, hanger1R);

            // Gleis 2 Board (Right Platform - Outer side facing active tracks)
            // Swapped directions: track 2 side board uses materialsG1 ("HARDHÖHE")
            const g2X = isSideStation ? (spacing / 2 + 3.205) : (isScharfreiterring ? (localSchPlatCenter + 1.835) : (spacing / 2 - 3.205));
            const p2 = pos.clone().addScaledVector(normal, g2X);
            const board2 = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsG1);
            board2.position.copy(stationGroup.worldToLocal(p2.clone()));
            board2.position.y = boardY;
            board2.rotation.y = rotY;
            board2.scale.set(scaleFactor, scaleFactor, scaleFactor);
            stationGroup.add(board2);

            const hanger2L = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p2H1 = p2.clone().addScaledVector(normal, -hangerOffset);
            hanger2L.position.copy(stationGroup.worldToLocal(p2H1));
            hanger2L.position.y = hangerY;
            hanger2L.rotation.y = rotY;

            const hanger2R = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
            const p2H2 = p2.clone().addScaledVector(normal, hangerOffset);
            hanger2R.position.copy(stationGroup.worldToLocal(p2H2));
            hanger2R.position.y = hangerY;
            hanger2R.rotation.y = rotY;
            stationGroup.add(hanger2L, hanger2R);

            if (isScharfreiterring) {
                // Left Platform Inner Board (facing decorative tracks)
                const g1InnerX = -(localSchPlatCenter - 1.835);
                const p1Inner = pos.clone().addScaledVector(normal, g1InnerX);
                const board1Inner = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsBlank);
                board1Inner.position.copy(stationGroup.worldToLocal(p1Inner.clone()));
                board1Inner.position.y = boardY;
                board1Inner.rotation.y = rotY;
                board1Inner.scale.set(scaleFactor, scaleFactor, scaleFactor);
                stationGroup.add(board1Inner);

                const hanger1InnerL = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p1InnerH1 = p1Inner.clone().addScaledVector(normal, -hangerOffset);
                hanger1InnerL.position.copy(stationGroup.worldToLocal(p1InnerH1));
                hanger1InnerL.position.y = hangerY;
                hanger1InnerL.rotation.y = rotY;

                const hanger1InnerR = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p1InnerH2 = p1Inner.clone().addScaledVector(normal, hangerOffset);
                hanger1InnerR.position.copy(stationGroup.worldToLocal(p1InnerH2));
                hanger1InnerR.position.y = hangerY;
                hanger1InnerR.rotation.y = rotY;
                stationGroup.add(hanger1InnerL, hanger1InnerR);

                // Right Platform Inner Board (facing decorative tracks)
                const g2InnerX = localSchPlatCenter - 1.835;
                const p2Inner = pos.clone().addScaledVector(normal, g2InnerX);
                const board2Inner = new THREE.Mesh(this.sharedGeometries.boardCasing, materialsBlank);
                board2Inner.position.copy(stationGroup.worldToLocal(p2Inner.clone()));
                board2Inner.position.y = boardY;
                board2Inner.rotation.y = rotY;
                board2Inner.scale.set(scaleFactor, scaleFactor, scaleFactor);
                stationGroup.add(board2Inner);

                const hanger2InnerL = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p2InnerH1 = p2Inner.clone().addScaledVector(normal, -hangerOffset);
                hanger2InnerL.position.copy(stationGroup.worldToLocal(p2InnerH1));
                hanger2InnerL.position.y = hangerY;
                hanger2InnerL.rotation.y = rotY;

                const hanger2InnerR = new THREE.Mesh(boardHangerGeom, this.materials.boardHanger);
                const p2InnerH2 = p2Inner.clone().addScaledVector(normal, hangerOffset);
                hanger2InnerR.position.copy(stationGroup.worldToLocal(p2InnerH2));
                hanger2InnerR.position.y = hangerY;
                hanger2InnerR.rotation.y = rotY;
                stationGroup.add(hanger2InnerL, hanger2InnerR);
            }
        });

        // 7. Lights (every 10 meters)
        const lightZ = [-40, -30, -20, -10, 0, 10, 20, 30, 40];
        lightZ.forEach(lz => {
            if (["Hardhöhe", "Maximilianstraße", "Bärenschanze", "Gostenhof", "Jakobinenstraße", "Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte", "Aufseßplatz", "Maffeiplatz"].includes(station.name)) return; // Skip standard lights
            const s = station.position + lz;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            const spacing = this.sim.getTrackSpacing(s);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;

            if (isScharfreiterring) {
                const localSchPlatCenter = spacing / 2 - 5.03;
                const posL1 = pos.clone().addScaledVector(normal, -localSchPlatCenter - 0.6);
                const posL2 = pos.clone().addScaledVector(normal, -localSchPlatCenter + 0.6);
                const posR1 = pos.clone().addScaledVector(normal, localSchPlatCenter - 0.6);
                const posR2 = pos.clone().addScaledVector(normal, localSchPlatCenter + 0.6);

                const addLight = (pWorld) => {
                    const l = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l.position.copy(stationGroup.worldToLocal(pWorld));
                    l.position.y = 4.52;
                    l.rotation.y = rotY;
                    stationGroup.add(l);
                };
                addLight(posL1);
                addLight(posL2);
                addLight(posR1);
                addLight(posR2);
            } else {
                const lightOffset = isSideStation ? 0 : (spacing > 8 ? 2.5 : 1.3);
                if (isSideStation) {
                    const posL = pos.clone().addScaledVector(normal, spacing / 2 + 3.54);
                    const posR = pos.clone().addScaledVector(normal, -spacing / 2 - 3.54);

                    const lR = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    lR.position.copy(stationGroup.worldToLocal(posR));
                    lR.position.y = 4.52;
                    lR.rotation.y = rotY;

                    const lL = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    lL.position.copy(stationGroup.worldToLocal(posL));
                    lL.position.y = 4.52;
                    lL.rotation.y = rotY;

                    stationGroup.add(lR, lL);
                } else {
                    const pos1 = pos.clone().addScaledVector(normal, -lightOffset);
                    const pos2 = pos.clone().addScaledVector(normal, lightOffset);

                    const l1 = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l1.position.copy(stationGroup.worldToLocal(pos1));
                    l1.position.y = 4.52;
                    l1.rotation.y = rotY;

                    const l2 = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                    l2.position.copy(stationGroup.worldToLocal(pos2));
                    l2.position.y = 4.52;
                    l2.rotation.y = rotY;

                    stationGroup.add(l1, l2);
                }
            }
        });



        if (isScharfreiterring) {
            // Build Scharfreiterring custom features: Overpass, Escalators, and Curved Decorative Tracks (length 190m: -95m to +95m)
            const trackLen = 190 * S_len;
            const schNumSub = 38; 
            const schSubLen = 5.0 * S_len;

            const decBallastGeom = new THREE.BoxGeometry(1.0, 0.15, 1.0);
            const decBallastUV = decBallastGeom.attributes.uv;
            for (let i = 0; i < decBallastUV.count; i++) {
                decBallastUV.setXY(i, decBallastUV.getX(i) * 10.0, decBallastUV.getY(i) * 5.0);
            }

            const decBallastIM = new THREE.InstancedMesh(
                decBallastGeom,
                this.materials.ballast,
                schNumSub
            );

            const decRailsIM = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.1, 0.15, 1.0),
                this.materials.rail,
                schNumSub * 4 
            );

            const decThirdRailsIM = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.12, 0.15, 1.0),
                this.materials.rail,
                schNumSub * 2 
            );

            const decCoversIM = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.24, 0.08, 1.0),
                this.materials.thirdRail,
                schNumSub * 2 
            );

            const setDecSegmentMatrix = (im, instanceIdx, A_world, B_world, yOffset = 0, xOffsetScale = 1.0) => {
                if (xOffsetScale === 0) {
                    const matrix = new THREE.Matrix4().makeScale(0, 0, 0);
                    im.setMatrixAt(instanceIdx, matrix);
                    return;
                }
                const A = stationGroup.worldToLocal(A_world.clone());
                const B = stationGroup.worldToLocal(B_world.clone());
                A.y += yOffset;
                B.y += yOffset;
                const pos = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
                const dir = new THREE.Vector3().subVectors(B, A);
                const length = dir.length();
                dir.normalize();

                const up = new THREE.Vector3(0, 1, 0);
                const right = new THREE.Vector3().crossVectors(up, dir).normalize();
                const actualUp = new THREE.Vector3().crossVectors(dir, right).normalize();

                const matrix = new THREE.Matrix4();
                matrix.makeBasis(right, actualUp, dir);
                matrix.setPosition(pos);

                const scaleMatrix = new THREE.Matrix4().makeScale(xOffsetScale, 1.0, length);
                matrix.multiply(scaleMatrix);

                im.setMatrixAt(instanceIdx, matrix);
            };

            for (let j = 0; j < schNumSub; j++) {
                const z_start = -95 * S_len + j * schSubLen;
                const z_end = -95 * S_len + (j + 1) * schSubLen;
                const z_mid = z_start + schSubLen / 2;

                const s_start = station.position + z_start;
                const s_end = station.position + z_end;
                const s_mid = station.position + z_mid;

                const posStart = this.sim.getTrackPosition(s_start);
                const posEnd = this.sim.getTrackPosition(s_end);
                const tangentStart = this.sim.getTrackTangent(s_start);
                const tangentEnd = this.sim.getTrackTangent(s_end);
                const spacingStart = this.sim.getTrackSpacing(s_start);
                const spacingEnd = this.sim.getTrackSpacing(s_end);

                const normalStart = new THREE.Vector3(-tangentStart.z, 0, tangentStart.x);
                const normalEnd = new THREE.Vector3(-tangentEnd.z, 0, tangentEnd.x);

                const localSchTrackCenterStart = Math.max(1.23, spacingStart / 2 - 10.06);
                const localSchTrackCenterEnd = Math.max(1.23, spacingEnd / 2 - 10.06);
                const localSchTrackCenterMid = (localSchTrackCenterStart + localSchTrackCenterEnd) / 2;

                // Ballast
                const localBallastWidth = (localSchTrackCenterMid + 0.8) * 2;
                const ballastScale = (Math.abs(z_mid) > 45 * S_len) ? 0.0 : localBallastWidth;
                setDecSegmentMatrix(decBallastIM, j, posStart, posEnd, -0.375, ballastScale);

                // 4 Running rails
                const decOffsetsStart = [
                    -localSchTrackCenterStart - 0.717,
                    -localSchTrackCenterStart + 0.717,
                    localSchTrackCenterStart - 0.717,
                    localSchTrackCenterStart + 0.717
                ];
                const decOffsetsEnd = [
                    -localSchTrackCenterEnd - 0.717,
                    -localSchTrackCenterEnd + 0.717,
                    localSchTrackCenterEnd - 0.717,
                    localSchTrackCenterEnd + 0.717
                ];

                for (let r = 0; r < 4; r++) {
                    const A = posStart.clone().addScaledVector(normalStart, decOffsetsStart[r]);
                    const B = posEnd.clone().addScaledVector(normalEnd, decOffsetsEnd[r]);
                    setDecSegmentMatrix(decRailsIM, j * 4 + r, A, B, -0.21);
                }

                // 2 Third rails & covers facing inwards
                const decPowerStart = [-localSchTrackCenterStart + 1.1, localSchTrackCenterStart - 1.1];
                const decPowerEnd = [-localSchTrackCenterEnd + 1.1, localSchTrackCenterEnd - 1.1];

                for (let p = 0; p < 2; p++) {
                    const A_rail = posStart.clone().addScaledVector(normalStart, decPowerStart[p]);
                    const B_rail = posEnd.clone().addScaledVector(normalEnd, decPowerEnd[p]);
                    setDecSegmentMatrix(decThirdRailsIM, j * 2 + p, A_rail, B_rail, -0.05);

                    const A_cover = posStart.clone().addScaledVector(normalStart, decPowerStart[p]);
                    const B_cover = posEnd.clone().addScaledVector(normalEnd, decPowerEnd[p]);
                    setDecSegmentMatrix(decCoversIM, j * 2 + p, A_cover, B_cover, 0.03);
                }
            }

            decBallastIM.instanceMatrix.needsUpdate = true;
            decRailsIM.instanceMatrix.needsUpdate = true;
            decThirdRailsIM.instanceMatrix.needsUpdate = true;
            decCoversIM.instanceMatrix.needsUpdate = true;
            stationGroup.add(decBallastIM, decRailsIM, decThirdRailsIM, decCoversIM);

            // Sleepers (every 1.5 meters from -95 to +95)
            const sleeperCount = Math.floor(trackLen / 1.5) + 1;
            const decSleepersL = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.2), this.materials.sleeper, sleeperCount);
            const decSleepersR = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.12, 0.2), this.materials.sleeper, sleeperCount);

            for (let s = 0; s < sleeperCount; s++) {
                const zOffset = -95 + s * 1.5;
                const distVal = station.position + zOffset;
                const pos = this.sim.getTrackPosition(distVal);
                const tangent = this.sim.getTrackTangent(distVal);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const spacing = this.sim.getTrackSpacing(distVal);
                const angle = Math.atan2(tangent.x, tangent.z);

                const localSchTrackCenter = Math.max(1.23, spacing / 2 - 10.06);

                const posL = pos.clone().addScaledVector(normal, -localSchTrackCenter);
                posL.y = -0.25;
                const localL = stationGroup.worldToLocal(posL);
                const mL = new THREE.Matrix4().makeRotationY(angle - centerAngle);
                mL.setPosition(localL);
                decSleepersL.setMatrixAt(s, mL);

                const posR = pos.clone().addScaledVector(normal, localSchTrackCenter);
                posR.y = -0.25;
                const localR = stationGroup.worldToLocal(posR);
                const mR = new THREE.Matrix4().makeRotationY(angle - centerAngle);
                mR.setPosition(localR);
                decSleepersR.setMatrixAt(s, mR);
            }
            decSleepersL.instanceMatrix.needsUpdate = true;
            decSleepersR.instanceMatrix.needsUpdate = true;
            stationGroup.add(decSleepersL, decSleepersR);

            // 13. Pedestrian Overpass Bridge (Z = -35)
            {
                const s = station.position - 35 * S_len;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const spacing = this.sim.getTrackSpacing(s);
                const angle = Math.atan2(tangent.x, tangent.z) - centerAngle;
                const localCenter = stationGroup.worldToLocal(pos.clone());

                const localSchPlatCenter = spacing / 2 - 5.03;
                const overpassWidth = localSchPlatCenter * 2;
                
                // Floor
                const overpassFloor = new THREE.Mesh(new THREE.BoxGeometry(overpassWidth, 0.2, 4.5), this.materials.pillar);
                overpassFloor.position.copy(localCenter);
                overpassFloor.position.y = 3.6;
                overpassFloor.rotation.y = angle;

                // Roof
                const overpassRoof = new THREE.Mesh(new THREE.BoxGeometry(overpassWidth, 0.2, 4.5), this.materials.pillar);
                overpassRoof.position.copy(localCenter);
                overpassRoof.position.y = 5.8;
                overpassRoof.rotation.y = angle;

                // Walls (Front and Back)
                const posWallF = pos.clone().addScaledVector(tangent, 2.15); 
                const overpassWallF = new THREE.Mesh(new THREE.BoxGeometry(overpassWidth, 2.0, 0.2), this.materials.pillar);
                overpassWallF.position.copy(stationGroup.worldToLocal(posWallF));
                overpassWallF.position.y = 4.7;
                overpassWallF.rotation.y = angle;

                const posWallB = pos.clone().addScaledVector(tangent, -2.15);
                const overpassWallB = new THREE.Mesh(new THREE.BoxGeometry(overpassWidth, 2.0, 0.2), this.materials.pillar);
                overpassWallB.position.copy(stationGroup.worldToLocal(posWallB));
                overpassWallB.position.y = 4.7;
                overpassWallB.rotation.y = angle;

                stationGroup.add(overpassFloor, overpassRoof, overpassWallF, overpassWallB);
            }

            // 14. Detailed Upper Overpass Concrete Cabins & U Sign
            const uLogoMat = this.createSubwayULogo();
            const logoGeom = new THREE.BoxGeometry(1.2, 1.2, 0.05);

            const buildOverpassCabin = (logoSign, s) => {
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const spacing = this.sim.getTrackSpacing(s);
                const angle = Math.atan2(tangent.x, tangent.z) - centerAngle;

                const localSchPlatCenter = spacing / 2 - 5.03;
                const xCenter = -logoSign * localSchPlatCenter;

                const posCabin = pos.clone().addScaledVector(normal, xCenter);
                const localPos = stationGroup.worldToLocal(posCabin);

                const cabinGroup = new THREE.Group();
                cabinGroup.position.copy(localPos);
                cabinGroup.position.y = 5.15;
                cabinGroup.rotation.y = angle;

                // Outer concrete side walls
                const wallOuter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.3, 4.0), this.materials.pillar);
                wallOuter.position.set(-logoSign * 1.3, 0, 0);

                const wallInner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.3, 4.0), this.materials.pillar);
                wallInner.position.set(logoSign * 1.3, 0, 0);
                
                cabinGroup.add(wallOuter, wallInner);

                const slantAngle = 0.18; 
                const endWallGeom = new THREE.BoxGeometry(2.8, 3.3, 0.2);
                
                const wallFront = new THREE.Mesh(endWallGeom, this.materials.pillar);
                wallFront.position.set(0, 0, 1.9);
                wallFront.rotation.x = slantAngle;

                const wallBack = new THREE.Mesh(endWallGeom, this.materials.pillar);
                wallBack.position.set(0, 0, -1.9);
                wallBack.rotation.x = -slantAngle;

                cabinGroup.add(wallFront, wallBack);

                const yellowInterior = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 0.1), this.materials.yellowCabin);
                yellowInterior.position.set(0, 0, 1.2);
                
                const windowGlass = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 0.05), this.materials.glassCabin);
                windowGlass.position.set(0, 0, 1.7);
                windowGlass.rotation.x = slantAngle;

                cabinGroup.add(yellowInterior, windowGlass);

                const logo = new THREE.Mesh(logoGeom, uLogoMat);
                logo.position.set(logoSign * 1.42, 0, 0);
                logo.rotation.y = -logoSign * Math.PI / 2;
                cabinGroup.add(logo);

                stationGroup.add(cabinGroup);
            };

            buildOverpassCabin(1, station.position - 35 * S_len);
            buildOverpassCabin(-1, station.position - 35 * S_len);


        }

        if (station.name === "Messe") {
            this.materials.messeConcrete = this.materials.messeConcrete || new THREE.MeshLambertMaterial({ color: '#bda297' });
            this.materials.glassCabin = this.materials.glassCabin || new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.4, side: THREE.DoubleSide });
            this.materials.pylonMat = new THREE.MeshLambertMaterial({ color: '#dddddd' });
            this.materials.cableMat = new THREE.MeshBasicMaterial({ color: '#333333' });

            const concourseLength = 23.2; // Long along platform Z
            const concourseWidth = 5.0;   // Narrow along platform X
            const concourseHeight = 7.2 - 4.76;

            // 1. Central Concourse Building (Elevated above roof slab top level Y = 4.76)
            const concourseGeom = new THREE.BoxGeometry(concourseWidth, concourseHeight, concourseLength);
            const concourseMesh = new THREE.Mesh(concourseGeom, this.materials.messeConcrete);
            concourseMesh.position.set(0, 4.76 + concourseHeight / 2, 20.0);
            stationGroup.add(concourseMesh);

            // Concourse Roof Plate (dark grey)
            const concourseRoof = new THREE.Mesh(new THREE.BoxGeometry(concourseWidth + 0.1, 0.1, concourseLength + 0.1), new THREE.MeshLambertMaterial({ color: '#555555' }));
            concourseRoof.position.set(0, 7.2 + 0.05, 20.0);
            stationGroup.add(concourseRoof);

            // Skylights on Concourse Roof
            const skylightGeom = new THREE.BoxGeometry(1.5, 0.05, 1.5);
            const skylightMat = new THREE.MeshLambertMaterial({ color: '#222222' });
            const skylightZ = [20.0 - 9, 20.0 - 6, 20.0 - 3, 20.0, 20.0 + 3, 20.0 + 6, 20.0 + 9];
            const skylightX = [-1.2, 1.2];
            for (let sz of skylightZ) {
                for (let sx of skylightX) {
                    const skylight = new THREE.Mesh(skylightGeom, skylightMat);
                    skylight.position.set(sx, 7.2 + 0.1, sz);
                    stationGroup.add(skylight);
                }
            }

            // 2. Escalator Glass Canopies (Symmetrical canopies, one at each end)
            const getMesseStairParams = (zDir) => {
                const anchorZ = (zDir === 1) ? 0.0 : 40.0;
                const s = station.position + anchorZ;
                const pos = this.sim.getTrackPosition(s);
                const tangent = this.sim.getTrackTangent(s);
                const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
                const localPos = stationGroup.worldToLocal(pos.clone());
                return { localPos, rotY };
            };

            const buildEscalatorCanopy = (zDir) => {
                const canopyGroup = new THREE.Group();
                const rampLength = Math.sqrt(4.48 * 4.48 + 8.4 * 8.4);
                const rampAngle = Math.atan2(4.48, 8.4);

                // Glass walls
                const glassW = 0.05;
                const glassH = 2.6;
                const glassGeom = new THREE.BoxGeometry(glassW, glassH, rampLength);

                const leftGlass = new THREE.Mesh(glassGeom, this.materials.glassCabin);
                leftGlass.position.set(-2.2, glassH / 2, 0);

                const rightGlass = new THREE.Mesh(glassGeom, this.materials.glassCabin);
                rightGlass.position.set(2.2, glassH / 2, 0);

                canopyGroup.add(leftGlass, rightGlass);

                // Sloped roof
                const roofGeom = new THREE.BoxGeometry(4.45, 0.1, rampLength);
                const roofMesh = new THREE.Mesh(roofGeom, this.materials.glassCabin);
                roofMesh.position.set(0, glassH, 0);
                canopyGroup.add(roofMesh);

                // Frame lines
                const frameGeom = new THREE.BoxGeometry(4.5, 0.15, 0.1);
                const frameMat = new THREE.MeshLambertMaterial({ color: '#444444' });
                for (let d = -rampLength/2; d <= rampLength/2; d += 2.0) {
                    const frame = new THREE.Mesh(frameGeom, frameMat);
                    frame.position.set(0, glassH, d);
                    canopyGroup.add(frame);
                }

                // Position and orient
                const params = getMesseStairParams(zDir);
                const canopyPos = params.localPos.clone();
                const dirZ = new THREE.Vector3(Math.sin(params.rotY), 0, Math.cos(params.rotY));
                canopyPos.addScaledVector(dirZ, zDir * 4.2);
                canopyPos.y = 0.865 + 4.48 / 2;

                canopyGroup.position.copy(canopyPos);
                canopyGroup.rotation.order = 'YXZ';
                canopyGroup.rotation.y = params.rotY;
                canopyGroup.rotation.x = -zDir * rampAngle;

                stationGroup.add(canopyGroup);
            };

            buildEscalatorCanopy(1);  // Langwasser side (descends to Z = 0.0)
            buildEscalatorCanopy(-1); // Fürth side (descends to Z = 40.0)

            // 3. Cylinder drawing helper
            const createCylinderBetweenPoints = (pA, pB, radius, material) => {
                const dir = new THREE.Vector3().subVectors(pB, pA);
                const length = dir.length();
                const geom = new THREE.CylinderGeometry(radius, radius, length, 8);
                const mesh = new THREE.Mesh(geom, material);
                
                const pos = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
                mesh.position.copy(pos);
                
                dir.normalize();
                const up = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
                mesh.setRotationFromQuaternion(quaternion);
                
                return mesh;
            };

            // 4. Left Bridge (Cable-Stayed Bridge, facing X-)
            const leftBridgeLen = 40.8;
            const leftBridgeX = -(concourseWidth / 2 + leftBridgeLen / 2); // -2.5 - 20.4 = -22.9
            
            // Deck
            const leftDeck = new THREE.Mesh(new THREE.BoxGeometry(leftBridgeLen, 0.2, 4.5), this.materials.messeConcrete);
            leftDeck.position.set(leftBridgeX, 5.345, 20.0);
            stationGroup.add(leftDeck);

            // Glass walls
            const leftGlass = new THREE.Mesh(new THREE.BoxGeometry(leftBridgeLen, 2.4, 4.4), this.materials.glassCabin);
            leftGlass.position.set(leftBridgeX, 5.345 + 1.2, 20.0);
            stationGroup.add(leftGlass);

            // Roof
            const leftRoof = new THREE.Mesh(new THREE.BoxGeometry(leftBridgeLen, 0.1, 4.5), new THREE.MeshLambertMaterial({ color: '#555555' }));
            leftRoof.position.set(leftBridgeX, 5.345 + 2.5, 20.0);
            stationGroup.add(leftRoof);

            // A-frame Pylon at X = -25, shifted to Z = 20.0
            const pTop = new THREE.Vector3(-25, 18, 20.0);
            const pA1 = new THREE.Vector3(-25, 0, 20.0 - 3.5);
            const pA2 = new THREE.Vector3(-25, 0, 20.0 + 3.5);

            const leg1 = createCylinderBetweenPoints(pA1, pTop, 0.4, this.materials.pylonMat);
            const leg2 = createCylinderBetweenPoints(pA2, pTop, 0.4, this.materials.pylonMat);
            stationGroup.add(leg1, leg2);

            // Support Cables
            const deckXCoords = [-12, -18, -32, -38];
            for (let dx of deckXCoords) {
                const cL = createCylinderBetweenPoints(pTop, new THREE.Vector3(dx, 5.345, 20.0 - 2.25), 0.04, this.materials.cableMat);
                const cR = createCylinderBetweenPoints(pTop, new THREE.Vector3(dx, 5.345, 20.0 + 2.25), 0.04, this.materials.cableMat);
                stationGroup.add(cL, cR);
            }

            // 5. Right Bridge (Concrete Girder Bridge, facing X+, shifted to Z = 20.0)
            const rightBridgeLen = 15.8;
            const rightBridgeX = concourseWidth / 2 + rightBridgeLen / 2; // 2.5 + 7.9 = 10.4

            // Deck
            const rightDeck = new THREE.Mesh(new THREE.BoxGeometry(rightBridgeLen, 0.2, 4.5), this.materials.messeConcrete);
            rightDeck.position.set(rightBridgeX, 5.345, 20.0);
            stationGroup.add(rightDeck);

            // Concrete Railings
            const railF = new THREE.Mesh(new THREE.BoxGeometry(rightBridgeLen, 1.1, 0.15), this.materials.messeConcrete);
            railF.position.set(rightBridgeX, 5.345 + 0.55, 20.0 + 2.25);
            
            const railB = new THREE.Mesh(new THREE.BoxGeometry(rightBridgeLen, 1.1, 0.15), this.materials.messeConcrete);
            railB.position.set(rightBridgeX, 5.345 + 0.55, 20.0 - 2.25);
            
            stationGroup.add(railF, railB);

            // Support Pillar under right bridge
            const supportPillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5.345, 0.8), this.materials.messeConcrete);
            supportPillar.position.set(rightBridgeX, 5.345 / 2, 20.0);
            stationGroup.add(supportPillar);

            // 6. Spawn passenger group at platform center
            const passBuilder = new PassengerBuilder();

            // Mann (180 cm, blond/ponytail, fair skin, black T-shirt with orange square on back, grey shorts, black shoes)
            const passengerMan = passBuilder.createCharacter({
                height: 1.80,
                skinColor: '#f5d0c0',
                hairColor: '#edd18c',
                hairStyle: 'ponytail',
                shirtColor: '#111111',
                shirtStyle: 'tshirt',
                pantsColor: '#555555',
                pantsStyle: 'shorts',
                shoesColor: '#111111',
                backDecal: 'orange_square'
            });
            passengerMan.position.set(0.0, 0.865, 18.4);
            passengerMan.rotation.y = 0;

            // Frau 1 (175 cm, fair skin, long brown hair, salmon shirt, dark blue skirt, black shoes)
            const passengerWoman1 = passBuilder.createCharacter({
                height: 1.75,
                skinColor: '#f5d0c0',
                hairColor: '#593e1a',
                hairStyle: 'long',
                shirtColor: '#fa8072',
                shirtStyle: 'tshirt',
                pantsColor: '#0f2b5c',
                pantsStyle: 'skirt',
                shoesColor: '#111111'
            });
            passengerWoman1.position.set(0.6, 0.865, 19.0);
            passengerWoman1.rotation.y = -Math.PI / 2;

            // Frau 2 (175 cm, fair skin, long blond hair, sunglasses, light green summer dress, white shoes)
            const passengerWoman2 = passBuilder.createCharacter({
                height: 1.75,
                skinColor: '#f5d0c0',
                hairColor: '#edd18c',
                hairStyle: 'long',
                shirtColor: '#90ee90',
                shirtStyle: 'sleeveless',
                pantsColor: '#ffffff',
                pantsStyle: 'dress',
                shoesColor: '#ffffff',
                sunglasses: true
            });
            passengerWoman2.position.set(0.0, 0.865, 19.6);
            passengerWoman2.rotation.y = Math.PI;

            // Frau 3 (165 cm, Arabic-brown skin, long black hair, white long-sleeved crop top, short jeans skirt, black shoes)
            const passengerWoman3 = passBuilder.createCharacter({
                height: 1.65,
                skinColor: '#c68642',
                hairColor: '#090807',
                hairStyle: 'long',
                shirtColor: '#ffffff',
                shirtStyle: 'crop',
                pantsColor: '#4682b4',
                pantsStyle: 'skirt',
                shoesColor: '#111111'
            });
            passengerWoman3.position.set(-0.6, 0.865, 19.0);
            passengerWoman3.rotation.y = Math.PI / 2;

            stationGroup.add(passengerMan, passengerWoman1, passengerWoman2, passengerWoman3);
        }

        // --- APPLY NEW STANDARD STAIRS TO LEGACY STATIONS ---
        import('./stations/StationBuilder.js?v=67').then(({ StationBuilder }) => {
            const builder = new StationBuilder(this, station);
            builder.group = stationGroup;
            builder.buildStairs();
        });

        // --- ADD TRASH CANS ---
        this.addTrashCansToStation(station, stationGroup, S_len, platLength, platTopY, centerAngle);

        return stationGroup;
    }

    createRoughConcreteMaterial() {
        // Same rough concrete look as StationBuilder.createRoughConcreteMaterial (used for the
        // stair/tunnel-entrance portal walls), duplicated here so station-wide elements like the
        // cross-beams and upper wall band can share materials cached at the StationModel level.
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

    createTunnelConcreteTexture() {
        // Near-black base with minimal pixel grain – adapts naturally to 8-sided cylinder panels
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Near-black base
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, size, size);

        // Minimal grainy noise – only very subtle pixel variation
        for (let i = 0; i < 6000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const v = Math.floor(10 + Math.random() * 18); // 10–28 range, almost invisible
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 1, 1);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        // 8 panels in the octagon cylinder – 8 U-repeats means each panel gets exactly one texture tile
        // V=1 covers the 5m segment height without stretching
        tex.repeat.set(8, 1);
        return tex;
    }

    createBallastTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const size = 1 + Math.random() * 2;
            const colorVal = Math.random();
            if (colorVal < 0.4) ctx.fillStyle = '#1e1e1e';
            else if (colorVal < 0.8) ctx.fillStyle = '#4a4a4a';
            else ctx.fillStyle = '#555555';
            ctx.fillRect(x, y, size, size);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // 1:1 repeat because we scale UVs per segment for perfect alignment
        texture.repeat.set(1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    createStationSignMaterial(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff'; // white background
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.lineWidth = 10;
        ctx.strokeStyle = '#000000'; // black border
        ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

        ctx.fillStyle = '#000000'; // black text
        ctx.font = 'bold 68px "Jost Regular", "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2); // CAPS LOCK
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.strokeText(name.toUpperCase(), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createWallStripeMaterial(name, colorCode, textColor = '#ffffff') {
        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = colorCode;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = textColor;
        ctx.font = 'bold 33px "Jost Regular", "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw the station name centered on the canvas, compressed horizontally
        // to make it narrow (condensed) as requested by the user.
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(0.68, 1.0); // Compress horizontally to make it narrow/condensed
        const upperName = name.replace(/ß/g, 'SS').toUpperCase();
        ctx.fillText(upperName, 0, 0);
        if (textColor === '#000000') {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 1.2;
            ctx.strokeText(upperName, 0, 0);
        } else if (textColor !== '#ffffff') {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 0.8;
            ctx.strokeText(upperName, 0, 0);
        }
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.wrapS = THREE.RepeatWrapping;

        // Calculate repeat count to maintain aspect ratio on a 90m long, 0.35m high wall stripe.
        // Canvas aspect ratio is 384 / 64 = 6.
        // So a single repeat covers 0.35 * 6 = 2.1 meters.
        // Total repeat count for 90 meters is 90 / 2.1 = 42.85.
        // We round to the nearest integer to prevent seams or wrapping cuts at the ends.
        const stripeHeight = 0.35;
        const platLength = 90;
        const repeatX = Math.round(platLength / (stripeHeight * (canvas.width / canvas.height)));
        texture.repeat.set(repeatX, 1);

        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createTiledMaterial(tileColor, groutColor, roughness = 0.15) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = groutColor;
        ctx.fillRect(0, 0, 128, 128);
        
        ctx.fillStyle = tileColor;
        const cols = 8;
        const rows = 8;
        const w = 128 / cols;
        const h = 128 / rows;
        const border = 1;
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.fillRect(c * w + border, r * h + border, w - border * 2, h - border * 2);
            }
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 128;
        bumpCanvas.height = 128;
        const bCtx = bumpCanvas.getContext('2d');
        
        bCtx.fillStyle = '#000000';
        bCtx.fillRect(0, 0, 128, 128);
        
        bCtx.fillStyle = '#ffffff';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                bCtx.fillRect(c * w + border, r * h + border, w - border * 2, h - border * 2);
            }
        }
        
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.015,
            roughness: roughness
        });
    }

    createPebbleDashMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#a1a1aa'; // zinc grey base
        ctx.fillRect(0, 0, 256, 256);
        
        const numPebbles = 2000;
        for (let i = 0; i < numPebbles; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1.0 + Math.random() * 2.5;
            
            const rand = Math.random();
            if (rand < 0.45) {
                ctx.fillStyle = '#71717a'; // dark zinc grey
            } else if (rand < 0.8) {
                ctx.fillStyle = '#f4f4f5'; // light grey/white
            } else if (rand < 0.95) {
                ctx.fillStyle = '#d4d4d8'; // medium-light grey
            } else {
                ctx.fillStyle = '#b45309'; // brownish pebbles
            }
            
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 4);
        texture.colorSpace = THREE.SRGBColorSpace;
        
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = 256;
        bumpCanvas.height = 256;
        const bCtx = bumpCanvas.getContext('2d');
        
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, 256, 256);
        
        for (let i = 0; i < numPebbles; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const size = 1.0 + Math.random() * 2.5;
            bCtx.fillStyle = Math.random() > 0.5 ? '#c0c0c0' : '#404040';
            bCtx.beginPath();
            bCtx.arc(x, y, size, 0, 2 * Math.PI);
            bCtx.fill();
        }
        
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        bumpTexture.repeat.set(2, 4);
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.025
        });
    }

    createSandstoneMaterial() {
        // Coursed ashlar sandstone: irregular-height horizontal courses (20-40cm real-world),
        // each built from blocks in varying beige tones, with the joints offset row-to-row like
        // real masonry (running bond). Cheap to generate — only flat fillRect calls, no
        // per-pixel loops, no bump map. The canvas represents a fixed WORLD_W x WORLD_H metre
        // patch of wall (stored in texture.userData so callers can size their own tiling
        // density instead of guessing); it then repeats via wrapping.
        const WORLD_W = 2.4, WORLD_H = 1.2;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const pxPerMX = canvas.width / WORLD_W;
        const pxPerMY = canvas.height / WORLD_H;
        const joint = 2; // grout line thickness in px, shows through as the gap between blocks

        // Grout base (shows through in the gaps left between blocks below)
        ctx.fillStyle = '#5c4d3a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tones = ['#d8c1a0', '#e2ccac', '#cdb187', '#e7d5ba', '#d4b98f', '#ddc9a5', '#c9ab7e'];
        let y = 0, row = 0;
        while (y < canvas.height) {
            const courseM = 0.20 + Math.random() * 0.20; // 20-40cm course height
            let h = Math.round(courseM * pxPerMY);
            if (y + h > canvas.height) h = canvas.height - y;
            const blockM = 0.5 + Math.random() * 0.35; // ~50-85cm block width
            const w = Math.max(16, Math.round(blockM * pxPerMX));
            const offset = (row % 2 === 0) ? 0 : -Math.round(w / 2); // running-bond offset
            for (let x = offset; x < canvas.width; x += w) {
                ctx.fillStyle = tones[(Math.random() * tones.length) | 0];
                ctx.fillRect(x + joint, y + joint, w - joint * 2, Math.max(1, h - joint * 2));
            }
            y += h;
            row++;
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.userData = { worldW: WORLD_W, worldH: WORLD_H };

        return new THREE.MeshLambertMaterial({
            map: texture
        });
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
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 4);
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
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        bumpTexture.repeat.set(4, 4);
        
        return new THREE.MeshLambertMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: 0.008
        });
    }

    createDepartureBoardMaterial(trackNumber, destination, viaText) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 264;
        const ctx = canvas.getContext('2d');

        // 1. Draw main casing face (light grey/silver)
        ctx.fillStyle = '#d2d7db';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw Left Screen (Departure Display)
        ctx.fillStyle = '#080c10'; // black/dark blue screen
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(16, 16, 736, 232, 16);
        } else {
            ctx.rect(16, 16, 736, 232);
        }
        ctx.fill();

        // 3. Draw Right Screen (Info Display Screen)
        ctx.fillStyle = '#080c10';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(792, 16, 216, 232, 24);
        } else {
            ctx.rect(792, 16, 216, 232);
        }
        ctx.fill();

        // 4. Draw Info "i" Symbol on Right Screen
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 130px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('i', 900, 126); // Draw lowercase 'i' centered

        // 5. Draw Track/Gleis info in Left Screen
        ctx.fillStyle = '#ffcc00'; // Yellow text
        ctx.textAlign = 'center';
        
        ctx.font = 'bold 24px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.fillText('Gleis', 100, 70);
        
        ctx.font = 'bold 110px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.fillText(trackNumber.toString(), 100, 160);

        // Vertical divider on Left Screen
        ctx.strokeStyle = '#223344';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(190, 24);
        ctx.lineTo(190, 240);
        ctx.stroke();

        // 6. Draw Departures (Row 1 & Row 2)
        const destX = 300;
        const timeX = 660;
        const minX = 720;
        
        // Departures info (dynamic minute countdown offset)
        const min1 = trackNumber === 1 ? '3' : '1';
        const min2 = trackNumber === 1 ? '13' : '8';

        // Row 1
        // Blue U1 badge
        ctx.fillStyle = '#0055a5';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(210, 36, 64, 32, 6);
        } else {
            ctx.rect(210, 36, 64, 32);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px "Outfit", "Inter", sans-serif';
        ctx.fillText('U1', 242, 52);

        // Destination name
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'left';
        ctx.font = 'bold 28px "Outfit", "Inter", sans-serif';
        ctx.fillText(destination, destX, 50);

        // Subline
        ctx.fillStyle = '#88929a';
        ctx.font = '16px "Outfit", "Inter", sans-serif';
        ctx.fillText(viaText, destX, 82);

        // Minutes
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'right';
        ctx.font = 'bold 36px "Outfit", sans-serif';
        ctx.fillText(min1, timeX, 50);
        
        ctx.textAlign = 'left';
        ctx.font = '14px sans-serif';
        ctx.fillText('Min.', minX, 50);

        // Row 2
        // Blue U1 badge
        ctx.fillStyle = '#0055a5';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(210, 116, 64, 32, 6);
        } else {
            ctx.rect(210, 116, 64, 32);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px "Outfit", "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('U1', 242, 132);

        // Destination name
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'left';
        ctx.font = 'bold 28px "Outfit", "Inter", sans-serif';
        ctx.fillText(destination, destX, 130);

        // Subline
        ctx.fillStyle = '#88929a';
        ctx.font = '16px "Outfit", "Inter", sans-serif';
        ctx.fillText(viaText, destX, 162);

        // Minutes
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'right';
        ctx.font = 'bold 36px "Outfit", sans-serif';
        ctx.fillText(min2, timeX, 130);
        
        ctx.textAlign = 'left';
        ctx.font = '14px sans-serif';
        ctx.fillText('Min.', minX, 130);

        // 7. Bottom Ticker (yellow bar with black text)
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(206, 196, 524, 34);
        
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.font = 'bold 16px "Outfit", "Inter", sans-serif';
        ctx.fillText('Aufgrund von Bauarbeiten kann es zu Einschränkungen kommen', 468, 219);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createBlankDepartureBoardMaterial() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 264;
        const ctx = canvas.getContext('2d');

        // 1. Draw main casing face (light grey/silver)
        ctx.fillStyle = '#d2d7db';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw Left Screen (Departure Display)
        ctx.fillStyle = '#080c10'; // black/dark blue screen
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(16, 16, 736, 232, 16);
        } else {
            ctx.rect(16, 16, 736, 232);
        }
        ctx.fill();

        // 3. Draw Right Screen (Info Display Screen)
        ctx.fillStyle = '#080c10';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(792, 16, 216, 232, 24);
        } else {
            ctx.rect(792, 16, 216, 232);
        }
        ctx.fill();

        // 4. Draw Info "i" Symbol on Right Screen
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 130px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('i', 900, 126);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    createSubwayULogo() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Blue background
        ctx.fillStyle = '#0055a5';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // White border
        ctx.lineWidth = 14;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
        
        // White U in center
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 150px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('U', canvas.width / 2, canvas.height / 2 + 10);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({ map: texture });
    }

    disposeGroup(group) {
        // No longer culling the groups themselves from memory, just caching them.
    }

    createTrashCanTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // Gradient background for brushed stainless steel (bright metal)
        const grad = ctx.createLinearGradient(0, 0, 256, 0);
        grad.addColorStop(0, '#bdc3c7');
        grad.addColorStop(0.35, '#e2e8f0');
        grad.addColorStop(0.5, '#ffffff');
        grad.addColorStop(0.65, '#e2e8f0');
        grad.addColorStop(1, '#bdc3c7');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 512);
        
        // Add vertical brushed metal lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * 256;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 512);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * 256;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 512);
            ctx.stroke();
        }
        
        // Draw the black trash icon (person throwing trash)
        ctx.fillStyle = '#2c3e50';
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const cx = 128;
        const cy = 150;
        
        // Head
        ctx.beginPath();
        ctx.arc(cx, cy - 25, 7, 0, Math.PI * 2);
        ctx.fill();
        
        // Torso
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18);
        ctx.lineTo(cx - 3, cy + 5);
        ctx.stroke();
        
        // Left Leg
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 5);
        ctx.lineTo(cx - 12, cy + 30);
        ctx.stroke();
        
        // Right Leg
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 4, cy + 30);
        ctx.stroke();
        
        // Left Arm (leaning back slightly)
        ctx.beginPath();
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx - 15, cy - 2);
        ctx.stroke();
        
        // Right Arm (throwing trash)
        ctx.beginPath();
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx + 12, cy - 14);
        ctx.lineTo(cx + 20, cy - 2);
        ctx.stroke();
        
        // Falling trash (small dot)
        ctx.beginPath();
        ctx.arc(cx + 24, cy + 5, 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Trash bin outline on the right
        ctx.beginPath();
        ctx.moveTo(cx + 22, cy + 12);
        ctx.lineTo(cx + 34, cy + 12);
        ctx.lineTo(cx + 31, cy + 32);
        ctx.lineTo(cx + 25, cy + 32);
        ctx.closePath();
        ctx.stroke();
        
        // Dot/Mesh pattern below the icon (embossed dots)
        for (let row = 0; row < 18; row++) {
            const y = 220 + row * 13;
            // Diamond pattern width
            const maxCols = 15 - Math.abs(row - 9); 
            const startX = 128 - (maxCols - 1) * 7;
            for (let col = 0; col < maxCols; col++) {
                const x = startX + col * 14;
                // Draw embossed dot: shadow + highlight
                ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.beginPath();
                ctx.arc(x + 1, y + 1, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    buildTrashCan() {
        const trashCanGroup = new THREE.Group();
        
        // 1. Create the main body shape (extruded)
        const shape = new THREE.Shape();
        shape.moveTo(-0.1, -0.25);
        shape.lineTo(0.1, -0.25);
        shape.quadraticCurveTo(0.2, 0.0, 0.1, 0.25);
        shape.lineTo(-0.1, 0.25);
        shape.quadraticCurveTo(-0.2, 0.0, -0.1, -0.25);
        
        // Add a hole in the shape so the body and rim are hollow inside
        const holePath = new THREE.Path();
        holePath.moveTo(-0.05, -0.12);
        holePath.lineTo(-0.05, 0.12);
        holePath.lineTo(0.05, 0.12);
        holePath.lineTo(0.05, -0.12);
        holePath.closePath();
        shape.holes.push(holePath);
        
        // Extrude body up to 0.95m
        const extrudeSettings = {
            depth: 0.95,
            bevelEnabled: false,
            curveSegments: 16
        };
        const bodyGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        bodyGeom.rotateX(-Math.PI / 2); // Make it stand vertically
        
        // Apply cylindrical UV projection for the body geometry
        const posAttr = bodyGeom.attributes.position;
        const uvAttr = bodyGeom.attributes.uv;
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);
            
            // Map U from Z-range [-0.25, 0.25] -> [0, 1]
            // Map V from Y-range [0, 0.95] -> [0, 1]
            let u = (z + 0.25) / 0.5;
            let v = y / 0.95;
            
            u = Math.max(0, Math.min(1, u));
            v = Math.max(0, Math.min(1, v));
            
            uvAttr.setXY(i, u, v);
        }
        uvAttr.needsUpdate = true;
        
        const bodyMesh = new THREE.Mesh(bodyGeom, this.materials.trashBody);
        trashCanGroup.add(bodyMesh);
        
        // 2. Create the top lid (inward funnel)
        const lidGeom = new THREE.CylinderGeometry(0.23, 0.08, 0.04, 16, 1, true);
        lidGeom.scale(0.65, 1.0, 1.0);
        const lidMesh = new THREE.Mesh(lidGeom, this.materials.trashLid);
        lidMesh.position.y = 0.97;
        trashCanGroup.add(lidMesh);
        
        // 3. Create the rim (thin top border following the body shape)
        const rimGeom = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false, curveSegments: 16 });
        rimGeom.rotateX(-Math.PI / 2);
        const rimMesh = new THREE.Mesh(rimGeom, this.materials.trashLid);
        rimMesh.position.y = 0.985;
        trashCanGroup.add(rimMesh);
        
        // 4. Create the blue trash bag inside, lowered to be visible through the opening
        const bagGeom = new THREE.BoxGeometry(0.12, 0.02, 0.26);
        const bagMesh = new THREE.Mesh(bagGeom, this.materials.trashBag);
        bagMesh.position.y = 0.90;
        trashCanGroup.add(bagMesh);
        
        return trashCanGroup;
    }

    addTrashCansToStation(station, stationGroup, S_len, platLength, platTopY, centerAngle) {
        // Collect pillar coordinates to avoid collision
        let pillarZList = [];
        if (station.name !== "Hardhöhe" && station.name !== "Jakobinenstraße") {
            if (["Maximilianstraße", "Bärenschanze", "Gostenhof"].includes(station.name)) {
                pillarZList = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30].map(z => z * S_len);
            } else if (station.name === "Aufseßplatz") {
                pillarZList = [-32, -24, -16, -8, 0, 8, 16, 24, 32].map(z => z * S_len);
            } else {
                pillarZList = [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5].map(z => z * S_len);
            }
        }

        // Helper function to shift Z position to avoid columns
        const checkPillarsAndAdjustZ = (targetZ) => {
            let adjustedZ = targetZ;
            let attempts = 0;
            let hasCollision = true;
            // Shift towards the center first to avoid going out of platform bounds
            const shiftDir = targetZ >= 0 ? -1.0 : 1.0;
            while (hasCollision && attempts < 100) {
                hasCollision = false;
                for (const pz of pillarZList) {
                    if (Math.abs(adjustedZ - pz) < 2.5) { // 2.5m safety margin
                        adjustedZ += shiftDir * 1.5;
                        hasCollision = true;
                        break;
                    }
                }
                attempts++;
            }
            return adjustedZ;
        };

        const isSideStation = station.side;
        const isScharfreiterring = (station.name === "Scharfreiterring");
        const centerSpacing = this.sim.getTrackSpacing(station.position);

        // 3 Z positions along the platform
        const rawZOffsets = [-platLength * 0.3, 0, platLength * 0.3];
        const adjustedZOffsets = rawZOffsets.map(z => checkPillarsAndAdjustZ(z));

        // Helper to calculate curved coordinates relative to track spline
        const getLocalPlacement = (z, offsetX) => {
            const s = station.position + z;
            const pos = this.sim.getTrackPosition(s);
            const tangent = this.sim.getTrackTangent(s);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
            
            // Calculate world position and convert to local space of the stationGroup
            const worldPos = pos.clone().addScaledVector(normal, offsetX);
            const localPos = stationGroup.worldToLocal(worldPos);
            const rotY = Math.atan2(tangent.x, tangent.z) - centerAngle;
            
            return {
                pos: localPos,
                rotY: rotY
            };
        };

        let placements = []; // array of { pos, rotY }

        if (isSideStation) {
            adjustedZOffsets.forEach(z => {
                const s = station.position + z;
                const spacing = this.sim.getTrackSpacing(s);
                
                // Left platform trash can (near left wall)
                placements.push(getLocalPlacement(z, spacing / 2 + 5.25));
                
                // Right platform trash can (near right wall)
                placements.push(getLocalPlacement(z, -(spacing / 2 + 5.25)));
            });
        } else if (isScharfreiterring) {
            adjustedZOffsets.forEach(z => {
                const s = station.position + z;
                const spacing = this.sim.getTrackSpacing(s);
                const leftPlatCenter = spacing / 2 - 5.03;
                
                // Left platform trash can
                placements.push(getLocalPlacement(z, leftPlatCenter + 3.25));
                
                // Right platform trash can
                placements.push(getLocalPlacement(z, -(leftPlatCenter + 3.25)));
            });
        } else {
            // Island platform: place in the center (X = 0)
            if (centerSpacing - 3.08 > 0.5) {
                adjustedZOffsets.forEach(z => {
                    placements.push(getLocalPlacement(z, 0));
                });
            }
        }

        // Build and add the trash cans
        placements.forEach(p => {
            const trashCan = this.buildTrashCan();
            trashCan.position.copy(p.pos);
            trashCan.position.y = platTopY; // Ensure it stands flat on the deck floor
            trashCan.rotation.y = p.rotY;
            stationGroup.add(trashCan);
        });
    }
}