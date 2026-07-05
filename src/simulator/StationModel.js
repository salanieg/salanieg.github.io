import * as THREE from 'three';
import { StationBuilder } from './stations/StationBuilder.js?v=67';
import { RathausBuilder } from './stations/RathausBuilder.js?v=43';
import { LorenzkircheBuilder } from './stations/LorenzkircheBuilder.js?v=43';

export class StationModel {
    constructor(scene, simulation) {
        this.scene = scene;
        this.sim = simulation;
        
        // Culling configuration
        this.loadedStations = new Map(); // stationIndex -> boolean (is in scene)
        this.cullingDistance = 2000; // load station if within 2000m
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

            if (dist < this.cullingDistance) {
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
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            const mk = (lat, y) => group.worldToLocal(new THREE.Vector3(wp.x + nX * lat, y, wp.z + nZ * lat));
            rings.push({ bl: mk(co - hw, botY), br: mk(co + hw, botY), tr: mk(co + hw, topY), tl: mk(co - hw, topY), cum });
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
        const meshMats = mats.map(m => { const c = m.clone(); c.side = THREE.DoubleSide; return c; });
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
    buildSweptWall(group, sStart, sEnd, offFn, yBotW, yTopW, baseMat, tileU, vBot, vTop) {
        const length = sEnd - sStart;
        const nSeg = Math.max(2, Math.ceil(length));
        const bots = [], tops = [], us = [];
        let cum = 0, prevWorld = null;
        for (let r = 0; r <= nSeg; r++) {
            const s = sStart + length * r / nSeg;
            const wp = this.sim.getTrackPosition(s);
            const tan = this.sim.getTrackTangent(s);
            const nlen = Math.hypot(-tan.z, tan.x) || 1;
            const nX = -tan.z / nlen, nZ = tan.x / nlen;
            const off = offFn(s);
            if (prevWorld) cum += wp.distanceTo(prevWorld);
            prevWorld = wp.clone();
            bots.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * off, yBotW, wp.z + nZ * off)));
            tops.push(group.worldToLocal(new THREE.Vector3(wp.x + nX * off, yTopW, wp.z + nZ * off)));
            us.push(cum / tileU);
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
            tri(bl, br, tr, [uL, vBot], [uR, vBot], [uR, vTop]);
            tri(bl, tr, tl, [uL, vBot], [uR, vTop], [uL, vTop]);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geom.computeVertexNormals();
        const mat = baseMat.clone();
        mat.side = THREE.DoubleSide;
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
        if (material.map) { mat.map = material.map.clone(); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.repeat.set(1, 1); mat.map.offset.set(0, 0); mat.map.needsUpdate = true; }
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
        let jakobinenstrasseWallGeom = null;
        let jakobinenstrasseFillGeom = null;
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

            const shape = new THREE.Shape();
            shape.moveTo(-2.5, -0.38);
            shape.lineTo(-2.5, 3.72);
            shape.lineTo(-1.25, 4.72);
            shape.lineTo(0.0, 3.72);
            shape.lineTo(1.25, 4.72);
            shape.lineTo(2.5, 3.72);
            shape.lineTo(2.5, -0.38);
            shape.closePath();

            const wGeom = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
            wGeom.translate(0, 0, -0.1);
            wGeom.rotateY(Math.PI / 2);
            jakobinenstrasseWallGeom = wGeom;

            const fillShape = new THREE.Shape();
            fillShape.moveTo(-2.5, 3.72);
            fillShape.lineTo(-1.25, 4.72);
            fillShape.lineTo(0.0, 3.72);
            fillShape.lineTo(1.25, 4.72);
            fillShape.lineTo(2.5, 3.72);
            fillShape.lineTo(2.5, 3.95);
            fillShape.lineTo(1.25, 4.95);
            fillShape.lineTo(0.0, 3.95);
            fillShape.lineTo(-1.25, 4.95);
            fillShape.lineTo(-2.5, 3.95);
            fillShape.closePath();

            const fGeom = new THREE.ExtrudeGeometry(fillShape, { depth: 0.2, bevelEnabled: false });
            fGeom.translate(0, 0, -0.1);
            fGeom.rotateY(Math.PI / 2);
            jakobinenstrasseFillGeom = fGeom;

            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#27272a';
            ctx.font = 'bold 64px "Outfit", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("JAKOBINENSTRASSE", canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            jakobinenstrasseTextMat = new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true
            });
        } else if (station.name === "Aufseßplatz") {
            aufsessplatzRedTileMat = this.createTiledMaterial('#ff5f38', '#7a1a08', 0.15);
            aufsessplatzWhiteTileMat = this.createTiledMaterial('#fcfcfc', '#d1d5db', 0.15);
            aufsessplatzStripeMat = this.createWallStripeMaterial("Aufseßplatz", '#ff5f38', '#ffffff');
            
            aufsessplatzCeilingLightMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0', side: THREE.DoubleSide });
            aufsessplatzCeilingDarkMat = new THREE.MeshLambertMaterial({ color: '#111111' });
        }

        const wallPresets = {
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
            ctx.font = 'bold 72px "Outfit", "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("HARDHÖHE", canvas.width / 2, canvas.height / 2);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
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
                    plate1a.position.y = 4.45; // shifted up
                    plate1a.rotation.set(-slopeAngle, rotY, 0, 'YXZ');

                    const p1bPosWorld = pos.clone().addScaledVector(tangent, -0.625);
                    const plate1b = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate1b.position.copy(stationGroup.worldToLocal(p1bPosWorld));
                    plate1b.position.y = 4.45;
                    plate1b.rotation.set(slopeAngle, rotY, 0, 'YXZ');
                    
                    const p2aPosWorld = pos.clone().addScaledVector(tangent, 0.625);
                    const plate2a = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate2a.position.copy(stationGroup.worldToLocal(p2aPosWorld));
                    plate2a.position.y = 4.45;
                    plate2a.rotation.set(-slopeAngle, rotY, 0, 'YXZ');

                    const p2bPosWorld = pos.clone().addScaledVector(tangent, 1.875);
                    const plate2b = new THREE.Mesh(
                        new THREE.BoxGeometry(plateWidth, 0.15, plateLength),
                        ceilMat
                    );
                    plate2b.position.copy(stationGroup.worldToLocal(p2bPosWorld));
                    plate2b.position.y = 4.45;
                    plate2b.rotation.set(slopeAngle, rotY, 0, 'YXZ');

                    stationGroup.add(plate1a, plate1b, plate2a, plate2b);

                    // Custom continuous concrete light girders suspended from ceiling (solid dark grey/black)
                    const lightOff = spacing / 2 - 1.185;
                    const girderH = 0.25; // heightened from 0.12
                    const girderY = 2.90; // lowered from 3.40 (penetrates deeper into the station)
                    const girderMat = this.materials.boardHanger; // solid dark color
                    
                    const girderL = new THREE.Mesh(new THREE.BoxGeometry(0.25, girderH, subLen), girderMat);
                    girderL.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, -lightOff)));
                    girderL.position.y = girderY;
                    girderL.rotation.y = rotY;

                    const girderR = new THREE.Mesh(new THREE.BoxGeometry(0.25, girderH, subLen), girderMat);
                    girderR.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, lightOff)));
                    girderR.position.y = girderY;
                    girderR.rotation.y = rotY;

                    stationGroup.add(girderL, girderR);

                    // Double neon tubes under each girder
                    const tubeGeom = new THREE.BoxGeometry(0.03, 0.03, subLen);
                    const tubeY = girderY - girderH/2 - 0.035; // hang slightly below the bottom of the girder

                    const tubeL1 = new THREE.Mesh(tubeGeom, this.materials.lightTube);
                    tubeL1.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, -lightOff - 0.05)));
                    tubeL1.position.y = tubeY;
                    tubeL1.rotation.y = rotY;

                    const tubeL2 = new THREE.Mesh(tubeGeom, this.materials.lightTube);
                    tubeL2.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, -lightOff + 0.05)));
                    tubeL2.position.y = tubeY;
                    tubeL2.rotation.y = rotY;

                    const tubeR1 = new THREE.Mesh(tubeGeom, this.materials.lightTube);
                    tubeR1.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, lightOff - 0.05)));
                    tubeR1.position.y = tubeY;
                    tubeR1.rotation.y = rotY;

                    const tubeR2 = new THREE.Mesh(tubeGeom, this.materials.lightTube);
                    tubeR2.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, lightOff + 0.05)));
                    tubeR2.position.y = tubeY;
                    tubeR2.rotation.y = rotY;

                    stationGroup.add(tubeL1, tubeL2, tubeR1, tubeR2);

                    // Vertical rod hangers connecting girders to folded ceiling peaks (Z = ±1.25)
                    const ceilHangerY = 4.95; // peak of the two houses is at y = 4.95m
                    const girderTopY = girderY + girderH/2;
                    const hangerLen = ceilHangerY - girderTopY;
                    const hangerY = (ceilHangerY + girderTopY) / 2;
                    
                    const hangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 8);

                    const hangL1 = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                    hangL1.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, -lightOff).addScaledVector(tangent, -1.25)));
                    hangL1.position.y = hangerY;
                    hangL1.rotation.y = rotY;

                    const hangL2 = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                    hangL2.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, -lightOff).addScaledVector(tangent, 1.25)));
                    hangL2.position.y = hangerY;
                    hangL2.rotation.y = rotY;

                    const hangR1 = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                    hangR1.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, lightOff).addScaledVector(tangent, -1.25)));
                    hangR1.position.y = hangerY;
                    hangR1.rotation.y = rotY;

                    const hangR2 = new THREE.Mesh(hangerGeom, this.materials.boardHanger);
                    hangR2.position.copy(stationGroup.worldToLocal(pos.clone().addScaledVector(normal, lightOff).addScaledVector(tangent, 1.25)));
                    hangR2.position.y = hangerY;
                    hangR2.rotation.y = rotY;

                    stationGroup.add(hangL1, hangL2, hangR1, hangR2);
                } else {
                    const isMax = (station.name === "Maximilianstraße");
                    const isLwNord = (station.name === "Langwasser Nord");
                    const ceilY = isMax ? 5.0 : 4.66; // Decke quer-mitskaliert (×1.4134) für 1×-Profil
                    const ceilW = isLwNord ? (spacing - 2.22) : groundWidth;

                    if (station.name === "Aufseßplatz") {
                        const platW = spacing - 2.8;

                        // Dark background plate + concrete track-ceiling plates as continuous
                        // swept slabs (built once on j===0). The slats below stay per-louvre.
                        if (j === 0) {
                            const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                            const cy = centerPos.y;
                            const bpHalf = (s) => (this.sim.getTrackSpacing(s) - 2.8) / 2;
                            const tDist = (s) => this.sim.getTrackSpacing(s) / 2 + 0.215; // 3.23m plate, half 1.615
                            this.buildSweptBar(stationGroup, sA, sB, bpHalf, cy + 4.595, cy + 4.585, [aufsessplatzCeilingDarkMat, aufsessplatzCeilingDarkMat], 1.2);
                            this.buildSweptBar(stationGroup, sA, sB, () => 1.615, cy + 4.595, cy + 4.585, [this.materials.ceiling, this.materials.ceiling], 1.2, (s) => -tDist(s));
                            this.buildSweptBar(stationGroup, sA, sB, () => 1.615, cy + 4.595, cy + 4.585, [this.materials.ceiling, this.materials.ceiling], 1.2, (s) => tDist(s));
                        }

                        // 3. 25 Slats (above the platform, light grey, planes instead of boxes to reduce polygon count and z-fighting)
                        const slatGeom = new THREE.PlaneGeometry(platW, 0.16);
                        const localDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
                        for (let i = 0; i < 25; i++) {
                            const slatZ = -2.5 + i * 0.2 + 0.08; // center of each 16cm slat
                            const slatMesh = new THREE.Mesh(slatGeom, aufsessplatzCeilingLightMat);
                            slatMesh.position.copy(localPos).addScaledVector(localDir, slatZ);
                            slatMesh.position.y = 4.57; // slightly below the dark background plate to avoid z-fighting
                            slatMesh.rotation.order = 'YXZ';
                            slatMesh.rotation.set(Math.PI / 2, 0, 0); // rotate flat and face downwards
                            slatMesh.rotation.y = rotY;
                            stationGroup.add(slatMesh);
                        }
                    } else if (station.name !== "Plärrer") {
                        // Plärrer's flat ceiling is omitted: its bespoke hall (TrackManager
                        // buildPlaerrer) opens up to the surface skylights instead.
                        // Ceiling as ONE continuous swept slab (solid colour), built once on j===0.
                        if (j === 0) {
                            const cHalfW = (s) => (isLwNord ? (this.sim.getTrackSpacing(s) - 2.22)
                                                            : (this.sim.getTrackSpacing(s) + (isSideStation ? 11.1 : 3.66))) / 2;
                            this.buildSweptBar(stationGroup, station.position - platLength / 2, station.position + platLength / 2,
                                cHalfW, centerPos.y + ceilY + 0.1, centerPos.y + ceilY - 0.1,
                                [this.materials.ceiling, this.materials.ceiling], 1.2);
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

                    if (station.name === "Maximilianstraße") {
                        // Concrete cross-beams (girders) under the ceiling
                        // Spacing doubled: place exactly ONE beam per segment (at local Z offset 0)
                        const beamMat = new THREE.MeshLambertMaterial({ color: '#52525b' }); // dark grey concrete
                        const beamGeom = new THREE.BoxGeometry(groundWidth, 0.65, 0.6); // 0.65m height so it hangs deeper
                        
                        const localNorm = new THREE.Vector3(-Math.cos(rotY), 0, Math.sin(rotY));
                        
                        const beam = new THREE.Mesh(beamGeom, beamMat);
                        beam.position.copy(localPos); // centered in the segment
                        beam.position.y = 4.575; // Unterkante 4.25m, Oberkante 4.90m (Dach liegt auf)
                        beam.rotation.y = rotY;
                        
                        stationGroup.add(beam);
                        
                        // Attach lights under the beam (y = 4.225), running parallel to the crossbeams (along X)
                        const lightOffset = spacing > 8 ? 2.5 : 1.3;
                        const addBeamLight = (beamCenter, xOffset) => {
                            const l = new THREE.Mesh(this.sharedGeometries.lightTube, this.materials.lightTube);
                            l.position.copy(beamCenter).addScaledVector(localNorm, xOffset);
                            l.position.y = 4.225;
                            l.rotation.y = rotY + Math.PI / 2; // rotate 90 deg to align with the crossbeam (X axis)
                            stationGroup.add(l);
                        };
                        addBeamLight(beam.position, -lightOffset);
                        addBeamLight(beam.position, lightOffset);
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

                const leftConcreteWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, subLen), this.materials.pillar);
                leftConcreteWall.position.copy(localPL);
                leftConcreteWall.position.y = 0.75;
                leftConcreteWall.rotation.y = rotY;
                stationGroup.add(leftConcreteWall);

                const rail1a = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, subLen), this.materials.boardHanger);
                rail1a.position.copy(localPL);
                rail1a.position.y = 1.95;
                rail1a.rotation.y = rotY;

                const rail1b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, subLen), this.materials.boardHanger);
                rail1b.position.copy(localPL);
                rail1b.position.y = 2.4;
                rail1b.rotation.y = rotY;
                stationGroup.add(rail1a, rail1b);

                const fenceRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, subLen), this.materials.boardHanger);
                fenceRail.position.copy(localPR);
                fenceRail.position.y = 1.2;
                fenceRail.rotation.y = rotY;
                stationGroup.add(fenceRail);

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
                const localWallR = stationGroup.worldToLocal(posWallR.clone());
                const localWallL = stationGroup.worldToLocal(posWallL.clone());

                // 1. Sandstone Walls (Left & Right)
                const wallL = new THREE.Mesh(jakobinenstrasseWallGeom, [jakobinenstrasseSandstoneMat, this.materials.grayWallEdge]);
                wallL.position.copy(localWallL);
                wallL.position.y = 0;
                wallL.rotation.y = rotY;

                const wallR = new THREE.Mesh(jakobinenstrasseWallGeom, [jakobinenstrasseSandstoneMat, this.materials.grayWallEdge]);
                wallR.position.copy(localWallR);
                wallR.position.y = 0;
                wallR.rotation.y = rotY;

                stationGroup.add(wallL, wallR);

                // 1b. Dark Wall Fill above Sandstone Walls (Left & Right) to meet the ceiling
                const fillL = new THREE.Mesh(jakobinenstrasseFillGeom, this.materials.boardHanger);
                fillL.position.copy(localWallL);
                fillL.position.y = 0;
                fillL.rotation.y = rotY;

                const fillR = new THREE.Mesh(jakobinenstrasseFillGeom, this.materials.boardHanger);
                fillR.position.copy(localWallR);
                fillR.position.y = 0;
                fillR.rotation.y = rotY;

                stationGroup.add(fillL, fillR);

                // 2. Dark vertical columns at the segment end boundaries (z = 2.5)
                const pEndL = posWallL.clone().addScaledVector(normal, -0.101).addScaledVector(tangent, 2.5);
                const colL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colL.position.copy(stationGroup.worldToLocal(pEndL));
                colL.position.y = 2.96;
                colL.rotation.y = rotY;

                const pEndR = posWallR.clone().addScaledVector(normal, 0.101).addScaledVector(tangent, 2.5);
                const colR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colR.position.copy(stationGroup.worldToLocal(pEndR));
                colR.position.y = 2.96;
                colR.rotation.y = rotY;

                stationGroup.add(colL, colR);

                // 2b. Dark vertical column under the MIDDLE downward "Zacken" of each segment (z = 0)
                const pMidL = posWallL.clone().addScaledVector(normal, -0.101);
                const colMidL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colMidL.position.copy(stationGroup.worldToLocal(pMidL));
                colMidL.position.y = 2.96;
                colMidL.rotation.y = rotY;

                const pMidR = posWallR.clone().addScaledVector(normal, 0.101);
                const colMidR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                colMidR.position.copy(stationGroup.worldToLocal(pMidR));
                colMidR.position.y = 2.96;
                colMidR.rotation.y = rotY;

                stationGroup.add(colMidL, colMidR);

                // For the very first segment (j === 0), also add columns at the start boundary (z = -2.5)
                if (j === 0) {
                    const pStartL = posWallL.clone().addScaledVector(normal, -0.101).addScaledVector(tangent, -2.5);
                    const colStartL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colStartL.position.copy(stationGroup.worldToLocal(pStartL));
                    colStartL.position.y = 2.96;
                    colStartL.rotation.y = rotY;

                    const pStartR = posWallR.clone().addScaledVector(normal, 0.101).addScaledVector(tangent, -2.5);
                    const colStartR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.52, 0.12), this.materials.boardHanger);
                    colStartR.position.copy(stationGroup.worldToLocal(pStartR));
                    colStartR.position.y = 2.96;
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
                    textMeshL.position.y = 1.85; // Augenhöhe (approx 1.85m local Y, i.e., 1.3m above 0.55m platform)
                    textMeshL.rotation.set(0, rotY + Math.PI / 2, 0);

                    // Right wall text (facing tracks)
                    const textMeshR = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.5625), jakobinenstrasseTextMat);
                    const pTextR = posWallR.clone().addScaledVector(tangent, 1.25);
                    textMeshR.position.copy(stationGroup.worldToLocal(pTextR));
                    textMeshR.position.x -= 0.11;
                    textMeshR.position.y = 1.85; // Augenhöhe
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
                    const isMax = (station.name === "Maximilianstraße");
                    const topHeight = isMax ? 5.0 : 3.7;
                    const hFactor = preset.flatTiles ? 0.6 : 1.2;
                    const sA = station.position - platLength / 2, sB = station.position + platLength / 2;
                    const offW = (s) => this.sim.getTrackSpacing(s) / 2 + 1.83;
                    const cy = centerPos.y;
                    for (const sign of [1, -1]) {
                        const off = (s) => sign * offW(s);
                        const offS = (s) => sign * (offW(s) - 0.02); // stripe sits just in front of the wall
                        this.buildSweptWall(stationGroup, sA, sB, off, cy - 0.38, cy + 1.10, mats.bottom, 1.2, -0.38 / hFactor, 1.10 / hFactor);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 1.10, cy + 1.10 + topHeight, mats.top, 1.2, 1.1 / hFactor, (1.1 + topHeight) / hFactor);
                        this.buildSweptWall(stationGroup, sA, sB, offS, cy + 1.89, cy + 2.11, mats.stripe, 90 / repeatX, 0, 1);
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
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 0.75, cy + 2.55, aufsessplatzWhiteTileMat, 1.2, 0.75 / 1.2, 2.55 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, off, cy + 2.55, cy + 4.59, aufsessplatzRedTileMat, 1.2, 2.55 / 1.2, 4.59 / 1.2);
                        this.buildSweptWall(stationGroup, sA, sB, offS, cy + 1.56, cy + 1.74, aufsessplatzStripeMat, 90 / repeatX, 0, 1);
                    }
                }
            } else {
                // Generic outer walls: solid colour, so one continuous swept slab per side
                // (built once on j===0), tapering its lateral offset with the inter-track gap.
                if (station.name !== "Langwasser Nord" && j === 0) {
                    const wallMaterial = new THREE.MeshLambertMaterial({ color: station.color || '#333333' });
                    const isMax = (station.name === "Maximilianstraße");
                    const ceilYw = isMax ? 5.0 : 4.66;
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
        if (station.name === "Maximilianstraße") {
            // 11 pillars in equal distance (from -30 to 30 with spacing 6m) to clear the escalators
            stationPillarZ = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30].map(z => z * S_len);
        } else if (station.name === "Aufseßplatz") {
            // 9 pillars in equal distance (from -32 to 32 with spacing 8m)
            stationPillarZ = [-32, -24, -16, -8, 0, 8, 16, 24, 32].map(z => z * S_len);
        }
        const tPillarTrunkGeom = new THREE.BoxGeometry(0.3, 2.75, 0.3);
        const tPillarBarGeom = new THREE.BoxGeometry(2.4, 0.25, 0.35);
 
        stationPillarZ.forEach(pz => {
            if (station.name === "Hardhöhe" || station.name === "Jakobinenstraße") return; // column-free!
            const isTiledExitStation = (station.name === "Maximilianstraße" || 
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
            const isMax = (station.name === "Maximilianstraße");
            let ceilY = isMax ? 5.0 : 4.66;
            if (station.name === "Aufseßplatz") ceilY = 4.59;
            if (station.name === "Hardhöhe") ceilY = 4.8;
            if (station.name === "Eberhardshof") ceilY = 4.65;

            const pHeight = ceilY - 0.865;
            const pY = 0.865 + pHeight / 2;

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

        const boardZ = [-30, 0, 30]; 
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
            const ceilY = (station.name === "Hardhöhe") ? 4.8 : ((station.name === "Maximilianstraße") ? 5.0 : 4.66);
            const hangerLen = ceilY - boardY;
            const hangerY = boardY + hangerLen / 2;
            const boardHangerGeom = new THREE.CylinderGeometry(0.015, 0.015, hangerLen, 6);

            const scaleFactor = 1.0;
            const hangerOffset = 2.53 * 0.25;

            // Gleis 1 Board (Left Platform - Outer side facing active tracks)
            // Swapped directions: track 1 side board uses materialsG2 ("LANGWASSER SÜD")
            const g1X = isSideStation ? (-spacing / 2 - 1.73) : (isLwNord ? -1.0 : (isScharfreiterring ? -(localSchPlatCenter + 1.0) : -1.5));
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
            const g2X = isSideStation ? (spacing / 2 + 1.73) : (isLwNord ? 1.0 : (isScharfreiterring ? (localSchPlatCenter + 1.0) : 1.5));
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
                const g1InnerX = -(localSchPlatCenter - 1.0);
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
                const g2InnerX = localSchPlatCenter - 1.0;
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
            if (["Hardhöhe", "Maximilianstraße", "Jakobinenstraße", "Langwasser Süd", "Gemeinschaftshaus", "Langwasser Mitte", "Aufseßplatz", "Maffeiplatz"].includes(station.name)) return; // Skip standard lights
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

        // --- APPLY NEW STANDARD STAIRS TO LEGACY STATIONS ---
        import('./stations/StationBuilder.js?v=67').then(({ StationBuilder }) => {
            const builder = new StationBuilder(this, station);
            builder.group = stationGroup;
            builder.buildStairs();
        });

        return stationGroup;
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
        ctx.font = 'bold 54px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2); // CAPS LOCK

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
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
        ctx.font = 'bold 26px "Outfit", "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw the station name centered on the canvas, compressed horizontally
        // to make it narrow (condensed) as requested by the user.
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(0.68, 1.0); // Compress horizontally to make it narrow/condensed
        ctx.fillText(name.toUpperCase(), 0, 0);
        ctx.restore();

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
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
        // Lightweight sandstone look: tiny 16x16 canvas (just a base tone + grout grid),
        // no bump map, no per-pixel grain loops. Cheap to generate and to render.
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');

        // Warm sandstone base tone
        ctx.fillStyle = '#decab0';
        ctx.fillRect(0, 0, 16, 16);

        // Single thin grout line at the bottom edge of the tile to suggest masonry rows
        ctx.strokeStyle = '#8c765c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 15.5);
        ctx.lineTo(16, 15.5);
        ctx.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(15, 6); // mimics the previous row/column tiling density
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;

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
}