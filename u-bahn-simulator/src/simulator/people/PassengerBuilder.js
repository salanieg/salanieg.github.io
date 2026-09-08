// ============================================================================
// PassengerBuilder.js — Prozedurale Low-Poly-Fahrgastfiguren (statisch).
//
// KI-LANDKARTE:
//   - createCharacter(options): baut eine Figur aus den Config-Feldern
//     (shirtColor/shirtStyle/pantsColor/hairStyle/height/item/glasses ...).
//     Die Configs kommen aus people/PassengerData.js (pro Station).
//   - buildItem(): die tragbaren Gegenstände (Koffer, Hund, Brezel ...).
//     Neues Item = Case hier + ITEM_SENTENCES-Eintrag in PassengerData.js.
//   - Klick-Sprechblasen: WorldManager.handleSceneClick nutzt
//     userData.isPassenger/config, die createCharacter setzt.
// ============================================================================
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPassengerItem } from './PassengerItems.js';

export class PassengerBuilder {
    static sharedMaterials = new Map();

    constructor() {
        this.materials = PassengerBuilder.sharedMaterials;
    }

    getMaterial(colorHex) {
        let mat = this.materials.get(colorHex);
        if (!mat) {
            const baseColor = new THREE.Color(colorHex);
            baseColor.multiplyScalar(0.5); // Dim by 50%
            mat = new THREE.MeshBasicMaterial({ color: baseColor, fog: false });
            this.materials.set(colorHex, mat);
        }
        return mat;
    }

    // Helper to create a pixelated CanvasTexture
    createCanvasTexture(width, height, drawFn) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        drawFn(ctx, width, height);
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        return tex;
    }

    getTorsoMaterial(style, color, options) {
        const cacheKey = `torso_${style}_${color}_${options.shirtColor || ''}_${options.pantsColor || ''}`;
        if (this.materials.has(cacheKey)) {
            return this.materials.get(cacheKey);
        }

        const shirtColor = color || '#fa8072';
        let material;

        // Procedural textures for complex clothing patterns to optimize draw calls
        if (style === 'striped') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = shirtColor;
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                for (let y = 0; y < h; y += 4) {
                    ctx.fillRect(0, y, w, 2);
                }
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'plaid') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#8b4513';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#d2b48c';
                for (let x = 0; x < w; x += 4) {
                    ctx.fillRect(x, 0, 2, h);
                }
                for (let y = 0; y < h; y += 4) {
                    ctx.fillRect(0, y, w, 2);
                }
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'plaid_red') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#b91c1c';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#111111';
                for (let x = 0; x < w; x += 4) {
                    ctx.fillRect(x, 0, 1, h);
                }
                for (let y = 0; y < h; y += 4) {
                    ctx.fillRect(0, y, w, 1);
                }
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'logo') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#374151';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ff00ff';
                ctx.fillRect(2, 3, 5, 4);
                ctx.fillStyle = '#00ffff';
                ctx.fillRect(9, 5, 4, 4);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'yellow_shoulders') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#374151';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffd700';
                ctx.fillRect(0, 0, w, 4);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'cult_uniform') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = shirtColor || '#38bdf8'; // light blue uniform shirt
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff'; // white tie knot
                ctx.beginPath();
                ctx.moveTo(w/2 - 2, 0);
                ctx.lineTo(w/2 + 2, 0);
                ctx.lineTo(w/2, 4);
                ctx.fill();
                ctx.fillStyle = '#ffffff'; // white tie body
                ctx.fillRect(w/2 - 1, 3, 2, 9);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'tie') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#1e3a8a';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(w/2 - 2, 0);
                ctx.lineTo(w/2 + 2, 0);
                ctx.lineTo(w/2, 4);
                ctx.fill();
                ctx.fillStyle = '#dc2626';
                ctx.fillRect(w/2 - 1, 3, 2, 8);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'tie_crooked') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#374151';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(w/2 - 2, 0);
                ctx.lineTo(w/2 + 2, 0);
                ctx.lineTo(w/2, 4);
                ctx.fill();
                ctx.fillStyle = '#dc2626';
                ctx.beginPath();
                ctx.moveTo(w/2 - 1, 3);
                ctx.lineTo(w/2 + 1, 3);
                ctx.lineTo(w/2 + 3, h - 3);
                ctx.lineTo(w/2 + 1, h - 3);
                ctx.fill();
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'fcn') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#800000';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, h/2 - 1, w, 2);
                ctx.fillStyle = '#800000'; // red-white scarf area at top
                ctx.fillRect(0, 0, w, 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(4, 0, 2, 2);
                ctx.fillRect(10, 0, 2, 2);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'greuther') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#008000';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, h/2 - 1, w, 2);
                ctx.fillStyle = '#008000'; // green-white scarf area at top
                ctx.fillRect(0, 0, w, 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(4, 0, 2, 2);
                ctx.fillRect(10, 0, 2, 2);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'split_nuremberg_fuerth') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#b91c1c';
                ctx.fillRect(0, 0, w/2, h);
                ctx.fillStyle = '#ffffff';
                for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w/2, 2);
                ctx.fillStyle = '#008000';
                ctx.fillRect(w/2, 0, w/2, h);
                ctx.fillStyle = '#ffffff';
                for (let y = 2; y < h; y += 4) ctx.fillRect(w/2, y, w/2, 2);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'doctor') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#0f766e';
                ctx.beginPath();
                ctx.moveTo(w/2 - 2, 0);
                ctx.lineTo(w/2 + 2, 0);
                ctx.lineTo(w/2, 6);
                ctx.fill();
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'overall_oil') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#1e3a8a';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffd700'; // orange accent
                ctx.fillRect(0, 0, w, 2);
                ctx.fillStyle = '#374151'; // oil stains
                ctx.fillRect(2, 5, 2, 2);
                ctx.fillRect(10, 8, 3, 2);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'suspenders') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#111111';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(3, 0, 2, h);
                ctx.fillRect(w - 5, 0, 2, h);
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'pinstripe') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#111111';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#4b5563';
                for (let x = 2; x < w; x += 4) {
                    ctx.fillRect(x, 0, 1, h);
                }
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'lanyard_datev') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#5c4033';
                ctx.fillRect(0, 0, w, h);
                ctx.strokeStyle = '#059669';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(3, 0);
                ctx.lineTo(w/2, h/2);
                ctx.lineTo(w - 3, 0);
                ctx.stroke();
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'evening') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#111111';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(w/2 - 2, 0);
                ctx.lineTo(w/2 + 2, 0);
                ctx.lineTo(w/2, 6);
                ctx.fill();
                ctx.fillStyle = '#111111';
                ctx.fillRect(w/2 - 2, 2, 4, 2); // bowtie
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else if (style === 'pattern_orange_turquoise') {
            const tex = this.createCanvasTexture(16, 16, (ctx, w, h) => {
                ctx.fillStyle = '#ea580c';
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = '#06b6d4';
                for (let x = 0; x < w; x += 4) {
                    for (let y = 0; y < h; y += 4) {
                        ctx.fillRect(x + ((y/4)%2)*2, y, 2, 2);
                    }
                }
            });
            material = new THREE.MeshBasicMaterial({ map: tex, color: '#808080', fog: false });
        } else {
            material = this.getMaterial(shirtColor);
        }

        this.materials.set(cacheKey, material);
        return material;
    }

    isLongSleeveStyle(style) {
        const longSleeveStyles = [
            'long_sleeve',
            'tie',
            'tie_crooked',
            'doctor',
            'evening',
            'pinstripe',
            'overall_oil',
            'flannel_red_black',
            'tracksuit',
            'security',
            'smoking_or_dress',
            'business_badge',
            'hoodie',
            'hoodie_backpack',
            'plaid',
            'plaid_red',
            'patchwork',
            'patchwork_80s',
            '80s_style',
            'harlekin',
            'cult_uniform'
        ];
        return longSleeveStyles.includes(style);
    }

    getSleeveMaterial(style, color, options, isRightArm = false) {
        const shirtColor = color || options.shirtColor || '#fa8072';
        let sleeveColor = shirtColor;

        if (style === 'split_nuremberg_fuerth') {
            return this.getMaterial(isRightArm ? '#008000' : '#b91c1c');
        } else if (style === 'doctor') {
            sleeveColor = '#ffffff';
        } else if (style === 'cult_uniform') {
            sleeveColor = options.shirtColor || '#38bdf8';
        } else if (style === 'evening') {
            sleeveColor = '#111111';
        } else if (style === 'tie') {
            sleeveColor = options.shirtColor || '#1e3a8a';
        } else if (style === 'tie_crooked') {
            sleeveColor = options.shirtColor || '#374151';
        } else if (style === 'fcn') {
            sleeveColor = '#800000';
        } else if (style === 'greuther') {
            sleeveColor = '#008000';
        } else if (style === 'overall_oil') {
            sleeveColor = '#1e3a8a';
        } else if (style === 'yellow_shoulders') {
            sleeveColor = options.shirtColor || '#374151';
        } else if (style === 'logo') {
            sleeveColor = options.shirtColor || '#374151';
        } else if (style === 'pinstripe') {
            sleeveColor = '#111111';
        } else if (style === 'suspenders') {
            sleeveColor = options.shirtColor || '#111111';
        } else if (style === 'lanyard_datev') {
            sleeveColor = options.shirtColor || '#5c4033';
        } else if (style === 'pattern_orange_turquoise') {
            sleeveColor = '#ea580c';
        } else if (style === 'plaid') {
            sleeveColor = '#8b4513';
        } else if (style === 'plaid_red' || style === 'flannel_red_black') {
            sleeveColor = '#b91c1c';
        } else if (style === 'harlekin') {
            sleeveColor = isRightArm ? '#000000' : '#ffffff';
        } else if (style === 'tracksuit') {
            sleeveColor = options.shirtColor || '#1d4ed8';
        } else if (style === 'security') {
            sleeveColor = options.shirtColor || '#1e3b8a';
        }

        // Return a clean, solid, un-distorted material for the sleeves
        return this.getMaterial(sleeveColor);
    }

    createCharacter(options) {
        const group = new THREE.Group();

        // 0. Base properties and palettes
        const defaultSkins = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#f5d0c0'];
        const defaultHairs = ['#593e1a', '#edd18c', '#090807', '#808080', '#b25a38'];
        const defaultShoes = ['#111111', '#ffffff', '#4a4a4a', '#8b5a2b'];
        
        const skinColor = options.skinColor || defaultSkins[Math.floor(Math.random() * defaultSkins.length)];
        const hairColor = options.hairColor || defaultHairs[Math.floor(Math.random() * defaultHairs.length)];
        const shoesColor = options.shoesColor || defaultShoes[Math.floor(Math.random() * defaultShoes.length)];
        
        const skinMat = this.getMaterial(skinColor);
        const hairMat = this.getMaterial(hairColor);
        const shoesMat = this.getMaterial(shoesColor);
        const shirtMat = this.getTorsoMaterial(options.shirtStyle, options.shirtColor, options);
        
        // Handle pants colors dynamically
        const defaultPants = ['#333333', '#1d4ed8', '#4b5563', '#0f2b5c'];
        const pantsColor = options.pantsColor || defaultPants[Math.floor(Math.random() * defaultPants.length)];
        const pantsMat = this.getMaterial(pantsColor);

        // 1. Legs and Shoes (Articulated at hips Y = 0.45)
        const shoeGeom = new THREE.BoxGeometry(0.1, 0.05, 0.14);
        const shoeL = new THREE.Mesh(shoeGeom, shoesMat);
        shoeL.position.set(0, -0.425, 0.02);
        const shoeR = new THREE.Mesh(shoeGeom, shoesMat);
        shoeR.position.set(0, -0.425, 0.02);

        const legGroupL = new THREE.Group();
        legGroupL.position.set(-0.06, 0.45, 0);
        legGroupL.add(shoeL);

        const legGroupR = new THREE.Group();
        legGroupR.position.set(0.06, 0.45, 0);
        legGroupR.add(shoeR);

        if (options.pantsStyle === 'shorts') {
            const upperLegGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
            const lowerLegGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
            
            const upperL = new THREE.Mesh(upperLegGeom, pantsMat);
            upperL.position.set(0, -0.10, 0);
            const lowerL = new THREE.Mesh(lowerLegGeom, skinMat);
            lowerL.position.set(0, -0.30, 0);

            const upperR = new THREE.Mesh(upperLegGeom, pantsMat);
            upperR.position.set(0, -0.10, 0);
            const lowerR = new THREE.Mesh(lowerLegGeom, skinMat);
            lowerR.position.set(0, -0.30, 0);

            legGroupL.add(upperL, lowerL);
            legGroupR.add(upperR, lowerR);
        } else if (options.pantsStyle === 'skirt') {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, skinMat);
            legL.position.set(0, -0.20, 0);
            const legR = new THREE.Mesh(legGeom, skinMat);
            legR.position.set(0, -0.20, 0);
            legGroupL.add(legL);
            legGroupR.add(legR);

            const skirtGeom = new THREE.BoxGeometry(0.24, 0.22, 0.16);
            const skirtMesh = new THREE.Mesh(skirtGeom, pantsMat);
            skirtMesh.position.set(0, 0.44, 0);
            group.add(skirtMesh);
        } else if (options.pantsStyle === 'dress') {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, skinMat);
            legL.position.set(0, -0.20, 0);
            const legR = new THREE.Mesh(legGeom, skinMat);
            legR.position.set(0, -0.20, 0);
            legGroupL.add(legL);
            legGroupR.add(legR);

            const skirtGeom = new THREE.BoxGeometry(0.24, 0.26, 0.16);
            const dressMesh = new THREE.Mesh(skirtGeom, shirtMat);
            dressMesh.position.set(0, 0.46, 0);
            group.add(dressMesh);
        } else if (options.pantsStyle === 'latz' || options.pantsStyle === 'latz_paint') {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(0, -0.20, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0, -0.20, 0);
            legGroupL.add(legL);
            legGroupR.add(legR);
            
            const bibGeom = new THREE.BoxGeometry(0.22, 0.15, 0.135);
            const bib = new THREE.Mesh(bibGeom, pantsMat);
            bib.position.set(0, 0.525, 0.005);
            group.add(bib);
        } else if (options.pantsStyle === 'jeans_torn') {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(0, -0.20, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0, -0.20, 0);
            
            const ripL = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.04, 0.082), skinMat);
            ripL.position.set(0, -0.21, 0.005);
            const ripR = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.04, 0.082), skinMat);
            ripR.position.set(0, -0.21, 0.005);
            
            legGroupL.add(legL, ripL);
            legGroupR.add(legR, ripR);
        } else {
            const legGeom = new THREE.BoxGeometry(0.08, 0.4, 0.08);
            const legL = new THREE.Mesh(legGeom, pantsMat);
            legL.position.set(0, -0.20, 0);
            const legR = new THREE.Mesh(legGeom, pantsMat);
            legR.position.set(0, -0.20, 0);
            legGroupL.add(legL);
            legGroupR.add(legR);
        }
        group.add(legGroupL, legGroupR);

        // 2. Torso (Y: [0.45, 0.80])
        const hasVest = (options.vestColor !== undefined);
        const vestMat = hasVest ? this.getMaterial(options.vestColor) : null;
        let torsoMesh;
        let vestMesh = null;

        if (options.pantsStyle === 'dress') {
            const torsoGeom = new THREE.BoxGeometry(0.22, 0.35, 0.13);
            torsoMesh = new THREE.Mesh(torsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.625, 0);
            group.add(torsoMesh);
        } else if (options.shirtStyle === 'crop') {
            const upperTorsoGeom = new THREE.BoxGeometry(0.22, 0.2, 0.13);
            const lowerTorsoGeom = new THREE.BoxGeometry(0.22, 0.15, 0.13);
            
            torsoMesh = new THREE.Mesh(upperTorsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.70, 0);
            const lowerTorso = new THREE.Mesh(lowerTorsoGeom, skinMat);
            lowerTorso.position.set(0, 0.525, 0);
            group.add(torsoMesh, lowerTorso);
        } else {
            const torsoGeom = new THREE.BoxGeometry(0.22, 0.35, 0.13);
            torsoMesh = new THREE.Mesh(torsoGeom, shirtMat);
            torsoMesh.position.set(0, 0.625, 0);
            group.add(torsoMesh);

            if (hasVest) {
                const vestGeom = new THREE.BoxGeometry(0.23, 0.34, 0.14);
                vestMesh = new THREE.Mesh(vestGeom, vestMat);
                vestMesh.position.set(0, 0.62, 0);
                group.add(vestMesh);
            }
        }

        // Back Decal
        if (options.backDecal === 'orange_square') {
            const decalGeom = new THREE.BoxGeometry(0.12, 0.12, 0.015);
            const orangeMat = this.getMaterial('#ff6600');
            const decal = new THREE.Mesh(decalGeom, orangeMat);
            decal.position.set(0, 0.65, -0.066);
            group.add(decal);
        }

        // 3. Neck (Y: [0.80, 0.83])
        const neckGeom = new THREE.BoxGeometry(0.05, 0.03, 0.05);
        const neck = new THREE.Mesh(neckGeom, skinMat);
        neck.position.set(0, 0.815, 0);
        group.add(neck);

        // 4. Head Group (Pivot at base of skull / top of neck: Y = 0.83)
        const headGroup = new THREE.Group();
        headGroup.position.set(0, 0.83, 0);

        const headMat = options.faceColor ? this.getMaterial(options.faceColor) : skinMat;
        const headGeom = new THREE.BoxGeometry(0.14, 0.15, 0.14);
        const head = new THREE.Mesh(headGeom, headMat);
        head.position.set(0, 0.075, 0);
        headGroup.add(head);

        // Hair Styles & Headwear
        const isBeanie = options.hairStyle === 'beanie';
        const isBeanieHipster = options.hairStyle === 'beanie_hipster';
        const isAnglerHat = options.hairStyle === 'angler_hat';
        const isFlatCap = options.hairStyle === 'flatcap';
        const isHat = options.hairStyle === 'hat' || options.hairStyle === 'hat_white';
        const isHelmet = options.hairStyle === 'helmet';
        const isBikeHelmet = options.hairStyle === 'bikehelmet';
        const isMotoHelmet = options.hairStyle === 'helmet_moto';
        
        if (!isMotoHelmet) {
            const hairCapGeom = new THREE.BoxGeometry(0.152, 0.09, 0.16);
            const cap = new THREE.Mesh(hairCapGeom, hairMat);
            cap.position.set(0, 0.115, -0.008);
            headGroup.add(cap);

            if (options.hairStyle === 'ponytail') {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.12, 0.05);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.05, -0.065);

                const zopfGeom = new THREE.BoxGeometry(0.04, 0.06, 0.08);
                const zopf = new THREE.Mesh(zopfGeom, hairMat);
                zopf.position.set(0, 0.07, -0.13);

                const bandGeom = new THREE.BoxGeometry(0.046, 0.046, 0.015);
                const band = new THREE.Mesh(bandGeom, this.getMaterial('#111111'));
                band.position.set(0, 0.07, -0.095);

                headGroup.add(back, zopf, band);
            } else if (options.hairStyle === 'long') {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.22, 0.042);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, -0.02, -0.07);

                const strandGeom = new THREE.BoxGeometry(0.022, 0.22, 0.09);
                const strandL = new THREE.Mesh(strandGeom, hairMat);
                strandL.position.set(-0.066, -0.02, -0.01);

                const strandR = new THREE.Mesh(strandGeom, hairMat);
                strandR.position.set(0.066, -0.02, -0.01);

                headGroup.add(back, strandL, strandR);
            } else if (options.hairStyle === 'bun') {
                const bunGeom = new THREE.BoxGeometry(0.06, 0.06, 0.06);
                const bun = new THREE.Mesh(bunGeom, hairMat);
                bun.position.set(0, 0.17, -0.02);
                headGroup.add(bun);
            } else if (options.hairStyle === 'water') {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.08, 0.05);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.05, -0.065);
                headGroup.add(back);

                const dropMat = this.getMaterial('#00bfff');
                const dropL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), dropMat);
                dropL.position.set(-0.06, 0.09, 0.071);
                const dropR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), dropMat);
                dropR.position.set(0.05, 0.06, 0.071);
                headGroup.add(dropL, dropR);
            } else if (options.hairStyle === 'cap_backward') {
                const capMat = this.getMaterial('#dc2626');
                const capDome = new THREE.Mesh(new THREE.BoxGeometry(0.154, 0.06, 0.154), capMat);
                capDome.position.set(0, 0.135, 0);
                const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.08), capMat);
                capBrim.position.set(0, 0.11, -0.10);
                headGroup.add(capDome, capBrim);
            } else {
                const backHairGeom = new THREE.BoxGeometry(0.150, 0.08, 0.05);
                const back = new THREE.Mesh(backHairGeom, hairMat);
                back.position.set(0, 0.05, -0.065);
                headGroup.add(back);
            }
        }

        if (isBeanie || isBeanieHipster) {
            const beanieMat = this.getMaterial(isBeanieHipster ? '#8b4513' : '#111111');
            const beanieGeom = new THREE.BoxGeometry(0.156, 0.07, 0.156);
            const beanie = new THREE.Mesh(beanieGeom, beanieMat);
            beanie.position.set(0, 0.14, -0.005);
            headGroup.add(beanie);
        } else if (isHat) {
            const hatColor = options.hairStyle === 'hat_white' ? '#f8fafc' : '#111111';
            const hatMat = this.getMaterial(hatColor);
            
            const brimGeom = new THREE.BoxGeometry(0.24, 0.015, 0.24);
            const brim = new THREE.Mesh(brimGeom, hatMat);
            brim.position.set(0, 0.13, 0);
            
            const crownGeom = new THREE.BoxGeometry(0.15, 0.06, 0.15);
            const crown = new THREE.Mesh(crownGeom, hatMat);
            crown.position.set(0, 0.16, 0);
            
            headGroup.add(brim, crown);
        } else if (isHelmet) {
            const helmMat = this.getMaterial('#ffd700');
            const helmGeom = new THREE.SphereGeometry(0.09, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            const helm = new THREE.Mesh(helmGeom, helmMat);
            helm.position.set(0, 0.13, 0);
            helm.scale.set(1.0, 0.7, 1.0);
            headGroup.add(helm);
        } else if (isBikeHelmet) {
            const helmMat = this.getMaterial('#1a1a1a');
            const helmGeom = new THREE.BoxGeometry(0.156, 0.07, 0.165);
            const helm = new THREE.Mesh(helmGeom, helmMat);
            helm.position.set(0, 0.14, 0);
            
            const stripeMat = this.getMaterial('#ffffff');
            const strL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.074, 0.168), stripeMat);
            strL.position.set(-0.04, 0.14, 0);
            const strR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.074, 0.168), stripeMat);
            strR.position.set(0.04, 0.14, 0);
            
            headGroup.add(helm, strL, strR);
        } else if (isAnglerHat) {
            const hatMat = this.getMaterial('#2e8b57');
            const brim = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.015, 0.20), hatMat);
            brim.position.set(0, 0.125, 0);
            const dome = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.15), hatMat);
            dome.position.set(0, 0.15, 0);
            headGroup.add(brim, dome);
        } else if (isFlatCap) {
            const capMat = this.getMaterial('#8b5a2b');
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.156, 0.06, 0.16), capMat);
            cap.position.set(0, 0.135, -0.01);
            const visor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.01, 0.04), capMat);
            visor.position.set(0, 0.11, 0.09);
            headGroup.add(cap, visor);
        } else if (isMotoHelmet) {
            const helmMat = this.getMaterial('#111111');
            const helm = new THREE.Mesh(new THREE.BoxGeometry(0.158, 0.165, 0.158), helmMat);
            helm.position.set(0, 0.075, 0);
            
            const visorMat = this.getMaterial('#000000');
            const visor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.01), visorMat);
            visor.position.set(0, 0.085, 0.075);
            
            headGroup.add(helm, visor);
        }

        // Facial details & Accessories
        if (options.sunglasses || options.glasses === 'sunglasses') {
            const glassesGeom = new THREE.BoxGeometry(0.148, 0.03, 0.015);
            const glassesMat = this.getMaterial('#222222');
            const glasses = new THREE.Mesh(glassesGeom, glassesMat);
            glasses.position.set(0, 0.075, 0.071);
            headGroup.add(glasses);
        } else if (options.glasses) {
            const gColor = options.glasses === 'red' ? '#dc2626' : (options.glasses === 'horn' ? '#5c4033' : '#111111');
            const glassesMat = this.getMaterial(gColor);
            
            if (options.glasses === 'monocle') {
                const ringMat = this.getMaterial('#ffd700');
                const ring = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), ringMat);
                ring.position.set(0.03, 0.08, 0.071);
                headGroup.add(ring);
            } else {
                const fL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), glassesMat);
                fL.position.set(-0.03, 0.08, 0.071);
                const fR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), glassesMat);
                fR.position.set(0.03, 0.08, 0.071);
                const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.01), glassesMat);
                bridge.position.set(0, 0.08, 0.071);
                headGroup.add(fL, fR, bridge);
            }
        }

        if (options.beardColor) {
            const bMat = this.getMaterial(options.beardColor);
            if (options.beardColor === '#808080' && options.item === 'breze') {
                const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.02, 0.02), bMat);
                mustache.position.set(0, 0.035, 0.071);
                headGroup.add(mustache);
            } else {
                const beard = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.06, 0.06), bMat);
                beard.position.set(0, 0.01, 0.04);
                headGroup.add(beard);
            }
        }

        if (options.tired === 'eyes') {
            const ringMat = this.getMaterial('#374151');
            const rL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.01), ringMat);
            rL.position.set(-0.03, 0.05, 0.071);
            const rR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.01), ringMat);
            rR.position.set(0.03, 0.05, 0.071);
            headGroup.add(rL, rR);
        } else if (options.tired === 'heavy_eyes') {
            const lidMat = this.getMaterial('#94a3b8');
            const rL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.01), lidMat);
            rL.position.set(-0.03, 0.085, 0.071);
            const rR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.01), lidMat);
            rR.position.set(0.03, 0.085, 0.071);
            headGroup.add(rL, rR);
        }

        if (options.sweat === 'forehead' || options.sweat === 'soaked') {
            const sweatMat = this.getMaterial('#87cefa');
            const dropL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.01), sweatMat);
            dropL.position.set(-0.05, 0.10, 0.071);
            const dropR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.01), sweatMat);
            dropR.position.set(0.05, 0.09, 0.071);
            headGroup.add(dropL, dropR);
        }

        group.add(headGroup);

        // 5. Arms & Hands (Articulated at Shoulders Y = 0.77 and Elbows Y = 0.64)
        const isLongSleeve = this.isLongSleeveStyle(options.shirtStyle);
        const sleeveMatL = this.getSleeveMaterial(options.shirtStyle, options.shirtColor, options, false);
        const sleeveMatR = this.getSleeveMaterial(options.shirtStyle, options.shirtColor, options, true);

        // Left Arm
        const shoulderL = new THREE.Group();
        shoulderL.position.set(-0.14, 0.77, 0);

        const upperArmL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.06), sleeveMatL);
        upperArmL.position.set(0, -0.065, 0);
        shoulderL.add(upperArmL);

        const elbowL = new THREE.Group();
        elbowL.position.set(0, -0.13, 0);
        shoulderL.add(elbowL);

        const forearmMatL = isLongSleeve ? sleeveMatL : skinMat;
        const forearmL = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.14, 0.052), forearmMatL);
        forearmL.position.set(0, -0.07, 0);
        elbowL.add(forearmL);

        const handL = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.05, 0.046), skinMat);
        handL.position.set(0, -0.155, 0.008);
        elbowL.add(handL);

        group.add(shoulderL);

        // Right Arm
        const shoulderR = new THREE.Group();
        shoulderR.position.set(options.isAnimatedMan ? 0.122 : 0.14, 0.77, 0);

        const upperArmR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.06), sleeveMatR);
        upperArmR.position.set(0, -0.065, 0);
        shoulderR.add(upperArmR);

        const elbowR = new THREE.Group();
        elbowR.position.set(0, -0.13, 0);
        shoulderR.add(elbowR);

        const forearmMatR = isLongSleeve ? sleeveMatR : skinMat;
        const forearmR = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.14, 0.052), forearmMatR);
        forearmR.position.set(0, -0.07, 0);
        elbowR.add(forearmR);

        const handR = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.05, 0.046), skinMat);
        handR.position.set(0, -0.155, 0.008);
        elbowR.add(handR);

        group.add(shoulderR);

        // Sweatband and Bandage attachments
        if (options.sweatband) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.04, 0.058), this.getMaterial('#dc2626'));
            band.position.set(0, -0.07, 0);
            elbowL.add(band);
        }
        if (options.bandage) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.06, 0.058), this.getMaterial('#ffffff'));
            band.position.set(0, -0.07, 0);
            elbowL.add(band);
        }

        // 6. Pose Application
        let pose = options.pose;
        if (!pose) {
            const item = options.item;
            if (item === 'smartphone') {
                pose = 'phone';
            } else if (item === 'armbanduhr' || item === 'taschenuhr' || item === 'pulsuhr') {
                pose = 'check_watch';
            } else if (['kaffeebecher', 'coffeetogo', 'bierdose', 'bierflasche', 'craftbeer', 'bierkrug', 'trinkflasche', 'thermoskanne', 'energy', 'pommes', 'bratwurst', 'stadionwurst', 'doener'].includes(item)) {
                pose = 'drink';
            } else if (['buch', 'schulbuch', 'bgb', 'quellekatalog', 'reisefuehrer', 'zeitung', 'fahrplan', 'netzplan', 'stadtplan', 'notizblock', 'schreibmappe', 'klemmbrett', 'patientenakte', 'klassenarbeit', 'tablet', 'ereader'].includes(item)) {
                pose = 'reading';
            } else if (['fotoapparat', 'slr_camera', 'action_cam', 'fernglas'].includes(item)) {
                pose = 'camera';
            } else if (['wanderstock', 'kruecke', 'angelrute'].includes(item)) {
                pose = 'cane';
            } else if (['rollator', 'kinderwagen'].includes(item)) {
                pose = 'stroller';
            } else if (['paket', 'flachpaket', 'einweggrill'].includes(item)) {
                pose = 'holding_box';
            } else {
                const seedStr = (options.name || '') + (options.shirtColor || '') + (options.hairColor || '');
                let hash = 0;
                for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
                hash = Math.abs(hash);

                const hasCarryItem = ['schulranzen', 'sporttasche', 'einkaufsnetz', 'einkaufstueten', 'aktenkoffer', 'werkzeugkoffer', 'lederaktentasche', 'rollator', 'kinderwagen', 'hundeleine', 'retrohandtasche', 'jutebeutel', 'boutiquetuete', 'frakta', 'baecker_tuete', 'schuhkarton', 'palette', 'koffer', 'wickeltasche', 'schluesselbund', 'regenschirm', 'regenschirm_holz', 'kleeblatt_fahne', 'rosenstrauss', 'blumen_obst'].includes(item);

                if (hasCarryItem) {
                    const carryPoses = ['relaxed_standing', 'looking_for_train', 'lookup'];
                    pose = carryPoses[hash % carryPoses.length];
                } else {
                    const idlePoses = ['relaxed_standing', 'pockets', 'arms_crossed', 'looking_for_train', 'lookup'];
                    pose = idlePoses[hash % idlePoses.length];
                }
            }
        }

        switch (pose) {
            case 'phone': {
                shoulderR.rotation.set(-0.65, -0.15, -0.10);
                elbowR.rotation.set(-0.95, -0.20, 0);
                shoulderL.rotation.set(0.04, 0, -0.04);
                headGroup.rotation.set(0.24, 0, 0);
                break;
            }
            case 'check_watch': {
                shoulderL.rotation.set(-0.60, 0.35, 0.25);
                elbowL.rotation.set(-1.15, 0, 0);
                shoulderR.rotation.set(0.04, 0, 0.04);
                headGroup.rotation.set(0.22, -0.15, 0);
                break;
            }
            case 'drink': {
                shoulderR.rotation.set(-0.48, -0.10, 0);
                elbowR.rotation.set(-0.75, 0, 0);
                shoulderL.rotation.set(0.04, 0, -0.04);
                headGroup.rotation.set(0.08, 0, 0);
                break;
            }
            case 'reading': {
                shoulderR.rotation.set(-0.50, -0.20, 0);
                elbowR.rotation.set(-0.75, 0, 0);
                shoulderL.rotation.set(-0.50, 0.20, 0);
                elbowL.rotation.set(-0.75, 0, 0);
                headGroup.rotation.set(0.26, 0, 0);
                break;
            }
            case 'camera': {
                shoulderR.rotation.set(-0.95, -0.15, 0);
                elbowR.rotation.set(-0.85, 0, 0);
                shoulderL.rotation.set(-0.95, 0.15, 0);
                elbowL.rotation.set(-0.85, 0, 0);
                headGroup.rotation.set(0.05, 0, 0);
                break;
            }
            case 'arms_crossed': {
                shoulderL.rotation.set(-0.42, 0.30, 0.10);
                elbowL.rotation.set(-1.35, 0, 0);
                shoulderR.rotation.set(-0.44, -0.28, -0.10);
                elbowR.rotation.set(-1.30, 0, 0);
                headGroup.rotation.set(0.02, 0.05, 0);
                break;
            }
            case 'pockets': {
                shoulderL.rotation.set(0.12, 0, -0.06);
                elbowL.rotation.set(0.35, 0, 0);
                shoulderR.rotation.set(0.12, 0, 0.06);
                elbowR.rotation.set(0.35, 0, 0);
                headGroup.rotation.set(0.02, -0.04, 0);
                break;
            }
            case 'looking_for_train': {
                shoulderL.rotation.set(0.04, 0, -0.04);
                shoulderR.rotation.set(-0.10, 0, 0.12);
                elbowR.rotation.set(-0.35, 0, 0);
                headGroup.rotation.set(0.06, 0.50, 0.04);
                break;
            }
            case 'lookup': {
                headGroup.rotation.set(-0.32, 0, 0);
                shoulderL.rotation.set(0.02, 0, -0.03);
                shoulderR.rotation.set(-0.02, 0, 0.03);
                break;
            }
            case 'sprint': {
                shoulderL.rotation.set(-0.65, 0, 0);
                elbowL.rotation.set(-0.80, 0, 0);
                shoulderR.rotation.set(0.60, 0, 0);
                elbowR.rotation.set(-0.75, 0, 0);
                legGroupL.rotation.set(0.40, 0, 0);
                legGroupR.rotation.set(-0.40, 0, 0);
                headGroup.rotation.set(-0.08, 0, 0);
                break;
            }
            case 'bent': {
                shoulderL.rotation.set(-0.55, 0, 0);
                elbowL.rotation.set(-0.70, 0, 0);
                shoulderR.rotation.set(-0.55, 0, 0);
                elbowR.rotation.set(-0.70, 0, 0);
                torsoMesh.position.z += 0.04;
                if (vestMesh) vestMesh.position.z += 0.04;
                headGroup.position.z += 0.05;
                shoulderL.position.z += 0.04;
                shoulderR.position.z += 0.04;
                break;
            }
            case 'cane': {
                shoulderR.rotation.set(-0.25, 0, 0.05);
                elbowR.rotation.set(-0.30, 0, 0);
                shoulderL.rotation.set(0.04, 0, -0.04);
                break;
            }
            case 'stroller': {
                shoulderL.rotation.set(-0.35, 0.05, 0);
                elbowL.rotation.set(-0.35, 0, 0);
                shoulderR.rotation.set(-0.35, -0.05, 0);
                elbowR.rotation.set(-0.35, 0, 0);
                headGroup.rotation.set(0.08, 0, 0);
                break;
            }
            case 'holding_box': {
                shoulderL.rotation.set(-0.45, 0.20, 0);
                elbowL.rotation.set(-0.75, 0, 0);
                shoulderR.rotation.set(-0.45, -0.20, 0);
                elbowR.rotation.set(-0.75, 0, 0);
                headGroup.rotation.set(0.15, 0, 0);
                break;
            }
            case 'clueless': {
                headGroup.rotation.set(-0.10, 0.20, 0.15);
                shoulderL.rotation.set(-0.35, 0.20, 0.20);
                elbowL.rotation.set(-0.60, 0, 0);
                shoulderR.rotation.set(-0.35, -0.20, -0.20);
                elbowR.rotation.set(-0.60, 0, 0);
                break;
            }
            case 'relaxed_standing':
            default: {
                shoulderL.rotation.set(0.04, 0, -0.05);
                shoulderR.rotation.set(-0.03, 0, 0.04);
                headGroup.rotation.set(0.04, 0.08, 0.02);
                break;
            }
        }

        // 7. Hand positions in local group space for precise Item Attachment
        group.updateMatrixWorld(true);

        const hR = new THREE.Vector3();
        handR.getWorldPosition(hR);
        group.worldToLocal(hR);

        const hL = new THREE.Vector3();
        handL.getWorldPosition(hL);
        group.worldToLocal(hL);

        // 8. Items Construction
        if (options.item) {
            this.buildItem(group, options.item, skinMat, hR, hL);
        }

        // Scale entire group to match target height
        const scale = options.height || 1.80;
        group.scale.set(scale, scale, scale);

        // Merge static meshes by material bucket to drastically reduce draw calls
        if (!options.skipMerge) {
            this.mergeMeshes(group);
        }

        // Tag group as passenger for Raycaster lookup and click response
        group.userData = {
            isPassenger: true,
            config: options,
            shoulderR: options.isAnimatedMan ? shoulderR : null,
            elbowR: options.isAnimatedMan ? elbowR : null,
            isAnimated: !!options.isAnimatedMan
        };

        return group;
    }

    mergeMeshes(root) {
        root.updateMatrixWorld(true);
        const invRoot = root.matrixWorld.clone().invert();
        const buckets = new Map();
        const toRemove = [];

        root.traverse(o => {
            if (o.isMesh && o.geometry && o.material) {
                let b = buckets.get(o.material);
                if (!b) { b = []; buckets.set(o.material, b); }
                b.push(o);
            }
        });

        const relMatrix = new THREE.Matrix4();
        for (const [mat, meshes] of buckets) {
            if (meshes.length < 2) continue;
            const geos = [];
            for (const m of meshes) {
                const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
                relMatrix.copy(invRoot).multiply(m.matrixWorld);
                g.applyMatrix4(relMatrix);
                for (const name of Object.keys(g.attributes)) {
                    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
                }
                if (!g.attributes.normal) g.computeVertexNormals();
                if (mat.map && !g.attributes.uv) {
                    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
                }
                geos.push(g);
                toRemove.push(m);
            }
            const merged = BufferGeometryUtils.mergeGeometries(geos, false);
            if (merged) {
                const mergedMesh = new THREE.Mesh(merged, mat);
                root.add(mergedMesh);
            }
        }

        for (const m of toRemove) {
            if (m.parent) m.parent.remove(m);
            if (m.geometry) m.geometry.dispose();
        }
    }

    buildItem(mainGroup, item, skinMat, customHR, customHL) {
        buildPassengerItem(this, mainGroup, item, skinMat, customHR, customHL);
    }
}
